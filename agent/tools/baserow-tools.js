// ── Envanter Sağlayıcı Dispatcher ────────────────────────────────────────────
// INVENTORY_PROVIDER=baserow (varsayılan) | sql. Aynı fonksiyon setini (getAllAssets,
// searchAssets, getAssetBySerial, createAsset, updateAsset, getStats) dışa verir.
// Dosya adı geriye dönük uyumluluk için 'baserow-tools' kaldı (6 modül bunu import ediyor).
const provider = (process.env.INVENTORY_PROVIDER || 'baserow').toLowerCase();
module.exports = provider === 'sql' ? require('./inventory-sql') : require('./inventory-baserow');
