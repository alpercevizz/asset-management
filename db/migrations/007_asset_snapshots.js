// ── Günlük Envanter Anlık Görüntüsü ─────────────────────────────────────────
// KÖK SORUN: dashboard "↑%12 bu ay" gibi trend gösteremiyordu çünkü sistemde
// GEÇMİŞ yoktu — yalnız anlık durum tutuluyordu. created_on'dan yalnız TOPLAM
// varlık geriye dönük türetilebiliyor; durum kırılımı (çevrimiçi/depoda/çevrimdışı)
// için tarihsel kayıt şart.
//
// ÇÖZÜM: günde bir satır. Scheduler yazar (aynı gün tekrar çalışırsa ÜZERİNE yazar,
// gün başına tek satır garantisi). Trend = bugünkü değer vs N gün önceki satır.
exports.up = async function (knex) {
  await knex.schema.createTable('asset_daily_snapshot', (t) => {
    t.string('day', 10).primary();      // YYYY-MM-DD (yerel gün)
    t.integer('total').notNullable().defaultTo(0);
    t.integer('online').notNullable().defaultTo(0);
    t.integer('offline').notNullable().defaultTo(0);
    t.integer('depoda').notNullable().defaultTo(0);
    t.integer('locations').notNullable().defaultTo(0);
    t.string('taken_at', 64).notNullable();
    t.string('source', 32);             // scheduler | backfill | manual
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('asset_daily_snapshot');
};
