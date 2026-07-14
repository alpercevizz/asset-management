// ── Runtime Ayar Deposu (Settings) ──────────────────────────────────────────
// Bölüm bazlı JSON değerler (thresholds, notify, appearance...). Modüller bu
// depodan okur → eşikler/config UI'dan değişince RESTART GEREKMEZ. Sırlar burada TUTULMAZ
// (.env'de kalır; UI yalnız salt-okunur durum gösterir).
exports.up = async function (knex) {
  await knex.schema.createTable('settings', (t) => {
    t.string('key', 64).primary();       // bölüm adı: 'thresholds' | 'notify' | 'appearance'
    t.text('value').notNullable();        // JSON
    t.string('updated_at', 64).notNullable();
    t.string('updated_by', 128);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('settings');
};
