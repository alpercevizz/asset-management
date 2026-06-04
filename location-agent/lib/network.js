// ── Ağ Tarama: Ping Sweep + ARP Tablosu ──────────────────────────────────────
const ping   = require('ping');
const { exec } = require('child_process');

// CIDR → IP listesi (örn. "192.168.1.0/24" → ["192.168.1.1", ..., "192.168.1.254"])
function expandCIDR(cidr) {
  const [base, bits] = cidr.split('/');
  const mask  = parseInt(bits, 10);
  const count = Math.pow(2, 32 - mask);
  const parts = base.split('.').map(Number);
  const start = (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
  const ips   = [];
  for (let i = 1; i < count - 1; i++) {
    const n = (start + i) >>> 0;
    ips.push(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
  }
  return ips;
}

// Paralel ping taraması — cevap veren IP'leri döner
async function pingSwee(cidr, concurrency = 30) {
  const ips     = expandCIDR(cidr);
  const alive   = [];
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch   = ips.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(ip => ping.promise.probe(ip, { timeout: 1, min_reply: 1 }).catch(() => ({ alive: false })))
    );
    results.forEach((r, idx) => { if (r.alive) alive.push(batch[idx]); });
  }
  return alive;
}

// ARP tablosunu oku → { "ip": "MAC" }
function getArpTable() {
  return new Promise(resolve => {
    const cmd = process.platform === 'win32' ? 'arp -a' : 'arp -n';
    exec(cmd, (err, stdout) => {
      if (err) { resolve({}); return; }
      const table = {};
      for (const line of stdout.split('\n')) {
        const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:.\-]{11,})/);
        if (m) {
          const ip  = m[1];
          const mac = m[2].replace(/-/g, ':').toUpperCase();
          if (!mac.startsWith('FF:') && mac !== '00:00:00:00:00:00') {
            table[ip] = mac;
          }
        }
      }
      resolve(table);
    });
  });
}

// Tek IP ping
async function pingHost(ip) {
  try {
    const r = await ping.promise.probe(ip, { timeout: 2, min_reply: 1 });
    return r.alive;
  } catch {
    return false;
  }
}

module.exports = { pingSwee, getArpTable, pingHost };
