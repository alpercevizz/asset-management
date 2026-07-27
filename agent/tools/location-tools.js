// ── Lokasyon İzleme Modülü ──────────────────────────────────────────────────
// İki kavram AYRI tutulur (zimmet modülüyle aynı desen):
//   · BEKLENEN lokasyon (asset_expected_location) — cihazın ait olduğu resmi yer.
//     Yalnız kontrollü akıştan değişir; PUBLIC webhook buna DOKUNMAZ.
//   · GÖRÜLEN lokasyon (asset_location_history)   — ajanın/SNMP'nin raporladığı yer.
//     Konaklama kaydı: aynı yerde görüldükçe last_seen_at uzar, yer değişince yeni satır.
// İkisi LOCATION_DRIFT_DAYS gündür farklıysa → sapma uyarısı.
const { db } = require('../../db');
const settings = require('./settings-tools');

function nowIso() { return new Date().toISOString(); }
function norm(s) { return String(s || '').trim(); }
function sameLoc(a, b) { return norm(a).toLowerCase() === norm(b).toLowerCase(); }

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / 86400000;
}

/* ══ Lokasyon token'ları ═══════════════════════════════════════════════════
   GÜVENLİK: /api/webhook PUBLIC. Token doğrulaması olmadan ağa erişen herkes
   istediği cihaza istediği lokasyonu yazabilirdi. Token, lokasyonun KİMLİĞİDİR:
   gelen payload'daki location metnine GÜVENİLMEZ, token'ın eşlendiği ad kullanılır.

   .env:  LOCATION_TOKENS={"loc-abc123":"İstanbul Merkez","loc-xyz789":"Kocaeli Depo"}
   Tanımlı değilse eski davranış korunur (geriye dönük uyumluluk) ama başlangıçta uyarılır. */
let _tokens = null;
let _warned = false;

function loadTokens() {
  if (_tokens) return _tokens;
  const raw = process.env.LOCATION_TOKENS;
  if (!raw || !raw.trim()) { _tokens = {}; return _tokens; }
  try {
    const parsed = JSON.parse(raw);
    _tokens = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    console.error('[LOKASYON] LOCATION_TOKENS geçerli JSON değil — lokasyon doğrulaması DEVRE DIŞI.');
    _tokens = {};
  }
  return _tokens;
}

function tokensConfigured() { return Object.keys(loadTokens()).length > 0; }

// Test/yeniden yükleme için
function _resetTokens() { _tokens = null; _warned = false; }

/* Gelen webhook isteğinde lokasyonu çöz.
   Dönüş: { location, source } | { error, code }  */
function resolveLocation({ token, payloadLocation }) {
  const hasPayloadLoc = !!norm(payloadLocation);

  if (tokensConfigured()) {
    const t = norm(token);
    if (!t) {
      // Token yapılandırılmış ama istek token'sız: lokasyon yazmaya izin YOK.
      // Diğer telemetri (RAM, disk, IP…) normal işlenir — yalnız lokasyon düşer.
      return hasPayloadLoc
        ? { error: 'Lokasyon bildirimi için X-Location-Token zorunludur.', code: 'LOCATION_TOKEN_REQUIRED' }
        : { location: null, source: null };
    }
    const name = loadTokens()[t];
    if (!name) return { error: 'Geçersiz lokasyon token’ı.', code: 'LOCATION_TOKEN_INVALID' };
    // Token otoriter: payload'daki location metni YOK SAYILIR.
    return { location: name, source: 'location-agent' };
  }

  // Token yapılandırılmamış → eski davranış, ama bir kez uyar.
  if (hasPayloadLoc && !_warned) {
    _warned = true;
    console.warn('[LOKASYON] LOCATION_TOKENS tanımlı değil — webhook’tan gelen lokasyon DOĞRULANMIYOR. ' +
      'Üretimde .env’e LOCATION_TOKENS ekleyin.');
  }
  return hasPayloadLoc ? { location: norm(payloadLocation), source: 'unverified' } : { location: null, source: null };
}

/* ══ Beklenen (resmi) lokasyon ═════════════════════════════════════════════ */
async function getExpected(assetId) {
  return db()('asset_expected_location').where({ asset_id: Number(assetId) }).first();
}
async function getAllExpected() {
  return db()('asset_expected_location').select('*');
}

async function setExpected(assetId, { location, hostname = null, by = 'system', note = null }) {
  const id = Number(assetId);
  const loc = norm(location);
  if (!loc) throw new Error('Beklenen lokasyon boş olamaz.');
  const row = { asset_id: id, location: loc, hostname, set_at: nowIso(), set_by: by, note };
  const existing = await getExpected(id);
  if (existing) await db()('asset_expected_location').where({ asset_id: id }).update(row);
  else await db()('asset_expected_location').insert(row);
  return getExpected(id);
}

async function clearExpected(assetId) {
  await db()('asset_expected_location').where({ asset_id: Number(assetId) }).del();
  return null;
}

