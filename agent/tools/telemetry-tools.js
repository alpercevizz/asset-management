// ── Canlı Telemetri + Güvenlik Durumu ──────────────────────────────────────
// Ölçümler collector'dan /api/webhook ile gelir. Envanter sağlayıcıdan
// (baserow|sql) BAĞIMSIZ: ayrı SQL tablolarında tutulur.
//
// VERİ DÜRÜSTLÜĞÜ: burada hiçbir değer türetilmez, tahmin edilmez veya
// varsayılana çekilmez. Cihaz göndermediyse alan NULL kalır ve arayüz
// "veri gelmedi" der. Bir sunucuda pil, bir sanal makinede sıcaklık
// OLMADIĞI için sıfır yazmak yanlış olurdu.
const { db } = require('../../db');

const SAKLAMA_GUN = Number(process.env.TELEMETRY_RETENTION_DAYS || 30);

function nowIso() { return new Date().toISOString(); }

const sayi = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const araliktaSayi = (v, alt, ust) => {
  const n = sayi(v);
  if (n === null) return null;
  return n < alt ? alt : n > ust ? ust : n;
};
const metin = (v, uzunluk) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, uzunluk) : null;
};

/* ══ Ölçüm kaydı ═══════════════════════════════════════════════════════════
   Tek bir ölçüm satırı ekler. Tüm alanlar opsiyonel — cihaz neyi
   okuyabiliyorsa onu gönderir. Hiçbiri yoksa satır AÇILMAZ (boş satır
   grafikte delik açar, "ölçüm alındı" yalanı söyler). */
async function recordTelemetry(assetId, t = {}) {
  const id = Number(assetId);
  if (!Number.isInteger(id)) throw new Error('assetId geçersiz');

  const satir = {
    asset_id: id,
    measured_at: nowIso(),
    cpu_pct:      araliktaSayi(t.cpu_pct, 0, 100),
    ram_used_gb:  sayi(t.ram_used_gb),
    ram_total_gb: sayi(t.ram_total_gb),
    disk_used_gb: sayi(t.disk_used_gb),
    disk_total_gb: sayi(t.disk_total_gb),
    net_rx_mbps:  sayi(t.net_rx_mbps),
    net_tx_mbps:  sayi(t.net_tx_mbps),
    battery_pct:  araliktaSayi(t.battery_pct, 0, 100),
    battery_state: metin(t.battery_state, 24),
    temp_c:       sayi(t.temp_c),
  };

  const olcumVar = ['cpu_pct', 'ram_used_gb', 'disk_used_gb', 'net_rx_mbps',
    'net_tx_mbps', 'battery_pct', 'temp_c'].some((k) => satir[k] !== null);
  if (!olcumVar) return null;

  const [row] = await db()('asset_telemetry').insert(satir).returning('id');
  await pruneOld(id);
  return row?.id ?? row ?? null;
}

/* Saklama penceresi dışındaki ölçümleri siler. Dakikada bir ölçüm × 500 cihaz
   × sınırsız süre tabloyu şişirir; grafik zaten son 24 saati gösteriyor. */
async function pruneOld(assetId) {
  const sinir = new Date(Date.now() - SAKLAMA_GUN * 86400000).toISOString();
  await db()('asset_telemetry').where({ asset_id: Number(assetId) })
    .andWhere('measured_at', '<', sinir).del();
}

/* En son ölçüm. Yoksa null döner — arayüz bunu "veri gelmedi" olarak gösterir. */
async function getLatest(assetId) {
  return db()('asset_telemetry').where({ asset_id: Number(assetId) })
    .orderBy('id', 'desc').first() || null;
}

/* Grafik serisi. Son `saat` saatteki ölçümler, eskiden yeniye.
   En fazla `nokta` örnek döndürülür — 1440 ölçümü tarayıcıya yollamanın
   anlamı yok, sparkline 40 noktada da aynı şekli çiziyor. */
async function getSeries(assetId, { saat = 24, nokta = 40 } = {}) {
  const sinir = new Date(Date.now() - saat * 3600000).toISOString();
  const satirlar = await db()('asset_telemetry')
    .where({ asset_id: Number(assetId) })
    .andWhere('measured_at', '>=', sinir)
    .orderBy('id', 'asc');
  if (satirlar.length <= nokta) return satirlar;
  // Eşit aralıklı örnekleme (son nokta HER ZAMAN korunur — en güncel değer)
  const adim = (satirlar.length - 1) / (nokta - 1);
  return Array.from({ length: nokta }, (_, i) => satirlar[Math.round(i * adim)]);
}

/* ══ Güvenlik durumu ═══════════════════════════════════════════════════════ */
const DURUM = ['aktif', 'pasif', 'yok', 'bilinmiyor'];
const guvenlikDurum = (v) => {
  const s = String(v ?? '').toLowerCase().trim();
  if (['true', '1', 'on', 'enabled', 'aktif', 'active'].includes(s)) return 'aktif';
  if (['false', '0', 'off', 'disabled', 'pasif', 'inactive'].includes(s)) return 'pasif';
  return DURUM.includes(s) ? s : null;
};

async function recordSecurity(assetId, s = {}) {
  const id = Number(assetId);
  if (!Number.isInteger(id)) throw new Error('assetId geçersiz');

  const satir = {
    asset_id: id,
    checked_at: nowIso(),
    defender:        guvenlikDurum(s.defender),
    firewall:        guvenlikDurum(s.firewall),
    disk_encryption: guvenlikDurum(s.disk_encryption ?? s.bitlocker),
    antivirus:       guvenlikDurum(s.antivirus),
    antivirus_name:  metin(s.antivirus_name, 96),
    os_update:       ['guncel', 'bekliyor', 'bilinmiyor'].includes(String(s.os_update || '').toLowerCase())
      ? String(s.os_update).toLowerCase() : null,
    critical_patches: sayi(s.critical_patches),
    pending_updates:  sayi(s.pending_updates),
  };
  // Hiçbir güvenlik alanı gelmediyse kayıt AÇMA — boş kart "kontrol edildi,
  // her şey bilinmiyor" izlenimi verirdi.
  const veriVar = Object.keys(satir).some((k) =>
    !['asset_id', 'checked_at'].includes(k) && satir[k] !== null);
  if (!veriVar) return null;

  const mevcut = await db()('asset_security').where({ asset_id: id }).first();
  if (mevcut) await db()('asset_security').where({ asset_id: id }).update(satir);
  else await db()('asset_security').insert(satir);
  return satir;
}

async function getSecurity(assetId) {
  return db()('asset_security').where({ asset_id: Number(assetId) }).first() || null;
}

module.exports = {
  recordTelemetry, getLatest, getSeries, pruneOld,
  recordSecurity, getSecurity, SAKLAMA_GUN,
};
