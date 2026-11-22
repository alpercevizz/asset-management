/* ════════════════════════════════════════════════════════════════════════════
   DEMO SEED — assetmandemo.alperceviz.com için zengin demo veri.
   AYRI demo instance'ta çalışır (kendi DB'si). Her açılışta önce TEMİZLER sonra
   doldurur → demo ziyaretçilerinin değişiklikleri restart'ta sıfırlanır.
   assets + location_geo + licenses + phone_lines/line_assignments burada;
   resmi zimmet + yaşam döngüsü server.js boot seed'inde (SEED_DEMO=true).

   ÇALIŞTIRMA (demo container komutu):
     node scripts/seed-demo.js && node server.js
   ════════════════════════════════════════════════════════════════════════════ */
const dbMod = require('../db');
const loc = require('../agent/tools/location-tools');
const lineTools = require('../agent/tools/line-tools');

const now = Date.now();
const iso = (gunOnce) => new Date(now - gunOnce * 864e5).toISOString();
const tarih = (gunSonra) => new Date(now + gunSonra * 864e5).toISOString().slice(0, 10);

// Lokasyon adları il adı İÇERİR → seedGeoFromNames haritaya pin koyar.
const LOK = ['İstanbul Genel Merkez', 'Kocaeli Depo', 'Ankara Şube', 'İzmir Bölge', 'Bursa Fabrika'];

// ── Varlıklar ─────────────────────────────────────────────────────────────────
const assets = [];
let id = 0;
const ek = (o) => assets.push({ id: ++id, created_on: iso(150), ...o });

const BILG = [
  ['ALPER-PC', 'Dell', 'Latitude 5540', 16, 512, 'Windows 11', 'alper.ceviz', 0, 'Intel Core i7-1365U'],
  ['MUHASEBE-01', 'HP', 'EliteDesk 800 G9', 16, 512, 'Windows 11', 'ayse.kaya', 1, 'Intel Core i5-13500'],
  ['MUHASEBE-02', 'HP', 'EliteDesk 800 G6', 8, 256, 'Windows 10', 'fatma.demir', 2, 'Intel Core i5-10500'],
  ['SATIS-PC-01', 'Lenovo', 'ThinkPad E14', 16, 512, 'Windows 11', 'mehmet.yilmaz', 1, 'Intel Core i5-1335U'],
  ['SATIS-PC-02', 'Lenovo', 'ThinkPad E14', 8, 256, 'Windows 10', 'can.ozturk', 45, 'Intel Core i3-1115G4'],
  ['YONETIM-PC', 'Apple', 'MacBook Pro 14', 32, 1024, 'macOS 14', 'genel.mudur', 3, 'Apple M3 Pro'],
  ['IK-PC-01', 'Dell', 'OptiPlex 7010', 16, 512, 'Windows 11', 'zeynep.korkmaz', 2, 'Intel Core i5-13500'],
  ['DESTEK-PC-01', 'HP', 'ProDesk 400 G7', 8, 256, 'Windows 10', 'destek.1', 5, 'Intel Core i5-10500'],
  ['DESTEK-PC-02', 'HP', 'ProDesk 400 G7', 8, 256, 'Windows 10', 'destek.2', 62, 'Intel Core i5-10500'],
  ['GRAFIK-WS', 'Dell', 'Precision 3660', 64, 2048, 'Windows 11', 'tasarim', 1, 'Intel Core i9-13900'],
  ['SAHA-NB-01', 'Lenovo', 'ThinkPad L15', 16, 512, 'Windows 11', 'saha.muh', 6, 'AMD Ryzen 5 PRO'],
  ['SATINALMA-PC', 'HP', 'EliteBook 840', 16, 512, 'Windows 11', 'satinalma', 1, 'Intel Core i7-1355U'],
  ['LOJISTIK-PC-01', 'Casper', 'Nirvana C600', 8, 256, 'Windows 10', 'lojistik.1', 4, 'Intel Core i5-1135G7'],
  ['URETIM-PC-01', 'HP', 'ProDesk 400 G6', 8, 480, 'Windows 10', 'uretim.1', 30, 'Intel Core i5-10400'],
];
BILG.forEach((a, i) => ek({
  hostname: a[0], serial_number: 'DLBIL' + String(1000 + i), category: 'Bilgisayar', brand: a[1], model: a[2],
  ram_gb: a[3], storage_gb: a[4], os: a[5], os_arch: 'x64', username: a[6], uptime_days: a[7], cpu: a[8],
  cpu_cores: 8, cpu_threads: 16, ip_address: '10.0.1.' + (20 + i), mac_address: 'A4:C3:F0:' + String(10 + i).padStart(2, '0') + ':34:11',
  domain: 'kurumsal.local', location: LOK[i % 5], status: a[7] > 30 ? 'offline' : 'online',
  last_seen: iso(a[7] > 30 ? a[7] : 0), warranty_expiry: ['2024-09-01', '2026-03-15', '2027-06-20', '2025-11-01', '2026-08-10'][i % 5], collector_ver: '1.2.0',
}));

