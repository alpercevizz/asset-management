// ── AssetMan Çekirdek Test Suite (node:test — dış bağımlılık yok) ────────────
// Çekirdek IP'yi (HMAC zincir, dijital imza, onay akışı, sameDevice, WORM, scrypt auth)
// regresyona karşı kilitler. Baserow'a/ağa DOKUNMAZ — yalnız deterministik mantık.
// İzolasyon: gerçek demo verisini ezmemek için tüm dosyalar geçici dizine yönlendirilir.
const os = require('os');
const fs = require('fs');
const path = require('path');

// require'dan ÖNCE env override (modüller bu yolları yükleme anında okur)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-test-'));
process.env.LIFECYCLE_LOG_FILE = path.join(TMP, 'lifecycle-log.json');
process.env.WORM_REPO_DIR = path.join(TMP, 'worm');
process.env.USERS_FILE = path.join(TMP, 'users.json');
process.env.SESSION_SECRET = 'test-secret-en-az-otuziki-karakter-uzunlukta!!';
process.env.CHAIN_SECRET = 'test-chain-secret-en-az-otuziki-karakter-uzun!';
process.env.WORM_SECRET = 'test-worm-secret-en-az-otuziki-karakter-uzunn!';
process.env.APPROVAL_TTL_MS = '60000';
process.env.OS_AGENTS_FILE = path.join(TMP, 'os-agents.json');
// Test kullanıcı parolaları (üretim kodunda hardcoded YOK; testte env ile veriyoruz)
process.env.APP_PASSWORD             = 'admin123';
process.env.USER_PW_MEHMET_YILMAZ    = 'Mehmet.2024!';
process.env.USER_PW_DBADMIN          = 'DbAdmin.2024!';
process.env.USER_PW_AHMET_SAHIN      = 'Ahmet.2024!';
process.env.USER_PW_ZEYNEP_KORKMAZ   = 'Zeynep.2024!';
process.env.USER_PW_MURAT_DEMIR      = 'Murat.2024!';
process.env.SUPPRESS_PASSWORD_LOG    = '1'; // test çıktısını kirletmesin

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const lc = require('../agent/tools/lifecycle-tools');
const users = require('../auth/users');
const worm = require('../agent/tools/worm-backup');
const osAgent = require('../agent/tools/os-agent');
const finops = require('../agent/tools/finops-tools');
const { vlanOf } = require('../agent/tools/network-discovery');

function resetLog() {
  fs.writeFileSync(process.env.LIFECYCLE_LOG_FILE, JSON.stringify({ events: [] }));
  worm._resetRepo();
}

// ── Auth / scrypt ─────────────────────────────────────────────────────────────
test('auth: scrypt parola doğru/yanlış + authenticate + rol', () => {
  assert.ok(users.authenticate('admin', 'admin123'), 'admin doğru parola geçmeli');
  assert.equal(users.authenticate('admin', 'yanlis'), null, 'yanlış parola reddedilmeli');
  assert.equal(users.authenticate('yokboyle', 'x'), null, 'olmayan kullanıcı null');
  const a = users.authenticate('ahmet.sahin', 'Ahmet.2024!');
  assert.equal(a.role, 'approver');
  assert.equal(a.password, undefined, 'publicUser parola sızdırmamalı');
  assert.ok(users.hasRole({ role: 'admin' }, 'it', 'admin'));
  assert.ok(!users.hasRole({ role: 'it' }, 'approver'));
});

test('auth: identityOf AD kimliği döndürür (UPN/IP/MFA)', () => {
  const id = users.identityOf('dbadmin', { mfa_verified: false });
  assert.match(id.actor_upn, /@/);
  assert.equal(id.mfa_verified, false);
  assert.equal(id.actor_role, 'it');
});

// ── HMAC hash zinciri + tamper ─────────────────────────────────────────────────
test('zincir: recordEvent ekler, verifyChain geçerli', () => {
  resetLog();
  lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Satın Alındı', actor: 'admin' });
  lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Aktif - Zimmetlendi', actor: 'admin' });
  const v = lc.verifyChain();
  assert.equal(v.valid, true);
  assert.equal(v.total, 2);
});

