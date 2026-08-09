/* AssetMan · dashboard.js
   Dashboard, TV/operasyon merkezi, harita, donut, aktivite, oneri

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ─── Dashboard ─────────────────────────────────────────────────────────── */
async function fetchTrends(days) {
  const res = await fetch('/api/trends?days=' + (days || 30));
  if (!res.ok) throw new Error('Trend alınamadı');
  return res.json();
}

async function fetchLocationSummary() {
  const res = await fetch('/api/location-summary');
  if (!res.ok) throw new Error('Lokasyon özeti alınamadı');
  return res.json();
}

const EMPTY_SUMMARY = {
  total: 0, dogru: 0, tasinmis: 0, guncellenen: 0, bilinmeyen: 0, baseline_yok: 0,
  severity: { kritik: 0, uyari: 0, bilgi: 0 }, locations: {}, location_count: 0, threshold_days: 7,
};

async function loadDashboard() {
  try {
    // Lokasyon/uyarı verileri BAŞARISIZ olsa da çekirdek dashboard çizilir.
    const [assetsData, stats, summary, trendData, lcLog, anomalies, warranty] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetchStats(),
      fetchLocationSummary().catch(() => ({ ...EMPTY_SUMMARY })),
      fetchTrends(state.rangeDays).catch(() => null),
      fetchLifecycleLog(30).catch(() => ({ events: [] })),
      fetchAnomalies().catch(() => ({})),
      fetchWarranty().catch(() => ({})),
    ]);
    state.allAssets = assetsData.results || [];
    state.assets = state.allAssets;
    state.stats = stats;
    state.rawStats = stats;
    state.locSummary = summary;
    state.rawSummary = summary;
    buildCategoryFilter(stats.by_category || {});
    state.trends = trendData?.trends || {};
    state.trendSeries = trendData?.series || [];
    state.seriesOnline = trendData?.series_online || [];
    state.seriesOffline = trendData?.series_offline || [];
    state.seriesDepoda = trendData?.series_depoda || [];

    renderStats(stats, summary);
    renderCategoryDonut(stats.by_category || {}, stats.total || 0);
    applyLocViewMode(summary.locations || {});
    renderMismatch(summary);
    renderLocationStateDonut(summary);
    renderRecentTable(state.assets.slice(0, 5));
    renderActivities(lcLog.events || lcLog.log || []);
    const parts = {
      drift:    summary.tasinmis || 0,
      warranty: warranty.expired?.items?.length || 0,
      uptime:   anomalies.long_uptime?.items?.length || 0,
      disk:     anomalies.low_disk?.items?.length || 0,
      offline:  stats.by_status?.offline || 0,
    };
    state.critParts = parts;
    renderCriticalStrip(parts);
    renderInsight(summary, parts);
    if (state.catFilter && state.catFilter.size) applyDashFilter();

    // Eski görünümlerde kalan grafikler (elemanı yoksa sessizce atlanır)
    renderBrandChart(stats.by_brand || {});
    renderCategoryChart(stats.by_category || {});
    renderStatusChart(stats.by_status || {});
    renderLocationChart(state.assets);
  } catch (err) {
    console.error('Dashboard load error:', err);
    const tb = $('tbody#recentBody');
    if (tb) tb.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">Envanter kaynağına bağlanılamadı.</td></tr>`;
  }
}

/* KPI kartları — hepsi GERÇEK veriden; uydurma trend yüzdesi YOK.
   Toplam kart: son 14 günün kümülatif kayıt eğrisi (created_on).
   Durum kartları: toplam içindeki gerçek pay çubuğu. */
/* ═══ TV modu anahtarı ═════════════════════════════════════════════════════
   Ekran GENİŞLİĞİNDEN "bu bir TV" sonucu çıkarılamaz (4K TV tarayıcıları dPR 2
   ile 1920 CSS px raporlar). Bu yüzden AÇIK TERCİH; yalnız ilk açılışta
   ≥2200px ise önerilen varsayılan olarak açılır. */
const TV_MIN_WIDTH = 1000;   // altında duvar ekranı düzeni okunmuyor

function applyTvMode(on) {
  /* Telefon/küçük tablette TV modu ANLAMSIZ: operasyon merkezi 4-6 kolonluk
     duvar düzeni, 390px'te taşıyor. Kayıtlı tercih '1' kalmış bir cihaz dar
     ekranda açılırsa burada kapatılır (localStorage cihaza özel → kalıcı kapat
     doğru davranış; geniş ekranda kullanıcı yeniden açar). */
  if (on && window.innerWidth < TV_MIN_WIDTH) on = false;
  document.body.classList.toggle('tv-mode', !!on);
  localStorage.setItem('tvMode', on ? '1' : '0');
  const btn = $(`#tvToggle`);
  if (btn) { btn.classList.toggle('active', !!on); btn.title = on ? 'TV modundan çık' : 'TV / duvar ekranı modu'; }
  // TV modu görünümü ELE GEÇİRMEZ: yalnız Dashboard'da tam ekran Operasyon
  // Merkezi'ne geçer; diğer sayfalar kendi düzeniyle kalır, sadece TV stili alır.
  const hedef = (state.currentView === 'tv' || state.currentView === 'dashboard') ? 'dashboard' : state.currentView;
  showView(on ? (hedef === 'dashboard' ? 'tv' : hedef) : (state.currentView === 'tv' ? 'dashboard' : state.currentView));
}

/* ═══ TV / OPERASYON MERKEZİ ═════════════════════════════════════════════════
   Duvar ekranı görünümü. TÜM sayılar gerçek veriden gelir.
   İKİ BİLİNÇLİ SAPMA (tasarımda vardı, bizde karşılığı YOK):
   1) "Sistem Sağlığı" tasarımda Sunucular %98 / Ağ %96 / Depolama %92 /
      Güvenlik %97 gösteriyor — sunucu/ağ/depolama izleme özelliği sistemde YOK,
      bu yüzdeleri uydurmak gerekirdi. Yerine GERÇEK sistem kontrolleri konuldu
      (veritabanı, WORM yedek senkronu, AI servisi, bildirim hattı, lokasyon
      doğrulaması) ve genel sağlık bunlardan HESAPLANIR.
   2) "Duyurular" şeridi — duyuru özelliği yok. Yerine gerçek kritik uyarılar ve
      son işlemler akar.
   Ayrıca haritadaki Gün/Hafta/Ay seçicisi UYGULANMADI: lokasyon verisinin
   periyot kırılımı yok, çalışmayan bir kontrol koymak yanıltıcı olurdu. */

let _tvxTimer = null;

function tvxStart() {
  tvxTick();
  if (!_tvxTimer) _tvxTimer = setInterval(tvxTick, 1000);
  tvxRenderAll();
}
function tvxStop() { if (_tvxTimer) { clearInterval(_tvxTimer); _tvxTimer = null; } }

