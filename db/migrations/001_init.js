// ── AssetMan — İlk şema (SQLite + PostgreSQL uyumlu) ─────────────────────────
// Kritik ayrımlar:
//  - lifecycle_events: seq PRIMARY KEY (hash zinciri sıra bağımlı — seq'e göre okuma ZORUNLU)
//  - password/signature/hash: TEXT (hex/base64), boy sınırı yok
//  - JSON alanları: SQLite'ta TEXT + JSON.parse, PostgreSQL'de jsonb (knex .json() portable)
exports.up = async function (knex) {
  const pg = knex.client.dialect === 'postgresql' || knex.client.dialect === 'pg';

  // ── users ───────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('username', 128).notNullable().unique();
    t.text('password').notNullable();               // scrypt hash: "salt:hash"
    t.string('role', 32).notNullable();             // admin/it/approver
    t.string('display', 256);
    t.string('upn', 256);
    t.string('ip', 64);
    t.string('mac', 64);
    t.json('groups');                               // array
    t.boolean('mfa_enabled').notNullable().defaultTo(true);
    t.string('created_at', 64).notNullable();
    t.index('username');
    t.index('role');
  });

  // ── os_agents (OS Agent enrollment — spoofing kalkanı) ──────────────────────
  await knex.schema.createTable('os_agents', (t) => {
    t.increments('id').primary();
    t.integer('asset_id').notNullable().unique();   // Baserow satır id'si (int)
    t.string('hostname', 256);
    t.string('os', 128);
    t.string('agent_id', 32).notNullable();
    t.text('secret').notNullable();                 // rastgele 24-byte base64
    t.string('enrolled_at', 64).notNullable();
    t.string('agent_version', 32);
    t.index('asset_id');
  });

  // ── lifecycle_events (audit log — HMAC-SHA256 zinciri) ──────────────────────
  // seq: sıra numarası. Zincir seq'e göre okunur. FK ile prev_seq bağı YOK
  //   (append-only mantığını sadeleştirir; verifyChain zaten prev_hash kontrolü yapar).
  await knex.schema.createTable('lifecycle_events', (t) => {
    t.integer('seq').primary();                     // manuel atanır (1,2,3...)
    t.string('timestamp', 64).notNullable();        // ISO string
    t.integer('asset_id');
    t.string('hostname', 256);
    t.string('serial_number', 256);
    t.string('from_status', 128);
    t.string('to_status', 128).notNullable();
    t.text('note');
    t.string('actor', 128).notNullable();
    t.string('actor_upn', 256);
    t.string('actor_ip', 64);
    t.string('actor_mac', 64);
    t.boolean('mfa_verified').notNullable().defaultTo(true);
    t.string('mfa_method', 128);
    t.string('approver', 256);
    t.string('approval_status', 32).notNullable().defaultTo('n/a');
    t.string('approval_id', 32);
    t.string('approval_token', 64);
    t.string('approval_expires_at', 64);
    t.string('renews', 32);
    t.boolean('signed').notNullable().defaultTo(false);
    t.string('security_flag', 64);
    t.text('signature');                            // HMAC hex
    t.text('prev_hash').notNullable();              // GENESIS veya önceki hash
    t.text('hash').notNullable();                   // HMAC-SHA256 hex
    t.index('asset_id');
    t.index('hostname');
    t.index('serial_number');
    t.index('approval_id');
    t.index('approval_token');
    t.index('approval_status');
  });

  // Not: kv_state tablosu bilinçli EKLENMEDİ — notify-state, discovery-state
  // küçük ve hız-kritik, dosya kalıyor. secrets.json güvenlik nedeniyle
  // dosyada (chmod 600) daha güvenli.
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lifecycle_events');
  await knex.schema.dropTableIfExists('os_agents');
  await knex.schema.dropTableIfExists('users');
};
