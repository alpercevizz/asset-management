/* AssetMan · reports.js
   Raporlar katalogu ve A4 belge uretimi

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ═══ RAPORLAR ══════════════════════════════════════════════════════════════
   Katalog (sol) + A4 belge önizlemesi (sağ). Rapor içeriği DETERMİNİSTİK
   üretilir: sayılar mevcut uçlardan gelir, LLM'e yazdırılmaz. Küçük modele
   rapor yazdırmak bozuk Türkçe ve uydurma sayı üretiyordu (bkz. anomaly
   tespitinde alınan aynı karar).

   VERİ DÜRÜSTLÜĞÜ: "geçen aya göre %" yalnız gerçek anlık görüntü varsa
   yazılır (/api/trends → snapshot tablosu). Yoksa satır hiç çıkmaz; uydurma
   bir trend raporu imzalayan kişiyi yanıltır. Riskli varlık ve garanti için
   geçmiş tutulmuyor → onlarda karşılaştırma gösterilmez. */

const RP_KATEGORILER = [
  ['hepsi', 'Tümü'], ['envanter', 'Envanter'], ['donanim', 'Donanım'],
  ['guvenlik', 'Güvenlik'], ['operasyon', 'Operasyon'], ['finans', 'Finans'], ['ai', 'AI Analiz'],
];

const RP_IKON = {
  izgara: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  nabiz: '<polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>',
  kalkan: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  kilit: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  belge: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
};

/* sayfa: veriye göre gerçek sayfa sayısı hesaplanır (kartta "yaklaşık" yazar
   ama tahmin gerçek üreticiyle aynı formülü kullanır, uydurma sabit değil). */
const RP_RAPORLAR = [
  {
    id: 'genel', ad: 'Genel Envanter Raporu', aciklama: 'AI destekli tam envanter analizi',
    kat: ['envanter', 'ai'], ikon: 'izgara', ai: true, renk: 'accent',
    ozellikler: [['Marka dağılımı', 'Shadow IT'], ['Kategori dağılımı', 'Garanti durumu'],
      ['Lokasyon özeti', 'Risk puanı'], ['Donanım analizi', 'AI önerileri']],
    ciftSutun: true,
  },
  {
    id: 'donanim', ad: 'Donanım Analizi Raporu', aciklama: 'Donanım performans ve kapasite analizi',
    kat: ['donanim'], ikon: 'nabiz', ai: true, renk: 'blue',
    ozellikler: ['RAM, CPU, Disk kullanımı', 'Performans karşılaştırmaları', 'Yaşam döngüsü analizi', 'Yükseltme önerileri'],
  },
  {
    id: 'shadow', ad: 'Shadow IT Raporu', aciklama: 'Ağda tespit edilen bilinmeyen cihazlar',
    kat: ['guvenlik'], ikon: 'kalkan', ai: true, renk: 'teal',
    ozellikler: ['Shadow IT taraması', 'Ağ güvenliği analizi', 'Riskli cihaz listesi', 'İyileştirme önerileri'],
  },
  {
    id: 'eol', ad: 'Güvenlik & EOL Raporu', aciklama: 'Güvenlik açıkları ve EOL cihaz analizi',
    kat: ['guvenlik'], ikon: 'kilit', ai: true, renk: 'purple',
    ozellikler: ['EOL işletim sistemleri', 'Güvenlik açıkları', 'Şifreleme durumu', 'Uyum ihlalleri'],
  },
  {
    id: 'garanti', ad: 'Garanti & Lisans Raporu', aciklama: 'Garanti bitişleri ve lisans uyumluluğu',
    kat: ['finans'], ikon: 'belge', ai: true, renk: 'green',
    ozellikler: ['Garanti bitiş takvimi', 'Lisans uyumluluğu', 'Yenileme bütçesi', 'Maliyet öngörüsü'],
  },
  {
    id: 'lokasyon', ad: 'Lokasyon Analizi Raporu', aciklama: 'Lokasyon bazlı varlık dağılımı',
    kat: ['operasyon'], ikon: 'pin', ai: true, renk: 'orange',
    ozellikler: ['Lokasyon dağılımı', 'Beklenen-görülen sapma', 'Zimmet durumu', 'Taşıma önerileri'],
  },
];

let _rpKat = 'hepsi';
let _rpVeri = null;          // toplanan veri paketi
let _rpSayfalar = [];        // üretilen sayfaların HTML'i
let _rpSayfa = 1;
let _rpYakinlik = 100;
let _rpAktifRapor = null;

/* ── Veri toplama ──────────────────────────────────────────────────────────
   Uçların hepsi paralel çekilir; biri düşerse rapor tamamen çökmesin diye
   her biri kendi hatasını yutup null döner (rapor o bölümü "veri yok" yazar). */
async function rpVeriTopla() {
  const al = async (yol) => {
    try {
      const r = await fetch(yol);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
  const [stats, assets, trends, risk, anomali, eol, garanti, lisans, shadow, lokasyon, tahmin] = await Promise.all([
    al('/api/stats'), al('/api/assets'), al('/api/trends?days=30'), al('/api/risk-scores'),
    al('/api/anomalies'), al('/api/eol-os'), al('/api/warranty'), al('/api/licenses/compliance'),
    al('/api/shadow-it'), al('/api/location-summary'), al('/api/forecast'),
  ]);
  _rpVeri = { stats, assets, trends, risk, anomali, eol, garanti, lisans, shadow, lokasyon, tahmin, zaman: new Date() };
  return _rpVeri;
}

/* ── Küçük yardımcılar ── */
const rpSayi = (n) => Number(n || 0).toLocaleString('tr-TR');
const rpListe = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]);
function rpVarliklar() { return _rpVeri?.assets?.results || []; }

