/* ═══ RAPOR YORUMU (LLM) ═════════════════════════════════════════════════════
   Rapordaki SAYILAR buraya girmez, buradan çıkmaz: rakamlar deterministik
   olarak hesaplanır ve belgeye öyle basılır. Model yalnızca hesaplanmış
   bulguları alır ve birkaç cümlelik yorum yazar.

   Neden bu kadar sıkı: imzalanıp müşteriye verilen bir belgede modelin
   uydurduğu tek bir rakam en pahalı yerde patlar. Bu yüzden çıktı üç kapıdan
   geçer (rakam denetimi, dil denetimi, uzunluk) ve herhangi biri takılırsa
   kural tabanlı metne düşülür. Yorumsuz rapor, yanlış yorumlu rapordan iyidir.

   Sohbet ajanı (claude-agent.js) BİLEREK kullanılmıyor: o araç çağırıyor,
   kendi kişiliği ve serbest biçimi var. Burada tek seferlik, araçsız ve
   dar kapsamlı bir tamamlama gerekiyor. */

// override YOK: gerçek ortam değişkenleri .env'i ezer (bkz. server.js)
require('dotenv').config();
const axios = require('axios');

const AI_PROVIDER = process.env.AI_PROVIDER || 'anthropic';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const ZAMAN_ASIMI_MS = Number(process.env.REPORT_AI_TIMEOUT_MS || 25000);

const YONERGE = `Sen bir IT varlık yönetimi raporunun "Yönetici Yorumu" bölümünü yazıyorsun.

Sana aşağıda SİSTEMİN HESAPLADIĞI bulgular verilecek. Görevin bu bulguları
yorumlamak: neyin öncelikli olduğunu ve neden önemli olduğunu açıklamak.

Kesin kurallar:
- Yalnızca Türkçe yaz. Teknik terimler (RAM, CPU, EOL, SSD) olduğu gibi kalabilir.
- EN FAZLA 4 cümle. Madde işareti, başlık, tablo KULLANMA. Düz paragraf yaz.
- Verilen bulgularda OLMAYAN hiçbir sayı yazma. Sayı uydurma, tahmin etme, yuvarlama yapma.
- Öneride bulunurken sistemin verdiği bulgulara dayan, yeni bir tespit uydurma.
- "[Tahmin]", "N/A", "veri yok" gibi yer tutucu yazma.
- Giriş cümlesi ("İşte yorumum" gibi) yazma, doğrudan yoruma başla.`;

/* Metindeki tüm sayıları çıkarır: "1.248" ve "12,5" gibi TR biçimleri dahil. */
function sayilariAyikla(metin) {
  return (String(metin).match(/\d+(?:[.,]\d+)*/g) || [])
    .map((s) => s.replace(/[.,]/g, ''))     // 1.248 → 1248, %12,5 → 125
    .filter(Boolean);
}

/* Bulgulardan izin verilen sayı kümesi. Model bunun dışında bir rakam
   yazarsa uydurmuş demektir. */
function izinliSayilar(bulgular) {
  const kume = new Set();
  const gez = (v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(gez);
    if (typeof v === 'object') return Object.values(v).forEach(gez);
    sayilariAyikla(String(v)).forEach((s) => kume.add(s));
  };
  gez(bulgular);
  return kume;
}

/* İngilizce yanıt yakalama — küçük modeller Türkçe yönergeye rağmen zaman
   zaman İngilizce dönüyor. */
const INGILIZCE_IPUCU = /\b(the|and|is|are|there|these|with|should|based on|following)\b/i;

/* İlk N tam cümle. Uzunluk için REDDETMİYORUZ: kırpmak bilgi uydurmaz,
   yalnızca fazlasını atar. (Model 4 cümle sınırını sık sık aşıyor; tek
   sebebi bu olan bir reddi yorumsuz rapora çevirmek gereksiz.) */
function cumleKirp(t, adet = 4) {
  const c = t.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!c || c.length <= adet) return t;
  return c.slice(0, adet).join('').trim();
}

function denetle(metin, bulgular) {
  let t = String(metin || '').trim();
  if (t.length < 40) return { ok: false, sebep: 'çok kısa' };
  t = cumleKirp(t);
  if (t.length > 1200) return { ok: false, sebep: 'çok uzun' };
  if (/\[(tahmin|bilinmiyor|model|n\/a)\]/i.test(t)) return { ok: false, sebep: 'yer tutucu' };
  if (INGILIZCE_IPUCU.test(t)) return { ok: false, sebep: 'Türkçe değil' };
  if (/^\s*[-*•#]/m.test(t)) return { ok: false, sebep: 'madde/başlık biçimi' };

  const izinli = izinliSayilar(bulgular);
  const uydurma = sayilariAyikla(t).filter((s) => !izinli.has(s));
  if (uydurma.length) return { ok: false, sebep: `bulgularda olmayan sayı: ${uydurma.join(', ')}` };

  return { ok: true, metin: t };
}

async function ollamaCagir(istem) {
  const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: OLLAMA_MODEL,
    stream: false,
    options: { temperature: 0.2, num_predict: 220 },
    messages: [
      { role: 'system', content: YONERGE },
      { role: 'user', content: istem },
    ],
  }, { timeout: ZAMAN_ASIMI_MS });
  return res.data?.message?.content || '';
}

