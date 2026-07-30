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

// ── Kullanıcı yönetimi (admin CRUD + son-admin koruması) ─────────────────────
test('kullanıcı yönetimi: oluştur/güncelle/sil + son admin korumasi + dogrulamalar', async () => {
  await resetAll();

  // Oluştur
  const u = await users.createUser({ username: 'Yeni.Kullanici', password: 'GucluParola1', role: 'it', display: 'Yeni Kullanıcı' });
  assert.equal(u.username, 'yeni.kullanici', 'kullanıcı adı küçük harfe normalize edilir');
  assert.equal(u.role, 'it');
  assert.equal(u.password, undefined, 'publicUser parola sızdırmaz');
  assert.ok(users.authenticate('yeni.kullanici', 'GucluParola1'), 'yeni hesapla giriş yapılabilir');

  // Doğrulamalar
  await assert.rejects(() => users.createUser({ username: 'yeni.kullanici', password: 'GucluParola1' }), /zaten var/);
  await assert.rejects(() => users.createUser({ username: 'ab', password: 'GucluParola1' }), /3-64/);
  await assert.rejects(() => users.createUser({ username: 'test.kisi', password: 'kisa' }), /en az 8/);
  await assert.rejects(() => users.createUser({ username: 'test.kisi', password: 'GucluParola1', role: 'kral' }), /Geçersiz rol/);

  // Güncelle: rol + parola
  await users.updateUser('yeni.kullanici', { role: 'approver', password: 'YeniParola123' });
  assert.equal(users.findUser('yeni.kullanici').role, 'approver');
  assert.ok(users.authenticate('yeni.kullanici', 'YeniParola123'), 'yeni parola geçerli');
  assert.equal(users.authenticate('yeni.kullanici', 'GucluParola1'), null, 'eski parola geçersiz');

  // Sil
  await users.deleteUser('yeni.kullanici');
  assert.equal(users.findUser('yeni.kullanici'), null);

  // SON ADMIN KORUMASI: tek admin kalınca ne silinir ne rolü düşürülür
  const admins = users.all().filter(x => x.role === 'admin').map(x => x.username);
  for (const a of admins.slice(1)) await users.deleteUser(a);      // biri hariç hepsini sil
  const last = users.all().filter(x => x.role === 'admin');
  assert.equal(last.length, 1, 'tek admin kaldı');
  await assert.rejects(() => users.deleteUser(last[0].username), /Son admin/);
  await assert.rejects(() => users.updateUser(last[0].username, { role: 'it' }), /Son admin/);
});

