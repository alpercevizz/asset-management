// ── Çok-Kullanıcılı Kimlik & Rol Yönetimi ───────────────────────────────────
// Gerçek kişi-bazlı auth: scrypt ile hash'lenmiş parolalar (DIŞ BAĞIMLILIK YOK — Node crypto).
// Her kullanıcı bir AD kimliğine (UPN/IP/MAC/MFA) ve role (admin/it/approver) sahiptir.
// Bu modül hem login doğrulaması hem de imza/onay kimliğinin TEK doğruluk kaynağıdır.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, '..', 'data', 'users.json');
const AD_DOMAIN = process.env.AD_DOMAIN || 'kurumsal.local';

// Roller:
//  admin    → her şey (kayıt + onay + kullanıcı yönetimi)
//  it       → durum değişikliği/log oluşturabilir (submitter)
//  approver → kritik değişiklikleri dijital onaylayabilir (ikinci imza)
const ROLES = ['admin', 'it', 'approver'];

// scrypt parola hash (salt:hash, base64)
function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const dk = crypto.scryptSync(String(password), salt, 64).toString('base64');
  return `${salt}:${dk}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const dk = crypto.scryptSync(String(password), salt, 64).toString('base64');
  const a = Buffer.from(dk), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── İlk açılışta tohum kullanıcılar ──────────────────────────────────────────
// PAROLALAR KOD İÇİNDE TUTULMAZ. Sırayla:
//   1) Kullanıcıya özel env (USER_PW_<USERNAME_UPPER>, '.' → '_')
//   2) Admin için APP_PASSWORD env
//   3) Hiçbiri yoksa RASTGELE üretilir ve ilk-açılış loguna yazılır.
function envKeyFor(username) {
  return 'USER_PW_' + String(username).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
function _initialPasswords() { return _firstRunPasswords; }
let _firstRunPasswords = []; // {username, password} — sadece rastgele üretilenler için console'a yazılır

function seedUsers() {
  _firstRunPasswords = [];
  const pickPw = (username) => {
    const env = process.env[envKeyFor(username)] || (username === 'admin' ? process.env.APP_PASSWORD : null);
    if (env) return env;
    const random = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
    _firstRunPasswords.push({ username, password: random });
    return random;
  };
  const mk = (username, role, display, upn, ip, mac, groups, mfa_enabled = true) => ({
    username, role, display, upn, ip, mac, groups, mfa_enabled,
    password: hashPassword(pickPw(username)),
    created_at: new Date().toISOString(),
  });
  return [
    mk('admin',          'admin',
       'Sistem Yöneticisi', 'admin@' + AD_DOMAIN, '10.0.1.5', 'D0:39:57:70:64:EB', ['Domain Admins', 'BT Yönetimi']),
    mk('mehmet.yilmaz',  'it',
       'Mehmet Yılmaz', 'mehmet.yilmaz@' + AD_DOMAIN, '10.0.1.41', 'A4:C3:F0:12:34:11', ['BT Destek']),
    mk('dbadmin',        'it',
       'Veritabanı Yöneticisi', 'db.admin@' + AD_DOMAIN, '10.0.1.32', '7C:D3:0A:8F:4E:30', ['SQL Admins']),
    mk('ahmet.sahin',    'approver',
       'Ahmet Şahin (BT Müdürü)', 'ahmet.sahin@' + AD_DOMAIN, '10.0.1.10', 'B8:27:EB:11:22:33', ['BT Müdürleri', 'Onaylayanlar']),
    mk('zeynep.korkmaz', 'approver',
       'Zeynep Korkmaz (İK Sorumlusu)', 'zeynep.korkmaz@' + AD_DOMAIN, '10.0.1.60', 'B8:27:EB:44:55:66', ['İK', 'Onaylayanlar']),
    mk('murat.demir',    'approver',
       'Murat Demir (Departman Yöneticisi)', 'murat.demir@' + AD_DOMAIN, '10.0.1.70', 'B8:27:EB:77:88:99', ['Yöneticiler', 'Onaylayanlar']),
  ];
}

function loadUsers() {
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (Array.isArray(j.users) && j.users.length) return j.users;
  } catch { /* yok → tohumla */ }
  const seeded = seedUsers();
  try { fs.writeFileSync(USERS_FILE, JSON.stringify({ _comment: 'Kullanıcı tablosu. Parolalar scrypt hash. Elle düzenlemeyin.', users: seeded }, null, 2), 'utf8'); }
  catch (e) { console.error('[users] yazılamadı:', e.message); }
  // İlk açılışta rastgele üretilen parolaları console'a yaz (kullanıcı kaydetsin) — sadece ilk seed'de.
  if (_firstRunPasswords.length && !process.env.SUPPRESS_PASSWORD_LOG) {
    console.log('\n  ┌─ İLK AÇILIŞ PAROLALARI (bir kez gösterilir, kaydedin!) ─────────────');
    _firstRunPasswords.forEach(({ username, password }) => console.log(`  │ ${username.padEnd(18)} ${password}`));
    console.log('  │ İpucu: bu kullanıcılar için .env\'ye USER_PW_<USERNAME>= eklerseniz parolayı siz belirlersiniz.');
    console.log('  └────────────────────────────────────────────────────────────────────\n');
    _firstRunPasswords = [];
  }
  return seeded;
}

let _cache = null;
function all() { if (!_cache) _cache = loadUsers(); return _cache; }
function findUser(username) {
  if (!username) return null;
  return all().find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null;
}

// Login doğrulaması → kullanıcı (parolasız) veya null
function authenticate(username, password) {
  const u = findUser(username);
  if (!u) { verifyPassword(password, 'x:y'); return null; } // zamanlama eşitleme
  if (!verifyPassword(password, u.password)) return null;
  return publicUser(u);
}

// Parola/hash içermeyen güvenli kullanıcı görünümü
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

// AD kimlik bağlamı (recordEvent'in gömdüğü alanlar) — display adıyla da çözülebilir
function identityOf(usernameOrDisplay, overrides = {}) {
  const u = findUser(usernameOrDisplay) || all().find(x => x.display === usernameOrDisplay);
  const slug = String(usernameOrDisplay || 'bilinmeyen').toLowerCase().replace(/[^a-z0-9.]+/g, '.');
  return {
    actor: u ? u.username : (usernameOrDisplay || '—'),
    actor_upn: u ? u.upn : `${slug}@${AD_DOMAIN}`,
    actor_display: u ? u.display : usernameOrDisplay,
    actor_ip: overrides.ip || (u && u.ip) || '—',
    actor_mac: overrides.mac || (u && u.mac) || '—',
    actor_role: u ? u.role : null,
    actor_groups: (u && u.groups) || [],
    mfa_verified: overrides.mfa_verified !== false,
    mfa_method: overrides.mfa_method || (overrides.mfa_verified === false ? 'YOK (bypass)' : 'TOTP (Authenticator)'),
  };
}

function listApprovers() { return all().filter(u => u.role === 'approver' || u.role === 'admin').map(u => u.display); }
function hasRole(user, ...roles) { return user && roles.includes(user.role); }

module.exports = { ROLES, AD_DOMAIN, authenticate, findUser, publicUser, identityOf, listApprovers, hasRole, all };