async function anthropicCagir(istem) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 400,
    temperature: 0.2,
    system: YONERGE,
    messages: [{ role: 'user', content: istem }],
  }, { timeout: ZAMAN_ASIMI_MS });
  return (res.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

function istemKur(bulgular) {
  const satir = [];
  const ek = (etiket, deger) => { if (deger !== null && deger !== undefined && deger !== '') satir.push(`- ${etiket}: ${deger}`); };
  ek('Toplam varlık', bulgular.toplam);
  ek('Aktif (çevrimiçi) varlık', bulgular.aktif);
  ek('Kritik risk seviyesindeki cihaz', bulgular.kritik);
  ek('Yüksek risk seviyesindeki cihaz', bulgular.yuksek);
  ek('Ortalama risk puanı (100 üzerinden)', bulgular.ortalamaRisk);
  ek('Garantisi bitmiş cihaz', bulgular.garantiDisi);
  ek('Garantisi yaklaşan cihaz', bulgular.garantiYakin);
  ek('Desteği bitmiş (EOL) işletim sistemi olan cihaz', bulgular.eol);
  ek('8 GB altı RAM cihaz', bulgular.dusukRam);
  ek('Yetersiz diskli cihaz', bulgular.dusukDisk);
  ek('30 günden uzun süredir yeniden başlatılmamış cihaz', bulgular.uzunUptime);
  ek('Lokasyonu girilmemiş cihaz', bulgular.lokasyonsuz);
  /* Cihaz listesi modele VERİLMİYOR: yorum için gerekmiyor ve uzun istem
     gecikmeyi uçuruyor — 13 satırlık listede yanıt 111 saniye sürdü,
     kısaltınca 12 saniyeye indi. Sıfır olan bulgular zaten yazılmıyor. */
  return `Bulgular:\n${satir.join('\n')}\n\nBu bulguları yorumla.`;
}

/* Kural tabanlı yedek — model yoksa, yavaşsa veya denetimden geçemezse.
   Rapor HER ZAMAN bir yorumla çıkar; boş bölüm bırakılmaz. */
function kuralMetni(b) {
  const c = [];
  if (b.kritik) c.push(`${b.kritik} cihaz kritik risk seviyesinde ve öncelikli ele alınmalı`);
  else if (b.yuksek) c.push(`${b.yuksek} cihaz yüksek risk seviyesinde`);
  else c.push('Envanterde kritik risk seviyesinde cihaz bulunmuyor');
  if (b.garantiDisi) c.push(`${b.garantiDisi} cihazın garantisi bitmiş durumda`);
  if (b.eol) c.push(`${b.eol} cihazda desteği sona ermiş bir işletim sistemi çalışıyor`);
  if (b.dusukRam || b.dusukDisk) c.push(`donanım yükseltmesi gereken ${(b.dusukRam || 0) + (b.dusukDisk || 0)} cihaz var`);
  if (b.lokasyonsuz) c.push(`${b.lokasyonsuz} cihazın lokasyonu girilmemiş, envanter doğruluğu bu oranda belirsiz`);
  // Her parça kendi cümlesi: ilk harfleri büyütülür, yoksa "…var. donanım…"
  // gibi cümle ortasında başlayan satırlar çıkıyor.
  return c.map((x) => x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1)).join('. ') + '.';
}

/* Yorum üret. HER ZAMAN metin döner; kaynak alanı hangi yoldan geldiğini söyler.
   Sağlayıcı/model adı DÖNMEZ — müşteriye altyapı gösterilmiyor. */
async function raporYorumu(bulgular) {
  const yedek = { metin: kuralMetni(bulgular), kaynak: 'kural' };
  try {
    const istem = istemKur(bulgular);
    const ham = AI_PROVIDER === 'ollama' ? await ollamaCagir(istem) : await anthropicCagir(istem);
    const sonuc = denetle(ham, bulgular);
    if (!sonuc.ok) {
      console.warn('[rapor-ai] model çıktısı reddedildi:', sonuc.sebep);
      return { ...yedek, red_sebebi: sonuc.sebep };
    }
    return { metin: sonuc.metin, kaynak: 'model' };
  } catch (err) {
    console.warn('[rapor-ai] model çağrısı başarısız:', err.message);
    return { ...yedek, red_sebebi: 'model yanıt vermedi' };
  }
}

module.exports = { raporYorumu, denetle, izinliSayilar, kuralMetni };
