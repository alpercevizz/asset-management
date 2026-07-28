// ── Varlık Detay Alanları + Model Görselleri ────────────────────────────────
// Envanter sağlayıcı baserow|sql seçilebilir olduğu için bu alanlar envanter
// tablosuna DEĞİL, ayrı SQL tablosuna yazılır (asset_assignments /
// asset_expected_location / location_geo ile aynı desen). Böylece Baserow'da
// alan açmaya gerek kalmaz ve iki sağlayıcıda da aynı çalışır.
exports.up = async function (knex) {
  // Satın alma / bakım / not — detay sayfasında gösterilir
  await knex.schema.createTable('asset_details', (t) => {
    t.integer('asset_id').primary();
    t.string('purchase_date', 32);      // YYYY-MM-DD
    t.decimal('purchase_price', 14, 2);
    t.string('currency', 8).defaultTo('TRY');
    t.string('supplier', 128);
    t.string('last_maintenance', 32);   // YYYY-MM-DD
    t.string('next_maintenance', 32);   // YYYY-MM-DD
    t.text('note');
    t.string('updated_at', 64);
    t.string('updated_by', 128);
  });

  // Model görselleri — cihaza DEĞİL modele bağlanır: bir kez yüklenen görsel
  // o modeldeki TÜM cihazlarda görünür.
  await knex.schema.createTable('device_images', (t) => {
    t.increments('id').primary();
    t.string('brand_key', 128).notNullable();   // normalize edilmiş marka ('' = marka bağımsız)
    t.string('model_key', 160).notNullable();   // normalize edilmiş model ('' = kategori geneli)
    t.string('category', 64);                   // marka+kategori kuralı için
    t.string('brand_label', 128);
    t.string('model_label', 160);
    t.string('file', 200).notNullable();        // data/device-images altındaki dosya adı
    t.string('mime', 40).notNullable();
    t.integer('bytes');
    t.string('uploaded_at', 64).notNullable();
    t.string('uploaded_by', 128);
    t.unique(['brand_key', 'model_key', 'category']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('device_images');
  await knex.schema.dropTableIfExists('asset_details');
};
