const fs = require('fs');
const path = require('path');
const { getAllAssets } = require('./baserow-tools');
const { getAllLicenses } = require('./license-tools');
const settings = require('./settings-tools');

// ── Eşik değerleri — Ayarlar deposundan okunur (UI'dan değişebilir), kod'da varsayılan ─
// settings-tools init edilmese bile DEFAULTS döner → güvenli. Küçük harf store anahtarları
// büyük harf iç isimlere eşlenir (geriye dönük uyumluluk).
function THRESHOLDS() {
  const t = settings.getThresholds();
  return {
    LOW_RAM_GB:      t.low_ram_gb,
    LOW_DISK_GB:     t.low_disk_gb,
    OLD_UPTIME_DAYS: t.old_uptime_days,
    OFFLINE_HOURS:   t.offline_hours,
    STALE_DAYS:      t.stale_days,
  };
}

function hoursSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60);
}

// ── Anomali tespiti: eski/yetersiz donanım + uptime ──────────────────────────
async function detectAnomalies(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];
  const TH = THRESHOLDS();

  const lowRam = [];
  const lowDisk = [];
  const longUptime = [];

  for (const a of assets) {
    const ram  = Number(a.ram_gb)     || 0;
    const disk = Number(a.storage_gb) || 0;
    const up   = Number(a.uptime_days) || 0;

    const base = {
      hostname: a.hostname || '—',
      brand:    a.brand    || '—',
      model:    a.model    || '—',
      username: a.username || '—',
    };

    if (ram > 0 && ram < TH.LOW_RAM_GB)
      lowRam.push({ ...base, ram_gb: ram });

    if (disk > 0 && disk < TH.LOW_DISK_GB)
      lowDisk.push({ ...base, storage_gb: disk });

    if (up >= TH.OLD_UPTIME_DAYS)
      longUptime.push({ ...base, uptime_days: up });
  }

  lowRam.sort((a, b) => a.ram_gb - b.ram_gb);
  lowDisk.sort((a, b) => a.storage_gb - b.storage_gb);
  longUptime.sort((a, b) => b.uptime_days - a.uptime_days);

  return {
    total_assets: data.count || assets.length,
    thresholds: TH,
    low_ram:     { count: lowRam.length,     items: lowRam },
    low_disk:    { count: lowDisk.length,    items: lowDisk },
    long_uptime: { count: longUptime.length, items: longUptime },
    total_anomalies: lowRam.length + lowDisk.length + longUptime.length,
  };
}

// ── Çevrimdışı cihaz uyarı sistemi ───────────────────────────────────────────
async function detectOfflineDevices(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];
  const TH = THRESHOLDS();

  const offline = [];   // status alanı açıkça offline olan cihazlar
  const stale = [];     // STALE_DAYS'ten uzun süredir görünmeyen (kayıp/terk şüphesi)

  for (const a of assets) {
    const hrs = hoursSince(a.last_seen);
    const statusOffline = (a.status || '').toLowerCase() === 'offline';

    const item = {
      hostname:  a.hostname  || '—',
      brand:     a.brand     || '—',
      model:     a.model     || '—',
      username:  a.username  || '—',
      status:    a.status    || '—',
      last_seen: a.last_seen || null,
      hours_offline: hrs !== null ? Math.round(hrs) : null,
    };

    // status alanı otoritatif sinyaldir (collector/scheduler set eder).
    // Zaman bazlı tespiti yalnızca cihaz UZUN süredir (STALE_DAYS+) hiç görünmediyse
    // uygula — aksi halde günlük rapor eden cihazlar yanlışlıkla "çevrimdışı" sayılır.
    if (statusOffline) {
      offline.push(item);
    } else if (hrs !== null && hrs >= TH.STALE_DAYS * 24) {
      stale.push(item);
    }
  }

  offline.sort((a, b) => (b.hours_offline || 0) - (a.hours_offline || 0));
  stale.sort((a, b)   => (b.hours_offline || 0) - (a.hours_offline || 0));

  return {
    total_assets: data.count || assets.length,
    thresholds: { offline_hours: TH.OFFLINE_HOURS, stale_days: TH.STALE_DAYS },
    offline: { count: offline.length, items: offline },
    stale:   { count: stale.length,   items: stale },
    total_alerts: offline.length + stale.length,
  };
}

