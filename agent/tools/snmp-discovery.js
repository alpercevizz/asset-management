// ── SNMP Ağ Keşfi (çok-subnet) — switch/firewall/AP/yazıcı envanteri ─────────
// On-prem AssetMan, LAN'daki (ve HQ firewall'a routelanan uzak depo subnet'lerindeki)
// ağ cihazlarını SNMP ile keşfeder → envantere (Ağ Aygıtı/Yazıcı) yazar.
// Sophos XG hub-and-spoke: RED/VPN uzak subnet'leri HQ'ya routeladığı için merkezi tarama yeter.
// v2c (community) veya v3 (auth/priv) desteklenir. net-snmp: pure-JS (native derleme yok).
const snmp = require('net-snmp');
const { getAssetBySerial, createAsset, updateAsset } = require('./baserow-tools');

const OID = {
  sysDescr:     '1.3.6.1.2.1.1.1.0',
  sysObjectID:  '1.3.6.1.2.1.1.2.0',
  sysUpTime:    '1.3.6.1.2.1.1.3.0',
  sysName:      '1.3.6.1.2.1.1.5.0',
  sysLocation:  '1.3.6.1.2.1.1.6.0',
  entSerial:    '1.3.6.1.2.1.47.1.1.1.1.11',   // entPhysicalSerialNum (subtree)
  entModel:     '1.3.6.1.2.1.47.1.1.1.1.13',   // entPhysicalModelName (subtree)
};

const val = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v);

// ── Marka / kategori / model çıkarımı (sysDescr + enterprise OID) ─────────────
const ENTERPRISE = { '9': 'Cisco', '11': 'HP', '2011': 'Huawei', '674': 'Dell', '12356': 'Fortinet',
  '2604': 'Sophos', '21091': 'Sophos', '41112': 'Ubiquiti', '25506': 'H3C', '4526': 'Netgear',
  '1916': 'Extreme', '14988': 'MikroTik', '10418': 'Zebra', '1602': 'Canon', '1347': 'Kyocera',
  '236': 'Samsung', '367': 'Ricoh', '2435': 'Brother', '1248': 'Epson', '3854': 'Billion' };

function brandFrom(descr, oid) {
  const d = String(descr || '');
  const m = String(oid || '').match(/1\.3\.6\.1\.4\.1\.(\d+)/);
  if (m && ENTERPRISE[m[1]]) return ENTERPRISE[m[1]];
  const map = [[/sophos|astaro|xg\b/i, 'Sophos'], [/fortinet|fortigate/i, 'Fortinet'], [/cisco/i, 'Cisco'],
    [/hp|hewlett|procurve|aruba/i, 'HP'], [/huawei/i, 'Huawei'], [/mikrotik|routeros/i, 'MikroTik'],
    [/ubiquiti|unifi|edgeswitch/i, 'Ubiquiti'], [/zyxel/i, 'Zyxel'], [/tp-link|tplink/i, 'TP-Link'],
    [/billion/i, 'Billion'], [/zebra/i, 'Zebra'], [/kyocera/i, 'Kyocera'], [/canon/i, 'Canon'],
    [/epson/i, 'Epson'], [/brother/i, 'Brother'], [/ricoh/i, 'Ricoh'], [/lexmark/i, 'Lexmark'],
    [/laserjet|officejet|hp\s/i, 'HP'], [/netgear/i, 'Netgear'], [/dell/i, 'Dell']];
  for (const [re, b] of map) if (re.test(d)) return b;
  return null;
}
function categoryFrom(descr) {
  const d = String(descr || '');
  if (/printer|laserjet|officejet|imageclass|kyocera|ricoh|lexmark|brother|epson|mfp|print/i.test(d)) return 'Yazıcı';
  if (/access point|\bap\b|wireless|wifi|unifi\s|wlan/i.test(d)) return 'Ağ Aygıtı';
  if (/firewall|fortigate|sophos|palo alto|sonicwall|utm|xg\b/i.test(d)) return 'Ağ Aygıtı';
  if (/switch|procurve|catalyst|edgeswitch/i.test(d)) return 'Ağ Aygıtı';
  if (/router|gateway|modem|billion|mikrotik|routeros/i.test(d)) return 'Ağ Aygıtı';
  return 'Ağ Aygıtı';
}
function modelFrom(descr) {
  const d = String(descr || '').replace(/\s+/g, ' ').trim();
  // İlk satır / ilk 60 karakter (çoğu cihazda model burada geçer)
  return d ? d.split(/[\n,;]/)[0].slice(0, 80) : null;
}

