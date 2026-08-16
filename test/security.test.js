/* ── AssetMan Güvenlik Testleri (saldırı sınıfları) ──────────────────────────
   Strix gibi otonom bir sömürü ajanının arayacağı açık SINIFLARINI kalıcı,
   deterministik testlere çevirir. Tek seferlik bir taramadan farkı: repo'da
   kalır, her `npm test`'te tekrar korur.

   Kapsam: Kırık Erişim Denetimi (BAC/IDOR), yetki yükseltme, jeton bütünlüğü,
   kimlik doğrulama atlatma (injection), HTTP metod oynaması, gövde limiti.
   Rate-limit ayrı dosyada (kendi izole sunucusu gerekiyor).

   İZOLASYON: alt süreç + geçici SQLite. Gerçek envantere dokunmaz. Bu
   testler KENDİ yerel sunucumuza karşı çalışır — üçüncü tarafa saldırı değil,
   savunmanın gerçekten dayattığının kanıtı. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.SEC_TEST_PORT || 3126);
const KOK = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-sec-'));
const SIFRE = 'admin123';

let sunucu = null;
const cerez = {};   // rol → cookie

function istek(yol, { method = 'GET', body = null, cookie = '', headers = {}, rawBody = null } = {}) {
  return new Promise((cozumle, reddet) => {
    const veri = rawBody !== null ? rawBody : (body === null ? null : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: yol, method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(veri !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(veri) } : {}),
        ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch { /* HTML/boş olabilir */ }
        cozumle({ durum: res.statusCode, basliklar: res.headers, govde: d, json });
      });
    });
    req.on('error', reddet);
    if (veri !== null) req.write(veri);
    req.end();
  });
}

async function girisYap(kullanici, sifre) {
  const r = await istek('/api/login', { method: 'POST', body: { username: kullanici, password: sifre } });
  const ck = r.basliklar['set-cookie'];
  if (!ck) throw new Error(`${kullanici} giriş yapamadı (durum ${r.durum})`);
  return ck.map((c) => c.split(';')[0]).join('; ');
}

