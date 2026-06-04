const jwt = require('jsonwebtoken');
const { stmts } = require('../db/setup');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// Bearer token doğrulama — dashboard ve API için
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Oturum açmanız gerekiyor' });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    const user = stmts.getUserById.get(payload.userId);
    if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });

    const org = stmts.getOrgById.get(user.org_id);
    if (!org) return res.status(401).json({ error: 'Organizasyon bulunamadı' });

    req.user = user;
    req.org  = org;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
  }
}

// Collector script API key doğrulama
function requireCollectorKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.body?.api_key;
  if (!key) return res.status(401).json({ error: 'X-API-Key header zorunludur' });

  const org = stmts.getOrgByApiKey.get(key);
  if (!org) return res.status(401).json({ error: 'Geçersiz API anahtarı' });

  req.org = org;
  next();
}

module.exports = { signToken, requireAuth, requireCollectorKey };
