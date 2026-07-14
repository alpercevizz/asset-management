require('dotenv').config({ override: true });
// Setup wizard: env boşsa data/secrets.json'a KALICI güçlü sırlar üretir/yükler.
// Modüller require edilmeden ÖNCE çalışmalı ki lifecycle-tools/worm doğru CHAIN/WORM_SECRET'ı görsün.
require('./auth/setup').bootstrapSecrets();

// ── DB katmanı (SQLite | PostgreSQL) — boot'ta migrate + users cache ─────────
const dbLayer = require('./db');
const usersModule = require('./auth/users');
const osAgentModule = require('./agent/tools/os-agent');
const lifecycleModule = require('./agent/tools/lifecycle-tools');
async function initDataLayer() {
  await dbLayer.migrate();
  await usersModule.init();
  if (osAgentModule.init) await osAgentModule.init();
  await lifecycleModule.init();
  await require('./agent/tools/settings-tools').init();
  // Resmi zimmet: tablo boşsa mevcut Baserow username'lerinden başlangıç zimmeti oluştur.
  try {
    const seedAssets = await getAllAssets({ size: 200 });
    const r = await require('./agent/tools/assignment-tools').seedFromAssets(seedAssets.results || []);
    if (!r.skipped) console.log('[seed] Resmi zimmet başlangıcı:', r.count, 'cihaz');
  } catch (e) { console.error('[seed] zimmet seed başarısız:', e.message); }
  // Demo/dev ortamda lifecycle log boşsa data/lifecycle-log.json'ı yeni CHAIN_SECRET ile yeniden zincirleyerek yükle.
  // Prod'da SEED_DEMO=true açık verilmedikçe atlanır (müşteri envanterine sahte olay eklemez).
  const seedAllowed = process.env.SEED_DEMO === 'true' || process.env.NODE_ENV !== 'production';
  if (seedAllowed && lifecycleModule.seedFromJson) {
    try {
      const fs = require('fs');
      const seedPath = require('path').join(__dirname, 'data', 'lifecycle-log.json');
      if (fs.existsSync(seedPath)) {
        const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        const events = Array.isArray(raw) ? raw : (raw.events || []);
        const r = await lifecycleModule.seedFromJson(events);
        if (!r.skipped) console.log('[seed] Yaşam döngüsü demo verisi yüklendi:', r.count, 'olay');
      }
    } catch (e) { console.error('[seed] lifecycle seed başarısız:', e.message); }
  }
  // Turkcell hat demo seed (tablo boşsa gerçek telefonlara örnek hat bağlar)
  try {
    const r = await require('./agent/tools/line-tools').seedDemoIfEmpty();
    if (!r.skipped) console.log('[seed] Turkcell hat demo verisi yüklendi:', r.count, 'hat');
  } catch (e) { console.error('[seed] hat seed başarısız:', e.message); }
  console.log('[db] Katman hazır — driver:', dbLayer.driver(), '| kullanıcı:', usersModule.all().length);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { getAllAssets, getStats, createAsset, updateAsset, getAssetBySerial } = require('./agent/tools/baserow-tools');
const { getAllLicenses, bulkUpsertLicenses, getLicenseStats } = require('./agent/tools/license-tools');
const { detectAnomalies, detectOfflineDevices, detectLicenseCompliance, detectShadowIT, detectEolOs, detectWarranty } = require('./agent/tools/anomaly-tools');
const { sendDigest, buildAlertDigest, startNotifyScheduler } = require('./agent/tools/notify-tools');
const { getLog, getDeviceLog, verifyChain, detectLifecycleConflicts, LIFECYCLE_STATES, ALERT_ON_RECORD, REQUIRES_APPROVAL, APPROVERS, submitChange, approveByToken, renewRequest, expirePendingRequests, auditBackupStatus, restoreAuditFromBackup } = require('./agent/tools/lifecycle-tools');
const { scanNetwork, startDiscoveryScheduler } = require('./agent/tools/network-discovery');
const { computeRiskScores, computeRenewalForecast } = require('./agent/tools/insight-tools');
const lineTools = require('./agent/tools/line-tools');
const QRCode = require('qrcode');
const { chat } = require('./agent/claude-agent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => { res.setTimeout(360000); next(); }); // 6 dk Express timeout

// ── Güvenlik başlıkları (Helmet yerine minimal, dış bağımlılık yok) ──────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ── Login rate limit: IP başına 15 dakikada 10 deneme (brute-force koruması) ─
const loginAttempts = new Map(); // ip → { count, resetAt }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;
function loginRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || rec.resetAt < now) rec = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  rec.count++;
  loginAttempts.set(ip, rec);
  // Basit kova periyodik temizlik
  if (loginAttempts.size > 5000) {
    for (const [k, v] of loginAttempts) if (v.resetAt < now) loginAttempts.delete(k);
  }
  if (rec.count > LOGIN_MAX) {
    const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.', retry_after: retryAfter });
  }
  next();
}
// Test veya localhost dev için kapatılabilir
if (process.env.DISABLE_LOGIN_RATE_LIMIT !== 'true') {
  app.use('/api/login', loginRateLimit);
}