/* Trend satırı — yalnız gerçek veri varsa. null ise satır HİÇ çizilmez. */
function rpTrend(t) {
  if (!t || typeof t.pct !== 'number') return '';
  const yon = t.dir === 'down' ? 'dus' : t.dir === 'up' ? 'yuks' : 'duz';
  const ok = t.dir === 'down' ? '↓' : t.dir === 'up' ? '↑' : '→';
  return `<div class="rd-k-trend ${yon}">%${Math.abs(t.pct)} ${ok}<span>Geçen aya göre</span></div>`;
}

/* Kapak görseli — dekoratif izometrik pano çizimi (harici dosya yok). */
const RD_GORSEL = `
<svg class="rd-gorsel" viewBox="0 0 210 120" aria-hidden="true">
  <defs>
    <linearGradient id="rdG1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
    <linearGradient id="rdG2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c7d2fe"/><stop offset="1" stop-color="#a5b4fc"/>
    </linearGradient>
  </defs>
  <rect x="52" y="10" width="120" height="76" rx="7" fill="url(#rdG1)"/>
  <rect x="62" y="22" width="46" height="6" rx="3" fill="#ffffff" opacity=".85"/>
  <rect x="62" y="34" width="30" height="5" rx="2.5" fill="#ffffff" opacity=".5"/>
  <g opacity=".95">
    <rect x="62" y="52" width="12" height="24" rx="2.5" fill="#ffffff" opacity=".75"/>
    <rect x="79" y="44" width="12" height="32" rx="2.5" fill="#ffffff" opacity=".9"/>
    <rect x="96" y="58" width="12" height="18" rx="2.5" fill="#ffffff" opacity=".6"/>
  </g>
  <circle cx="140" cy="52" r="21" fill="none" stroke="#ffffff" stroke-width="8" opacity=".35"/>
  <path d="M140 31a21 21 0 0 1 19 30l-19-9z" fill="#ffffff" opacity=".9"/>
  <rect x="96" y="86" width="76" height="9" rx="4.5" fill="url(#rdG2)"/>
  <path d="M20 96h34l10-14H30z" fill="url(#rdG2)" opacity=".8"/>
  <circle cx="34" cy="30" r="9" fill="#a5b4fc" opacity=".55"/>
  <rect x="176" y="26" width="14" height="14" rx="3" fill="#a5b4fc" opacity=".55"/>
</svg>`;

const RD_A4_YUKSEK = 1123;   // 96 dpi'de A4 boyu (px)

const RP_RENKLER = ['#4f46e5', '#22c55e', '#f59e0b', '#06b6d4', '#a855f7', '#ef4444', '#64748b'];

/* Donut — harici kütüphane yok, tek SVG dizesi döner. */
function rpDonut(girdiler, boyut = 92) {
  const toplam = girdiler.reduce((a, [, n]) => a + n, 0);
  const R = 34, C = 2 * Math.PI * R;
  if (!toplam) {
    return `<svg class="rd-donut" viewBox="0 0 92 92" width="${boyut}" height="${boyut}">
      <circle cx="46" cy="46" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="15"/></svg>`;
  }
  let ofs = 0;
  const dilimler = girdiler.map(([, n], i) => {
    const uz = (n / toplam) * C;
    const s = `<circle cx="46" cy="46" r="${R}" fill="none" stroke="${RP_RENKLER[i % RP_RENKLER.length]}"
      stroke-width="15" stroke-dasharray="${Math.max(0, uz - 1)} ${C - uz + 1}" stroke-dashoffset="${-ofs}"/>`;
    ofs += uz;
    return s;
  }).join('');
  return `<svg class="rd-donut" viewBox="0 0 92 92" width="${boyut}" height="${boyut}">
    <g transform="rotate(-90 46 46)">${dilimler}</g></svg>`;
}

function rpEfsane(girdiler) {
  const toplam = girdiler.reduce((a, [, n]) => a + n, 0) || 1;
  return `<div class="rd-efsane">${girdiler.map(([ad, n], i) => `
    <div><span class="rd-nokta" style="background:${RP_RENKLER[i % RP_RENKLER.length]}"></span>
      <span class="rd-e-ad">${escapeHtml(ad)}</span>
      <b>%${Math.round((n / toplam) * 100)}</b></div>`).join('')}</div>`;
}

/* İlk N + kalanı "Diğer" — 12 dilimlik donut okunmuyor. */
function rpIlkN(girdiler, n = 4) {
  if (girdiler.length <= n + 1) return girdiler;
  const ilk = girdiler.slice(0, n);
  const kalan = girdiler.slice(n).reduce((a, [, v]) => a + v, 0);
  return kalan ? [...ilk, ['Diğer', kalan]] : ilk;
}

function rpCubuklar(girdiler) {
  const enb = Math.max(1, ...girdiler.map(([, n]) => n));
  return `<div class="rd-cubuk-liste">${girdiler.map(([ad, n]) => `
    <div class="rd-cubuk-satir">
      <span class="rd-c-ad" title="${escapeHtml(ad)}">${escapeHtml(ad)}</span>
      <span class="rd-c-yol"><i style="width:${Math.round((n / enb) * 100)}%"></i></span>
      <b>${rpSayi(n)}</b>
    </div>`).join('')}</div>`;
}

/* Risk göstergesi — yarım halka. */
function rpGosterge(puan) {
  const p = Math.max(0, Math.min(100, Math.round(puan || 0)));
  const R = 46, C = 2 * Math.PI * R;
  const renk = p >= 70 ? '#ef4444' : p >= 45 ? '#f59e0b' : p >= 20 ? '#eab308' : '#22c55e';
  const etiket = p >= 70 ? 'Kritik' : p >= 45 ? 'Yüksek Risk' : p >= 20 ? 'Orta Risk' : 'Düşük Risk';
  return `<div class="rd-gosterge">
    <div class="rd-g-sol"><b>${p}</b><span>/ 100</span><i style="color:${renk}">${etiket}</i></div>
    <svg viewBox="0 0 110 110" width="86" height="86">
      <g transform="rotate(-90 55 55)">
        <circle cx="55" cy="55" r="${R}" fill="none" stroke="#e2e8f0" stroke-width="11"/>
        <circle cx="55" cy="55" r="${R}" fill="none" stroke="${renk}" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${(p / 100) * C} ${C}"/>
      </g>
    </svg>
  </div>`;
}