/* ══ Görülen lokasyon — konaklama kaydı ════════════════════════════════════ */
// Güncel konaklama = EN SON EKLENEN satır (id desc).
// first_seen_at'e göre sıralama kırılgan: veri düzeltmesiyle geriye tarihlenen bir
// satır "güncel"liği yanlış cihaza kaydırır. id monoton artar → tek doğru sıra.
async function getCurrentStay(assetId) {
  return db()('asset_location_history')
    .where({ asset_id: Number(assetId) })
    .orderBy('id', 'desc')
    .first();
}

async function getHistory(assetId, limit = 50) {
  return db()('asset_location_history')
    .where({ asset_id: Number(assetId) })
    .orderBy('id', 'desc')
    .limit(limit);
}

/* Cihaz bir lokasyonda görüldü.
   Aynı yerdeyse konaklama uzar; yer değiştiyse yeni konaklama açılır.
   Dönüş: { changed, from, to, stay } — changed=true ise transfer olmuştur. */
async function recordSeen(assetId, { location, serial_number = null, hostname = null, source = 'unverified' }) {
  const id = Number(assetId);
  const loc = norm(location);
  if (!id || !loc) return { changed: false, from: null, to: null, stay: null };

  const current = await getCurrentStay(id);
  const ts = nowIso();

  if (current && sameLoc(current.to_location, loc)) {
    await db()('asset_location_history').where({ id: current.id }).update({ last_seen_at: ts });
    return { changed: false, from: current.to_location, to: loc, stay: { ...current, last_seen_at: ts } };
  }

  const row = {
    asset_id: id, serial_number, hostname,
    from_location: current ? current.to_location : null,
    to_location: loc, source,
    first_seen_at: ts, last_seen_at: ts,
  };
  await db()('asset_location_history').insert(row);
  return { changed: !!current, from: current ? current.to_location : null, to: loc, stay: row };
}

/* ══ Sapma tespiti ═════════════════════════════════════════════════════════
   Beklenen ≠ görülen VE bu durum eşik günden uzun sürüyorsa uyarı.
   Kısa süreli sapma (personel dizüstüyle toplantıya gitti) gürültü YAPMAZ. */
function driftDays() {
  const t = settings.getThresholds();
  const v = Number(t.location_drift_days);
  return Number.isFinite(v) && v > 0 ? v : 7;
}

async function detectLocationDrift(assets) {
  const TH = driftDays();
  const expected = await getAllExpected();
  // Hiç beklenen lokasyon tanımlı değilse sapma hesaplanamaz — ama "unassigned" gerçeği
  // söylemeli: TÜM cihazların beklenen lokasyonu eksik (admin'e tohumlama sinyali).
  if (!expected.length) {
    return { threshold_days: TH, count: 0, drifted: [], unassigned: (assets || []).length };
  }

  const expMap = {};
  expected.forEach(e => { expMap[e.asset_id] = e; });

  const drifted = [];
  let unassigned = 0;

  for (const a of assets || []) {
    const exp = expMap[a.id];
    if (!exp) { unassigned++; continue; }

    const stay = await getCurrentStay(a.id);
    // Görülen lokasyon önce konaklama kaydından, yoksa envanterdeki alandan.
    const seen = stay ? stay.to_location : norm(a.location);
    if (!seen || sameLoc(seen, exp.location)) continue;

    const since = stay ? stay.first_seen_at : null;
    const days = since ? daysSince(since) : null;
    // Konaklama kaydı yoksa süre bilinmiyor → eşik uygulanamaz, yine de bildir (days=null).
    if (days !== null && days < TH) continue;

    drifted.push({
      asset_id: a.id,
      hostname: a.hostname,
      serial_number: a.serial_number,
      category: a.category,
      expected_location: exp.location,
      seen_location: seen,
      since,
      days: days === null ? null : Math.floor(days),
      source: stay ? stay.source : 'envanter',
    });
  }

  drifted.sort((x, y) => (y.days ?? 0) - (x.days ?? 0));
  return { threshold_days: TH, count: drifted.length, drifted, unassigned };
}

/* İlk kurulum: mevcut envanterdeki lokasyonu "beklenen" başlangıcı olarak al (tablo boşsa). */
async function seedExpectedFromAssets(assets) {
  const [{ n }] = await db()('asset_expected_location').count({ n: '*' });
  if (Number(n) > 0) return { skipped: true, count: 0 };
  let count = 0;
  for (const a of assets || []) {
    const loc = norm(a.location);
    if (!loc) continue;
    await db()('asset_expected_location').insert({
      asset_id: a.id, location: loc, hostname: a.hostname || null,
      set_at: nowIso(), set_by: 'seed', note: 'İlk kurulum — mevcut envanter lokasyonundan',
    });
    count++;
  }
  return { skipped: false, count };
}

module.exports = {
  resolveLocation, tokensConfigured, _resetTokens,
  getExpected, getAllExpected, setExpected, clearExpected,
  getCurrentStay, getHistory, recordSeen,
  detectLocationDrift, seedExpectedFromAssets,
};
