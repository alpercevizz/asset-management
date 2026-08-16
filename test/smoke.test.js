/* ── AssetMan Görünüm Duman Testi (tarayıcı) ─────────────────────────────────
   app.js 6900+ satır ve modüllere bölünecek. Bölme sırasında bir görünümün
   yükleyicisi kopsa sunucu testleri bunu GÖRMEZ — hata tarayıcıda oluşur.
   Bu dosya o boşluğu kapatır: her görünüm gerçekten açılıyor mu, konsolda
   hata var mı, istekler tutuyor mu, ekran "Yükleniyor…"da takılı kalıyor mu.

   ATLANIR (fail etmez): puppeteer-core veya Chrome yoksa test skip edilir.
   Sunucuda ve CI'da tarayıcı olmayabilir; oradaki `npm test` bu yüzden
   kırmızıya dönmemeli. Yerelde Chrome varsa tam çalışır.

   Sunucu ALT SÜREÇTE, geçici SQLite ile kalkar — gerçek envantere dokunmaz. */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.SMOKE_TEST_PORT || 3124);
const KOK = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-smoke-'));
const SIFRE = 'admin123';

const CHROME_ADAYLARI = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function chromeBul() {
  return CHROME_ADAYLARI.find((y) => { try { return fs.existsSync(y); } catch { return false; } }) || null;
}

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch { /* kurulu değil */ }
const CHROME = chromeBul();
const CALISABILIR = Boolean(puppeteer && CHROME);
const ATLA_SEBEP = !puppeteer ? 'puppeteer-core kurulu değil'
  : !CHROME ? 'Chrome bulunamadı (CHROME_PATH ile verilebilir)' : '';

/* Yükleyicisi olan görünümler ve o görünümün "doldu" göstergesi.
   Boş veri geçerli bir sonuçtur — aradığımız HATA, veri değil. */
const GORUNUMLER = [
  ['dashboard', '#miniStats, .kpi-card, .dash-row3'],
  ['assets', '#assetsBody'],
  ['licenses', '#licenseBody, #licTableBody'],
  ['lines', '#linesBody'],
  ['alerts', '#offlineBody'],
  ['lifecycle', '#lifeTotalEvents, #chainStatusCard'],
  ['insights', '#riskBody, #view-insights .card'],
  ['reports', '#rpKartlar'],
  ['locations', '#view-locations .card'],
  ['users', '#view-users'],
  ['operations', '#view-operations'],
  ['settings', '#view-settings .card'],
];

let sunucu = null;
let tarayici = null;
let sayfa = null;
const konsolHatalari = [];
const sayfaHatalari = [];
const kotuIstekler = [];

function istek(yol) {
  return new Promise((c, r) => {
    http.get({ host: '127.0.0.1', port: PORT, path: yol }, (res) => {
      res.resume(); res.on('end', () => c(res.statusCode));
    }).on('error', r);
  });
}

