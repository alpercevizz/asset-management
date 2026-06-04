// ═══════════════════════════════════════════════════════════════════════════════
//  Asset Management — Location Agent
//  Ağı tarar, cihazları tespit eder, merkezi sunucuya gönderir.
//
//  Kullanım:
//    node agent.js                          → config.json kullanır
//    node agent.js --config config.xyz.json → özel config
// ═══════════════════════════════════════════════════════════════════════════════

const axios              = require('axios');
const { pingSwee, getArpTable, pingHost } = require('./lib/network');
const { snmpGet, uptimeToDays }           = require('./lib/snmp');
const { detectDevice, parseBrandModel }   = require('./lib/detect');

// ── Config ────────────────────────────────────────────────────────────────────
const configArg = process.argv.find(a => a.startsWith('--config='))?.split('=')[1]
               || process.argv[process.argv.indexOf('--config') + 1]
               || 'config.json';

let config;
try {
  config = require(`./${configArg}`);
} catch {
  console.error(`[ERR] Config bulunamadı: ${configArg}`);
  console.error('      config.example.json dosyasını kopyalayarak config.json oluşturun.');
  process.exit(1);
}

// ── Logger ────────────────────────────────────────────────────────────────────
const C = { cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };

function log(level, msg) {
  const ts   = new Date().toISOString().replace('T', ' ').split('.')[0];
  const color = { INFO: C.cyan, OK: C.green, WARN: C.yellow, ERR: C.red }[level] || '';
  console.log(`${color}[${ts}] [${level}] ${msg}${C.reset}`);
}

// ── Cihaz Deposu (in-memory) ──────────────────────────────────────────────────
// ip → { serial_number, hostname, status, ... }
const deviceStore = new Map();

// ── Merkeze Gönder ────────────────────────────────────────────────────────────
async function sendToServer(payload) {
  // Boş / null alanları temizle
  const clean = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== '')
  );
  try {
    await axios.post(config.server_url, clean, {
      headers: {
        'Content-Type':    'application/json',
        'X-Location-Token': config.location_token,
      },
      timeout: 10000,
    });
  } catch (err) {
    log('ERR', `Gönderim hatası (${clean.hostname || clean.ip_address}): ${err.message}`);
  }
}

// ── Serial No Üret ────────────────────────────────────────────────────────────
function makeSerial(mac, ip) {
  if (mac) return `MAC-${mac.replace(/:/g, '').toUpperCase()}`;
  return `${config.location_id.toUpperCase()}-${ip.replace(/\./g, '-')}`;
}

// ── Tek Cihazı İşle ───────────────────────────────────────────────────────────
async function processHost(ip, arpTable) {
  const mac       = arpTable[ip] || null;
  const snmpData  = await snmpGet(ip, config.network.snmp_community, config.network.snmp_timeout_ms);
  const detected  = detectDevice(snmpData);
  const parsed    = parseBrandModel(snmpData?.sysDescr);

  const serial    = makeSerial(mac, ip);
  const hostname  = snmpData?.sysName || `device-${ip.replace(/\./g, '-')}`;

  const asset = {
    serial_number: serial,
    hostname,
    brand:         parsed.brand   || detected.brand,
    model:         parsed.model   || null,
    os:            snmpData?.sysDescr ? snmpData.sysDescr.substring(0, 120) : null,
    uptime_days:   uptimeToDays(snmpData?.sysUpTime),
    category:      detected.category,
    ip_address:    ip,
    mac_address:   mac,
    location:      config.location_name,
    status:        'online',
    last_seen:     new Date().toISOString(),
    collector_ver: `location-agent-1.0/${config.location_id}`,
  };

  deviceStore.set(ip, { ...asset });
  await sendToServer(asset);
  log('OK', `${ip.padEnd(16)} ${hostname.padEnd(24)} [${detected.category}]`);
}

