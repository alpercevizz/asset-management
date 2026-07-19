// ── Lisans Sağlayıcı Dispatcher ──────────────────────────────────────────────
// INVENTORY_PROVIDER=baserow (varsayılan) | sql. Dosya adı geriye dönük uyumluluk için kaldı.
const provider = (process.env.INVENTORY_PROVIDER || 'baserow').toLowerCase();
module.exports = provider === 'sql' ? require('./licenses-sql') : require('./licenses-baserow');