function tvxTick() {
  const d = new Date();
  const tarih = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  const saat = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const set = (id, v) => { const e = $('#' + id); if (e) e.textContent = v; };
  set('tvxDate', tarih); set('tvxClock', saat);
  set('tvxTickerClock', saat.slice(0, 5));
}

async function tvxRenderAll() {
  // Veri yoksa çek (TV moduna doğrudan girilmiş olabilir)
  if (!state.allAssets?.length || !state.locSummary) {
    try {
      const [inv, stats, sum, lc, anom, warr, lic, sys, tr] = await Promise.all([
        fetchAssets({ size: 200 }),
        fetchStats(),
        fetchLocationSummary().catch(() => ({ ...EMPTY_SUMMARY })),
        fetchLifecycleLog(30).catch(() => ({ events: [] })),
        fetchAnomalies().catch(() => ({})),
        fetchWarranty().catch(() => ({})),
        fetchLicenseCompliance().catch(() => ({})),
        fetch('/api/settings').then(r => r.ok ? r.json() : null).catch(() => null),
        fetchTrends(180).catch(() => null),
      ]);
      state.allAssets = inv.results || [];
      state.assets = state.allAssets;
      state.stats = stats;
      state.locSummary = sum;
      state.railEvents = lc.events || lc.log || [];
      state.tvxSystem = sys?.system || null;
      state.tvxLicense = lic || {};
      state.critParts = {
        drift: sum.tasinmis || 0,
        warranty: warr?.expired?.items?.length || 0,
        uptime: anom?.long_uptime?.items?.length || 0,
        disk: anom?.low_disk?.items?.length || 0,
        offline: stats.by_status?.offline || 0,
        license: lic?.expiring_soon?.count || lic?.expiring_soon?.items?.length || 0,
      };
      if (tr) { state.trends = tr.trends || {}; state.trendSeries = tr.series || []; state.tvxSeries = tr.series || []; }
    } catch (e) { console.error('TV verisi alınamadı:', e.message); }
  }
  tvxKpis(); tvxMap(); tvxActs(); tvxCrits(); tvxCategory(); tvxTrend(); tvxAi(); tvxHealth(); tvxTicker();
}

