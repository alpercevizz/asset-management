const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { stmts, PLANS } = require('../db/setup');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

function generateApiKey() {
  return 'am_' + uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '').slice(0, 8);
}

// POST /auth/register
router.post('/register', async (req, res) => {
  const { org_name, email, password } = req.body;

  if (!org_name || !email || !password) {
    return res.status(400).json({ error: 'org_name, email ve password zorunludur' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı' });
  }

  const existingUser = stmts.getUserByEmail.get(email);
  if (existingUser) {
    return res.status(409).json({ error: 'Bu email zaten kayıtlı' });
  }

  const plan = 'starter';
  const orgId = uuidv4();
  let slug = slugify(org_name);

  // Slug çakışmasını önle
  const existingSlug = stmts.getOrgBySlug.get(slug);
  if (existingSlug) slug = slug + '-' + orgId.slice(0, 6);

  const collectorKey = generateApiKey();
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  try {
    stmts.createOrg.run(orgId, org_name, slug, plan, PLANS[plan].asset_limit, collectorKey);
    stmts.createUser.run(userId, orgId, email, passwordHash, 'admin');
    stmts.writeAudit.run(orgId, userId, 'register', `Yeni org: ${org_name}`, req.ip);

    const token = signToken({ userId, orgId });
    res.status(201).json({
      token,
      user: { id: userId, email, role: 'admin' },
      org:  { id: orgId, name: org_name, slug, plan, collector_api_key: collectorKey },
    });
  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ error: 'Kayıt sırasında hata oluştu' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email ve şifre zorunludur' });

  const user = stmts.getUserByEmail.get(email);
  if (!user) return res.status(401).json({ error: 'Email veya şifre hatalı' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Email veya şifre hatalı' });

  const org = stmts.getOrgById.get(user.org_id);
  stmts.writeAudit.run(org.id, user.id, 'login', null, req.ip);

  const token = signToken({ userId: user.id, orgId: org.id });
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
    org:  { id: org.id, name: org.name, slug: org.slug, plan: org.plan, collector_api_key: org.collector_api_key },
  });
});

// GET /auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, role: req.user.role },
    org:  { id: req.org.id, name: req.org.name, slug: req.org.slug, plan: req.org.plan,
            asset_limit: req.org.asset_limit, collector_api_key: req.org.collector_api_key },
  });
});

// POST /auth/rotate-key — collector API key yenile
router.post('/rotate-key', requireAuth, (req, res) => {
  const newKey = generateApiKey();
  stmts.updateOrgKey.run(newKey, req.org.id);
  stmts.writeAudit.run(req.org.id, req.user.id, 'rotate_key', null, req.ip);
  res.json({ collector_api_key: newKey });
});

module.exports = router;
