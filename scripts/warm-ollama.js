/* ═══ OLLAMA ISITMA ═══════════════════════════════════════════════════════════
   Ollama modelini RAM'e önceden yükler. Az RAM'li VPS'te soğuk (ilk) çağrı
   modeli yüklerken zaman aşımını zorluyor; bu betik container açılışında ARKA
   PLANDA çalışıp modeli yükler, keep_alive ile yüklü tutar. Böylece demoyu ilk
   açan ziyaretçi bile gerçek AI yorumunu görür, kural tabanlıya düşmez.

   Sunucuyu BLOKLAMAZ (arka planda), hata olsa bile sessiz geçer: ısıtma
   başarısız olsa demo yine çalışır, yalnızca ilk yorum yavaş/kural olur. */
require('dotenv').config();
const axios = require('axios');

const URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

(async () => {
  const t0 = Date.now();
  try {
    await axios.post(`${URL}/api/chat`, {
      model: MODEL,
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      options: { num_predict: 1 },           // tek jeton yeter: amaç modeli yüklemek
      messages: [{ role: 'user', content: 'merhaba' }],
    }, { timeout: 180000 });
    console.log(`[warm] Ollama modeli yüklendi (${MODEL}) — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.warn('[warm] ısıtma atlandı:', e.message);
  }
})();
