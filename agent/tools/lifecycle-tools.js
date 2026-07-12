// ── Cihaz Yaşam Döngüsü & Değiştirilemez (Immutable) Audit Log ────────────────
// SQL destekli (SQLite | PostgreSQL). WORM yedek DOSYA-BAZLI KALIR (write-once garantisi).
// Yazma ASYNC (DB insert + WORM append). Okuma SENKRON — init'te tüm event'ler cache'e alınır.
// Concurrent recordEvent çağrıları promise-mutex ile serialize edilir → hash zinciri korunur.
const crypto = require('crypto');
const { db } = require('../../db');
const { getAllAssets } = require('./baserow-tools');
const { getActiveNetworkDevices } = require('./anomaly-tools');
const { resolveIdentity } = require('./identity-tools');
const { wormAppend, getBackupStatus, restoreFromBackup } = require('./worm-backup');

const GENESIS = '0'.repeat(64);

const LIFECYCLE_STATES = [
  'Satın Alındı', 'Aktif - Zimmetlendi', 'Zimmet Değişikliği',
  'Depodan Çıkış', 'Depoya Kaldırıldı',
  'Ayrılan Personelden Teslim Alındı', 'Bakımda',
  'Kayıp', 'Belirsiz', 'Hurdaya Ayrıldı',
];
const STORAGE_STATES  = new Set(['Depoya Kaldırıldı']);
const NEEDS_FOLLOWUP  = new Set(['Ayrılan Personelden Teslim Alındı']);
const LOST_STATES     = new Set(['Kayıp', 'Belirsiz']);
const ALERT_ON_RECORD = new Set(['Kayıp', 'Belirsiz', 'Ayrılan Personelden Teslim Alındı']);
const REQUIRES_APPROVAL = new Set([
  'Zimmet Değişikliği', 'Depoya Kaldırıldı', 'Ayrılan Personelden Teslim Alındı',
  'Kayıp', 'Belirsiz', 'Hurdaya Ayrıldı',
]);
const APPROVERS = [
  'Ahmet Şahin (BT Müdürü)', 'Zeynep Korkmaz (İK Sorumlusu)',
  'Murat Demir (Departman Yöneticisi)', 'Elif Yıldız (İdari İşler)',
];
const SIGN_SECRET  = () => process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';
const CHAIN_SECRET = () => process.env.CHAIN_SECRET || process.env.SESSION_SECRET || 'assetman-demo-secret-degistir';
const APPROVAL_TTL_MS = () => Number(process.env.APPROVAL_TTL_MS) || 24 * 60 * 60 * 1000;

function genId(n = 8) { return crypto.randomBytes(n).toString('hex'); }
function normMac(mac) { if (!mac) return ''; return String(mac).toLowerCase().replace(/[^0-9a-f]/g, ''); }

function sameDevice(e, ref) {
  if (ref.asset_id != null && e.asset_id != null) return Number(e.asset_id) === Number(ref.asset_id);
  if (ref.serial_number && e.serial_number) return e.serial_number === ref.serial_number;
  if (ref.hostname && e.hostname) return e.hostname === ref.hostname;
  return false;
}

// ── Cache + mutex (yazma serileştirme) ────────────────────────────────────────
let _cache = null;           // in-memory events array (seq sırasında)
let _cacheReady = false;
let _writeChain = Promise.resolve(); // promise-mutex

function _ensure() { if (!_cacheReady) throw new Error('lifecycle.init() çağrılmadı.'); }
async function _serial(fn) {
  const next = _writeChain.then(fn, fn);
  _writeChain = next.catch(() => {}); // hata sonraki'yi bloklamasın
  return next;
}