const SRV = [
  ['SRV-DC01', 'Dell', 'PowerEdge R650', 128, 4096, 640, '2027-09-01'],
  ['SRV-FILE01', 'HPE', 'ProLiant DL380 Gen10', 64, 16384, 420, '2024-02-01'],
  ['SRV-APP01', 'Dell', 'PowerEdge R450', 64, 2048, 180, '2026-12-01'],
  ['SRV-BACKUP01', 'HPE', 'ProLiant DL360 Gen10', 32, 32768, 310, '2025-07-15'],
];
SRV.forEach((a, i) => ek({
  hostname: a[0], serial_number: 'SRV' + String(200 + i), category: 'Sunucu', brand: a[1], model: a[2], ram_gb: a[3],
  storage_gb: a[4], os: 'Windows Server 2022', os_arch: 'x64', uptime_days: a[5], cpu: 'Intel Xeon Silver 4310',
  cpu_cores: 12, cpu_threads: 24, ip_address: '10.0.0.' + (10 + i), mac_address: 'B8:27:EB:' + String(20 + i) + ':55:66',
  location: 'İstanbul Genel Merkez', status: 'online', last_seen: iso(0), warranty_expiry: a[6], collector_ver: '1.2.0',
}));

const MOB = [
  ['SATIS-TEL-01', 'Apple', 'iPhone 14', 'iOS 17.5', 'Telefon', 'mehmet.yilmaz'],
  ['SATIS-TEL-02', 'Samsung', 'Galaxy S23', 'Android 14', 'Telefon', 'can.ozturk'],
  ['SAHA-TEL-01', 'Samsung', 'Galaxy A54', 'Android 13', 'Telefon', 'saha.muh'],
  ['YONETIM-TEL', 'Apple', 'iPhone 15 Pro', 'iOS 17.5', 'Telefon', 'genel.mudur'],
  ['DEPO-TAB-01', 'Samsung', 'Galaxy Tab S9', 'Android 14', 'Tablet', 'lojistik.1'],
  ['YONETIM-TAB', 'Apple', 'iPad Pro 11', 'iPadOS 17', 'Tablet', 'genel.mudur'],
];
MOB.forEach((a, i) => ek({
  hostname: a[0], serial_number: 'MOB' + String(300 + i), category: a[4], brand: a[1], model: a[2], os: a[3],
  username: a[5], location: LOK[i % 5], status: 'online', last_seen: iso(0),
  warranty_expiry: ['2026-05-01', '2025-10-01', '2026-01-01', '2027-02-01', '2026-07-01', '2025-09-01'][i % 6], collector_ver: 'qr-1.0.0',
}));

