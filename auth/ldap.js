// ── LDAP / Active Directory Kimlik Sağlayıcı (AUTH_PROVIDER=ldap) ─────────────
// Gerçek AD bind: servis hesabıyla kullanıcıyı ara → kullanıcı DN'iyle re-bind
// (parola doğrulama) → memberOf gruplarını uygulama rolüne eşle → profil döndür.
// users.js bu profili yerel `users` tablosuna upsert eder; cache + identityOf +
// audit log imzası gerçek AD kimliğiyle çalışmaya devam eder (kalan sistem değişmez).
//
// KAPALI DEVRE UYUMU: ldapts YALNIZ provider=ldap iken lazy-require edilir.
// Varsayılan (local) kurulumda paket gerekmez — demo sıfır-friction kalır.
//
// TEST EDİLEBİLİRLİK: createClient enjekte edilebilir (deps.createClient) → canlı
// AD olmadan sahte client ile bind/search/rol-eşleme/MFA mantığı doğrulanır.

const cfg = () => ({
  url:        process.env.LDAP_URL || 'ldap://dc.kurumsal.local:389',
  bindDN:     process.env.LDAP_BIND_DN || '',           // servis hesabı (arama için)
  bindPw:     process.env.LDAP_BIND_PASSWORD || '',
  baseDN:     process.env.LDAP_BASE_DN || '',           // örn. DC=kurumsal,DC=local
  userAttr:   process.env.LDAP_USER_ATTR || 'sAMAccountName',
  // Kullanıcı filtresi — {u} girilen kullanıcı adıyla değiştirilir (LDAP-escape edilir)
  userFilter: process.env.LDAP_USER_FILTER || '(&(objectClass=user)({attr}={u}))',
  // AD grup CN'i → uygulama rolü. JSON. En yüksek yetkili rol kazanır.
  roleMap:    parseJson(process.env.LDAP_GROUP_ROLE_MAP) || {
                'Domain Admins': 'admin', 'BT Yönetimi': 'admin',
                'Onaylayanlar': 'approver', 'BT Destek': 'it',
              },
  defaultRole: process.env.LDAP_DEFAULT_ROLE || 'it',
  // MFA bu grubun üyeliğiyle modellenir (Entra/Duo'dan senkronlanan güvenlik grubu).
  // Boşsa MFA üst katmanda zorunlu varsayılır (mfa_enabled=true).
  mfaGroup:   process.env.LDAP_MFA_GROUP || '',
  timeoutMs:  Number(process.env.LDAP_TIMEOUT_MS) || 8000,
});