// In-memory conversation store (keyed by session id)
const sessions = {};

// ─── Kimlik Doğrulama (çok-kullanıcılı + rol, imzalı httpOnly cookie) ─────────
// Token = base64url(payload).hmac(payload). payload = {u:username, r:role, exp}.
// Parolalar auth/users.js'te scrypt ile hash'li. Dış bağımlılık yok (Node crypto).
const { authenticate, authenticateAsync, findUser, publicUser, hasRole } = require('./auth/users');

const SESSION_MS  = 8 * 60 * 60 * 1000; // 8 saat
const COOKIE_NAME = 'am_session';

// SESSION_SECRET zorunlu/güçlü olmalı — sertleştirme app.listen'de doğrulanır.
const AUTH_SECRET = process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signPart(part) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(part).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeToken(user) {
  const payload = b64u(JSON.stringify({ u: user.username, r: user.role, exp: Date.now() + SESSION_MS }));
  return `${payload}.${signPart(payload)}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = signPart(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
  if (!data || Number(data.exp) <= Date.now()) return null;
  return data; // { u, r, exp }
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getSession(req) { return verifyToken(parseCookies(req)[COOKIE_NAME]); }
function isAuthed(req) { return !!getSession(req); }
// İstekteki oturum kullanıcısı (tam kayıt, parolasız) veya null
function currentUser(req) {
  const s = getSession(req);
  return s ? (publicUser(findUser(s.u)) || { username: s.u, role: s.r }) : null;
}
// Rol koruması middleware
function requireRole(...roles) {
  return (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Oturum gerekli', code: 'UNAUTHORIZED' });
    if (!hasRole(u, ...roles)) return res.status(403).json({ error: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN', need: roles });
    next();
  };
}

// Login/Logout endpoint'leri (public)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = await authenticateAsync(username, password);
    if (user) {
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${makeToken(user)}; HttpOnly; Path=/; Max-Age=${SESSION_MS / 1000}; SameSite=Lax`);
      return res.json({ success: true, user: { username: user.username, display: user.display, role: user.role } });
    }
    return res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı' });
  } catch (err) {
    console.error('[POST /api/login]', err.message);
    return res.status(503).json({ error: 'Kimlik doğrulama servisine ulaşılamadı' });
  }
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (u) return res.json({ authenticated: true, user: u.username, display: u.display, role: u.role, upn: u.upn });
  return res.status(401).json({ authenticated: false });
});

// Login sayfası (public). Zaten girişliyse panele yönlendir.
app.get('/login', (req, res) => {
  if (isAuthed(req)) {
    const next = req.query.next;
    return res.redirect(next && String(next).startsWith('/') ? String(next) : '/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Panel giriş noktalarını koru
function requirePage(req, res, next) {
  if (isAuthed(req)) return next();
  return res.redirect('/login');
}
app.get(['/', '/index.html'], requirePage, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API koruması: allowlist dışındaki tüm /api yolları oturum ister.
// Public: client scriptler ve telefon QR kaydı login olamaz.
const PUBLIC_API = new Set(['/login', '/logout', '/health', '/webhook', '/register', '/licenses/sync', '/qr', '/lifecycle/approve']);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path)) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Oturum gerekli', code: 'UNAUTHORIZED' });
});

// Statik dosyalar (css/js/fontlar/register.html/login.html). index:false → '/' otomatik index.html servis etmez.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Assets ──────────────────────────────────────────────────────────────────

app.get('/api/assets', async (req, res) => {
  try {
    const { filter_field, filter_value, page = 1, size = 200 } = req.query;
    const data = await getAllAssets({ page: Number(page), size: Number(size), filterField: filter_field, filterValue: filter_value });
    res.json(data);
  } catch (err) {
    console.error('[GET /api/assets]', err.message);
    res.status(500).json({ error: 'Baserow veri çekme hatası', detail: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    console.error('[GET /api/stats]', err.message);
    res.status(500).json({ error: 'İstatistik hesaplama hatası', detail: err.message });
  }
});

// ─── Webhook (n8n veya direkt client script) ─────────────────────────────────

app.post('/api/webhook', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload.serial_number && !payload.hostname) {
      return res.status(400).json({ error: 'serial_number veya hostname zorunludur' });
    }

    const enriched = {
      ...payload,
      last_seen: new Date().toISOString(),
      status: 'online',
    };

    let existing = null;
    if (payload.serial_number) {
      existing = await getAssetBySerial({ serialNumber: payload.serial_number });
    }

    let result;
    if (existing) {
      // GÜVENLİK: webhook yalnız TELEMETRİ günceller (username = son gören kullanıcı).
      // Resmi zimmet (assigned_to) AYRI tabloda ve KİLİTLİ — buradan DEĞİŞMEZ.
      // Telemetri kullanıcı, resmi zimmetten farklıysa izinsiz-kullanım sinyali ver.
      if (payload.username) {
        try {
          const mm = await require('./agent/tools/assignment-tools').checkMismatch(existing.id, payload.username);
          if (mm) console.warn(`[ZİMMET UYARISI] ${enriched.hostname || existing.id}: resmi zimmet "${mm.assigned_to}" iken telemetri "${mm.seen_user}" gördü (izinsiz kullanım şüphesi).`);
        } catch (_) { /* sinyal opsiyonel */ }
      }
      result = await updateAsset(existing.id, enriched);
      console.log(`[WEBHOOK] Updated: ${payload.hostname || payload.serial_number}`);
    } else {
      result = await createAsset(enriched);
      console.log(`[WEBHOOK] Created: ${payload.hostname || payload.serial_number}`);
    }

    res.json({ success: true, action: existing ? 'updated' : 'created', id: result.id });
  } catch (err) {
    console.error('[POST /api/webhook]', err.message);
    res.status(500).json({ error: 'Webhook işleme hatası', detail: err.message });
  }
});

