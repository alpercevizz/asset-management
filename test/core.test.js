// ── AssetMan Çekirdek Test Suite (node:test — dış bağımlılık yok) ────────────
// Çekirdek IP'yi (HMAC zincir, dijital imza, onay akışı, sameDevice, WORM, scrypt auth)
// regresyona karşı kilitler. SQLite in-memory ile izole; gerçek data'yı ezmemek için tmp.
const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assetman-test-'));
process.env.DATABASE_URL             = 'sqlite:' + path.join(TMP, 'test.db');
process.env.WORM_REPO_DIR            = path.join(TMP, 'worm');
process.env.SESSION_SECRET           = 'test-secret-en-az-otuziki-karakter-uzunlukta!!';
process.env.CHAIN_SECRET             = 'test-chain-secret-en-az-otuziki-karakter-uzun!';
process.env.WORM_SECRET              = 'test-worm-secret-en-az-otuziki-karakter-uzunn!';
process.env.APPROVAL_TTL_MS          = '60000';
process.env.APP_PASSWORD             = 'admin123';
process.env.USER_PW_MEHMET_YILMAZ    = 'Mehmet.2024!';
process.env.USER_PW_DBADMIN          = 'DbAdmin.2024!';
process.env.USER_PW_AHMET_SAHIN      = 'Ahmet.2024!';
process.env.USER_PW_ZEYNEP_KORKMAZ   = 'Zeynep.2024!';
process.env.USER_PW_MURAT_DEMIR      = 'Murat.2024!';
process.env.SUPPRESS_PASSWORD_LOG    = '1';
process.env.DISABLE_LOGIN_RATE_LIMIT = 'true';
process.env.FX_PROVIDER              = 'static'; // testte dış döviz API'sine çıkma

const { test } = require('node:test');
const assert = require('node:assert');

const dbLayer = require('../db');
const users = require('../auth/users');
const lc = require('../agent/tools/lifecycle-tools');
const worm = require('../agent/tools/worm-backup');
const osAgent = require('../agent/tools/os-agent');
const finops = require('../agent/tools/finops-tools');
const { vlanOf } = require('../agent/tools/network-discovery');

// Her test için temiz durum: tabloları TRUNCATE (dosya-DB veri kalıcı, bağlantı reset veriyi silmez),
// cache'leri yeniden yükle, WORM'u boşalt.
async function resetAll() {
  await dbLayer.migrate(); // ilk çağrıda tabloları oluşturur, sonrasında no-op
  const k = dbLayer.db();
  await k('lifecycle_events').del();
  await k('os_agents').del();
  await k('users').del();
  worm._resetRepo();
  await users.init();
  await osAgent.init();
  await lc.init();
}

// ── Auth / scrypt ─────────────────────────────────────────────────────────────
test('auth: scrypt parola doğru/yanlış + authenticate + rol', async () => {
  await resetAll();
  assert.ok(users.authenticate('admin', 'admin123'), 'admin doğru parola geçmeli');
  assert.equal(users.authenticate('admin', 'yanlis'), null, 'yanlış parola reddedilmeli');
  assert.equal(users.authenticate('yokboyle', 'x'), null, 'olmayan kullanıcı null');
  const a = users.authenticate('ahmet.sahin', 'Ahmet.2024!');
  assert.equal(a.role, 'approver');
  assert.equal(a.password, undefined, 'publicUser parola sızdırmamalı');
  assert.ok(users.hasRole({ role: 'admin' }, 'it', 'admin'));
  assert.ok(!users.hasRole({ role: 'it' }, 'approver'));
});

test('auth: identityOf AD kimliği döndürür (UPN/IP/MFA)', async () => {
  await resetAll();
  const id = users.identityOf('dbadmin', { mfa_verified: false });
  assert.match(id.actor_upn, /@/);
  assert.equal(id.mfa_verified, false);
  assert.equal(id.actor_role, 'it');
});