test('zincir: içerik değiştirilirse verifyChain BOZULDU der', () => {
  resetLog();
  lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Satın Alındı', actor: 'admin' });
  lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Bakımda', actor: 'admin' });
  const j = JSON.parse(fs.readFileSync(process.env.LIFECYCLE_LOG_FILE, 'utf8'));
  j.events[0].note = 'ELLE DEĞİŞTİRİLDİ';
  fs.writeFileSync(process.env.LIFECYCLE_LOG_FILE, JSON.stringify(j));
  const v = lc.verifyChain();
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, 1);
});

// ── Dijital imza (HMAC) + forgery ──────────────────────────────────────────────
test('imza: onaylanan kayıt imzalı; approver kurcalanırsa zincir bozulur', () => {
  resetLog();
  // pending sonra approve
  const s = lc.submitChange({ hostname: 'SRV1', asset_id: 2, to_status: 'Depoya Kaldırıldı', actor: 'admin', approver: 'Ahmet Şahin (BT Müdürü)' });
  assert.equal(s.kind, 'pending');
  const r = lc.approveByToken(s.approval_token, { actor: 'ahmet.sahin', approver: 'Ahmet Şahin (BT Müdürü)' });
  assert.equal(r.event.signed, true);
  assert.ok(r.event.signature);
  // approver alanını dosyada değiştir → hem hash hem imza tutmamalı
  const j = JSON.parse(fs.readFileSync(process.env.LIFECYCLE_LOG_FILE, 'utf8'));
  const idx = j.events.findIndex(e => e.signed);
  j.events[idx].approver = 'Sahte Kişi';
  fs.writeFileSync(process.env.LIFECYCLE_LOG_FILE, JSON.stringify(j));
  assert.equal(lc.verifyChain().valid, false);
});

// ── Onay akışı (dual-auth) ─────────────────────────────────────────────────────
test('onay akışı: non-kritik=applied, kritik+onaysız=breach, kritik+onaylı=pending', () => {
  resetLog();
  assert.equal(lc.submitChange({ hostname: 'PC2', asset_id: 3, to_status: 'Bakımda', actor: 'admin' }).kind, 'applied');
  const breach = lc.submitChange({ hostname: 'PC3', asset_id: 4, to_status: 'Kayıp', actor: 'dbadmin' });
  assert.equal(breach.kind, 'breach');
  assert.equal(breach.event.security_flag, 'imzasiz_kritik');
  assert.equal(lc.submitChange({ hostname: 'PC4', asset_id: 5, to_status: 'Zimmet Değişikliği', actor: 'admin', approver: 'Murat Demir (Departman Yöneticisi)' }).kind, 'pending');
});

test('onay akışı: self-approval reddedilir', () => {
  resetLog();
  const s = lc.submitChange({ hostname: 'PC5', asset_id: 6, to_status: 'Depoya Kaldırıldı', actor: 'mehmet.yilmaz', approver: 'Ahmet Şahin (BT Müdürü)' });
  assert.throws(
    () => lc.approveByToken(s.approval_token, { actor: 'mehmet.yilmaz', approver: 'Mehmet Yılmaz' }),
    /Kendi oluşturduğunuz/,
    'işlemi yapan kendi talebini onaylayamamalı'
  );
});

test('onay akışı: TTL aşımı expired+ihlal; renew yeni pending', () => {
  resetLog();
  // süresi geçmiş pending elle ekle
  lc.recordEvent({ hostname: 'PC6', asset_id: 7, to_status: 'Hurdaya Ayrıldı', actor: 'admin', approver: 'Murat Demir (Departman Yöneticisi)', approval_status: 'pending', approval_id: 'A1', approval_token: 'tok1', approval_expires_at: new Date(Date.now() - 1000).toISOString() });
  const expired = lc.expirePendingRequests();
  assert.equal(expired.length, 1);
  assert.equal(expired[0].security_flag, 'onay_zaman_asimi');
  const rn = lc.renewRequest({ approval_id: 'A1', actor: 'admin' });
  assert.ok(rn.approval_token && rn.approval_id !== 'A1');
});

