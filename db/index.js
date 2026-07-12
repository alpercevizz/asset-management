// ── AssetMan Veritabanı Katmanı — Driver Seçilebilir (SQLite | PostgreSQL) ────
// DATABASE_URL ile driver seçilir:
//   sqlite:./data/assetman.db       → yerel dosya (Starter/tek sunucu)
//   sqlite::memory:                 → RAM (test)
//   postgres://user:pass@host:port/db → PostgreSQL (Pro/Enterprise)
//
// Aynı kod tabanı her ikisiyle de çalışır (knex sayesinde). Test/dev tercihi SQLite,
// production/Enterprise tercihi PostgreSQL. WORM ve secrets dosya-bazlı KALIR.
const path = require('path');
const fs = require('fs');

let _knex = null;
let _driver = null;
let _url = null;

function parseDatabaseUrl(raw) {
  const url = String(raw || 'sqlite:./data/assetman.db').trim();

  if (url.startsWith('sqlite:')) {
    let file = url.slice('sqlite:'.length);
    if (file === ':memory:') return { driver: 'sqlite', file: ':memory:' };
    if (!path.isAbsolute(file)) file = path.join(__dirname, '..', file);
    return { driver: 'sqlite', file };
  }
  if (url.startsWith('postgres:') || url.startsWith('postgresql:')) {
    return { driver: 'pg', connection: url };
  }
  throw new Error(`Desteklenmeyen DATABASE_URL: ${url} (sqlite:... veya postgres://... bekleniyor)`);
}

function buildKnex(cfg) {
  const knex = require('knex');
  if (cfg.driver === 'sqlite') {
    if (cfg.file !== ':memory:') {
      try { fs.mkdirSync(path.dirname(cfg.file), { recursive: true }); } catch {}
    }
    return knex({
      client: 'better-sqlite3',
      connection: { filename: cfg.file },
      useNullAsDefault: true,
      // SQLite'ta FK zorla + WAL modu (concurrent read)
      pool: {
        afterCreate(conn, done) {
          try {
            conn.pragma('foreign_keys = ON');
            conn.pragma('journal_mode = WAL');
            conn.pragma('synchronous = NORMAL');
          } catch (_) {}
          done(null, conn);
        },
      },
    });
  }
  return knex({
    client: 'pg',
    connection: cfg.connection,
    pool: { min: 0, max: 10 },
  });
}

// Singleton — tüm modüller aynı bağlantıyı kullanır
function db() {
  if (_knex) return _knex;
  const raw = process.env.DATABASE_URL || 'sqlite:./data/assetman.db';
  const cfg = parseDatabaseUrl(raw);
  _driver = cfg.driver;
  _url = raw;
  _knex = buildKnex(cfg);
  return _knex;
}

// Test veya reset için: mevcut bağlantıyı kapat, yeniden aç
async function reset() {
  if (_knex) { try { await _knex.destroy(); } catch (_) {} }
  _knex = null;
  return db();
}

function driver() { return _driver || (db() && _driver); }
function url() { return _url; }

// Migration'ları çalıştır (ilk açılış veya güncellemede)
async function migrate() {
  const k = db();
  await k.migrate.latest({
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  });
}

module.exports = { db, reset, migrate, driver, url };
