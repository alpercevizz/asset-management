// ── SNMP Sorgulama ────────────────────────────────────────────────────────────
const snmp = require('net-snmp');

const OIDs = {
  sysDescr:    '1.3.6.1.2.1.1.1.0',  // Cihaz açıklaması / OS
  sysName:     '1.3.6.1.2.1.1.5.0',  // Hostname
  sysUpTime:   '1.3.6.1.2.1.1.3.0',  // Uptime (centiseconds)
  sysContact:  '1.3.6.1.2.1.1.4.0',  // İletişim kişisi
  sysLocation: '1.3.6.1.2.1.1.6.0',  // Fiziksel konum notu
};

async function snmpGet(ip, community = 'public', timeoutMs = 3000) {
  return new Promise(resolve => {
    const session = snmp.createSession(ip, community, {
      timeout:  timeoutMs,
      retries:  1,
      version:  snmp.Version2c,
    });

    session.get(Object.values(OIDs), (err, varbinds) => {
      session.close();
      if (err) { resolve(null); return; }

      const result = {};
      Object.keys(OIDs).forEach((key, idx) => {
        const vb = varbinds[idx];
        if (vb && !snmp.isVarbindError(vb)) {
          result[key] = vb.value.toString().replace(/\0/g, '').trim();
        }
      });
      resolve(Object.keys(result).length > 0 ? result : null);
    });
  });
}

// Uptime (centisaniye) → gün
function uptimeToDays(centiseconds) {
  if (!centiseconds) return null;
  return Math.round(parseInt(centiseconds) / 8640000 * 10) / 10;
}

module.exports = { snmpGet, uptimeToDays };