// ─── QR ile Cihaz Kaydı ───────────────────────────────────────────────────────

// QR kod üret (lokal, dışarı istek yok) — SVG döner
app.get('/api/qr', async (req, res) => {
  try {
    const data = req.query.data;
    if (!data) return res.status(400).json({ error: 'data parametresi zorunlu' });
    const svg = await QRCode.toString(String(data), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('[GET /api/qr]', err.message);
    res.status(500).json({ error: 'QR üretim hatası', detail: err.message });
  }
});

// Mobil formdan gelen cihaz kaydı (telefon, tablet, el terminali vb.)
app.post('/api/register', async (req, res) => {
  try {
    const p = req.body || {};
    const hostname = (p.hostname || '').trim();
    if (!hostname && !p.serial_number) {
      return res.status(400).json({ error: 'Cihaz adı (hostname) veya seri no zorunludur' });
    }

    const enriched = {
      hostname,
      serial_number: (p.serial_number || hostname).trim(),
      category:    p.category    || 'Diğer',
      brand:       p.brand       || '',
      model:       p.model       || '',
      os:          p.os          || '',
      username:    p.username    || '',
      location:    p.location    || '',
      ip_address:  p.ip_address  || '',
      last_seen:   new Date().toISOString(),
      status:      'online',
      collector_ver: 'qr-1.0.0',
    };
    // Boş alanları gönderme
    Object.keys(enriched).forEach(k => { if (enriched[k] === '') delete enriched[k]; });

    let existing = null;
    if (enriched.serial_number) {
      existing = await getAssetBySerial({ serialNumber: enriched.serial_number });
    }

    let result, action;
    if (existing) {
      result = await updateAsset(existing.id, enriched);
      action = 'updated';
    } else {
      result = await createAsset(enriched);
      action = 'created';
    }
    console.log(`[REGISTER] ${action}: ${hostname} (${enriched.category})`);
    res.json({ success: true, action, id: result.id });
  } catch (err) {
    console.error('[POST /api/register]', err.message);
    res.status(500).json({ error: 'Cihaz kaydı hatası', detail: err.message });
  }
});

// Toplu placeholder kayıt: depodaki kimliği belirsiz cihazlar için
// IT adet + kategori girer, sistem otomatik ID'li 'depoda' taslakları oluşturur.
app.post('/api/register/bulk', async (req, res) => {
  try {
    const { category = 'Diğer', location = '', quantity, prefix } = req.body || {};
    const qty = parseInt(quantity, 10);
    if (!qty || qty < 1 || qty > 200) {
      return res.status(400).json({ error: 'quantity 1-200 arası olmalı' });
    }

    // ID öneki: verilmezse kategoriden türet
    const PREFIX_MAP = {
      'Sunucu': 'DEPO-SUNUCU',
      'Telefon': 'DEPO-TELEFON', 'Tablet': 'DEPO-TABLET', 'El Terminali': 'DEPO-TERMINAL',
      'Yazıcı': 'DEPO-YAZICI', 'Ağ Aygıtı': 'DEPO-AG', 'Çevre Aygıtı': 'DEPO-CEVRE', 'Diğer': 'DEPO-CIHAZ',
    };
    const pfx = (prefix && prefix.trim()) || PREFIX_MAP[category] || 'DEPO-CIHAZ';

    // Mevcut aynı önekli kayıtların en büyük numarasını bul → çakışmayı önle
    const all = await getAllAssets({ size: 200 });
    const re = new RegExp(`^${pfx.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    let maxNum = 0;
    for (const a of (all.results || [])) {
      const m = (a.hostname || '').match(re);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }

    const now = new Date().toISOString();
    const created = [];
    for (let i = 1; i <= qty; i++) {
      const num = String(maxNum + i).padStart(3, '0');
      const hostname = `${pfx}-${num}`;
      const row = {
        hostname,
        serial_number: hostname,   // bilinmiyor → geçici olarak hostname
        category,
        status: 'depoda',
        last_seen: now,
        collector_ver: 'manual-bulk-1.0.0',
      };
      if (location) row.location = location;
      const r = await createAsset(row);
      created.push({ id: r.id, hostname });
    }

    console.log(`[BULK] ${qty} adet '${category}' taslak oluşturuldu (${pfx}-...)`);
    res.json({ success: true, count: created.length, prefix: pfx, items: created });
  } catch (err) {
    console.error('[POST /api/register/bulk]', err.message);
    res.status(500).json({ error: 'Toplu kayıt hatası', detail: err.message });
  }
});

// Mobil kayıt sayfası (QR ile açılır)
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// ─── Lisanslar ────────────────────────────────────────────────────────────────

app.get('/api/licenses', async (req, res) => {
  try {
    const { filter_field, filter_value, page = 1, size = 200 } = req.query;
    const data = await getAllLicenses({ page: Number(page), size: Number(size), filterField: filter_field, filterValue: filter_value });
    res.json(data);
  } catch (err) {
    console.error('[GET /api/licenses]', err.message);
    res.status(500).json({ error: 'Lisans verisi çekme hatası', detail: err.message });
  }
});

app.get('/api/licenses/stats', async (req, res) => {
  try {
    const stats = await getLicenseStats();
    res.json(stats);
  } catch (err) {
    console.error('[GET /api/licenses/stats]', err.message);
    res.status(500).json({ error: 'Lisans istatistik hatası', detail: err.message });
  }
});

// Bir bilgisayardan gelen tüm yazılım listesini upsert eder
app.post('/api/licenses/sync', async (req, res) => {
  try {
    const { hostname, serial_number, username, location, software } = req.body;
    if (!hostname || !Array.isArray(software)) {
      return res.status(400).json({ error: 'hostname ve software[] zorunludur' });
    }

    const results = await bulkUpsertLicenses({ hostname, serial_number, username, location, software });

    const created = results.filter(r => r.action === 'created').length;
    const updated = results.filter(r => r.action === 'updated').length;
    console.log(`[LICENSES] ${hostname}: ${created} eklendi, ${updated} güncellendi`);
    res.json({ success: true, created, updated, total: results.length });
  } catch (err) {
    console.error('[POST /api/licenses/sync]', err.message);
    res.status(500).json({ error: 'Lisans sync hatası', detail: err.message });
  }
});

// ─── Anomali & Uyarı Sistemi (deterministik, LLM'siz) ───────────────────────

app.get('/api/anomalies', async (req, res) => {
  try {
    const result = await detectAnomalies();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/anomalies]', err.message);
    res.status(500).json({ error: 'Anomali tespiti hatası', detail: err.message });
  }
});

app.get('/api/alerts/offline', async (req, res) => {
  try {
    const result = await detectOfflineDevices();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/alerts/offline]', err.message);
    res.status(500).json({ error: 'Çevrimdışı tespiti hatası', detail: err.message });
  }
});

app.get('/api/licenses/compliance', async (req, res) => {
  try {
    const result = await detectLicenseCompliance();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/licenses/compliance]', err.message);
    res.status(500).json({ error: 'Lisans uyum raporu hatası', detail: err.message });
  }
});

app.get('/api/shadow-it', async (req, res) => {
  try {
    const result = await detectShadowIT();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/shadow-it]', err.message);
    res.status(500).json({ error: 'Shadow IT tespiti hatası', detail: err.message });
  }
});

app.get('/api/eol-os', async (req, res) => {
  try {
    const result = await detectEolOs();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/eol-os]', err.message);
    res.status(500).json({ error: 'EOL işletim sistemi tespiti hatası', detail: err.message });
  }
});

app.get('/api/warranty', async (req, res) => {
  try {
    const result = await detectWarranty();
    res.json(result);
  } catch (err) {
    console.error('[GET /api/warranty]', err.message);
    res.status(500).json({ error: 'Garanti takibi hatası', detail: err.message });
  }
});

// ─── Cihaz Yaşam Döngüsü & Audit Log ────────────────────────────────────────

// Durum değişikliği kaydet (APPEND-ONLY immutable log). Actor = oturum kullanıcısı.
// Kritik durumlarda (Kayıp/Belirsiz/Ayrılan personelden alındı) anlık bildirim tetiklenir.
app.post('/api/lifecycle/event', requireRole('it', 'admin'), async (req, res) => {
  try {
    const { asset_id, hostname, serial_number, to_status, note, approver, mfa_verified } = req.body || {};
    if (!to_status) return res.status(400).json({ error: 'to_status (yeni durum) zorunlu' });
    // Actor = GERÇEK oturum kullanıcısı; IP/MAC kimliği users tablosundan; MFA durumu istekten.
    const me = currentUser(req);
    const result = await submitChange({
      asset_id, hostname, serial_number, to_status, note,
      actor: me.username, approver: approver || null,
      mfa_verified: mfa_verified !== false, // false → MFA bypass simülasyonu (demo)
    });
    const entry = result.event;

    // Onay bekleyen kayıt → onaylayana gidecek tek kullanımlık link
    let approval_link = null;
    if (result.kind === 'pending') {
      const base = `${req.protocol}://${req.get('host')}`;
      approval_link = `${base}/api/lifecycle/approve?token=${result.approval_token}`;
    }

    // Anlık bildirim: tam bypass ihlali VEYA doğrudan uygulanan kritik durum
    let notified = false;
    if (entry.security_flag === 'imzasiz_kritik' || (result.kind === 'applied' && ALERT_ON_RECORD.has(to_status))) {
      sendDigest({ force: true }).then(() => {}).catch(e => console.error('[lifecycle notify]', e.message));
      notified = true;
    }
    res.json({
      success: true, kind: result.kind, entry, notified,
      security_breach: entry.security_flag === 'imzasiz_kritik',
      approval_id: result.approval_id || null,
      approval_link,
    });
  } catch (err) {
    console.error('[POST /api/lifecycle/event]', err.message);
    res.status(400).json({ error: 'Olay kaydedilemedi', detail: err.message });
  }
});

// Onaylayan linke tıklayınca açılan sayfa. PUBLIC_API'de (guard geçer) AMA içeride
// GERÇEK oturum + 'approver'/'admin' rolü ZORUNLU — onay artık kişi-bazlı doğrulanır.
app.get('/api/lifecycle/approve', async (req, res) => {
  const token = req.query.token;
  const page = (ok, title, msg) => `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/><title>AssetMan — Dijital Onay</title>
    <style>body{font-family:Segoe UI,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:40px;max-width:460px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
    .ic{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:32px}
    .ok{background:rgba(34,197,94,.15);color:#22c55e}.no{background:rgba(239,68,68,.15);color:#ef4444}
    h1{font-size:20px;margin:0 0 10px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0}a{color:#818cf8}</style></head>
    <body><div class="card"><div class="ic ${ok ? 'ok' : 'no'}">${ok ? '🔒' : '⚠'}</div>
    <h1>${title}</h1><p>${msg}</p></div></body></html>`;
  if (!token) return res.status(400).send(page(false, 'Geçersiz Bağlantı', 'Onay token\'ı bulunamadı.'));
  // Kişi-bazlı onay: oturum yoksa login'e yönlendir
  const me = currentUser(req);
  if (!me) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (!hasRole(me, 'approver', 'admin')) {
    return res.status(403).send(page(false, 'Yetkisiz', `Bu işlemi onaylama yetkiniz yok. Onaylayan rolü gerekli (giriş: <b>${me.display || me.username}</b>).`));
  }
  try {
    const { event } = await approveByToken(token, {
      actor: me.username, approver: me.display || me.username, actor_ip: me.ip, mfa_verified: true,
    });
    res.send(page(true, 'Dijital Olarak Onaylandı',
      `<b>${event.hostname || event.serial_number}</b> cihazının "<b>${event.to_status}</b>" durumu, <b>${event.approver}</b> (${event.actor_upn}) tarafından dijital olarak onaylandı ve kriptografik imza (HMAC-SHA256) ile mühürlendi.<br><br>Bu işlem değiştirilemez audit log'a kalıcı kaydedildi. Pencereyi kapatabilirsiniz.`));
  } catch (err) {
    res.status(400).send(page(false, 'Onaylanamadı', err.message));
  }
});

// Süresi dolmuş/bekleyen talebi yenile (yeni link üretir, eskisi çözülür)
app.post('/api/lifecycle/renew', requireRole('it', 'admin'), async (req, res) => {
  try {
    const { approval_id } = req.body || {};
    if (!approval_id) return res.status(400).json({ error: 'approval_id zorunlu' });
    const result = await renewRequest({ approval_id, actor: currentUser(req).username });
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, approval_id: result.approval_id, approval_link: `${base}/api/lifecycle/approve?token=${result.approval_token}` });
  } catch (err) {
    console.error('[POST /api/lifecycle/renew]', err.message);
    res.status(400).json({ error: 'Yenilenemedi', detail: err.message });
  }
});