// ── CIDR → host IP listesi (varsayılan /24; büyük bloklar 1024 ile sınırlı) ────
function ipToInt(ip) { return ip.split('.').reduce((a, o) => (a << 8) + (Number(o) & 255), 0) >>> 0; }
function intToIp(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
function expandCidr(cidr) {
  const [ip, bitsStr] = String(cidr).trim().split('/');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || bits < 0 || bits > 32) return [];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const base = ipToInt(ip) & mask;
  const total = 2 ** (32 - bits);
  const usable = bits >= 31 ? total : total - 2;      // ağ + broadcast hariç
  const start = bits >= 31 ? base : base + 1;
  const cap = Math.min(usable, 1024);
  const out = [];
  for (let i = 0; i < cap; i++) out.push(intToIp(start + i));
  return out;
}

// ── SNMP oturumu (v2c | v3) ───────────────────────────────────────────────────
function makeSession(ip, cred, timeout) {
  const opts = { timeout: timeout || 1000, retries: 0, version: cred.version === 3 ? snmp.Version3 : snmp.Version2c };
  if (cred.version === 3) {
    const user = {
      name: cred.user,
      level: cred.privKey ? snmp.SecurityLevel.authPriv : (cred.authKey ? snmp.SecurityLevel.authNoPriv : snmp.SecurityLevel.noAuthNoPriv),
      authProtocol: (cred.authProtocol === 'md5') ? snmp.AuthProtocols.md5 : snmp.AuthProtocols.sha,
      authKey: cred.authKey,
      privProtocol: (cred.privProtocol === 'des') ? snmp.PrivProtocols.des : snmp.PrivProtocols.aes,
      privKey: cred.privKey,
    };
    return snmp.createV3Session(ip, user, opts);
  }
  return snmp.createSession(ip, cred.community || 'public', opts);
}

function snmpGet(session, oids) {
  return new Promise((resolve) => {
    try {
      session.get(oids, (err, varbinds) => {
        if (err) return resolve(null);
        const out = {};
        (varbinds || []).forEach((vb, i) => { out[oids[i]] = snmp.isVarbindError(vb) ? null : vb.value; });
        resolve(out);
      });
    } catch (_) { resolve(null); }
  });
}
function snmpFirstOfSubtree(session, baseOid) {
  return new Promise((resolve) => {
    let found = null;
    try {
      session.subtree(baseOid, 20,
        (vbs) => { for (const vb of (vbs || [])) { if (!snmp.isVarbindError(vb)) { const v = String(val(vb.value) || '').trim(); if (v) { found = found || v; } } } },
        () => resolve(found));
    } catch (_) { resolve(null); }
  });
}

function parseDevice(ip, sys, serial, model) {
  const descr = String(val(sys[OID.sysDescr]) || '').trim();
  const name = String(val(sys[OID.sysName]) || '').trim();
  const loc = String(val(sys[OID.sysLocation]) || '').trim();
  const upticks = Number(sys[OID.sysUpTime] || 0);
  const oid = String(val(sys[OID.sysObjectID]) || '');
  return {
    hostname: name || ('NET-' + ip.replace(/\./g, '-')),
    serial_number: (serial && String(serial).trim()) || ('SNMP-' + ip),
    ip_address: ip,
    os: descr ? descr.split('\n')[0].slice(0, 120) : null,
    brand: brandFrom(descr, oid),
    model: (model && String(model).trim()) || modelFrom(descr),
    category: categoryFrom(descr),
    location: loc || null,
    uptime_days: upticks ? Math.round(upticks / 100 / 86400) : null,
    status: 'online',
    collector_ver: 'snmp-1.0',
  };
}

