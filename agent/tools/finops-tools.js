// ── Dinamik FinOps — Döviz Endeksli Bütçe Motoru ────────────────────────────
// Cihaz fiyatları USD bazında tutulur; anlık USD/TRY + EUR/TRY paritesiyle TRY'ye çevrilir.
// 12 aylık bütçe her hesapta güncel kurla yeniden hesaplanır → kur değişince oto-güncellenir.
//
// KUR KAYNAĞI (FX_PROVIDER):
//  • live (varsayılan): frankfurter.app (ECB referans kuru, ücretsiz, anahtarsız). Sonuç önbelleğe alınır
//    (FX_CACHE_TTL_MS, varsayılan 60dk) ve data/fx-cache.json'a yazılır. API erişilemezse önbelleğe/diske,
//    o da yoksa FX_BASE'e düşer → sistem çevrimdışı da çalışır. NOT: FX kuru hassas değil → dış çıkış
//    kapalı-devre ilkesini bozmaz. Yine de tam izole kurulum için FX_PROVIDER=static kullanılabilir.
//  • static: hiç dış istek yapmaz, FX_BASE sabit kurunu döndürür.
const fs = require('fs');
const path = require('path');

// Kategori bazlı GÜNCEL distribütör liste fiyatı (USD). (Simüle B2B fiyat listesi.)
const PRICE_USD = {
  'Bilgisayar': 950, 'Sunucu': 6000, 'Telefon': 750, 'Tablet': 550,
  'El Terminali': 680, 'Yazıcı': 300, 'Ağ Aygıtı': 1200, 'Çevre Aygıtı': 120, 'Diğer': 400,
};

// Çevrimdışı/başlangıç baz pariteleri (API erişilemezse son çare).
const FX_BASE = { USD_TRY: 47.0, EUR_TRY: 53.5 };

const FX_PROVIDER   = () => (process.env.FX_PROVIDER || 'live').toLowerCase();
const FX_API_URL    = () => process.env.FX_API_URL || 'https://api.frankfurter.app/latest?from=USD&to=TRY,EUR';
const FX_CACHE_TTL  = () => Number(process.env.FX_CACHE_TTL_MS) || 60 * 60 * 1000; // 60 dk
const FX_TIMEOUT_MS = () => Number(process.env.FX_TIMEOUT_MS) || 6000;
const CACHE_FILE    = path.join(__dirname, '..', '..', 'data', 'fx-cache.json');

let _mem = null; // { data, ts }

function readDiskCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; }
}
function writeDiskCache(obj) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2)); } catch (e) { /* yoksay */ }
}

function trendVs(prevUsd, usd) {
  if (prevUsd == null) return 'flat';
  if (usd > prevUsd) return 'up';
  if (usd < prevUsd) return 'down';
  return 'flat';
}

async function fetchLiveRates() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FX_TIMEOUT_MS());
  try {
    const res = await fetch(FX_API_URL(), { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const usdTry = d.rates && d.rates.TRY;
    const usdEur = d.rates && d.rates.EUR;
    if (!usdTry || !usdEur) throw new Error('Beklenen kur alanları yok');
    const usd = +usdTry.toFixed(4);
    const eur = +(usdTry / usdEur).toFixed(4); // EUR/TRY = (USD/TRY) / (USD/EUR)
    return { USD_TRY: usd, EUR_TRY: eur, date: d.date };
  } finally {
    clearTimeout(timer);
  }
}

// ── Ana giriş: async — canlı kur (önbellekli) veya statik/fallback ──────────────
async function getFxRates() {
  // Statik mod: hiç dış istek yok
  if (FX_PROVIDER() === 'static') {
    return {
      source: 'Sabit kur (FX_PROVIDER=static)',
      fetched_at: new Date().toISOString(),
      USD_TRY: FX_BASE.USD_TRY, EUR_TRY: FX_BASE.EUR_TRY,
      usd_trend: 'flat', stale: false,
    };
  }

  // Bellek önbelleği taze mi?
  if (_mem && (Date.now() - _mem.ts) < FX_CACHE_TTL()) {
    return { ..._mem.data, source: _mem.data.source + ' (önbellek)' };
  }

  const disk = readDiskCache();
  const prevUsd = disk && disk.USD_TRY;

  try {
    const live = await fetchLiveRates();
    const data = {
      source: 'frankfurter.app (ECB referans kuru)',
      fetched_at: new Date().toISOString(),
      USD_TRY: live.USD_TRY, EUR_TRY: live.EUR_TRY,
      usd_trend: trendVs(prevUsd, live.USD_TRY),
      stale: false,
    };
    _mem = { data, ts: Date.now() };
    writeDiskCache({ ...data, prev_usd: prevUsd });
    return data;
  } catch (err) {
    // Fallback: disk önbelleği → yoksa FX_BASE
    if (disk && disk.USD_TRY) {
      return {
        source: `Son bilinen kur (${disk.date || (disk.fetched_at || '').slice(0, 10)}) — API erişilemedi`,
        fetched_at: disk.fetched_at || new Date().toISOString(),
        USD_TRY: disk.USD_TRY, EUR_TRY: disk.EUR_TRY,
        usd_trend: disk.usd_trend || 'flat', stale: true,
      };
    }
    return {
      source: 'Varsayılan kur (API erişilemedi, önbellek yok)',
      fetched_at: new Date().toISOString(),
      USD_TRY: FX_BASE.USD_TRY, EUR_TRY: FX_BASE.EUR_TRY,
      usd_trend: 'flat', stale: true,
    };
  }
}

function getDistributorPrices() {
  return { currency: 'USD', source: 'Distribütör B2B Fiyat Listesi', updated_at: new Date().toISOString(), prices: { ...PRICE_USD } };
}

// Bir kategorinin TRY maliyetini güncel kurla hesapla
function costFor(category, fx) {
  const usd = PRICE_USD[category] != null ? PRICE_USD[category] : PRICE_USD['Diğer'];
  const rate = (fx && fx.USD_TRY) || FX_BASE.USD_TRY;
  return { usd, try: Math.round(usd * rate), eur: +(usd * (fx ? fx.USD_TRY / fx.EUR_TRY : FX_BASE.USD_TRY / FX_BASE.EUR_TRY)).toFixed(0) };
}

module.exports = { PRICE_USD, FX_BASE, getFxRates, getDistributorPrices, costFor };
