// ── Cihaz Yaşam Döngüsü & Değiştirilemez (Immutable) Audit Log ────────────────
// Her cihazın durum değişikliği ZAMAN DAMGASI + İŞLEMİ YAPAN KULLANICI ile loglanır.
// Loglar APPEND-ONLY: silme/güncelleme fonksiyonu YOKTUR. Her kayıt, bir öncekinin
// hash'ini içerir (sha256 zinciri) → herhangi bir manipülasyon verifyChain ile yakalanır.
// TAMAMEN YEREL — dış istek yok, kapalı devre korunur.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAllAssets } = require('./baserow-tools');
const { getActiveNetworkDevices } = require('./anomaly-tools');
const { resolveIdentity } = require('./identity-tools');
const { wormAppend, getBackupStatus, restoreFromBackup } = require('./worm-backup');

// Test/dağıtım esnekliği: env ile override edilebilir (yoksa varsayılan yerel dosya)
const LOG_FILE = process.env.LIFECYCLE_LOG_FILE || path.join(__dirname, '..', '..', 'data', 'lifecycle-log.json');
const GENESIS = '0'.repeat(64);

// ── Yaşam döngüsü durumları ve sınıflandırma ─────────────────────────────────
const LIFECYCLE_STATES = [
  'Satın Alındı',
  'Aktif - Zimmetlendi',
  'Zimmet Değişikliği',
  'Depodan Çıkış',
  'Depoya Kaldırıldı',
  'Ayrılan Personelden Teslim Alındı',
  'Bakımda',
  'Kayıp',
  'Belirsiz',
  'Hurdaya Ayrıldı',
];
// Depoda olması beklenen (ağda aktif OLMAMALI) durumlar
const STORAGE_STATES  = new Set(['Depoya Kaldırıldı']);
// Sonrasında "Depoya Kaldırıldı" veya yeniden zimmet beklenen ara durumlar
const NEEDS_FOLLOWUP  = new Set(['Ayrılan Personelden Teslim Alındı']);
// Doğrudan risk teşkil eden durumlar
const LOST_STATES     = new Set(['Kayıp', 'Belirsiz']);
// Anlık bildirim (Telegram) gerektiren kritik durumlar
const ALERT_ON_RECORD = new Set(['Kayıp', 'Belirsiz', 'Ayrılan Personelden Teslim Alındı']);

// ── Çift Onay (Dual-Authorization) ───────────────────────────────────────────
// Bu durumlar İKİNCİ bir yetkilinin dijital onayını (imza) zorunlu kılar.
// Onaysız kaydedilirse "Güvenlik İhlali" (imzasiz_kritik) olarak işaretlenir.
const REQUIRES_APPROVAL = new Set([
  'Zimmet Değişikliği',
  'Depoya Kaldırıldı',
  'Ayrılan Personelden Teslim Alındı',
  'Kayıp',
  'Belirsiz',
  'Hurdaya Ayrıldı',
]);
// Onaylama yetkisi olan kişiler (kurumdaki yetkililer). İşlemi yapandan FARKLI olmalı.
const APPROVERS = [
  'Ahmet Şahin (BT Müdürü)',
  'Zeynep Korkmaz (İK Sorumlusu)',
  'Murat Demir (Departman Yöneticisi)',
  'Elif Yıldız (İdari İşler)',
];
// HMAC sırrı: imza taklit edilemesin diye (sır olmadan üretilemez).
const SIGN_SECRET = () => process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';
// Zincir sırrı: TÜM hash zinciri artık HMAC ile mühürlenir → saldırgan dosyayı düzenleyip
// zinciri yeniden hesaplayamaz (sır gerekir). Ayrı CHAIN_SECRET, yoksa SESSION_SECRET.
const CHAIN_SECRET = () => process.env.CHAIN_SECRET || process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';
// Onay bekleme süresi (TTL). Bu süre dolunca pending → güvenlik ihlali. .env'den ayarlanır (demo için kısalt).
const APPROVAL_TTL_MS = () => Number(process.env.APPROVAL_TTL_MS) || 24 * 60 * 60 * 1000;
function genId(n = 8) { return crypto.randomBytes(n).toString('hex'); }

