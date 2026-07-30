// ── Klon cihaz tespiti ──────────────────────────────────────────────────────
// Cihaz kimliği artık SMBIOS UUID üzerinden üretiliyor, ama bazı anakart
// üreticileri tüm partiye aynı UUID'yi yazıyor ve sanal makineler bozuk değer
// dönebiliyor. Bu durumda iki AYRI makine aynı kimliği paylaşır.
//
// Yakalama yolu: kayıtlı bir kimlikten GELEN SERİ NUMARASI değişirse, ya cihaz
// gerçekten değişmiştir (anakart değişimi) ya da iki makine aynı kimliği
// kullanıyordur. İkisi de yöneticinin görmesi gereken bir durum — sessiz
// geçilirse envanterde iki makine tek kayda çakışır.
exports.up = async function (knex) {
  await knex.schema.alterTable('agent_enrollments', (t) => {
    t.string('serial_number', 190);   // kimlikle eşleşen son seri
    t.integer('clone_suspect').notNullable().defaultTo(0);
    t.string('clone_note', 300);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('agent_enrollments', (t) => {
    t.dropColumn('serial_number'); t.dropColumn('clone_suspect'); t.dropColumn('clone_note');
  });
};