/* ── Bölüm parçaları ─────────────────────────────────────────────────────── */
function rpKapak(rapor) {
  const v = _rpVeri, s = v.stats || {};
  const varliklar = rpVarliklar();
  const lokSayi = new Set(varliklar.map((a) => (a.location || '').trim()).filter(Boolean)).size;
  const kulSayi = new Set(varliklar.map((a) => (a.username || '').trim()).filter(Boolean)).size;
  const tarih = v.zaman.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' })
    + ' ' + v.zaman.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `
  <div class="rd-kapak">
    <div class="rd-marka">
      <span class="rd-logo"><svg viewBox="0 0 64 64" width="30" height="30" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="rdLogoG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/>
          </linearGradient>
        </defs>
        <path d="M32 7 L57 54 H49.5 L32 21 L14.5 54 H7 Z" fill="url(#rdLogoG)"/>
      </svg></span>
      <div><b>AssetMan</b><span>IT Asset Intelligence Report</span></div>
    </div>
    <div class="rd-tarih"><span>Oluşturulma Tarihi</span><b>${escapeHtml(tarih)}</b></div>
  </div>
  <div class="rd-baslik-satir">
    <h1 class="rd-baslik">${escapeHtml(rapor.ad.toLocaleUpperCase('tr-TR'))}</h1>
    ${RD_GORSEL}
  </div>
  <div class="rd-cipler">
    <div class="rd-cip"><span class="rd-cip-i">▤</span><b>${rpSayi(s.total)}</b><span>Toplam Varlık</span></div>
    <div class="rd-cip"><span class="rd-cip-i">◎</span><b>${rpSayi(lokSayi)}</b><span>Lokasyon</span></div>
    <div class="rd-cip"><span class="rd-cip-i">◍</span><b>${rpSayi(kulSayi)}</b><span>Kullanıcı</span></div>
    <div class="rd-cip rd-cip--ok"><span class="rd-cip-i">✓</span><b>Analiz</b><span>Tamamlandı</span></div>
  </div>`;
}

function rpYoneticiOzeti() {
  const v = _rpVeri, s = v.stats || {}, t = v.trends?.trends || {};
  const aktif = s.by_status?.online || 0;
  const riskli = (v.risk?.distribution?.critical || 0) + (v.risk?.distribution?.high || 0);
  const garantiBiten = v.garanti?.expiring_soon?.count || 0;
  const kart = (etiket, deger, trend, sinif) => `
    <div class="rd-kpi ${sinif || ''}">
      <span class="rd-k-et">${etiket}</span>
      <b class="rd-k-deger">${deger}</b>
      ${trend || '<div class="rd-k-trend duz">geçmiş veri yok</div>'}
    </div>`;
  return `
  <h2 class="rd-h2">YÖNETİCİ ÖZETİ</h2>
  <div class="rd-kpiler">
    ${kart('Toplam Varlık', rpSayi(s.total), rpTrend(t.total))}
    ${kart('Aktif Varlık', rpSayi(aktif), rpTrend(t.online))}
    ${kart('Riskli Varlık', rpSayi(riskli), '', 'rd-kpi--uyari')}
    ${kart('Garanti Bitiyor', rpSayi(garantiBiten), '', 'rd-kpi--uyari')}
  </div>`;
}

function rpVarlikDagilimi() {
  const v = _rpVeri, s = v.stats || {};
  const varliklar = rpVarliklar();
  const kat = rpIlkN(rpListe(s.by_category));
  const marka = rpIlkN(rpListe(s.by_brand));
  const lok = rpListe(varliklar.reduce((a, x) => {
    const l = (x.location || '').trim(); if (l) a[l] = (a[l] || 0) + 1; return a;
  }, {})).slice(0, 5);

  // Yaşam döngüsü: cihaz yaşı yalnız garanti başlangıcı/kaydı bilinenlerde
  // hesaplanabilir. Bilinmeyenler AYRI kovada — 0 yıl varsaymak yaşı olduğundan
  // küçük gösterirdi.
  const simdi = Date.now();
  const yas = { '0-2 yıl': 0, '3-5 yıl': 0, '5+ yıl': 0, 'bilinmiyor': 0 };
  for (const a of varliklar) {
    const ham = a.created_on || a.warranty_expiry;
    const d = ham ? new Date(ham) : null;
    if (!d || isNaN(d)) { yas.bilinmiyor++; continue; }
    const y = (simdi - d.getTime()) / (365.25 * 86400000);
    if (y < 2) yas['0-2 yıl']++; else if (y < 5) yas['3-5 yıl']++; else yas['5+ yıl']++;
  }
  const yasGirdi = Object.entries(yas).filter(([, n]) => n > 0);

  return `
  <h2 class="rd-h2">VARLIK DAĞILIMI</h2>
  <div class="rd-dagilim">
    <div class="rd-kutu"><h4>Kategori Dağılımı</h4>${rpDonut(kat)}${rpEfsane(kat)}</div>
    <div class="rd-kutu"><h4>Marka Dağılımı</h4>${rpDonut(marka)}${rpEfsane(marka)}</div>
    <div class="rd-kutu"><h4>Lokasyon Dağılımı</h4>${lok.length ? rpCubuklar(lok) : '<p class="rd-bos">Lokasyon bilgisi girilmemiş</p>'}</div>
    <div class="rd-kutu"><h4>Yaşam Döngüsü</h4>${rpDonut(yasGirdi)}${rpEfsane(yasGirdi)}</div>
  </div>`;
}

/* Problemler ve öneriler TESPİTLERDEN türetilir; metinler sabit şablon,
   sayılar gerçek. Sıfır olan satır hiç yazılmaz (boş uyarı gürültüdür). */
