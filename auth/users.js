// ── Çok-Kullanıcılı Kimlik & Rol Yönetimi (SQL destekli — SQLite | PostgreSQL) ─
// Depolama: users tablosu (parolalar scrypt hash). İlk açılışta tohumlanır.
// PERFORMANS: `init()` DB'den bir kez okur ve memory cache doldurur;
// find/all/identityOf senkron çalışır (server.js ve lifecycle-tools senkron bekliyor).
// Yeni kullanıcı eklenirse cache invalidate edilir (create/update sonrası init tekrar).
const crypto = require('crypto');
const { db } = require('../db');

const AD_DOMAIN = process.env.AD_DOMAIN || 'kurumsal.local';
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

// ── Seed listesi (parolalar env'den ya da rastgele — koda gömülü YOK) ────────
function envKeyFor(username) {
  return 'USER_PW_' + String(username).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}
let _firstRunPasswords = [];
function seedDefinitions() {
  return [
    { username: 'admin', role: 'admin',
      display: 'Sistem Yöneticisi', upn: 'admin@' + AD_DOMAIN, ip: '10.0.1.5', mac: 'D0:39:57:70:64:EB',
      groups: ['Domain Admins', 'BT Yönetimi'] },
    { username: 'mehmet.yilmaz', role: 'it',
      display: 'Mehmet Yılmaz', upn: 'mehmet.yilmaz@' + AD_DOMAIN, ip: '10.0.1.41', mac: 'A4:C3:F0:12:34:11',
      groups: ['BT Destek'] },
    { username: 'dbadmin', role: 'it',
      display: 'Veritabanı Yöneticisi', upn: 'db.admin@' + AD_DOMAIN, ip: '10.0.1.32', mac: '7C:D3:0A:8F:4E:30',
      groups: ['SQL Admins'] },
    { username: 'ahmet.sahin', role: 'approver',
      display: 'Ahmet Şahin (BT Müdürü)', upn: 'ahmet.sahin@' + AD_DOMAIN, ip: '10.0.1.10', mac: 'B8:27:EB:11:22:33',
      groups: ['BT Müdürleri', 'Onaylayanlar'] },
    { username: 'zeynep.korkmaz', role: 'approver',
      display: 'Zeynep Korkmaz (İK Sorumlusu)', upn: 'zeynep.korkmaz@' + AD_DOMAIN, ip: '10.0.1.60', mac: 'B8:27:EB:44:55:66',
      groups: ['İK', 'Onaylayanlar'] },
    { username: 'murat.demir', role: 'approver',
      display: 'Murat Demir (Departman Yöneticisi)', upn: 'murat.demir@' + AD_DOMAIN, ip: '10.0.1.70', mac: 'B8:27:EB:77:88:99',
      groups: ['Yöneticiler', 'Onaylayanlar'] },
  ];
}
function pickPw(username) {
  const env = process.env[envKeyFor(username)] || (username === 'admin' ? process.env.APP_PASSWORD : null);
  if (env) return env;
  const random = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '');
  _firstRunPasswords.push({ username, password: random });
  return random;
}

// ── DB satırı ↔ domain nesnesi normalleştirme ─────────────────────────────────
function rowToUser(r) {
  if (!r) return null;
  let groups = [];
  if (Array.isArray(r.groups)) groups = r.groups;
  else if (typeof r.groups === 'string') { try { groups = JSON.parse(r.groups) || []; } catch { groups = []; } }
  else if (r.groups && typeof r.groups === 'object') groups = r.groups;
  return {
    username: r.username, password: r.password, role: r.role,
    display: r.display, upn: r.upn, ip: r.ip, mac: r.mac,
    groups, mfa_enabled: !!r.mfa_enabled, created_at: r.created_at,
  };
}

// ── Memory cache (init sonrası doldurulur) ────────────────────────────────────
let _cache = null;
let _cacheReady = false;