// ── Lisans uyum raporu ───────────────────────────────────────────────────────
async function detectLicenseCompliance(orgId) {
  const data = await getAllLicenses({ size: 200 });
  const licenses = (data.results || []).filter(l => l.software_name);

  const unlicensed = [];
  const expiringSoon = [];
  const expired = [];

  const now = new Date();
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  for (const l of licenses) {
    const status = l.license_status || 'Unknown';
    const item = {
      software_name: l.software_name || '—',
      version:       l.version       || '—',
      hostname:      l.hostname      || '—',
      username:      l.username      || '—',
      license_type:  l.license_type  || '—',
      license_status: status,
      expiry_date:   l.expiry_date   || null,
    };

    if (status === 'Unlicensed' || status === 'Lisanssız') {
      unlicensed.push(item);
    }

    if (l.expiry_date) {
      const exp = new Date(l.expiry_date);
      if (!isNaN(exp)) {
        if (exp < now) expired.push(item);
        else if (exp < thirtyDays) expiringSoon.push(item);
      }
    }
  }

  expiringSoon.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  return {
    total_licenses: licenses.length,
    unlicensed:    { count: unlicensed.length,   items: unlicensed },
    expiring_soon: { count: expiringSoon.length, items: expiringSoon },
    expired:       { count: expired.length,      items: expired },
    compliant: licenses.length - unlicensed.length - expired.length,
    total_issues: unlicensed.length + expiringSoon.length + expired.length,
  };
}

// ── Shadow IT / Kayıt Dışı Cihaz Dedektörü ──────────────────────────────────
// MAC/IP normalizasyonu: ayraçları temizle, küçük harfe çevir → karşılaştırma sağlam olsun.
function normalizeMac(mac) {
  if (!mac) return '';
  return String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
}
function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip).trim();
}

// Ağdan gelen anlık aktif cihaz listesi (ENTEGRASYON DİKİŞİ).
// Şu an yerel örnek besleme dosyasını okur (Sophos/Zabbix export formatı).
// Gerçek entegrasyonda burası canlı bir poller'a bağlanır; geri kalan mantık değişmez.
// TAMAMEN YEREL — dış istek yok, kapalı devre korunur.
function getActiveNetworkDevices() {
  const file = path.join(__dirname, '..', '..', 'data', 'active-devices.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    return {
      devices: Array.isArray(json.devices) ? json.devices : [],
      source: json.source || 'sample-feed',
      captured_at: json.captured_at || null,
    };
  } catch (err) {
    return { devices: [], source: 'unavailable', captured_at: null, error: err.message };
  }
}

// Resmi envanterde (MAC veya IP bazlı) kaydı OLMAYAN ama ağda aktif cihazları tespit eder.
async function detectShadowIT(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];

  // Bilinen MAC ve IP kümeleri (normalize edilmiş)
  const knownMacs = new Set();
  const knownIps = new Set();
  for (const a of assets) {
    const m = normalizeMac(a.mac_address);
    const ip = normalizeIp(a.ip_address);
    if (m) knownMacs.add(m);
    if (ip) knownIps.add(ip);
  }

  const feed = getActiveNetworkDevices();
  const shadow = [];
  let matched = 0;

  for (const dev of feed.devices) {
    const m = normalizeMac(dev.mac);
    const ip = normalizeIp(dev.ip);
    const macKnown = m && knownMacs.has(m);
    const ipKnown = ip && knownIps.has(ip);

    // Kayıtlı sayılması için MAC VEYA IP eşleşmesi yeterli (kullanıcı kuralı).
    if (macKnown || ipKnown) {
      matched++;
    } else {
      shadow.push({
        ip:       dev.ip       || '—',
        mac:      dev.mac      || '—',
        hostname: dev.hostname || null,
        vendor:   dev.vendor   || null,
      });
    }
  }

  return {
    total_active: feed.devices.length,
    matched,
    source: feed.source,
    captured_at: feed.captured_at,
    shadow: { count: shadow.length, items: shadow },
  };
}