// DB satırı ↔ event nesnesi (bool/JSON normalize)
function rowToEvent(r) {
  if (!r) return null;
  return {
    seq: r.seq, timestamp: r.timestamp,
    asset_id: r.asset_id, hostname: r.hostname, serial_number: r.serial_number,
    from_status: r.from_status, to_status: r.to_status, note: r.note,
    actor: r.actor, actor_upn: r.actor_upn, actor_ip: r.actor_ip, actor_mac: r.actor_mac,
    mfa_verified: !!r.mfa_verified, mfa_method: r.mfa_method,
    approver: r.approver, approval_status: r.approval_status,
    approval_id: r.approval_id, approval_token: r.approval_token,
    approval_expires_at: r.approval_expires_at, renews: r.renews,
    signed: !!r.signed, security_flag: r.security_flag, signature: r.signature,
    prev_hash: r.prev_hash, hash: r.hash,
  };
}
function eventToRow(e) {
  return {
    seq: e.seq, timestamp: e.timestamp,
    asset_id: e.asset_id, hostname: e.hostname, serial_number: e.serial_number,
    from_status: e.from_status, to_status: e.to_status, note: e.note,
    actor: e.actor, actor_upn: e.actor_upn, actor_ip: e.actor_ip, actor_mac: e.actor_mac,
    mfa_verified: e.mfa_verified ? 1 : 0, mfa_method: e.mfa_method,
    approver: e.approver, approval_status: e.approval_status,
    approval_id: e.approval_id, approval_token: e.approval_token,
    approval_expires_at: e.approval_expires_at, renews: e.renews,
    signed: e.signed ? 1 : 0, security_flag: e.security_flag, signature: e.signature,
    prev_hash: e.prev_hash, hash: e.hash,
  };
}

async function init() {
  const k = db();
  const rows = await k('lifecycle_events').select('*').orderBy('seq');
  _cache = rows.map(rowToEvent);
  _cacheReady = true;
}

// ── Düşük seviye "log" API — cache'den senkron döner ─────────────────────────
function readLog() { _ensure(); return _cache.slice(); }

// Cache'i tümüyle değiştir (WORM restore veya reseed) — DB'yi de yeniden yaz.
// ATOMİK: transaction ile eski satırları sil + yeni satırları insert et.
async function writeLog(events) {
  const k = db();
  await k.transaction(async (trx) => {
    await trx('lifecycle_events').del();
    if (events.length) {
      // Toplu insert'i partiler halinde yap (SQLite parametre limiti için)
      const CHUNK = 200;
      for (let i = 0; i < events.length; i += CHUNK) {
        await trx('lifecycle_events').insert(events.slice(i, i + CHUNK).map(eventToRow));
      }
    }
  });
  _cache = events.slice();
}

function hashEntry(prevHash, core) {
  return crypto.createHmac('sha256', CHAIN_SECRET()).update(prevHash + JSON.stringify(core)).digest('hex');
}
function buildSignPayload(e) {
  const device = e.serial_number || e.hostname || ('id:' + e.asset_id);
  return `${e.approval_id || ''}|${e.actor_upn || e.actor}=>${e.approver}|${e.to_status}|${device}|ip:${e.actor_ip || ''}|mfa:${e.mfa_verified ? 1 : 0}|${e.timestamp}`;
}
function computeSignature(payload) {
  return crypto.createHmac('sha256', SIGN_SECRET()).update(payload).digest('hex');
}

// ── ASYNC recordEvent (yazma kuyruğunda serileştirilir) ──────────────────────
async function recordEvent(params) {
  return _serial(async () => {
    _ensure();
    const {
      asset_id = null, hostname = null, serial_number = null, to_status, note = null,
      actor = 'system', approver = null,
      approval_status = 'n/a', approval_id = null, approval_token = null, approval_expires_at = null,
      renews = null, security_flag = null, _timestamp = null,
      actor_ip = null, actor_mac = null, mfa_verified = true, mfa_method = null,
    } = params;
    if (!to_status) throw new Error('to_status (yeni durum) zorunludur.');
    if (!LIFECYCLE_STATES.includes(to_status)) {
      throw new Error(`Geçersiz durum: "${to_status}". Geçerli: ${LIFECYCLE_STATES.join(', ')}`);
    }
    const events = _cache;
    const prev = events[events.length - 1];
    const prevHash = prev ? prev.hash : GENESIS;
    const last = [...events].reverse().find(e => sameDevice(e, { asset_id, serial_number, hostname }));
    const timestamp = _timestamp || new Date().toISOString();
    const signed = approval_status === 'approved' && !!approver;
    const idn = resolveIdentity(actor, { ip: actor_ip, mac: actor_mac, mfa_verified, mfa_method });
    const core = {
      seq: events.length + 1, timestamp,
      asset_id, hostname, serial_number,
      from_status: last ? last.to_status : null,
      to_status, note, actor,
      actor_upn: idn.actor_upn, actor_ip: idn.actor_ip, actor_mac: idn.actor_mac,
      mfa_verified: idn.mfa_verified, mfa_method: idn.mfa_method,
      approver, approval_status, approval_id, approval_token, approval_expires_at, renews,
      signed, security_flag, signature: null,
    };
    if (signed) core.signature = computeSignature(buildSignPayload(core));
    const entry = { ...core, prev_hash: prevHash, hash: hashEntry(prevHash, core) };
    // DB'ye atomik insert + cache push + WORM append
    await db()('lifecycle_events').insert(eventToRow(entry));
    _cache.push(entry);
    try { wormAppend(entry); } catch (e) { console.error('[wormAppend]', e.message); }
    return entry;
  });
}

