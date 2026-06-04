// ── Dinamik FinOps — Döviz Endeksli Bütçe Motoru ────────────────────────────
// Statik TL fiyatları enflasyonist/dalgalı pazarda hızla eskir. Bunun yerine:
//  • Cihaz fiyatları USD bazında tutulur (distribütör API'sinden — simüle).
//  • Anlık USD/TRY ve EUR/TRY paritesi (parite API'sinden — simüle, zamanla DRIFT eder).
//  • 12 aylık bütçe öngörüsü her hesapta güncel kurla yeniden hesaplanır → kur değişince oto-güncellenir.
// Gerçekte getFxRates/getDistributorPrices canlı bir API'ye (TCMB, distribütör B2B) bağlanır; sözleşme aynı.

// Kategori bazlı GÜNCEL distribütör liste fiyatı (USD). (Simüle B2B fiyat listesi.)
const PRICE_USD = {
  'Bilgisayar': 950, 'Sunucu': 6000, 'Telefon': 750, 'Tablet': 550,
  'El Terminali': 680, 'Yazıcı': 300, 'Ağ Aygıtı': 1200, 'Çevre Aygıtı': 120, 'Diğer': 400,
};

// Baz pariteler (simüle). Gerçekte canlı API'den gelir.
const FX_BASE = { USD_TRY: 39.5, EUR_TRY: 43.0 };

// Simüle parite API: zamanla hafif DRIFT eder (±~2%), böylece "canlı/dalgalı" his verir
// ve 12 aylık bütçe her çağrıda güncel kurla değişir. Deterministik (Date'e bağlı) → tekrarlanabilir.
function getFxRates() {
  const t = Date.now();
  const drift = (periodMin, amp) => 1 + amp * Math.sin(t / (1000 * 60 * periodMin));
  const usd = +(FX_BASE.USD_TRY * drift(7, 0.02)).toFixed(4);
  const eur = +(FX_BASE.EUR_TRY * drift(11, 0.02)).toFixed(4);
  const prevUsd = +(FX_BASE.USD_TRY * (1 + 0.02 * Math.sin((t - 60000) / (1000 * 60 * 7)))).toFixed(4);
  return {
    source: 'Simüle Distribütör/Parite API',
    fetched_at: new Date().toISOString(),
    USD_TRY: usd,
    EUR_TRY: eur,
    usd_trend: usd >= prevUsd ? 'up' : 'down',
  };
}

function getDistributorPrices() {
  return { currency: 'USD', source: 'Simüle Distribütör B2B Fiyat Listesi', updated_at: new Date().toISOString(), prices: { ...PRICE_USD } };
}

// Bir kategorinin TRY maliyetini güncel kurla hesapla
function costFor(category, fx) {
  const usd = PRICE_USD[category] != null ? PRICE_USD[category] : PRICE_USD['Diğer'];
  const rate = (fx && fx.USD_TRY) || FX_BASE.USD_TRY;
  return { usd, try: Math.round(usd * rate), eur: +(usd * (fx ? fx.USD_TRY / fx.EUR_TRY : FX_BASE.USD_TRY / FX_BASE.EUR_TRY)).toFixed(0) };
}

module.exports = { PRICE_USD, FX_BASE, getFxRates, getDistributorPrices, costFor };
