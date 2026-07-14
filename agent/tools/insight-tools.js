// ── Öngörü Katmanı: Risk Skoru + Yenileme/Maliyet Tahmini ────────────────────
// Mevcut deterministik tespitleri (EOL, garanti, offline, donanım, lisans, yaşam döngüsü)
// TEK bir cihaz-bazlı risk skoruna ve 12 aylık yenileme/bütçe öngörüsüne dönüştürür.
// Yeni veri/şema GEREKTİRMEZ — var olan sinyalleri birleştirir. LLM'siz, deterministik.
const { getAllAssets } = require('./baserow-tools');
const { detectEolOs, detectWarranty, detectOfflineDevices, detectLicenseCompliance, detectAnomalies } = require('./anomaly-tools');
const { detectLifecycleConflicts } = require('./lifecycle-tools');
const { getFxRates, getDistributorPrices, costFor } = require('./finops-tools');

const keyOf = (a) => a.serial_number || a.hostname || ('id:' + a.id);

// ── Risk skoru ───────────────────────────────────────────────────────────────
// Her sinyal cihazın skoruna ağırlıklı puan ekler (0-100 arası kırpılır).
function levelOf(score) {
  if (score >= 70) return 'Kritik';
  if (score >= 45) return 'Yüksek';
  if (score >= 20) return 'Orta';
  return 'Düşük';
}

async function computeRiskScores(orgId) {
  const [data, eol, warranty, offline, compliance, anomalies, lifecycle] = await Promise.all([
    getAllAssets({ orgId, size: 200 }),
    detectEolOs(orgId),
    detectWarranty(orgId),
    detectOfflineDevices(orgId),
    detectLicenseCompliance(orgId),
    detectAnomalies(orgId),
    detectLifecycleConflicts(orgId),
  ]);
  const assets = data.results || [];

  // cihaz → { score, factors[] }
  const map = new Map();
  for (const a of assets) map.set(keyOf(a), { asset: a, score: 0, factors: [] });
  const add = (matchHost, matchSerial, points, label) => {
    // hostname veya serial ile eşleştir
    for (const [, v] of map) {
      const a = v.asset;
      if ((matchSerial && a.serial_number === matchSerial) || (matchHost && a.hostname === matchHost)) {
        v.score += points; v.factors.push({ points, label }); return;
      }
    }
  };

  // EOL OS
  (eol.eol?.items || []).forEach(d => add(d.hostname, null, 30, `İşletim sistemi desteği BİTMİŞ (${d.os_family})`));
  (eol.approaching?.items || []).forEach(d => add(d.hostname, null, 12, `İşletim sistemi desteği yakında bitecek (${d.os_family})`));
  // Garanti
  (warranty.expired?.items || []).forEach(d => add(d.hostname, null, 15, 'Garanti süresi dolmuş'));
  (warranty.expiring_soon?.items || []).forEach(d => add(d.hostname, null, 6, 'Garanti yakında bitecek'));
  // Çevrimdışı / kayıp izi
  (offline.offline?.items || []).forEach(d => add(d.hostname, null, 15, 'Cihaz çevrimdışı'));
  (offline.stale?.items || []).forEach(d => add(d.hostname, null, 20, '7+ gündür ağda görünmüyor'));
  // Donanım
  (anomalies.low_ram?.items || []).forEach(d => add(d.hostname, null, 8, `Düşük RAM (${d.ram_gb} GB)`));
  (anomalies.low_disk?.items || []).forEach(d => add(d.hostname, null, 8, `Düşük disk (${d.storage_gb} GB)`));
  (anomalies.long_uptime?.items || []).forEach(d => add(d.hostname, null, 5, `${d.uptime_days} gün kesintisiz açık`));
  // Lisans (hostname bazlı)
  (compliance.unlicensed?.items || []).forEach(l => add(l.hostname, null, 10, `Lisanssız yazılım (${l.software_name})`));
  (compliance.expired?.items || []).forEach(l => add(l.hostname, null, 8, `Süresi dolmuş lisans (${l.software_name})`));
  (compliance.expiring_soon?.items || []).forEach(l => add(l.hostname, null, 4, `Yakında dolacak lisans (${l.software_name})`));
  // Yaşam döngüsü / güvenlik (en ağır sinyaller)
  const lcWeight = {
    kritik_kayip: 40, kayip: 30, imzasiz_kritik_islem: 35, onay_zaman_asimi: 30,
    depoda_ama_aktif: 25, kayip_suphesi: 20, onay_bekliyor: 8,
  };
  const lcLabel = {
    kritik_kayip: 'KRİTİK cihaz kayıp', kayip: 'Cihaz kayıp/belirsiz',
    imzasiz_kritik_islem: 'İmzasız kritik işlem (güvenlik ihlali)', onay_zaman_asimi: 'Onay süresi doldu (yetkisiz)',
    depoda_ama_aktif: 'Depoda görünüp ağda aktif', kayip_suphesi: 'Kayıp şüphesi (depo girişi yok)',
    onay_bekliyor: 'Dijital onay bekliyor',
  };
  (lifecycle.conflicts || []).forEach(c => {
    const pts = lcWeight[c.type] || 10;
    let label = lcLabel[c.type] || c.type;
    if (c.mfa_verified === false) label += ' · MFA bypass';
    add(c.hostname, c.serial_number, pts, label);
  });

  const items = [];
  for (const [, v] of map) {
    const score = Math.min(100, Math.round(v.score));
    items.push({
      hostname: v.asset.hostname || '—',
      serial_number: v.asset.serial_number || '—',
      category: v.asset.category || '—',
      username: v.asset.username || '—',
      score,
      level: levelOf(score),
      factors: v.factors.sort((a, b) => b.points - a.points),
    });
  }
  items.sort((a, b) => b.score - a.score);

  const dist = { critical: 0, high: 0, medium: 0, low: 0 };
  items.forEach(i => {
    if (i.level === 'Kritik') dist.critical++;
    else if (i.level === 'Yüksek') dist.high++;
    else if (i.level === 'Orta') dist.medium++;
    else dist.low++;
  });
  const atRisk = items.filter(i => i.score >= 20);
  const avg = items.length ? Math.round(items.reduce((s, i) => s + i.score, 0) / items.length) : 0;

  return {
    total_assets: items.length,
    average_score: avg,
    distribution: dist,
    at_risk_count: atRisk.length,
    items, // skora göre azalan
  };
}