function rpAnalizVeOneriler() {
  const v = _rpVeri;
  const an = v.anomali || {}, eol = v.eol || {}, gar = v.garanti || {};
  const dusukRam = an.low_ram?.count || 0;
  const dusukDisk = an.low_disk?.count || 0;
  const uzunUptime = an.long_uptime?.count || 0;
  const eolSayi = eol.eol?.count || 0;
  const garantiDisi = gar.expired?.count || 0;
  const garantiYakin = gar.expiring_soon?.count || 0;
  const sapma = (v.lokasyon?.severity?.kritik || 0) + (v.lokasyon?.severity?.uyari || 0);
  const ortRisk = v.risk?.average_score ?? 0;

  const problemler = [
    ['Garanti dışı cihazlar', garantiDisi, 'kirmizi'],
    ['EOL işletim sistemleri', eolSayi, 'turuncu'],
    ['Lokasyon dışında cihazlar', sapma, 'mavi'],
    ['Uzun süredir açık cihazlar', uzunUptime, 'sari'],
  ].filter(([, n]) => n > 0);

  const oneriler = [
    [dusukRam, `RAM yükseltmesi gereken ${dusukRam} cihaz var`],
    [dusukDisk, `Disk kapasitesi yetersiz ${dusukDisk} cihaz var`],
    [eolSayi, `İşletim sistemi yükseltmesi gereken ${eolSayi} cihaz var`],
    [garantiYakin, `Garantisi yakında bitecek ${garantiYakin} cihaz var`],
  ].filter(([n]) => n > 0).map(([, m]) => m);

  return `
  <h2 class="rd-h2">AI ANALİZİ &amp; ÖNERİLER</h2>
  ${rpYorumKutusu()}
  <div class="rd-analiz">
    <div class="rd-kutu"><h4>Genel Risk Puanı</h4>${rpGosterge(ortRisk)}</div>
    <div class="rd-kutu"><h4>Tespit Edilen Problemler</h4>
      ${problemler.length ? `<ul class="rd-problem">${problemler.map(([ad, n, r]) =>
    `<li><i class="rd-p-${r}"></i>${escapeHtml(ad)}<b>${rpSayi(n)}</b></li>`).join('')}</ul>`
    : '<p class="rd-bos">Tespit edilen problem yok.</p>'}
    </div>
    <div class="rd-kutu"><h4>AI Önerileri</h4>
      ${oneriler.length ? `<ul class="rd-oneri">${oneriler.map((m) =>
    `<li><i></i>${escapeHtml(m)}</li>`).join('')}</ul>`
    : '<p class="rd-bos">Şu an bir işlem önerilmiyor.</p>'}
    </div>
  </div>`;
}

/* ── Yönetici Yorumu (LLM) ──────────────────────────────────────────────────
   Belgeye önce "hazırlanıyor" kutusu basılır, yorum sonra doldurulur: model
   çağrısı saniyeler sürebiliyor ve raporun geri kalanının onu beklemesi için
   bir sebep yok. Sayılar bu kutuya GİRMEZ; onlar zaten üstteki bölümlerde. */
function rpYorumKutusu() {
  return `
  <div class="rd-yorum" id="rdYorum">
    <h4>Yönetici Yorumu</h4>
    <p class="rd-yorum-metin">Yorum hazırlanıyor…</p>
  </div>`;
}