function normMac(mac) {
  if (!mac) return '';
  return String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
}

// ── Cihaz eşleştirme — STABİL asset_id öncelikli (rename'e dayanıklı) ─────────
// İki tarafta da asset_id varsa SADECE asset_id karar verir (hostname/serial değişse de
// kayıtlar bağlı kalır; aynı hostname başka cihaza atanırsa yanlış eşleşme olmaz).
// asset_id yoksa serial_number, o da yoksa hostname'e düşülür (eski kayıt uyumu).
function sameDevice(e, ref) {
  if (ref.asset_id != null && e.asset_id != null) return Number(e.asset_id) === Number(ref.asset_id);
  if (ref.serial_number && e.serial_number) return e.serial_number === ref.serial_number;
  if (ref.hostname && e.hostname) return e.hostname === ref.hostname;
  return false;
}

// ── Düşük seviye log I/O (append-only) ───────────────────────────────────────
function readLog() {
  try {
    const j = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(j.events) ? j.events : [];
  } catch {
    return [];
  }
}
function writeLog(events) {
  const payload = {
    _comment: 'DEĞİŞTİRİLEMEZ audit log. Her kayıt HMAC-SHA256 hash zinciri ile bağlı; manuel düzenleme verifyChain ile yakalanır. Elle DÜZENLEMEYİN.',
    events,
  };
  // ATOMİK YAZMA: önce temp dosyaya yaz, sonra rename (aynı FS'te atomik). Süreç yazma
  // ortasında çökse bile asıl dosya YA eski tam hali YA yeni tam hali olur — asla yarım/bozuk.
  const tmp = LOG_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, LOG_FILE);
}

// core: zincire dahil edilen alanlar. Zincir HMAC-SHA256 ile mühürlenir (düz sha256 DEĞİL)
// → sır olmadan zincir yeniden hesaplanamaz; içeriden dosya düzenleyen tutarlı hash üretemez.
function hashEntry(prevHash, core) {
  return crypto.createHmac('sha256', CHAIN_SECRET()).update(prevHash + JSON.stringify(core)).digest('hex');
}

// ── Dijital imza (HMAC-SHA256) ───────────────────────────────────────────────
// İşlemi yapan + Onaylayan + durum + cihaz + zaman birleştirilip mühürlenir.
// SIGN_SECRET olmadan üretilemez → onay bilgisini değiştiren taklit edemez.
function buildSignPayload(e) {
  const device = e.serial_number || e.hostname || ('id:' + e.asset_id);
  // Kimlik bağlamını (UPN + IP + MFA) imzaya göm → kim/nereden/MFA inkâr edilemez
  return `${e.approval_id || ''}|${e.actor_upn || e.actor}=>${e.approver}|${e.to_status}|${device}|ip:${e.actor_ip || ''}|mfa:${e.mfa_verified ? 1 : 0}|${e.timestamp}`;
}
function computeSignature(payload) {
  return crypto.createHmac('sha256', SIGN_SECRET()).update(payload).digest('hex');
}