function tvxKpis() {
  const box = $(`#tvxKpis`); if (!box) return;
  const st = state.stats || {}; const sum = state.locSummary || {};
  const tr = state.trends || {}; const win = tr.window_days || 30;
  const k = [
    { ad: 'TOPLAM VARLIK', n: st.total || 0, tone: 'blue', renk: 'var(--accent)', t: tr.total,
      seri: state.trendSeries, sc: '#818cf8', st: null,
      ico: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/>' },
    { ad: 'AKTİF VARLIK', n: st.by_status?.online || 0, tone: 'green', renk: 'var(--green)', t: tr.online,
      seri: state.seriesOnline, sc: '#34d399', st: 'online',
      ico: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>' },
    { ad: 'DEPODA', n: st.by_status?.depoda || 0, tone: 'orange', renk: 'var(--orange)', t: tr.depoda,
      seri: state.seriesDepoda, sc: '#fb923c', st: 'depoda',
      ico: '<path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21V12h6v9"/>' },
    { ad: 'KULLANIM DIŞI', n: st.by_status?.offline || 0, tone: 'red', renk: 'var(--red)', t: tr.offline,
      seri: state.seriesOffline, sc: '#f87171', st: 'offline',
      ico: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
    { ad: 'LOKASYON UYUMSUZLUĞU', n: sum.tasinmis || 0, tone: 'blue', renk: 'var(--accent)',
      alt: `${sum.location_count || 0} aktif lokasyon`, git: 'alerts',
      ico: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  ];
  box.innerHTML = k.map((c, i) => `
    <button class="tvx-kpi" style="color:${c.renk}" data-i="${i}">
      <span class="tvx-kpi-top">
        <span class="tvx-kpi-ico kpi-ico--${c.tone}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.ico}</svg>
        </span>
        <span class="tvx-kpi-label">${c.ad}</span>
        ${c.alt ? '<svg class="tvx-kpi-arr" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' : ''}
      </span>
      <span class="tvx-kpi-val" style="color:${c.renk}">${(c.n).toLocaleString('tr-TR')}</span>
      <span class="tvx-kpi-foot">
        ${c.alt ? `<span class="tvx-kpi-sub">${c.alt}</span>`
                : `<span class="kpi-trend" id="tvxTr${i}"></span><span class="kpi-spark" id="tvxSp${i}"></span>`}
      </span>
    </button>`).join('');
  k.forEach((c, i) => {
    if (c.alt) return;
    renderTrend(`tvxTr${i}`, c.t, win);
    sparkFromSeries(`tvxSp${i}`, c.seri || [], c.sc);
  });
  box.querySelectorAll('.tvx-kpi').forEach((b, i) => b.addEventListener('click', () => {
    const c = k[i];
    if (c.git) { applyTvMode(false); showView(c.git); return; }
    if (c.st) { applyTvMode(false); const s = $(`#filterStatus`); if (s) s.value = c.st; showView('assets'); }
  }));
}

function tvxMap() {
  const locs = state.locSummary?.locations || {};
  // Haritayı mevcut çizici ile aynı mantıkta çiz (tek kaynak)
  renderWorldMap(locs, 'tvxMap', 'tvxMapLegend');

  // En yoğun 5 lokasyon
  const top = Object.entries(locs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tl = $(`#tvxTopLoc`);
  if (tl) tl.innerHTML = top.length ? top.map(([ad, n], i) =>
    `<div class="tvx-loc-row"><i style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i><span title="${escapeHtml(ad)}">${escapeHtml(ad)}</span><b>${n}</b></div>`).join('')
    : '<p class="tvx-trend-empty">Lokasyon verisi yok</p>';

  // Durum dağılımı donut'u (aktif/depoda/kullanım dışı/uyumsuz)
  const st = state.stats?.by_status || {};
  const sum = state.locSummary || {};
  const parcalar = [
    ['Aktif', st.online || 0, '#10b981'],
    ['Depoda', st.depoda || 0, '#f59e0b'],
    ['Kullanım Dışı', st.offline || 0, '#ef4444'],
    ['Uyumsuz', sum.tasinmis || 0, '#a855f7'],
  ].filter(p => p[1] > 0);
  const toplam = parcalar.reduce((a, p) => a + p[1], 0) || 1;
  const dsvg = $(`#tvxStateDonut`), dleg = $(`#tvxStateLegend`), dtot = $(`#tvxStateTotal`);
  if (dtot) dtot.textContent = (state.stats?.total || 0).toLocaleString('tr-TR');
  if (dsvg) {
    const R = 42, C = 2 * Math.PI * R; let off = 0;
    dsvg.innerHTML = parcalar.map(([, n, c]) => {
      const len = (n / toplam) * C;
      const seg = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${c}" stroke-width="17"
        stroke-dasharray="${len - 1.5} ${C - len + 1.5}" stroke-dashoffset="${-off}"/>`;
      off += len; return seg;
    }).join('');
  }
  if (dleg) dleg.innerHTML = parcalar.map(([ad, n, c]) =>
    `<div class="tvx-sd-row"><i style="background:${c}"></i><span>${ad}</span><b>%${Math.round((n / toplam) * 100)}</b></div>`).join('');
}

function tvxActs() {
  const box = $(`#tvxActs`); if (!box) return;
  const list = (state.railEvents || []).slice(-6).reverse();
  if (!list.length) { box.innerHTML = '<p class="tvx-trend-empty">Henüz kayıtlı işlem yok</p>'; return; }
  box.innerHTML = list.map(e => {
    const [tone, ico] = ACT_ICON[e.to_status] || ACT_DEFAULT;
    const t = new Date(e.timestamp);
    const saat = isNaN(t) ? '—' : t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="tvx-a">
      <span class="tvx-a-time">${saat}</span>
      <span class="tvx-a-ico kpi-ico--${tone}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </span>
      <span class="tvx-a-txt"><strong>${escapeHtml((e.hostname || e.serial_number || 'Cihaz') + ' — ' + (e.to_status || ''))}</strong>
        <span>${escapeHtml(e.note || e.actor || '')}</span></span>
    </div>`;
  }).join('');
}

function tvxCrits() {
  const box = $(`#tvxCrits`); if (!box) return;
  const p = state.critParts || {};
  const rows = [
    { n: p.drift || 0,    t: 'Lokasyon Dışı Cihazlar', tone: 'red' },
    { n: p.warranty || 0, t: 'Garanti Süresi Dolan',   tone: 'orange' },
    { n: p.uptime || 0,   t: 'Bakım Süresi Geçen',     tone: 'orange' },
    { n: p.disk || 0,     t: 'Disk Alanı Düşük',       tone: 'red' },
    { n: p.offline || 0,  t: 'Çevrimdışı Cihaz',       tone: 'red' },
    { n: p.license || 0,  t: 'Lisans Süresi Yaklaşan', tone: 'orange' },
  ];
  setPill('tvxCritPill', rows.reduce((a, r) => a + r.n, 0));
  box.innerHTML = rows.map(r => `
    <button class="tvx-c">
      <span class="tvx-c-ico sev-ico--${r.tone}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </span>
      <span class="tvx-c-name">${r.t}</span><span class="tvx-c-n">${r.n}</span>
    </button>`).join('');
  box.querySelectorAll('.tvx-c').forEach(b => b.addEventListener('click', () => { applyTvMode(false); showView('alerts'); }));
}

function tvxCategory() {
  const byCat = state.stats?.by_category || {};
  const all = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5);
  const kalan = all.slice(5).reduce((a, [, n]) => a + n, 0);
  if (kalan) top.push(['Diğer', kalan]);
  const toplam = state.stats?.total || 0;
  const svg = $(`#tvxCatDonut`), leg = $(`#tvxCatLegend`), tot = $(`#tvxCatTotal`);
  if (tot) tot.textContent = toplam.toLocaleString('tr-TR');
  const sum = top.reduce((a, [, n]) => a + n, 0) || 1;
  if (svg) {
    const R = 42, C = 2 * Math.PI * R; let off = 0;
    svg.innerHTML = top.map(([ad, n], i) => {
      const len = (n / sum) * C;
      const seg = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${donutColor(ad, i)}" stroke-width="17"
        stroke-dasharray="${len - 1.5} ${C - len + 1.5}" stroke-dashoffset="${-off}"/>`;
      off += len; return seg;
    }).join('');
  }
  if (leg) leg.innerHTML = top.map(([ad, n], i) => `
    <div class="dl-row"><span class="dl-name"><span class="dl-dot" style="background:${donutColor(ad, i)}"></span>${escapeHtml(ad)}</span>
      <span class="dl-count">${n}</span><span class="dl-pct">%${Math.round((n / sum) * 100)}</span></div>`).join('');
}

/* Aylık trend — GERÇEK günlük anlık görüntülerden aylık son değer */
function tvxTrend() {
  const box = $(`#tvxTrend`); if (!box) return;
  const seri = state.tvxSeries || state.trendSeries || [];
  if (seri.length < 3) {
    box.innerHTML = '<p class="tvx-trend-empty">Trend için yeterli geçmiş yok — günlük anlık görüntüler birikiyor.</p>';
    return;
  }
  // Ay bazında son değeri al
  const aylar = {};
  seri.forEach(p => { aylar[p.day.slice(0, 7)] = p.value; });
  const noktalar = Object.entries(aylar).sort().slice(-6);
  if (noktalar.length < 2) {
    box.innerHTML = '<p class="tvx-trend-empty">Trend için en az iki aylık veri gerekir.</p>';
    return;
  }
  const W = 460, H = 150, PAD = 26;
  const vals = noktalar.map(n => n[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const x = (i) => PAD + (i / (noktalar.length - 1)) * (W - PAD * 2);
  const y = (v) => H - 30 - ((v - min) / span) * (H - 60);
  const d = noktalar.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n[1]).toFixed(1)}`).join(' ');
  const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d} L${x(noktalar.length - 1).toFixed(1)} ${H - 30} L${PAD} ${H - 30} Z" fill="var(--accent)" opacity=".12"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${noktalar.map((n, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(n[1]).toFixed(1)}" r="3.6" fill="var(--accent)"/>
      <text x="${x(i).toFixed(1)}" y="${(y(n[1]) - 9).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--text)">${n[1]}</text>
      <text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${AY[Number(n[0].slice(5, 7)) - 1]}</text>`).join('')}
  </svg>`;
}

function tvxAi() {
  const ul = $(`#tvxAiList`); if (!ul) return;
  const s = state.locSummary || {}, p = state.critParts || {};
  const tik = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const satirlar = [
    `${s.tasinmis || 0} cihaz farklı lokasyonda.`,
    `${p.warranty || 0} garanti bitiyor (30 gün içinde).`,
    `${p.disk || 0} cihazın diski dolu.`,
    `${p.offline || 0} cihaz çevrimdışı.`,
  ];
  ul.innerHTML = satirlar.map(t => `<li>${tik}<span>${t}</span></li>`).join('');
}

/* Sistem sağlığı — GERÇEK kontroller (bkz. dosya başındaki not) */
function tvxHealth() {
  const box = $(`#tvxHealth`); if (!box) return;
  const sys = state.tvxSystem || {};
  const it = sys.integrations || {};
  const b = sys.backup || null;
  const kontrol = [
    { ad: 'Veritabanı', ok: !!sys.database?.driver, bilgi: sys.database?.driver || '—' },
    { ad: 'WORM yedek', ok: !!(b && b.in_sync), bilgi: b ? (b.in_sync ? 'senkron' : 'senkron değil') : '—' },
    { ad: 'AI servisi', ok: !!sys.ai?.provider, bilgi: sys.ai?.provider ? 'bağlı' : 'yok' },
    { ad: 'Bildirim hattı', ok: !!it.n8n_notify, bilgi: it.n8n_notify ? 'yapılandırıldı' : 'yok' },
    { ad: 'Lokasyon doğrulaması', ok: !!it.location_tokens, bilgi: it.location_tokens ? 'açık' : 'kapalı' },
  ];
  box.innerHTML = kontrol.map(k => `
    <div class="tvx-h">
      <span>${k.ad}</span>
      <b style="color:var(--${k.ok ? 'green' : 'orange'})">${k.bilgi}</b>
    </div>`).join('');

  const gecen = kontrol.filter(k => k.ok).length;
  const pct = Math.round((gecen / kontrol.length) * 100);
  const el = $(`#tvxHealthPct`); if (el) { el.textContent = '%' + pct; el.style.color = pct >= 80 ? 'var(--green)' : 'var(--orange)'; }
  const g = $(`#tvxGauge`);
  if (g) {
    const R = 45, C = 2 * Math.PI * R, len = (pct / 100) * C;
    g.innerHTML = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--bg-hover)" stroke-width="11"/>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="${pct >= 80 ? 'var(--green)' : 'var(--orange)'}"
        stroke-width="11" stroke-linecap="round" stroke-dasharray="${len} ${C - len}"/>`;
  }
  const note = $(`#tvxHealthNote`);
  if (note) note.textContent = gecen === kontrol.length
    ? '✓ Tüm sistem kontrolleri geçti.'
    : `${kontrol.length - gecen} kontrol yapılandırılmamış.`;
  const ss = $(`#tvxSysState`);
  if (ss) { ss.className = pct >= 80 ? '' : 'warn'; ss.innerHTML = `<i></i>${pct >= 80 ? 'Normal' : 'Dikkat'}`; }
}

/* Duyuru şeridi — gerçek uyarı ve işlemlerden (bkz. dosya başındaki not) */
function tvxTicker() {
  const box = $(`#tvxTickerItems`); if (!box) return;
  const p = state.critParts || {};
  const ogeler = [];
  if (p.drift)    ogeler.push(['red', `${p.drift} cihaz ait olduğu lokasyonun dışında`]);
  if (p.warranty) ogeler.push(['orange', `${p.warranty} cihazın garantisi doldu`]);
  if (p.license)  ogeler.push(['blue', `${p.license} lisans yakında sona eriyor`]);
  if (p.disk)     ogeler.push(['red', `${p.disk} cihazın diski dolmak üzere`]);
  if (p.offline)  ogeler.push(['orange', `${p.offline} cihaz çevrimdışı`]);
  (state.railEvents || []).slice(-3).reverse().forEach(e =>
    ogeler.push(['green', `${e.hostname || e.serial_number || 'Cihaz'} — ${e.to_status}`]));
  if (!ogeler.length) ogeler.push(['green', 'Aktif uyarı yok — tüm sistemler normal']);
  const html = ogeler.map(([t, m]) =>
    `<span><i style="background:var(--${t === 'blue' ? 'accent' : t})"></i>${escapeHtml(m)}</span>`).join('');
  box.innerHTML = html + html;   // kesintisiz kayma için iki kopya
}

/* ═══ Kategori filtresi ═══════════════════════════════════════════════════
   Filtre İSTEMCİDE yeniden hesaplar (sunucuya ek istek yok). Trend rozetleri
   sunucudaki filtresiz anlık görüntülerden gelir → filtre etkinken GİZLENİR,
   yoksa "seçili kategorinin %12 artışı" gibi YANLIŞ bir okuma doğardı. */
function buildCategoryFilter(byCategory) {
  const box = $(`#filterCats`);
  if (!box || box.dataset.built === '1') return;
  const cats = Object.keys(byCategory).sort();
  box.innerHTML = cats.map(c =>
    `<label><input type="checkbox" class="f-cat" value="${escapeHtml(c)}"> ${escapeHtml(c)}</label>`).join('');
  box.dataset.built = '1';
  $$('.f-cat').forEach(cb => cb.addEventListener('change', onCatFilterChange));
}

function onCatFilterChange(e) {
  const all = document.querySelector('.f-cat[value=""]');
  if (e.target === all && all.checked) {
    $$('.f-cat').forEach(cb => { if (cb !== all) cb.checked = false; });
  } else if (e.target !== all) {
    if (all) all.checked = false;
  }
  const sel = new Set($$('.f-cat').filter(cb => cb.checked && cb.value).map(cb => cb.value));
  if (!sel.size && all) all.checked = true;
  state.catFilter = sel;
  applyDashFilter();
}

function applyDashFilter() {
  const sel = state.catFilter;
  const active = sel && sel.size > 0;
  const list = active ? (state.allAssets || []).filter(a => sel.has(a.category || 'Diğer')) : (state.allAssets || []);
  state.assets = list;

  // İstatistikleri seçili kümeden yeniden hesapla
  const byCategory = {}, byStatus = {}, locs = {};
  list.forEach(a => {
    const c = a.category || 'Diğer'; byCategory[c] = (byCategory[c] || 0) + 1;
    const st = a.status || 'unknown'; byStatus[st] = (byStatus[st] || 0) + 1;
    const l = (a.location || '').trim(); if (l) locs[l] = (locs[l] || 0) + 1;
  });
  const stats = active
    ? { total: list.length, by_category: byCategory, by_status: byStatus, new_today: 0 }
    : state.rawStats;
  const summary = active
    ? { ...state.rawSummary, locations: locs, location_count: Object.keys(locs).length }
    : state.rawSummary;

  renderStats(stats, summary);
  renderCategoryDonut(stats.by_category || {}, stats.total || 0);
  applyLocViewMode(active ? locs : (state.rawSummary.locations || {}));
  renderRecentTable(list.slice(0, 5));

  // Filtre etkinken trend rozetleri anlamsız → gizle
  ['kpiTotalTrend', 'kpiOnlineTrend', 'kpiStorageTrend', 'kpiOfflineTrend'].forEach(id => {
    const el = $('#' + id);
    if (el && active) { el.className = 'kpi-trend kpi-trend--none'; el.textContent = 'filtre etkin'; }
  });
  ['kpiTotalSpark', 'kpiOnlineSpark', 'kpiStorageSpark', 'kpiOfflineSpark'].forEach(id => {
    const el = $('#' + id); if (el && active) el.innerHTML = '';
  });
}

// Harita / liste görünümü arasında geçiş (seçim korunur)
function applyLocViewMode(locations) {
  state.locations = locations;
  const sel = $(`#locViewMode`);
  const mode = sel ? sel.value : 'map';
  const mapW = $(`#locMapWrap`), listW = $(`#locListWrap`);
  if (mapW) mapW.classList.toggle('hidden', mode !== 'map');
  if (listW) listW.classList.toggle('hidden', mode === 'map');
  if (mode === 'map') renderWorldMap(locations); else renderLocationList(locations);
}

/* KPI trend rozeti — GERÇEK anlık görüntü verisinden.
   Karşılaştıracak geçmiş yoksa oran GÖSTERİLMEZ ("veri birikiyor") — sıfır uydurulmaz. */
function renderTrend(id, t, windowDays) {
  const el = $('#' + id);
  if (!el) return;
  if (!t) {
    el.className = 'kpi-trend kpi-trend--none';
    el.textContent = 'trend için veri birikiyor';
    return;
  }
  const arrow = t.dir === 'up' ? '↑' : (t.dir === 'down' ? '↓' : '→');
  const period = windowDays >= 365 ? 'bu yıl' : (windowDays >= 30 ? 'bu ay' : `${windowDays} günde`);
  el.className = `kpi-trend kpi-trend--${t.dir === 'flat' ? 'flat' : t.dir}`;
  el.textContent = `${arrow} %${Math.abs(t.pct)} ${period}`;
}

/* Sparkline — gerçek günlük serilerden (yoksa çizilmez) */
function sparkFromSeries(id, series, color) {
  const el = $('#' + id);
  if (!el) return;
  const pts = (series || []).map(p => p.value);
  if (pts.length < 4) { el.innerHTML = ''; return; }
  const min = Math.min(...pts), max = Math.max(...pts);
  const W = 78, H = 30;
  const y = (v) => max === min ? H / 2 : H - ((v - min) / (max - min)) * (H - 6) - 3;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderStats(stats, summary) {
  const locEl = $(`#kpiLocations`);
  if (locEl) animateCount(locEl, summary?.location_count || 0);
  const total   = stats.total || 0;
  const online  = stats.by_status?.online  || 0;
  const storage = stats.by_status?.depoda  || 0;
  const offline = stats.by_status?.offline || 0;

  const set = (id, val) => { const el = $('#' + id); if (el) animateCount(el, val); };
  set('kpiTotal', total); set('kpiOnline', online);
  set('kpiStorage', storage); set('kpiOffline', offline);

  // Trend + sparkline: /api/trends'ten gelen GERÇEK anlık görüntülerden
  const tr = state.trends || {};
  const win = tr.window_days || 30;
  renderTrend('kpiTotalTrend',   tr.total,   win);
  renderTrend('kpiOnlineTrend',  tr.online,  win);
  renderTrend('kpiStorageTrend', tr.depoda,  win);
  renderTrend('kpiOfflineTrend', tr.offline, win);

  const series = state.trendSeries || [];
  sparkFromSeries('kpiTotalSpark',   series, 'rgba(255,255,255,.9)');
  sparkFromSeries('kpiOnlineSpark',  state.seriesOnline  || [], '#10b981');
  sparkFromSeries('kpiStorageSpark', state.seriesDepoda  || [], '#f59e0b');
  sparkFromSeries('kpiOfflineSpark', state.seriesOffline || [], '#ef4444');
}

// Toplam içindeki payı gösteren ince çubuk (gerçek oran)
function shareBar(id, pct, color) {
  const el = $('#' + id);
  if (!el) return;
  el.innerHTML = `<svg width="84" height="10" viewBox="0 0 84 10">
    <rect x="0" y="3" width="84" height="4" rx="2" fill="var(--bg-hover)"/>
    <rect x="0" y="3" width="${(Math.max(0, Math.min(100, pct)) / 100) * 84}" height="4" rx="2" fill="${color}"/>
  </svg>`;
}

// Son 14 günün kümülatif envanter büyümesi — created_on alanından hesaplanır
function growthSpark(id, assets) {
  const el = $('#' + id);
  if (!el) return;
  const STEPS = 14;
  const dates = (assets || [])
    .map(a => Date.parse(a.created_on || a.last_seen || ''))
    .filter(t => !Number.isNaN(t));
  if (dates.length < 3) { el.innerHTML = ''; return; }
  // Tüm kayıtlar 1-3 güne sıkışmışsa eğri "L" şeklinde bozuk çıkar → hiç çizme.
  const distinctDays = new Set(dates.map(t => Math.floor(t / 86400000))).size;
  if (distinctDays < 4) { el.innerHTML = ''; return; }
  // Zaman aralığı veriye göre uyarlanır: ilk kayıttan bugüne 14 eşit örnek.
  // Sabit 14 günlük pencere eski envanterlerde düz çizgi verirdi.
  const end = Date.now();
  const start = Math.min(...dates);
  if (end - start < 86400000) { el.innerHTML = ''; return; }
  const pts = [];
  for (let i = 0; i < STEPS; i++) {
    const cut = start + ((end - start) * i) / (STEPS - 1);
    pts.push(dates.filter(t => t <= cut).length);
  }
  const min = Math.min(...pts), max = Math.max(...pts);
  if (max === min) { el.innerHTML = ''; return; }
  const W = 84, H = 30;
  const d = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((v - min) / (max - min)) * (H - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
    aria-label="İlk kayıttan bugüne envanter büyümesi">
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* Türkçe 'İ' toLowerCase'te birleşik nokta (U+0307) üretir; düz replace
   zinciri yakalamaz. NFD ile birleşik işaretler ayıklanır. Arama/eşleştirmede
   DAİMA bu kullanılır. */
function trSlug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

/* ═══ Dünya haritası (ÇEVRİMDIŞI) ═════════════════════════════════════════
   Altlık public/data/world-110m.json'dan gelir — KENDİ sunucumuzdan, dış
   servis yok (kapalı-devre ilkesi). scripts/build-world-map.js ile üretilir.

   Konum artık ADDAN TAHMİN EDİLMEZ: location_geo tablosundaki gerçek lat/lon
   kullanılır. Koordinatı olmayan lokasyon haritada gösterilmez, "haritada
   yok (N)" olarak sayılır — sessizce kaybolmaz.

   Projeksiyon: equirectangular. Görünüm, koordinatı olan lokasyonların
   sınırlayıcı kutusuna otomatik oturur → tek şehirdeyse yakınlaşır,
   kıtalara yayılıysa dünyayı gösterir. Aynı kod, iki müşteri profili. */
let _worldGeo = null;      // { polygons: [[[lon,lat],...], ...] }
let _worldYukleniyor = null;

async function loadWorld() {
  if (_worldGeo) return _worldGeo;
  if (_worldYukleniyor) return _worldYukleniyor;
  _worldYukleniyor = fetch('/data/world-110m.json')
    .then(r => { if (!r.ok) throw new Error('harita verisi alınamadı'); return r.json(); })
    .then(j => { _worldGeo = j; return j; })
    .catch(err => { console.error('[harita]', err.message); _worldGeo = { polygons: [] }; return _worldGeo; });
  return _worldYukleniyor;
}

async function loadLocationGeo() {
  if (state.locGeo) return state.locGeo;
  try {
    const r = await fetch('/api/locations/geo');
    const j = r.ok ? await r.json() : { geo: {}, missing: [] };
    state.locGeo = j.geo || {};
    state.locGeoMissing = j.missing || [];
  } catch { state.locGeo = {}; state.locGeoMissing = []; }
  return state.locGeo;
}

/* Sınırlayıcı kutu + kenar payı → görünüm penceresi.
   Tek nokta varsa çevresine makul bir kutu açılır (aşırı yakınlaşma olmasın). */
function worldViewport(noktalar) {
  if (!noktalar.length) return { lon0: -170, lon1: 190, lat0: -58, lat1: 84 };
  const lats = noktalar.map(p => p.lat), lons = noktalar.map(p => p.lon);
  let lat0 = Math.min(...lats), lat1 = Math.max(...lats);
  let lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  const enPay = Math.max((lon1 - lon0) * 0.35, 6);
  const boyPay = Math.max((lat1 - lat0) * 0.35, 4);
  lon0 -= enPay; lon1 += enPay; lat0 -= boyPay; lat1 += boyPay;
  // En-boy oranını kabaca koru (equirectangular'da 1° boylam < 1° enlem)
  const w = lon1 - lon0, h = lat1 - lat0;
  const hedef = 560 / 300;
  if (w / h < hedef) { const ek = (h * hedef - w) / 2; lon0 -= ek; lon1 += ek; }
  else { const ek = (w / hedef - h) / 2; lat0 -= ek; lat1 += ek; }
  return {
    lon0: Math.max(-180, lon0), lon1: Math.min(180, lon1),
    lat0: Math.max(-85, lat0), lat1: Math.min(85, lat1),
  };
}

/* Dünya haritasını çiz. hedefSvg/hedefLegend id'leri verilir. */
async function renderWorldMap(locations, svgId = 'locMap', legendId = 'locMapLegend') {
  const svg = document.getElementById(svgId), legend = document.getElementById(legendId);
  if (!svg || !legend) return;

  const [world, geo] = await Promise.all([loadWorld(), loadLocationGeo()]);
  const girdiler = Object.entries(locations || {});

  // Koordinatı olan / olmayan ayrımı — olmayan GİZLENMEZ, sayılır
  const yerlesik = [];
  let koordsuz = 0;
  girdiler.forEach(([ad, n]) => {
    const g = geo[ad];
    if (g) yerlesik.push({ ad, n, lat: g.lat, lon: g.lon, label: g.label || ad });
    else koordsuz += n;
  });

  const W = 560, H = 300;
  const vp = worldViewport(yerlesik);
  const px = (lon) => ((lon - vp.lon0) / (vp.lon1 - vp.lon0)) * W;
  const py = (lat) => ((vp.lat1 - lat) / (vp.lat1 - vp.lat0)) * H;

  // Kara parçaları — görünüm dışındakiler atlanır (DOM şişmesin)
  const kara = (world.polygons || []).map(ring => {
    let gorunur = false;
    const d = ring.map(([lon, lat], i) => {
      const x = px(lon), y = py(lat);
      if (x > -60 && x < W + 60 && y > -60 && y < H + 60) gorunur = true;
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return gorunur ? `<path class="map-land" d="${d} Z"/>` : '';
  }).join('');

  // Balonlar — alan ∝ adet
  const sirali = yerlesik.sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...sirali.map(v => v.n));
  const renk = (i) => DONUT_COLORS[i % DONUT_COLORS.length];
  // Etiket çakışma önleme: yakın lokasyonlarda (ör. İstanbul–Kocaeli, 90 km)
  // yazılar üst üste biniyordu. Zaten yazılmış bir etikete çok yakınsa atlanır —
  // balon ve sayı kalır, ad tooltip'te görünür.
  const yazilan = [];
  const cakisiyor = (x, y) => yazilan.some(p => Math.abs(p.x - x) < 46 && Math.abs(p.y - y) < 15);

  const balonlar = sirali.map((v, i) => {
    const r = (6 + Math.sqrt(v.n / max) * 20) * (state.mapZoom || 1);
    const c = renk(i);
    const x = +px(v.lon).toFixed(1), y = +py(v.lat).toFixed(1);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return '';
    const buyuk = r >= 13;
    const ly = +(y - r - (buyuk ? 7 : 5)).toFixed(1);
    const etiketOk = !cakisiyor(x, ly);
    if (etiketOk) yazilan.push({ x, y: ly });
    const etiket = etiketOk
      ? `<text class="map-city${buyuk ? '' : ' map-city--sm'}" x="${x}" y="${ly}">${escapeHtml(v.label)}</text>`
      : '';
    return `<circle class="map-bubble" cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${c}" stroke="${c}">
        <title>${escapeHtml(v.ad)} — ${v.n} cihaz</title></circle>` +
      (buyuk
        ? `<text class="map-count" x="${x}" y="${y + 4}" fill="#fff">${v.n}</text>${etiket}`
        : `<circle class="map-dot" cx="${x}" cy="${y}" r="2.5" fill="${c}"/>${etiket}`);
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = kara + balonlar;

  legend.innerHTML =
    sirali.slice(0, 4).map((v, i) =>
      `<span><i style="background:${renk(i)}"></i>${escapeHtml(v.label)} (${v.n})</span>`).join('') +
    (koordsuz
      ? `<span title="Bu lokasyonların koordinatı tanımlı değil — Ayarlar → Lokasyon Koordinatları"><i style="background:var(--text-muted)"></i>Haritada yok (${koordsuz})</span>`
      : '');
}

function renderLocationList(locations) {
  const box = $(`#locListWrap`);
  if (!box) return;
  const entries = Object.entries(locations || {}).sort((a, b) => b[1] - a[1]);
  const sum = entries.reduce((a, [, n]) => a + n, 0) || 1;
  box.innerHTML = entries.length ? entries.map(([loc, n], i) => `
    <div class="dl-row">
      <span class="dl-name" title="${escapeHtml(loc)}">
        <span class="dl-dot" style="background:${donutColor(loc, i)}"></span>${escapeHtml(loc)}
      </span>
      <span class="dl-pct">${Math.round((n / sum) * 100)}%</span>
      <span class="dl-count">${n}</span>
    </div>`).join('')
    : '<p class="map-empty">Lokasyon verisi yok</p>';
}

/* ─── Donut grafikler ───────────────────────────────────────────────────── */
const DONUT_COLORS = ['#4f46e5', '#10b981', '#a855f7', '#ef4444', '#f59e0b', '#14b8a6', '#6366f1', '#94a3b8'];
const DONUT_MUTED = '#94a3b8'; // "Diğer"/"Belirtilmemiş" toplayıcı dilimler nötr kalır
const donutColor = (label, i) =>
  LOC_STATE_COLORS[label] ||
  ((label === 'Diğer' || label === 'Belirtilmemiş') ? DONUT_MUTED : DONUT_COLORS[i % DONUT_COLORS.length]);

// entries: [[etiket, adet], ...] — tek SVG'de dash-offset ile dilimlenmiş halka
function paintDonut(svgId, legendId, totalId, entries, centerValue, emptyText) {
  const svg = $('#' + svgId), legend = $('#' + legendId), totalEl = $('#' + totalId);
  if (!svg || !legend) return;
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (totalEl) totalEl.textContent = (centerValue ?? sum).toLocaleString('tr-TR');
  if (!sum) {
    svg.innerHTML = `<circle cx="60" cy="60" r="42" fill="none" stroke="var(--bg-hover)" stroke-width="18"/>`;
    legend.innerHTML = `<p style="color:var(--text-muted);font-size:13px">${emptyText}</p>`;
    return;
  }
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  svg.innerHTML = entries.map(([label, n], i) => {
    const len = (n / sum) * C;
    const seg = `<circle class="donut-seg" cx="60" cy="60" r="${R}" fill="none"
      stroke="${donutColor(label, i)}" stroke-width="18"
      stroke-dasharray="${len - 1.5} ${C - len + 1.5}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return seg;
  }).join('');

  legend.innerHTML = entries.map(([label, n], i) => `
    <div class="dl-row">
      <span class="dl-name" title="${escapeHtml(label)}">
        <span class="dl-dot" style="background:${donutColor(label, i)}"></span>${escapeHtml(label)}
      </span>
      <span class="dl-pct">${Math.round((n / sum) * 100)}%</span>
      <span class="dl-count">${n.toLocaleString('tr-TR')}</span>
    </div>`).join('');
}

/* Lokasyon durumu efsanesi tasarımdaki "1.210 (97%)" biçiminde tek sütun */
function paintDonutCombined(svgId, legendId, totalId, entries, centerValue, emptyText) {
  paintDonut(svgId, legendId, totalId, entries, centerValue, emptyText);
  const legend = $('#' + legendId);
  if (!legend) return;
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (!sum) return;
  legend.innerHTML = entries.map(([label, n], i) => `
    <div class="dl-row dl-row--combined">
      <span class="dl-name" title="${escapeHtml(label)}">
        <span class="dl-dot" style="background:${donutColor(label, i)}"></span><span class="dl-txt">${escapeHtml(label)}</span>
      </span>
      <span class="dl-count">${n.toLocaleString('tr-TR')} <span class="dl-pct">(${Math.round((n / sum) * 100)}%)</span></span>
    </div>`).join('');
}

function renderCategoryDonut(byCategory, total) {
  // İlk 5 kategori + kalanı "Diğer" altında topla (efsane okunur kalsın)
  const all = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5);
  const restSum = all.slice(5).reduce((a, [, n]) => a + n, 0);
  if (restSum) top.push(['Diğer', restSum]);
  paintDonut('catDonut', 'catLegend', 'catDonutTotal', top, total, 'Kategori verisi yok');
}

/* ═══ Lokasyon uyumsuzluğu — şiddet dağılımı ══════════════════════════════
   Şiddet SÜREDEN türer (uydurma ağırlık yok): kritik ≥30 gün · uyarı eşik-30 ·
   bilgilendirme eşik altı (henüz uyarı üretmeyen taze sapmalar). */
function renderMismatch(summary) {
  const sev = summary.severity || {};
  const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = `${v} cihaz`; };
  set('sevKritik', sev.kritik || 0);
  set('sevUyari', sev.uyari || 0);
  set('sevBilgi', sev.bilgi || 0);
  setPill('mismatchPill', summary.tasinmis || 0);

  // Kapsam dürüstlüğü: baseline'ı olmayan cihazlar bu tabloda GÖRÜNMEZ.
  const note = $(`#sevNote`);
  if (note) {
    note.textContent = summary.baseline_yok > 0
      ? `${summary.baseline_yok} cihazın beklenen lokasyonu tanımlı değil — bu tablonun dışındalar. Ayarlar → Lokasyon İzleme'den tanımlayın.`
      : `Eşik: ${summary.threshold_days} gün. Kritik = 30+ gündür yerinde değil.`;
  }
}

/* Varlık lokasyon durumu — her cihaz TEK kovada, toplam = envanter */
function renderLocationStateDonut(summary) {
  const entries = [
    ['Doğru Lokasyonda', summary.dogru || 0],
    ['Taşınmış', summary.tasinmis || 0],
    ['Lokasyonu Güncellenen', summary.guncellenen || 0],
    ['Baseline Yok', summary.baseline_yok || 0],
    ['Bilinmeyen', summary.bilinmeyen || 0],
  ].filter(([, n]) => n > 0);
  paintDonutCombined('locStateDonut', 'locStateLegend', 'locStateTotal', entries, summary.total, 'Lokasyon verisi yok');
}

const LOC_STATE_COLORS = {
  'Doğru Lokasyonda': '#10b981', 'Taşınmış': '#f59e0b',
  'Lokasyonu Güncellenen': '#4f46e5', 'Baseline Yok': '#94a3b8', 'Bilinmeyen': '#ef4444',
};

/* ═══ Son aktiviteler — yaşam döngüsü kayıtlarından (gerçek olaylar) ═══════ */
const ACT_ICON = {
  'Lokasyon Değişikliği': ['blue', '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'],
  'Bakımda': ['orange', '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'],
  'Hurdaya Ayrıldı': ['red', '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
  'Kayıp': ['red', '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'],
};
const ACT_DEFAULT = ['green', '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'];

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} saat önce`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} gün önce` : fmtDate(iso);
}

function renderActivities(events, hedef = 'activityList') {
  const box = $('#' + hedef);
  if (!box) return;
  const list = (events || []).slice(-5).reverse();
  if (!list.length) { box.innerHTML = '<p class="map-empty">Henüz kayıtlı işlem yok</p>'; return; }
  box.innerHTML = list.map((e) => {
    const [tone, icon] = ACT_ICON[e.to_status] || ACT_DEFAULT;
    const who = e.hostname || e.serial_number || 'Cihaz';
    return `<div class="act-item">
      <span class="act-ico kpi-ico--${tone}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </span>
      <span class="act-txt">
        <strong>${escapeHtml(who)} — ${escapeHtml(e.to_status || '')}</strong>
        <span>${escapeHtml(e.note || e.actor || '')}</span>
      </span>
      <span class="act-time">${timeAgo(e.timestamp)}</span>
    </div>`;
  }).join('');
}

/* ═══ Kritik uyarı şeridi — mevcut tespit modüllerinden ═══════════════════ */
function renderCriticalStrip(parts) {
  const box = $(`#critStrip`);
  if (!box) return;
  const chips = [
    { n: parts.drift,    t: 'Lokasyon Dışı Cihazlar', tone: 'red',    view: 'alerts' },
    { n: parts.warranty, t: 'Garanti Süresi Dolan',   tone: 'orange', view: 'alerts' },
    { n: parts.uptime,   t: 'Yeniden Başlatma Gerekli', tone: 'orange', view: 'alerts' },
    { n: parts.disk,     t: 'Disk Alanı Düşük',       tone: 'red',    view: 'alerts' },
  ];
  setPill('critPill', chips.reduce((a, c) => a + c.n, 0));
  box.innerHTML = chips.map(c => `
    <button class="crit-chip" data-view="${c.view}">
      <span class="sev-ico sev-ico--${c.tone}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </span>
      <div><strong>${c.t}</strong><span>${c.n} cihaz</span></div>
    </button>`).join('');
}

/* ═══ Öneri — KURAL TABANLI, LLM ÇAĞRISI YOK ══════════════════════════════
   Dashboard açılışında LLM çağırmak yavaş + küçük modelde bozuk TR üretiyor
   (bkz. deterministik tespit kararı). En yüksek etkili sinyal seçilip
   sabit metinle sunulur — sayılar gerçek, cümle uydurma değil. */
function renderInsight(summary, parts) {
  const el = $(`#insightText`), btn = $(`#insightBtn`);
  if (!el) return;
  let msg, go = null;
  if (summary.baseline_yok > 0) {
    msg = `${summary.baseline_yok} cihazın beklenen lokasyonu tanımlı değil; bu cihazlar sapma taramasının dışında kalıyor. Ayarlar → Lokasyon İzleme'den mevcut lokasyonları başlangıç olarak alabilirsiniz.`;
    go = 'settings';
  } else if ((summary.severity?.kritik || 0) > 0) {
    msg = `${summary.severity.kritik} cihaz 30 günden uzun süredir ait olduğu lokasyonun dışında. Transferi resmileştirin veya cihazları yerine iade ettirin.`;
    go = 'alerts';
  } else if (summary.tasinmis > 0) {
    msg = `${summary.tasinmis} cihaz farklı lokasyonda görülüyor. Lokasyonlarını güncellemenizi öneririz.`;
    go = 'alerts';
  } else if (parts.warranty > 0) {
    msg = `${parts.warranty} cihazın garanti süresi dolmuş. Yenileme bütçesi için Risk & Öngörü ekranına bakın.`;
    go = 'insights';
  } else if (summary.bilinmeyen > 0) {
    msg = `${summary.bilinmeyen} cihazın lokasyon bilgisi hiç yok. Lokasyon ajanı kurulumu veya QR kaydıyla bu boşluk kapanır.`;
    go = 'assets';
  } else {
    msg = 'Lokasyon uyumu tam — tüm cihazlar ait olduğu yerde görünüyor.';
  }
  el.textContent = msg;
  if (btn) {
    btn.style.display = go ? '' : 'none';
    btn.onclick = go ? () => showView(go) : null;
  }
}

function renderLocationDonut(assets) {
  const counts = {};
  (assets || []).forEach((a) => {
    const loc = (a.location || '').trim() || 'Belirtilmemiş';
    counts[loc] = (counts[loc] || 0) + 1;
  });
  const all = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = all.slice(0, 5);
  const restSum = all.slice(5).reduce((a, [, n]) => a + n, 0);
  if (restSum) top.push(['Diğer', restSum]);
  paintDonut('locDonut', 'locLegend', 'locDonutTotal', top, all.length, 'Lokasyon verisi yok');
}

function renderBrandChart(byBrand) {
  const entries = Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#brandBars`);
  if (!container) return;
  container.innerHTML = entries
    .map(([brand, count]) => `
      <div class="bar-row">
        <span class="bar-label" title="${brand}">${brand}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`)
    .join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';

  // Animate bars
  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach((el) => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 100);
}

function renderCategoryChart(byCategory) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#categoryBars`);
  if (!container) return;
  container.innerHTML = entries
    .map(([cat, count]) => {
      const cls = CAT_CLASS[cat] || 'diger';
      return `
        <div class="bar-row">
          <span class="bar-label" title="${cat}">${cat}</span>
          <div class="bar-track"><div class="bar-fill cat-bar cat-bar--${cls}" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
          <span class="bar-count">${count}</span>
        </div>`;
    })
    .join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';

  setTimeout(() => {
    container.querySelectorAll('.cat-bar').forEach((el) => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 100);
}

function renderStatusChart(byStatus) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const container = $(`#statusRings`);
  if (!container) return;
  const items = [
    { key: 'online', label: 'Cevrimici', cls: 'online' },
    { key: 'offline', label: 'Cevrimdisi', cls: 'offline' },
    { key: 'unknown', label: 'Bilinmiyor', cls: 'unknown' },
  ];
  container.innerHTML = items.map(({ key, label, cls }) => {
    const count = byStatus[key] || 0;
    const pct = Math.round((count / total) * 100);
    return `
      <div class="ring-row">
        <span class="ring-dot ring-dot--${cls}"></span>
        <div class="ring-info">
          <div style="display:flex;justify-content:space-between;"><span class="ring-name">${label}</span><span style="font-size:12px;color:var(--text-muted)">${count}</span></div>
          <div class="ring-track"><div class="ring-fill ring-fill--${cls}" style="width:0%" data-pct="${pct}"></div></div>
        </div>
        <span class="ring-pct">${pct}%</span>
      </div>`;
  }).join('');

  setTimeout(() => {
    container.querySelectorAll('.ring-fill').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  }, 100);
}

function renderLocationChart(assets) {
  const container = $(`#locationBars`);
  if (!container) return;
  const counts = {};
  (assets || []).forEach((a) => {
    const loc = (a.location || '').trim() || 'Belirtilmemiş';
    counts[loc] = (counts[loc] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = entries[0]?.[1] || 1;
  const totalEl = $(`#locationTotal`);
  if (totalEl) totalEl.textContent = `${entries.length} lokasyon`;
  container.innerHTML = entries.length ? entries
    .map(([loc, count]) => `
      <div class="bar-row">
        <span class="bar-label" title="${escapeHtml(loc)}">${escapeHtml(loc)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`).join('')
    : '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  }, 100);
}