async function rpYorumuGetir() {
  const kutu = document.getElementById('rdYorum');
  if (!kutu) return;
  try {
    const r = await fetch('/api/reports/ai-comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    kutu.querySelector('.rd-yorum-metin').textContent = j.metin || '';
    /* Yorumu modelin mi yoksa kural motorunun mu yazdığı SÖYLENİR; okuyan
       kişinin bunu bilmeye hakkı var. Sağlayıcı/model adı gösterilmez. */
    if (j.kaynak !== 'model') {
      const not = document.createElement('span');
      not.className = 'rd-yorum-not';
      not.textContent = 'Kural tabanlı özet';
      kutu.appendChild(not);
    }
  } catch {
    kutu.querySelector('.rd-yorum-metin').textContent =
      'Yorum üretilemedi. Rapordaki bulgular ve sayılar bu durumdan etkilenmez.';
  }
}

/* ── Risk analizi bölümü ────────────────────────────────────────────────────
   Tek bir ortalama puan "hangi cihaz ve neden" sorusunu yanıtlamıyordu.
   Dağılım + en riskli cihazlar + puanı yükselten faktörler eklendi; hepsi
   risk motorunun kendi çıktısı. */
function rpRiskAnalizi() {
  const r = _rpVeri.risk;
  if (!r) return '<h2 class="rd-h2">RİSK ANALİZİ</h2><p class="rd-bos">Risk verisi alınamadı.</p>';
  const d = r.distribution || {};
  const seviyeler = [
    ['Kritik', d.critical || 0, '#ef4444'], ['Yüksek', d.high || 0, '#f97316'],
    ['Orta', d.medium || 0, '#eab308'], ['Düşük', d.low || 0, '#22c55e'],
  ];
  const toplam = seviyeler.reduce((a, [, n]) => a + n, 0) || 1;
  const enRiskli = (r.items || []).slice(0, 10);

  return `
  <h2 class="rd-h2">RİSK ANALİZİ</h2>
  <div class="rd-risk-ust">
    <div class="rd-kutu">
      <h4>Risk Dağılımı</h4>
      <div class="rd-serit">${seviyeler.filter(([, n]) => n).map(([ad, n, renk]) =>
    `<i style="width:${(n / toplam) * 100}%;background:${renk}" title="${ad}: ${n}"></i>`).join('')}</div>
      <div class="rd-serit-efsane">${seviyeler.map(([ad, n, renk]) =>
    `<span><i style="background:${renk}"></i>${ad}<b>${rpSayi(n)}</b></span>`).join('')}</div>
    </div>
    <div class="rd-kutu">
      <h4>Ortalama Risk Puanı</h4>
      ${rpGosterge(r.average_score)}
      <p class="rd-not">${rpSayi(r.at_risk_count)} / ${rpSayi(r.total_assets)} cihaz risk taşıyor</p>
    </div>
  </div>
  ${enRiskli.length ? `
  <h2 class="rd-h2">EN RİSKLİ CİHAZLAR <span class="rd-h2-alt">(ilk ${enRiskli.length})</span></h2>
  <table class="rd-tablo rd-tablo--risk">
    <thead><tr><th>Cihaz Adı</th><th>Kategori</th><th>Sorumlu</th><th>Puan</th><th>Seviye</th><th>Puanı yükselten etkenler</th></tr></thead>
    <tbody>${enRiskli.map((c) => `<tr>
      <td>${escapeHtml(c.hostname || '—')}</td>
      <td>${escapeHtml(c.category || '—')}</td>
      <td>${escapeHtml(c.username || '—')}</td>
      <td><b>${rpSayi(c.score)}</b></td>
      <td><span class="rd-seviye rd-seviye--${String(c.level || '').toLocaleLowerCase('tr-TR')}">${escapeHtml(c.level || '—')}</span></td>
      <td>${(c.factors || []).map((f) => escapeHtml(f.label)).join(' · ') || '—'}</td>
    </tr>`).join('')}</tbody>
  </table>` : ''}`;
}

/* Garanti bitiş çizelgesi — önümüzdeki 12 ay, gerçek warranty_expiry'den. */
function rpGarantiCizelge() {
  const varliklar = rpVarliklar();
  const bugun = new Date();
  const kovalar = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(bugun.getFullYear(), bugun.getMonth() + i, 1);
    kovalar.push({ anahtar: `${d.getFullYear()}-${d.getMonth()}`, etiket: d.toLocaleDateString('tr-TR', { month: 'short' }), n: 0 });
  }
  let bilinmeyen = 0;
  for (const a of varliklar) {
    if (!a.warranty_expiry) { bilinmeyen++; continue; }
    const d = new Date(a.warranty_expiry);
    if (isNaN(d)) { bilinmeyen++; continue; }
    const k = kovalar.find((x) => x.anahtar === `${d.getFullYear()}-${d.getMonth()}`);
    if (k) k.n++;
  }
  const toplam = kovalar.reduce((a, k) => a + k.n, 0);
  const enb = Math.max(1, ...kovalar.map((k) => k.n));
  // Hepsi sıfırsa boş bir grafik çizmek yerine durumu yazıyoruz: boş eksen
  // "veri yok" ile "hiç bitmiyor"u ayırt ettirmiyor.
  if (!toplam) {
    return `
    <h2 class="rd-h2">GARANTİ BİTİŞ ZAMAN ÇİZELGESİ</h2>
    <div class="rd-cizelge rd-cizelge--bos">
      <p>Önümüzdeki 12 ay içinde garantisi bitecek cihaz yok.</p>
      <p class="rd-not">${bilinmeyen ? `Garanti tarihi girilmemiş ${rpSayi(bilinmeyen)} cihaz bu çizelgeye dahil değil. ` : ''}Garantisi hâlihazırda bitmiş cihazlar için "Garanti &amp; Lisans Raporu"na bakın.</p>
    </div>`;
  }
  return `
  <h2 class="rd-h2">GARANTİ BİTİŞ ZAMAN ÇİZELGESİ</h2>
  <div class="rd-cizelge">
    <div class="rd-cz-govde">
      ${kovalar.map((k) => `<div class="rd-cz-sutun">
        <span class="rd-cz-deger">${k.n || ''}</span>
        <i style="height:${k.n ? Math.max(4, (k.n / enb) * 100) : 1}%"></i>
        <span class="rd-cz-ay">${escapeHtml(k.etiket)}</span>
      </div>`).join('')}
    </div>
    <p class="rd-not">Önümüzdeki 12 ay · toplam ${rpSayi(toplam)} cihaz${
  bilinmeyen ? ` · garanti tarihi girilmemiş ${rpSayi(bilinmeyen)} cihaz çizelgede yok` : ''}</p>
  </div>`;
}

/* Tablo sayfaları — satırlar sayfalara bölünür (A4'e sığdığı kadar). */
function rpTabloSayfalari(baslik, basliklar, satirlar, sayfaBasi = 22) {
  if (!satirlar.length) return [];
  const sayfalar = [];
  for (let i = 0; i < satirlar.length; i += sayfaBasi) {
    const dilim = satirlar.slice(i, i + sayfaBasi);
    sayfalar.push(`
      <h2 class="rd-h2">${escapeHtml(baslik)}${satirlar.length > sayfaBasi
    ? ` <span class="rd-h2-alt">(${i + 1}–${i + dilim.length} / ${satirlar.length})</span>` : ''}</h2>
      <table class="rd-tablo">
        <thead><tr>${basliklar.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${dilim.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c === null || c === undefined || c === '' ? '—' : String(c))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`);
  }
  return sayfalar;
}