// ── Olay kaydet (TEK yazma yolu — güncelleme/silme YOK) ──────────────────────
// Alçak seviye append (TEK yazma yolu). approval_status: 'n/a'|'pending'|'approved'|'expired'.
// 'approved' + approver → HMAC ile imzalanır. security_flag dışarıdan verilebilir.
function recordEvent({
  asset_id = null, hostname = null, serial_number = null, to_status, note = null,
  actor = 'system', approver = null,
  approval_status = 'n/a', approval_id = null, approval_token = null, approval_expires_at = null,
  renews = null, security_flag = null, _timestamp = null,
  actor_ip = null, actor_mac = null, mfa_verified = true, mfa_method = null,
}) {
  if (!to_status) throw new Error('to_status (yeni durum) zorunludur.');
  if (!LIFECYCLE_STATES.includes(to_status)) {
    throw new Error(`Geçersiz durum: "${to_status}". Geçerli: ${LIFECYCLE_STATES.join(', ')}`);
  }

  const events = readLog();
  const prev = events[events.length - 1];
  const prevHash = prev ? prev.hash : GENESIS;

  // Bu cihazın önceki durumunu bul (from_status için) — stabil asset_id öncelikli
  const last = [...events].reverse().find(e => sameDevice(e, { asset_id, serial_number, hostname }));

  const timestamp = _timestamp || new Date().toISOString();
  // Yalnızca ONAYLANMIŞ kayıt kriptografik olarak imzalanır
  const signed = approval_status === 'approved' && !!approver;

  // ── LDAP/AD + MFA kimlik bağlamı (işlemi yapanı kurumsal kimliğe bağla) ──
  const idn = resolveIdentity(actor, { ip: actor_ip, mac: actor_mac, mfa_verified, mfa_method });

  const core = {
    seq: events.length + 1,
    timestamp,
    asset_id, hostname, serial_number,
    from_status: last ? last.to_status : null,
    to_status,
    note,
    actor,
    actor_upn: idn.actor_upn,
    actor_ip: idn.actor_ip,
    actor_mac: idn.actor_mac,
    mfa_verified: idn.mfa_verified,
    mfa_method: idn.mfa_method,
    approver,
    approval_status,
    approval_id,
    approval_token,
    approval_expires_at,
    renews,
    signed,
    security_flag,
    signature: null,
  };
  if (signed) {
    core.signature = computeSignature(buildSignPayload(core));
  }
  const entry = { ...core, prev_hash: prevHash, hash: hashEntry(prevHash, core) };
  events.push(entry);
  writeLog(events);
  // WORM Hardened Repository'ye eş zamanlı append-only kopya (silmeye karşı koruma)
  wormAppend(entry);
  return entry;
}

// ── Üst seviye: Durum değiştirme talebi ──────────────────────────────────────
// Kritik durum + onaylayan → PENDING (henüz uygulanmaz/mühürlenmez), token üretilir.
// Kritik durum + onaylayan YOK → tam bypass: uygulanır AMA imzasiz_kritik güvenlik ihlali.
// Kritik olmayan → doğrudan uygulanır (onay gerekmez).
function submitChange({ asset_id = null, hostname = null, serial_number = null, to_status, note = null, actor = 'system', approver = null, actor_ip = null, actor_mac = null, mfa_verified = true, mfa_method = null }) {
  const critical = REQUIRES_APPROVAL.has(to_status);
  if (approver && actor && String(approver).trim() === String(actor).trim()) {
    throw new Error('Onaylayan, işlemi yapan kişiden farklı olmalıdır (çift onay zorunlu).');
  }
  const idCtx = { actor_ip, actor_mac, mfa_verified, mfa_method };
  if (!critical) {
    return { kind: 'applied', event: recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approval_status: 'n/a', ...idCtx }) };
  }
  if (!approver) {
    return { kind: 'breach', event: recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approval_status: 'n/a', security_flag: 'imzasiz_kritik', ...idCtx }) };
  }
  const approval_id = genId(8);
  const approval_token = genId(16);
  const approval_expires_at = new Date(Date.now() + APPROVAL_TTL_MS()).toISOString();
  const event = recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approver, approval_status: 'pending', approval_id, approval_token, approval_expires_at, ...idCtx });
  return { kind: 'pending', event, approval_id, approval_token };
}

// ── Talep durumu sorgulama ───────────────────────────────────────────────────
function getRequestLatest(approval_id) {
  const events = readLog();
  return [...events].reverse().find(e => e.approval_id === approval_id) || null;
}
function findPendingByToken(token) {
  const events = readLog();
  return [...events].reverse().find(e => e.approval_token === token && e.approval_status === 'pending') || null;
}