// Yazıcı / Ağ / El Terminali / Çevre / Depoda
ek({ hostname: 'PRN-MUHASEBE', serial_number: 'CNBJ123456', category: 'Yazıcı', brand: 'HP', model: 'LaserJet M507dn', location: 'İstanbul Genel Merkez', status: 'online', last_seen: iso(0), ip_address: '10.0.3.21', collector_ver: 'snmp-1.0', warranty_expiry: '2026-04-01' });
ek({ hostname: 'PRN-DEPO', serial_number: 'KYO778899', category: 'Yazıcı', brand: 'Kyocera', model: 'ECOSYS P3155dn', location: 'Kocaeli Depo', status: 'online', last_seen: iso(0), ip_address: '10.0.3.22', collector_ver: 'snmp-1.0', warranty_expiry: '2024-12-01' });
ek({ hostname: 'SW-CORE-01', serial_number: 'FOC2145X0AB', category: 'Ağ Aygıtı', brand: 'Cisco', model: 'Catalyst C2960X-48FPS', location: 'İstanbul Genel Merkez', status: 'online', last_seen: iso(0), ip_address: '10.0.0.2', uptime_days: 220, collector_ver: 'snmp-1.0' });
ek({ hostname: 'SW-DEPO-01', serial_number: 'FOC3100Z1CD', category: 'Ağ Aygıtı', brand: 'Cisco', model: 'Catalyst C1000-24T', location: 'Kocaeli Depo', status: 'online', last_seen: iso(0), ip_address: '10.0.10.2', uptime_days: 140, collector_ver: 'snmp-1.0' });
ek({ hostname: 'FW-HQ-01', serial_number: 'C2104A5F9E12', category: 'Ağ Aygıtı', brand: 'Sophos', model: 'XG 210', location: 'İstanbul Genel Merkez', status: 'online', last_seen: iso(0), ip_address: '10.0.0.1', uptime_days: 95, collector_ver: 'snmp-1.0' });
ek({ hostname: 'RED-IZMIR-01', serial_number: 'R20IZM000123', category: 'Ağ Aygıtı', brand: 'Sophos', model: 'RED 20', location: 'İzmir Bölge', status: 'online', last_seen: iso(0), ip_address: '10.0.20.1', uptime_days: 60, collector_ver: 'snmp-1.0' });
ek({ hostname: 'HT-DEPO-01', serial_number: 'ZB26D7A4455', category: 'El Terminali', brand: 'Zebra', model: 'TC26', location: 'Kocaeli Depo', status: 'online', last_seen: iso(0), collector_ver: 'snmp-1.0' });
ek({ hostname: 'HT-DEPO-02', serial_number: 'ZB26D7A4456', category: 'El Terminali', brand: 'Zebra', model: 'TC26', location: 'Kocaeli Depo', status: 'online', last_seen: iso(1), collector_ver: 'snmp-1.0' });
ek({ hostname: 'KDS-GIRIS-01', serial_number: 'CEV-KDS-001', category: 'Çevre Aygıtı', brand: 'Dell', model: 'UltraSharp U2723', location: 'İstanbul Genel Merkez', status: 'online', last_seen: iso(0), collector_ver: 'manual-1.0' });
ek({ hostname: 'DEPO-YEDEK-01', serial_number: 'DEPO-BIL-004', category: 'Bilgisayar', brand: 'HP', model: 'ProDesk 400', status: 'depoda', location: 'Kocaeli Depo', last_seen: iso(12), ram_gb: 8, storage_gb: 256, os: 'Windows 10', collector_ver: 'manual-bulk-1.0.0' });
ek({ hostname: 'DEPO-YEDEK-02', serial_number: 'DEPO-BIL-005', category: 'Bilgisayar', brand: 'HP', model: 'ProDesk 400', status: 'depoda', location: 'Kocaeli Depo', last_seen: iso(12), ram_gb: 8, storage_gb: 256, os: 'Windows 10', collector_ver: 'manual-bulk-1.0.0' });
ek({ hostname: 'DEPO-YEDEK-TEL', serial_number: 'DEPO-MOB-001', category: 'Telefon', brand: 'Samsung', model: 'Galaxy A34', status: 'depoda', location: 'Kocaeli Depo', last_seen: iso(20), os: 'Android 13', collector_ver: 'qr-1.0.0' });

// ── Lisanslar ─────────────────────────────────────────────────────────────────
const LIS = [
  ['Microsoft Windows 11 Pro', '23H2', 'Microsoft', 'OEM', 'Licensed', 'ayse.kaya', 'İstanbul Genel Merkez', '2027-01-01'],
  ['Microsoft 365 Business', '2024', 'Microsoft', 'Subscription', 'Licensed', 'mehmet.yilmaz', 'İstanbul Genel Merkez', '2026-02-10'],
  ['Microsoft 365 Business', '2024', 'Microsoft', 'Subscription', 'Licensed', 'genel.mudur', 'İstanbul Genel Merkez', '2026-02-10'],
  ['Adobe Creative Cloud', '2024', 'Adobe', 'Subscription', 'Licensed', 'tasarim', 'İstanbul Genel Merkez', '2025-12-01'],
  ['AutoCAD', '2024', 'Autodesk', 'Subscription', 'Expiring', 'uretim.1', 'Bursa Fabrika', '2026-01-05'],
  ['Kaspersky Endpoint', '12.5', 'Kaspersky', 'Volume', 'Licensed', null, 'İstanbul Genel Merkez', '2026-06-01'],
  ['Windows Server 2022 Std', '2022', 'Microsoft', 'Volume', 'Licensed', null, 'İstanbul Genel Merkez', '2028-01-01'],
  ['Veeam Backup', '12', 'Veeam', 'Subscription', 'Licensed', null, 'İstanbul Genel Merkez', '2026-09-15'],
  ['WinRAR', '7.0', 'RARLAB', 'Perpetual', 'Unlicensed', 'destek.1', 'İstanbul Genel Merkez', null],
  ['TeamViewer', '15', 'TeamViewer', 'Subscription', 'Expired', 'destek.2', 'İstanbul Genel Merkez', '2024-08-01'],
  ['SQL Server Standard', '2022', 'Microsoft', 'Volume', 'Licensed', null, 'İstanbul Genel Merkez', '2028-01-01'],
  ['Zoom Pro', '2024', 'Zoom', 'Subscription', 'Licensed', 'genel.mudur', 'İstanbul Genel Merkez', '2026-03-01'],
];
const licenses = LIS.map((l, i) => ({
  id: i + 1, software_name: l[0], software_version: l[1], publisher: l[2], license_type: l[3],
  license_status: l[4], username: l[5], location: l[6], expiry_date: l[7], install_date: tarih(-200 + i * 5),
  last_seen: iso(1), license_key: 'XXXXX-XXXXX-' + String(10000 + i),
}));

