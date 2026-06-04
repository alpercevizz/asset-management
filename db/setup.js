const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'saas.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    slug              TEXT UNIQUE NOT NULL,
    plan              TEXT NOT NULL DEFAULT 'starter',
    asset_limit       INTEGER NOT NULL DEFAULT 50,
    collector_api_key TEXT UNIQUE NOT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     TEXT NOT NULL,
    user_id    TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
  CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id);
`);

// ── Plan limitleri ────────────────────────────────────────────────────────────
const PLANS = {
  starter:    { asset_limit: Number(process.env.PLAN_STARTER_ASSET_LIMIT)    || 50   },
  pro:        { asset_limit: Number(process.env.PLAN_PRO_ASSET_LIMIT)        || 500  },
  enterprise: { asset_limit: Number(process.env.PLAN_ENTERPRISE_ASSET_LIMIT) || 99999 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const stmts = {
  getOrgById:         db.prepare('SELECT * FROM organizations WHERE id = ?'),
  getOrgBySlug:       db.prepare('SELECT * FROM organizations WHERE slug = ?'),
  getOrgByApiKey:     db.prepare('SELECT * FROM organizations WHERE collector_api_key = ?'),
  createOrg:          db.prepare('INSERT INTO organizations (id,name,slug,plan,asset_limit,collector_api_key) VALUES (?,?,?,?,?,?)'),
  updateOrgKey:       db.prepare('UPDATE organizations SET collector_api_key = ? WHERE id = ?'),
  updateOrgPlan:      db.prepare('UPDATE organizations SET plan = ?, asset_limit = ? WHERE id = ?'),

  getUserByEmail:     db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById:        db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser:         db.prepare('INSERT INTO users (id,org_id,email,password_hash,role) VALUES (?,?,?,?,?)'),

  writeAudit:         db.prepare('INSERT INTO audit_log (org_id,user_id,action,detail,ip) VALUES (?,?,?,?,?)'),
  getAuditByOrg:      db.prepare('SELECT * FROM audit_log WHERE org_id = ? ORDER BY created_at DESC LIMIT 50'),
};

module.exports = { db, stmts, PLANS };