// ── Onaylayan linke tıklayınca: mühürle (HMAC) ───────────────────────────────
// approverCtx: { actor, approver, actor_ip, mfa_verified } — GERÇEK oturum açmış onaylayan.
// actor = onaylayanın kullanıcı adı; kimlik (UPN/IP/MAC) users tablosundan çözülür.
function approveByToken(token, approverCtx = null) {
  const pend = findPendingByToken(token);
  if (!pend) throw new Error('Geçersiz veya daha önce kullanılmış onay bağlantısı.');
  const latest = getRequestLatest(pend.approval_id);
  if (latest && latest.approval_status !== 'pending') {
    throw new Error('Bu talep zaten sonuçlanmış (' + latest.approval_status + ').');
  }
  if (new Date(pend.approval_expires_at).getTime() < Date.now()) {
    throw new Error('Onay süresi dolmuş. Lütfen yeni bir onay talebi (yenileme) oluşturun.');
  }
  // GERÇEK çift onay: onaylayan, talebi OLUŞTURANDAN farklı kişi olmalı (kendi talebini onaylayamaz).
  const approverActor = approverCtx ? approverCtx.actor : pend.approver;
  const approverName  = approverCtx ? approverCtx.approver : pend.approver;
  if (pend.actor && approverActor && String(pend.actor) === String(approverActor)) {
    throw new Error('Kendi oluşturduğunuz talebi onaylayamazsınız (çift onay ilkesi).');
  }
  // Onay eylemini APPROVER yapar (actor = onaylayan) → imzalı ve EFEKTİF. Kimlik users'tan gömülür.
  const event = recordEvent({
    asset_id: pend.asset_id, hostname: pend.hostname, serial_number: pend.serial_number,
    to_status: pend.to_status, note: 'Dijital onay verildi' + (pend.note ? ' · ' + pend.note : ''),
    actor: approverActor, approver: approverName,
    approval_status: 'approved', approval_id: pend.approval_id,
    actor_ip: approverCtx ? approverCtx.actor_ip : null,
    mfa_verified: approverCtx ? approverCtx.mfa_verified !== false : true,
  });
  return { event, request: pend };
}

// ── Yenileme: süresi dolmuş/bekleyen talebe yeni link; eskisi 'çözüldü' sayılır ─
function renewRequest({ approval_id, actor = 'system' }) {
  const events = readLog();
  const orig = [...events].reverse().find(e => e.approval_id === approval_id && e.approval_status === 'pending');
  if (!orig) throw new Error('Yenilenecek talep bulunamadı.');
  const latest = getRequestLatest(approval_id);
  if (latest && latest.approval_status === 'approved') throw new Error('Talep zaten onaylanmış.');
  const new_id = genId(8);
  const new_token = genId(16);
  const approval_expires_at = new Date(Date.now() + APPROVAL_TTL_MS()).toISOString();
  const event = recordEvent({
    asset_id: orig.asset_id, hostname: orig.hostname, serial_number: orig.serial_number,
    to_status: orig.to_status, note: `Yenilenen onay talebi (önceki: ${approval_id})`,
    actor, approver: orig.approver,
    approval_status: 'pending', approval_id: new_id, approval_token: new_token, approval_expires_at,
    renews: approval_id,
  });
  return { event, approval_id: new_id, approval_token: new_token };
}

// ── TTL aşımı: bekleyen talepleri 'expired' (güvenlik ihlali) yap ────────────
function expirePendingRequests() {
  const events = readLog();
  const renewedIds = new Set(events.filter(e => e.renews).map(e => e.renews));
  const expired = [];
  for (const p of events) {
    if (p.approval_status !== 'pending') continue;
    if (renewedIds.has(p.approval_id)) continue;           // yenilenmiş → atla
    const latest = getRequestLatest(p.approval_id);
    if (!latest || latest.approval_status !== 'pending') continue; // zaten sonuçlanmış
    if (new Date(p.approval_expires_at).getTime() >= Date.now()) continue; // süre dolmamış
    const ev = recordEvent({
      asset_id: p.asset_id, hostname: p.hostname, serial_number: p.serial_number,
      to_status: p.to_status, note: 'Onay süresi doldu (otomatik tespit).',
      actor: 'system', approver: p.approver,
      approval_status: 'expired', approval_id: p.approval_id, security_flag: 'onay_zaman_asimi',
    });
    expired.push(ev);
  }
  return expired;
}