async function hazirBekle(saniye = 40) {
  for (let i = 0; i < saniye * 2; i++) {
    try { if (await istek('/api/health') < 500) return true; } catch { /* bekle */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

before(async () => {
  if (!CALISABILIR) return;
  sunucu = spawn(process.execPath, [path.join(KOK, 'server.js')], {
    cwd: TMP,                       // .env override'ından kaçınmak için (bkz. api.test.js)
    env: {
      ...process.env,
      PORT: String(PORT), NODE_ENV: 'test',
      DATABASE_URL: 'sqlite:' + path.join(TMP, 'smoke.db'),
      INVENTORY_PROVIDER: 'sql', AUTH_PROVIDER: 'local', AI_PROVIDER: 'none', FX_PROVIDER: 'static',
      WORM_REPO_DIR: path.join(TMP, 'worm'),
      SESSION_SECRET: 'smoke-test-secret-en-az-otuziki-karakter-uz!',
      CHAIN_SECRET: 'smoke-test-chain-secret-en-az-otuziki-karakt!',
      WORM_SECRET: 'smoke-test-worm-secret-en-az-otuziki-karakterr!',
      APP_PASSWORD: SIFRE, SUPPRESS_PASSWORD_LOG: '1', DISABLE_LOGIN_RATE_LIMIT: 'true',
      // Rol testi için: farklı rollerdeki tohum hesaplarının parolaları
      USER_PW_MEHMET_YILMAZ: 'Mehmet.2024!', USER_PW_AHMET_SAHIN: 'Ahmet.2024!',
      NOTIFY_ENABLED: 'false', SNMP_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  sunucu.stdout.on('data', (d) => { log += d; });
  sunucu.stderr.on('data', (d) => { log += d; });
  if (!(await hazirBekle())) {
    sunucu.kill('SIGKILL');
    throw new Error('Duman testi sunucusu kalkmadı:\n' + log.slice(-1200));
  }

  tarayici = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  sayfa = await tarayici.newPage();
  await sayfa.setViewport({ width: 1600, height: 1000 });
  sayfa.on('pageerror', (e) => sayfaHatalari.push(e.message));
  sayfa.on('console', (m) => { if (m.type() === 'error') konsolHatalari.push(m.text()); });
  sayfa.on('response', (r) => {
    // favicon ve kasıtlı 404 denemeleri hariç, 4xx/5xx toplanır
    if (r.status() >= 400 && !r.url().includes('favicon')) kotuIstekler.push(`${r.status()} ${r.url().replace(`http://127.0.0.1:${PORT}`, '')}`);
  });

  await sayfa.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'networkidle2' });
  await sayfa.type('#username', 'admin');
  await sayfa.type('#password', SIFRE);
  await Promise.all([
    sayfa.waitForNavigation({ waitUntil: 'networkidle2' }),
    sayfa.click('button[type=submit]'),
  ]);
  await new Promise((r) => setTimeout(r, 3000));   // ilk yükleme otursun
});

after(async () => {
  if (tarayici) await tarayici.close().catch(() => {});
  if (sunucu && !sunucu.killed) sunucu.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows kilidi */ }
});

test('duman: her görünüm açılıyor, yüklemede takılmıyor', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  const sorunlar = [];
  for (const [ad, secici] of GORUNUMLER) {
    await sayfa.evaluate((v) => showView(v), ad);
    await new Promise((r) => setTimeout(r, 1400));

    const durum = await sayfa.evaluate((ad, secici) => {
      const v = document.getElementById('view-' + ad);
      if (!v) return { yok: true };
      /* Takılan öğeyi ADIYLA bildir: "bir yerde Yükleniyor kalmış" demek
         hata ayıklarken işe yaramıyor. */
      const takilanlar = [...v.querySelectorAll('*')]
        .filter((e) => e.children.length === 0 && /Yükleniyor\.\.\./.test(e.textContent))
        .map((e) => e.id || e.parentElement?.id || e.className || e.tagName);
      return {
        gorunur: !v.classList.contains('hidden') && v.offsetParent !== null,
        icerik: v.innerHTML.length,
        takili: takilanlar,
        capa: secici.split(',').some((s) => document.querySelector(s.trim())),
      };
    }, ad, secici);

    if (durum.yok) sorunlar.push(`${ad}: view-${ad} DOM'da yok`);
    else {
      if (!durum.gorunur) sorunlar.push(`${ad}: görünür değil`);
      if (durum.icerik < 200) sorunlar.push(`${ad}: içerik boş (${durum.icerik} bayt)`);
      if (durum.takili.length) sorunlar.push(`${ad}: "Yükleniyor..." kalmış -> ${durum.takili.join(', ')}`);
      if (!durum.capa) sorunlar.push(`${ad}: beklenen öğe yok (${secici})`);
    }
  }
  assert.deepEqual(sorunlar, [], 'bozulan görünümler');
});

test('duman: modallar açılıp kapanıyor', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  await sayfa.evaluate(() => showView('lines'));
  await new Promise((r) => setTimeout(r, 1200));

  const hatModali = await sayfa.evaluate(() => {
    document.getElementById('openAddLine')?.click();
    const o = document.getElementById('lineModalOverlay');
    return { acildi: !!o?.classList.contains('open'), alanVar: !!document.getElementById('lineMsisdn') };
  });
  assert.ok(hatModali.acildi, 'Hat Ekle modalı açılmadı');
  assert.ok(hatModali.alanVar, 'Hat Ekle modalında alanlar yok');

  const kapandi = await sayfa.evaluate(() => {
    document.getElementById('cancelLineBtn')?.click();
    return !document.getElementById('lineModalOverlay')?.classList.contains('open');
  });
  assert.ok(kapandi, 'Hat Ekle modalı kapanmadı');
});

test('duman: rapor önizlemesi üretiliyor', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  await sayfa.evaluate(() => showView('reports'));
  await new Promise((r) => setTimeout(r, 2200));
  await sayfa.evaluate(() => document.querySelector('.rp-kart[data-rapor="genel"] .rp-onizle')?.click());
  await new Promise((r) => setTimeout(r, 2500));

  const rapor = await sayfa.evaluate(() => ({
    sayfa: document.querySelectorAll('.rd-sayfa').length,
    tasan: document.querySelectorAll('.rd-sayfa--tasan').length,
  }));
  assert.ok(rapor.sayfa > 0, 'rapor sayfası üretilmedi');
  assert.equal(rapor.tasan, 0, 'rapor sayfası A4 sınırını aşıyor');
});

/* Gezinti bittikten SONRA toplanan hatalar değerlendirilir: tek tek testlerde
   kontrol etmek, hatanın hangi görünümden geldiğini kaybettiriyordu. */
test('duman: konsol ve ağ temiz', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  assert.deepEqual(sayfaHatalari, [], 'yakalanmamış JS hatası');
  assert.deepEqual(konsolHatalari, [], 'konsolda hata');
  assert.deepEqual(kotuIstekler, [], '4xx/5xx dönen istek');
});