// ─── Network Discovery (canlı ağ tarama) ────────────────────────────────────
app.get('/api/network/scan', async (req, res) => {
  try {
    res.json(await scanNetwork());
  } catch (err) {
    console.error('[GET /api/network/scan]', err.message);
    res.status(500).json({ error: 'Ağ tarama hatası', detail: err.message });
  }
});

// ─── Risk Skoru & Yenileme/Maliyet Öngörüsü ─────────────────────────────────
app.get('/api/risk-scores', async (req, res) => {
  try {
    res.json(await computeRiskScores());
  } catch (err) {
    console.error('[GET /api/risk-scores]', err.message);
    res.status(500).json({ error: 'Risk skoru hesaplama hatası', detail: err.message });
  }
});

app.get('/api/forecast', async (req, res) => {
  try {
    res.json(await computeRenewalForecast());
  } catch (err) {
    console.error('[GET /api/forecast]', err.message);
    res.status(500).json({ error: 'Öngörü hesaplama hatası', detail: err.message });
  }
});

// ─── Turkcell Hat / SIM Envanteri ────────────────────────────────────────────
// Hat = ayrı varlık (telefon değiştirebilir). "Hangi hat hangi telefonda" + geçmiş.
app.get('/api/lines', async (req, res) => {
  try {
    const [lines, summary] = await Promise.all([lineTools.listLines(), lineTools.summary()]);
    res.json({ summary, lines });
  } catch (err) {
    console.error('[GET /api/lines]', err.message);
    res.status(500).json({ error: 'Hatlar alınamadı', detail: err.message });
  }
});