// ── Üst seviye ─────────────────────────────────────────────────────────────────
async function submitChange({ asset_id = null, hostname = null, serial_number = null, to_status, note = null, actor = 'system', approver = null, actor_ip = null, actor_mac = null, mfa_verified = true, mfa_method = null }) {
  const critical = REQUIRES_APPROVAL.has(to_status);
  if (approver && actor && String(approver).trim() === String(actor).trim()) {
    throw new Error('Onaylayan, işlemi yapan kişiden farklı olmalıdır (çift onay zorunlu).');
  }
  const idCtx = { actor_ip, actor_mac, mfa_verified, mfa_method };
  if (!critical) {
    return { kind: 'applied', event: await recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approval_status: 'n/a', ...idCtx }) };
  }
  if (!approver) {
    return { kind: 'breach', event: await recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approval_status: 'n/a', security_flag: 'imzasiz_kritik', ...idCtx }) };
  }
  const approval_id = genId(8);
  const approval_token = genId(16);
  const approval_expires_at = new Date(Date.now() + APPROVAL_TTL_MS()).toISOString();
  const event = await recordEvent({ asset_id, hostname, serial_number, to_status, note, actor, approver, approval_status: 'pending', approval_id, approval_token, approval_expires_at, ...idCtx });
  return { kind: 'pending', event, approval_id, approval_token };
}

function getRequestLatest(approval_id) {
  _ensure();
  return [..._cache].reverse().find(e => e.approval_id === approval_id) || null;
}
function findPendingByToken(token) {
  _ensure();
  return [..._cache].reverse().find(e => e.approval_token === token && e.approval_status === 'pending') || null;
}

async function approveByToken(token, approverCtx = null) {
  const pend = findPendingByToken(token);
  if (!pend) throw new Error('Geçersiz veya daha önce kullanılmış onay bağlantısı.');
  const latest = getRequestLatest(pend.approval_id);
  if (latest && latest.approval_status !== 'pending') {
    throw new Error('Bu talep zaten sonuçlanmış (' + latest.approval_status + ').');
  }
  if (new Date(pend.approval_expires_at).getTime() < Date.now()) {
    throw new Error('Onay süresi dolmuş. Lütfen yeni bir onay talebi (yenileme) oluşturun.');
  }
  const approverActor = approverCtx ? approverCtx.actor : pend.approver;
  const approverName  = approverCtx ? approverCtx.approver : pend.approver;
  if (pend.actor && approverActor && String(pend.actor) === String(approverActor)) {
    throw new Error('Kendi oluşturduğunuz talebi onaylayamazsınız (çift onay ilkesi).');
  }
  const event = await recordEvent({
    asset_id: pend.asset_id, hostname: pend.hostname, serial_number: pend.serial_number,
    to_status: pend.to_status, note: 'Dijital onay verildi' + (pend.note ? ' · ' + pend.note : ''),
    actor: approverActor, approver: approverName,
    approval_status: 'approved', approval_id: pend.approval_id,
    actor_ip: approverCtx ? approverCtx.actor_ip : null,
    mfa_verified: approverCtx ? approverCtx.mfa_verified !== false : true,
  });
  return { event, request: pend };
}