/* ── Rapor üreticileri: her biri sayfa gövdelerinin dizisini döner ── */
function rpUret(rapor) {
  const v = _rpVeri;
  const varliklar = rpVarliklar();
  const bloklar = [];

  if (rapor.id === 'genel') {
    /* Yönetici yorumu 1. sayfaya girince çizelge A4'ü aşıyordu; çizelge risk
       sayfasına alındı. Sayfa 1: özet ve dağılım, sayfa 2: risk ve garanti. */
    bloklar.push(rpKapak(rapor) + rpYoneticiOzeti() + rpVarlikDagilimi() + rpAnalizVeOneriler());
    bloklar.push(rpRiskAnalizi() + rpGarantiCizelge());
    bloklar.push(...rpTabloSayfalari('VARLIK LİSTESİ',
      ['Cihaz Adı', 'Kategori', 'Marka', 'Model', 'Lokasyon', 'Durum'],
      varliklar.map((a) => [a.hostname, a.category, a.brand, a.model, a.location, a.status])));
  } else if (rapor.id === 'donanim') {
    const s = v.stats || {};
    bloklar.push(rpKapak(rapor) + `
      <h2 class="rd-h2">DONANIM ORTALAMALARI</h2>
      <div class="rd-kpiler">
        <div class="rd-kpi"><span class="rd-k-et">Ortalama RAM</span><b class="rd-k-deger">${rpSayi(s.avg_ram_gb)} GB</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Ortalama Disk</span><b class="rd-k-deger">${rpSayi(s.avg_disk_gb)} GB</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Toplam Cihaz</span><b class="rd-k-deger">${rpSayi(s.total)}</b></div>
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">Yükseltme Adayı</span><b class="rd-k-deger">${
  rpSayi((v.anomali?.low_ram?.count || 0) + (v.anomali?.low_disk?.count || 0))}</b></div>
      </div>` + rpAnalizVeOneriler());
    const donanimli = varliklar.filter((a) => a.ram_gb || a.storage_gb)
      .sort((a, b) => (Number(a.ram_gb) || 0) - (Number(b.ram_gb) || 0));
    bloklar.push(...rpTabloSayfalari('DONANIM DÖKÜMÜ',
      ['Cihaz Adı', 'Marka', 'Model', 'CPU', 'RAM (GB)', 'Disk (GB)'],
      donanimli.map((a) => [a.hostname, a.brand, a.model, a.cpu, a.ram_gb, a.storage_gb])));
  } else if (rapor.id === 'shadow') {
    const sh = v.shadow || {};
    const bilinmeyen = sh.shadow?.items || [];
    bloklar.push(rpKapak(rapor) + `
      <h2 class="rd-h2">AĞ TARAMA ÖZETİ</h2>
      <div class="rd-kpiler">
        <div class="rd-kpi"><span class="rd-k-et">Ağda Görülen</span><b class="rd-k-deger">${rpSayi(sh.total_active)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Envanterde Eşleşen</span><b class="rd-k-deger">${rpSayi(sh.matched)}</b></div>
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">Bilinmeyen Cihaz</span><b class="rd-k-deger">${rpSayi(bilinmeyen.length)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Envanter Toplamı</span><b class="rd-k-deger">${rpSayi(v.stats?.total)}</b></div>
      </div>
      <p class="rd-not">Kaynak: ağ keşif kaydı. Kayıt yoksa bu bölüm boş görünür — tarama yapılmadığı anlamına gelir, "temiz" anlamına gelmez.</p>`);
    bloklar.push(...rpTabloSayfalari('BİLİNMEYEN CİHAZLAR', ['IP', 'MAC', 'Ad', 'İlk Görülme'],
      bilinmeyen.map((d) => [d.ip, d.mac, d.hostname || d.name, d.first_seen || d.seen])));
  } else if (rapor.id === 'eol') {
    const eol = v.eol || {};
    const eolListe = eol.eol?.items || [];
    const yaklasan = eol.approaching?.items || [];
    bloklar.push(rpKapak(rapor) + `
      <h2 class="rd-h2">GÜVENLİK ÖZETİ</h2>
      <div class="rd-kpiler">
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">EOL İşletim Sistemi</span><b class="rd-k-deger">${rpSayi(eolListe.length)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Desteği Bitmek Üzere</span><b class="rd-k-deger">${rpSayi(yaklasan.length)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Kritik Risk</span><b class="rd-k-deger">${rpSayi(v.risk?.distribution?.critical)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Yüksek Risk</span><b class="rd-k-deger">${rpSayi(v.risk?.distribution?.high)}</b></div>
      </div>` + rpAnalizVeOneriler());
    bloklar.push(rpRiskAnalizi());
    bloklar.push(...rpTabloSayfalari('DESTEĞİ BİTMİŞ İŞLETİM SİSTEMLERİ',
      ['Cihaz Adı', 'İşletim Sistemi', 'Destek Bitişi', 'Kullanıcı'],
      eolListe.map((d) => [d.hostname, d.os, d.eol_date || d.eol, d.username])));
  } else if (rapor.id === 'garanti') {
    const gar = v.garanti || {}, lis = v.lisans || {};
    bloklar.push(rpKapak(rapor) + `
      <h2 class="rd-h2">GARANTİ &amp; LİSANS ÖZETİ</h2>
      <div class="rd-kpiler">
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">Garanti Dışı</span><b class="rd-k-deger">${rpSayi(gar.expired?.count)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">${gar.approaching_days || 60} Gün İçinde Bitiyor</span><b class="rd-k-deger">${rpSayi(gar.expiring_soon?.count)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Lisans Uyumsuzluğu</span><b class="rd-k-deger">${rpSayi((lis.unlicensed?.count || 0) + (lis.expired?.count || 0))}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">12 Ay Bütçe</span><b class="rd-k-deger">${
  v.tahmin?.total_estimated_cost ? rpSayi(Math.round(v.tahmin.total_estimated_cost)) + ' ₺' : '—'}</b></div>
      </div>` + rpGarantiCizelge());
    const gsatir = [...(gar.expired?.items || []), ...(gar.expiring_soon?.items || [])];
    bloklar.push(...rpTabloSayfalari('GARANTİ DURUMU',
      ['Cihaz Adı', 'Marka', 'Model', 'Garanti Bitişi', 'Durum'],
      gsatir.map((d) => [d.hostname, d.brand, d.model, d.warranty_expiry, d.days_left < 0 ? 'Bitti' : `${d.days_left} gün`])));
  } else if (rapor.id === 'lokasyon') {
    const lokListe = rpListe(varliklar.reduce((a, x) => {
      const l = (x.location || '').trim() || 'Girilmemiş'; a[l] = (a[l] || 0) + 1; return a;
    }, {}));
    const sapmaSayi = (v.lokasyon?.severity?.kritik || 0) + (v.lokasyon?.severity?.uyari || 0);
    bloklar.push(rpKapak(rapor) + `
      <h2 class="rd-h2">LOKASYON ÖZETİ</h2>
      <div class="rd-kpiler">
        <div class="rd-kpi"><span class="rd-k-et">Lokasyon Sayısı</span><b class="rd-k-deger">${rpSayi(lokListe.filter(([a]) => a !== 'Girilmemiş').length)}</b></div>
        <div class="rd-kpi"><span class="rd-k-et">Konumu Bilinen</span><b class="rd-k-deger">${rpSayi(varliklar.filter((a) => (a.location || '').trim()).length)}</b></div>
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">Konumu Girilmemiş</span><b class="rd-k-deger">${rpSayi(varliklar.filter((a) => !(a.location || '').trim()).length)}</b></div>
        <div class="rd-kpi rd-kpi--uyari"><span class="rd-k-et">Sapma</span><b class="rd-k-deger">${rpSayi(sapmaSayi)}</b></div>
      </div>
      <h2 class="rd-h2">LOKASYON DAĞILIMI</h2>
      <div class="rd-kutu rd-kutu--genis">${rpCubuklar(lokListe.slice(0, 10))}</div>`);
    bloklar.push(...rpTabloSayfalari('CİHAZ LOKASYONLARI',
      ['Cihaz Adı', 'Kategori', 'Lokasyon', 'Kullanıcı', 'Son Görülme'],
      varliklar.map((a) => [a.hostname, a.category, a.location, a.username, a.last_seen])));
  }

  return bloklar;
}

