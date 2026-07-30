// ── QR Kayıt Jetonları ──────────────────────────────────────────────────────
// /api/register telefondan çağrıldığı için imzalı istek atamaz (insan tarayıcı
// kullanıyor). Bunun yerine QR'ın içine YÖNETİCİNİN ürettiği imzalı + süreli
// bir jeton gömülür. İmza sahteciliği engeller; bu tablo da KULLANIM SAYISINI
// tutar — imza tek başına yetmez, aynı QR sonsuz kez kullanılabilirdi.
exports.up = async function (knex) {
  await knex.schema.createTable('register_tokens', (t) => {
    t.string('jti', 64).primary();          // jeton kimliği (imzanın içinde de var)
    t.string('created_at', 64).notNullable();
    t.string('created_by', 128);            // jetonu üreten kullanıcı — iz sürülebilsin
    t.string('expires_at', 64).notNullable();
    t.integer('max_uses').notNullable().defaultTo(1);
    t.integer('uses').notNullable().defaultTo(0);
    t.string('last_used_at', 64);
    t.integer('revoked').notNullable().defaultTo(0);
    t.index(['expires_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('register_tokens');
};