async function renewRequest({ approval_id, actor = 'system' }) {
  _ensure();
  const orig = [..._cache].reverse().find(e => e.approval_id === approval_id && e.approval_status === 'pending');
  if (!orig) throw new Error('Yenilenecek talep bulunamadı.');
  const latest = getRequestLatest(approval_id);
  if (latest && latest.approval_status === 'approved') throw new Error('Talep zaten onaylanmış.');
  const new_id = genId(8);
  const new_token = genId(16);
  const approval_expires_at = new Date(Date.now() + APPROVAL_TTL_MS()).toISOString();
  const event = await recordEvent({
    asset_id: orig.asset_id, hostname: orig.hostname, serial_number: orig.serial_number,
    to_status: orig.to_status, note: `Yenilenen onay talebi (önceki: ${approval_id})`,
    actor, approver: orig.approver,
    approval_status: 'pending', approval_id: new_id, approval_token: new_token, approval_expires_at,
    renews: approval_id,
  });
  return { event, approval_id: new_id, approval_token: new_token };
}

async function expirePendingRequests() {
  _ensure();
  const events = _cache;
  const renewedIds = new Set(events.filter(e => e.renews).map(e => e.renews));
  const expired = [];
  const candidates = [];
  for (const p of events) {
    if (p.approval_status !== 'pending') continue;
    if (renewedIds.has(p.approval_id)) continue;
    const latest = getRequestLatest(p.approval_id);
    if (!latest || latest.approval_status !== 'pending') continue;
    if (new Date(p.approval_expires_at).getTime() >= Date.now()) continue;
    candidates.push(p);
  }
  for (const p of candidates) {
    const ev = await recordEvent({
      asset_id: p.asset_id, hostname: p.hostname, serial_number: p.serial_number,
      to_status: p.to_status, note: 'Onay süresi doldu (otomatik tespit).',
      actor: 'system', approver: p.approver,
      approval_status: 'expired', approval_id: p.approval_id, security_flag: 'onay_zaman_asimi',
    });
    expired.push(ev);
  }
  return expired;
}

function getLog({ limit = 100 } = {}) {
  _ensure();
  const sliced = limit ? _cache.slice(-limit) : _cache;
  return { total: _cache.length, events: sliced.slice().reverse() };
}
function getDeviceLog(identifier) {
  _ensure();
  const key = String(identifier);
  const items = _cache.filter(e =>
    e.serial_number === key || e.hostname === key || String(e.asset_id) === key);
  return { identifier: key, total: items.length, events: items.reverse() };
}
function isEffective(e) { return e.approval_status === 'n/a' || e.approval_status === 'approved'; }
function getCurrentStatus(identifier) {
  _ensure();
  const key = String(identifier);
  const last = [..._cache].reverse().find(e => isEffective(e) &&
    (e.serial_number === key || e.hostname === key || String(e.asset_id) === key));
  return last ? { status: last.to_status, since: last.timestamp, actor: last.actor } : null;
}
function getCurrentStatusForAsset(asset) {
  if (!asset) return null;
  _ensure();
  const ref = { asset_id: asset.id, serial_number: asset.serial_number, hostname: asset.hostname };
  const last = [..._cache].reverse().find(e => isEffective(e) && sameDevice(e, ref));
  return last ? { status: last.to_status, since: last.timestamp, actor: last.actor } : null;
}

function verifyChain() {
  _ensure();
  let prevHash = GENESIS;
  for (const e of _cache) {
    const { prev_hash, hash, ...core } = e;
    if (prev_hash !== prevHash) return { valid: false, broken_at: e.seq, reason: 'Zincir kopuk: prev_hash uyuşmuyor (kayıt eklenmiş/çıkarılmış olabilir).' };
    if (hash !== hashEntry(prevHash, core)) return { valid: false, broken_at: e.seq, reason: 'İçerik değiştirilmiş: hash uyuşmuyor.' };
    if (e.signed) {
      const expected = computeSignature(buildSignPayload(e));
      if (e.signature !== expected) return { valid: false, broken_at: e.seq, reason: 'Dijital imza geçersiz: onay bilgisi değiştirilmiş (kriptografik mühür bozuldu).' };
    }
    prevHash = hash;
  }
  const signedCount = _cache.filter(e => e.signed).length;
  return { valid: true, total: _cache.length, signed_count: signedCount, last_hash: prevHash };
}

// ── WORM köprüsü ──────────────────────────────────────────────────────────────
function auditBackupStatus() {
  return getBackupStatus({ localEvents: readLog(), localValid: verifyChain(), hashEntry });
}
async function restoreAuditFromBackup() {
  // writeLog async: WORM'dan gelen event listesi ile yerel DB + cache tamamen değiştirilir
  const r = await restoreFromBackup(async (events) => { await writeLog(events); return events.length; });
  return { ...r, status: auditBackupStatus(), chain: verifyChain() };
}