// ── Tek IP'yi yokla (SNMP cevap veriyorsa cihaz nesnesi, yoksa null) ──────────
async function probe(ip, cred, timeout) {
  const session = makeSession(ip, cred, timeout);
  try {
    const sys = await snmpGet(session, [OID.sysDescr, OID.sysObjectID, OID.sysUpTime, OID.sysName, OID.sysLocation]);
    if (!sys || sys[OID.sysDescr] == null) return null;   // SNMP yok / cevap yok
    const serial = await snmpFirstOfSubtree(session, OID.entSerial).catch(() => null);
    const model = await snmpFirstOfSubtree(session, OID.entModel).catch(() => null);
    return parseDevice(ip, sys, serial, model);
  } finally { try { session.close(); } catch (_) {} }
}

// ── Config (env) ──────────────────────────────────────────────────────────────
function readConfig() {
  const version = String(process.env.SNMP_VERSION || '2c') === '3' ? 3 : 2;
  return {
    enabled: process.env.SNMP_ENABLED === 'true',
    subnets: String(process.env.SNMP_SUBNETS || '').split(',').map((s) => s.trim()).filter(Boolean),
    concurrency: Number(process.env.SNMP_CONCURRENCY) || 24,
    timeout: Number(process.env.SNMP_TIMEOUT_MS) || 1000,
    intervalMs: Number(process.env.SNMP_INTERVAL_MS) || 6 * 60 * 60 * 1000,
    cred: {
      version,
      community: process.env.SNMP_COMMUNITY || 'public',
      user: process.env.SNMP_V3_USER,
      authProtocol: (process.env.SNMP_V3_AUTH_PROTOCOL || 'sha').toLowerCase(),
      authKey: process.env.SNMP_V3_AUTH_KEY,
      privProtocol: (process.env.SNMP_V3_PRIV_PROTOCOL || 'aes').toLowerCase(),
      privKey: process.env.SNMP_V3_PRIV_KEY,
    },
  };
}

// ── Keşif: subnet'leri tara, cihazları envantere upsert et ───────────────────
async function runDiscovery({ subnets, cred, timeout, concurrency } = {}) {
  const cfg = readConfig();
  subnets = subnets || cfg.subnets;
  cred = cred || cfg.cred;
  timeout = timeout || cfg.timeout;
  concurrency = concurrency || cfg.concurrency;
  if (!subnets.length) throw new Error('SNMP_SUBNETS boş — taranacak subnet tanımlı değil.');

  const found = [];
  for (const cidr of subnets) {
    const ips = expandCidr(cidr);
    for (let i = 0; i < ips.length; i += concurrency) {
      const batch = ips.slice(i, i + concurrency);
      const res = await Promise.all(batch.map((ip) => probe(ip, cred, timeout).catch(() => null)));
      res.forEach((d) => { if (d) found.push(d); });
    }
  }

  let created = 0, updated = 0;
  const now = new Date().toISOString();
  for (const d of found) {
    const existing = await getAssetBySerial({ serialNumber: d.serial_number }).catch(() => null);
    if (existing) { await updateAsset(existing.id, { ...d, last_seen: now }); updated++; }
    else { await createAsset({ ...d, last_seen: now }); created++; }
  }
  return { scanned_subnets: subnets.length, discovered: found.length, created, updated,
    devices: found.map((d) => ({ hostname: d.hostname, ip: d.ip_address, brand: d.brand, model: d.model, serial: d.serial_number, category: d.category })) };
}

let _timer = null;
function startSnmpScheduler() {
  const cfg = readConfig();
  if (!cfg.enabled) { console.log('[snmp] Kapalı (SNMP_ENABLED!=true).'); return; }
  if (!cfg.subnets.length) { console.log('[snmp] SNMP_SUBNETS boş — zamanlayıcı başlamadı.'); return; }
  console.log(`[snmp] Ağ keşfi AÇIK — ${cfg.subnets.length} subnet, v${cfg.cred.version}, her ${Math.round(cfg.intervalMs / 60000)}dk.`);
  const tick = () => runDiscovery({}).then((r) => console.log(`[snmp] Keşif: ${r.discovered} cihaz (${r.created} yeni, ${r.updated} güncel)`)).catch((e) => console.error('[snmp]', e.message));
  setTimeout(tick, 15000);              // boot'tan 15sn sonra ilk tarama
  _timer = setInterval(tick, cfg.intervalMs);
}

module.exports = { runDiscovery, startSnmpScheduler, probe, parseDevice, expandCidr, brandFrom, categoryFrom, readConfig, OID };