/* Kartta gösterilecek sayfa sayısı — gerçek üreticiyle aynı yoldan geçer,
   böylece "yaklaşık 6 sayfa" yazıp 2 sayfa üretmiş olmayız. */
function rpSayfaTahmini(rapor) {
  if (!_rpVeri) return null;
  try { return rpUret(rapor).length; } catch { return null; }
}

/* ── Katalog çizimi ── */
function rpSekmeleriCiz() {
  const k = $(`#rpSekmeler`);
  if (!k) return;
  k.innerHTML = RP_KATEGORILER.map(([id, ad]) =>
    `<button class="rp-sekme${id === _rpKat ? ' aktif' : ''}" data-kat="${id}">${escapeHtml(ad)}</button>`).join('');
  k.querySelectorAll('.rp-sekme').forEach((b) => b.addEventListener('click', () => {
    _rpKat = b.dataset.kat; rpSekmeleriCiz(); rpKartlariCiz();
  }));
}

function rpKartlariCiz() {
  const k = $(`#rpKartlar`);
  if (!k) return;
  const liste = RP_RAPORLAR.filter((r) => _rpKat === 'hepsi' || r.kat.includes(_rpKat));
  if (!liste.length) { k.innerHTML = '<p class="rd-bos">Bu kategoride rapor yok.</p>'; return; }
  k.innerHTML = liste.map((r) => {
    const sayfa = rpSayfaTahmini(r);
    const ozellikHtml = r.ciftSutun
      ? `<div class="rp-oz rp-oz--cift">${r.ozellikler.map(([a, b]) =>
        `<span><i class="rp-tik">✓</i>${escapeHtml(a)}</span><span><i class="rp-tik">✓</i>${escapeHtml(b)}</span>`).join('')}</div>`
      : `<div class="rp-oz">${r.ozellikler.map((a) =>
        `<span><i class="rp-nok rp-nok--${r.renk}"></i>${escapeHtml(a)}</span>`).join('')}</div>`;
    return `
    <article class="rp-kart" data-rapor="${r.id}">
      <div class="rp-kart-ust">
        <span class="rp-ikon kpi-ico--${r.renk}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${RP_IKON[r.ikon]}</svg></span>
        ${r.ai ? '<span class="rp-rozet">AI Insights</span>' : ''}
      </div>
      <h4>${escapeHtml(r.ad)}</h4>
      <p>${escapeHtml(r.aciklama)}</p>
      ${ozellikHtml}
      <div class="rp-meta">
        <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          ${sayfa === null ? 'Sayfa sayısı veri gelince' : `${sayfa} sayfa`}</span>
        <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          Anında oluşturulur</span>
      </div>
      <div class="rp-dugmeler">
        <button class="btn-pdf rp-onizle" data-id="${r.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          Önizleme
        </button>
        <button class="btn-add rp-olustur" data-id="${r.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          PDF Oluştur
        </button>
      </div>
    </article>`;
  }).join('');

  k.querySelectorAll('.rp-onizle').forEach((b) => b.addEventListener('click', () => rpRaporCalistir(b.dataset.id, false)));
  k.querySelectorAll('.rp-olustur').forEach((b) => b.addEventListener('click', () => rpRaporCalistir(b.dataset.id, true)));
}

/* ── Belge önizlemesi ── */
async function rpRaporCalistir(id, yazdir) {
  const rapor = RP_RAPORLAR.find((r) => r.id === id);
  if (!rapor) return;
  const belge = $(`#rpBelge`), bos = $(`#rpBos`);
  if (bos) bos.style.display = 'none';
  if (belge) belge.innerHTML = '<div class="rp-yukleniyor">Rapor hazırlanıyor…</div>';

  if (!_rpVeri) await rpVeriTopla();
  _rpAktifRapor = rapor;
  const bloklar = rpUret(rapor);
  const toplam = bloklar.length;
  _rpSayfalar = bloklar.map((govde, i) => `
    <section class="rd-sayfa" data-sayfa="${i + 1}">
      <div class="rd-icerik">${govde}</div>
      <footer class="rd-alt">
        <span>AssetMan · ${escapeHtml(rapor.ad)}</span>
        <span>${i + 1} / ${toplam}</span>
      </footer>
    </section>`);

  if (belge) belge.innerHTML = _rpSayfalar.join('');
  _rpSayfa = 1;
  rpYakinligiSigdir();
  rpTasmaDenetle();
  rpAracGuncelle();
  rpYorumuGetir();                  // model yanıtı gelince kutuya düşer
  rpKartlariCiz();                  // sayfa sayısı artık gerçek
  if (belge) belge.scrollTop = 0;
  if (yazdir) rpYazdir();
}

