// ── Canlı Telemetri + Güvenlik Durumu ──────────────────────────────────────
// Envanter tablosu ANLIK durumu tutar (son IP, uptime, son görülme). Burada
// tutulan şey ZAMAN İÇİNDEKİ ölçüm: CPU/RAM/disk/ağ/pil/sıcaklık. Envanter
// sağlayıcı baserow|sql seçilebilir olduğu için ayrı SQL tablosunda
// (asset_details / asset_assignments ile aynı desen).
//
// NEDEN AYRI TABLO: ölçümler dakikada bir gelebilir, envanter satırı ise
// cihaz başına TEK satır. Aynı satırı sürekli ezmek grafik için gereken
// geçmişi yok ederdi.
exports.up = async function (knex) {
  await knex.schema.createTable('asset_telemetry', (t) => {
    t.increments('id').primary();
    t.integer('asset_id').notNullable();
    t.string('measured_at', 64).notNullable();   // ISO 8601
    t.decimal('cpu_pct', 5, 2);                  // 0-100
    t.decimal('ram_used_gb', 8, 2);
    t.decimal('ram_total_gb', 8, 2);
    t.decimal('disk_used_gb', 10, 2);
    t.decimal('disk_total_gb', 10, 2);
    t.decimal('net_rx_mbps', 10, 2);
    t.decimal('net_tx_mbps', 10, 2);
    t.decimal('battery_pct', 5, 2);              // pil yoksa NULL (masaüstü/sunucu)
    t.string('battery_state', 24);               // sarj_oluyor | pilde | dolu
    t.decimal('temp_c', 5, 1);                   // okunamıyorsa NULL — bkz collector notu
    t.index(['asset_id', 'measured_at']);
  });

  // Güvenlik durumu ZAMAN SERİSİ DEĞİL: yalnız en son bilinen durum tutulur.
  // Grafiği çizilmiyor, "şu an açık mı" sorusuna cevap veriyor.
  await knex.schema.createTable('asset_security', (t) => {
    t.integer('asset_id').primary();
    t.string('checked_at', 64).notNullable();
    t.string('defender', 24);            // aktif | pasif | yok
    t.string('firewall', 24);
    t.string('disk_encryption', 24);     // BitLocker/FileVault — platformdan bağımsız ad
    t.string('antivirus', 24);
    t.string('antivirus_name', 96);
    t.string('os_update', 24);           // guncel | bekliyor | bilinmiyor
    t.integer('critical_patches');
    t.integer('pending_updates');
  });

  // Varlık kodu (MBP-2024-091 gibi insan-okur envanter kodu). Seri numarasından
  // AYRI: seri üreticiden gelir, varlık kodu kurumun kendi numaralandırması.
  await knex.schema.alterTable('asset_details', (t) => {
    t.string('asset_code', 64);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('asset_details', (t) => t.dropColumn('asset_code'));
  await knex.schema.dropTableIfExists('asset_security');
  await knex.schema.dropTableIfExists('asset_telemetry');
};