// ── Yenileme & Maliyet Öngörüsü (12 ay, DÖVİZ ENDEKSLİ) ──────────────────────
// Sürücüler: garanti bitiş tarihi + işletim sistemi EOL tarihi. En erken olan = yenileme tarihi.
// Maliyet: distribütör USD fiyatı × anlık USD/TRY paritesi (finops-tools). Kur değişince bütçe oto-güncellenir.
const HORIZON_MONTHS = 12;

async function computeRenewalForecast(orgId) {
  const [data, eol] = await Promise.all([
    getAllAssets({ orgId, size: 200 }),
    detectEolOs(orgId),
  ]);
  const assets = data.results || [];

  // hostname → en erken EOL tarihi
  const eolMap = {};
  [...(eol.eol?.items || []), ...(eol.approaching?.items || [])].forEach(d => {
    if (!eolMap[d.hostname] || d.eol_date < eolMap[d.hostname]) eolMap[d.hostname] = d.eol_date;
  });

  // DİNAMİK FinOps: anlık parite + distribütör USD fiyatları (kur değişince bütçe oto-güncellenir)
  const fx = await getFxRates();

  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_MONTHS * 30 * 24 * 3600 * 1000);
  const items = [];

  for (const a of assets) {
    const candidates = [];
    if (a.warranty_expiry) candidates.push({ date: a.warranty_expiry, reason: 'Garanti bitişi' });
    if (eolMap[a.hostname]) candidates.push({ date: eolMap[a.hostname], reason: 'İşletim sistemi EOL' });
    if (!candidates.length) continue;

    // en erken tarih = yenileme tetikleyici
    candidates.sort((x, y) => new Date(x.date) - new Date(y.date));
    const due = candidates[0];
    const dueDate = new Date(due.date);
    if (isNaN(dueDate)) continue;
    if (dueDate > horizon) continue; // 12 ay dışında → öngörüye dahil değil

    const monthsLeft = Math.round((dueDate - now) / (30 * 24 * 3600 * 1000));
    const c = costFor(a.category || 'Diğer', fx); // { usd, try, eur }
    items.push({
      hostname: a.hostname || '—',
      serial_number: a.serial_number || '—',
      category: a.category || 'Diğer',
      username: a.username || '—',
      reason: due.reason + (candidates.length > 1 ? ' (+diğer)' : ''),
      due_date: due.date,
      months_left: monthsLeft,
      overdue: dueDate < now,
      est_cost: c.try,       // güncel kurla TRY
      est_cost_usd: c.usd,   // USD baz (kurdan bağımsız)
    });
  }

  items.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  // Çeyreklik dağılım (gelecek 0-3 / 3-6 / 6-9 / 9-12 ay) + gecikmiş
  const buckets = { gecikmis: { label: 'Gecikmiş / Acil', count: 0, cost: 0 }, q1: { label: '0-3 ay', count: 0, cost: 0 }, q2: { label: '3-6 ay', count: 0, cost: 0 }, q3: { label: '6-9 ay', count: 0, cost: 0 }, q4: { label: '9-12 ay', count: 0, cost: 0 } };
  const byCategory = {};
  let total = 0, totalUsd = 0;
  for (const it of items) {
    total += it.est_cost; totalUsd += it.est_cost_usd;
    byCategory[it.category] = byCategory[it.category] || { count: 0, cost: 0 };
    byCategory[it.category].count++; byCategory[it.category].cost += it.est_cost;
    let b;
    if (it.overdue) b = buckets.gecikmis;
    else if (it.months_left <= 3) b = buckets.q1;
    else if (it.months_left <= 6) b = buckets.q2;
    else if (it.months_left <= 9) b = buckets.q3;
    else b = buckets.q4;
    b.count++; b.cost += it.est_cost;
  }

  return {
    horizon_months: HORIZON_MONTHS,
    currency: 'TRY',
    fx,                                  // {USD_TRY, EUR_TRY, source, fetched_at, usd_trend}
    total_count: items.length,
    total_estimated_cost: total,         // güncel kurla TRY
    total_estimated_cost_usd: totalUsd,  // kurdan bağımsız USD
    overdue_count: items.filter(i => i.overdue).length,
    by_period: buckets,
    by_category: byCategory,
    price_table_usd: getDistributorPrices().prices,
    items,
  };
}

module.exports = { computeRiskScores, computeRenewalForecast, levelOf };
