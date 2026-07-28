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

/* ══ Dashboard özeti ═══════════════════════════════════════════════════════
   Her cihazı TEK bir kovaya koyar (toplam = envanter sayısı, yuvarlama kaybı yok):
     dogru      → beklenen tanımlı ve görülen == beklenen
     tasinmis   → beklenen tanımlı ama görülen farklı (eşik uygulanmaz, ham gerçek)
     guncellenen→ son STALE penceresi içinde yer değiştirmiş (yeni konaklama açılmış)
     bilinmeyen → lokasyon bilgisi hiç yok
     baseline_yok → lokasyonu var ama beklenen tanımlanmamış (tohumlama bekliyor)
   Sapma şiddeti süreye göre: kritik > 30 gün · uyarı eşik-30 · bilgi eşik altı. */
const RECENT_MOVE_DAYS = 7;
const CRITICAL_DRIFT_DAYS = 30;

async function getLocationSummary(assets) {
  const TH = driftDays();
  const list = assets || [];
  const expected = await getAllExpected();
  const expMap = {};
  expected.forEach(e => { expMap[e.asset_id] = e.location; });

  // Tüm konaklamaları tek sorguda al (cihaz başına sorgu N+1 olurdu)
  const stays = await db()('asset_location_history').orderBy('id', 'asc');
  const stayMap = {};
  stays.forEach(s => { stayMap[s.asset_id] = s; }); // artan sıra → sonuncu kalır

  const out = {
    total: list.length,
    dogru: 0, tasinmis: 0, guncellenen: 0, bilinmeyen: 0, baseline_yok: 0,
    severity: { kritik: 0, uyari: 0, bilgi: 0 },
    locations: {},
    threshold_days: TH,
  };

  for (const a of list) {
    const exp = expMap[a.id];
    const stay = stayMap[a.id];
    const seen = stay ? stay.to_location : norm(a.location);

    if (seen) out.locations[seen] = (out.locations[seen] || 0) + 1;

    const movedDays = stay ? daysSince(stay.first_seen_at) : null;
    const recentlyMoved = stay && stay.from_location && movedDays !== null && movedDays <= RECENT_MOVE_DAYS;

    if (!exp && !seen) { out.bilinmeyen++; continue; }
    if (!exp) { out.baseline_yok++; continue; }
    if (!seen) { out.bilinmeyen++; continue; }

    if (sameLoc(seen, exp)) {
      if (recentlyMoved) out.guncellenen++; else out.dogru++;
      continue;
    }

    out.tasinmis++;
    const d = movedDays === null ? null : Math.floor(movedDays);
    if (d !== null && d >= CRITICAL_DRIFT_DAYS) out.severity.kritik++;
    else if (d === null || d >= TH) out.severity.uyari++;
    else out.severity.bilgi++;
  }

  out.location_count = Object.keys(out.locations).length;
  return out;
}


/* ══ Lokasyon koordinatları ════════════════════════════════════════════════
   Harita için gereken lat/lon. DIŞ GEOCODING SERVİSİ KULLANILMAZ — kapalı
   devre ilkesi. Adı bilinen bir Türk iliyle eşleşenler otomatik tohumlanır;
   "Ana Depo" gibi yer adı olmayanlar Ayarlar'dan elle girilir. */