async function hazirBekle(saniye = 40) {
  for (let i = 0; i < saniye * 2; i++) {
    try { const r = await istek('/api/health'); if (r.durum && r.durum < 500) return true; } catch { /* bekle */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

before(async () => {
  sunucu = spawn(process.execPath, [path.join(KOK, 'server.js')], {
    cwd: TMP,
    env: {
      ...process.env,
      PORT: String(PORT), NODE_ENV: 'test',
      DATABASE_URL: 'sqlite:' + path.join(TMP, 'sec.db'),
      INVENTORY_PROVIDER: 'sql', AUTH_PROVIDER: 'local', AI_PROVIDER: 'none', FX_PROVIDER: 'static',
      WORM_REPO_DIR: path.join(TMP, 'worm'),
      SESSION_SECRET: 'sec-test-secret-en-az-otuziki-karakter-uzunn!',
      CHAIN_SECRET: 'sec-test-chain-secret-en-az-otuziki-karakter!',
      WORM_SECRET: 'sec-test-worm-secret-en-az-otuziki-karakterrr!',
      APP_PASSWORD: SIFRE,
      USER_PW_MEHMET_YILMAZ: 'Mehmet.2024!',   // rol: it
      USER_PW_AHMET_SAHIN: 'Ahmet.2024!',      // rol: approver
      SUPPRESS_PASSWORD_LOG: '1', DISABLE_LOGIN_RATE_LIMIT: 'true',
      NOTIFY_ENABLED: 'false', SNMP_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  sunucu.stdout.on('data', (d) => { log += d; });
  sunucu.stderr.on('data', (d) => { log += d; });
  if (!(await hazirBekle())) { sunucu.kill('SIGKILL'); throw new Error('Güvenlik testi sunucusu kalkmadı:\n' + log.slice(-1200)); }

  cerez.admin = await girisYap('admin', SIFRE);
  cerez.it = await girisYap('mehmet.yilmaz', 'Mehmet.2024!');
  cerez.approver = await girisYap('ahmet.sahin', 'Ahmet.2024!');
});

after(() => {
  if (sunucu && !sunucu.killed) sunucu.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows kilidi */ }
});

/* ── Kırık Erişim Denetimi (BAC) — sunucu YETKİYİ GERÇEKTEN DAYATIYOR MU? ──────
   Arayüzdeki data-rol gizleme GÜVENLİK DEĞİL; asıl sınır burada. Bu matris,
   düşük yetkili bir kullanıcının uca DOĞRUDAN istek atmasını taklit eder. */

// admin-only: hem approver hem it 403 almalı
const ADMIN_ONLY = [
  ['GET', '/api/settings'],
  ['PUT', '/api/settings/thresholds'],
  ['GET', '/api/users'],
  ['GET', '/api/agents'],
  ['POST', '/api/location-drift/seed'],
  ['POST', '/api/backup/restore'],   // denetim zinciri geri yükleme — yıkıcı, admin olmalı
];

// it,admin: approver 403 almalı, it geçebilmeli
const IT_ADMIN = [
  ['POST', '/api/lines'],
  ['POST', '/api/lifecycle/event'],
  ['POST', '/api/register/token'],
  ['POST', '/api/notify/run'],       // dışa bildirim gönderir (mail/Telegram)
];

test('BAC: admin-only uçlar it ve approver rollerine 403 döner', async () => {
  const ihlal = [];
  for (const [m, yol] of ADMIN_ONLY) {
    for (const rol of ['it', 'approver']) {
      const r = await istek(yol, { method: m, cookie: cerez[rol], body: m === 'GET' ? null : {} });
      if (r.durum !== 403) ihlal.push(`${rol} ${m} ${yol} -> ${r.durum} (403 bekleniyordu)`);
    }
  }
  assert.deepEqual(ihlal, [], 'yetkisiz erişime izin veren admin-only uçlar');
});

test('BAC: it/admin uçları approver rolüne 403 döner, it geçer', async () => {
  const ihlal = [];
  for (const [m, yol] of IT_ADMIN) {
    const ap = await istek(yol, { method: m, cookie: cerez.approver, body: {} });
    if (ap.durum !== 403) ihlal.push(`approver ${m} ${yol} -> ${ap.durum} (403 bekleniyordu)`);
    // it: rol geçmeli — gövde eksik olduğu için 400 olabilir ama 401/403 OLMAMALI
    const it = await istek(yol, { method: m, cookie: cerez.it, body: {} });
    if (it.durum === 401 || it.durum === 403) ihlal.push(`it ${m} ${yol} -> ${it.durum} (rol geçmeliydi)`);
  }
  assert.deepEqual(ihlal, [], 'yetki dayatması bozuk uçlar');
});

test('BAC: admin yönetim uçlarına erişebilir (yetki matrisi doğru yönde)', async () => {
  const s = await istek('/api/settings', { cookie: cerez.admin });
  assert.equal(s.durum, 200, 'admin Ayarları okuyamıyor — matris ters kurulmuş olabilir');
  const u = await istek('/api/users', { cookie: cerez.admin });
  assert.equal(u.durum, 200, 'admin Kullanıcıları okuyamıyor');
});

/* ── Jeton bütünlüğü & yetki yükseltme ───────────────────────────────────────
   Oturum jetonu {u,r,exp}.HMAC. Yükü elle değiştirip rolü admin yapmak,
   imza yeniden hesaplanmadan REDDEDİLMELİ — yoksa herkes admin olurdu. */
test('AUTHZ: kurcalanmış oturum jetonu reddedilir (imza doğrulaması)', async () => {
  const ck = cerez.approver; // am_session=<payload>.<sig>
  const deger = ck.split('=')[1];
  const [payload, sig] = deger.split('.');

  // 1) İmzayı boz → 401
  const bozukSig = sig.slice(0, -2) + (sig.slice(-2) === 'AA' ? 'BB' : 'AA');
  const r1 = await istek('/api/assets', { cookie: `am_session=${payload}.${bozukSig}` });
  assert.equal(r1.durum, 401, 'bozuk imzalı jeton kabul edildi');

  // 2) Yükü admin'e çevir, ESKİ imzayı koru → 401 (imza yükü kapsıyor)
  const veri = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  veri.r = 'admin';
  const sahteYuk = Buffer.from(JSON.stringify(veri)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const r2 = await istek('/api/users', { cookie: `am_session=${sahteYuk}.${sig}` });
  assert.equal(r2.durum, 401, 'yükü değiştirilmiş jetonla yetki yükseltilebildi');
});

/* ── Kimlik doğrulama atlatma (injection) ────────────────────────────────────
   Klasik SQL/auth-bypass yükleri girişten geçmemeli. */
test('AUTH: injection yükleri girişi atlatamaz', async () => {
  const yukler = [
    { username: "admin' OR '1'='1' --", password: 'x' },
    { username: 'admin', password: "' OR '1'='1" },
    { username: "admin'--", password: 'x' },
    { username: 'admin", password: { "$ne": null }', password: 'x' },
  ];
  for (const y of yukler) {
    const r = await istek('/api/login', { method: 'POST', body: y });
    assert.equal(r.durum, 401, `injection girişi atlattı: ${JSON.stringify(y)}`);
    assert.ok(!r.basliklar['set-cookie'], 'injection sonrası çerez verildi');
  }
});

/* ── HTTP metod oynaması ──────────────────────────────────────────────────────
   POST-only bir mutasyon ucu GET ile TETİKLENMEMELİ. (GET, SPA fallback'ine
   düşüp panel HTML'i döndürür — 200 ama YIKICI İŞLEM ÇALIŞMAZ; kontrol
   edilen şey işlemin çalışmaması.) */
test('METOD: POST-only uç GET ile tetiklenmez', async () => {
  const r = await istek('/api/backup/restore', { method: 'GET', cookie: cerez.admin });
  assert.ok(!(r.json && r.json.success), 'GET ile yıkıcı geri yükleme çalıştı');
  assert.ok(/<!doctype html|<html/i.test(r.govde), 'beklenen SPA HTML dönmedi — metod eşleşmesi değişmiş olabilir');
});

/* ── Gövde limiti (kaynak tüketimi) ──────────────────────────────────────────
   4 MB üstü gövde çökme değil 413 vermeli. */
test('DoS: aşırı büyük gövde 413 ile reddedilir, sunucu çökmez', async () => {
  const kocaman = JSON.stringify({ msisdn: '0500', dolgu: 'A'.repeat(5 * 1024 * 1024) });
  const r = await istek('/api/lines', { method: 'POST', cookie: cerez.admin, rawBody: kocaman });
  assert.equal(r.durum, 413, `aşırı gövde ${r.durum} döndü (413 bekleniyordu)`);
  // Sunucu hâlâ ayakta mı?
  const canli = await istek('/api/health');
  assert.equal(canli.durum, 200, 'büyük gövdeden sonra sunucu yanıt vermiyor');
});
