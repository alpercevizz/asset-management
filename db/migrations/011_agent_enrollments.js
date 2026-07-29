// ── Collector Cihaz Kayıtları (enrollment) ─────────────────────────────────
// Her cihaz ilk kez paylaşılan anahtarla imzaladığında kendine ÖZEL bir sır
// alır ve sonraki isteklerde onu kullanır. Kayıtlı cihaz için paylaşılan
// anahtar artık kabul edilmez → anahtarı okuyan yerel yönetici, başka bir
// cihazı taklit edemez.
exports.up = async function (knex) {
  await knex.schema.createTable('agent_enrollments', (t) => {
    t.string('device_id', 190).primary();   // makine kimliği (MachineGuid)
    t.text('secret').notNullable();         // cihaza özel HMAC sırrı — DIŞARI VERİLMEZ
    t.integer('asset_id');                  // eşleşen envanter kaydı (bilinince)
    t.string('agent_version', 32);
    t.string('enrolled_at', 64).notNullable();
    t.string('last_seen_at', 64);
    t.integer('revoked').notNullable().defaultTo(0);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('agent_enrollments');
};