async function _seedIfEmpty() {
  const k = db();
  const [row] = await k('users').count({ n: '*' });
  if (Number(row.n) > 0) return false;
  _firstRunPasswords = [];
  const now = new Date().toISOString();
  const rows = seedDefinitions().map(def => ({
    ...def,
    password: hashPassword(pickPw(def.username)),
    groups: JSON.stringify(def.groups),
    mfa_enabled: true,
    created_at: now,
  }));
  await k('users').insert(rows);
  if (_firstRunPasswords.length && !process.env.SUPPRESS_PASSWORD_LOG) {
    console.log('\n  ┌─ İLK AÇILIŞ PAROLALARI (bir kez gösterilir, kaydedin!) ─────────────');
    _firstRunPasswords.forEach(({ username, password }) => console.log(`  │ ${username.padEnd(18)} ${password}`));
    console.log('  │ İpucu: .env\'ye USER_PW_<USERNAME>= eklerseniz parolayı siz belirlersiniz.');
    console.log('  └────────────────────────────────────────────────────────────────────\n');
    _firstRunPasswords = [];
  }
  return true;
}

// Boot'ta bir kez çağır — DB'den tüm kullanıcıları memory'e alır.
async function init() {
  await _seedIfEmpty();
  const k = db();
  const rows = await k('users').select('*').orderBy('id');
  _cache = rows.map(rowToUser);
  _cacheReady = true;
}
function _invalidate() { _cacheReady = false; _cache = null; }

// ── Senkron API (init sonrası cache üzerinden) ────────────────────────────────
function _ensure() {
  if (!_cacheReady) throw new Error('users.init() henüz çağrılmadı — server boot sırasına bakın.');
}
function all() { _ensure(); return _cache; }
function findUser(username) {
  if (!username) return null;
  _ensure();
  const key = String(username).toLowerCase();
  return _cache.find(u => u.username.toLowerCase() === key) || null;
}
function authenticate(username, password) {
  const u = findUser(username);
  if (!u) { verifyPassword(password, 'x:y'); return null; }
  if (!verifyPassword(password, u.password)) return null;
  return publicUser(u);
}

// Sağlayıcı seçimi: 'local' (scrypt, varsayılan) | 'ldap' (gerçek AD bind).
const AUTH_PROVIDER = () => (process.env.AUTH_PROVIDER || 'local').toLowerCase();

// Async kimlik doğrulama — server.js /api/login buradan çağırır.
// ldap: gerçek dizin bind'i yapar, profili yerel tabloya upsert eder (cache tazelenir),
// böylece identityOf/approvers/audit imzası gerçek AD kimliğiyle çalışır.
// local: mevcut senkron scrypt yolunu kullanır.
async function authenticateAsync(username, password, deps = {}) {
  if (AUTH_PROVIDER() !== 'ldap') return authenticate(username, password);
  const ldap = deps.ldap || require('./ldap');
  const profile = await ldap.authenticate(username, password, deps);
  if (!profile) return null;
  await upsertFromDirectory(profile);
  return publicUser(findUser(profile.username));
}