// ── Hatlar (Turkcell/TT/Vodafone) → telefon asset'lerine bağlı ────────────────
const telefonlar = assets.filter((a) => a.category === 'Telefon' && a.status !== 'depoda');
const OPERATORLER = ['Turkcell', 'Türk Telekom', 'Vodafone'];
const HAT = telefonlar.map((t, i) => ({
  msisdn: '053' + (2 + (i % 5)) + String(1000000 + i * 111111).slice(0, 7),
  iccid: '8990011' + String(100000000000 + i).slice(0, 12),
  operator: OPERATORLER[i % 3], tariff: ['Kurumsal Ses+Data 20GB', 'Kurumsal Sınırsız', 'Kurumsal Data 10GB'][i % 3],
  asset_id: t.id, hostname: t.hostname,
}));

// ── Çalıştır ──────────────────────────────────────────────────────────────────
async function main() {
  await dbMod.migrate();
  const k = dbMod.db();

  // 1) TEMİZLE (demo verisi; users/settings/secrets KORUNUR). Sıra: FK çocukları önce.
  const temizle = ['line_assignments', 'phone_lines', 'asset_assignments', 'asset_location_history',
    'asset_expected_location', 'location_geo', 'asset_details', 'asset_telemetry', 'asset_security',
    'asset_daily_snapshot', 'device_images', 'lifecycle_events', 'licenses', 'assets'];
  for (const t of temizle) { try { await k(t).del(); } catch (_) { /* tablo yok */ } }

  // 2) Varlıklar + lisanslar
  await k('assets').insert(assets);
  await k('licenses').insert(licenses);
  console.log(`[demo-seed] ${assets.length} varlık, ${licenses.length} lisans yazıldı`);

  // 3) Harita pinleri — koordinatlar ELLE (tahminEt Türkçe 'İ' slug'ını kaçırıyor).
  const GEO = {
    'İstanbul Genel Merkez': [41.0082, 28.9784],
    'Kocaeli Depo': [40.7654, 29.9408],
    'Ankara Şube': [39.9334, 32.8597],
    'İzmir Bölge': [38.4237, 27.1428],
    'Bursa Fabrika': [40.1826, 29.0665],
  };
  let pin = 0;
  for (const [ad, c] of Object.entries(GEO)) {
    try { await loc.setGeo(ad, { lat: c[0], lon: c[1], label: ad.split(' ')[0], by: 'demo-seed', source: 'seed' }); pin++; } catch (e) { console.warn('[demo-seed] geo', ad, e.message); }
  }
  console.log(`[demo-seed] ${pin} lokasyon haritaya pinlendi`);

  // 4) Hatlar
  try {
    for (const h of HAT) {
      const { line } = await lineTools.upsertLine({ iccid: h.iccid, msisdn: h.msisdn, operator: h.operator, tariff: h.tariff, actor: 'demo-seed' });
      await lineTools.assignLine(line.id, { asset_id: h.asset_id, hostname: h.hostname, actor: 'demo-seed', note: 'Demo zimmet' });
    }
    console.log(`[demo-seed] ${HAT.length} hat bağlandı`);
  } catch (e) { console.warn('[demo-seed] hat seed:', e.message); }

  // Resmi zimmet + yaşam döngüsü → server.js boot seed'inde (SEED_DEMO=true).
  await dbMod.reset();
  console.log('[demo-seed] TAMAM');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[demo-seed] HATA:', e.stack || e.message); process.exit(1); });