app.get('/api/lines/:id/history', async (req, res) => {
  try {
    res.json({ history: await lineTools.getLineHistory(Number(req.params.id)) });
  } catch (err) {
    res.status(500).json({ error: 'Hat geçmişi alınamadı', detail: err.message });
  }
});

app.get('/api/lines/for-asset/:assetId', async (req, res) => {
  try {
    res.json({ line: await lineTools.getLineForAsset(Number(req.params.assetId)) });
  } catch (err) {
    res.status(500).json({ error: 'Hat sorgulanamadı', detail: err.message });
  }
});

app.post('/api/lines', requireRole('it', 'admin'), async (req, res) => {
  try {
    const actor = currentUser(req)?.username || 'system';
    const r = await lineTools.upsertLine({ ...(req.body || {}), actor });
    res.json({ success: true, ...r });
  } catch (err) {
    console.error('[POST /api/lines]', err.message);
    res.status(400).json({ error: 'Hat kaydedilemedi', detail: err.message });
  }
});

app.post('/api/lines/import', requireRole('it', 'admin'), async (req, res) => {
  try {
    const actor = currentUser(req)?.username || 'system';
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'İçe aktarılacak satır yok' });
    res.json({ success: true, ...(await lineTools.importLines(rows, actor)) });
  } catch (err) {
    console.error('[POST /api/lines/import]', err.message);
    res.status(400).json({ error: 'İçe aktarma hatası', detail: err.message });
  }
});

