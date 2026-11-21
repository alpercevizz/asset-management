/* ── SNMP Ağ Keşfi Testleri ───────────────────────────────────────────────────
   Keşif modülünün SAF (ağsız) mantığını dondurur: marka/kategori/model çıkarımı,
   CIDR genişletme ve — en önemlisi — subtree yürüyüşünün ZAMAN AŞIMI GUARD'ı.

   O guard neden kritik: net-snmp'nin subtree yürüyüşü eşzamanlı taramada (çok
   cihaz aynı anda) zaman zaman 'done' geri çağrısını hiç tetiklemeden askıda
   kalıyordu. Guard olmadan tek bir yavaş/arızalı cihaz probe()'u — dolayısıyla
   TÜM runDiscovery()'yi — sonsuza dondururdu. Bu test, guard'ın askıdaki bir
   yürüyüşü sınırlı sürede kestiğini kanıtlar; kırılırsa test ASILI KALMAZ,
   zaman aşımıyla düşer. */

const { test } = require('node:test');
const assert = require('node:assert');
const snmpDisc = require('../agent/tools/snmp-discovery');

test('brandFrom: enterprise OID önce, yoksa sysDescr deseni', () => {
  assert.equal(snmpDisc.brandFrom('bir şey', '1.3.6.1.4.1.9.1.1208'), 'Cisco');      // OID 9
  assert.equal(snmpDisc.brandFrom('x', '1.3.6.1.4.1.2604.5'), 'Sophos');            // OID 2604
  assert.equal(snmpDisc.brandFrom('x', '1.3.6.1.4.1.21091.1'), 'Sophos');           // OID 21091 (RED)
  assert.equal(snmpDisc.brandFrom('x', '1.3.6.1.4.1.10418.1'), 'Zebra');            // OID 10418
  assert.equal(snmpDisc.brandFrom('HP LaserJet M507', ''), 'HP');                   // sysDescr yedek
  assert.equal(snmpDisc.brandFrom('bilinmeyen cihaz', ''), null);                   // ikisi de yoksa null
});

test('categoryFrom: switch/firewall/yazıcı/el terminali doğru sınıflanır', () => {
  assert.equal(snmpDisc.categoryFrom('Cisco IOS C2960X switch'), 'Ağ Aygıtı');
  assert.equal(snmpDisc.categoryFrom('Sophos XG 210 firewall'), 'Ağ Aygıtı');
  assert.equal(snmpDisc.categoryFrom('HP LaserJet M507 printer'), 'Yazıcı');
  assert.equal(snmpDisc.categoryFrom('Zebra TC26 Android Handheld Terminal'), 'El Terminali');
  assert.equal(snmpDisc.categoryFrom('tanımsız cihaz'), 'Ağ Aygıtı');               // yedek
});

test('parseDevice: entPhysical yoksa seri SNMP-<ip> yedeğine düşer, model sysDescr\'dan', () => {
  const sys = {
    [snmpDisc.OID.sysDescr]: 'HP LaserJet M507',
    [snmpDisc.OID.sysName]: 'PRN-01',
    [snmpDisc.OID.sysObjectID]: '1.3.6.1.4.1.11.2.3.9.1',
    [snmpDisc.OID.sysUpTime]: 3 * 86400 * 100,   // 3 gün (ticks)
    [snmpDisc.OID.sysLocation]: 'Muhasebe',
  };
  const d = snmpDisc.parseDevice('10.0.0.9', sys, null, null);   // serial/model YOK
  assert.equal(d.serial_number, 'SNMP-10.0.0.9');
  assert.equal(d.brand, 'HP');
  assert.equal(d.category, 'Yazıcı');
  assert.equal(d.uptime_days, 3);
  assert.equal(d.ip_address, '10.0.0.9');
});

test('expandCidr: /32 tek host, /31 iki host, /24 ağ+broadcast hariç', () => {
  assert.deepEqual(snmpDisc.expandCidr('127.0.0.6/32'), ['127.0.0.6']);
  assert.deepEqual(snmpDisc.expandCidr('127.0.0.2/31'), ['127.0.0.2', '127.0.0.3']);
  const c = snmpDisc.expandCidr('192.168.1.0/24');
  assert.equal(c.length, 254);                       // 256 - ağ - broadcast
  assert.equal(c[0], '192.168.1.1');
});

test('REGRESYON: askıda kalan subtree yürüyüşü taramayı DONDURMAZ (zaman aşımı guard\'ı)', async () => {
  // 'done'u ASLA çağırmayan sahte oturum — guard olmadan bu Promise sonsuza kilitlenirdi.
  const askidaOturum = { subtree: () => { /* ne feed ne done — tıpkı donan gerçek cihaz */ } };
  const t0 = Date.now();
  const sonuc = await snmpDisc.snmpFirstOfSubtree(askidaOturum, '1.3.6.1.2.1.47.1.1.1.1.11', 50);
  const sure = Date.now() - t0;
  assert.equal(sonuc, null, 'askıda yürüyüş null dönmeliydi');
  assert.ok(sure < 3000, `guard ${sure}ms'de kesti — makul (sonsuza takılmadı)`);
});

test('subtree guard: değer erken gelirse yakalanır (mutlu yol)', async () => {
  // Önce bir varbind besleyip sonra done çağıran sahte oturum.
  const iyiOturum = {
    subtree: (oid, max, feed, done) => {
      feed([{ oid: oid + '.1', value: Buffer.from('FOC2145X0AB') }]);
      setTimeout(done, 5);
    },
  };
  const sonuc = await snmpDisc.snmpFirstOfSubtree(iyiOturum, '1.3.6.1.2.1.47.1.1.1.1.11', 1000);
  assert.equal(sonuc, 'FOC2145X0AB');
});
