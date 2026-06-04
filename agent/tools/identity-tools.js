// ── LDAP / Active Directory & MFA Kimlik Katmanı ─────────────────────────────
// Kimliğin TEK doğruluk kaynağı artık auth/users.js (gerçek çok-kullanıcılı tablo).
// Bu dosya geriye dönük uyumluluk için ince bir köprü: recordEvent'in çağırdığı
// resolveIdentity'yi users.identityOf'a delege eder. Her log/imza kaydına kullanıcının
// AD UPN hesabı + IP/MAC + MFA durumu gömülür (hash + HMAC imzaya dahil).
const users = require('../../auth/users');

const AD_DOMAIN = users.AD_DOMAIN;

// actor: kullanıcı adı VEYA display adı. overrides: { ip, mac, mfa_verified, mfa_method }.
function resolveIdentity(actor, overrides = {}) {
  return users.identityOf(actor, overrides);
}

function identityLabel(e) {
  const ip = e.actor_ip && e.actor_ip !== '—' ? ` (${e.actor_ip})` : '';
  return `${e.actor_upn || e.actor}${ip}`;
}

module.exports = { AD_DOMAIN, resolveIdentity, identityLabel };