// ── Okuma yardımcıları ───────────────────────────────────────────────────────
function getLog({ limit = 100 } = {}) {
  const events = readLog();
  const sliced = limit ? events.slice(-limit) : events;
  return { total: events.length, events: sliced.reverse() }; // en yeni önce
}

function getDeviceLog(identifier) {
  const events = readLog();
  const key = String(identifier);
  const items = events.filter(e =>
    e.serial_number === key || e.hostname === key || String(e.asset_id) === key);
  return { identifier: key, total: items.length, events: items.reverse() };
}

// Bir kayıt EFEKTİF mi? (cihazın fiili durumunu değiştirir mi)
// pending/expired = sadece teklif/askıda → durumu DEĞİŞTİRMEZ. n/a (oto-uygulanan) ve approved = efektif.
function isEffective(e) {
  return e.approval_status === 'n/a' || e.approval_status === 'approved';
}

function getCurrentStatus(identifier) {
  const events = readLog();
  const key = String(identifier);
  const last = [...events].reverse().find(e => isEffective(e) &&
    (e.serial_number === key || e.hostname === key || String(e.asset_id) === key));
  return last ? { status: last.to_status, since: last.timestamp, actor: last.actor } : null;
}

// Bir VARLIK için güncel efektif durum — stabil asset_id öncelikli (rename'e dayanıklı)
function getCurrentStatusForAsset(asset) {
  if (!asset) return null;
  const events = readLog();
  const ref = { asset_id: asset.id, serial_number: asset.serial_number, hostname: asset.hostname };
  const last = [...events].reverse().find(e => isEffective(e) && sameDevice(e, ref));
  return last ? { status: last.to_status, since: last.timestamp, actor: last.actor } : null;
}

// ── Zincir bütünlüğü doğrulama (tamper tespiti) ──────────────────────────────
function verifyChain() {
  const events = readLog();
  let prevHash = GENESIS;
  for (const e of events) {
    const { prev_hash, hash, ...core } = e;
    if (prev_hash !== prevHash) {
      return { valid: false, broken_at: e.seq, reason: 'Zincir kopuk: prev_hash uyuşmuyor (kayıt eklenmiş/çıkarılmış olabilir).' };
    }
    if (hash !== hashEntry(prevHash, core)) {
      return { valid: false, broken_at: e.seq, reason: 'İçerik değiştirilmiş: hash uyuşmuyor.' };
    }
    // Dijital imza doğrulama: imzalı kayıtta onay bilgisi değiştirilmişse HMAC tutmaz
    if (e.signed) {
      const expected = computeSignature(buildSignPayload(e));
      if (e.signature !== expected) {
        return { valid: false, broken_at: e.seq, reason: 'Dijital imza geçersiz: onay bilgisi değiştirilmiş (kriptografik mühür bozuldu).' };
      }
    }
    prevHash = hash;
  }
  const signedCount = events.filter(e => e.signed).length;
  return { valid: true, total: events.length, signed_count: signedCount, last_hash: prevHash };
}

// ── WORM yedek köprüsü (hashEntry/writeLog içeride kalır) ─────────────────────
function auditBackupStatus() {
  return getBackupStatus({ localEvents: readLog(), localValid: verifyChain(), hashEntry });
}
function restoreAuditFromBackup() {
  const r = restoreFromBackup(writeLog);
  return { ...r, status: auditBackupStatus(), chain: verifyChain() };
}