// ── Çelişki tespiti (senkron cache + Baserow fetch) ──────────────────────────
async function detectLifecycleConflicts(orgId) {
  _ensure();
  const events = _cache;
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];
  const feed = getActiveNetworkDevices();
  const activeMacs = new Set(feed.devices.map(d => normMac(d.mac)).filter(Boolean));
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
      hostname: a.hostname || '—', serial_number: a.serial_number || '—',
      username: a.username || '—', category: a.category || '—',
      lifecycle_status: st, logged_at: last.timestamp, logged_by: last.actor, days_in_state: days,
    };
    if (STORAGE_STATES.has(st) && (statusOnline || macActive)) {
      conflicts.push({ ...base, type: 'depoda_ama_aktif', severity: 'high',
        evidence: macActive ? 'ağ besleme listesinde aktif' : 'envanter durumu=online',
        message: `${base.hostname} cihazı ${days} gün önce '${st}' olarak loglandı ancak şu an ağda aktif/erişilebilir görünüyor (${macActive ? 'ağda ping alıyor' : 'status=online'}). Fiziksel konum ile kayıt çelişiyor.` });
    }
    if (NEEDS_FOLLOWUP.has(st)) {
      conflicts.push({ ...base, type: 'kayip_suphesi', severity: 'high',
        message: `${base.hostname} cihazı personelden düşülmüş ('${st}', ${days} gün önce) fakat ardından 'Depoya Kaldırıldı' veya yeniden zimmet logu basılmamış. Cihaz şu an kayıp/takipsiz olabilir.` });
    }
    if (LOST_STATES.has(st)) {
      const crit = isCritical(a);
      conflicts.push({ ...base, type: crit ? 'kritik_kayip' : 'kayip', severity: crit ? 'critical' : 'high',
        message: `${crit ? '[KRİTİK] ' : ''}${base.hostname} (${base.category}) cihazı '${st}' statüsünde${crit ? ' — kritik bir cihaz, acil müdahale gerekir.' : '.'}` });
    }
  }

  for (const e of events) {
    if (e.security_flag !== 'imzasiz_kritik') continue;
    const days = Math.floor((now - new Date(e.timestamp).getTime()) / 86400000);
    const idTrail = `${e.actor_upn || e.actor} hesabından, ${e.actor_ip || '—'} IP adresindeki makineden (${e.actor_mac || '—'})`;
    const mfaTrail = e.mfa_verified === false ? ` MFA (çift aşama) doğrulaması BYPASS edilmeye çalışılarak` : '';
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

  const renewedIds = new Set(events.filter(e => e.renews).map(e => e.renews));
  const reqLatest = {};
  for (const e of events) { if (e.approval_id) reqLatest[e.approval_id] = e; }
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
      if (renewedIds.has(id)) continue;
      conflicts.push({ ...reqBase, type: 'onay_zaman_asimi', severity: 'critical',
        message: `[GÜVENLİK] ${reqBase.hostname} için '${r.to_status}' durum değişikliği onaya sunuldu ancak '${r.approver}' tarafından SÜRESİNDE onaylanmadı. İşlem askıda/yetkisiz — yenileyin veya iptal edin.` });
    } else if (r.approval_status === 'pending') {
      conflicts.push({ ...reqBase, type: 'onay_bekliyor', severity: 'medium',
        message: `${reqBase.hostname} için '${r.to_status}' durum değişikliği '${r.approver}' onayını bekliyor (dijital imza talep edildi).` });
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
    integrity_ok: chain.valid && securityBreaches === 0,
    by_severity: {
      critical: conflicts.filter(c => c.severity === 'critical').length,
      high: conflicts.filter(c => c.severity === 'high').length,
      medium: conflicts.filter(c => c.severity === 'medium').length,
    },
    conflicts, chain,
  };
}

module.exports = {
  LIFECYCLE_STATES, ALERT_ON_RECORD, REQUIRES_APPROVAL, APPROVERS, APPROVAL_TTL_MS,
  init, recordEvent, submitChange, approveByToken, renewRequest, expirePendingRequests,
  getRequestLatest, getLog, getDeviceLog, getCurrentStatus, getCurrentStatusForAsset,
  verifyChain, detectLifecycleConflicts, auditBackupStatus, restoreAuditFromBackup,
};