app.post('/api/lines/:id/assign', requireRole('it', 'admin'), async (req, res) => {
  try {
    const actor = currentUser(req)?.username || 'system';
    const line = await lineTools.assignLine(Number(req.params.id), { ...(req.body || {}), actor });
    res.json({ success: true, line });
  } catch (err) {
    console.error('[POST /api/lines/:id/assign]', err.message);
    res.status(400).json({ error: 'Hat atanamadı', detail: err.message });
  }
});

app.post('/api/lines/:id/release', requireRole('it', 'admin'), async (req, res) => {
  try {
    const actor = currentUser(req)?.username || 'system';
    const line = await lineTools.releaseLine(Number(req.params.id), { ...(req.body || {}), actor });
    res.json({ success: true, line });
  } catch (err) {
    console.error('[POST /api/lines/:id/release]', err.message);
    res.status(400).json({ error: 'Hat iade edilemedi', detail: err.message });
  }
});

// ─── Resmi Zimmet (assigned_to) — Devir Koruması ─────────────────────────────
const assignmentTools = require('./agent/tools/assignment-tools');

// Bir cihazın resmi zimmeti (kilitli owner) + telemetri (Baserow username) birlikte
app.get('/api/assets/:id/assignment', async (req, res) => {
  try {
    res.json({ assignment: await assignmentTools.getAssignment(req.params.id) || null });
  } catch (err) {
    res.status(500).json({ error: 'Zimmet sorgulanamadı', detail: err.message });
  }
});

// Resmi devir — zaten başkasına zimmetliyse force olmadan 409 (sessiz devralma engellenir)
app.post('/api/assets/:id/assign', requireRole('it', 'admin'), async (req, res) => {
  try {
    const by = currentUser(req)?.username || 'system';
    const { to, hostname, note, force } = req.body || {};
    const a = await assignmentTools.assign(req.params.id, { to, hostname, note, force: !!force, by });
    res.json({ success: true, assignment: a });
  } catch (err) {
    if (err.code === 'ALREADY_ASSIGNED') {
      return res.status(409).json({ error: err.message, code: 'ALREADY_ASSIGNED', current: err.current });
    }
    console.error('[POST /api/assets/:id/assign]', err.message);
    res.status(400).json({ error: 'Zimmet atanamadı', detail: err.message });
  }
});