const TR_IL = {
  adana: [37.00, 35.32], adiyaman: [37.76, 38.28], afyon: [38.76, 30.54],
  agri: [39.72, 43.05], aksaray: [38.37, 34.03], amasya: [40.65, 35.83],
  ankara: [39.93, 32.86], antalya: [36.90, 30.70], ardahan: [41.11, 42.70],
  artvin: [41.18, 41.82], aydin: [37.85, 27.84], balikesir: [39.65, 27.89],
  bartin: [41.64, 32.34], batman: [37.89, 41.13], bayburt: [40.26, 40.23],
  bilecik: [40.15, 29.98], bingol: [38.88, 40.50], bitlis: [38.40, 42.11],
  bolu: [40.74, 31.61], burdur: [37.72, 30.29], bursa: [40.19, 29.06],
  canakkale: [40.15, 26.41], cankiri: [40.60, 33.62], corum: [40.55, 34.95],
  denizli: [37.78, 29.09], diyarbakir: [37.91, 40.24], duzce: [40.84, 31.16],
  edirne: [41.68, 26.56], elazig: [38.68, 39.22], erzincan: [39.75, 39.49],
  erzurum: [39.90, 41.27], eskisehir: [39.78, 30.52], gaziantep: [37.07, 37.38],
  giresun: [40.91, 38.39], gumushane: [40.46, 39.48], hakkari: [37.57, 43.74],
  hatay: [36.20, 36.16], igdir: [39.92, 44.04], isparta: [37.76, 30.55],
  istanbul: [41.01, 28.98], izmir: [38.42, 27.14], izmit: [40.77, 29.92],
  kahramanmaras: [37.58, 36.93], karabuk: [41.20, 32.63], karaman: [37.18, 33.22],
  kars: [40.60, 43.10], kastamonu: [41.39, 33.78], kayseri: [38.73, 35.49],
  kilis: [36.72, 37.12], kirikkale: [39.85, 33.52], kirklareli: [41.74, 27.22],
  kirsehir: [39.15, 34.16], kocaeli: [40.85, 29.88], konya: [37.87, 32.48],
  kutahya: [39.42, 29.98], malatya: [38.35, 38.31], manisa: [38.62, 27.43],
  mardin: [37.31, 40.74], mersin: [36.80, 34.63], mugla: [37.22, 28.36],
  mus: [38.73, 41.49], nevsehir: [38.62, 34.71], nigde: [37.97, 34.68],
  ordu: [40.98, 37.88], osmaniye: [37.07, 36.25], rize: [41.02, 40.52],
  sakarya: [40.78, 30.40], samsun: [41.29, 36.33], sanliurfa: [37.16, 38.80],
  siirt: [37.93, 41.94], sinop: [42.03, 35.15], sivas: [39.75, 37.02],
  sirnak: [37.52, 42.45], tekirdag: [40.98, 27.51], tokat: [40.31, 36.55],
  trabzon: [41.00, 39.72], tunceli: [39.11, 39.55], usak: [38.68, 29.41],
  van: [38.49, 43.38], yalova: [40.65, 29.28], yozgat: [39.82, 34.81],
  zonguldak: [41.45, 31.79],
};

/* Türkçe 'İ' toLowerCase'te birleşik nokta üretir → düz replace tutmaz.
   NFD ile birleşik işaretler ayıklanır ('ş','ğ','ü','ö','ç' de sadeleşir). */
function trSlugTR(x) {
  return String(x || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

function tahminEt(ad) {
  const t = trSlugTR(ad);
  for (const [il, koord] of Object.entries(TR_IL)) {
    if (t.includes(il)) return { lat: koord[0], lon: koord[1], label: il.charAt(0).toUpperCase() + il.slice(1) };
  }
  return null;
}

async function getAllGeo() {
  const rows = await db()('location_geo').select('*');
  const map = {};
  rows.forEach(r => { map[r.location] = { lat: r.lat, lon: r.lon, label: r.label, source: r.source }; });
  return map;
}

async function setGeo(location, { lat, lon, label = null, by = 'system', source = 'manuel' }) {
  const ad = norm(location);
  const la = Number(lat), lo = Number(lon);
  if (!ad) throw new Error('Lokasyon adı boş olamaz.');
  if (!Number.isFinite(la) || la < -90 || la > 90) throw new Error('Enlem -90 ile 90 arasında olmalı.');
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) throw new Error('Boylam -180 ile 180 arasında olmalı.');
  const row = { location: ad, lat: la, lon: lo, label, source, set_at: nowIso(), set_by: by };
  const k = db();
  const varMi = await k('location_geo').where({ location: ad }).first();
  if (varMi) await k('location_geo').where({ location: ad }).update(row);
  else await k('location_geo').insert(row);
  return row;
}

async function deleteGeo(location) {
  await db()('location_geo').where({ location: norm(location) }).del();
}

/* Envanterdeki lokasyon adlarından, il adı geçenleri otomatik tohumla.
   Zaten kaydı olanlara DOKUNMAZ (elle girilen koordinat ezilmez). */
async function seedGeoFromNames(locations) {
  const mevcut = await getAllGeo();
  let eklendi = 0;
  const eslesmeyen = [];
  for (const ad of locations || []) {
    const a = norm(ad);
    if (!a || mevcut[a]) continue;
    const t = tahminEt(a);
    if (!t) { eslesmeyen.push(a); continue; }
    await setGeo(a, { ...t, by: 'seed', source: 'seed' });
    eklendi++;
  }
  return { eklendi, eslesmeyen };
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
  detectLocationDrift, getLocationSummary, seedExpectedFromAssets,
  getAllGeo, setGeo, deleteGeo, seedGeoFromNames,
};
