/* ── Bildirim Dürüstlüğü Testleri ─────────────────────────────────────────────
   Telegram/mail'e giden uyarı özeti DEMO cihaz göstermemeli. scanNetwork,
   besleme kaynağı 'sample-feed' (demo) veya 'unavailable' ise GERÇEK alarm
   üretmemeli — aksi halde müşteriye sahte "karantina/spoofing" bildirimi gider.

   Bu, sahada bir kez patlamıştı: canlı log "[discovery] 2 karantina → bildirim"
   diyordu ama o 2 cihaz demo beslemesindendi. Besleme kaynağına göre kesiliyor;
   bu test o kesmeyi dondurur. İZOLE: geçici SQLite, gerçek envantere dokunmaz. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-notify-'));
process.env.DATABASE_URL = 'sqlite:' + path.join(TMP, 'n.db');
process.env.INVENTORY_PROVIDER = 'sql';
process.env.AI_PROVIDER = 'none';
process.env.NODE_ENV = 'test';

let db, net;

before(async () => {
  db = require('../db');
  await db.migrate();
  net = require('../agent/tools/network-discovery');
});

after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows kilidi */ } });

test('scanNetwork: DEMO besleme (sample-feed) gerçek alarm üretmez', async () => {
  const demoFeed = {
    source: 'sample-feed', captured_at: new Date().toISOString(),
    devices: [
      { mac: 'AA:BB:CC:DD:EE:01', ip: '10.0.0.51', hostname: 'DEMO-PC-1' },
      { mac: 'AA:BB:CC:DD:EE:02', ip: '10.0.0.52', hostname: 'DEMO-PC-2' },
    ],
  };
  const r = await net.scanNetwork(null, demoFeed);
  assert.equal(r.configured, false, 'demo besleme configured:false olmalı');
  assert.equal(r.is_demo, true, 'demo besleme is_demo:true olmalı');
  assert.equal(r.findings.count, 0, 'demo beslemeden GERÇEK bulgu çıkmamalı (bildirime düşer)');
  assert.equal(r.alarm, false, 'demo beslemede alarm olmamalı');
});

test('scanNetwork: besleme YOK (unavailable) alarm üretmez', async () => {
  const r = await net.scanNetwork(null, { source: 'unavailable', captured_at: null, devices: [] });
  assert.equal(r.configured, false);
  assert.equal(r.findings.count, 0);
});

test('scanNetwork: GERÇEK besleme kaynağı taramayı yapar (configured:false DEĞİL)', async () => {
  // Gerçek kaynak (sample-feed/unavailable dışında) → tarama çalışır; envanter
  // boş olduğu için bulgu 0 ama "yapılandırılmamış" diye kesilMEZ.
  const r = await net.scanNetwork(null, { source: 'live-arp', captured_at: new Date().toISOString(), devices: [] });
  assert.notEqual(r.configured, false, 'gerçek besleme configured:false olmamalı');
  assert.equal(r.findings.count, 0);
});
