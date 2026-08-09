/* AssetMan · init.js
   DOMContentLoaded: tum olay baglantilari (EN SON yuklenir)

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

/* ─── Event Listeners ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  $$('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showView(item.dataset.view);
    });
  });

  // Link to assets from dashboard
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view]');
    if (link && !link.classList.contains('nav-item')) {
      e.preventDefault();
      showView(link.dataset.view);
    }
  });

  // Refresh button
  $(`#refreshBtn`)?.addEventListener('click', () => {
    const icon = $(`#refreshBtn svg`);
    icon.classList.add('spinning');
    loadDashboard().finally(() => setTimeout(() => icon.classList.remove('spinning'), 500));
  });

  // Çıkış yap
  $(`#logoutBtn`)?.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = '/login';
  });

  // Topbar tema düğmesi — Ayarlar'daki tercihle aynı anahtarı kullanır
  $(`#themeToggle`)?.addEventListener('click', () => {
    const cur = localStorage.getItem('theme') || 'auto';
    const isDark = cur === 'dark' ||
      (cur === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    const sel = $(`#setTheme`); if (sel) sel.value = next;
  });

  // Bildirim zili → Uyarılar görünümü
  $(`#bellBtn`)?.addEventListener('click', () => showView('alerts'));

  // TV modu: kayıtlı tercih yoksa yalnız çok geniş ekranda (≥2200) önerilir
  const savedTv = localStorage.getItem('tvMode');
  applyTvMode(savedTv === null ? window.matchMedia('(min-width: 2200px)').matches : savedTv === '1');
  $(`#tvToggle`)?.addEventListener('click', () =>
    applyTvMode(!document.body.classList.contains('tv-mode')));
  /* Operasyon Merkezi'nin sağ üstündeki kapat düğmesi. HTML'de vardı ama hiçbir
     dinleyicisi yoktu — TV moduna girince çıkışın TEK görünür yolu bu düğme
     olduğu için kullanıcı ekranda kilitli kalıyordu (üst çubuk TV modunda
     gizli, #tvToggle'a ulaşılamıyor). */
  $(`#tvxExit`)?.addEventListener('click', () => applyTvMode(false));
  /* Klavye kaçışı: duvar ekranında fare olmayabilir, ayrıca düğme bir daha
     kırılırsa kullanıcı sıkışmasın. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.body.classList.contains('tv-mode')) return;
    // Açık bir modal varsa Escape ÖNCE onu kapatsın; tek tuşla hem modalı
    // kapatıp hem TV modundan çıkmak beklenmedik olurdu.
    if (document.querySelector('.modal-overlay.open')) return;
    applyTvMode(false);
  });
  // Ekran daraldıysa (döndürme / pencere küçültme) TV modundan otomatik çık
  window.addEventListener('resize', () => {
    if (document.body.classList.contains('tv-mode') && window.innerWidth < TV_MIN_WIDTH) applyTvMode(false);
  });

  // Hesap menüsü (topbar avatar + sidebar üç nokta)
  const userMenu = $(`#userMenu`);
  const toggleUserMenu = (e) => { e.stopPropagation(); userMenu?.classList.toggle('open'); };
  $(`#userChip`)?.addEventListener('click', toggleUserMenu);
  $(`#sbUserMenu`)?.addEventListener('click', toggleUserMenu);
  document.addEventListener('click', (e) => {
    if (userMenu && !e.target.closest('#userMenu')) userMenu.classList.remove('open');
  });
  $(`#menuSettings`)?.addEventListener('click', () => {
    userMenu?.classList.remove('open');
    if (state.role === 'admin') showView('settings');
    else alert('Ayarlar yalnızca yönetici rolündeki kullanıcılara açıktır.');
  });

  // Hızlı İşlemler
  /* Modal her açılışta FORM durumuna döner: adım göstergesi 1'e oturur ve
     önceki oturumdan kalan bekleme/başarı ekranı görünmez. */
  const qrAc = () => {
    qrfDurdur(); _qrfJeton = null; qrfDurum('form');
    $(`#qrModalOverlay`)?.classList.add('open');
    blkLokasyonlar(); blkOnizle();      // toplu sekmesi de hazır gelsin
  };
  $(`#qaAddAsset`)?.addEventListener('click', qrAc);
  $(`#qaBulk`)?.addEventListener('click', () => {
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });
  $(`#qaLifecycle`)?.addEventListener('click', () => showView('lifecycle'));
  $(`#qaReport`)?.addEventListener('click', () => showView('reports'));

  // İşlemler görünümü + Kullanıcı ekle
  $(`#opAddAsset`)?.addEventListener('click', qrAc);
  $(`#opBulk`)?.addEventListener('click', () => {
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });
  $(`#opLifecycle`)?.addEventListener('click', () => showView('lifecycle'));
  $(`#opReport`)?.addEventListener('click', () => showView('reports'));
  $(`#openUserModal`)?.addEventListener('click', createUserPrompt);

  // KPI kartından duruma göre filtrelenmiş Varlıklar görünümü
  $$('.kpi[data-status]').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const sel = $(`#filterStatus`);
      if (sel) sel.value = card.dataset.status;
      showView('assets');
    });
  });

  // Sidebar daralt/genişlet (tercih localStorage'da saklanır)
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  // Masaüstünde daralt/genişlet, mobilde drawer aç/kapa (aynı düğme)
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const openDrawer = () => {
    document.body.classList.add('drawer-open');
    const sc = $(`#drawerScrim`); if (sc) sc.hidden = false;
  };
  const closeDrawer = () => document.body.classList.remove('drawer-open');

  $(`#sidebarToggle`)?.addEventListener('click', () => {
    if (isMobile()) {
      document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
      return;
    }
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  });
  $(`#drawerClose`)?.addEventListener('click', closeDrawer);
  $(`#drawerScrim`)?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  // Menüden bir sayfa seçilince drawer kapanır
  $$('.nav-item[data-view]').forEach((n) => n.addEventListener('click', () => { if (isMobile()) closeDrawer(); }));
  // Masaüstüne dönülürse drawer durumu temizlenir
  window.addEventListener('resize', () => { if (!isMobile()) closeDrawer(); });

  // Alt sekme çubuğu
  $$('.tab[data-view]').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $(`#tabMore`)?.addEventListener('click', openDrawer);

  // Topbar araması → Varlıklar sayfasındaki aramayı besler
  $(`#searchInput`)?.addEventListener('input', (e) => {
    const box = $(`#assetSearch`);
    if (box) { box.value = e.target.value; }
    if (state.currentView === 'assets') { state.assetPage = 1; paintAssetsTable(); }
    else if (e.target.value.trim()) showView('assets');
  });

  /* ── Varlıklar v2: filtreler istemcide, sunucuya tekrar gidilmez ── */
  const yenidenCiz = () => { state.assetPage = 1; state.mobileShown = 0; paintAssetsTable(); };
  let aramaZaman = null;
  $(`#assetSearch`)?.addEventListener('input', () => {
    clearTimeout(aramaZaman);
    aramaZaman = setTimeout(yenidenCiz, 180);   // her tuşta yeniden çizme
  });
  ['filterCategory', 'filterLocation', 'filterStatus'].forEach(id =>
    $('#' + id)?.addEventListener('change', yenidenCiz));
  $(`#rowsPerPage`)?.addEventListener('change', yenidenCiz);
  $(`#clearFiltersBtn`)?.addEventListener('click', () => {
    ['assetSearch', 'filterCategory', 'filterLocation', 'filterStatus'].forEach(id => {
      const el = $('#' + id); if (el) el.value = '';
    });
    const t = $(`#searchInput`); if (t) t.value = '';
    state.assetSort = null;
    yenidenCiz();
  });

  // Sütun başlığına tıkla → sırala (aynı sütun tekrar → yön değişir)
  $$('.asset-table--v2 th.sortable').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.assetSort?.key === k) {
      state.assetSort = state.assetSort.dir === 'asc' ? { key: k, dir: 'desc' } : null;
    } else state.assetSort = { key: k, dir: 'asc' };
    yenidenCiz();
  }));

  // Mobil: kümülatif yükleme
  $(`#loadMoreBtn`)?.addEventListener('click', () => {
    const per = Number($(`#rowsPerPage`)?.value) || 25;
    state.mobileShown = (state.mobileShown || per) + per;
    paintAssetsTable();
  });

  // Toplu seçim
  $(`#selectAll`)?.addEventListener('change', (e) => {
    state.selectedAssets = state.selectedAssets || new Set();
    // "Tümü" YALNIZ filtre kapsamındakileri seçer (görünmeyeni sessizce seçmez)
    (state.renderedAssets || []).forEach(a =>
      e.target.checked ? state.selectedAssets.add(a.id) : state.selectedAssets.delete(a.id));
    paintAssetsTable();
  });
  $(`#bulkClearBtn`)?.addEventListener('click', () => {
    state.selectedAssets = new Set();
    paintAssetsTable();
  });
  $(`#bulkExportBtn`)?.addEventListener('click', () => {
    const sel = state.selectedAssets || new Set();
    exportAssetsCSV((state.allAssets || []).filter(a => sel.has(a.id)));
  });

  // Başlıktaki "diğer işlemler" menüsü
  $(`#assetsMoreBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#assetsMoreMenu`)?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#assetsMoreBtn')) $(`#assetsMoreMenu`)?.classList.remove('open');
  });
  $(`#assetsRefreshBtn`)?.addEventListener('click', () => {
    $(`#assetsMoreMenu`)?.classList.remove('open'); renderAssetsTable();
  });
  $(`#bulkStockBtn`)?.addEventListener('click', () => {
    $(`#assetsMoreMenu`)?.classList.remove('open');
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });

  // Chat FAB
  $(`#chatFab`)?.addEventListener('click', toggleChat);
  $(`#closeChat`)?.addEventListener('click', toggleChat);

  // Clear chat
  $(`#clearChat`)?.addEventListener('click', async () => {
    await clearChatSession();
    const container = $(`#chatMessages`);
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="msg msg--ai">
          <div class="msg-bubble">Merhaba, ben AssetMan Asistan. Size nasıl yardımcı olabilirim?</div>
        </div>
        <div class="quick-prompts">
          <button class="quick-btn" data-q="Kaç cihazım var? Genel bir özet ver.">Genel Özet</button>
          <button class="quick-btn" data-q="Hangi markalar var ve dağılımı nedir?">Marka Analizi</button>
          <button class="quick-btn" data-q="En az RAM'e sahip 5 cihazı listele.">Düşük RAM</button>
          <button class="quick-btn" data-q="Cevrimdışı olan cihazlar var mı?">Çevrimdışı</button>
        </div>
      </div>`;
  });

  // Chat send
  $(`#chatSend`)?.addEventListener('click', () => {
    handleSendChat($(`#chatInput`).value);
  });
  $(`#chatInput`)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat($(`#chatInput`).value);
    }
  });

  // Quick prompts
  $(`#chatMessages`)?.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-btn');
    if (btn) {
      toggleChat(); // make sure open
      if (!state.chatOpen) toggleChat();
      handleSendChat(btn.dataset.q);
    }
  });

  // License filters
  $(`#licFilterStatus`)?.addEventListener('change', () => state.licenses && renderLicenseTable(state.licenses));
  $(`#licFilterType`)?.addEventListener('change', () => state.licenses && renderLicenseTable(state.licenses));
  $(`#licSearch`)?.addEventListener('input', () => state.licenses && renderLicenseTable(state.licenses));

  rpKur();   // Raporlar sayfası (katalog + belge önizlemesi)

  // QR ile Cihaz Ekle modalı
  const qrOverlay = $(`#qrModalOverlay`);
  $(`#openAddModal`)?.addEventListener('click', () => qrOverlay?.classList.add('open'));
  $(`#closeQrModal`)?.addEventListener('click', () => { qrfDurdur(); blkQrKapat(); qrOverlay?.classList.remove('open'); });
  qrOverlay?.addEventListener('click', (e) => { if (e.target === qrOverlay) qrOverlay.classList.remove('open'); });

  // Excel/CSV dışa aktarım
  $(`#exportCsvBtn`)?.addEventListener('click', exportAssetsCSV);

  // Cihaz detay modalı
  const devOverlay = $(`#deviceModalOverlay`);
  // Kapanışta TV panosunun zamanlayıcıları da durur (aksi halde arka planda
  // sonsuza kadar istek atmaya devam ederdi).
  const devKapat = () => { tvaDurdur(); devOverlay?.classList.remove('open', 'tva-open'); };
  $(`#closeDeviceModal`)?.addEventListener('click', devKapat);
  devOverlay?.addEventListener('click', (e) => { if (e.target === devOverlay) devKapat(); });
  $(`#handoverPdfBtn`)?.addEventListener('click', () => printHandoverReceipt(_deviceModalAsset));

  // Ayarlar kaydet butonları
  $(`#saveThresholds`)?.addEventListener('click', saveThresholds);
  $(`#seedExpectedBtn`)?.addEventListener('click', seedExpectedLocations);
  $(`#geoSeedBtn`)?.addEventListener('click', geoSeed);
  $(`#imgCatBtn`)?.addEventListener('click', imageCategoryPrompt);
  $(`#imgFile`)?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';                      // aynı dosya tekrar seçilebilsin
    if (f) imageUpload(f);
  });

  /* Tarih aralığı + Filtrele: tasarımda ≥901px'te TOPBAR'da, mobilde başlık
     altında duruyor. CSS iki farklı kapsayıcı arasında taşıyamaz → tek öğe
     JS ile uygun montaj noktasına taşınır (kopya YOK, olay bağları korunur). */
  const toolbar = $(`.dash-toolbar`);
  const slot = $(`#topbarToolbarSlot`);
  const headerMount = $(`#view-dashboard .page-header`);
  function placeToolbar() {
    if (!toolbar || !slot || !headerMount) return;
    const wide = window.matchMedia('(min-width: 901px)').matches;
    const target = wide ? slot : headerMount;
    if (toolbar.parentElement !== target) target.appendChild(toolbar);
  }
  placeToolbar();
  window.addEventListener('resize', placeToolbar);

  // ── Tarih aralığı seçici: trend penceresini VE zaman bazlı kartları etkiler ──
  state.rangeDays = Number(localStorage.getItem('dashRangeDays')) || 30;
  const rangeLbl = { 7: 'Son 7 gün', 30: 'Son 30 gün', 90: 'Son 90 gün', 365: 'Son 1 yıl' };
  const setRangeLabel = () => {
    const el = $(`#dateRangeLabel`); if (el) el.textContent = rangeLbl[state.rangeDays] || 'Son 30 gün';
    $$('#dateRangeMenu button').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === state.rangeDays));
  };
  setRangeLabel();
  $(`#dateRangeBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#filterMenu`)?.classList.remove('open');
    $(`#dateRangeMenu`)?.classList.toggle('open');
  });
  $$('#dateRangeMenu button').forEach((b) => b.addEventListener('click', () => {
    state.rangeDays = Number(b.dataset.days) || 30;
    localStorage.setItem('dashRangeDays', String(state.rangeDays));
    setRangeLabel();
    $(`#dateRangeMenu`)?.classList.remove('open');
    loadDashboard();
  }));

  // ── Filtrele: kategoriye göre dashboard'ı daralt ──
  $(`#filterBtn`)?.addEventListener('click', (e) => {
    e.stopPropagation(); $(`#dateRangeMenu`)?.classList.remove('open');
    $(`#filterMenu`)?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dash-toolbar')) {
      $(`#dateRangeMenu`)?.classList.remove('open');
      $(`#filterMenu`)?.classList.remove('open');
    }
  });

  // ── Harita yakınlaştırma (balon ölçeği) ──
  state.mapZoom = 1;
  const zoom = (f) => {
    state.mapZoom = Math.min(2.5, Math.max(0.6, (state.mapZoom || 1) * f));
    renderWorldMap(state.locations || {});
  };
  $(`#mapZoomIn`)?.addEventListener('click', () => zoom(1.25));
  $(`#mapZoomOut`)?.addEventListener('click', () => zoom(0.8));

  // Lokasyon kartı: harita/liste geçişi + KPI kartından liste görünümüne atlama
  $(`#locViewMode`)?.addEventListener('change', () => applyLocViewMode(state.locations || {}));
  $(`#kpiLocCard`)?.addEventListener('click', (e) => {
    e.preventDefault();
    const sel = $(`#locViewMode`);
    if (sel) { sel.value = 'list'; applyLocViewMode(state.locations || {}); }
    $(`#locListWrap`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Şiddet satırları → Uyarılar görünümü
  $$('.sev-row').forEach((r) => r.addEventListener('click', () => showView('alerts')));
  $(`#saveAppearance`)?.addEventListener('click', saveAppearance);

  // Hat (Turkcell) modalı + CSV import
  const lineOverlay = $(`#lineModalOverlay`);
  /* Hat filtreleri — hepsi istemcide, her değişiklikte tabloyu yeniden çizer.
     Sayfa 1'e dönülür: 3. sayfadayken filtre daraltılınca boş ekran kalırdı. */
  const lineFiltreDegisti = () => { _linePage = 1; renderLinesTable(); };
  $(`#lineSearch`)?.addEventListener('input', (e) => { _lineFiltre.q = e.target.value; lineFiltreDegisti(); });
  $(`#lineFilterOp`)?.addEventListener('change', (e) => { _lineFiltre.op = e.target.value; lineFiltreDegisti(); });
  $(`#lineFilterStatus`)?.addEventListener('change', (e) => { _lineFiltre.status = e.target.value; lineFiltreDegisti(); });
  $(`#lineFilterTariff`)?.addEventListener('change', (e) => { _lineFiltre.tariff = e.target.value; lineFiltreDegisti(); });
  $(`#lineFilterClear`)?.addEventListener('click', () => {
    _lineFiltre.q = ''; _lineFiltre.op = ''; _lineFiltre.status = ''; _lineFiltre.tariff = '';
    const s1 = $(`#lineSearch`); if (s1) s1.value = '';
    lineFiltreSecenekleri();
    lineFiltreDegisti();
  });
  $(`#linePrev`)?.addEventListener('click', () => { if (_linePage > 1) { _linePage--; renderLinesTable(); } });
  $(`#lineNext`)?.addEventListener('click', () => { _linePage++; renderLinesTable(); });
  $(`#linePageSize`)?.addEventListener('change', (e) => {
    _linePageSize = Number(e.target.value) || 25; _linePage = 1; renderLinesTable();
  });
  $(`#linesMore`)?.addEventListener('click', () => exportLinesCsv());

  $(`#openAddLine`)?.addEventListener('click', openLineModal);
  // Form her değişiklikte önizlemeyi tazeler
  ['#lineMsisdn', '#lineIccid', '#lineOperatorDiger', '#lineTariff'].forEach((sel) =>
    $(sel)?.addEventListener('input', lineFormKontrol));
  ['#lineStatus', '#lineOperator'].forEach((sel) =>
    $(sel)?.addEventListener('change', lineFormKontrol));
  // "Diğer" seçilince serbest metin alanı açılır
  $(`#lineOperator`)?.addEventListener('change', lineOperatorDigerGoster);
  $(`#lineTariffTemizle`)?.addEventListener('click', () => {
    const e = $(`#lineTariff`); if (e) { e.value = ''; e.focus(); }
    lineFormKontrol();
  });
  lineScanKur();
  $(`#lineIccidScan`)?.addEventListener('click', lineScanBaslat);
  $(`#lineScanClose`)?.addEventListener('click', lineScanDurdur);
  // Modal her nasıl kapanırsa kapansın kamera da kapanmalı — açık kalan
  // kamera ışığı ürkütücü. Tek kapatma yolu: kapat / geri / iptal / dışarı.
  const lineKapat = () => { lineScanDurdur(); lineTvDurdur(); lineOverlay?.classList.remove('open'); };

  /* Uzaktan kumanda: OK/Enter Kaydet'i tetikler, Geri/Escape modalı kapatır.
     TV modunda başlıktaki X gizli olduğu için Escape'in bağlı olması ŞART —
     yoksa kumandayla açılan modaldan çıkış yolu kalmaz. */
  /* Escape belge düzeyinde ve YAKALAMA evresinde: odak modalın dışında olsa
     bile çalışsın, ayrıca TV modundan çıkış dinleyicisinden önce koşup onu
     durdursun — tek Escape'te hem modalı kapatıp hem TV'den çıkmak
     beklenmedik olurdu. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !lineOverlay?.classList.contains('open')) return;
    e.stopImmediatePropagation();
    lineKapat();
  }, true);

  lineOverlay?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !document.body.classList.contains('tv-mode')) return;
    if (e.target.closest('button, select, textarea, a')) return;
    e.preventDefault();
    $(`#saveLineBtn`)?.click();
  });
  ['#closeLineModal', '#lineModalGeri', '#cancelLineBtn', '#lineOzetKapat'].forEach((sel) =>
    $(sel)?.addEventListener('click', lineKapat));
  lineOverlay?.addEventListener('click', (e) => { if (e.target === lineOverlay) lineKapat(); });
  $(`#saveLineBtn`)?.addEventListener('click', saveLine);
  $(`#importLinesBtn`)?.addEventListener('click', () => $(`#lineCsvInput`)?.click());
  $(`#lineCsvInput`)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importLinesCsv(String(reader.result || '')); e.target.value = ''; };
    reader.readAsText(file, 'utf-8');
  });

  /* ═══ QR ile Kayıt akışı — form → bekleme → başarı ═════════════════════
     Tasarım QR üretildikten sonra CANLI bekleme istiyor: cihaz kaydolunca
     ekran kendiliğinden ilerliyor. Bunu jeton durumunu yoklayarak yapıyoruz
     (/api/register/tokens/:jti). Sunucu jetonun hangi varlığı oluşturduğunu
     tutuyor, panel de onu okuyup cihaz kartını çiziyor. */
  let _qrfTimer = null;
  let _qrfJeton = null;

  function qrfDurdur() {
    if (_qrfTimer) { clearInterval(_qrfTimer.sayac); clearInterval(_qrfTimer.yokla); _qrfTimer = null; }
  }

  function qrfDurum(ad) {
    const goster = (id, v) => { const e = $(id); if (e) e.style.display = v; };
    /* TV adım göstergesi akışın GERÇEK durumundan sürülür — uydurma ilerleme
       çubuğu değil. form=1, bekleme=2, başarı=3. */
    const adim = ad === 'form' ? 1 : ad === 'bekle' ? 2 : 3;
    $$('.qrf-nav-s').forEach((e) => {
      const n = Number(e.dataset.s);
      e.classList.toggle('aktif', n === adim);
      e.classList.toggle('tamam', n < adim);
    });
    goster(`#qrfForm`, ad === 'form' ? '' : 'none');
    goster(`#qrfWait`, ad === 'bekle' ? '' : 'none');
    goster(`#qrfDone`, ad === 'bitti' ? '' : 'none');
    goster(`#generateQr`, ad === 'form' ? '' : 'none');
    goster(`#qrfCancel`, ad === 'bitti' ? 'none' : '');
    goster(`#printQr`, ad === 'bekle' ? 'flex' : 'none');
    goster(`#qrfContinue`, ad === 'bitti' ? '' : 'none');
    goster(`#qrfAgain`, ad === 'bitti' ? '' : 'none');
    const iptal = $(`#qrfCancel`);
    if (iptal) iptal.textContent = ad === 'bekle' ? 'İptal Et' : 'İptal';
  }

  /* Bekleme adımları. Tasarımda "Aynı Ağ: Bağlı ✓" ve "Cihaz Açık: Kontrol
     Ediliyor" vardı — sunucunun telefonun hangi ağda olduğunu ya da cihazın
     açık olduğunu bilme yolu YOK. Uydurma onay koymak yerine ilk ikisi ÖN
     KOŞUL olarak (nötr) gösteriliyor; yalnız sonuncusu gerçek durumu yansıtıyor. */
  function qrfAdimlar(baglandi) {
    const kutu = $(`#qrfSteps`);
    if (!kutu) return;
    const satir = (ad, durum, sinif) =>
      `<div class="qrf-step ${sinif}"><span>${ad}</span><b>${durum}</b></div>`;
    kutu.innerHTML =
      satir('Aynı ağda olmalı', 'ön koşul', 'notr') +
      satir('Cihaz açık olmalı', 'ön koşul', 'notr') +
      satir('Cihaz kaydı', baglandi ? 'Tamamlandı' : 'Bekleniyor...', baglandi ? 'ok' : 'bekle');
  }

  function qrfSayac(bitis) {
    const kalanMs = () => Math.max(0, new Date(bitis).getTime() - Date.now());
    const toplam = kalanMs() || 1;
    const yaz = () => {
      const ms = kalanMs();
      const sn = Math.floor(ms / 1000);
      const el = $(`#qrfCountdown`);
      if (el) {
        el.textContent = sn >= 3600
          ? `${Math.floor(sn / 3600)}s ${String(Math.floor((sn % 3600) / 60)).padStart(2, '0')}dk`
          : `${String(Math.floor(sn / 60)).padStart(2, '0')}:${String(sn % 60).padStart(2, '0')}`;
      }
      const ring = $(`#qrfRing`);
      if (ring) {
        const c = 2 * Math.PI * 19;
        ring.style.strokeDasharray = String(c);
        ring.style.strokeDashoffset = String(c * (1 - ms / toplam));
      }
      if (ms <= 0) {
        const t = $(`#qrfWaitTitle`);
        if (t) t.textContent = 'QR süresi doldu';
        qrfDurdur();
      }
    };
    yaz();
    return setInterval(yaz, 1000);
  }

  function qrfCihazKarti(a) {
    const kutu = $(`#qrfDevice`);
    if (!kutu || !a) return;
    const satir = (k, v) => `<div class="ad-row"><span>${k}</span><b>${v}</b></div>`;
    kutu.innerHTML = `
      <div class="qrf-dev-head">
        <div class="qrf-dev-ico">${katCizim(a.category)}</div>
        <div>
          <b>${fmt(a.hostname)}</b>
          <small>${escapeHtml(a.serial_number || '')} · ${escapeHtml(a.category || 'Diğer')}</small>
        </div>
        ${statusBadge(a.status)}
      </div>
      ${satir('İşletim Sistemi', fmt(a.os))}
      ${satir('IP Adresi', fmt(a.ip_address))}
      ${satir('Lokasyon', escapeHtml((a.location || '').trim() || '—'))}
      ${satir('Son Görülme', fmtDate(a.last_seen))}`;
  }

  async function qrfYokla() {
    if (!_qrfJeton) return;
    try {
      const r = await fetch(`/api/register/tokens/${encodeURIComponent(_qrfJeton.jti)}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.asset) {
        qrfDurdur();
        qrfCihazKarti(d.asset);
        qrfDurum('bitti');
        loadAssets?.();           // envanter listesi tazelensin
      }
    } catch { /* ağ dalgalanması: bir sonraki turda yeniden dener */ }
  }

  /* TV modunda uzaktan kumandanin OK/Enter tusu birincil eylemi tetikler.
     Duvar ekraninda fare yok; tasarimdaki "OK tusuna basin" ipucunun
     karsiligi olmasi icin gercekten baglandi. */
  $(`#qrModalOverlay`)?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!document.body.classList.contains('tv-mode')) return;
    if (e.target.closest('button, select, input, textarea, a')) return;
    const btn = [$(`#generateQr`), $(`#qrfContinue`)].find((b) => b && b.offsetParent !== null);
    if (btn) { e.preventDefault(); btn.click(); }
  });

  $(`#qrfCancel`)?.addEventListener('click', () => {
    qrfDurdur();
    _qrfJeton = null;
    qrfDurum('form');
    $(`#qrModalOverlay`)?.classList.remove('open');
  });

  $(`#qrfContinue`)?.addEventListener('click', () => {
    qrfDurdur(); _qrfJeton = null; qrfDurum('form');
    $(`#qrModalOverlay`)?.classList.remove('open');
  });

  $(`#qrfAgain`)?.addEventListener('click', () => {
    qrfDurdur(); _qrfJeton = null; qrfDurum('form');
  });

  $(`#generateQr`)?.addEventListener('click', async () => {
    const btn = $(`#generateQr`);
    const uyari = $(`#qrTokenInfo`);
    /* QR IMZALI JETON tasiyor. Jeton olmadan /api/register kayit kabul etmiyor
       — aksi halde adresi bilen herkes envantere sahte cihaz ekler. */
    let jeton;
    try {
      if (btn) btn.disabled = true;
      const r = await fetch('/api/register/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: Number($(`#qrHours`)?.value) || 1,
          uses: Number($(`#qrUses`)?.value) || 1,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || 'jeton üretilemedi');
      jeton = j;
    } catch (err) {
      alert('QR üretilemedi: ' + err.message);
      if (btn) btn.disabled = false;
      return;
    }
    if (btn) btn.disabled = false;
    _qrfJeton = jeton;

    // Mobil kayıt URL'sini bu tarayıcının origin'inden kur (aynı ağdaki telefon erişebilsin)
    const params = new URLSearchParams();
    const cat  = $(`#qrCategory`)?.value || '';
    const loc  = $(`#qrLocation`)?.value.trim() || '';
    const user = $(`#qrUsername`)?.value.trim() || '';
    if (cat)  params.set('category', cat);
    if (loc)  params.set('location', loc);
    if (user) params.set('username', user);
    params.set('t', jeton.token);

    const registerUrl = `${location.origin}/register?${params.toString()}`;
    $(`#qrImg`).src = `/api/qr?data=${encodeURIComponent(registerUrl)}`;
    $(`#qrLink`).textContent = registerUrl;
    $(`#qrLink`).href = registerUrl;
    if (uyari) {
      uyari.textContent = `Bu QR ${jeton.max_uses} cihaz için geçerli, ` +
        `${fmtDate(jeton.expires_at)} tarihine kadar. Süresi dolunca yenisini üretin.`;
    }

    qrfAdimlar(false);
    qrfDurum('bekle');
    qrfDurdur();
    _qrfTimer = {
      sayac: qrfSayac(jeton.expires_at),
      // 3 saniye: cihaz kaydolunca ekran gecikmeden ilerlesin, ama sunucuyu
      // gereksiz yormasın. QR süresi dolunca sayaç zaten durduruyor.
      yokla: setInterval(qrfYokla, 3000),
    };
  });

  $(`#printQr`)?.addEventListener('click', () => {
    const src = $(`#qrImg`)?.src;
    const url = $(`#qrLink`)?.textContent || '';
    if (!src) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/><title>Cihaz Kayıt QR — AssetMan</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:60px 20px;color:#1e293b}
      h1{font-size:22px;margin-bottom:8px}p{color:#64748b;font-size:14px;margin-bottom:28px}
      img{width:300px;height:300px;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
      .u{margin-top:20px;font-size:12px;color:#94a3b8;word-break:break-all}</style></head>
      <body><h1>AssetMan — Cihaz Kaydı</h1><p>Telefonunuzla bu QR kodu okutarak cihazınızı envantere ekleyin.</p>
      <img src="${src}" alt="QR"/><div class="u">${url}</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    win.document.close();
  });

  // Modal sekme geçişi
  $$('.modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.modal-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.modal-tabpane').forEach((p) => p.style.display = 'none');
      const pane = $(`#tab-${tab.dataset.tab}`);
      if (pane) pane.style.display = 'block';
    });
  });

  // Toplu depo kaydı
  /* ═══ Toplu Depo Kaydı — canlı önizleme ═══════════════════════════════════
     Sağdaki kutu, oluşturulacak ID aralığını GERÇEK değerlerle gösterir.
     Aralık sunucudan alınır (/api/register/bulk/preview) çünkü numaralandırma
     MEVCUT kayıtlardan devam ediyor: aynı önekten 3 kayıt varsa yeni aralık
     001'den değil 004'ten başlar. İstemcide ayrı hesaplasaydım önizleme
     kullanıcıya yanlış ID söylerdi. */
  let _blkTimer = null;

  function blkAlanlar() {
    return {
      category: $(`#bulkCategory`)?.value || 'Diğer',
      quantity: parseInt($(`#bulkQty`)?.value, 10) || 0,
      prefix: ($(`#bulkPrefix`)?.value || '').trim(),
      location: ($(`#bulkLocation`)?.value || '').trim(),
    };
  }

  async function blkOnizle() {
    const a = blkAlanlar();
    const yaz = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    yaz(`#blkOzKat`, a.category);
    yaz(`#blkOzAdet`, a.quantity || '—');
    yaz(`#blkOzLok`, a.location || '—');
    // Monitör kolonundaki mini kartlar aynı veriden beslenir
    yaz(`#blkMiniKat`, a.category);
    yaz(`#blkMiniAdet`, a.quantity ? a.quantity + ' Kayıt' : '—');

    // Önek sayacı
    const say = $(`#bulkPrefixSay`);
    if (say) say.textContent = `${a.prefix.length} / 20`;

    if (!a.quantity || a.quantity < 1) {
      yaz(`#blkOzOnek`, '—'); yaz(`#blkIlk`, '—'); yaz(`#blkSon`, '—');
      const l0 = $(`#blkIdListe`);
      if (l0) l0.innerHTML = '<span class="blk-id-ara">Adet girin</span>';
      yaz(`#blkNot`, 'Adet girin.');
      return;
    }
    try {
      const qs = new URLSearchParams({ category: a.category, prefix: a.prefix, quantity: String(a.quantity) });
      const r = await fetch('/api/register/bulk/preview?' + qs.toString());
      if (!r.ok) throw new Error('önizleme alınamadı');
      const p = await r.json();
      yaz(`#blkOzOnek`, p.prefix);
      yaz(`#blkIlk`, p.ilk || '—');
      yaz(`#blkSon`, p.son || '—');
      yaz(`#bulkOrnek`, p.ilk || p.prefix + '-001');
      // Mevcut kayıt varsa NEDEN 001'den başlamadığını söyle
      // Örnek ID listesi (orta kolon). null = "arası atlandı" işareti.
      const liste = $(`#blkIdListe`);
      if (liste) {
        liste.innerHTML = (p.ornekler || []).map((x) =>
          x === null ? '<span class="blk-id-ara">…</span>' : `<code>${escapeHtml(x)}</code>`).join('')
          || '<span class="blk-id-ara">Adet girin</span>';
      }
      yaz(`#blkNot`, p.mevcut
        ? `Bu önekte zaten ${p.mevcut} kayıt var; numaralandırma ${String(p.maxNum).padStart(3, '0')} sonrasından devam eder.`
        : '');
    } catch (err) {
      yaz(`#blkNot`, 'Önizleme alınamadı: ' + err.message);
    }
  }

  /* Yazarken her tuşta sunucuya gitmemek için kısa gecikme. */
  function blkOnizleGecikmeli() {
    clearTimeout(_blkTimer);
    _blkTimer = setTimeout(blkOnizle, 250);
  }

  ['#bulkCategory', '#bulkQty', '#bulkPrefix', '#bulkLocation'].forEach((sel) => {
    const e = $(sel);
    if (!e) return;
    e.addEventListener('input', blkOnizleGecikmeli);
    e.addEventListener('change', blkOnizleGecikmeli);
  });

  // Lokasyon önerileri: envanterde geçen lokasyonlar (yeni ad girmek serbest)
  function blkLokasyonlar() {
    const dl = $(`#bulkLocList`);
    if (!dl) return;
    const set = new Set((state.assets || []).map((a) => (a.location || '').trim()).filter(Boolean));
    dl.innerHTML = [...set].sort((x, y) => x.localeCompare(y, 'tr')).map((l) => `<option value="${escapeHtml(l)}">`).join('');
  }

  $(`#bulkKopyala`)?.addEventListener('click', async () => {
    const t = $(`#bulkOrnek`)?.textContent || '';
    try {
      await navigator.clipboard.writeText(t);
      const b = $(`#bulkKopyala`);
      if (b) { b.classList.add('kopyalandi'); setTimeout(() => b.classList.remove('kopyalandi'), 1200); }
    } catch { /* pano izni yok: sessiz geç, kullanıcı elle seçebilir */ }
  });

  $(`#bulkIptal`)?.addEventListener('click', () => $(`#qrModalOverlay`)?.classList.remove('open'));

  /* ═══ TV/kiosk: telefonla onay ═══════════════════════════════════════════
     Duvar ekranında klavye yok. Operatör planı kurar, QR'ı telefonuyla okutup
     onaylar; kayıtlar o anda oluşur. Panel jetonu yoklayarak sonucu gösterir.
     Plan JETONA DONDURULUR — telefon kategoriyi/adedi değiştiremez. */
  let _blkQrTimer = null;
  let _blkQrJti = null;

  function blkQrDurdur() {
    if (_blkQrTimer) { clearInterval(_blkQrTimer); _blkQrTimer = null; }
  }

  function blkQrKapat() {
    blkQrDurdur();
    // Ekrandan vazgeçilen onay kodu SUNUCUDA da iptal edilir; aksi halde
    // süresi dolana kadar geçerli kalır ve o QR'ı gören biri kullanabilirdi.
    if (_blkQrJti) {
      fetch('/api/register/bulk/token/' + encodeURIComponent(_blkQrJti), { method: 'DELETE' }).catch(() => {});
      _blkQrJti = null;
    }
    const alan = $(`#blkQrAlan`);
    if (alan) alan.style.display = 'none';
    const btn = $(`#blkQrUret`);
    if (btn) btn.style.display = '';
  }

  $(`#blkQrUret`)?.addEventListener('click', async () => {
    const a = blkAlanlar();
    if (!a.quantity || a.quantity < 1) { alert('Önce adet girin.'); return; }
    const btn = $(`#blkQrUret`);
    if (btn) btn.disabled = true;
    try {
      const r = await fetch('/api/register/bulk/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: a.category, quantity: a.quantity, location: a.location, prefix: a.prefix }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || 'onay kodu üretilemedi');
      _blkQrJti = j.jti;

      const url = `${location.origin}/bulk-confirm?t=${encodeURIComponent(j.token)}`;
      $(`#blkQrImg`).src = `/api/qr?data=${encodeURIComponent(url)}`;
      $(`#blkQrDurum`).textContent =
        `${a.quantity} adet ${a.category} — telefonla okutup onaylayın. Kod ${j.minutes} dakika geçerli.`;
      $(`#blkQrDurum`).className = '';
      $(`#blkQrAlan`).style.display = '';
      if (btn) btn.style.display = 'none';

      blkQrDurdur();
      _blkQrTimer = setInterval(blkQrYokla, 2500);
    } catch (err) {
      alert('Onay kodu üretilemedi: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  async function blkQrYokla() {
    if (!_blkQrJti) return blkQrDurdur();
    try {
      const r = await fetch('/api/register/bulk/token/' + encodeURIComponent(_blkQrJti));
      if (!r.ok) return;
      const d = await r.json();
      const dur = $(`#blkQrDurum`);
      if (d.used_at && d.result_count != null) {
        blkQrDurdur();
        _blkQrJti = null;                       // onaylandı: iptal etme
        if (dur) {
          dur.className = 'blk-qr-ok';
          dur.textContent = `✓ ${d.result_count} kayıt oluşturuldu (${d.first_id} → ${d.last_id}).`;
        }
        loadAssets?.();
        blkOnizle();                            // aralık ilerledi
      } else if (new Date(d.expires_at).getTime() < Date.now()) {
        blkQrDurdur();
        if (dur) { dur.className = 'blk-qr-hata'; dur.textContent = 'Onay kodunun süresi doldu. Yeniden üretin.'; }
      }
    } catch { /* ağ dalgalanması: bir sonraki turda dener */ }
  }

  $(`#blkQrIptal`)?.addEventListener('click', blkQrKapat);

  $(`#createBulk`)?.addEventListener('click', async () => {
    const btn = $(`#createBulk`);
    const resultEl = $(`#bulkResult`);
    const category = $(`#bulkCategory`)?.value || 'Diğer';
    const quantity = parseInt($(`#bulkQty`)?.value, 10) || 0;
    const location = $(`#bulkLocation`)?.value.trim() || '';
    const prefix   = $(`#bulkPrefix`)?.value.trim() || '';

    if (quantity < 1 || quantity > 200) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<span style="color:var(--red)">Adet 1-200 arası olmalı.</span>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Oluşturuluyor...';
    resultEl.style.display = 'none';

    try {
      const res = await fetch('/api/register/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, quantity, location, prefix }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Hata');

      const first = data.items[0]?.hostname || '';
      const last  = data.items[data.items.length - 1]?.hostname || '';
      resultEl.style.display = 'block';
      resultEl.innerHTML =
        `<div class="ok-line">✓ ${data.count} adet "${category}" taslağı oluşturuldu.</div>` +
        `<div>ID aralığı: <code>${first}</code> – <code>${last}</code></div>` +
        `<div style="margin-top:6px;color:var(--text-muted)">Durum: depoda · Cihazlar açılıp tanımlanınca Varlıklar sayfasından düzenlenebilir.</div>`;

      // Envanteri tazele
      loadDashboard();
      if (state.currentView === 'assets') renderAssetsTable();
    } catch (ex) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = `<span style="color:var(--red)">Hata: ${ex.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Taslak Kayıtları Oluştur';
    }
  });

  // Yaşam döngüsü: durum kaydı ekle
  $(`#lifeRecordBtn`)?.addEventListener('click', handleLifecycleRecord);

  // WORM yedekten geri yükle
  $(`#backupRestoreBtn`)?.addEventListener('click', async () => {
    const btn = $(`#backupRestoreBtn`);
    btn.disabled = true; btn.textContent = 'Geri yükleniyor...';
    try {
      const r = await postBackupRestore();
      const det = $('#backupDetail');
      if (det) { det.style.color = 'var(--green,#22c55e)'; det.textContent = `Yedekten ${r.restored} kayıt geri yüklendi, bütünlük yeniden sağlandı ✓`; }
      await loadLifecycle(false);
    } catch (err) {
      const det = $('#backupDetail'); if (det) { det.style.color = 'var(--red,#ef4444)'; det.textContent = 'Geri yükleme hatası: ' + err.message; }
    } finally { btn.disabled = false; btn.textContent = 'Yedekten Geri Yükle'; }
  });

  // Kaydedilmiş temayı uygula (auto → sistem tercihi)
  applyTheme(localStorage.getItem('theme') || 'auto');

  // Initial load
  loadDashboard();
  loadAiProviderInfo();
  setInterval(loadAiProviderInfo, 15000); // sunucu durumunu canlı izle (yeşil/kırmızı ışık)
  preloadAlertsBadge();
  preloadLifecycleBadge();
  startAlertsAutoRefresh(60000); // 60 sn'de bir rozet + (açıksa) panel otomatik tazele
  loadCurrentUser();
});