app.post('/api/assets/:id/release', requireRole('it', 'admin'), async (req, res) => {
  try {
    const by = currentUser(req)?.username || 'system';
    const a = await assignmentTools.release(req.params.id, { by, note: (req.body || {}).note });
    res.json({ success: true, assignment: a });
  } catch (err) {
    res.status(400).json({ error: 'İade edilemedi', detail: err.message });
  }
});

// Telemetri ≠ resmi zimmet uyuşmazlıkları (izinsiz kullanım şüphesi)
app.get('/api/assignments/mismatches', async (req, res) => {
  try {
    const data = await getAllAssets({ size: 200 });
    res.json({ mismatches: await assignmentTools.listMismatches(data.results || []) });
  } catch (err) {
    res.status(500).json({ error: 'Uyuşmazlık taranamadı', detail: err.message });
  }
});

// ─── Ayarlar (runtime config store — admin) ──────────────────────────────────
const settingsTools = require('./agent/tools/settings-tools');

// Salt-okunur sistem durumu (sırlar GÖSTERİLMEZ — yalnız yapılandırıldı/yapılmadı).
function systemStatus() {
  const has = (v) => !!(v && String(v).trim());
  return {
    version: require('./package.json').version,
    node_env: process.env.NODE_ENV || 'development',
    database: { driver: dbLayer.driver() },
    auth_provider: (process.env.AUTH_PROVIDER || 'local'),
    ai: { provider: process.env.AI_PROVIDER || 'ollama' }, // model MÜŞTERİYE gösterilmez → sadece provider
    fx_provider: (process.env.FX_PROVIDER || 'live'),
    integrations: {
      baserow: has(process.env.BASEROW_API_TOKEN),
      anthropic_key: has(process.env.ANTHROPIC_API_KEY),
      n8n_notify: has(process.env.N8N_NOTIFY_WEBHOOK_URL),
      ldap: has(process.env.LDAP_URL) && (process.env.AUTH_PROVIDER === 'ldap'),
    },
    approval_ttl_hours: Math.round((Number(process.env.APPROVAL_TTL_MS) || 86400000) / 3600000),
    backup: (() => { try { return auditBackupStatus(); } catch { return null; } })(),
  };
}

app.get('/api/settings', requireRole('admin'), (req, res) => {
  res.json({ settings: settingsTools.getAll(), defaults: settingsTools.DEFAULTS, system: systemStatus() });
});

app.put('/api/settings/:section', requireRole('admin'), async (req, res) => {
  try {
    const actor = currentUser(req)?.username || 'admin';
    const merged = await settingsTools.setSection(req.params.section, req.body || {}, actor);
    res.json({ success: true, section: req.params.section, values: merged });
  } catch (err) {
    console.error('[PUT /api/settings]', err.message);
    res.status(400).json({ error: 'Ayar kaydedilemedi', detail: err.message });
  }
});

// ─── WORM Hardened Backup (bütünlük + kurtarma) ──────────────────────────────
app.get('/api/backup/status', (req, res) => {
  try {
    res.json(auditBackupStatus());
  } catch (err) {
    console.error('[GET /api/backup/status]', err.message);
    res.status(500).json({ error: 'Yedek durumu hatası', detail: err.message });
  }
});

app.post('/api/backup/restore', async (req, res) => {
  try {
    res.json({ success: true, ...(await restoreAuditFromBackup()) });
  } catch (err) {
    console.error('[POST /api/backup/restore]', err.message);
    res.status(400).json({ error: 'Geri yükleme hatası', detail: err.message });
  }
});

// Audit log oku (tüm/cihaz bazlı). ?serial= veya ?hostname= ile filtre, ?limit=
app.get('/api/lifecycle/log', (req, res) => {
  try {
    const { serial, hostname, limit } = req.query;
    if (serial || hostname) return res.json(getDeviceLog(serial || hostname));
    res.json(getLog({ limit: limit ? Number(limit) : 100 }));
  } catch (err) {
    console.error('[GET /api/lifecycle/log]', err.message);
    res.status(500).json({ error: 'Log okuma hatası', detail: err.message });
  }
});

// Yaşam döngüsü çelişki/zafiyet tespiti
app.get('/api/lifecycle/conflicts', async (req, res) => {
  try {
    res.json(await detectLifecycleConflicts());
  } catch (err) {
    console.error('[GET /api/lifecycle/conflicts]', err.message);
    res.status(500).json({ error: 'Çelişki tespiti hatası', detail: err.message });
  }
});

// Zincir bütünlüğü doğrula (tamper tespiti) + geçerli durum listesi
app.get('/api/lifecycle/verify', (req, res) => {
  try {
    res.json({ ...verifyChain(), states: LIFECYCLE_STATES, approvers: require('./auth/users').listApprovers(), requires_approval: [...REQUIRES_APPROVAL] });
    // not: approval_ttl_ms .env'den (APPROVAL_TTL_MS) ayarlanır
  } catch (err) {
    console.error('[GET /api/lifecycle/verify]', err.message);
    res.status(500).json({ error: 'Doğrulama hatası', detail: err.message });
  }
});

