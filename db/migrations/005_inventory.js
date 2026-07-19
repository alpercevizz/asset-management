// ── Envanter SQL Katmanı (assets + licenses) — Baserow'dan bağımsızlaşma ────────
// INVENTORY_PROVIDER=sql iken envanter Baserow yerine burada tutulur.
// Baserow alan adları BİREBİR korunur (collector/webhook/register aynı payload'ı gönderir).
// id: mevcut Baserow row id'leri KORUNARAK taşınır → os_agents/asset_assignments/
// phone_lines/lifecycle_events'in asset_id bağları bozulmaz.
exports.up = async function (knex) {
  await knex.schema.createTable('assets', (t) => {
    t.increments('id').primary();                 // Baserow row id ile aynı tutulur (migrasyonda explicit)
    t.string('hostname', 256);
    t.string('serial_number', 256);
    t.string('brand', 128); t.string('model', 128);
    t.string('cpu', 256); t.integer('cpu_cores'); t.integer('cpu_threads');
    t.integer('ram_gb'); t.integer('storage_gb');
    t.string('os', 128); t.string('os_arch', 32);
    t.string('ip_address', 64); t.string('mac_address', 64);
    t.string('username', 128);
    t.string('gpu', 256); t.integer('gpu_ram_gb'); t.integer('uptime_days');
    t.string('domain', 128);
    t.string('last_seen', 64);
    t.string('status', 32);
    t.string('collector_ver', 64);
    t.string('category', 64);
    t.string('location', 128);
    t.string('warranty_expiry', 64);
    t.string('org_id', 64);                        // multi-tenant (ileride)
    t.string('created_on', 64);
    t.index('serial_number'); t.index('category'); t.index('status'); t.index('org_id');
  });

  await knex.schema.createTable('licenses', (t) => {
    t.increments('id').primary();
    t.string('hostname', 256);
    t.string('serial_number', 256);
    t.string('software_name', 256);
    t.string('software_version', 128);
    t.string('publisher', 256);
    t.string('license_type', 64);
    t.string('license_status', 64);
    t.string('license_key', 256);
    t.string('username', 128);
    t.string('location', 128);
    t.string('install_date', 64);
    t.string('expiry_date', 64);
    t.string('last_seen', 64);
    t.string('org_id', 64);
    t.index('hostname'); t.index('software_name');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('licenses');
  await knex.schema.dropTableIfExists('assets');
};
