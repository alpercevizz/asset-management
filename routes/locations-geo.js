/* ═══ LOKASYON KOORDİNATLARI ROUTER ══════════════════════════════════════════
   Haritadaki balonların koordinatları. DIŞ GEOCODING SERVİSİ YOK — kapalı
   devre kurulumda internete çıkmak zaten mümkün değil; koordinatlar ya elle
   girilir ya da il adı eşleşmesinden tohumlanır.

   Elle girilen koordinatlar tohumlama sırasında EZİLMEZ (seedGeoFromNames):
   kullanıcının düzelttiği bir konumu otomatik tahminle geri almak, düzeltmeyi
   anlamsız kılardı.

   Bağımlılıklar fabrika ile enjekte edilir (bkz. routes/lines.js). */

const express = require('express');
const locationTools = require('../agent/tools/location-tools');

module.exports = function lokasyonGeoRouter({ requireRole, currentUser, getAllAssets }) {
  const r = express.Router();
  const itVeAdmin = requireRole('it', 'admin');

  /* Envanterde geçen benzersiz lokasyon adları — koordinatı olmayanları
     bulmak için hem burada hem tohumlamada gerekiyor. */
  async function envanterLokasyonlari() {
    const inv = await getAllAssets({ size: 200 });
    return [...new Set((inv.results || []).map((a) => (a.location || '').trim()).filter(Boolean))];
  }

  const yazma = (mesaj, isleyici) => async (req, res) => {
    try {
      await isleyici(req, res, currentUser(req));
    } catch (err) {
      console.error(`[${req.method} ${req.baseUrl}${req.path}]`, err.message);
      if (res.headersSent) return;
      res.status(400).json({ error: mesaj, detail: err.message });
    }
  };

  r.get('/geo', async (req, res) => {
    try {
      const [geo, adlar] = await Promise.all([locationTools.getAllGeo(), envanterLokasyonlari()]);
      // missing: haritada gösterilemeyecek lokasyonlar — kullanıcı bunları görüp doldurur
      res.json({ geo, locations: adlar, missing: adlar.filter((a) => !geo[a]) });
    } catch (err) {
      console.error('[GET /api/locations/geo]', err.message);
      res.status(500).json({ error: 'Koordinatlar alınamadı', detail: err.message });
    }
  });

  r.put('/geo', itVeAdmin, yazma('Koordinat kaydedilemedi', async (req, res, ben) => {
    const { location, lat, lon, label } = req.body || {};
    const row = await locationTools.setGeo(location, { lat, lon, label, by: ben ? ben.username : 'system' });
    res.json({ success: true, geo: row });
  }));

  r.delete('/geo/:location', itVeAdmin, yazma('Silinemedi', async (req, res) => {
    await locationTools.deleteGeo(req.params.location);
    res.json({ success: true });
  }));

  r.post('/geo/seed', itVeAdmin, async (req, res) => {
    try {
      res.json(await locationTools.seedGeoFromNames(await envanterLokasyonlari()));
    } catch (err) {
      console.error('[POST /api/locations/geo/seed]', err.message);
      res.status(500).json({ error: 'Tohumlama başarısız', detail: err.message });
    }
  });

  return r;
};