// ── LDAP / Active Directory sağlayıcı (canlı AD olmadan sahte client ile) ──────
// Sahte dizin: servis-bind + kullanıcı arama + kullanıcı-DN re-bind (parola) modellenir.
function makeFakeLdap(dir) {
  return {
    createClient() {
      return {
        async bind(dn, pw) {
          if (dn === dir.serviceDN) { if (pw !== dir.servicePw) throw new Error('svc-bind reddedildi'); return; }
          const u = Object.values(dir.users).find(x => x.dn === dn);
          if (!u || u.password !== pw) throw new Error('geçersiz kimlik bilgileri');
        },
        async search(base, opts) {
          const m = /sAMAccountName=([^)]+)/i.exec(opts.filter);
          const u = m && dir.users[m[1].toLowerCase()];
          return { searchEntries: u ? [u.entry] : [] };
        },
        async unbind() {},
      };
    },
  };
}
function dnFor(cn) { return `CN=${cn},OU=Groups,DC=kurumsal,DC=local`; }
function ldapEnv(extra = {}) {
  const saved = {};
  const set = { AUTH_PROVIDER: 'ldap', LDAP_BIND_DN: 'CN=svc,DC=kurumsal,DC=local',
    LDAP_BIND_PASSWORD: 'svcpw', LDAP_BASE_DN: 'DC=kurumsal,DC=local', ...extra };
  for (const [k, v] of Object.entries(set)) { saved[k] = process.env[k]; process.env[k] = v; }
  return () => { for (const k of Object.keys(set)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

test('ldap: başarılı bind → rol grup üyeliğinden + users tablosuna upsert', async () => {
  await resetAll();
  const dir = { serviceDN: 'CN=svc,DC=kurumsal,DC=local', servicePw: 'svcpw', users: {
    'elif.aydin': { dn: 'CN=Elif Aydin,OU=BT,DC=kurumsal,DC=local', password: 'Parola123!', entry: {
      dn: 'CN=Elif Aydin,OU=BT,DC=kurumsal,DC=local', sAMAccountName: 'elif.aydin',
      displayName: 'Elif Aydın', userPrincipalName: 'elif.aydin@kurumsal.local',
      memberOf: [dnFor('BT Destek')] } },
  } };
  const restore = ldapEnv();
  try {
    const u = await users.authenticateAsync('elif.aydin', 'Parola123!', makeFakeLdap(dir));
    assert.ok(u, 'doğru parola ile giriş başarılı olmalı');
    assert.equal(u.role, 'it', 'BT Destek grubu → it rolü');
    assert.equal(u.display, 'Elif Aydın');
    assert.equal(u.password, undefined, 'publicUser parola sızdırmamalı');
    // Yerel tabloya upsert edildi mi — identityOf artık gerçek AD kimliğini bilmeli
    const id = users.identityOf('elif.aydin');
    assert.equal(id.actor_upn, 'elif.aydin@kurumsal.local');
    assert.deepEqual(users.findUser('elif.aydin').groups, ['BT Destek']);
  } finally { restore(); }
});

test('ldap: yanlış parola ve olmayan kullanıcı null döner', async () => {
  await resetAll();
  const dir = { serviceDN: 'CN=svc,DC=kurumsal,DC=local', servicePw: 'svcpw', users: {
    'elif.aydin': { dn: 'CN=Elif,DC=kurumsal,DC=local', password: 'dogru', entry: {
      dn: 'CN=Elif,DC=kurumsal,DC=local', sAMAccountName: 'elif.aydin', memberOf: [] } },
  } };
  const restore = ldapEnv();
  try {
    assert.equal(await users.authenticateAsync('elif.aydin', 'yanlis', makeFakeLdap(dir)), null, 'yanlış parola → null');
    assert.equal(await users.authenticateAsync('yokboyle', 'x', makeFakeLdap(dir)), null, 'olmayan kullanıcı → null');
  } finally { restore(); }
});

test('ldap: grup önceliği (admin>it) + MFA grubu üyeliği', async () => {
  await resetAll();
  const dir = { serviceDN: 'CN=svc,DC=kurumsal,DC=local', servicePw: 'svcpw', users: {
    'yonetici': { dn: 'CN=Yonetici,DC=kurumsal,DC=local', password: 'pw', entry: {
      dn: 'CN=Yonetici,DC=kurumsal,DC=local', sAMAccountName: 'yonetici', displayName: 'Yönetici',
      memberOf: [dnFor('BT Destek'), dnFor('Domain Admins'), dnFor('MFA-Enforced')] } },
    'mfasiz': { dn: 'CN=Mfasiz,DC=kurumsal,DC=local', password: 'pw', entry: {
      dn: 'CN=Mfasiz,DC=kurumsal,DC=local', sAMAccountName: 'mfasiz', displayName: 'Mfasız',
      memberOf: [dnFor('BT Destek')] } },
  } };
  const restore = ldapEnv({ LDAP_MFA_GROUP: 'MFA-Enforced' });
  try {
    const a = await users.authenticateAsync('yonetici', 'pw', makeFakeLdap(dir));
    assert.equal(a.role, 'admin', 'Domain Admins (admin) BT Destek (it) önüne geçmeli');
    assert.equal(users.findUser('yonetici').mfa_enabled, true, 'MFA grubunda → mfa_enabled true');
    const b = await users.authenticateAsync('mfasiz', 'pw', makeFakeLdap(dir));
    assert.equal(b.role, 'it');
    assert.equal(users.findUser('mfasiz').mfa_enabled, false, 'MFA grubunda değil → mfa_enabled false');
  } finally { restore(); }
});

// ── HMAC hash zinciri + tamper ─────────────────────────────────────────────────
test('zincir: recordEvent ekler, verifyChain geçerli', async () => {
  await resetAll();
  await lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Satın Alındı', actor: 'admin' });
  await lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Aktif - Zimmetlendi', actor: 'admin' });
  const v = lc.verifyChain();
  assert.equal(v.valid, true);
  assert.equal(v.total, 2);
});

test('zincir: içerik değiştirilirse verifyChain BOZULDU der', async () => {
  await resetAll();
  await lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Satın Alındı', actor: 'admin' });
  await lc.recordEvent({ hostname: 'PC1', asset_id: 1, to_status: 'Bakımda', actor: 'admin' });
  // DB tarafında elle değiştir
  await dbLayer.db()('lifecycle_events').where('seq', 1).update({ note: 'ELLE DEĞİŞTİRİLDİ' });
  await lc.init(); // cache'i tazele
  const v = lc.verifyChain();
  assert.equal(v.valid, false);
  assert.equal(v.broken_at, 1);
});

// ── Dijital imza (HMAC) + forgery ──────────────────────────────────────────────
test('imza: onaylanan kayıt imzalı; approver kurcalanırsa zincir bozulur', async () => {
  await resetAll();
  const s = await lc.submitChange({ hostname: 'SRV1', asset_id: 2, to_status: 'Depoya Kaldırıldı', actor: 'admin', approver: 'Ahmet Şahin (BT Müdürü)' });
  assert.equal(s.kind, 'pending');
  const r = await lc.approveByToken(s.approval_token, { actor: 'ahmet.sahin', approver: 'Ahmet Şahin (BT Müdürü)' });
  assert.equal(r.event.signed, true);
  assert.ok(r.event.signature);
  // İmzalı satırın approver'ını DB'de değiştir
  await dbLayer.db()('lifecycle_events').where('signed', 1).first().then(row =>
    dbLayer.db()('lifecycle_events').where('seq', row.seq).update({ approver: 'Sahte Kişi' })
  );
  await lc.init();
  assert.equal(lc.verifyChain().valid, false);
});

// ── Onay akışı (dual-auth) ─────────────────────────────────────────────────────
test('onay akışı: non-kritik=applied, kritik+onaysız=breach, kritik+onaylı=pending', async () => {
  await resetAll();
  assert.equal((await lc.submitChange({ hostname: 'PC2', asset_id: 3, to_status: 'Bakımda', actor: 'admin' })).kind, 'applied');
  const breach = await lc.submitChange({ hostname: 'PC3', asset_id: 4, to_status: 'Kayıp', actor: 'dbadmin' });
  assert.equal(breach.kind, 'breach');
  assert.equal(breach.event.security_flag, 'imzasiz_kritik');
  assert.equal((await lc.submitChange({ hostname: 'PC4', asset_id: 5, to_status: 'Zimmet Değişikliği', actor: 'admin', approver: 'Murat Demir (Departman Yöneticisi)' })).kind, 'pending');
});

test('onay akışı: self-approval reddedilir', async () => {
  await resetAll();
  const s = await lc.submitChange({ hostname: 'PC5', asset_id: 6, to_status: 'Depoya Kaldırıldı', actor: 'mehmet.yilmaz', approver: 'Ahmet Şahin (BT Müdürü)' });
  await assert.rejects(
    lc.approveByToken(s.approval_token, { actor: 'mehmet.yilmaz', approver: 'Mehmet Yılmaz' }),
    /Kendi oluşturduğunuz/
  );
});

test('onay akışı: TTL aşımı expired+ihlal; renew yeni pending', async () => {
  await resetAll();
  // Süresi geçmiş pending elle ekle (recordEvent doğrudan çağrılıyor)
  await lc.recordEvent({
    hostname: 'PC6', asset_id: 7, to_status: 'Hurdaya Ayrıldı', actor: 'admin',
    approver: 'Murat Demir (Departman Yöneticisi)', approval_status: 'pending',
    approval_id: 'A1', approval_token: 'tok1',
    approval_expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const expired = await lc.expirePendingRequests();
  assert.equal(expired.length, 1);
  assert.equal(expired[0].security_flag, 'onay_zaman_asimi');
  const rn = await lc.renewRequest({ approval_id: 'A1', actor: 'admin' });
  assert.ok(rn.approval_token && rn.approval_id !== 'A1');
});

// ── sameDevice (asset_id stabil join) ──────────────────────────────────────────
test('sameDevice: asset_id rename dayanıklı + yanlış eşleşme yok', async () => {
  await resetAll();
  await lc.recordEvent({
    hostname: 'ESKI-AD', asset_id: 42, serial_number: 'SN42',
    to_status: 'Depoya Kaldırıldı', actor: 'admin',
    approver: 'Ahmet Şahin (BT Müdürü)', approval_status: 'approved', approval_id: 'X',
  });
  const hit = lc.getCurrentStatusForAsset({ id: 42, hostname: 'YENI-AD', serial_number: 'BASKA' });
  assert.equal(hit.status, 'Depoya Kaldırıldı');
  const miss = lc.getCurrentStatusForAsset({ id: 999, hostname: 'ESKI-AD', serial_number: 'SN42' });
  assert.equal(miss, null);
});

// ── WORM yedek ─────────────────────────────────────────────────────────────────
test('WORM: her kayıt yedeklenir, yerel silinince geri yüklenir', async () => {
  await resetAll();
  for (let i = 0; i < 5; i++) await lc.recordEvent({ hostname: 'W' + i, asset_id: 100 + i, to_status: 'Satın Alındı', actor: 'admin' });
  let st = lc.auditBackupStatus();
  assert.equal(st.in_sync, true);
  assert.equal(st.backup_count, 5);
  // Yerel DB'yi boşalt (art niyetli silme simülasyonu)
  await dbLayer.db()('lifecycle_events').del();
  await lc.init();
  st = lc.auditBackupStatus();
  assert.equal(st.recovery_needed, true, 'yerel boş, yedek 5 → kurtarma gerekli');
  const rec = await lc.restoreAuditFromBackup();
  assert.equal(rec.restored, 5);
  assert.equal(lc.verifyChain().valid, true);
});

test('WORM: AES şifreleme roundtrip + atomik write-once', async () => {
  await resetAll();
  await lc.recordEvent({ hostname: 'ENC', asset_id: 200, to_status: 'Satın Alındı', actor: 'admin' });
  const evs = worm.readBackupEvents();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].hostname, 'ENC');
});

// ── OS Agent handshake (spoofing kalkanı) ──────────────────────────────────────
test('os-agent: doğru token doğrular, yanlış token SPOOFING, enrollment yoksa managed=false', async () => {
  await resetAll();
  const enrolled = osAgent.loadAgents()[0];
  const goodToken = osAgent.genTokenForAsset(enrolled.asset_id);
  const okRes = osAgent.verifyOsAgent({ id: enrolled.asset_id }, goodToken);
  assert.equal(okRes.managed, true);
  assert.equal(okRes.verified, true);
  const spoof = osAgent.verifyOsAgent({ id: enrolled.asset_id }, 'BOGUS-TOKEN');
  assert.equal(spoof.verified, false);
  assert.equal(spoof.reason, 'token_uyusmuyor');
  const unmanaged = osAgent.verifyOsAgent({ id: 999999 }, 'x');
  assert.equal(unmanaged.managed, false);
});

// ── VLAN segmentasyonu ─────────────────────────────────────────────────────────
test('vlanOf: IP/subnet → VLAN segment', () => {
  assert.equal(vlanOf('10.0.1.10'), 10);
  assert.equal(vlanOf('10.0.2.41'), 20);
  assert.equal(vlanOf('192.168.50.10'), 50);
  assert.equal(vlanOf('172.16.0.1'), 0);
});

// ── Setup wizard: sır üretimi + kalıcılık ──────────────────────────────────────
test('setup: env boşsa güçlü sırlar üretir, tekrar okur (kalıcılık)', () => {
  const tmpSecretsFile = path.join(TMP, 'secrets-test.json');
  try { fs.unlinkSync(tmpSecretsFile); } catch {}
  const originals = { s: process.env.SESSION_SECRET, c: process.env.CHAIN_SECRET, w: process.env.WORM_SECRET };
  delete process.env.SESSION_SECRET; delete process.env.CHAIN_SECRET; delete process.env.WORM_SECRET;
  process.env.SECRETS_FILE = tmpSecretsFile;
  delete require.cache[require.resolve('../auth/setup')];
  require('../auth/setup').bootstrapSecrets();
  const s1 = process.env.SESSION_SECRET, c1 = process.env.CHAIN_SECRET, w1 = process.env.WORM_SECRET;
  assert.ok(s1 && s1.length >= 32);
  assert.notEqual(s1, c1);
  assert.ok(fs.existsSync(tmpSecretsFile));
  delete process.env.SESSION_SECRET; delete process.env.CHAIN_SECRET; delete process.env.WORM_SECRET;
  delete require.cache[require.resolve('../auth/setup')];
  require('../auth/setup').bootstrapSecrets();
  assert.equal(process.env.SESSION_SECRET, s1);
  process.env.SESSION_SECRET = originals.s; process.env.CHAIN_SECRET = originals.c; process.env.WORM_SECRET = originals.w;
});

// ── FinOps döviz dönüşümü ──────────────────────────────────────────────────────
test('finops: kur döner, USD→TRY dönüşümü kurla ölçeklenir', async () => {
  const fx = await finops.getFxRates();
  assert.ok(fx.USD_TRY > 0 && fx.EUR_TRY > 0);
  assert.ok(typeof fx.source === 'string' && fx.source.length > 0);
  const pc = finops.costFor('Bilgisayar', fx);
  assert.ok(pc.usd > 0);
  assert.ok(Math.abs(pc.try - pc.usd * fx.USD_TRY) < 1);
  const hi = finops.costFor('Bilgisayar', { USD_TRY: 50, EUR_TRY: 54 });
  const lo = finops.costFor('Bilgisayar', { USD_TRY: 30, EUR_TRY: 33 });
  assert.ok(hi.try > lo.try);
});

// ── Turkcell Hat / SIM ──────────────────────────────────────────────────────────
const lineTools = require('../agent/tools/line-tools');
test('hat: oluştur→ata→başka telefona taşı→geçmiz + MSISDN normalize', async () => {
  await resetAll();
  const k = dbLayer.db();
  await k('line_assignments').del();
  await k('phone_lines').del();

  // MSISDN normalize: 05xx → +905xx
  assert.equal(lineTools.normMsisdn('05321234567'), '+905321234567');
  assert.equal(lineTools.normMsisdn('5321234567'), '+905321234567');
  assert.equal(lineTools.normIccid('8990-0111 2223'), '899001112223');

  const { line, action } = await lineTools.upsertLine({ iccid: '8990011199988877766', msisdn: '05321234567', tariff: 'Kurumsal' });
  assert.equal(action, 'created');
  assert.equal(line.msisdn, '+905321234567');
  assert.equal(line.assigned_asset_id, null);

  await lineTools.assignLine(line.id, { asset_id: 10, hostname: 'IPHONE-ALPER' });
  let cur = await lineTools.getLine(line.id);
  assert.equal(cur.assigned_asset_id, 10);

  // Başka telefona taşı
  await lineTools.assignLine(line.id, { asset_id: 11, hostname: 'SAMSUNG-YENI' });
  cur = await lineTools.getLine(line.id);
  assert.equal(cur.assigned_hostname, 'SAMSUNG-YENI');

  // Geçmiş: olusturuldu + 2 atama = 3 kayıt
  const hist = await lineTools.getLineHistory(line.id);
  assert.equal(hist.length, 3);
  assert.equal(hist[0].action, 'atandi'); // en yeni (desc)

  // İade
  await lineTools.releaseLine(line.id);
  cur = await lineTools.getLine(line.id);
  assert.equal(cur.assigned_asset_id, null);

  // Aynı ICCID upsert → updated (yeni kayıt değil)
  const again = await lineTools.upsertLine({ iccid: '8990011199988877766', msisdn: '05329998877' });
  assert.equal(again.action, 'updated');
  const all = await lineTools.listLines();
  assert.equal(all.length, 1);
});

// ── Resmi Zimmet devir koruması ──────────────────────────────────────────────
const assignmentTools = require('../agent/tools/assignment-tools');
test('zimmet: zaten zimmetli cihaz force olmadan devralınamaz; telemetri uyuşmazlığı yakalanır', async () => {
  await resetAll();
  await dbLayer.db()('asset_assignments').del().catch(() => {});

  // İlk zimmet
  await assignmentTools.assign(6, { to: 'alper', hostname: 'ALPER-PC', by: 'admin' });
  assert.equal((await assignmentTools.getAssignment(6)).assigned_to, 'alper');

  // Başka kullanıcı force olmadan → REDDEDİLİR (ALREADY_ASSIGNED)
  await assert.rejects(
    () => assignmentTools.assign(6, { to: 'baskasi', hostname: 'ALPER-PC', by: 'it' }),
    (e) => e.code === 'ALREADY_ASSIGNED' && e.current === 'alper'
  );
  // Aynı kişiye tekrar → sorunsuz (idempotent)
  await assignmentTools.assign(6, { to: 'alper', hostname: 'ALPER-PC' });
  // force ile devir → geçer
  await assignmentTools.assign(6, { to: 'baskasi', hostname: 'ALPER-PC', force: true, by: 'admin' });
  assert.equal((await assignmentTools.getAssignment(6)).assigned_to, 'baskasi');

  // Telemetri uyuşmazlığı: resmi 'baskasi' iken 'alper' görülürse sinyal
  const mm = await assignmentTools.checkMismatch(6, 'alper');
  assert.ok(mm && mm.assigned_to === 'baskasi' && mm.seen_user === 'alper');
  assert.equal(await assignmentTools.checkMismatch(6, 'baskasi'), null); // eşleşiyorsa sinyal yok

  // İade sonrası zimmetsiz
  await assignmentTools.release(6, { by: 'admin' });
  assert.equal((await assignmentTools.getAssignment(6)).assigned_to, null);
});

// ── Settings runtime config store ────────────────────────────────────────────
const settingsTools = require('../agent/tools/settings-tools');
test('settings: init olmadan DEFAULTS; setSection kalıcı + tip doğrulama', async () => {
  await resetAll();
  await dbLayer.db()('settings').del().catch(() => {});
  // init edilmese bile güvenli defaults döner
  assert.equal(settingsTools.getThresholds().low_ram_gb, 8);
  await settingsTools.init();
  const merged = await settingsTools.setSection('thresholds', { low_ram_gb: 16, low_disk_gb: '512' }, 'admin');
  assert.equal(merged.low_ram_gb, 16);
  assert.equal(merged.low_disk_gb, 512); // string → number
  assert.equal(settingsTools.getThresholds().low_ram_gb, 16); // cache güncellendi
  // negatif reddedilir
  await assert.rejects(() => settingsTools.setSection('thresholds', { low_ram_gb: -5 }, 'admin'));
  // bilinmeyen bölüm reddedilir
  await assert.rejects(() => settingsTools.setSection('yokboyle', {}, 'admin'));
  // yeniden init sonrası DB'den okunur (kalıcılık)
  await settingsTools.init();
  assert.equal(settingsTools.getThresholds().low_ram_gb, 16);
});

// ── DB driver seçim ────────────────────────────────────────────────────────────
test('db: DATABASE_URL sqlite:./x.db → sqlite driver', () => {
  assert.equal(dbLayer.driver(), 'sqlite');
});
