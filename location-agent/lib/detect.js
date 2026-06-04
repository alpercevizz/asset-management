// ── Cihaz Tipi Tespiti ────────────────────────────────────────────────────────
// SNMP sysDescr + hostname üzerinden marka/kategori tahmin eder

const SIGNATURES = [
  // Ağ Aygıtları
  { pattern: /cisco|ios xe|ios xr|nexus/i,              category: 'Ağ Aygıtı',    brand: 'Cisco'     },
  { pattern: /fortigate|fortinet|fortiswitch/i,         category: 'Ağ Aygıtı',    brand: 'Fortinet'  },
  { pattern: /ubiquiti|unifi|edgeos/i,                  category: 'Ağ Aygıtı',    brand: 'Ubiquiti'  },
  { pattern: /mikrotik|routeros/i,                      category: 'Ağ Aygıtı',    brand: 'MikroTik'  },
  { pattern: /juniper|junos/i,                          category: 'Ağ Aygıtı',    brand: 'Juniper'   },
  { pattern: /pfsense|opnsense/i,                       category: 'Ağ Aygıtı',    brand: 'Netgate'   },
  { pattern: /aruba|procurve/i,                         category: 'Ağ Aygıtı',    brand: 'Aruba'     },
  { pattern: /tp.?link/i,                               category: 'Ağ Aygıtı',    brand: 'TP-Link'   },
  { pattern: /netgear/i,                                category: 'Ağ Aygıtı',    brand: 'Netgear'   },
  { pattern: /zyxel/i,                                  category: 'Ağ Aygıtı',    brand: 'Zyxel'     },

  // Yazıcılar
  { pattern: /laserjet|jetdirect|hp.*print/i,           category: 'Yazıcı',        brand: 'HP'        },
  { pattern: /epson/i,                                  category: 'Yazıcı',        brand: 'Epson'     },
  { pattern: /canon/i,                                  category: 'Yazıcı',        brand: 'Canon'     },
  { pattern: /kyocera/i,                                category: 'Yazıcı',        brand: 'Kyocera'   },
  { pattern: /brother/i,                                category: 'Yazıcı',        brand: 'Brother'   },
  { pattern: /ricoh/i,                                  category: 'Yazıcı',        brand: 'Ricoh'     },
  { pattern: /xerox/i,                                  category: 'Yazıcı',        brand: 'Xerox'     },

  // El Terminalleri
  { pattern: /zebra/i,                                  category: 'El Terminali',  brand: 'Zebra'     },
  { pattern: /honeywell.*mobile|ct[0-9]{2}/i,           category: 'El Terminali',  brand: 'Honeywell' },
  { pattern: /datalogic/i,                              category: 'El Terminali',  brand: 'Datalogic' },

  // Bilgisayarlar
  { pattern: /windows/i,                                category: 'Bilgisayar',    brand: null        },
  { pattern: /linux|ubuntu|debian|centos|rhel/i,        category: 'Bilgisayar',    brand: null        },
  { pattern: /macos|darwin/i,                           category: 'Bilgisayar',    brand: 'Apple'     },
];

function detectDevice(snmpData) {
  const text = [
    snmpData?.sysDescr    || '',
    snmpData?.sysName     || '',
    snmpData?.sysLocation || '',
  ].join(' ');

  for (const sig of SIGNATURES) {
    if (sig.pattern.test(text)) {
      return { category: sig.category, brand: sig.brand };
    }
  }
  return { category: 'Diğer', brand: null };
}

// SNMP'den marka/model ayrıştır
function parseBrandModel(sysDescr) {
  if (!sysDescr) return { brand: null, model: null };

  // Cisco: "Cisco IOS Software, Version 15.2..."
  const ciscoModel = sysDescr.match(/cisco\s+([\w-]+)/i);
  if (ciscoModel) return { brand: 'Cisco', model: ciscoModel[1] };

  // FortiGate: "FortiGate-60F v7.4.1..."
  const fgModel = sysDescr.match(/FortiGate-([\w-]+)/i);
  if (fgModel) return { brand: 'Fortinet', model: `FortiGate-${fgModel[1]}` };

  // HP LaserJet: "HP LASERJET PRO M404N..."
  const hpModel = sysDescr.match(/HP\s+(LaserJet\s+[\w\s]+)/i);
  if (hpModel) return { brand: 'HP', model: hpModel[1].trim() };

  return { brand: null, model: null };
}

module.exports = { detectDevice, parseBrandModel };