function parseJson(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

// Rol öncelik sırası — bir kullanıcı birden çok gruba üyeyse en yetkilisi kazanır.
const ROLE_RANK = { admin: 3, approver: 2, it: 1 };

// LDAP filtre değeri escape (RFC 4515) — injection önleme.
function escapeFilter(v) {
  return String(v).replace(/[\\*()\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// "CN=BT Destek,OU=Groups,DC=kurumsal,DC=local" → "BT Destek"
function cnOf(dn) {
  if (!dn) return '';
  const m = String(dn).match(/^CN=([^,]+)/i);
  return m ? m[1].trim() : String(dn).trim();
}

// memberOf (string | string[]) → CN dizisi
function groupsOf(memberOf) {
  if (!memberOf) return [];
  const arr = Array.isArray(memberOf) ? memberOf : [memberOf];
  return arr.map(cnOf).filter(Boolean);
}

// Grup CN'lerinden en yetkili rolü seç
function mapRole(groupCNs, roleMap, defaultRole) {
  let best = null, bestRank = 0;
  for (const cn of groupCNs) {
    const role = roleMap[cn];
    if (role && (ROLE_RANK[role] || 0) > bestRank) { best = role; bestRank = ROLE_RANK[role] || 0; }
  }
  return best || defaultRole;
}

// LDAPS (ldaps://) için TLS seçenekleri — public CA'da gerekmez; iç CA'da kök tanıtılır.
//  LDAP_TLS_CA=/yol/ca.pem            → iç CA kök sertifikası (önerilen, doğrulamalı)
//  LDAP_TLS_REJECT_UNAUTHORIZED=false → doğrulamayı kapat (YALNIZ hızlı test, üretimde KULLANMA)
//  LDAP_TLS_SERVERNAME=host           → SNI/hostname override (IP ile bağlanıp cert hostname'i farklıysa)
function buildTlsOptions() {
  const tls = {};
  if (process.env.LDAP_TLS_REJECT_UNAUTHORIZED === 'false') tls.rejectUnauthorized = false;
  if (process.env.LDAP_TLS_CA) {
    try { tls.ca = require('fs').readFileSync(process.env.LDAP_TLS_CA); }
    catch (e) { console.error('[ldap] LDAP_TLS_CA okunamadı:', e.message); }
  }
  if (process.env.LDAP_TLS_SERVERNAME) tls.servername = process.env.LDAP_TLS_SERVERNAME;
  return tls;
}

// Varsayılan client fabrikası — ldapts YALNIZ burada (provider=ldap iken) yüklenir.
function defaultCreateClient(url, timeoutMs) {
  let LdapClient;
  try { ({ Client: LdapClient } = require('ldapts')); }
  catch {
    throw new Error("LDAP sağlayıcı için 'ldapts' paketi gerekli. Kurun: npm install ldapts");
  }
  const opts = { url, timeout: timeoutMs, connectTimeout: timeoutMs };
  if (/^ldaps:/i.test(String(url))) {                    // yalnız LDAPS'te TLS seçenekleri
    const tls = buildTlsOptions();
    if (Object.keys(tls).length) opts.tlsOptions = tls;
  }
  return new LdapClient(opts);
}

// Bir arama sonucundan attribute değeri (ldapts entry: { dn, <attr>: value|[value] })
function attr(entry, name, fallback = null) {
  const v = entry && entry[name];
  if (v == null) return fallback;
  return Array.isArray(v) ? (v[0] ?? fallback) : v;
}

// ── Ana giriş: kullanıcı adı + parola → AD profili (veya null) ────────────────
// deps.createClient(url, timeoutMs) → { bind(dn,pw), search(base,opts)→{searchEntries}, unbind() }
async function authenticate(username, password, deps = {}) {
  if (!username || !password) return null;
  const c = cfg();
  const createClient = deps.createClient || defaultCreateClient;

  // 1) Servis hesabıyla bind + kullanıcı ara
  const searchClient = createClient(c.url, c.timeoutMs);
  let userEntry = null;
  try {
    if (c.bindDN) await searchClient.bind(c.bindDN, c.bindPw);
    const filter = c.userFilter
      .replace('{attr}', c.userAttr)
      .replace('{u}', escapeFilter(username));
    const { searchEntries } = await searchClient.search(c.baseDN, {
      scope: 'sub',
      filter,
      attributes: ['dn', 'displayName', 'userPrincipalName', 'mail', 'memberOf', c.userAttr],
    });
    userEntry = searchEntries && searchEntries[0];
  } catch (err) {
    throw new Error('LDAP arama/servis-bind hatası: ' + err.message);
  } finally {
    try { await searchClient.unbind(); } catch { /* yoksay */ }
  }

  if (!userEntry || !userEntry.dn) return null; // kullanıcı dizinde yok

  // 2) Kullanıcı DN'iyle re-bind → PAROLA DOĞRULAMA (asıl kimlik denetimi)
  const authClient = createClient(c.url, c.timeoutMs);
  try {
    await authClient.bind(userEntry.dn, password);
  } catch {
    return null; // parola yanlış / hesap kilitli → başarısız
  } finally {
    try { await authClient.unbind(); } catch { /* yoksay */ }
  }

  // 3) Grup → rol + MFA + profil normalizasyonu
  const groupCNs = groupsOf(userEntry.memberOf);
  const role = mapRole(groupCNs, c.roleMap, c.defaultRole);
  const sam = attr(userEntry, c.userAttr, username);
  const mfa_enabled = c.mfaGroup ? groupCNs.includes(c.mfaGroup) : true;

  return {
    username: String(sam).toLowerCase(),
    display: attr(userEntry, 'displayName', sam),
    upn: attr(userEntry, 'userPrincipalName') || attr(userEntry, 'mail') || `${sam}@${(process.env.AD_DOMAIN || 'kurumsal.local')}`,
    role,
    groups: groupCNs,
    mfa_enabled,
    source: 'ldap',
  };
}

module.exports = { authenticate, escapeFilter, cnOf, groupsOf, mapRole, buildTlsOptions, _cfg: cfg };
