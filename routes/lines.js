/* ═══ HAT / SIM ROUTER ═══════════════════════════════════════════════════════
   server.js 1700 satıra ulaşmıştı ve route tanımı, iş mantığı, kimlik
   denetimi iç içeydi. Alan başına router: server.js yalnızca "kim nereye
   bağlanıyor"u bilir, bu dosya hatlarla ilgili HTTP kabuğunu bilir.

   Bağımlılıklar FABRİKA ile enjekte edilir (rota, requireRole, currentUser).
   server.js'i require etmek döngüsel bağımlılık olurdu; bu yön tek taraflı:
   server.js → routes/*, asla tersi.

   Hat = ayrı varlık (telefon değiştirebilir). "Hangi hat hangi telefonda" +
   geçmiş. */

const express = require('express');
const lineTools = require('../agent/tools/line-tools');

module.exports = function hatRouter({ rota, requireRole, currentUser }) {
  const r = express.Router();

  /* Yazma uçları 400 döner, 500 değil: gövde doğrulaması başarısızsa bu
     istemcinin hatasıdır. Sunucu hatasıyla karıştırmak, izlemede gerçek
     arızaları gürültüye boğar. */
  const yazma = (mesaj, isleyici) => async (req, res) => {
    try {
      await isleyici(req, res, currentUser(req)?.username || 'system');
    } catch (err) {
      console.error(`[${req.method} ${req.baseUrl}${req.path}]`, err.message);
      if (res.headersSent) return;
      res.status(400).json({ error: mesaj, detail: err.message });
    }
  };

  const itVeAdmin = requireRole('it', 'admin');

  r.get('/', rota('Hatlar alınamadı', async (req, res) => {
    const [lines, summary] = await Promise.all([lineTools.listLines(), lineTools.summary()]);
    res.json({ summary, lines });
  }));

  r.get('/for-asset/:assetId', rota('Hat sorgulanamadı', async (req, res) => {
    res.json({ line: await lineTools.getLineForAsset(Number(req.params.assetId)) });
  }));

  r.get('/:id/history', rota('Hat geçmişi alınamadı', async (req, res) => {
    res.json({ history: await lineTools.getLineHistory(Number(req.params.id)) });
  }));

  r.post('/', itVeAdmin, yazma('Hat kaydedilemedi', async (req, res, actor) => {
    const sonuc = await lineTools.upsertLine({ ...(req.body || {}), actor });
    res.json({ success: true, ...sonuc });
  }));

  r.post('/import', itVeAdmin, yazma('İçe aktarma hatası', async (req, res, actor) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'İçe aktarılacak satır yok' });
    res.json({ success: true, ...(await lineTools.importLines(rows, actor)) });
  }));

  r.post('/:id/assign', itVeAdmin, yazma('Hat atanamadı', async (req, res, actor) => {
    const line = await lineTools.assignLine(Number(req.params.id), { ...(req.body || {}), actor });
    res.json({ success: true, line });
  }));

  r.post('/:id/release', itVeAdmin, yazma('Hat iade edilemedi', async (req, res, actor) => {
    const line = await lineTools.releaseLine(Number(req.params.id), { ...(req.body || {}), actor });
    res.json({ success: true, line });
  }));

  return r;
};