// ─── Bildirim (n8n webhook → mail/Telegram) ─────────────────────────────────

// Mevcut uyarı özetini önizle (gönderim yapmaz)
app.get('/api/notify/preview', async (req, res) => {
  try {
    const digest = await buildAlertDigest();
    res.json(digest);
  } catch (err) {
    console.error('[GET /api/notify/preview]', err.message);
    res.status(500).json({ error: 'Özet oluşturma hatası', detail: err.message });
  }
});

// Bildirimi şimdi gönder (zamanlayıcının da kullandığı fonksiyon). force=true → dedup atla
app.post('/api/notify/run', async (req, res) => {
  try {
    const force = !!(req.body && req.body.force);
    const result = await sendDigest({ force });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/notify/run]', err.message);
    res.status(500).json({ error: 'Bildirim gönderim hatası', detail: err.message });
  }
});

// ─── AI Chat ─────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { message, session_id = 'default' } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Mesaj boş olamaz' });
  }

  try {
    const history = sessions[session_id] || [];
    const { reply, updatedHistory } = await chat(message, history);
    sessions[session_id] = updatedHistory.slice(-20); // son 10 tur sakla

    res.json({ reply, session_id });
  } catch (err) {
    console.error('[POST /api/chat]', err.message);
    res.status(500).json({ error: 'AI yanıt hatası', detail: err.message });
  }
});

app.delete('/api/chat/:sessionId', (req, res) => {
  delete sessions[req.params.sessionId];
  res.json({ success: true });
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    baserow_configured: !!(process.env.BASEROW_API_TOKEN && process.env.BASEROW_TABLE_ID),
    ai_provider: provider,
    ai_model: provider === 'ollama'
      ? (process.env.OLLAMA_MODEL || 'llama3.1:8b')
      : (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'),
    ai_url: provider === 'ollama'
      ? (process.env.OLLAMA_URL || 'http://localhost:11434')
      : 'https://api.anthropic.com',
  });
});

// ─── SPA fallback ────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  if (!isAuthed(req)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Secrets sertleştirme: zayıf/varsayılan sırları denetle ──────────────────
function checkSecrets() {
  const DEFAULT = 'assetman-demo-secret-degistir';
  const isProd = process.env.NODE_ENV === 'production';
  const checks = [
    ['SESSION_SECRET', process.env.SESSION_SECRET],
    ['CHAIN_SECRET', process.env.CHAIN_SECRET || process.env.SESSION_SECRET],
    ['WORM_SECRET', process.env.WORM_SECRET || process.env.SESSION_SECRET],
  ];
  const weak = [];
  for (const [name, val] of checks) {
    if (!val || val === DEFAULT || String(val).length < 32) weak.push(name);
  }
  if (weak.length) {
    const msg = `[GÜVENLİK] Zayıf/varsayılan sır: ${weak.join(', ')} — en az 32 karakter, benzersiz olmalı.`;
    if (isProd) {
      console.error(msg + ' PRODUCTION modunda başlatma REDDEDİLDİ. .env değerlerini düzeltin.');
      process.exit(1);
    }
    console.warn(msg + ' (development modunda izin verildi — PRODUCTION öncesi mutlaka değiştirin.)');
  } else {
    console.log('[GÜVENLİK] Sır kontrolü geçti (SESSION/CHAIN/WORM güçlü).');
  }
}

initDataLayer().then(() => app.listen(PORT, () => {
  console.log(`\n  AI Asset Management`);
  console.log(`  Server: http://localhost:${PORT}`);
  console.log(`  API:    http://localhost:${PORT}/api/health\n`);
  checkSecrets();
  startNotifyScheduler();
  // Onay TTL aşımı tarayıcısı: süresi dolan pending talepleri 'expired' (güvenlik ihlali) yapar
  setInterval(async () => {
    try {
      const expired = await expirePendingRequests();
      if (expired.length) {
        console.log(`[lifecycle] ${expired.length} onay talebi süresi doldu → güvenlik ihlali`);
        // force:false → dedup'a saygılı (aynı uyarı kümesi tekrar gönderilmez)
        sendDigest({ force: false }).catch(e => console.error('[lifecycle expiry notify]', e.message));
      }
    } catch (e) { console.error('[lifecycle expiry]', e.message); }
  }, 60 * 1000); // dakikada bir kontrol
  // Network Discovery Agent: karantina cihazları ağda aktif mi? (canlı tarama + anlık alarm)
  startDiscoveryScheduler(sendDigest, 90 * 1000);
})).catch(err => { console.error('[boot] initDataLayer başarısız:', err.message); process.exit(1); });