// ── LDAP(S) TLS seçenekleri ───────────────────────────────────────────────────
test('ldap: buildTlsOptions env okumasi (public CA bos, ic CA icin ca/reject/servername)', () => {
  const ldap = require('../auth/ldap');
  const saved = { ...process.env };
  try {
    delete process.env.LDAP_TLS_CA; delete process.env.LDAP_TLS_REJECT_UNAUTHORIZED; delete process.env.LDAP_TLS_SERVERNAME;
    assert.deepEqual(ldap.buildTlsOptions(), {}, 'ayar yoksa boş (public CA otomatik güvenir)');
    process.env.LDAP_TLS_REJECT_UNAUTHORIZED = 'false';
    process.env.LDAP_TLS_SERVERNAME = 'dc.zenauraprint.local';
    const t = ldap.buildTlsOptions();
    assert.equal(t.rejectUnauthorized, false);
    assert.equal(t.servername, 'dc.zenauraprint.local');
  } finally {
    for (const k of ['LDAP_TLS_CA', 'LDAP_TLS_REJECT_UNAUTHORIZED', 'LDAP_TLS_SERVERNAME']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// ── Envanter SQL sağlayıcı (Baserow'dan bağımsız) ────────────────────────────
const invSql = require('../agent/tools/inventory-sql');
const licSql = require('../agent/tools/licenses-sql');
test('envanter-sql: create→getBySerial→update→getAllAssets filtre→getStats', async () => {
  await resetAll();
  await dbLayer.db()('assets').del();
  await dbLayer.db()('licenses').del();

  const a = await invSql.createAsset({ hostname: 'PC-1', serial_number: 'SN-1', brand: 'Dell', category: 'Bilgisayar', ram_gb: 8, storage_gb: 256, cpu_cores: '4.1', os: 'Windows 11', status: 'online', ignore_me: 'x' });
  assert.ok(a.id, 'insert id döner');
  assert.equal(a.brand, 'Dell');
  assert.equal(Number(a.cpu_cores), 4, 'ondalık integer alan yuvarlanır (PG katılığı — 4.1→4)');
  assert.equal(a.ignore_me, undefined, 'bilinmeyen alan atılır');

  const bySerial = await invSql.getAssetBySerial({ serialNumber: 'SN-1' });
  assert.equal(bySerial.hostname, 'PC-1');

  await invSql.updateAsset(a.id, { status: 'offline', username: 'alper' });
  assert.equal((await invSql.getAssetBySerial({ serialNumber: 'SN-1' })).status, 'offline');

  await invSql.createAsset({ hostname: 'SRV-1', serial_number: 'SN-2', brand: 'HPE', category: 'Sunucu', ram_gb: 64, status: 'online' });
  const all = await invSql.getAllAssets({ size: 200 });
  assert.equal(all.count, 2);
  const filtered = await invSql.getAllAssets({ size: 200, filterField: 'category', filterValue: 'Sunucu' });
  assert.equal(filtered.count, 1);

  const stats = await invSql.getStats();
  assert.equal(stats.total, 2);
  assert.equal(stats.by_category['Bilgisayar'], 1);
  assert.equal(stats.by_category['Sunucu'], 1);
  assert.equal(stats.avg_ram_gb, 36); // (8+64)/2

  await licSql.createLicense({ hostname: 'PC-1', software_name: 'Office', license_status: 'Unlicensed', license_type: 'ESD' });
  const ls = await licSql.getLicenseStats();
  assert.equal(ls.total, 1);
  assert.equal(ls.unlicensed, 1);
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

// ── Lokasyon izleme ───────────────────────────────────────────────────────────
const locTools = require('../agent/tools/location-tools');

test('lokasyon: token doğrulaması — token otoriter, sahte lokasyon reddedilir', () => {
  const saved = process.env.LOCATION_TOKENS;

  // Token yapılandırılmamış → geriye dönük uyumluluk (payload'a güvenilir ama işaretlenir)
  delete process.env.LOCATION_TOKENS; locTools._resetTokens();
  let r = locTools.resolveLocation({ token: null, payloadLocation: 'İstanbul Merkez' });
  assert.equal(r.location, 'İstanbul Merkez');
  assert.equal(r.source, 'unverified');

  // Token yapılandırılmış
  process.env.LOCATION_TOKENS = JSON.stringify({ 'loc-abc': 'İstanbul Merkez', 'loc-xyz': 'Kocaeli Depo' });
  locTools._resetTokens();

  // token'sız lokasyon bildirimi REDDEDİLİR
  r = locTools.resolveLocation({ token: null, payloadLocation: 'Ankara' });
  assert.equal(r.code, 'LOCATION_TOKEN_REQUIRED');

  // geçersiz token REDDEDİLİR
  r = locTools.resolveLocation({ token: 'uydurma', payloadLocation: 'Ankara' });
  assert.equal(r.code, 'LOCATION_TOKEN_INVALID');

  // geçerli token: payload'daki SAHTE lokasyon yok sayılır, token'ın adı kullanılır
  r = locTools.resolveLocation({ token: 'loc-xyz', payloadLocation: 'Ankara Şube (sahte)' });
  assert.equal(r.location, 'Kocaeli Depo');
  assert.equal(r.source, 'location-agent');

  // lokasyon içermeyen telemetri token'sız da geçer (collector bozulmaz)
  r = locTools.resolveLocation({ token: null, payloadLocation: '' });
  assert.equal(r.location, null);
  assert.ok(!r.error);

  if (saved === undefined) delete process.env.LOCATION_TOKENS; else process.env.LOCATION_TOKENS = saved;
  locTools._resetTokens();
});

test('lokasyon: konaklama kaydı + sapma eşiği (kısa sapma sessiz, uzun sapma uyarır)', async () => {
  await resetAll();
  await settingsTools.init();
  const A = { id: 9001, hostname: 'LOC-PC', serial_number: 'LOC-S1', location: 'Kocaeli Depo' };

  // aynı yerde tekrar görülme → yeni konaklama AÇMAZ
  let s = await locTools.recordSeen(A.id, { location: 'İstanbul Merkez', source: 'location-agent' });
  assert.equal(s.changed, false); // ilk kayıt: önce yok, transfer sayılmaz
  s = await locTools.recordSeen(A.id, { location: 'İstanbul Merkez', source: 'location-agent' });
  assert.equal(s.changed, false);
  assert.equal((await locTools.getHistory(A.id)).length, 1);

  // yer değişti → yeni konaklama + changed
  s = await locTools.recordSeen(A.id, { location: 'Kocaeli Depo', source: 'location-agent' });
  assert.equal(s.changed, true);
  assert.equal(s.from, 'İstanbul Merkez');
  assert.equal((await locTools.getHistory(A.id)).length, 2);
  assert.equal((await locTools.getCurrentStay(A.id)).to_location, 'Kocaeli Depo');

  // beklenen lokasyon yokken sapma üretilmez
  let d = await locTools.detectLocationDrift([A]);
  assert.equal(d.count, 0);
  assert.equal(d.unassigned, 1);

  // beklenen = İstanbul, görülen = Kocaeli ama daha bugün taşındı → eşik altında SESSİZ
  await locTools.setExpected(A.id, { location: 'İstanbul Merkez', by: 'admin' });
  d = await locTools.detectLocationDrift([A]);
  assert.equal(d.count, 0, 'kısa süreli sapma gürültü yapmamalı');

  // konaklamayı 10 gün geriye al → eşiği (7) aşar, uyarı çıkar
  const past = new Date(Date.now() - 10 * 86400000).toISOString();
  const cur = await locTools.getCurrentStay(A.id);
  await dbLayer.db()('asset_location_history').where({ id: cur.id }).update({ first_seen_at: past });
  d = await locTools.detectLocationDrift([A]);
  assert.equal(d.count, 1);
  assert.equal(d.drifted[0].expected_location, 'İstanbul Merkez');
  assert.equal(d.drifted[0].seen_location, 'Kocaeli Depo');
  assert.ok(d.drifted[0].days >= 9);

  // eşik UI'dan büyütülünce uyarı susar (restart gerekmez)
  await settingsTools.setSection('thresholds', { location_drift_days: 30 }, 'admin');
  d = await locTools.detectLocationDrift([A]);
  assert.equal(d.count, 0);
  await settingsTools.setSection('thresholds', { location_drift_days: 7 }, 'admin');
});

// ── SNMP ağ keşfi (saf fonksiyonlar — ağ gerekmez) ────────────────────────────
const snmpd = require('../agent/tools/snmp-discovery');
test('snmp: CIDR genişletme + marka/kategori çıkarımı + parseDevice', () => {
  // /24 → 254 host (.1-.254), ağ/broadcast hariç
  const ips = snmpd.expandCidr('172.16.20.0/24');
  assert.equal(ips.length, 254);
  assert.equal(ips[0], '172.16.20.1');
  assert.equal(ips[253], '172.16.20.254');
  assert.equal(snmpd.expandCidr('10.0.0.0/30').length, 2); // /30 → 2 host

  // Marka: enterprise OID önce, sonra sysDescr anahtar kelimeleri
  assert.equal(snmpd.brandFrom('Linux', '1.3.6.1.4.1.12356.101'), 'Fortinet'); // OID
  assert.equal(snmpd.brandFrom('Sophos XG Firewall', ''), 'Sophos');
  assert.equal(snmpd.brandFrom('HP ProCurve Switch 2530', ''), 'HP');

  // Kategori
  assert.equal(snmpd.categoryFrom('HP LaserJet MFP'), 'Yazıcı');
  assert.equal(snmpd.categoryFrom('Sophos XG Firewall'), 'Ağ Aygıtı');
  assert.equal(snmpd.categoryFrom('Cisco Catalyst Switch'), 'Ağ Aygıtı');

  // parseDevice: SNMP varbind sonuçlarını asset'e çevirir
  const O = snmpd.OID;
  const dev = snmpd.parseDevice('172.16.20.5', {
    [O.sysDescr]: 'Sophos XG 210 Firewall', [O.sysName]: 'FW-HQ',
    [O.sysUpTime]: 8640000 * 3, [O.sysObjectID]: '1.3.6.1.4.1.2604.5', [O.sysLocation]: 'Merkez',
  }, 'S3100ABC', 'XG 210');
  assert.equal(dev.hostname, 'FW-HQ');
  assert.equal(dev.serial_number, 'S3100ABC');
  assert.equal(dev.brand, 'Sophos');
  assert.equal(dev.category, 'Ağ Aygıtı');
  assert.equal(dev.ip_address, '172.16.20.5');
  assert.equal(dev.uptime_days, 3); // 25920000 tick /100/86400 = 3 gün
  // serial yoksa SNMP-<ip> fallback
  assert.equal(snmpd.parseDevice('10.0.0.9', { [O.sysDescr]: 'x' }, null, null).serial_number, 'SNMP-10.0.0.9');
});

// ── DB driver seçim ────────────────────────────────────────────────────────────
test('db: DATABASE_URL sqlite:./x.db → sqlite driver', () => {
  assert.equal(dbLayer.driver(), 'sqlite');
});

// ── Login brute-force koruması ─────────────────────────────────────────────────
test('login rate limit: yalnız başarısız denemeler sayılır, başarı sıfırlar', () => {
  const { createLoginRateLimit } = require('../auth/login-rate-limit');
  let simdi = 1_000_000;
  const g = createLoginRateLimit({ windowMs: 900_000, max: 10, now: () => simdi });
  const ip = '10.0.0.7';

  // 1) Başarılı girişler HİÇ saymaz — tek NAT IP'si arkasındaki ofis kilitlenmemeli
  for (let i = 0; i < 50; i++) { g.succeed(ip); assert.equal(g.blockedFor(ip), 0); }

  // 2) 10 başarısız deneme → kilit (brute-force koruması duruyor)
  for (let i = 0; i < 9; i++) g.fail(ip);
  assert.equal(g.blockedFor(ip), 0, '9 denemede kilit olmamalı');
  g.fail(ip);
  assert.ok(g.blockedFor(ip) > 0, '10. denemede kilitlenmeli');

  // 3) Farklı IP etkilenmez
  assert.equal(g.blockedFor('10.0.0.8'), 0);

  // 4) Pencere dolunca kilit kalkar
  simdi += 900_001;
  assert.equal(g.blockedFor(ip), 0, 'pencere sonunda serbest kalmalı');

  // 5) Kilitlenmeden önceki başarı sayacı sıfırlar
  for (let i = 0; i < 9; i++) g.fail(ip);
  g.succeed(ip);
  for (let i = 0; i < 9; i++) g.fail(ip);
  assert.equal(g.blockedFor(ip), 0, 'başarılı giriş sayacı sıfırlamalı');

  // 6) x-forwarded-for önceliklidir (Traefik arkasında gerçek istemci IP'si)
  assert.equal(g.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } }), '1.2.3.4');
  assert.equal(g.clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
});

// ── Telemetri + güvenlik durumu ───────────────────────────────────────────────
test('telemetri: boş ölçüm satır açmaz, değerler sınırlanır, seri örneklenir', async () => {
  const tele = require('../agent/tools/telemetry-tools');
  const { db } = require('../db');
  const AID = 990001;
  await db()('asset_telemetry').where({ asset_id: AID }).del();
  await db()('asset_security').where({ asset_id: AID }).del();

  // 1) Hiçbir ölçüm alanı yoksa satır AÇILMAZ — "ölçüm alındı" yalanı olurdu
  assert.equal(await tele.recordTelemetry(AID, {}), null);
  assert.equal(await tele.recordTelemetry(AID, { cpu_pct: null, temp_c: null }), null);
  assert.equal(await tele.getLatest(AID), null);

  // 2) Aralık dışı yüzde sınırlanır; okunamayan alan NULL kalır (0 DEĞİL)
  await tele.recordTelemetry(AID, { cpu_pct: 150, battery_pct: -5, ram_used_gb: 6.4 });
  const son = await tele.getLatest(AID);
  assert.equal(Number(son.cpu_pct), 100);
  assert.equal(Number(son.battery_pct), 0);
  assert.equal(son.temp_c, null, 'gönderilmeyen sensör NULL kalmalı, 0 olmamalı');

  // 3) Seri örnekleme: 100 ölçüm → istenen nokta sayısı, SON değer korunur
  for (let i = 0; i < 100; i++) await tele.recordTelemetry(AID, { cpu_pct: i });
  const seri = await tele.getSeries(AID, { saat: 24, nokta: 20 });
  assert.equal(seri.length, 20);
  assert.equal(Number(seri[seri.length - 1].cpu_pct), 99, 'en güncel ölçüm korunmalı');

  // 4) Güvenlik: boolean/metin normalize edilir, bitlocker → disk_encryption
  assert.equal(await tele.recordSecurity(AID, {}), null, 'boş güvenlik kaydı açılmaz');
  await tele.recordSecurity(AID, { firewall: true, bitlocker: 'On', defender: 'disabled' });
  const g = await tele.getSecurity(AID);
  assert.equal(g.firewall, 'aktif');
  assert.equal(g.disk_encryption, 'aktif');
  assert.equal(g.defender, 'pasif');
  assert.equal(g.antivirus, null, 'gönderilmeyen alan bilinmiyor kalmalı (pasif DEĞİL)');

  await db()('asset_telemetry').where({ asset_id: AID }).del();
  await db()('asset_security').where({ asset_id: AID }).del();
});

// ── Collector kimlik doğrulaması (imzalı istek + cihaz kaydı) ─────────────────
test('agent-auth: imza doğrulama, replay koruması ve cihaz kaydı', async () => {
  const crypto = require('crypto');
  const auth = require('../agent/tools/agent-auth');
  const { db } = require('../db');

  process.env.AGENT_SECRET = 'test-paylasilan-anahtar-en-az-32-karakter-olmali';
  process.env.WEBHOOK_AUTH = 'required';
  const PAYLASILAN = process.env.AGENT_SECRET;
  const CIHAZ = 'TEST-CIHAZ-' + crypto.randomBytes(4).toString('hex');
  await db()('agent_enrollments').where({ device_id: CIHAZ }).del();

  // Express req taklidi — imza ham gövdeyi kapsıyor
  const istek = ({ secret, deviceId = CIHAZ, ts = Date.now(), nonce, govde = '{"a":1}', bozGovde = null }) => {
    const n = nonce || crypto.randomBytes(6).toString('hex');
    const parcalar = { timestamp: String(ts), nonce: n, method: 'POST', path: '/api/webhook',
      bodyHash: auth.govdeOzeti(Buffer.from(govde, 'utf8')) };
    const h = {
      'x-assetman-device': deviceId, 'x-assetman-timestamp': String(ts),
      'x-assetman-nonce': n, 'x-assetman-signature': secret ? auth.imzala(secret, parcalar) : '',
    };
    return { method: 'POST', path: '/api/webhook', rawBody: Buffer.from(bozGovde ?? govde, 'utf8'),
      get: (k) => h[k.toLowerCase()] || '' };
  };

  // 1) İmzasız istek reddedilir (required modunda)
  const imzasiz = await auth.verifyRequest({ method: 'POST', path: '/api/webhook', rawBody: Buffer.from('{}'), get: () => '' });
  assert.equal(imzasiz.ok, false);
  assert.equal(imzasiz.code, 'IMZA_YOK');

  // 2) Yanlış anahtar reddedilir
  assert.equal((await auth.verifyRequest(istek({ secret: 'baska-anahtar' }))).ok, false);

  // 3) Pencere dışı zaman damgası reddedilir (replay)
  const eski = await auth.verifyRequest(istek({ secret: PAYLASILAN, ts: Date.now() - 10 * 60 * 1000 }));
  assert.equal(eski.code, 'ZAMAN_PENCERESI');

  // 4) İmza gövdeyi kapsar — gövde sonradan değiştirilemez
  const bozuk = await auth.verifyRequest(istek({ secret: PAYLASILAN, govde: '{"a":1}', bozGovde: '{"a":2}' }));
  assert.equal(bozuk.ok, false, 'gövde değiştirilmişse imza tutmamalı');

  // 5) Geçerli imza → cihaz KAYDOLUR ve kendine özel sır alır
  const kayit = await auth.verifyRequest(istek({ secret: PAYLASILAN }));
  assert.equal(kayit.ok, true);
  assert.equal(kayit.yeniKayit, true);
  const cihazSirri = kayit.enrollment.secret;
  assert.ok(cihazSirri && cihazSirri !== PAYLASILAN);

  // 6) Kayıt sonrası cihaz sırrı geçerli
  assert.equal((await auth.verifyRequest(istek({ secret: cihazSirri }))).ok, true);

  // 7) KRİTİK: kayıtlı cihaz için paylaşılan anahtar ARTIK kabul edilmez.
  //    Anahtarı okuyan yerel yönetici başka cihazı taklit edemesin diye.
  const paylasilanSonra = await auth.verifyRequest(istek({ secret: PAYLASILAN }));
  assert.equal(paylasilanSonra.ok, false);
  assert.equal(paylasilanSonra.code, 'KAYITLI_CIHAZ_PAYLASILAN_ANAHTAR');

  // 8) Aynı nonce ikinci kez kullanılamaz (replay)
  const n = 'sabit-nonce-' + crypto.randomBytes(3).toString('hex');
  assert.equal((await auth.verifyRequest(istek({ secret: cihazSirri, nonce: n }))).ok, true);
  assert.equal((await auth.verifyRequest(istek({ secret: cihazSirri, nonce: n }))).code, 'TEKRAR');

  // 9) Kayıt silinince cihaz yeniden kaydolabilir (yeniden kurulan makine)
  await auth.revoke(CIHAZ);
  assert.equal((await auth.verifyRequest(istek({ secret: PAYLASILAN }))).yeniKayit, true);

  // 10) Sır listede ASLA görünmez
  const liste = await auth.listEnrollments();
  assert.ok(liste.every((r) => r.secret === undefined), 'cihaz sırrı dışarı sızmamalı');

  await db()('agent_enrollments').where({ device_id: CIHAZ }).del();
  delete process.env.WEBHOOK_AUTH;
});

// ── QR kayıt jetonu ───────────────────────────────────────────────────────────
test('register-token: imza, süre, kullanım hakkı ve iptal', async () => {
  const crypto = require('crypto');
  process.env.REGISTER_SECRET = 'test-register-secret-en-az-32-karakter-olmali';
  const rt = require('../agent/tools/register-token');
  const { db } = require('../db');

  // 1) Jetonsuz / uydurma istek reddedilir
  assert.equal((await rt.verifyAndConsume('')).code, 'JETON_YOK');
  assert.equal((await rt.verifyAndConsume('uydurma.imza')).code, 'IMZA_GECERSIZ');

  // 2) Üretilen jeton geçerli; imzası bozulunca reddedilir
  const t = await rt.create({ hours: 24, uses: 2, by: 'test' });
  assert.equal((await rt.verifyAndConsume(t.token.slice(0, -2) + 'XY')).code, 'IMZA_GECERSIZ');

  // 3) Kullanım hakkı: 2 kullanım sonra biter
  const k1 = await rt.verifyAndConsume(t.token);
  assert.equal(k1.ok, true);
  assert.equal(k1.kalan, 1);
  assert.equal((await rt.verifyAndConsume(t.token)).kalan, 0);
  assert.equal((await rt.verifyAndConsume(t.token)).code, 'HAK_BITTI',
    'hakkı biten QR bir daha kullanılamamalı — imza tek başına yetmez');

  // 4) Süresi geçmiş jeton (imzadaki exp geçmişte) reddedilir
  const b64u = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const govde = b64u(JSON.stringify({ jti: t.jti, exp: Date.now() - 60000 }));
  const sig = crypto.createHmac('sha256', process.env.REGISTER_SECRET).update(govde)
    .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal((await rt.verifyAndConsume(`${govde}.${sig}`)).code, 'SURE_DOLDU');

  // 5) İptal edilen jeton reddedilir
  const ipt = await rt.create({ hours: 24, uses: 5, by: 'test' });
  await rt.revoke(ipt.jti);
  assert.equal((await rt.verifyAndConsume(ipt.token)).code, 'IPTAL');

  // 6) Eşzamanlı kullanım son hakkı İKİ KEZ harcatmamalı (koşullu UPDATE)
  const yaris = await rt.create({ hours: 24, uses: 1, by: 'test' });
  const sonuc = await Promise.all([rt.verifyAndConsume(yaris.token), rt.verifyAndConsume(yaris.token)]);
  assert.equal(sonuc.filter((x) => x.ok).length, 1, 'tek hak yalnız bir istekte harcanmalı');

  // 7) Sınırlar: aşırı istek kırpılır
  const asiri = await rt.create({ hours: 9999, uses: 9999, by: 'test' });
  assert.equal(asiri.hours, rt.AZAMI_SAAT);
  assert.equal(asiri.max_uses, rt.AZAMI_KULLANIM);

  // 8) Listede sır YOK (jeton gövdesi zaten imzanın içinde, saklanmıyor)
  const liste = await rt.list();
  assert.ok(liste.every((r) => r.token === undefined && r.secret === undefined));

  await db()('register_tokens').where({ created_by: 'test' }).del();
  delete process.env.REGISTER_SECRET;
});

// ── Klon cihaz tespiti (sysprep yapılmamış imaj) ─────────────────────────────
test('agent-auth: aynı kimlikten farklı seri gelince klon şüphesi işaretlenir', async () => {
  const crypto = require('crypto');
  const auth = require('../agent/tools/agent-auth');
  const { db } = require('../db');
  const CIHAZ = 'KLON-TEST-' + crypto.randomBytes(4).toString('hex');
  await db()('agent_enrollments').where({ device_id: CIHAZ }).del();
  await auth.enroll(CIHAZ, { agent_version: '1.3.0' });

  // 1) İlk seri sadece kaydedilir — şüphe YOK
  assert.equal(await auth.checkClone(CIHAZ, 'SERI-AAA'), null);
  let k = (await auth.listEnrollments()).find((x) => x.device_id === CIHAZ);
  assert.equal(k.serial_number, 'SERI-AAA');
  assert.equal(k.clone_suspect, 0);

  // 2) Aynı seri tekrar gelirse yine şüphe yok
  assert.equal(await auth.checkClone(CIHAZ, 'SERI-AAA'), null);

  // 3) FARKLI seri → klon şüphesi işaretlenir (istek reddedilmez, işaretlenir:
  //    meşru anakart değişimini kırmak istemiyoruz)
  const not = await auth.checkClone(CIHAZ, 'SERI-BBB');
  assert.ok(not && not.includes('SERI-AAA') && not.includes('SERI-BBB'));
  k = (await auth.listEnrollments()).find((x) => x.device_id === CIHAZ);
  assert.equal(k.clone_suspect, 1);
  assert.equal(k.serial_number, 'SERI-BBB', 'son görülen seri güncellenmeli');
  assert.ok(k.clone_note && k.clone_note.length <= 300);

  // 4) Boş seri hiçbir şey yapmaz (telemetrisiz istek şüphe üretmemeli)
  const oncekiNot = k.clone_note;
  assert.equal(await auth.checkClone(CIHAZ, ''), null);
  k = (await auth.listEnrollments()).find((x) => x.device_id === CIHAZ);
  assert.equal(k.clone_note, oncekiNot);

  await db()('agent_enrollments').where({ device_id: CIHAZ }).del();
});