/* ── Rol bazlı arayüz ────────────────────────────────────────────────────────
   Sunucudaki requireRole ile arayüzdeki data-rol AYNI kuralı söylemeli. Bu
   test ikisinin ayrışmasını yakalar: yeni bir yazma düğmesi eklenip data-rol
   unutulursa approver o düğmeyi görür, basar ve 403 alır.

   NOT: gizleme GÜVENLİK DEĞİL. Gerçek denetim sunucuda; burada test edilen
   şey kullanıcıya çalışmayan düğme gösterilmemesi. */
const ROL_HEDEFLERI = ['navSettings', 'navUsers', 'openAddModal', 'openAddLine',
  'importLinesBtn', 'lifeRecordBtn'];

async function rolGorunurluk(kullanici, sifre) {
  const ctx = await tarayici.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 1600, height: 1000 });
  await p.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: 'networkidle2' });
  await p.type('#username', kullanici);
  await p.type('#password', sifre);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }), p.click('button[type=submit]')]);
  await new Promise((r) => setTimeout(r, 2500));
  // Düğmelerin bulunduğu görünümler ziyaret edilmeli ki DOM'da ölçülebilsinler
  await p.evaluate(() => showView('lines'));
  await new Promise((r) => setTimeout(r, 700));
  await p.evaluate(() => showView('lifecycle'));
  await new Promise((r) => setTimeout(r, 700));
  const sonuc = await p.evaluate((ids) => {
    const o = { _rol: typeof state !== 'undefined' ? state.role : null };
    ids.forEach((id) => {
      const e = document.getElementById(id);
      o[id] = e ? getComputedStyle(e).display !== 'none' : null;
    });
    return o;
  }, ROL_HEDEFLERI);
  await ctx.close();
  return sonuc;
}

test('duman: rol bazlı arayüz — approver yazma düğmelerini görmez', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  const admin = await rolGorunurluk('admin', SIFRE);
  assert.equal(admin._rol, 'admin');
  assert.ok(admin.navSettings && admin.navUsers, 'admin yönetim menülerini görmeli');
  assert.ok(admin.openAddLine && admin.lifeRecordBtn, 'admin yazma düğmelerini görmeli');

  const bt = await rolGorunurluk('mehmet.yilmaz', 'Mehmet.2024!');
  assert.equal(bt._rol, 'it');
  assert.equal(bt.navSettings, false, 'BT ekibi Ayarlar menüsünü görmemeli (admin uçları)');
  assert.equal(bt.navUsers, false, 'BT ekibi Kullanıcılar menüsünü görmemeli');
  assert.ok(bt.openAddLine && bt.importLinesBtn && bt.lifeRecordBtn && bt.openAddModal,
    'BT ekibi yazma düğmelerini görmeli — sunucu requireRole(it, admin) izin veriyor');

  const onaylayan = await rolGorunurluk('ahmet.sahin', 'Ahmet.2024!');
  assert.equal(onaylayan._rol, 'approver');
  const gorunenler = ROL_HEDEFLERI.filter((id) => onaylayan[id] === true);
  assert.deepEqual(gorunenler, [],
    'onaylayıcı hiçbir yazma/yönetim öğesini görmemeli — hepsi 403 dönerdi');
});

/* ── Stored XSS: kullanıcı verisi işlenerek yazdırılmamalı ────────────────────
   Bir alana script yükü koyup kaydediyoruz; liste render edildiğinde yük
   ÇALIŞMAMALI (escapeHtml ile kaçırılmalı). Tarayıcı gerektirir. */
test('duman: alan verisindeki XSS yükü çalıştırılmaz (escape)', async (t) => {
  if (!CALISABILIR) return t.skip(ATLA_SEBEP);

  const YUK = '<img src=x onerror="window.__xss_calisti=1">XSSPROBE';
  // Admin oturumuyla same-origin fetch: bir hat kaydı oluştur
  const olustur = await sayfa.evaluate(async (yuk) => {
    const r = await fetch('/api/lines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msisdn: '05559998877', iccid: '8990011122233344999', operator: yuk, status: 'aktif' }),
    });
    return r.status;
  }, YUK);
  assert.ok(olustur < 400, `test kaydı oluşturulamadı (durum ${olustur})`);

  await sayfa.evaluate(() => { window.__xss_calisti = undefined; showView('lines'); });
  await new Promise((r) => setTimeout(r, 1500));

  const sonuc = await sayfa.evaluate(() => {
    const govde = document.getElementById('linesBody');
    return {
      calisti: window.__xss_calisti === 1,
      metinIcinde: (govde?.textContent || '').includes('XSSPROBE'),   // veri görünüyor
      gercekImg: !!govde?.querySelector('img[onerror]'),              // ham <img> DOM'a girdiyse felaket
    };
  });

  assert.equal(sonuc.calisti, false, 'XSS yükü ÇALIŞTI — kullanıcı verisi kaçırılmıyor');
  assert.equal(sonuc.gercekImg, false, 'ham <img onerror> DOM\'a enjekte edildi');
  assert.ok(sonuc.metinIcinde, 'veri hiç görünmüyor — test yükü yanlış yere gitti');
});
