/* dotenv: override YOK (bilinçli). .env yalnızca TANIMSIZ değişkenleri
   doldurur; gerçek ortam değişkenleri (docker compose `environment`, CI, shell)
   .env'i EZER — 12-factor sırası budur.

   Önceden override:true idi ve .env gerçek ortamı eziyordu. Sonucu: compose
   `NODE_ENV: production` veriyordu ama imajdaki .env'de NODE_ENV=development
   yazdığı için CANLI SUNUCU development modunda çalışıyordu — zayıf sır
   denetimi devre dışıydı ve demo tohum verisine izin veriliyordu. */
require('dotenv').config();
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
  // Günlük anlık görüntü: trend hesabının TEK gerçek kaynağı. Geçmiş yoksa
  // created_on'dan yalnız TOPLAM geriye doldurulur (durum kırılımı türetilemez).
  try {
    const snap = require('./agent/tools/snapshot-tools');
    const inv = await getAllAssets({ size: 200 });
    const assets = inv.results || [];
    const bf = await snap.backfillTotals(assets);
    if (!bf.skipped && bf.count) console.log('[snapshot] geriye dolduruldu:', bf.count, 'gün');
    const st = await getStats();
    const locs = new Set(assets.map(a => (a.location || '').trim()).filter(Boolean));
    await snap.writeSnapshot(st, locs.size, 'scheduler');
    // Günde bir tazele (uzun ömürlü süreçlerde gün dönümünü yakalar)
    setInterval(async () => {
      try {
        const s2 = await getStats();
        const a2 = await getAllAssets({ size: 200 });
        const l2 = new Set((a2.results || []).map(a => (a.location || '').trim()).filter(Boolean));
        await snap.writeSnapshot(s2, l2.size, 'scheduler');
      } catch (e) { console.error('[snapshot] periyodik yazma hatası:', e.message); }
    }, 6 * 60 * 60 * 1000).unref?.();
  } catch (e) { console.error('[snapshot] başlangıç hatası:', e.message); }

  console.log('[db] Katman hazır — driver:', dbLayer.driver(), '| kullanıcı:', usersModule.all().length);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const htmlInclude = require('./lib/html-include');