// ── Ağ Keşfi (tam tarama) ─────────────────────────────────────────────────────
async function runDiscovery() {
  log('INFO', `─── Ağ Keşfi Başlıyor: ${config.network.range} ───`);
  const t0 = Date.now();

  let liveHosts;
  try {
    liveHosts = await pingSwee(config.network.range);
  } catch (err) {
    log('ERR', `Ping sweep hatası: ${err.message}`); return;
  }

  log('INFO', `${liveHosts.length} aktif host bulundu`);
  const arpTable = await getArpTable();

  for (const ip of liveHosts) {
    try { await processHost(ip, arpTable); }
    catch (err) { log('WARN', `${ip} işlenemedi: ${err.message}`); }
  }

  log('INFO', `Ağ keşfi tamamlandı — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// ── Ping Monitör (online/offline takibi) ──────────────────────────────────────
async function runPingMonitor() {
  if (deviceStore.size === 0) return;

  let changes = 0;
  for (const [ip, device] of deviceStore) {
    const alive     = await pingHost(ip);
    const newStatus = alive ? 'online' : 'offline';

    if (newStatus !== device.status) {
      device.status   = newStatus;
      device.last_seen = new Date().toISOString();
      deviceStore.set(ip, device);

      await sendToServer({
        serial_number: device.serial_number,
        hostname:      device.hostname,
        location:      config.location_name,
        status:        newStatus,
        last_seen:     device.last_seen,
      });

      log(newStatus === 'online' ? 'OK' : 'WARN',
        `${ip} (${device.hostname}) → ${newStatus}`);
      changes++;
    }
  }

  if (changes > 0) log('INFO', `Ping monitor: ${changes} durum değişti`);
}

// ── SNMP Poll (bilinen cihazları güncelle) ─────────────────────────────────────
async function runSnmpPoll() {
  if (deviceStore.size === 0) return;
  log('INFO', `SNMP poll başlıyor (${deviceStore.size} cihaz)...`);
  const arpTable = await getArpTable();

  for (const [ip, device] of deviceStore) {
    if (device.status === 'offline') continue;
    try {
      const snmpData = await snmpGet(ip, config.network.snmp_community, config.network.snmp_timeout_ms);
      if (!snmpData) continue;

      const update = {
        serial_number: device.serial_number,
        hostname:      snmpData.sysName || device.hostname,
        os:            snmpData.sysDescr ? snmpData.sysDescr.substring(0, 120) : device.os,
        uptime_days:   uptimeToDays(snmpData.sysUpTime),
        mac_address:   arpTable[ip] || device.mac_address,
        location:      config.location_name,
        status:        'online',
        last_seen:     new Date().toISOString(),
      };

      Object.assign(device, update);
      deviceStore.set(ip, device);
      await sendToServer(update);
    } catch (err) {
      log('WARN', `SNMP poll ${ip}: ${err.message}`);
    }
  }
  log('INFO', 'SNMP poll tamamlandı');
}

// ── Başlat ────────────────────────────────────────────────────────────────────
async function start() {
  console.log(`\n${C.cyan}╔═══════════════════════════════════════╗`);
  console.log(`║   Asset Management — Location Agent   ║`);
  console.log(`╚═══════════════════════════════════════╝${C.reset}\n`);
  log('INFO', `Lokasyon  : ${config.location_name}`);
  log('INFO', `Sunucu    : ${config.server_url}`);
  log('INFO', `Ağ aralığı: ${config.network.range}`);
  log('INFO', `Keşif     : her ${config.intervals.discovery_hours}h`);
  log('INFO', `SNMP poll : her ${config.intervals.snmp_poll_minutes}dk`);
  log('INFO', `Ping mon  : her ${config.intervals.ping_minutes}dk\n`);

  // İlk çalışma
  await runDiscovery();

  // Zamanlayıcılar
  setInterval(runPingMonitor, config.intervals.ping_minutes        * 60 * 1000);
  setInterval(runSnmpPoll,    config.intervals.snmp_poll_minutes   * 60 * 1000);
  setInterval(runDiscovery,   config.intervals.discovery_hours * 60 * 60 * 1000);

  log('INFO', 'Agent çalışıyor. Durdurmak için Ctrl+C.\n');
}

start().catch(err => {
  log('ERR', `Başlatma hatası: ${err.message}`);
  process.exit(1);
});