// ── Yaşam döngüsü çelişki / zafiyet tespiti (DETERMINISTIK, LLM'siz) ──────────
async function detectLifecycleConflicts(orgId) {
  const events = readLog();
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];

  const feed = getActiveNetworkDevices();
  const activeMacs = new Set(feed.devices.map(d => normMac(d.mac)).filter(Boolean));

  // Cihaz bazında SON EFEKTİF durum — stabil asset_id öncelikli eşleştirme (rename'e dayanıklı)
  const effectiveEvents = events.filter(isEffective);

  const isCritical = (a) =>
    a.category === 'Sunucu' || a.category === 'Ağ Aygıtı' ||
    /admin|yonetici|yönetici|ceo|mudur|müdür|root|dbadmin/i.test(a.username || '');

  const conflicts = [];
  const now = Date.now();

  for (const a of assets) {
    const ref = { asset_id: a.id, serial_number: a.serial_number, hostname: a.hostname };
    const last = [...effectiveEvents].reverse().find(e => sameDevice(e, ref));
    if (!last) continue;

    const st = last.to_status;
    const days = Math.floor((now - new Date(last.timestamp).getTime()) / 86400000);
    const statusOnline = (a.status || '').toLowerCase() === 'online';
    const macActive = normMac(a.mac_address) && activeMacs.has(normMac(a.mac_address));

    const base = {
      hostname: a.hostname || '—',
      serial_number: a.serial_number || '—',
      username: a.username || '—',
      category: a.category || '—',
      lifecycle_status: st,
      logged_at: last.timestamp,
      logged_by: last.actor,
      days_in_state: days,
    };

    // A) Depoda loglanmış AMA ağda aktif
    if (STORAGE_STATES.has(st) && (statusOnline || macActive)) {
      conflicts.push({
        ...base, type: 'depoda_ama_aktif', severity: 'high',
        evidence: macActive ? 'ağ besleme listesinde aktif' : 'envanter durumu=online',
        message: `${base.hostname} cihazı ${days} gün önce '${st}' olarak loglandı ancak şu an ağda aktif/erişilebilir görünüyor (${macActive ? 'ağda ping alıyor' : 'status=online'}). Fiziksel konum ile kayıt çelişiyor.`,
      });
    }

    // B) Personelden alındı AMA depoya giriş/yeniden zimmet logu yok → kayıp şüphesi
    if (NEEDS_FOLLOWUP.has(st)) {
      conflicts.push({
        ...base, type: 'kayip_suphesi', severity: 'high',
        message: `${base.hostname} cihazı personelden düşülmüş ('${st}', ${days} gün önce) fakat ardından 'Depoya Kaldırıldı' veya yeniden zimmet logu basılmamış. Cihaz şu an kayıp/takipsiz olabilir.`,
      });
    }

    // C) Kayıp / Belirsiz statüsü (kritik cihazda eskalasyon)
    if (LOST_STATES.has(st)) {
      const crit = isCritical(a);
      conflicts.push({
        ...base, type: crit ? 'kritik_kayip' : 'kayip', severity: crit ? 'critical' : 'high',
        message: `${crit ? '[KRİTİK] ' : ''}${base.hostname} (${base.category}) cihazı '${st}' statüsünde${crit ? ' — kritik bir cihaz, acil müdahale gerekir.' : '.'}`,
      });
    }
  }

  // D) GÜVENLİK İHLALİ: kritik durum DİJİTAL ONAY OLMADAN (tam bypass) değiştirilmiş
  for (const e of events) {
    if (e.security_flag !== 'imzasiz_kritik') continue;
    const days = Math.floor((now - new Date(e.timestamp).getTime()) / 86400000);
    const idTrail = `${e.actor_upn || e.actor} hesabından, ${e.actor_ip || '—'} IP adresindeki makineden (${e.actor_mac || '—'})`;
    const mfaTrail = e.mfa_verified === false
      ? ` MFA (çift aşama) doğrulaması BYPASS edilmeye çalışılarak`
      : '';
    conflicts.push({
      type: 'imzasiz_kritik_islem', severity: 'critical',
      hostname: e.hostname || '—', serial_number: e.serial_number || '—',
      username: '—', category: '—',
      lifecycle_status: e.to_status, logged_at: e.timestamp, logged_by: e.actor,
      actor_upn: e.actor_upn, actor_ip: e.actor_ip, actor_mac: e.actor_mac, mfa_verified: e.mfa_verified,
      days_in_state: days, seq: e.seq,
      message: `[GÜVENLİK İHLALİ] ${e.hostname || e.serial_number} cihazının durumu '${e.to_status}' olarak ${idTrail}${mfaTrail} DİJİTAL ONAY OLMADAN değiştirildi (kayıt #${e.seq}). İkinci yetkili imzası eksik — işlem inkâr edilebilir/yetkisiz.`,
    });
  }

  // E) ONAY AKIŞI: bekleyen (pending) ve süresi dolan (expired) talepler
  // Talep bazında SON durum; yenilenenler (renews) çözülmüş sayılır → aktif alarm üretmez.
  const renewedIds = new Set(events.filter(e => e.renews).map(e => e.renews));
  const reqLatest = {};
  for (const e of events) { if (e.approval_id) reqLatest[e.approval_id] = e; } // sıralı → son kazanır
  for (const id in reqLatest) {
    const r = reqLatest[id];
    const days = Math.floor((now - new Date(r.timestamp).getTime()) / 86400000);
    const reqBase = {
      hostname: r.hostname || '—', serial_number: r.serial_number || '—',
      username: '—', category: '—', lifecycle_status: r.to_status,
      logged_at: r.timestamp, logged_by: r.actor, days_in_state: days,
      approval_id: id, approver: r.approver,
    };
    const expiredByTime = r.approval_status === 'pending' && new Date(r.approval_expires_at).getTime() < now;
    if (r.approval_status === 'expired' || expiredByTime) {
      if (renewedIds.has(id)) continue; // yenilenmiş → çözüldü, alarm yok
      conflicts.push({
        ...reqBase, type: 'onay_zaman_asimi', severity: 'critical',
        message: `[GÜVENLİK] ${reqBase.hostname} için '${r.to_status}' durum değişikliği onaya sunuldu ancak '${r.approver}' tarafından SÜRESİNDE onaylanmadı. İşlem askıda/yetkisiz — yenileyin veya iptal edin.`,
      });
    } else if (r.approval_status === 'pending') {
      conflicts.push({
        ...reqBase, type: 'onay_bekliyor', severity: 'medium',
        message: `${reqBase.hostname} için '${r.to_status}' durum değişikliği '${r.approver}' onayını bekliyor (dijital imza talep edildi).`,
      });
    }
  }

  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  conflicts.sort((x, y) => (rank[x.severity] - rank[y.severity]) || (y.days_in_state - x.days_in_state));

  const chain = verifyChain();
  const securityBreaches = conflicts.filter(c => c.type === 'imzasiz_kritik_islem' || c.type === 'onay_zaman_asimi').length;
  const pendingApprovals = conflicts.filter(c => c.type === 'onay_bekliyor').length;
  return {
    total_events: events.length,
    total_conflicts: conflicts.length,
    security_breaches: securityBreaches,
    pending_approvals: pendingApprovals,
    // Bütünlük: hash zinciri sağlam VE aktif güvenlik ihlali yok (bekleyen onay ihlal sayılmaz)
    integrity_ok: chain.valid && securityBreaches === 0,
    by_severity: {
      critical: conflicts.filter(c => c.severity === 'critical').length,
      high: conflicts.filter(c => c.severity === 'high').length,
      medium: conflicts.filter(c => c.severity === 'medium').length,
    },
    conflicts,
    chain,
  };
}

module.exports = {
  LIFECYCLE_STATES,
  ALERT_ON_RECORD,
  REQUIRES_APPROVAL,
  APPROVERS,
  APPROVAL_TTL_MS,
  recordEvent,
  submitChange,
  approveByToken,
  renewRequest,
  expirePendingRequests,
  getRequestLatest,
  getLog,
  getDeviceLog,
  getCurrentStatus,
  getCurrentStatusForAsset,
  verifyChain,
  detectLifecycleConflicts,
  auditBackupStatus,
  restoreAuditFromBackup,
};
