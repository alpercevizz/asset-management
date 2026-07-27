// ── Lokasyon İzleme ─────────────────────────────────────────────────────────
// KÖK SORUN: envanterdeki tek `location` alanı ÜZERİNE YAZILIYORDU. Cihaz başka
// lokasyonda görülünce kayıt sessizce değişiyor; "ne zaman taşındı", "ne kadar
// süredir orada" bilgisi hiç tutulmuyordu → transfer/kayıp tespiti imkânsızdı.
//
// ÇÖZÜM (zimmet modülüyle AYNI desen — resmi kayıt vs. telemetri ayrımı):
//  · asset_expected_location → cihazın AİT OLDUĞU yer (resmi, kontrollü değişir)
//  · asset_location_history  → cihazın GÖRÜLDÜĞÜ yerler (telemetri, konaklama kayıtları)
// İkisi N gündür farklıysa "lokasyon sapması" uyarısı üretilir.
// Envanter sağlayıcıdan (baserow|sql) BAĞIMSIZ — SQL katmanında tutulur.
exports.up = async function (knex) {
  // Cihazın ait olduğu resmi lokasyon (bir cihaz = tek beklenen lokasyon)
  await knex.schema.createTable('asset_expected_location', (t) => {
    t.integer('asset_id').primary();
    t.string('location', 256).notNullable();
    t.string('hostname', 256);
    t.string('set_at', 64).notNullable();
    t.string('set_by', 128);              // beklenen lokasyonu belirleyen yetkili
    t.string('note', 512);
    t.index('location');
  });

  // Konaklama kaydı: cihaz bir lokasyonda ilk görüldüğünde satır açılır,
  // her görülmede last_seen_at güncellenir, lokasyon değişince yeni satır açılır.
  await knex.schema.createTable('asset_location_history', (t) => {
    t.increments('id').primary();
    t.integer('asset_id').notNullable();
    t.string('serial_number', 128);
    t.string('hostname', 256);
    t.string('from_location', 256);       // önceki konaklama (ilk kayıtta null)
    t.string('to_location', 256).notNullable();
    t.string('source', 32).notNullable(); // location-agent | snmp | manuel | qr
    t.string('first_seen_at', 64).notNullable();
    t.string('last_seen_at', 64).notNullable();
    t.index(['asset_id', 'first_seen_at']);
    t.index('to_location');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('asset_location_history');
  await knex.schema.dropTableIfExists('asset_expected_location');
};
