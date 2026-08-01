// ── Toplu Kayıt Onay Jetonları (TV/kiosk) ──────────────────────────────────
// TV ve kiosk ekranlarında klavye yok. Operatör kategoriyi/adedi ekranda
// ayarlar, QR'ı telefonuyla okutup ONAYLAR; kayıtlar o anda oluşur.
//
// PLAN JETONA DONDURULUR. Kategori, adet, lokasyon ve önek burada saklanır;
// onay isteği bunları GÖNDERMEZ. Telefon yalnızca "evet" diyebilir — ne
// oluşacağını değiştiremez. Aksi halde QR'ı ele geçiren biri 200 kayıt
// açtırabilirdi.
exports.up = async function (knex) {
  await knex.schema.createTable('bulk_tokens', (t) => {
    t.string('jti', 64).primary();
    t.string('created_at', 64).notNullable();
    t.string('created_by', 128);
    t.string('expires_at', 64).notNullable();
    // Dondurulmuş plan
    t.string('category', 64).notNullable();
    t.integer('quantity').notNullable();
    t.string('location', 190);
    t.string('prefix', 64);
    // Sonuç
    t.string('used_at', 64);
    t.string('used_ip', 64);
    t.integer('result_count');
    t.string('first_id', 190);
    t.string('last_id', 190);
    t.integer('revoked').notNullable().defaultTo(0);
    t.index(['expires_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('bulk_tokens');
};