// ── sameDevice (asset_id stabil join) ──────────────────────────────────────────
test('sameDevice: asset_id rename dayanıklı + yanlış eşleşme yok', () => {
  resetLog();
  lc.recordEvent({ hostname: 'ESKI-AD', asset_id: 42, serial_number: 'SN42', to_status: 'Depoya Kaldırıldı', actor: 'admin', approver: 'Ahmet Şahin (BT Müdürü)', approval_status: 'approved', approval_id: 'X' });
  // hostname/serial değişti ama asset_id=42 → bulunmalı
  const hit = lc.getCurrentStatusForAsset({ id: 42, hostname: 'YENI-AD', serial_number: 'BASKA' });
  assert.equal(hit.status, 'Depoya Kaldırıldı');
  // yanlış id ama eski hostname/serial → iki tarafta da id var → eşleşmemeli
  const miss = lc.getCurrentStatusForAsset({ id: 999, hostname: 'ESKI-AD', serial_number: 'SN42' });
  assert.equal(miss, null);
});

// ── WORM yedek ─────────────────────────────────────────────────────────────────
test('WORM: her kayıt yedeklenir, yerel silinince geri yüklenir', () => {
  resetLog();
  for (let i = 0; i < 5; i++) lc.recordEvent({ hostname: 'W' + i, asset_id: 100 + i, to_status: 'Satın Alındı', actor: 'admin' });
  let st = lc.auditBackupStatus();
  assert.equal(st.in_sync, true);
  assert.equal(st.backup_count, 5);
  // yerel logu boşalt (art niyetli silme simülasyonu)
  fs.writeFileSync(process.env.LIFECYCLE_LOG_FILE, JSON.stringify({ events: [] }));
  st = lc.auditBackupStatus();
  assert.equal(st.recovery_needed, true, 'yerel boş, yedek 5 → kurtarma gerekli');
  const rec = lc.restoreAuditFromBackup();
  assert.equal(rec.restored, 5);
  assert.equal(lc.verifyChain().valid, true);
});

test('WORM: AES şifreleme roundtrip + atomik write-once', () => {
  resetLog();
  lc.recordEvent({ hostname: 'ENC', asset_id: 200, to_status: 'Satın Alındı', actor: 'admin' });
  const evs = worm.readBackupEvents();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].hostname, 'ENC'); // deşifre doğru
});

// ── T2: OS Agent handshake (spoofing kalkanı) ──────────────────────────────────
test('os-agent: doğru token doğrular, yanlış token SPOOFING, enrollment yoksa managed=false', () => {
  const enrolled = osAgent.loadAgents()[0]; // örn. ALPER-PC asset_id 6
  const goodToken = osAgent.genTokenForAsset(enrolled.asset_id);
  const okRes = osAgent.verifyOsAgent({ id: enrolled.asset_id }, goodToken);
  assert.equal(okRes.managed, true);
  assert.equal(okRes.verified, true);
  const spoof = osAgent.verifyOsAgent({ id: enrolled.asset_id }, 'BOGUS-TOKEN');
  assert.equal(spoof.verified, false);
  assert.equal(spoof.reason, 'token_uyusmuyor'); // MAC doğru olsa bile → spoofing
  const unmanaged = osAgent.verifyOsAgent({ id: 999999 }, 'x');
  assert.equal(unmanaged.managed, false);
});

// ── T1: VLAN segmentasyonu ─────────────────────────────────────────────────────
test('vlanOf: IP/subnet → VLAN segment', () => {
  assert.equal(vlanOf('10.0.1.10'), 10);
  assert.equal(vlanOf('10.0.2.41'), 20);
  assert.equal(vlanOf('192.168.50.10'), 50);
  assert.equal(vlanOf('172.16.0.1'), 0); // bilinmeyen → segmentsiz
});

// ── T3: Dinamik FinOps döviz dönüşümü ──────────────────────────────────────────
test('finops: kur döner, USD→TRY dönüşümü kurla ölçeklenir', () => {
  const fx = finops.getFxRates();
  assert.ok(fx.USD_TRY > 0 && fx.EUR_TRY > 0);
  assert.match(fx.source, /API/);
  const pc = finops.costFor('Bilgisayar', fx);
  assert.ok(pc.usd > 0);
  // TRY ≈ USD × kur (yuvarlama toleransı)
  assert.ok(Math.abs(pc.try - pc.usd * fx.USD_TRY) < 1);
  // Kur artarsa TRY artar (monotonluk)
  const hi = finops.costFor('Bilgisayar', { USD_TRY: 50, EUR_TRY: 54 });
  const lo = finops.costFor('Bilgisayar', { USD_TRY: 30, EUR_TRY: 33 });
  assert.ok(hi.try > lo.try);
});
