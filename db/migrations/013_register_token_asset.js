// ── QR jetonuyla kaydolan varlığın izi ─────────────────────────────────────
// Panel QR'ı gösterdikten sonra "cihaz bağlandı mı?" diye bekliyor. Bunu
// anlayabilmek için jetonun HANGİ varlığı oluşturduğunu bilmek gerekiyor;
// yalnız kullanım sayacı "biri kaydoldu" der ama hangi cihaz olduğunu söylemez.
exports.up = async function (knex) {
  await knex.schema.alterTable('register_tokens', (t) => {
    t.integer('last_asset_id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('register_tokens', (t) => t.dropColumn('last_asset_id'));
};