// ── İşletim Sistemi Yaşam Sonu (EOL) Tespiti ─────────────────────────────────
// Mevcut `os` alanından çalışır — ŞEMA DEĞİŞİKLİĞİ GEREKTİRMEZ.
// EOL = üreticinin güvenlik güncellemesi verdiği desteğin BİTTİĞİ tarih.
// Bu tarihten sonraki cihazlar açık güvenlik riskidir.
const EOL_APPROACHING_DAYS = 180; // 6 ay içinde EOL olacaklar = yaklaşan risk

// Sabit kurallar: os string'inde aranan kalıp → {family, eol tarihi}.
// Kalıplar küçük harfe çevrilmiş os üzerinde 'includes' ile aranır; ilk eşleşen kazanır.
const EOL_RULES = [
  // Windows istemci
  { match: 'windows 7',           family: 'Windows 7',              eol: '2020-01-14' },
  { match: 'windows 8',           family: 'Windows 8/8.1',          eol: '2023-01-10' },
  { match: 'windows 10',          family: 'Windows 10',             eol: '2025-10-14' },
  // Windows Server
  { match: 'server 2008',         family: 'Windows Server 2008',    eol: '2020-01-14' },
  { match: 'server 2012',         family: 'Windows Server 2012',    eol: '2023-10-10' },
  { match: 'server 2016',         family: 'Windows Server 2016',    eol: '2027-01-12' },
  { match: 'server 2019',         family: 'Windows Server 2019',    eol: '2029-01-09' },
  { match: 'server 2022',         family: 'Windows Server 2022',    eol: '2031-10-14' },
  // Ubuntu LTS
  { match: 'ubuntu 16.04',        family: 'Ubuntu 16.04 LTS',       eol: '2021-04-30' },
  { match: 'ubuntu 18.04',        family: 'Ubuntu 18.04 LTS',       eol: '2023-05-31' },
  { match: 'ubuntu 20.04',        family: 'Ubuntu 20.04 LTS',       eol: '2025-05-29' },
  { match: 'ubuntu 22.04',        family: 'Ubuntu 22.04 LTS',       eol: '2027-06-01' },
  { match: 'ubuntu 24.04',        family: 'Ubuntu 24.04 LTS',       eol: '2029-05-31' },
  // VMware ESXi
  { match: 'esxi 6.7',            family: 'VMware ESXi 6.7',        eol: '2022-10-15' },
  { match: 'esxi 7.0',            family: 'VMware ESXi 7.0',        eol: '2025-04-02' },
  { match: 'esxi 8.0',            family: 'VMware ESXi 8.0',        eol: '2027-10-11' },
];

// Android sürüm → yaklaşık EOL tarihi (Google güvenlik desteği sonu).
const ANDROID_EOL = {
  8:  '2021-01-01', 9:  '2022-01-01', 10: '2023-03-01', 11: '2024-02-01',
  12: '2025-03-01', 13: '2026-08-01', 14: '2027-10-01',
};

function resolveEol(osRaw) {
  if (!osRaw) return null;
  const os = String(osRaw).toLowerCase();

  // Apple iOS ile Cisco IOS karışmasın: Cisco "ios 15.2(7)e5" gibi → atla.
  // Yalnızca açık Android sürümleri ve EOL_RULES kalıplarını değerlendiriyoruz.
  const androidMatch = os.match(/android\s+(\d+)/);
  if (androidMatch) {
    const ver = Number(androidMatch[1]);
    const eol = ANDROID_EOL[ver];
    if (eol) return { family: `Android ${ver}`, eol };
    return null; // bilinmeyen/yeni sürüm → riskli sayma
  }

  for (const rule of EOL_RULES) {
    if (os.includes(rule.match)) return { family: rule.family, eol: rule.eol };
  }
  return null;
}

