// ── Lokasyon Koordinatları ──────────────────────────────────────────────────
// KÖK SORUN: harita, lokasyon ADINI gömülü bir Türk şehir tablosuyla eşleştirerek
// konum tahmin ediyordu. "Ana Depo", "Sistem Odası" gibi adlar hiçbir tabloyla
// eşleşmez → harita dışında kalıyorlardı. Dünya haritasına geçerken bu tahmin
// yöntemi büsbütün yetersiz kalır.
//
// ÇÖZÜM: lokasyonun koordinatı AÇIKÇA tutulur. Ad eşleşenler otomatik tohumlanır
// (Türk illeri), gerisi Ayarlar'dan girilir. Dış geocoding servisi KULLANILMAZ —
// kapalı-devre ilkesi korunur.
exports.up = async function (knex) {
  await knex.schema.createTable('location_geo', (t) => {
    t.string('location', 256).primary();   // envanterdeki lokasyon adı (birebir)
    t.float('lat').notNullable();
    t.float('lon').notNullable();
    t.string('label', 128);                // haritada gösterilecek kısa ad (ops.)
    t.string('source', 32);                // seed | manuel
    t.string('set_at', 64).notNullable();
    t.string('set_by', 128);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('location_geo');
};