const { getAllAssets, getStats, createAsset, updateAsset, getAssetBySerial } = require('./agent/tools/baserow-tools');
const { getAllLicenses, bulkUpsertLicenses, getLicenseStats } = require('./agent/tools/license-tools');
const { detectAnomalies, detectOfflineDevices, detectLicenseCompliance, detectShadowIT, detectEolOs, detectWarranty } = require('./agent/tools/anomaly-tools');
const { sendDigest, buildAlertDigest, startNotifyScheduler } = require('./agent/tools/notify-tools');
const { getLog, getDeviceLog, verifyChain, detectLifecycleConflicts, LIFECYCLE_STATES, ALERT_ON_RECORD, REQUIRES_APPROVAL, APPROVERS, submitChange, approveByToken, renewRequest, expirePendingRequests, auditBackupStatus, restoreAuditFromBackup } = require('./agent/tools/lifecycle-tools');
const { scanNetwork, startDiscoveryScheduler } = require('./agent/tools/network-discovery');
const { computeRiskScores, computeRenewalForecast } = require('./agent/tools/insight-tools');
const QRCode = require('qrcode');
const { chat } = require('./agent/claude-agent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Model görselleri base64 data URL olarak gelir (2 MB dosya ≈ 2.7 MB gövde).
// Dış dosya yükleme servisi/multipart bağımlılığı eklemek yerine bu yol seçildi.
// verify: ham gövde saklanır — collector imzası gövde ÖZETİNİ kapsıyor,
// JSON'u yeniden dizmek (key sırası/boşluk) özeti değiştirip imzayı bozardı.
app.use(express.json({ limit: '4mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
// Klasik form gönderimi: JS'i çalışmayan/eski tarayıcılarda (bazı TV/kiosk
// tarayıcıları) giriş yine de tamamlanabilsin diye.
app.use(express.urlencoded({ extended: false }));
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
const { createLoginRateLimit } = require('./auth/login-rate-limit');
const loginGuard = createLoginRateLimit();
const loginFailed    = (req) => loginGuard.fail(loginGuard.clientIp(req));
const loginSucceeded = (req) => loginGuard.succeed(loginGuard.clientIp(req));

function loginRateLimit(req, res, next) {
  const retryAfter = loginGuard.blockedFor(loginGuard.clientIp(req));
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    if (wantsHtml(req)) return res.redirect('/login?err=3&s=' + retryAfter);
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

const SESSION_MS  = 8 * 60 * 60 * 1000;       // 8 saat (varsayılan oturum)
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün ("Beni hatırla" işaretliyse)
const COOKIE_NAME = 'am_session';

// SESSION_SECRET zorunlu/güçlü olmalı — sertleştirme app.listen'de doğrulanır.
const AUTH_SECRET = process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signPart(part) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(part).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makeToken(user, ttlMs = SESSION_MS) {
  const payload = b64u(JSON.stringify({ u: user.username, r: user.role, exp: Date.now() + ttlMs }));
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
      loginSucceeded(req);   // başarılı giriş kilit sayacını sıfırlar
      // "Beni hatırla": token exp'i ve cookie ömrü birlikte uzar (yalnız biri yetmez).
      const ttl = (req.body && req.body.remember) ? REMEMBER_MS : SESSION_MS;
      res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${makeToken(user, ttl)}; HttpOnly; Path=/; Max-Age=${ttl / 1000}; SameSite=Lax`);
      // Form gönderimi (JS yok/bozuk) → yönlendir; XHR/fetch → JSON döndür.
      if (wantsHtml(req)) return res.redirect(safeNext(req.body && req.body.next));
      return res.json({ success: true, user: { username: user.username, display: user.display, role: user.role } });
    }
    loginFailed(req);        // yalnız BAŞARISIZ deneme sayılır
    if (wantsHtml(req)) return res.redirect('/login?err=1');
    return res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı' });
  } catch (err) {
    console.error('[POST /api/login]', err.message);
    if (wantsHtml(req)) return res.redirect('/login?err=2');
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

/* İstek tarayıcı sayfa gezintisi mi (form POST), yoksa fetch/XHR mi?
   Form gönderiminde JSON değil YÖNLENDİRME döneriz. */
function wantsHtml(req) {
  if (req.get('X-Requested-With')) return false;
  const ct = String(req.get('Content-Type') || '');
  if (ct.includes('application/json')) return false;
  return String(req.get('Accept') || '').includes('text/html');
}

/* Açık yönlendirme (open redirect) koruması: yalnız site içi tek eğik çizgili
   yol; /login'e geri dönüş engellenir (sonsuz döngü olurdu). */
function safeNext(n) {
  const v = String(n || '');
  if (v.charAt(0) === '/' && v.charAt(1) !== '/' && v.indexOf('/login') !== 0) return v;
  return '/';
}

// Login sayfası (public). Zaten girişliyse panele yönlendir.
app.get('/login', (req, res) => {
  if (isAuthed(req)) {
    const next = req.query.next;
    return res.redirect(next && String(next).startsWith('/') ? String(next) : '/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

/* --- Route sarmalayici ------------------------------------------------------
   88 route'un buyuk kismi ayni uc satiri tekrarliyordu: try/catch,
   console.error, res.status(500).json({error, detail}). Hata cevirisi
   route'un isi degil (SRP): route is mantigini calistirir, hatayi bu
   sarmalayici cevirir.

   Davranis AYNEN korunur - mesaj metni her route'a ozel kalir, gunluk satiri
   ayni bicimde basilir. Yalnizca tekrar kalkar.

   Yanit zaten gonderilmisse ikinci kez yazilmaz: aksi halde "headers already
   sent" hatasi asil hatayi gizlerdi. */
function rota(mesaj, isleyici) {
  return async (req, res, next) => {
    try {
      await isleyici(req, res, next);
    } catch (err) {
      console.error(`[${req.method} ${req.baseUrl || ''}${req.path}]`, err.message);
      if (res.headersSent) return;
      res.status(500).json({ error: mesaj, detail: err.message });
    }
  };
}

/* --- Route sarmalayici ------------------------------------------------------
   88 route'un buyuk kismi ayni uc satiri tekrarliyordu: try/catch,
   console.error, res.status(500).json({error, detail}). Hata cevirisi
   route'un isi degil (SRP): route is mantigini calistirir, hatayi bu
   sarmalayici cevirir.

   Davranis AYNEN korunur - mesaj metni her route'a ozel kalir, gunluk satiri
   ayni bicimde basilir. Yalnizca tekrar kalkar.

   Yanit zaten gonderilmisse ikinci kez yazilmaz: aksi halde "headers already
   sent" hatasi asil hatayi gizlerdi. */
function rota(mesaj, isleyici) {
  return async (req, res, next) => {
    try {
      await isleyici(req, res, next);
    } catch (err) {
      console.error(`[${req.method} ${req.baseUrl || ''}${req.path}]`, err.message);
      if (res.headersSent) return;
      res.status(500).json({ error: mesaj, detail: err.message });
    }
  };
}

// Panel giriş noktalarını koru
function requirePage(req, res, next) {
  if (isAuthed(req)) return next();
  return res.redirect('/login');
}
/* Panel HTML'i parçalardan birleştirilir (public/parts/**). Tek dosya 2300
   satıra ulaşmıştı; görünümler ve modallar ayrıldı. Birleştirme sunucuda ve
   tek noktada yapılır, istemci tarafında hiçbir şey değişmez.
   Parça okunamazsa 500 döneriz: yarım bir panel göstermek, açılmayan bir
   panelden daha kötü — eksik görünüm sessizce kaybolurdu. */
const PANEL_HTML = path.join(__dirname, 'public', 'index.html');
function panelGonder(res) {
  try {
    res.type('html').send(htmlInclude.birlestir(PANEL_HTML));
  } catch (err) {
    console.error('[panel] HTML birleştirilemedi:', err.message);
    res.status(500).send('Panel yüklenemedi. Sunucu günlüğüne bakın.');
  }
}

app.get(['/', '/index.html'], requirePage, (req, res) => panelGonder(res));

// API koruması: allowlist dışındaki tüm /api yolları oturum ister.
// Public: client scriptler ve telefon QR kaydı login olamaz.
/* '/register' burada KALIYOR ama artik imzali QR JETONU zorunlu (bkz.
   agent/tools/register-token.js) — telefon oturum acamiyor, jeton onun yerine
   geciyor. '/register/bulk' LISTEDEN CIKARILDI: yalnizca girisli panelden
   cagriliyor, public olmasi icin hicbir sebep yoktu. */
const PUBLIC_API = new Set(['/login', '/logout', '/health', '/webhook', '/register', '/licenses/sync', '/qr', '/lifecycle/approve', '/register/bulk/confirm']);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path)) return next();
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Oturum gerekli', code: 'UNAUTHORIZED' });
});

/* HTML parçaları TEK BAŞINA servis edilmez: bunlar panelin gövde parçaları,
   ayrı bir sayfa değil. Doğrudan istenirse 404 döner. */
app.use('/parts', (req, res) => res.status(404).end());

// Statik dosyalar (css/js/fontlar/register.html/login.html). index:false → '/' otomatik index.html servis etmez.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Assets ──────────────────────────────────────────────────────────────────

app.get('/api/assets', rota('Baserow veri çekme hatası', async (req, res) => {
  const { filter_field, filter_value, page = 1, size = 200 } = req.query;
  const data = await getAllAssets({ page: Number(page), size: Number(size), filterField: filter_field, filterValue: filter_value });
  res.json(data);
}));

app.get('/api/stats', rota('İstatistik hesaplama hatası', async (req, res) => {
  const stats = await getStats();
  res.json(stats);
}));

// ─── Webhook (n8n veya direkt client script) ─────────────────────────────────

app.post('/api/webhook', rota('Webhook işleme hatası', async (req, res) => {
  /* KİMLİK DOĞRULAMA — envanteri yazan tek public uç burası. İmzasız istek
     kabul edilirse adresi bilen herkes sahte cihaz açar veya mevcut cihazın
     verisini ezer; üzerine kurulu tüm tespitler (shadow IT, zimmet
     uyuşmazlığı, EOL) yanılır. Bkz. agent/tools/agent-auth.js */
  const agentAuth = require('./agent/tools/agent-auth');
  const kimlik = await agentAuth.verifyRequest(req);
  if (!kimlik.ok) {
    console.warn(`[WEBHOOK REDDEDİLDİ] ${kimlik.code} — ${kimlik.reason}` +
      (kimlik.deviceId ? ` (cihaz: ${kimlik.deviceId})` : '') +
      ` ip=${(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()}`);
    return res.status(401).json({ error: kimlik.reason, code: kimlik.code });
  }
  if (kimlik.imzasiz) {
    console.warn('[WEBHOOK] İmzasız istek kabul edildi (WEBHOOK_AUTH=' + agentAuth.mode() + '). ' +
      'Üretimde "required" olmalı.');
  }

  const payload = req.body;

  if (!payload.serial_number && !payload.hostname) {
    return res.status(400).json({ error: 'serial_number veya hostname zorunludur' });
  }

  // GÜVENLİK: lokasyon token ile doğrulanır. Token yapılandırılmışsa payload'daki
  // location metnine GÜVENİLMEZ — token'ın eşlendiği ad kullanılır (bkz location-tools).
  const locTools = require('./agent/tools/location-tools');
  const loc = locTools.resolveLocation({
    token: req.get('X-Location-Token'),
    payloadLocation: payload.location,
  });
  if (loc.error) return res.status(401).json({ error: loc.error, code: loc.code });

  const enriched = {
    ...payload,
    last_seen: new Date().toISOString(),
    status: 'online',
  };
  if (loc.location) enriched.location = loc.location;
  else delete enriched.location;

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

  const locationChanged = await trackLocation(result.id, enriched, loc.location, loc.source);

  /* Canlı ölçümler ve güvenlik durumu envanter satırına DEĞİL ayrı tablolara
     yazılır (grafik için geçmiş gerekiyor, envanterde cihaz başına tek satır
     var). Collector göndermiyorsa sessizce atlanır — eski sürüm collector'lar
     çalışmaya devam etsin. */
  const tele = require('./agent/tools/telemetry-tools');
  if (payload.telemetry) {
    try { await tele.recordTelemetry(result.id, payload.telemetry); }
    catch (e) { console.warn('[TELEMETRİ] kaydedilemedi:', e.message); }
  }
  if (payload.security) {
    try { await tele.recordSecurity(result.id, payload.security); }
    catch (e) { console.warn('[GÜVENLİK] kaydedilemedi:', e.message); }
  }

  // Kayıtlı cihazı envanter satırıyla eşle (teşhis ve iptal için gerekiyor)
  if (kimlik.deviceId) {
    try {
      await agentAuth.touch(kimlik.deviceId, {
        asset_id: result.id,
        serial_number: enriched.serial_number || payload.serial_number,
      });
    } catch (e) {
      // Kayıt izi ve klon tespiti kritik yol değil — webhook'u düşürmüyoruz.
      // Ama SESSİZ yutmak da yanlış: migration geride kalmışsa klon tespiti
      // hiç çalışmaz ve kimse fark etmez.
      console.warn('[AGENT] Kayıt izi güncellenemedi:', e.message);
    }
  }

  res.json({
    success: true, action: existing ? 'updated' : 'created', id: result.id,
    ...(locationChanged ? { location_changed: { from: locationChanged.from, to: locationChanged.to } } : {}),
    /* Cihaza özel sır YALNIZ ilk kayıtta, YALNIZ bir kez döner. Collector
       bunu diske yazar; bundan sonra paylaşılan anahtar bu cihaz için
       çalışmaz. Sunucu sırrı tekrar göndermez — kaybedilirse kayıt sıfırlanır. */
    ...(kimlik.yeniKayit ? {
      enrollment: {
        device_id: kimlik.deviceId,
        secret: kimlik.enrollment.secret,
        note: 'Bu sırrı sakla. Bir daha gönderilmeyecek.',
      },
    } : {}),
  });
}));

/* ─── Collector cihaz kayıtları (admin) ─────────────────────────────────────
   Cihaz yeniden kurulduğunda sırrı kaybolur ve paylaşılan anahtarla yeniden
   kaydolamaz (bilinçli). Yönetici kaydı silerse cihaz temiz bir kayıt açar. */
app.get('/api/agents', requireRole('admin'), async (req, res) => {
  try {
    const a = require('./agent/tools/agent-auth');
    res.json({ mode: a.mode(), secret_configured: !!a.sharedSecret(), results: await a.listEnrollments() });
  } catch (err) {
    res.status(500).json({ error: 'Kayıtlar alınamadı', detail: err.message });
  }
});

app.delete('/api/agents/:deviceId', requireRole('admin'), async (req, res) => {
  try {
    const n = await require('./agent/tools/agent-auth').revoke(req.params.deviceId);
    console.warn(`[AGENT] Kayıt silindi: ${req.params.deviceId} (silen: ${currentUser(req)?.username})`);
    res.json({ success: true, deleted: n });
  } catch (err) {
    res.status(500).json({ error: 'Kayıt silinemedi', detail: err.message });
  }
});

/* Toplu kayıt isimlendirme planı agent/tools/bulk-plan.js'te: hem önizleme
   hem oluşturma AYNI hesabı kullanmalı, yoksa panelde gösterilen ID aralığı
   ile gerçekte oluşan kayıtlar ayrışır. Birim testi de artık bu gerçek
   fonksiyonu çağırıyor. */
const { bulkPlan: bulkPlanHesapla } = require('./agent/tools/bulk-plan');
const bulkPlan = (girdi) => bulkPlanHesapla(girdi, getAllAssets);

// ─── QR ile Cihaz Kaydı ───────────────────────────────────────────────────────
// Route'lar routes/register.js'e taşındı (13 uç: QR, jeton yaşam döngüsü, toplu kayıt).
app.use('/api', require('./routes/register')({
  rota, requireRole, currentUser,
  getAllAssets, createAsset, updateAsset, getAssetBySerial,
  lifecycleModule, bulkPlan,
}));

/* HTML sayfa route'ları — router'a TAŞINMADI: router '/api' altına bağlı,
   oraya konsalardı URL'leri /api/register olur ve cihaz kayıt ucuyla
   çakışırdı. Bunlar kök yoldan servis edilen sayfalar. */

// Mobil kayıt sayfası (QR ile açılır)
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

/* Toplu kayıt onay sayfası — telefonda oturum AÇMADAN açılır, jetonla
   korunur (bkz. agent/tools/bulk-token.js). */
app.get('/bulk-confirm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bulk-confirm.html'));
});

// ─── Lisanslar ────────────────────────────────────────────────────────────────

app.get('/api/licenses', rota('Lisans verisi çekme hatası', async (req, res) => {
  const { filter_field, filter_value, page = 1, size = 200 } = req.query;
  const data = await getAllLicenses({ page: Number(page), size: Number(size), filterField: filter_field, filterValue: filter_value });
  res.json(data);
}));

app.get('/api/licenses/stats', rota('Lisans istatistik hatası', async (req, res) => {
  const stats = await getLicenseStats();
  res.json(stats);
}));

// Bir bilgisayardan gelen tüm yazılım listesini upsert eder
app.post('/api/licenses/sync', rota('Lisans sync hatası', async (req, res) => {
  // Webhook ile AYNI koruma: bu uç da kimlik doğrulamasız yazma noktasıydı.
  // Yalnız webhook'u kapatmak yarım çözüm olurdu — saldırgan lisans/yazılım
  // envanterini kirletip uyum raporlarını yanıltabilirdi.
  const agentAuth = require('./agent/tools/agent-auth');
  const kimlik = await agentAuth.verifyRequest(req);
  if (!kimlik.ok) {
    console.warn(`[LİSANS REDDEDİLDİ] ${kimlik.code} — ${kimlik.reason}` +
      (kimlik.deviceId ? ` (cihaz: ${kimlik.deviceId})` : ''));
    return res.status(401).json({ error: kimlik.reason, code: kimlik.code });
  }

  const { hostname, serial_number, username, location, software } = req.body;
  if (!hostname || !Array.isArray(software)) {
    return res.status(400).json({ error: 'hostname ve software[] zorunludur' });
  }

  const results = await bulkUpsertLicenses({ hostname, serial_number, username, location, software });

  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action === 'updated').length;
  console.log(`[LICENSES] ${hostname}: ${created} eklendi, ${updated} güncellendi`);
  res.json({ success: true, created, updated, total: results.length });
}));

// ─── Anomali & Uyarı Sistemi (deterministik, LLM'siz) ───────────────────────

app.get('/api/anomalies', rota('Anomali tespiti hatası', async (req, res) => {
  const result = await detectAnomalies();
  res.json(result);
}));

app.get('/api/alerts/offline', rota('Çevrimdışı tespiti hatası', async (req, res) => {
  const result = await detectOfflineDevices();
  res.json(result);
}));

app.get('/api/licenses/compliance', rota('Lisans uyum raporu hatası', async (req, res) => {
  const result = await detectLicenseCompliance();
  res.json(result);
}));

app.get('/api/shadow-it', rota('Shadow IT tespiti hatası', async (req, res) => {
  const result = await detectShadowIT();
  res.json(result);
}));

app.get('/api/eol-os', rota('EOL işletim sistemi tespiti hatası', async (req, res) => {
  const result = await detectEolOs();
  res.json(result);
}));

app.get('/api/warranty', rota('Garanti takibi hatası', async (req, res) => {
  const result = await detectWarranty();
  res.json(result);
}));

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
app.get('/api/network/scan', rota('Ağ tarama hatası', async (req, res) => {
  res.json(await scanNetwork());
}));

// SNMP ağ keşfi — switch/firewall/AP/yazıcıları SNMP'yle bulup envantere yazar (it/admin)
const snmpDiscovery = require('./agent/tools/snmp-discovery');
app.post('/api/network/snmp-scan', requireRole('it', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const opts = {};
    if (Array.isArray(body.subnets) && body.subnets.length) opts.subnets = body.subnets;
    res.json(await snmpDiscovery.runDiscovery(opts));
  } catch (err) {
    console.error('[POST /api/network/snmp-scan]', err.message);
    res.status(400).json({ error: 'SNMP keşif hatası', detail: err.message });
  }
});

// ─── Rapor yönetici yorumu (LLM) ────────────────────────────────────────────
// Bulgular SUNUCUDA hesaplanır; istemciden sayı KABUL EDİLMEZ. Aksi hâlde
// tarayıcıdan uydurma rakam gönderip modele onu yorumlatmak mümkün olurdu.
const reportAi = require('./agent/report-ai');

app.post('/api/reports/ai-comment', rota('Yorum üretilemedi', async (req, res) => {
  const [risk, anomali, eol, garanti, stats, envanter] = await Promise.all([
    computeRiskScores(), detectAnomalies(), detectEolOs(), detectWarranty(),
    getStats(), getAllAssets({ size: 200 }),
  ]);
  const varliklar = envanter.results || [];
  const bulgular = {
    toplam: stats.total || 0,
    aktif: stats.by_status?.online || 0,
    kritik: risk.distribution?.critical || 0,
    yuksek: risk.distribution?.high || 0,
    ortalamaRisk: risk.average_score || 0,
    garantiDisi: garanti.expired?.count || 0,
    garantiYakin: garanti.expiring_soon?.count || 0,
    eol: eol.eol?.count || 0,
    dusukRam: anomali.low_ram?.count || 0,
    dusukDisk: anomali.low_disk?.count || 0,
    uzunUptime: anomali.long_uptime?.count || 0,
    lokasyonsuz: varliklar.filter((a) => !String(a.location || '').trim()).length,
    enRiskli: (risk.items || []).slice(0, 3).map((c) => ({ hostname: c.hostname, score: c.score })),
  };
  const yorum = await reportAi.raporYorumu(bulgular);
  res.json({ metin: yorum.metin, kaynak: yorum.kaynak });   // model adı DÖNMEZ
}));

// ─── Risk Skoru & Yenileme/Maliyet Öngörüsü ─────────────────────────────────
app.get('/api/risk-scores', rota('Risk skoru hesaplama hatası', async (req, res) => {
  res.json(await computeRiskScores());
}));

app.get('/api/forecast', rota('Öngörü hesaplama hatası', async (req, res) => {
  res.json(await computeRenewalForecast());
}));

// ─── Turkcell Hat / SIM Envanteri ────────────────────────────────────────────
// Route'lar routes/lines.js'e taşındı; server.js yalnızca bağlantıyı bilir.
app.use('/api/lines', require('./routes/lines')({ rota, requireRole, currentUser }));

/* assignmentTools burada DA gerekli: varlık detayı ucu zimmeti aynı yanıtta
   döndürüyor (cihaz başına ikinci istek N+1 olurdu). Router kendi require'ını
   yapıyor; Node modülü önbelleğe aldığı için iki import aynı örneği verir. */
const assignmentTools = require('./agent/tools/assignment-tools');

// ─── Resmi Zimmet (assigned_to) — Devir Koruması ─────────────────────────────
// Route'lar routes/assignments.js'e taşındı.
app.use('/api', require('./routes/assignments')({ requireRole, currentUser, getAllAssets }));

// ─── Lokasyon İzleme ─────────────────────────────────────────────────────────
// Beklenen (resmi) lokasyon KİLİTLİ: yalnız buradan değişir, PUBLIC webhook dokunmaz.
// Görülen lokasyon telemetriden gelir; ikisi eşikten uzun süre farklıysa sapma uyarısı.
const locationTools = require('./agent/tools/location-tools');

app.get('/api/assets/:id/location', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [expected, current, history] = await Promise.all([
      locationTools.getExpected(id),
      locationTools.getCurrentStay(id),
      locationTools.getHistory(id, 30),
    ]);
    res.json({ expected: expected || null, current: current || null, history });
  } catch (err) {
    res.status(500).json({ error: 'Lokasyon bilgisi alınamadı', detail: err.message });
  }
});

app.put('/api/assets/:id/expected-location', requireRole('it', 'admin'), async (req, res) => {
  try {
    const { location, hostname, note } = req.body || {};
    const me = currentUser(req);
    const row = await locationTools.setExpected(req.params.id, {
      location, hostname: hostname || null, note: note || null,
      by: me ? me.username : 'system',
    });
    res.json({ success: true, expected: row });
  } catch (err) {
    res.status(400).json({ error: 'Beklenen lokasyon kaydedilemedi', detail: err.message });
  }
});

app.delete('/api/assets/:id/expected-location', requireRole('it', 'admin'), async (req, res) => {
  try {
    await locationTools.clearExpected(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Beklenen lokasyon silinemedi', detail: err.message });
  }
});

// Lokasyon sapması: beklenen ≠ görülen ve eşik günden uzun süredir öyle
app.get('/api/location-drift', async (req, res) => {
  try {
    const data = await getAllAssets({ size: 200 });
    res.json(await locationTools.detectLocationDrift(data.results || []));
  } catch (err) {
    res.status(500).json({ error: 'Lokasyon sapması taranamadı', detail: err.message });
  }
});

// Trend: N gün öncesine göre değişim + sparkline serisi (gerçek anlık görüntülerden)
app.get('/api/trends', async (req, res) => {
  try {
    const snap = require('./agent/tools/snapshot-tools');
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
    const [stats, inv] = await Promise.all([getStats(), getAllAssets({ size: 200 })]);
    const locs = new Set((inv.results || []).map(a => (a.location || '').trim()).filter(Boolean));
    const current = {
      total: stats.total || 0,
      online: stats.by_status?.online || 0,
      offline: stats.by_status?.offline || 0,
      depoda: stats.by_status?.depoda || 0,
      locations: locs.size,
    };
    const [trends, series, sOnline, sOffline, sDepoda] = await Promise.all([
      snap.getTrends(current, days),
      snap.getSeries('total', days),
      snap.getSeries('online', days),
      snap.getSeries('offline', days),
      snap.getSeries('depoda', days),
    ]);
    res.json({ current, trends, series, series_online: sOnline, series_offline: sOffline, series_depoda: sDepoda });
  } catch (err) {
    res.status(500).json({ error: 'Trend alınamadı', detail: err.message });
  }
});

// ─── Varlık Detayı: ek alanlar + model görselleri ────────────────────────────
const detailTools = require('./agent/tools/asset-detail-tools');

// Model görselleri statik servis edilir (kendi sunucumuzdan — dış CDN yok)
app.use('/device-images', express.static(detailTools.IMG_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

// Tek varlığın tüm detayı: envanter + ek alanlar + zimmet + lokasyon + görsel
app.get('/api/assets/:id/detail', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [inv, detail, images, asg, exp, stay] = await Promise.all([
      getAllAssets({ size: 200 }),
      detailTools.getDetail(id),
      detailTools.listImages(),
      assignmentTools.getAssignment(id).catch(() => null),
      locationTools.getExpected(id).catch(() => null),
      locationTools.getCurrentStay(id).catch(() => null),
    ]);
    const asset = (inv.results || []).find(a => String(a.id) === String(id));
    if (!asset) return res.status(404).json({ error: 'Varlık bulunamadı' });
    const img = detailTools.matchImage(images, asset);
    res.json({
      asset,
      detail: detail || null,
      usage: detailTools.kullanimSuresi(detail && detail.purchase_date),
      image: img ? { url: '/device-images/' + img.file, match: img.model_key ? 'model' : (img.brand_key ? 'marka' : 'kategori') } : null,
      assignment: asg || null,
      expected_location: exp || null,
      current_stay: stay || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Detay alınamadı', detail: err.message });
  }
});

/* Canlı telemetri + güvenlik durumu. Detay uç noktasından AYRI tutuldu:
   sekme açılmadan bu veriyi çekmenin anlamı yok ve seri sorgusu daha pahalı. */
app.get('/api/assets/:id/telemetry', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tele = require('./agent/tools/telemetry-tools');
    const saat = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
    const [latest, series, security] = await Promise.all([
      tele.getLatest(id), tele.getSeries(id, { saat }), tele.getSecurity(id),
    ]);
    res.json({
      latest: latest || null,
      series: series || [],
      security: security || null,
      retention_days: tele.SAKLAMA_GUN,
    });
  } catch (err) {
    res.status(500).json({ error: 'Telemetri alınamadı', detail: err.message });
  }
});

app.put('/api/assets/:id/detail', requireRole('it', 'admin'), async (req, res) => {
  try {
    const me = currentUser(req);
    const row = await detailTools.setDetail(req.params.id, req.body || {}, me ? me.username : 'system');
    res.json({ success: true, detail: row });
  } catch (err) {
    res.status(400).json({ error: 'Kaydedilemedi', detail: err.message });
  }
});

// ─── Model görselleri ────────────────────────────────────────────────────────
app.get('/api/device-images', async (req, res) => {
  try {
    const [rows, inv] = await Promise.all([detailTools.listImages(), getAllAssets({ size: 200 })]);
    // Envanterdeki benzersiz marka+model listesi — hangi modele görsel eksik, görünsün
    const modeller = {};
    (inv.results || []).forEach(a => {
      const k = detailTools.normKey(a.brand) + '|' + detailTools.normKey(a.model);
      if (!modeller[k]) modeller[k] = {
        brand: a.brand || '', model: a.model || '', category: a.category || 'Diğer', count: 0,
      };
      modeller[k].count++;
    });
    const liste = Object.values(modeller).map(m => ({
      ...m,
      image: (() => {
        const i = detailTools.matchImage(rows, m);
        return i ? { id: i.id, url: '/device-images/' + i.file, match: i.model_key ? 'model' : (i.brand_key ? 'marka' : 'kategori') } : null;
      })(),
    })).sort((a, b) => b.count - a.count);
    res.json({ images: rows.map(r => ({ ...r, url: '/device-images/' + r.file })), models: liste });
  } catch (err) {
    res.status(500).json({ error: 'Görseller alınamadı', detail: err.message });
  }
});

app.post('/api/device-images', requireRole('it', 'admin'), async (req, res) => {
  try {
    const me = currentUser(req);
    const row = await detailTools.saveImage({ ...(req.body || {}), by: me ? me.username : 'system' });
    res.json({ success: true, image: { ...row, url: '/device-images/' + row.file } });
  } catch (err) {
    res.status(400).json({ error: 'Görsel kaydedilemedi', detail: err.message });
  }
});

app.delete('/api/device-images/:id', requireRole('it', 'admin'), async (req, res) => {
  try {
    const ok = await detailTools.deleteImage(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    res.status(400).json({ error: 'Silinemedi', detail: err.message });
  }
});

// Lokasyon koordinatları — routes/locations-geo.js'e taşındı.
app.use('/api/locations', require('./routes/locations-geo')({ requireRole, currentUser, getAllAssets }));

// Dashboard lokasyon özeti (kova sayıları + şiddet dağılımı + lokasyon başına adet)
app.get('/api/location-summary', async (req, res) => {
  try {
    const data = await getAllAssets({ size: 200 });
    res.json(await locationTools.getLocationSummary(data.results || []));
  } catch (err) {
    res.status(500).json({ error: 'Lokasyon özeti alınamadı', detail: err.message });
  }
});

// İlk kurulum: mevcut envanter lokasyonlarını "beklenen" olarak tohumla (tablo boşsa)
app.post('/api/location-drift/seed', requireRole('admin'), async (req, res) => {
  try {
    const data = await getAllAssets({ size: 200 });
    res.json(await locationTools.seedExpectedFromAssets(data.results || []));
  } catch (err) {
    res.status(500).json({ error: 'Tohumlama başarısız', detail: err.message });
  }
});

// ─── Kullanıcı Yönetimi (admin) ──────────────────────────────────────────────
// Route'lar routes/users.js'e taşındı.
app.use('/api/users', require('./routes/users')({ requireRole, currentUser }));

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
      // Yalnız BOOLEAN — token'ların kendisi ASLA dışa verilmez.
      location_tokens: locationTools.tokensConfigured(),
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
app.get('/api/lifecycle/conflicts', rota('Çelişki tespiti hatası', async (req, res) => {
  res.json(await detectLifecycleConflicts());
}));

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
app.get('/api/notify/preview', rota('Özet oluşturma hatası', async (req, res) => {
  const digest = await buildAlertDigest();
  res.json(digest);
}));

// Bildirimi şimdi gönder (zamanlayıcının da kullandığı fonksiyon). force=true → dedup atla
app.post('/api/notify/run', rota('Bildirim gönderim hatası', async (req, res) => {
  const force = !!(req.body && req.body.force);
  const result = await sendDigest({ force });
  res.json(result);
}));

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
  panelGonder(res);
});

// ─── Secrets sertleştirme: zayıf/varsayılan sırları denetle ──────────────────
function checkSecrets() {
  const DEFAULT = 'assetman-demo-secret-degistir';
  const isProd = process.env.NODE_ENV === 'production';
  const checks = [
    ['SESSION_SECRET', process.env.SESSION_SECRET],
    ['CHAIN_SECRET', process.env.CHAIN_SECRET || process.env.SESSION_SECRET],
    ['WORM_SECRET', process.env.WORM_SECRET || process.env.SESSION_SECRET],
    ['AGENT_SECRET', process.env.AGENT_SECRET],
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
    console.log('[GÜVENLİK] Sır kontrolü geçti (SESSION/CHAIN/WORM/AGENT güçlü).');
  }

  /* Webhook kimlik doğrulama modu AÇIKÇA raporlanır. 'off'/'optional' sessizce
     çalışırsa kimse envanter yazımının korumasız olduğunu fark etmez. */
  const agentAuth = require('./agent/tools/agent-auth');
  const m = agentAuth.mode();
  if (m === 'required') {
    console.log('[GÜVENLİK] Webhook kimlik doğrulama: ZORUNLU (imzasız istek reddedilir).');
  } else {
    const msg = `[GÜVENLİK] Webhook kimlik doğrulama: ${m.toUpperCase()} — imzasız istek KABUL EDİLİYOR. ` +
      'Adresi bilen herkes sahte cihaz kaydedebilir. Üretimde WEBHOOK_AUTH=required olmalı.';
    if (process.env.NODE_ENV === 'production') console.error(msg);
    else console.warn(msg);
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
  // SNMP Ağ Keşfi: switch/firewall/AP/yazıcı envanteri (SNMP_ENABLED=true ise)
  snmpDiscovery.startSnmpScheduler();
})).catch(err => { console.error('[boot] initDataLayer başarısız:', err.message); process.exit(1); });
