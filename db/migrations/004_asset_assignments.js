// ── Resmi Zimmet (assigned_to) — Devir Koruması ─────────────────────────────
// KÖK SORUN: Baserow'daki tek `username` alanı iki kavramı karıştırıyordu — resmi
// zimmet + son oturum açan kullanıcı (telemetri). PUBLIC /api/webhook ve /api/register
// bunu kontrolsüz eziyor → zimmetli cihaz sessizce devralınabiliyordu.
// ÇÖZÜM: resmi zimmet AYRI ve KİLİTLİ tabloda tutulur. Telemetri (username) Baserow'da
// serbest güncellenir; resmi zimmet yalnız kontrollü akıştan değişir.
exports.up = async function (knex) {
  await knex.schema.createTable('asset_assignments', (t) => {
    t.integer('asset_id').primary();        // Baserow satır id (bir cihaz = tek resmi zimmet)
    t.string('assigned_to', 128);           // resmi zimmet sahibi (kullanıcı adı/UPN); boş = zimmetsiz
    t.string('hostname', 256);
    t.string('assigned_at', 64).notNullable();
    t.string('assigned_by', 128);           // devri yapan yetkili
    t.string('note', 512);
    t.index('assigned_to');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('asset_assignments');
};
