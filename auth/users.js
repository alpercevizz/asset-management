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

module.exports = { ROLES, AD_DOMAIN, init, _invalidate, authenticate, findUser, publicUser, identityOf, listApprovers, hasRole, all };