// Dizinden gelen profili users tablosuna insert/update et, cache'i tazele.
// Parola kolonu: dizin-yönetimli hesaplar için doğrulanamaz rastgele scrypt hash
// (yerel provider'a dönülse bile bu hesaba bilinen parolayla girilemez).
async function upsertFromDirectory(profile) {
  const k = db();
  const existing = findUser(profile.username);
  const row = {
    username: profile.username,
    role: profile.role,
    display: profile.display || profile.username,
    upn: profile.upn || null,
    groups: JSON.stringify(profile.groups || []),
    mfa_enabled: profile.mfa_enabled !== false,
  };
  if (existing) {
    await k('users').where({ username: profile.username }).update(row);
  } else {
    await k('users').insert({
      ...row,
      password: hashPassword(crypto.randomBytes(32).toString('base64')),
      ip: profile.ip || null,
      mac: profile.mac || null,
      created_at: new Date().toISOString(),
    });
  }
  await init(); // cache'i yeniden yükle (senkron API tazelensin)
}
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function identityOf(usernameOrDisplay, overrides = {}) {
  const u = findUser(usernameOrDisplay) || (_cache && _cache.find(x => x.display === usernameOrDisplay));
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
function listApprovers() { _ensure(); return _cache.filter(u => u.role === 'approver' || u.role === 'admin').map(u => u.display); }
function hasRole(user, ...roles) { return user && roles.includes(user.role); }

// ── Kullanıcı yönetimi (admin) — local hesaplar için CRUD ────────────────────
// GÜVENLİK KURALLARI (burada uygulanır, UI'a güvenilmez):
//  • Son admin silinemez / rolü düşürülemez → sistem kilitlenmez
//  • Kullanıcı adı benzersiz (küçük harfe normalize)
//  • Parola en az 8 karakter, scrypt ile saklanır
//  • LDAP modunda hesaplar dizinden gelir; buradan eklenen yerel hesap bir sonraki
//    AD girişinde EZİLMEZ (farklı username ise), ama rol değişiklikleri AD'den gelen
//    kullanıcıda bir sonraki girişte dizindeki gruba göre yeniden yazılır.
const MIN_PW = 8;

function _adminCount() { _ensure(); return _cache.filter(u => u.role === 'admin').length; }
function _isLastAdmin(username) {
  const u = findUser(username);
  return !!(u && u.role === 'admin' && _adminCount() <= 1);
}
function _validate({ username, role, password, requirePassword }) {
  if (username !== undefined) {
    const un = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(un)) throw new Error('Kullanıcı adı 3-64 karakter olmalı (a-z, 0-9, nokta, tire, alt çizgi).');
  }
  if (role !== undefined && !ROLES.includes(role)) throw new Error(`Geçersiz rol. Geçerli: ${ROLES.join(', ')}`);
  if (requirePassword || (password !== undefined && password !== '')) {
    if (String(password || '').length < MIN_PW) throw new Error(`Parola en az ${MIN_PW} karakter olmalı.`);
  }
}

// Tüm kullanıcılar (parolasız) — admin listesi için
function listUsers() { _ensure(); return _cache.map(publicUser); }

async function createUser({ username, password, role = 'it', display, upn }) {
  _validate({ username, role, password, requirePassword: true });
  const un = String(username).trim().toLowerCase();
  if (findUser(un)) throw new Error(`"${un}" kullanıcı adı zaten var.`);
  await db()('users').insert({
    username: un,
    password: hashPassword(password),
    role,
    display: (display && String(display).trim()) || un,
    upn: (upn && String(upn).trim()) || `${un}@${AD_DOMAIN}`,
    groups: JSON.stringify([]),
    mfa_enabled: true,
    created_at: new Date().toISOString(),
  });
  await init();
  return publicUser(findUser(un));
}

// Kısmi güncelleme: role / display / upn / password (boş parola = değiştirme)
async function updateUser(username, { role, display, upn, password } = {}) {
  const u = findUser(username);
  if (!u) throw new Error('Kullanıcı bulunamadı.');
  _validate({ role, password });
  if (role && role !== 'admin' && _isLastAdmin(u.username)) {
    throw new Error('Son admin hesabının rolü değiştirilemez — sistemde en az bir admin kalmalı.');
  }
  const patch = {};
  if (role) patch.role = role;
  if (display !== undefined) patch.display = String(display).trim() || u.username;
  if (upn !== undefined) patch.upn = String(upn).trim() || null;
  if (password) patch.password = hashPassword(password);
  if (!Object.keys(patch).length) return publicUser(u);
  await db()('users').where({ username: u.username }).update(patch);
  await init();
  return publicUser(findUser(u.username));
}

async function deleteUser(username) {
  const u = findUser(username);
  if (!u) throw new Error('Kullanıcı bulunamadı.');
  if (_isLastAdmin(u.username)) throw new Error('Son admin hesabı silinemez — sistemde en az bir admin kalmalı.');
  await db()('users').where({ username: u.username }).del();
  await init();
  return { deleted: u.username };
}

module.exports = { ROLES, AD_DOMAIN, AUTH_PROVIDER, init, _invalidate, authenticate, authenticateAsync, upsertFromDirectory, findUser, publicUser, identityOf, listApprovers, hasRole, all, listUsers, createUser, updateUser, deleteUser };