async function detectEolOs(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];

  const now = new Date();
  const approachingLimit = new Date(Date.now() + EOL_APPROACHING_DAYS * 24 * 60 * 60 * 1000);

  const eol = [];        // desteği BİTMİŞ (now > eol_date)
  const approaching = []; // 180 gün içinde bitecek

  for (const a of assets) {
    const info = resolveEol(a.os);
    if (!info) continue;

    const eolDate = new Date(info.eol);
    if (isNaN(eolDate)) continue;

    const base = {
      hostname: a.hostname || '—',
      brand:    a.brand    || '—',
      model:    a.model    || '—',
      os:       a.os       || '—',
      username: a.username || '—',
      os_family: info.family,
      eol_date:  info.eol,
    };

    if (eolDate < now) {
      const daysPast = Math.floor((now - eolDate) / (1000 * 60 * 60 * 24));
      eol.push({ ...base, days_past: daysPast });
    } else if (eolDate < approachingLimit) {
      const daysLeft = Math.ceil((eolDate - now) / (1000 * 60 * 60 * 24));
      approaching.push({ ...base, days_left: daysLeft });
    }
  }

  eol.sort((a, b) => b.days_past - a.days_past);
  approaching.sort((a, b) => a.days_left - b.days_left);

  return {
    total_assets: data.count || assets.length,
    approaching_days: EOL_APPROACHING_DAYS,
    eol:         { count: eol.length,         items: eol },
    approaching: { count: approaching.length, items: approaching },
    total_issues: eol.length + approaching.length,
  };
}

// ── Garanti Takibi ───────────────────────────────────────────────────────────
// Baserow `warranty_expiry` (tarih) alanını kullanır.
// Garantisi bitmiş veya yakında bitecek cihazları işaretler.
const WARRANTY_APPROACHING_DAYS = 60; // 60 gün içinde bitecek = yenileme/değişim planı

async function detectWarranty(orgId) {
  const data = await getAllAssets({ orgId, size: 200 });
  const assets = data.results || [];

  const now = new Date();
  const soonLimit = new Date(Date.now() + WARRANTY_APPROACHING_DAYS * 24 * 60 * 60 * 1000);

  const expired = [];
  const expiringSoon = [];

  for (const a of assets) {
    if (!a.warranty_expiry) continue;
    const exp = new Date(a.warranty_expiry);
    if (isNaN(exp)) continue;

    const base = {
      hostname: a.hostname || '—',
      brand:    a.brand    || '—',
      model:    a.model    || '—',
      username: a.username || '—',
      warranty_expiry: a.warranty_expiry,
    };

    if (exp < now) {
      const daysPast = Math.floor((now - exp) / (1000 * 60 * 60 * 24));
      expired.push({ ...base, days_past: daysPast });
    } else if (exp < soonLimit) {
      const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
      expiringSoon.push({ ...base, days_left: daysLeft });
    }
  }

  expired.sort((a, b) => b.days_past - a.days_past);
  expiringSoon.sort((a, b) => a.days_left - b.days_left);

  return {
    total_assets: data.count || assets.length,
    approaching_days: WARRANTY_APPROACHING_DAYS,
    expired:       { count: expired.length,      items: expired },
    expiring_soon: { count: expiringSoon.length, items: expiringSoon },
    total_issues: expired.length + expiringSoon.length,
  };
}

module.exports = {
  THRESHOLDS,
  detectAnomalies,
  detectOfflineDevices,
  detectLicenseCompliance,
  detectShadowIT,
  getActiveNetworkDevices,
  detectEolOs,
  detectWarranty,
};