/* Baskıda sayfa yüksekliği sabit ve overflow gizli — taşan içerik SESSİZCE
   kırpılırdı. Ekranda ölçüp uyarıyoruz: kırpılmış bir PDF, eksik olduğu
   belli olmayan bir PDF'tir. */
function rpTasmaDenetle() {
  const sayfalar = [...($(`#rpBelge`)?.querySelectorAll('.rd-sayfa') || [])];
  /* clientHeight ile karşılaştırmak YANLIŞ: sayfanın min-height'ı var, içerik
     taşınca kutu da büyüyor ve iki ölçü eşit çıkıyor. Sabit A4 hedefiyle
     karşılaştırılır. */
  const tasan = sayfalar.filter((s) => s.scrollHeight > RD_A4_YUKSEK + 2);
  tasan.forEach((s) => s.classList.add('rd-sayfa--tasan'));
  const u = $(`#rpTasmaUyari`);
  if (u) {
    u.style.display = tasan.length ? 'flex' : 'none';
    u.textContent = tasan.length
      ? `${tasan.length} sayfa A4'e sığmıyor — baskıda alt kısım kırpılır.` : '';
  }
  if (tasan.length) console.warn('[rapor] A4 sınırını aşan sayfa:', tasan.map((s) => s.dataset.sayfa));
}

/* İlk gösterimde sayfayı panele sığdır. "100%" yazıp taşan bir belge
   göstermek yerine gerçek oran yazılır; +/- buradan devam eder. */
function rpYakinligiSigdir() {
  const alan = $(`#rpBelgeAlan`);
  if (!alan) return;
  const kullanilabilir = alan.clientWidth - 36;      // yatay dolgu
  if (kullanilabilir <= 0) return;
  _rpYakinlik = Math.max(40, Math.min(100, Math.floor((kullanilabilir / 794) * 100)));
}

function rpAracGuncelle() {
  const toplam = _rpSayfalar.length;
  const no = $(`#rpSayfaNo`);
  if (no) no.textContent = toplam ? `${_rpSayfa} / ${toplam}` : '— / —';
  const ac = (sel, durum) => { const e = $(sel); if (e) e.disabled = !durum; };
  ac('#rpOnceki', toplam && _rpSayfa > 1);
  ac('#rpSonraki', toplam && _rpSayfa < toplam);
  ac('#rpIndir', !!toplam); ac('#rpYazdir', !!toplam); ac('#rpTamEkran', !!toplam);
  const y = $(`#rpYakinlik`); if (y) y.textContent = _rpYakinlik + '%';
  const belge = $(`#rpBelge`);
  if (belge) belge.style.setProperty('--rp-olcek', _rpYakinlik / 100);
}

function rpSayfayaGit(n) {
  const toplam = _rpSayfalar.length;
  if (!toplam) return;
  _rpSayfa = Math.max(1, Math.min(toplam, n));
  const hedef = $(`#rpBelge`)?.querySelector(`[data-sayfa="${_rpSayfa}"]`);
  hedef?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  rpAracGuncelle();
}

/* Yazdırma: belgeyi body'ye işaretleriz, baskı CSS'i yalnız onu bırakır.
   Ayrı pencere açmak yerine bu yol seçildi — açılır pencere engelleyicileri
   sessizce boş çıktı üretiyordu. */
function rpYazdir() {
  if (!_rpSayfalar.length) return;
  const eskiBaslik = document.title;
  document.title = `${_rpAktifRapor?.ad || 'Rapor'} — AssetMan`;
  document.body.classList.add('rp-baskida');
  const bitir = () => {
    document.body.classList.remove('rp-baskida');
    document.title = eskiBaslik;
    window.removeEventListener('afterprint', bitir);
  };
  window.addEventListener('afterprint', bitir);
  window.print();
  setTimeout(bitir, 1500);          // afterprint desteklemeyen tarayıcılar için
}

function rpKur() {
  if (!$(`#rpKartlar`)) return;
  rpSekmeleriCiz();
  rpKartlariCiz();
  $(`#rpOnceki`)?.addEventListener('click', () => rpSayfayaGit(_rpSayfa - 1));
  $(`#rpSonraki`)?.addEventListener('click', () => rpSayfayaGit(_rpSayfa + 1));
  $(`#rpUzaklas`)?.addEventListener('click', () => { _rpYakinlik = Math.max(50, _rpYakinlik - 10); rpAracGuncelle(); });
  $(`#rpYakinlas`)?.addEventListener('click', () => { _rpYakinlik = Math.min(200, _rpYakinlik + 10); rpAracGuncelle(); });
  $(`#rpIndir`)?.addEventListener('click', rpYazdir);
  $(`#rpYazdir`)?.addEventListener('click', rpYazdir);
  $(`#rpTamEkran`)?.addEventListener('click', () => {
    const p = $(`#rpOnizleme`);
    if (!p) return;
    p.classList.toggle('rp-tam');
    document.body.classList.toggle('rp-tam-acik', p.classList.contains('rp-tam'));
  });
  $(`#rpGecmis`)?.addEventListener('click', () => {
    alert('Rapor geçmişi henüz tutulmuyor. Oluşturulan raporlar kaydedilmediği için listelenecek bir geçmiş yok.');
  });
  // Kaydırdıkça sayfa numarası takip etsin
  $(`#rpBelgeAlan`)?.addEventListener('scroll', () => {
    if (!_rpSayfalar.length) return;
    const alan = $(`#rpBelgeAlan`);
    const sayfalar = [...alan.querySelectorAll('.rd-sayfa')];
    const ust = alan.scrollTop + 40;
    let n = 1;
    sayfalar.forEach((s, i) => { if (s.offsetTop <= ust) n = i + 1; });
    if (n !== _rpSayfa) { _rpSayfa = n; rpAracGuncelle(); }
  });
}

/* Rapor sayfası açıldığında veriyi bir kez çeker (kart sayfa sayıları için). */
async function loadReports() {
  if (!_rpVeri) {
    await rpVeriTopla();
    rpKartlariCiz();
  }
}
