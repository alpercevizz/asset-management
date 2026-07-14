// ── Turkcell Hat / SIM Envanteri (Dalga 2) ──────────────────────────────────
// Telefon hatları ayrı tablo — çünkü bir hat zamanla telefon değiştirebilir
// ("bu numara önce X telefonda, şimdi Y'de"). Atama geçmişi line_assignments'ta tutulur.
//  - phone_lines: hattın kendisi (ICCID, MSISDN, operatör, tarife, durum) + güncel telefon
//  - line_assignments: append-only atama/iade geçmişi (hangi hat hangi telefonda, ne zaman)
exports.up = async function (knex) {
  await knex.schema.createTable('phone_lines', (t) => {
    t.increments('id').primary();
    t.string('iccid', 32).notNullable().unique();      // SIM kart kimliği (19-20 hane)
    t.string('msisdn', 24).notNullable();              // telefon numarası (E.164, örn +905xx)
    t.string('operator', 48).notNullable().defaultTo('Turkcell');
    t.string('tariff', 96);                            // tarife/paket adı
    t.string('status', 24).notNullable().defaultTo('aktif'); // aktif/pasif/iptal
    t.integer('assigned_asset_id');                    // güncel telefon (Baserow asset id) — boşsa boşta
    t.string('assigned_hostname', 256);                // güncel telefon adı (görüntü kolaylığı)
    t.string('note', 512);
    t.string('created_at', 64).notNullable();
    t.string('updated_at', 64).notNullable();
    t.index('iccid');
    t.index('msisdn');
    t.index('assigned_asset_id');
  });

  await knex.schema.createTable('line_assignments', (t) => {
    t.increments('id').primary();
    t.integer('line_id').notNullable();                // phone_lines.id
    t.string('iccid', 32).notNullable();
    t.string('msisdn', 24).notNullable();
    t.integer('asset_id');                             // ilgili telefon (boşsa iade/boşa alma)
    t.string('hostname', 256);
    t.string('action', 24).notNullable();              // 'atandi' | 'iade' | 'olusturuldu'
    t.string('actor', 128);
    t.string('note', 512);
    t.string('at', 64).notNullable();                  // ISO timestamp
    t.index('line_id');
    t.index('asset_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('line_assignments');
  await knex.schema.dropTableIfExists('phone_lines');
};
