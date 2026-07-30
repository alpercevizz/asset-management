/* ─── Oturum: 401 dönerse login sayfasına yönlendir ──────────────────────── */
(function installAuthGuard() {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Oturum sonlandı');
    }
    return res;
  };
})();

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  assets: [],
  licenses: [],
  stats: null,
  sessionId: 'session-' + Date.now(),
  currentView: 'dashboard',
  chatOpen: false,
  categoryFilter: '',
  locationFilter: '',
  // Dashboard v2
  allAssets: [], rawStats: null, rawSummary: null,
  catFilter: new Set(), rangeDays: 30, mapZoom: 1,
  trends: {}, trendSeries: [], seriesOnline: [], seriesOffline: [], seriesDepoda: [],
  locations: {}, critParts: {},
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmt(val, fallback = '—') {
  if (val === null || val === undefined || val === '') return fallback;
  return val;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Dashboard tablosu dar kolonda — saat olmadan (tasarım referansı da tarih-only)
function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const CAT_CLASS = {
  'Bilgisayar': 'bilgisayar',
  'Sunucu': 'sunucu',
  'Telefon': 'telefon',
  'El Terminali': 'terminal',
  'Yazıcı': 'yazici',
  'Ağ Aygıtı': 'ag',
  'Çevre Aygıtı': 'cevre',
  'Tablet': 'tablet',
};

function categoryBadge(cat) {
  if (!cat) return '<span style="color:var(--text-muted)">—</span>';
  const cls = CAT_CLASS[cat] || 'diger';
  return `<span class="cat-badge cat-badge--${cls}">${cat}</span>`;
}

function statusBadge(status) {
  const s = (status || 'unknown').toLowerCase();
  if (s === 'online') return `<span class="badge badge--online">online</span>`;
  if (s === 'offline') return `<span class="badge badge--offline">offline</span>`;
  if (s === 'depoda' || s === 'in_storage') return `<span class="badge badge--depoda">depoda</span>`;
  return `<span class="badge badge--unknown">${s}</span>`;
}

function animateCount(el, target) {
  const start = 0;
  const duration = 800;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── API ───────────────────────────────────────────────────────────────── */
async function fetchAssets(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/assets${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStats() {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/licenses${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenseStats() {
  const res = await fetch('/api/licenses/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAnomalies() {
  const res = await fetch('/api/anomalies');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchOfflineAlerts() {
  const res = await fetch('/api/alerts/offline');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLicenseCompliance() {
  const res = await fetch('/api/licenses/compliance');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchShadowIT() {
  const res = await fetch('/api/shadow-it');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEolOs() {
  const res = await fetch('/api/eol-os');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWarranty() {
  const res = await fetch('/api/warranty');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleConflicts() {
  const res = await fetch('/api/lifecycle/conflicts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleLog(limit = 100) {
  const res = await fetch(`/api/lifecycle/log?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchLifecycleVerify() {
  const res = await fetch('/api/lifecycle/verify');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRiskScores() {
  const res = await fetch('/api/risk-scores');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchForecast() {
  const res = await fetch('/api/forecast');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchNetworkScan() {
  const res = await fetch('/api/network/scan');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchBackupStatus() {
  const res = await fetch('/api/backup/status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postBackupRestore() {
  const res = await fetch('/api/backup/restore', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

async function postLifecycleEvent(payload) {
  const res = await fetch('/api/lifecycle/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

// Rapora eklenecek DETERMINISTIK Shadow IT bloğu (kesin format — LLM'e bırakılmaz)
function shadowItReportHtml(data) {
  const items = (data.shadow && data.shadow.items) || [];
  const count = (data.shadow && data.shadow.count) || 0;
  let html = '<h2>Ağ Güvenliği — Shadow IT Taraması</h2>';
  if (count === 0) {
    html += `<p style="color:var(--green);">Ağda resmi envanter kaydı bulunmayan cihaz tespit edilmedi. (${data.total_active || 0} aktif cihaz tarandı)</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  html += `<p class="shadow-warn">[UYARI] Ağda resmi envanter kaydı bulunmayan ${count} adet cihaz tespit edildi.</p>`;
  html += `<ul class="shadow-list">`;
  for (const d of items) {
    const host = d.hostname ? ` (${escape(d.hostname)})` : ' (Hostname bilinmiyor)';
    const vendor = d.vendor ? ` — ${escape(d.vendor)}` : '';
    html += `<li>Detaylar: ${escape(d.ip)} - ${escape(d.mac)}${host}${vendor}</li>`;
  }
  html += `</ul>`;
  html += `<p class="shadow-rec">Öneri: Bu cihazların MAC adreslerini Sophos/Güvenlik duvarı üzerinden izole edin veya resmi envanter kaydını oluşturun.</p>`;
  html += `</div>`;
  return html;
}

// Rapora eklenecek DETERMINISTIK EOL bloğu (kesin format — LLM'e bırakılmaz)
function eolReportHtml(data) {
  const eolItems  = (data.eol && data.eol.items) || [];
  const soonItems = (data.approaching && data.approaching.items) || [];
  let html = '<h2>Güvenlik — Eski İşletim Sistemi (EOL) Taraması</h2>';
  if (eolItems.length === 0 && soonItems.length === 0) {
    html += `<p style="color:var(--green);">Güvenlik desteği biten veya bitmek üzere olan işletim sistemi tespit edilmedi.</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  if (eolItems.length) {
    html += `<p class="shadow-warn">[GÜVENLİK] Üretici güvenlik desteği BİTMİŞ ${eolItems.length} cihaz tespit edildi.</p>`;
    html += `<ul class="shadow-list">`;
    eolItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.os_family)} (${d.days_past} gün önce EOL oldu)</li>`);
    html += `</ul>`;
    html += `<p class="shadow-rec">Öneri: Bu cihazları güncel ve desteklenen bir işletim sistemine yükseltin; artık güvenlik yaması almıyorlar.</p>`;
  }
  if (soonItems.length) {
    html += `<p class="shadow-warn">180 gün içinde desteği bitecek ${soonItems.length} cihaz:</p>`;
    html += `<ul class="shadow-list">`;
    soonItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.os_family)} (${d.days_left} gün kaldı)</li>`);
    html += `</ul>`;
  }
  html += `</div>`;
  return html;
}

// Rapora eklenecek DETERMINISTIK Garanti bloğu (kesin format — LLM'e bırakılmaz)
function warrantyReportHtml(data) {
  const expItems  = (data.expired && data.expired.items) || [];
  const soonItems = (data.expiring_soon && data.expiring_soon.items) || [];
  let html = '<h2>Donanım — Garanti Takibi</h2>';
  if (expItems.length === 0 && soonItems.length === 0) {
    html += `<p style="color:var(--green);">Garantisi bitmiş veya yakında bitecek cihaz tespit edilmedi.</p>`;
    return html;
  }
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  html += `<div class="shadow-alert">`;
  if (expItems.length) {
    html += `<p class="shadow-warn">[UYARI] Garantisi BİTMİŞ ${expItems.length} cihaz tespit edildi.</p>`;
    html += `<ul class="shadow-list">`;
    expItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.brand)} ${escape(d.model)} (garanti ${escape(d.warranty_expiry)}, ${d.days_past} gün önce bitti)</li>`);
    html += `</ul>`;
    html += `<p class="shadow-rec">Öneri: Bu cihazlar için garanti uzatma veya yenileme/değişim planı oluşturun.</p>`;
  }
  if (soonItems.length) {
    html += `<p class="shadow-warn">60 gün içinde garantisi bitecek ${soonItems.length} cihaz:</p>`;
    html += `<ul class="shadow-list">`;
    soonItems.forEach(d => html += `<li>${escape(d.hostname)} — ${escape(d.brand)} ${escape(d.model)} (garanti ${escape(d.warranty_expiry)}, ${d.days_left} gün kaldı)</li>`);
    html += `</ul>`;
  }
  html += `</div>`;
  return html;
}

async function sendChat(message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: state.sessionId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function clearChatSession() {
  await fetch(`/api/chat/${state.sessionId}`, { method: 'DELETE' }).catch(() => {});
  state.sessionId = 'session-' + Date.now();
}

async function loadAiProviderInfo() {
  const badge     = $(`#aiBadge`);
  const badgeText = $(`#aiBadgeText`);
  const chatTitle = $(`#chatProviderTitle`);
  // İsim her zaman AssetMan
  if (chatTitle) chatTitle.textContent = 'AssetMan';

  let online = false;
  try {
    const res = await fetch('/api/health');
    online = res.ok;
  } catch (_) { online = false; }

  // Sunucu çalışıyorsa yeşil, çalışmıyorsa kırmızı ışık (demo: sağlayıcı/model gizli)
  if (online) {
    if (badge) badge.classList.remove('offline');
    if (badgeText) badgeText.textContent = 'AI Agent Çalışıyor';
  } else {
    if (badge) badge.classList.add('offline');
    if (badgeText) badgeText.textContent = 'AI Agent Çalışmıyor';
  }
}

const ROLE_LABEL = { admin: 'Yönetici', it: 'BT Ekibi', approver: 'Onaylayıcı' };

function userInitials(name) {
  const parts = String(name || '').trim().split(/[\s._\-@]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const data = await res.json();
    const initials = userInitials(data.user);
    const roleLabel = ROLE_LABEL[data.role] || data.role || '';
    const av = $(`#userAvatar`);
    if (av && data.user) {
      av.textContent = initials;
      av.title = `${data.user} · ${roleLabel}`;
    }
    // Sidebar kullanıcı kartı + hesap menüsü başlığı
    const setTxt = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    if (data.user) {
      setTxt('sbUserAv', initials);
      setTxt('sbUserName', data.display || data.user);
      setTxt('sbUserRole', roleLabel);
      setTxt('menuUserName', data.display || data.user);
      setTxt('menuUserRole', roleLabel);
    }
    state.role = data.role;
    // Ayarlar nav'ı yalnız admin'e görünür
    if (data.role === 'admin') {
      const n = $(`#navSettings`); if (n) n.style.display = '';
      const u = $(`#navUsers`);    if (u) u.style.display = '';
    }
  } catch (_) { /* sessizce geç */ }
}

/* ─── Views ─────────────────────────────────────────────────────────────── */
function showView(name) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const target = $(`#view-${name}`);
  if (target) target.classList.remove('hidden');

  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  const navItem = $(`.nav-item[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');

  // Alt sekme çubuğu: doğrudan karşılığı olmayan görünümlerde hiçbiri aktif olmaz
  $$('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === name));

  // Dashboard araç çubuğu (tarih aralığı + Filtrele) YALNIZ dashboard'a aittir;
  // topbar'da mount edildiği için diğer sayfalarda gizlenmeli (Varlıklar'ın kendi
  // filtre çubuğu var, ikisi birden kafa karıştırıyordu).
  const slotEl = document.querySelector('#topbarToolbarSlot');
  if (slotEl) slotEl.style.display = (name === 'dashboard') ? '' : 'none';

  state.currentView = name;
  if (name === 'assets')   renderAssetsTable();
  if (name === 'licenses') loadLicenses();
  if (name === 'lines')    loadLines();
  if (name === 'settings') loadSettings();
  if (name === 'alerts')   loadAlerts();
  if (name === 'lifecycle') loadLifecycle();
  if (name === 'insights') loadInsights();
  if (name === 'locations') loadLocationsView();
  if (name === 'users') loadUsersView();
  // Operasyon Merkezi tam ekrandır (kenar çubuğu/topbar gizli); diğer sayfalar
  // TV modunda da normal kabuğunu korur.
  document.body.classList.toggle('tv-full', name === 'tv');
  if (name === 'tv') { tvxStart(); } else { tvxStop(); }
}

const RISK_LEVEL_CLASS = { 'Kritik': 'badge--offline', 'Yüksek': 'badge--offline', 'Orta': 'badge--unknown', 'Düşük': 'badge--online' };
function trMoney(n) { return Number(n || 0).toLocaleString('tr-TR') + ' ₺'; }

async function loadInsights() {
  const setLoad = (id, cols) => { const b = $(`#${id}`); if (b) b.innerHTML = `<tr><td colspan="${cols}" class="loading-cell">Yükleniyor...</td></tr>`; };
  setLoad('riskBody', 6); setLoad('fcBody', 6);
  try {
    const [risk, fc] = await Promise.all([
      fetchRiskScores(),
      fetchForecast().catch(() => ({ total_count: 0, total_estimated_cost: 0, overdue_count: 0, by_period: {}, items: [] })),
    ]);

    // Risk özet
    const d = risk.distribution || {};
    const setC = (id, v) => { const el = $(`#${id}`); if (el) animateCount(el, v); };
    setC('riskCritical', d.critical || 0); setC('riskHigh', d.high || 0);
    setC('riskAvg', risk.average_score || 0); setC('riskTotal', risk.total_assets || 0);
    setPill('riskAtRiskPill', risk.at_risk_count || 0);

    // Risk tablosu (skor>0 olanlar; hepsi düşükse en yüksek 15)
    const riskItems = (risk.items || []).filter(i => i.score > 0);
    const shown = riskItems.length ? riskItems : (risk.items || []).slice(0, 15);
    const rb = $('#riskBody');
    if (rb) {
      rb.innerHTML = shown.length ? shown.map(i => {
        const cls = RISK_LEVEL_CLASS[i.level] || 'badge--unknown';
        const factors = (i.factors || []).slice(0, 3).map(f => escapeHtml(f.label)).join(' · ') || '—';
        return `<tr>
          <td><span class="risk-score risk-${i.level === 'Kritik' || i.level === 'Yüksek' ? 'hi' : (i.level === 'Orta' ? 'mid' : 'lo')}">${i.score}</span></td>
          <td><span class="badge ${cls}">${i.level}</span></td>
          <td class="hostname-cell">${fmt(i.hostname)}</td>
          <td>${fmt(i.category)}</td>
          <td>${fmt(i.username)}</td>
          <td style="color:var(--text-muted);font-size:12px;" title="${(i.factors||[]).map(f=>escapeHtml(f.label)).join(' · ')}">${factors}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">Riskli cihaz yok ✓</td></tr>`;
    }

    // Öngörü özet (döviz endeksli)
    const ftc = $('#fcTotalCost'); if (ftc) ftc.textContent = trMoney(fc.total_estimated_cost);
    setC('fcCount', fc.total_count || 0); setC('fcOverdue', fc.overdue_count || 0);
    // Döviz kuru bilgisi (canlı parite)
    const fxEl = $('#fcFx');
    if (fxEl && fc.fx) {
      const trend = fc.fx.usd_trend === 'up' ? '▲' : '▼';
      fxEl.innerHTML = `💱 1 USD = <b>${fc.fx.USD_TRY}</b> ₺ ${trend} · 1 EUR = <b>${fc.fx.EUR_TRY}</b> ₺ · ` +
        `Baz: <b>$${(fc.total_estimated_cost_usd || 0).toLocaleString('tr-TR')}</b> · <span style="color:var(--text-muted)">${escapeHtml(fc.fx.source)}</span>`;
    }
    const fp = $('#fcPeriods');
    if (fp) {
      const parts = Object.values(fc.by_period || {}).filter(p => p.count).map(p => `${p.label}: ${p.count} (${trMoney(p.cost)})`);
      fp.innerHTML = parts.length ? parts.join('<br>') : 'Yaklaşan yenileme yok';
    }
    setPill('fcPill', fc.total_count || 0);
    const fb = $('#fcBody');
    if (fb) {
      fb.innerHTML = (fc.items || []).length ? fc.items.map(it => `<tr>
        <td class="hostname-cell">${fmt(it.hostname)}</td>
        <td>${fmt(it.category)}</td>
        <td style="font-size:12px;">${escapeHtml(it.reason)}</td>
        <td>${fmtDate(it.due_date)}</td>
        <td>${it.overdue ? '<span class="badge badge--offline">Gecikmiş</span>' : `<span class="badge badge--unknown">${it.months_left} ay</span>`}</td>
        <td style="font-weight:600;">${trMoney(it.est_cost)}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">12 ay içinde yenileme gerektiren cihaz yok ✓</td></tr>`;
    }
  } catch (err) {
    console.error('Insights load error:', err);
    const rb = $('#riskBody'); if (rb) rb.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

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




/* ═══ Toplama Ajanları (Ayarlar · admin) ══════════════════════════════════
   Cihaz sırları BURADA GÖSTERİLMEZ — sunucu zaten listede döndürmüyor.
   Ekranın asıl işi: hangi cihaz kayıtlı, en son ne zaman rapor verdi ve
   yeniden kurulan bir makinenin kaydını sıfırlayabilmek. */
async function loadAgents() {
  const body = $(`#agentBody`);
  const mod = $(`#agentMode`);
  if (!body) return;
  try {
    const r = await fetch('/api/agents');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Bu bölüm yalnız yöneticilere açık.</td></tr>'; return; }
    const j = await r.json();

    if (mod) {
      const zorunlu = j.mode === 'required';
      mod.innerHTML = zorunlu
        ? '<span style="color:var(--green)">Kimlik doğrulama: zorunlu</span>'
        : `<span style="color:var(--red)">Kimlik doğrulama: ${escapeHtml(j.mode)} — imzasız istek kabul ediliyor</span>`;
    }

    const rows = j.results || [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="loading-cell">
        Henüz kayıtlı ajan yok. Kurulum: <code>docs/COLLECTOR-KURULUM.md</code></td></tr>`;
      return;
    }
    body.innerHTML = rows.map((a) => {
      // 24 saatten uzun süredir rapor gelmiyorsa dikkat çek — ajan durmuş olabilir
      const t = Date.parse(a.last_seen_at);
      const bayat = !Number.isNaN(t) && (Date.now() - t) > 24 * 3600 * 1000;
      return `<tr>
        <td class="hostname-cell"><span class="serial-cell">${escapeHtml(a.device_id)}</span></td>
        <td>${a.asset_id ? '#' + a.asset_id : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${a.agent_version ? escapeHtml(a.agent_version) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${fmtDate(a.enrolled_at)}</td>
        <td${bayat ? ' style="color:var(--red)"' : ''}>${a.last_seen_at ? gecenSure(a.last_seen_at) : '—'}${bayat ? ' ⚠' : ''}</td>
        <td style="text-align:right"><button class="btn-pdf" data-agentdel="${escapeHtml(a.device_id)}" style="color:var(--red)">Kaydı sıfırla</button></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-agentdel]').forEach((b) =>
      b.addEventListener('click', () => agentRevoke(b.dataset.agentdel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function agentRevoke(deviceId) {
  if (!confirm(`"${deviceId}" cihazının kaydı silinsin mi?

` +
    'Cihaz bir sonraki bağlantısında paylaşılan anahtarla YENİDEN kaydolur. ' +
    'Yalnızca yeniden kurulan makineler için kullanın — kayıt silinmiş bir cihazı ' +
    'ele geçiren biri onun adına rapor gönderebilir.')) return;
  try {
    const r = await fetch('/api/agents/' + encodeURIComponent(deviceId), { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    loadAgents();
  } catch (err) { alert('Silinemedi: ' + err.message); }
}

/* ═══ Cihaz model görselleri (Ayarlar) ════════════════════════════════════
   Görsel MODELE bağlanır. Dosya tarayıcıda base64'e çevrilip JSON ile gönderilir
   (multipart bağımlılığı eklemeye gerek kalmadı); sunucu tür ve boyut doğrular.
   SVG kabul EDİLMEZ — panelde gösterilecek, içinde script taşıyabilir. */
let _imgHedef = null;   // { brand, model, category } | { category } (kategori geneli)

async function loadImageTable() {
  const body = $(`#imgBody`);
  if (!body) return;
  try {
    const r = await fetch('/api/device-images');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Yetki yok.</td></tr>'; return; }
    const j = await r.json();
    const modeller = j.models || [];
    if (!modeller.length) { body.innerHTML = '<tr><td colspan="6" class="loading-cell">Envanterde model yok</td></tr>'; return; }
    const rozet = { model: 'tam model', marka: 'marka+kategori', kategori: 'kategori geneli' };
    body.innerHTML = modeller.map((m, i) => `
      <tr>
        <td>${m.image
          ? `<img src="${m.image.url}" alt="" style="width:44px;height:44px;object-fit:contain;border-radius:8px;background:var(--bg-card2)">`
          : '<span style="color:var(--text-muted);font-size:11.5px">yok</span>'}</td>
        <td class="hostname-cell">${escapeHtml((m.brand + ' ' + m.model).trim() || '(marka/model boş)')}</td>
        <td>${categoryBadge(m.category)}</td>
        <td>${m.count}</td>
        <td>${m.image
          ? `<span class="badge badge--online">${rozet[m.image.match] || m.image.match}</span>`
          : '<span class="badge badge--unknown">çizim</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-img="${i}">${m.image && m.image.match === 'model' ? 'Değiştir' : 'Görsel yükle'}</button>
          ${m.image && m.image.match === 'model' ? `<button class="btn-pdf" data-imgdel="${m.image.id}" style="color:var(--red)">Sil</button>` : ''}
        </td>
      </tr>`).join('');
    body.querySelectorAll('[data-img]').forEach(b => b.addEventListener('click', () => {
      const m = modeller[Number(b.dataset.img)];
      _imgHedef = { brand: m.brand, model: m.model, category: m.category };
      $(`#imgFile`)?.click();
    }));
    body.querySelectorAll('[data-imgdel]').forEach(b =>
      b.addEventListener('click', () => imageDelete(b.dataset.imgdel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function imageCategoryPrompt() {
  const kat = prompt('Hangi kategori için genel görsel? (Bilgisayar, Sunucu, Telefon, Tablet, El Terminali, Yazıcı, Ağ Aygıtı, Çevre Aygıtı)');
  if (!kat || !kat.trim()) return;
  _imgHedef = { brand: '', model: '', category: kat.trim() };
  $(`#imgFile`)?.click();
}

async function imageUpload(file) {
  const msg = $(`#imgMsg`);
  if (!_imgHedef || !file) return;
  if (file.size > 2 * 1024 * 1024) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = `Görsel çok büyük (${Math.round(file.size / 1024)} KB, en fazla 2 MB).`; }
    return;
  }
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('Dosya okunamadı'));
    fr.readAsDataURL(file);
  });
  try {
    const r = await fetch('/api/device-images', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ..._imgHedef, dataUrl }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '✓ Görsel yüklendi'; setTimeout(() => msg.textContent = '', 3000); }
    loadImageTable();
    loadAgents();
  } catch (err) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; }
  } finally { _imgHedef = null; }
}

async function imageDelete(id) {
  if (!confirm('Bu model görseli silinsin mi? Cihazlar yerleşik kategori çizimine döner.')) return;
  try {
    const r = await fetch('/api/device-images/' + id, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    loadImageTable();
    loadAgents();
  } catch (err) { alert('Silinemedi: ' + err.message); }
}

/* ═══ Lokasyon koordinatları (Ayarlar) ════════════════════════════════════ */
async function loadGeoTable() {
  const body = $(`#geoBody`);
  if (!body) return;
  try {
    const r = await fetch('/api/locations/geo');
    if (r.status === 403) { body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yetki yok.</td></tr>'; return; }
    const j = await r.json();
    const geo = j.geo || {};
    const adlar = (j.locations || []).slice().sort((a, b) => a.localeCompare(b, 'tr'));
    if (!adlar.length) { body.innerHTML = '<tr><td colspan="5" class="loading-cell">Envanterde lokasyon yok</td></tr>'; return; }
    body.innerHTML = adlar.map(ad => {
      const g = geo[ad];
      return `<tr>
        <td class="hostname-cell">${escapeHtml(ad)}</td>
        <td>${g ? g.lat.toFixed(3) : '<span style="color:var(--orange)">tanımsız</span>'}</td>
        <td>${g ? g.lon.toFixed(3) : '<span style="color:var(--orange)">tanımsız</span>'}</td>
        <td style="color:var(--text-muted)">${g ? (g.source === 'seed' ? 'otomatik' : 'elle') : '—'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-geo="${escapeHtml(ad)}">${g ? 'Düzenle' : 'Koordinat gir'}</button>
          ${g ? `<button class="btn-pdf" data-geodel="${escapeHtml(ad)}" style="color:var(--red)">Sil</button>` : ''}
        </td></tr>`;
    }).join('');
    body.querySelectorAll('[data-geo]').forEach(b =>
      b.addEventListener('click', () => geoPrompt(b.dataset.geo, geo[b.dataset.geo])));
    body.querySelectorAll('[data-geodel]').forEach(b =>
      b.addEventListener('click', () => geoDelete(b.dataset.geodel)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function geoPrompt(ad, mevcut) {
  const v = prompt(
    `"${ad}" için koordinat\n\nEnlem, Boylam biçiminde girin (ör. 41.01, 28.98).\n` +
    `Bir haritadan (OpenStreetMap/Google Maps) sağ tıkla kopyalayabilirsiniz.`,
    mevcut ? `${mevcut.lat}, ${mevcut.lon}` : '');
  if (v === null) return;
  const parca = String(v).split(/[,;\s]+/).filter(Boolean);
  if (parca.length < 2) { alert('İki sayı girin: enlem, boylam'); return; }
  const lat = Number(parca[0].replace(',', '.')), lon = Number(parca[1].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { alert('Geçersiz sayı.'); return; }
  const label = prompt('Haritada görünecek kısa ad (boş bırakılabilir):', mevcut?.label || ad) ?? null;
  geoSave(ad, lat, lon, label);
}

async function geoSave(location, lat, lon, label) {
  try {
    const r = await fetch('/api/locations/geo', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, lat, lon, label }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    state.locGeo = null;                      // önbelleği düşür → harita tazelensin
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
}

async function geoDelete(location) {
  if (!confirm(`"${location}" koordinatı silinsin mi? Bu lokasyon haritada görünmeyecek.`)) return;
  try {
    const r = await fetch('/api/locations/geo/' + encodeURIComponent(location), { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).detail || 'silinemedi');
    state.locGeo = null;
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { alert('Silinemedi: ' + err.message); }
}

async function geoSeed() {
  const msg = $(`#geoMsg`);
  try {
    const r = await fetch('/api/locations/geo/seed', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    if (msg) {
      msg.style.color = 'var(--green)';
      msg.textContent = j.eklendi
        ? `✓ ${j.eklendi} lokasyon dolduruldu` + (j.eslesmeyen.length ? ` · ${j.eslesmeyen.length} tanesi elle girilmeli` : '')
        : 'Otomatik eşleşen yeni lokasyon yok — kalanları elle girin.';
    }
    state.locGeo = null;
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

/* ═══ Lokasyonlar görünümü ════════════════════════════════════════════════ */
async function loadLocationsView() {
  const body = $(`#locationsBody`);
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yükleniyor...</td></tr>';
  try {
    const [assetsData, summary, drift] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetchLocationSummary().catch(() => ({ locations: {} })),
      fetchLocationDrift().catch(() => ({ drifted: [] })),
    ]);
    const assets = assetsData.results || [];
    const expectedCounts = {};
    (drift.drifted || []).forEach(() => {});
    const driftByLoc = {};
    (drift.drifted || []).forEach(d => {
      driftByLoc[d.expected_location] = (driftByLoc[d.expected_location] || 0) + 1;
    });

    const rows = {};
    assets.forEach(a => {
      const loc = (a.location || '').trim();
      if (!loc) return;
      rows[loc] = rows[loc] || { n: 0, cats: {} };
      rows[loc].n++;
      const c = a.category || 'Diğer';
      rows[loc].cats[c] = (rows[loc].cats[c] || 0) + 1;
    });

    const list = Object.entries(rows).sort((a, b) => b[1].n - a[1].n);
    const sub = $(`#locPageSub`);
    if (sub) sub.textContent = `${list.length} lokasyon · ${assets.length} cihaz`;

    body.innerHTML = list.length ? list.map(([loc, v]) => {
      const cats = Object.entries(v.cats).sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${categoryBadge(c)} <span style="color:var(--text-muted);font-size:11px">${n}</span>`).join(' ');
      const dr = driftByLoc[loc] || 0;
      return `<tr>
        <td class="hostname-cell">${escapeHtml(loc)}</td>
        <td>${v.n}</td>
        <td>${expectedCounts[loc] != null ? expectedCounts[loc] : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${dr ? `<span class="badge badge--offline">${dr}</span>` : '<span style="color:var(--green)">0</span>'}</td>
        <td>${cats}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="loading-cell">Lokasyon kaydı yok</td></tr>';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ═══ Kullanıcılar görünümü (admin) ═══════════════════════════════════════ */
const ROLE_OPTS = [['admin', 'Yönetici'], ['it', 'BT Ekibi'], ['approver', 'Onaylayıcı']];

async function loadUsersView() {
  const body = $(`#usersBody`);
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="loading-cell">Yükleniyor...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (res.status === 403) {
      body.innerHTML = '<tr><td colspan="5" class="loading-cell">Bu sayfa yalnız yöneticiler içindir.</td></tr>';
      return;
    }
    const j = await res.json();
    const users = j.users || [];
    const sub = $(`#usersPageSub`);
    if (sub) sub.textContent = `${users.length} hesap`;
    const prov = $(`#usersProvider`);
    if (prov) prov.textContent = j.provider === 'ldap'
      ? 'LDAP modunda roller AD grubundan gelir — buradaki değişiklik sonraki girişte ezilebilir'
      : 'Yerel hesaplar';

    body.innerHTML = users.map(u => `
      <tr>
        <td class="hostname-cell">${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.display || '—')}</td>
        <td><span class="badge badge--unknown">${ROLE_LABEL[u.role] || u.role}</span></td>
        <td class="upn-cell">${escapeHtml(u.upn || '—')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-pdf" data-edit="${escapeHtml(u.username)}">Düzenle</button>
          <button class="btn-pdf" data-del="${escapeHtml(u.username)}" style="color:var(--red)">Sil</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="loading-cell">Hesap yok</td></tr>';

    body.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => editUserPrompt(users.find(x => x.username === b.dataset.edit))));
    body.querySelectorAll('[data-del]').forEach(b =>
      b.addEventListener('click', () => deleteUserPrompt(b.dataset.del)));
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function roleFromPrompt(current) {
  const v = prompt(`Rol (${ROLE_OPTS.map(r => r[0]).join(' / ')}):`, current || 'it');
  if (v === null) return null;
  const r = String(v).trim().toLowerCase();
  if (!ROLE_OPTS.some(x => x[0] === r)) { alert('Geçersiz rol.'); return null; }
  return r;
}

async function createUserPrompt() {
  const username = prompt('Kullanıcı adı:');
  if (!username || !username.trim()) return;
  const display = prompt('Ad Soyad (opsiyonel):') || '';
  const role = roleFromPrompt('it');
  if (!role) return;
  const password = prompt('Parola (en az 8 karakter):');
  if (!password) return;
  try {
    const res = await fetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), display, role, password }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadUsersView();
  } catch (err) { alert('Oluşturulamadı: ' + err.message); }
}

async function editUserPrompt(u) {
  if (!u) return;
  const role = roleFromPrompt(u.role);
  if (!role) return;
  const display = prompt('Ad Soyad:', u.display || '') ?? u.display;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(u.username)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, display }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (j.warning) alert(j.warning);
    loadUsersView();
  } catch (err) { alert('Güncellenemedi: ' + err.message); }
}

async function deleteUserPrompt(username) {
  if (!confirm(`"${username}" hesabı KALICI olarak silinecek. Emin misiniz?`)) return;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadUsersView();
  } catch (err) { alert('Silinemedi: ' + err.message); }
}

/* ─── Excel/CSV Export ──────────────────────────────────────────────────────── */
function exportAssetsCSV(secilenler) {
  // Argüman verilmezse EKRANDA GÖRÜNEN (filtrelenmiş) liste dışa aktarılır.
  // Toplu seçim çubuğu yalnız seçilenleri gönderir.
  const assets = Array.isArray(secilenler) ? secilenler
    : (state.renderedAssets || state.assets || []);
  if (!assets.length) { alert('Dışa aktarılacak kayıt yok.'); return; }

  const cols = [
    ['hostname', 'Hostname'], ['location', 'Lokasyon'], ['category', 'Kategori'],
    ['brand', 'Marka'], ['model', 'Model'], ['serial_number', 'Seri No'],
    ['cpu', 'CPU'], ['ram_gb', 'RAM (GB)'], ['storage_gb', 'Disk (GB)'],
    ['ip_address', 'IP'], ['mac_address', 'MAC'], ['os', 'OS'],
    ['username', 'Kullanıcı'], ['status', 'Durum'], ['last_seen', 'Son Görülme'],
  ];
  const esc = (v) => {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = cols.map(([, label]) => esc(label)).join(';');
  const rows = assets.map((a) => cols.map(([key]) => esc(a[key])).join(';'));
  // BOM + ; ayraç → Excel Türkçe/UTF-8 doğru açar
  const csv = '﻿' + [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `assetman-envanter-${stamp}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─── Turkcell Hat / SIM Yönetimi ───────────────────────────────────────────── */
let _lines = [];
const LINE_STATUS_CLS = { aktif: 'badge--online', pasif: 'badge--unknown', iptal: 'badge--offline' };

async function loadLines() {
  const tbody = $(`#linesBody`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Yükleniyor...</td></tr>`;
  try {
    const res = await fetch('/api/lines');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _lines = data.lines || [];
    const s = data.summary || {};
    const setC = (id, v) => { const el = $(`#${id}`); if (el) animateCount(el, v); };
    setC('lineTotal', s.total || 0); setC('lineAssigned', s.assigned || 0); setC('lineUnassigned', s.unassigned || 0);
    const cnt = $(`#lineCount`); if (cnt) cnt.textContent = `${s.total || 0} hat · ${s.assigned || 0} telefona bağlı`;
    renderLinesTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderLinesTable() {
  const tbody = $(`#linesBody`);
  if (!tbody) return;
  if (!_lines.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Kayıtlı hat yok. "Hat Ekle" veya "CSV İçe Aktar" ile başlayın.</td></tr>`;
    return;
  }
  const stCls = (st) => LINE_STATUS_CLS[st] || 'badge--unknown';
  tbody.innerHTML = _lines.map((l) => `
    <tr>
      <td class="hostname-cell">${fmt(l.msisdn)}</td>
      <td class="serial-cell">${fmt(l.iccid)}</td>
      <td>${fmt(l.operator)}</td>
      <td>${fmt(l.tariff)}</td>
      <td><span class="badge ${stCls(l.status)}">${fmt(l.status)}</span></td>
      <td>${l.assigned_hostname ? `<span class="hostname-cell">${escapeHtml(l.assigned_hostname)}</span>` : '<span style="color:var(--text-muted)">boşta</span>'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn-icon line-assign" data-id="${l.id}" title="Telefona ata" style="display:inline-flex">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
        </button>
        ${l.assigned_asset_id ? `<button class="btn-icon line-release" data-id="${l.id}" title="Telefondan çıkar" style="display:inline-flex;margin-left:4px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        </button>` : ''}
        <button class="btn-icon line-history" data-id="${l.id}" title="Geçmiş" style="display:inline-flex;margin-left:4px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.line-assign').forEach(b => b.addEventListener('click', () => assignLinePrompt(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-release').forEach(b => b.addEventListener('click', () => releaseLineAction(Number(b.dataset.id))));
  tbody.querySelectorAll('.line-history').forEach(b => b.addEventListener('click', () => showLineHistory(Number(b.dataset.id))));
}

function openLineModal() {
  ['lineMsisdn', 'lineIccid', 'lineTariff'].forEach(id => { const el = $(`#${id}`); if (el) el.value = ''; });
  const op = $(`#lineOperator`); if (op) op.value = 'Turkcell';
  $(`#lineModalOverlay`)?.classList.add('open');
}

async function saveLine() {
  const body = {
    msisdn: $(`#lineMsisdn`)?.value.trim(),
    iccid: $(`#lineIccid`)?.value.trim(),
    operator: $(`#lineOperator`)?.value.trim() || 'Turkcell',
    tariff: $(`#lineTariff`)?.value.trim(),
    status: $(`#lineStatus`)?.value || 'aktif',
  };
  if (!body.msisdn || !body.iccid) { alert('Telefon no ve SIM no zorunludur.'); return; }
  try {
    const res = await fetch('/api/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error || 'Hata');
    $(`#lineModalOverlay`)?.classList.remove('open');
    loadLines();
  } catch (err) { alert('Hat kaydedilemedi: ' + err.message); }
}

async function assignLinePrompt(lineId) {
  // Telefon kategorisindeki cihazlardan seç (state.assets veya taze çek)
  let phones = (state.assets || []).filter(a => a.category === 'Telefon');
  if (!phones.length) { try { const d = await fetchAssets({ size: 200 }); phones = (d.results || []).filter(a => a.category === 'Telefon'); } catch {} }
  const opts = phones.map((p, i) => `${i + 1}) ${p.hostname} (${p.username || 'zimmetsiz'})`).join('\n');
  const pick = prompt(`Hangi telefona atansın? Numara girin:\n\n${opts}`);
  if (!pick) return;
  const idx = parseInt(pick, 10) - 1;
  const phone = phones[idx];
  if (!phone) { alert('Geçersiz seçim.'); return; }
  try {
    const res = await fetch(`/api/lines/${lineId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: phone.id, hostname: phone.hostname }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadLines();
  } catch (err) { alert('Atanamadı: ' + err.message); }
}

async function releaseLineAction(lineId) {
  if (!confirm('Bu hat telefondan çıkarılsın (boşa alınsın) mı?')) return;
  try {
    const res = await fetch(`/api/lines/${lineId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    loadLines();
  } catch (err) { alert('İade edilemedi: ' + err.message); }
}

async function showLineHistory(lineId) {
  try {
    const res = await fetch(`/api/lines/${lineId}/history`);
    const j = await res.json();
    const h = j.history || [];
    const line = _lines.find(l => l.id === lineId);
    const ACT = { olusturuldu: 'Envantere eklendi', atandi: 'Telefona atandı', iade: 'Telefondan çıkarıldı' };
    const body = h.length
      ? h.map(e => `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
          <div style="flex:1"><div style="color:var(--text);font-weight:500">${ACT[e.action] || e.action}${e.hostname ? ` — ${escapeHtml(e.hostname)}` : ''}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:1px">${fmtDate(e.at)} · ${escapeHtml(e.actor || '—')}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</div></div>
        </div>`).join('')
      : '<p style="padding:4px 0;color:var(--text-muted)">Geçmiş kaydı yok.</p>';
  // Cihaz modalını yeniden kullan (başlık + body)
  $(`#deviceModalTitle`).textContent = `${line ? line.msisdn : 'Hat'} — Geçmiş`;
  $(`#deviceModalBody`).innerHTML = `<div style="font-size:12.5px">${body}</div>`;
  $(`#handoverPdfBtn`).style.display = 'none';
  _deviceModalAsset = null;
  $(`#deviceModalOverlay`)?.classList.add('open');
  } catch (err) { alert('Geçmiş alınamadı: ' + err.message); }
}

// CSV import: başlık satırı iccid,msisdn,operator,tariff,status bekler (esnek eşleme)
function importLinesCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { alert('CSV boş veya sadece başlık var.'); return; }
  const delim = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/^﻿/, ''));
  const idx = (names) => headers.findIndex(h => names.includes(h));
  const iIccid = idx(['iccid', 'sim', 'sim no', 'sim_no']);
  const iMsisdn = idx(['msisdn', 'numara', 'telefon', 'telefon no', 'phone']);
  const iOp = idx(['operator', 'operatör']);
  const iTariff = idx(['tariff', 'tarife', 'paket']);
  const iStatus = idx(['status', 'durum']);
  if (iIccid < 0 || iMsisdn < 0) { alert('CSV başlığında iccid ve msisdn sütunları bulunmalı.'); return; }
  const rows = lines.slice(1).map(line => {
    const c = line.split(delim);
    return {
      iccid: (c[iIccid] || '').trim(), msisdn: (c[iMsisdn] || '').trim(),
      operator: iOp >= 0 ? (c[iOp] || '').trim() || 'Turkcell' : 'Turkcell',
      tariff: iTariff >= 0 ? (c[iTariff] || '').trim() : '',
      status: iStatus >= 0 ? (c[iStatus] || '').trim() || 'aktif' : 'aktif',
    };
  }).filter(r => r.iccid && r.msisdn);
  if (!rows.length) { alert('Geçerli satır bulunamadı.'); return; }
  fetch('/api/lines/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
    .then(r => r.json())
    .then(j => {
      if (j.error) throw new Error(j.detail || j.error);
      alert(`İçe aktarma tamam: ${j.created} yeni, ${j.updated} güncellendi${j.errors?.length ? `, ${j.errors.length} hata` : ''}.`);
      loadLines();
    })
    .catch(err => alert('İçe aktarma hatası: ' + err.message));
}

/* ─── Ayarlar (admin) ───────────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.status === 403) { $(`#systemStatusBody`).innerHTML = `<tr><td colspan="2" class="loading-cell">Bu sayfa yalnız yöneticiler içindir.</td></tr>`; return; }
    const data = await res.json();
    const th = data.settings?.thresholds || {};
    const setV = (id, v) => { const el = $(`#${id}`); if (el) el.value = v; };
    setV('setLowRam', th.low_ram_gb); setV('setLowDisk', th.low_disk_gb);
    setV('setUptime', th.old_uptime_days); setV('setOffline', th.offline_hours); setV('setStale', th.stale_days);
    setV('setLocDrift', th.location_drift_days);
    setV('setTheme', data.settings?.appearance?.theme || 'auto');
    renderSystemStatus(data.system || {});
    loadLocationSetup(data.system || {});
    loadGeoTable();
    loadImageTable();
    loadAgents();
  } catch (err) {
    $(`#systemStatusBody`).innerHTML = `<tr><td colspan="2" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderSystemStatus(s) {
  const tbody = $(`#systemStatusBody`);
  if (!tbody) return;
  const yn = (b) => b ? '<span class="badge badge--online">yapılandırıldı</span>' : '<span class="badge badge--unknown">yok</span>';
  const rows = [
    ['Sürüm', s.version || '—'],
    ['Ortam', s.node_env || '—'],
    ['Veritabanı', (s.database?.driver || '—')],
    ['Kimlik sağlayıcı', s.auth_provider || '—'],
    ['Döviz kaynağı', s.fx_provider || '—'],
    ['Onay bekleme süresi', (s.approval_ttl_hours != null ? s.approval_ttl_hours + ' saat' : '—')],
    ['Baserow bağlantısı', yn(s.integrations?.baserow)],
    ['Anthropic anahtarı', yn(s.integrations?.anthropic_key)],
    ['n8n bildirim', yn(s.integrations?.n8n_notify)],
    ['LDAP/AD', yn(s.integrations?.ldap)],
    ['Lokasyon token doğrulaması', yn(s.integrations?.location_tokens)],
    ['WORM yedek', s.backup ? (s.backup.in_sync ? '<span class="badge badge--online">senkron</span>' : '<span class="badge badge--offline">senkron değil</span>') : '—'],
  ];
  tbody.innerHTML = rows.map(([k, v]) => `<tr><td style="color:var(--text-muted);width:40%">${k}</td><td class="hostname-cell">${v}</td></tr>`).join('');
}

/* Ayarlar → Lokasyon İzleme kurulum durumu.
   Modül "açık ama görünmez" kalabilir (token yok / beklenen lokasyon tohumlanmamış)
   → bu durumu gizlemek yerine açıkça yaz. */
async function loadLocationSetup(system) {
  const box = $(`#locSetupStatus`);
  if (!box) return;
  try {
    const drift = await fetchLocationDrift();
    const tokensOn = !!system?.integrations?.location_tokens;
    const total = (drift.unassigned || 0) + (drift.count || 0);
    const line = (ok, text) =>
      `<div><span style="color:${ok ? 'var(--green)' : 'var(--yellow)'};font-weight:700">${ok ? '✓' : '!'}</span> ${text}</div>`;

    box.innerHTML =
      line(tokensOn,
        tokensOn
          ? 'Lokasyon token doğrulaması <strong>açık</strong> — ajan bildirimleri doğrulanıyor.'
          : 'Lokasyon token doğrulaması <strong>kapalı</strong> (.env → LOCATION_TOKENS tanımsız). Webhook’tan gelen lokasyon doğrulanmıyor.') +
      line(drift.unassigned === 0,
        drift.unassigned === 0
          ? 'Tüm cihazların beklenen lokasyonu tanımlı.'
          : `<strong>${drift.unassigned}</strong> cihazın beklenen lokasyonu tanımlı değil — sapma taramasının dışındalar.`) +
      line(true, `Sapma eşiği: <strong>${drift.threshold_days} gün</strong> · şu an <strong>${drift.count}</strong> sapma.`);

    const btn = $(`#seedExpectedBtn`);
    if (btn) btn.disabled = drift.unassigned === 0 && total > 0;
  } catch (err) {
    box.innerHTML = `<span style="color:var(--red)">Durum alınamadı: ${escapeHtml(err.message)}</span>`;
  }
}

async function seedExpectedLocations() {
  const msg = $(`#seedMsg`);
  if (!confirm('Her cihazın envanterdeki mevcut lokasyonu, beklenen (resmi) lokasyon olarak kaydedilecek.\n\nBeklenen lokasyon tablosu boş değilse işlem atlanır — mevcut kayıtlar EZİLMEZ.\n\nDevam edilsin mi?')) return;
  try {
    const res = await fetch('/api/location-drift/seed', { method: 'POST' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (msg) {
      msg.style.color = j.skipped ? 'var(--yellow)' : 'var(--green)';
      msg.textContent = j.skipped
        ? 'Atlandı — beklenen lokasyonlar zaten tanımlı.'
        : `✓ ${j.count} cihaza beklenen lokasyon atandı.`;
    }
    loadSettings();
  } catch (err) {
    if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; }
  }
}

async function saveThresholds() {
  const body = {
    low_ram_gb: $(`#setLowRam`)?.value, low_disk_gb: $(`#setLowDisk`)?.value,
    old_uptime_days: $(`#setUptime`)?.value, offline_hours: $(`#setOffline`)?.value, stale_days: $(`#setStale`)?.value,
    location_drift_days: $(`#setLocDrift`)?.value,
  };
  const msg = $(`#thresholdsMsg`);
  try {
    const res = await fetch('/api/settings/thresholds', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    if (msg) { msg.textContent = '✓ Kaydedildi — yeni eşikler anında geçerli'; setTimeout(() => msg.textContent = '', 3000); }
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

async function saveAppearance() {
  const theme = $(`#setTheme`)?.value || 'auto';
  applyTheme(theme);
  const msg = $(`#appearanceMsg`);
  try {
    const res = await fetch('/api/settings/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
    if (!res.ok) throw new Error('Hata');
    localStorage.setItem('theme', theme);
    if (msg) { msg.textContent = '✓ Kaydedildi'; setTimeout(() => msg.textContent = '', 3000); }
  } catch (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'Hata: ' + err.message; } }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme'); // auto → prefers-color-scheme
}

/* ─── Cihaz Detay & Geçmiş Modalı ───────────────────────────────────────────── */
let _deviceModalAsset = null;

/* ═══ Varlık Detayı ══════════════════════════════════════════════════════════
   Görsel MODELE bağlıdır (cihaza değil): bir kez yüklenen görsel o modeldeki
   tüm cihazlarda görünür. Eşleşme 4 kademeli (sunucuda): tam model → model
   ailesi → marka+kategori → kategori. Hiçbiri yoksa aşağıdaki YERLEŞİK
   kategori çizimi kullanılır — sayfa asla boş görünmez.
   Görseller kendi sunucumuzdan servis edilir; dış CDN/görsel API'si YOK. */
const KAT_CIZIM = {
  'Bilgisayar': `<rect x="10" y="16" width="60" height="38" rx="4"/><path d="M4 60h72l-6-6H10z"/><rect x="16" y="22" width="48" height="26" rx="2" opacity=".35"/>`,
  'Sunucu': `<rect x="14" y="12" width="52" height="16" rx="3"/><rect x="14" y="32" width="52" height="16" rx="3"/><rect x="14" y="52" width="52" height="12" rx="3"/><circle cx="22" cy="20" r="2.2" opacity=".55"/><circle cx="22" cy="40" r="2.2" opacity=".55"/>`,
  'Telefon': `<rect x="26" y="8" width="28" height="56" rx="5"/><rect x="30" y="14" width="20" height="40" rx="2" opacity=".35"/><circle cx="40" cy="59" r="2"/>`,
  'Tablet': `<rect x="18" y="10" width="44" height="54" rx="4"/><rect x="22" y="15" width="36" height="42" rx="2" opacity=".35"/><circle cx="40" cy="60" r="1.8"/>`,
  'El Terminali': `<rect x="24" y="6" width="32" height="62" rx="5"/><rect x="28" y="12" width="24" height="26" rx="2" opacity=".35"/><rect x="29" y="43" width="8" height="6" rx="1" opacity=".55"/><rect x="43" y="43" width="8" height="6" rx="1" opacity=".55"/><rect x="29" y="53" width="22" height="6" rx="1" opacity=".55"/>`,
  'Yazıcı': `<path d="M22 10h36v16H22z"/><rect x="10" y="26" width="60" height="24" rx="4"/><path d="M22 44h36v22H22z" opacity=".35"/><circle cx="60" cy="34" r="2.5" opacity=".7"/>`,
  'Ağ Aygıtı': `<rect x="8" y="40" width="64" height="20" rx="4"/><circle cx="18" cy="50" r="2.4" opacity=".7"/><circle cx="27" cy="50" r="2.4" opacity=".7"/><circle cx="36" cy="50" r="2.4" opacity=".7"/><path d="M40 40V22M28 14l12-8 12 8" stroke-width="4" fill="none"/>`,
  'Çevre Aygıtı': `<path d="M14 34a26 26 0 0 1 52 0v16a6 6 0 0 1-6 6h-8V34h14"/><path d="M14 50V34h14v22h-8a6 6 0 0 1-6-6z"/>`,
  'Diğer': `<rect x="12" y="16" width="56" height="44" rx="5"/><path d="M12 30h56" opacity=".5"/>`,
};


/* "15 saniye önce" biçimi — duvar ekranında mutlak tarihten daha okunur. */
function gecenSure(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const sn = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sn < 60) return `${sn} saniye önce`;
  if (sn < 3600) return `${Math.floor(sn / 60)} dakika önce`;
  if (sn < 86400) return `${Math.floor(sn / 3600)} saat önce`;
  return `${Math.floor(sn / 86400)} gün önce`;
}

function katCizim(kategori) {
  const p = KAT_CIZIM[kategori] || KAT_CIZIM['Diğer'];
  return `<svg viewBox="0 0 80 76" fill="currentColor" stroke="currentColor" stroke-width="0"
    aria-hidden="true" class="ad-illus">${p}</svg>`;
}

function trTarih(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? v : d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function trPara(v, cur) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sim = { TRY: '₺', USD: '$', EUR: '€' }[cur || 'TRY'] || '';
  return sim + n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══ TELEMETRİ SEKMESİ ═════════════════════════════════════════════════════
   HİÇBİR SAYI UYDURULMAZ. Cihaz ölçümü göndermediyse kart "ölçüm yok" der.
   Bu bilinçli: bir sunucuda pil, bir sanal makinede sıcaklık sensörü YOKTUR;
   oraya %0 veya 0°C yazmak müşteriye yanlış bilgi vermek olurdu. Aynı şekilde
   güvenlik kartında "bilinmiyor" ile "kapalı" ayrı gösterilir — biri okunamadı,
   diğeri gerçekten kapalı demektir. */

/* Sparkline: dış kütüphane yok, düz SVG polyline. */
function sparkline(degerler, renk) {
  const v = (degerler || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  if (v.length < 2) return '<div class="tm-spark tm-spark--bos">grafik için en az 2 ölçüm gerekir</div>';
  const en = Math.min(...v), buyuk = Math.max(...v);
  const fark = buyuk - en || 1;         // düz çizgi: sıfıra bölme koruması
  const W = 100, H = 28;
  const nok = v.map((x, i) => {
    const px = (i / (v.length - 1)) * W;
    const py = H - ((x - en) / fark) * (H - 4) - 2;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  return `<svg class="tm-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${nok}" fill="none" stroke="${renk}" stroke-width="1.6"
      vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

const TVA_YENILE = Number(localStorage.getItem("tvaYenile") || 30000);  // ms
/* ═══ VARLIK DETAYI · TV / DUVAR EKRANI ══════════════════════════════════════
   TV modunda bir varlık açıldığında modal yerine tam ekran, koyu, kendini
   yenileyen tek-cihaz panosu çizilir. Duvar ekranında kimse tıklamıyor:
   her şey aynı anda görünmeli, uzaktan okunabilmeli ve kendi kendine
   tazelenmeli.

   VERİ DÜRÜSTLÜĞÜ: tasarımda lokasyon kartında bina fotoğrafı ve açık adres,
   kullanıcı kartında e-posta ve unvan var — bunların HİÇBİRİ sistemde yok.
   Uydurmak yerine sahip olduğumuz alanlar gösteriliyor (lokasyon adı,
   varsa koordinat; zimmetli kişinin adı). Eksik alan "—" kalır. */

let _tvaTimer = null;   // otomatik yenileme

/* Büyük çizgi grafik (sparkline'dan farklı: eksen etiketleri + ızgara).
   Duvar ekranından metrenin ötesinden okunacağı için etiketler iri. */
function tvaChart(seri, renk, baslik) {
  const v = (seri || []).filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  if (v.length < 2) {
    return `<div class="tva-ch">
      <div class="tva-ch-t">${escapeHtml(baslik)}</div>
      <div class="tva-ch-bos">grafik için en az 2 ölçüm gerekir</div></div>`;
  }
  const W = 300, H = 62;
  const nok = v.map((x, i) => {
    const px = (i / (v.length - 1)) * W;
    const py = H - (Math.max(0, Math.min(100, x)) / 100) * H;   // 0-100 sabit ölçek
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(' ');
  return `<div class="tva-ch">
    <div class="tva-ch-t">${escapeHtml(baslik)}</div>
    <div class="tva-ch-body">
      <div class="tva-ch-y"><span>100</span><span>50</span><span>0</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="0.5" x2="${W}" y2="0.5"/>
        <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}"/>
        <line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>
        <polyline points="${nok}" fill="none" stroke="${renk}" stroke-width="1.8"
          vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
    </div></div>`;
}

/* Cihaza özel kritik uyarılar — HEPSİ mevcut veriden hesaplanır.
   Uyarı yoksa yeşil onay gösterilir; "sorun yok" da bir bilgidir. */
function tvaUyarilar(a, d, tel) {
  const u = [];
  const L = tel.latest, G = tel.security;

  if (String(a.status || '').toLowerCase() === 'offline') u.push(['kritik', 'Cihaz çevrimdışı']);

  const gar = Date.parse(a.warranty_expiry);
  if (!Number.isNaN(gar)) {
    const gun = Math.ceil((gar - Date.now()) / 86400000);
    if (gun < 0) u.push(['kritik', 'Garanti süresi dolmuş']);
    else if (gun <= 30) u.push(['uyari', `Garanti ${gun} gün içinde bitiyor`]);
  }

  if (L && L.disk_used_gb != null && L.disk_total_gb) {
    const pct = Math.round((L.disk_used_gb / L.disk_total_gb) * 100);
    if (pct >= 90) u.push(['kritik', `Disk %${pct} dolu`]);
    else if (pct >= 80) u.push(['uyari', `Disk %${pct} dolu`]);
  }
  if (L && L.cpu_pct != null && L.cpu_pct >= 90) u.push(['uyari', `CPU %${Math.round(L.cpu_pct)}`]);
  if (L && L.temp_c != null && L.temp_c >= 80) u.push(['kritik', `Sıcaklık ${L.temp_c}°C`]);

  if (G) {
    if (G.firewall === 'pasif') u.push(['kritik', 'Güvenlik duvarı kapalı']);
    if (G.defender === 'pasif') u.push(['kritik', 'Defender kapalı']);
    if (G.disk_encryption === 'pasif') u.push(['uyari', 'Disk şifreleme kapalı']);
    if (G.critical_patches > 0) u.push(['kritik', `${G.critical_patches} kritik yama bekliyor`]);
  }

  // Beklenen lokasyon dışında mı? (resmi kayıt vs telemetri)
  const bek = d.expected_location?.location;
  const gor = d.current_stay?.to_location || (a.location || '').trim();
  if (bek && gor && bek.toLowerCase() !== gor.toLowerCase()) {
    u.push(['uyari', `Lokasyon dışında: ${gor}`]);
  }
  return u;
}

function renderTvAsset(a, d, tel) {
  const det = d.detail || {};
  const L = tel.latest, S = tel.series || [];
  const yuzde = (kul, top) => (kul == null || !top ? null : Math.round((kul / top) * 100));
  const gorsel = d.image
    ? `<img src="${d.image.url}" alt="" class="tva-img">`
    : `<div class="tva-illus">${katCizim(a.category)}</div>`;

  const olc = (baslik, deger, alt, seri, renk) => `
    <div class="tva-m">
      <div class="tva-m-t">${escapeHtml(baslik)}</div>
      ${deger === null || deger === undefined
        ? '<div class="tva-m-yok">Ölçüm yok</div>'
        : `<div class="tva-m-v">${deger}</div><div class="tva-m-a">${alt || ''}</div>
           ${sparkline(seri, renk)}`}
    </div>`;

  const ramP = L ? yuzde(L.ram_used_gb, L.ram_total_gb) : null;
  const diskP = L ? yuzde(L.disk_used_gb, L.disk_total_gb) : null;
  const pilAd = { sarj_oluyor: 'Şarj oluyor', pilde: 'Pilde', dolu: 'Dolu' };

  const metrikler = [
    olc('CPU Kullanımı', L && L.cpu_pct != null ? `${Math.round(L.cpu_pct)}%` : null,
      L && L.cpu_pct != null ? (L.cpu_pct < 50 ? 'İyi' : L.cpu_pct < 85 ? 'Yoğun' : 'Kritik') : '',
      S.map(r => r.cpu_pct), 'var(--blue)'),
    olc('RAM Kullanımı', ramP != null ? `${ramP}%` : null,
      L && L.ram_used_gb != null ? `${L.ram_used_gb} GB / ${L.ram_total_gb || '?'} GB` : '',
      S.map(r => yuzde(r.ram_used_gb, r.ram_total_gb)), 'var(--accent)'),
    olc('Disk Kullanımı', diskP != null ? `${diskP}%` : null,
      L && L.disk_used_gb != null ? `${Math.round(L.disk_used_gb)} GB / ${Math.round(L.disk_total_gb || 0)} GB` : '',
      S.map(r => yuzde(r.disk_used_gb, r.disk_total_gb)), 'var(--purple)'),
    olc('Ağ Kullanımı', L && L.net_rx_mbps != null
      ? `${(Number(L.net_rx_mbps) + Number(L.net_tx_mbps || 0)).toFixed(1)} <small>Mbps</small>` : null,
      L && L.net_rx_mbps != null ? `↓ ${L.net_rx_mbps} &nbsp; ↑ ${L.net_tx_mbps ?? '—'}` : '',
      S.map(r => r.net_rx_mbps), 'var(--teal)'),
    olc('Pil Durumu', L && L.battery_pct != null ? `${Math.round(L.battery_pct)}%` : null,
      L ? (pilAd[L.battery_state] || '') : '', S.map(r => r.battery_pct), 'var(--green)'),
    olc('Sıcaklık', L && L.temp_c != null ? `${L.temp_c}°C` : null,
      L && L.temp_c != null ? (L.temp_c < 60 ? 'Normal' : L.temp_c < 80 ? 'Yüksek' : 'Kritik') : '',
      S.map(r => r.temp_c), 'var(--orange)'),
  ].join('');

  const upt = a.uptime_days != null
    ? `${Math.floor(a.uptime_days)} gün, ${Math.round((a.uptime_days % 1) * 24)} saat` : '—';

  const serit = [
    ['Son Görülme', gecenSure(a.last_seen)],
    ['Son Envanter Taraması', tel.latest ? fmtDate(tel.latest.measured_at) : '—'],
    ['Son Bakım', trTarih(det.last_maintenance)],
    ['Sonraki Bakım', trTarih(det.next_maintenance)],
    ['Çalışma Süresi', upt],
  ].map(([k, v]) => `<div class="tva-s"><span>${k}</span><b>${v}</b></div>`).join('');

  const G = tel.security;
  const rz = (v) => v === 'aktif' ? '<b class="tva-ok">Aktif</b>'
    : v === 'pasif' ? '<b class="tva-no">Kapalı</b>'
    : '<b class="tva-bilinmiyor">bilinmiyor</b>';

  const uyarilar = tvaUyarilar(a, d, tel);

  return `
  <div class="tva">
    <div class="tva-head">
      <div class="tva-brand"><b>AssetMan</b><span>OPERASYON MERKEZİ</span></div>
      <div class="tva-head-r">
        <span class="tva-sys"><i class="${uyarilar.some(x => x[0] === 'kritik') ? 'kirmizi' : uyarilar.length ? 'sari' : 'yesil'}"></i>
          Sistem Durumu <b>${uyarilar.some(x => x[0] === 'kritik') ? 'KRİTİK' : uyarilar.length ? 'DİKKAT' : 'TÜM SİSTEMLER NORMAL'}</b></span>
        <span class="tva-clock" id="tvaClock"></span>
        <button class="btn-icon" id="tvaExit" title="TV modundan çık" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <div class="tva-main">
      <div class="tva-dev">
        <div class="tva-photo">${gorsel}</div>
        <h2 class="tva-name">${fmt(a.hostname)}</h2>
        <div class="tva-badge ${String(a.status).toLowerCase() === 'online' ? 'on' : 'off'}">
          <i></i>${escapeHtml(a.status || 'bilinmiyor')}</div>
        <div class="tva-ident">
          <div><span>Varlık Kodu</span><b>${det.asset_code ? escapeHtml(det.asset_code) : '—'}</b></div>
          <div><span>Kategori</span><b>${escapeHtml(a.category || '—')}</b></div>
          <div><span>Lokasyon</span><b>${escapeHtml((a.location || '').trim() || '—')}</b></div>
          <div><span>Sorumlu Kişi</span><b>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</b></div>
          <div><span>İşletim Sistemi</span><b>${fmt(a.os)}</b></div>
          <div><span>Agent Versiyonu</span><b>${a.collector_ver ? escapeHtml(a.collector_ver) : '—'}</b></div>
        </div>
      </div>

      <div class="tva-metrics">${metrikler}</div>
      <div class="tva-strip">${serit}</div>
    </div>

    <div class="tva-r3">
      <div class="tva-card">
        <h4>Konum &amp; Kullanıcı</h4>
        <div class="tva-kk">
          <div class="tva-kk-i">📍</div>
          <div><b>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</b>
            <small>${d.current_stay?.first_seen_at ? fmtDate(d.current_stay.first_seen_at) + '’den beri' : 'konaklama kaydı yok'}</small></div>
        </div>
        <div class="tva-kk">
          <div class="tva-kk-i tva-kk-av">${(d.assignment?.assigned_to || '?').slice(0, 2).toLocaleUpperCase('tr-TR')}</div>
          <div><b>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</b>
            <small>${a.username ? 'son giriş: ' + escapeHtml(a.username) : 'oturum bilgisi yok'}</small></div>
        </div>
      </div>

      <div class="tva-card">
        <h4>Sistem Bilgileri</h4>
        <div class="tva-row"><span>Üretici / Model</span><b>${fmt(a.brand)} ${fmt(a.model, '')}</b></div>
        <div class="tva-row"><span>Seri Numarası</span><b>${fmt(a.serial_number)}</b></div>
        <div class="tva-row"><span>IP Adresi</span><b>${fmt(a.ip_address)}</b></div>
        <div class="tva-row"><span>MAC Adresi</span><b>${fmt(a.mac_address)}</b></div>
        <div class="tva-row"><span>Domain</span><b>${fmt(a.domain)}</b></div>
        <div class="tva-row"><span>Satın Alma</span><b>${trTarih(det.purchase_date)}</b></div>
        <div class="tva-row"><span>Garanti Bitiş</span><b>${trTarih(a.warranty_expiry)}</b></div>
        <div class="tva-row"><span>Tedarikçi</span><b>${fmt(det.supplier)}</b></div>
      </div>

      <div class="tva-card">
        <h4>Güvenlik Durumu</h4>
        ${G ? `
          <div class="tva-row"><span>Windows Defender</span>${rz(G.defender)}</div>
          <div class="tva-row"><span>Güvenlik Duvarı</span>${rz(G.firewall)}</div>
          <div class="tva-row"><span>Disk Şifreleme</span>${rz(G.disk_encryption)}</div>
          <div class="tva-row"><span>Antivirüs</span>${G.antivirus_name
            ? `<b class="${G.antivirus === 'aktif' ? 'tva-ok' : 'tva-no'}">${escapeHtml(G.antivirus_name)}</b>` : rz(G.antivirus)}</div>
          <div class="tva-row"><span>OS Güncellemesi</span><b class="${G.os_update === 'guncel' ? 'tva-ok' : G.os_update === 'bekliyor' ? 'tva-uyari' : 'tva-bilinmiyor'}">
            ${G.os_update === 'guncel' ? 'Güncel' : G.os_update === 'bekliyor' ? 'Bekliyor' : 'bilinmiyor'}</b></div>
          <div class="tva-row"><span>Kritik Yama</span><b class="${G.critical_patches > 0 ? 'tva-no' : 'tva-ok'}">${G.critical_patches ?? '—'}</b></div>
          <div class="tva-row"><span>Bekleyen Güncelleme</span><b>${G.pending_updates ?? '—'}</b></div>`
        : '<p class="tva-bos">Bu cihazdan güvenlik durumu gelmedi.<br>Collector 1.2.0+ gerekiyor.</p>'}
      </div>

      <div class="tva-card">
        <h4>Son Telemetri Grafikleri <small>son 24 saat</small></h4>
        ${tvaChart(S.map(r => r.cpu_pct), 'var(--blue)', 'CPU Kullanımı (%)')}
        ${tvaChart(S.map(r => yuzde(r.ram_used_gb, r.ram_total_gb)), 'var(--accent)', 'RAM Kullanımı (%)')}
        ${tvaChart(S.map(r => yuzde(r.disk_used_gb, r.disk_total_gb)), 'var(--purple)', 'Disk Kullanımı (%)')}
      </div>

      <div class="tva-card tva-alerts">
        <h4>Kritik Uyarılar <em>${uyarilar.length}</em></h4>
        ${uyarilar.length
          ? `<div class="tva-ul">${uyarilar.map(([tur, mesaj]) =>
              `<div class="tva-u ${tur}"><i></i><span>${escapeHtml(mesaj)}</span></div>`).join('')}</div>`
          : `<div class="tva-temiz">
               <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
               <b>Kritik Uyarı Yok</b>
               <small>Bu cihazda tespit edilen sorun yok.</small>
             </div>`}
      </div>
    </div>

    <div class="tva-foot" id="tvaFoot"></div>
  </div>`;
}

/* TV panosunu canlı tutar: saat her saniye, ölçümler + filo özeti TVA_YENILE
   aralığıyla yenilenir. Duvar ekranı saatlerce açık kalıyor; elle yenilemeyi
   kimse yapmaz. Zamanlayıcılar pano kapanınca MUTLAKA durdurulur — yoksa
   arka planda sonsuza kadar istek atmaya devam ederdi. */
function tvaDurdur() {
  if (_tvaTimer) { clearInterval(_tvaTimer.saat); clearInterval(_tvaTimer.veri); _tvaTimer = null; }
}

function tvaBaslat(asset) {
  tvaDurdur();
  const saatYaz = () => {
    const e = $(`#tvaClock`);
    if (e) {
      const d = new Date();
      e.innerHTML = `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}
        <b>${d.toLocaleTimeString('tr-TR')}</b>`;
    }
  };
  saatYaz();
  tvaFooter();

  $(`#tvaExit`)?.addEventListener('click', () => {
    tvaDurdur();
    $(`#deviceModalOverlay`)?.classList.remove('open', 'tva-open');
  });

  _tvaTimer = {
    saat: setInterval(saatYaz, 1000),
    veri: setInterval(async () => {
      // Pano kapandıysa kendini durdur (kapatma yolu ne olursa olsun)
      if (!$(`#deviceModalOverlay`)?.classList.contains('open')) return tvaDurdur();
      try {
        const r = await fetch(`/api/assets/${asset.id}/telemetry`);
        if (!r.ok) return;
        const yeni = await r.json();
        const d2 = _deviceModalAsset === asset ? { asset } : { asset };
        // Yalnız ölçüm bloklarını tazele; tüm panoyu yeniden çizmek
        // kaydırma/odak durumunu sıfırlar ve gözle görülür titreme yapar.
        const kok = $(`#deviceModalBody`);
        const eski = kok?.querySelector('.tva-metrics');
        if (eski) {
          const gecici = document.createElement('div');
          gecici.innerHTML = renderTvAsset(asset, window._tvaDetay || d2, yeni);
          const yeniMetrik = gecici.querySelector('.tva-metrics');
          const yeniSerit = gecici.querySelector('.tva-strip');
          if (yeniMetrik) eski.innerHTML = yeniMetrik.innerHTML;
          const serit = kok.querySelector('.tva-strip');
          if (serit && yeniSerit) serit.innerHTML = yeniSerit.innerHTML;
        }
        state.stats = null;          // filo sayıları da tazelensin
        tvaFooter();
      } catch { /* ağ kesildi: bir sonraki turda yeniden dener */ }
    }, TVA_YENILE),
  };
}

/* Alt bant: filo özeti. Tek cihaz ekranında bile duvar ekranının genel
   durumu göstermesi bekleniyor. Sayılar /api/stats'tan GERÇEK gelir. */
async function tvaFooter() {
  const el = $(`#tvaFoot`);
  if (!el) return;
  try {
    const st = state.stats || await fetchStats();
    state.stats = st;
    const by = st.by_status || {};
    const top = st.total || 0;
    const on = by.online || 0, off = by.offline || 0;
    const pct = (n) => (top ? `%${Math.round((n / top) * 100)}` : '—');
    el.innerHTML = `
      <div class="tva-f"><span>Toplam Cihaz</span><b>${top.toLocaleString('tr-TR')}</b></div>
      <div class="tva-f"><i class="yesil"></i><span>Online</span><b>${on.toLocaleString('tr-TR')} <small>${pct(on)}</small></b></div>
      <div class="tva-f"><i class="kirmizi"></i><span>Offline</span><b>${off.toLocaleString('tr-TR')} <small>${pct(off)}</small></b></div>
      <div class="tva-f"><i class="sari"></i><span>Depoda</span><b>${(by.depoda || 0).toLocaleString('tr-TR')}</b></div>
      <div class="tva-f tva-f-son"><span>Son güncelleme</span><b>${new Date().toLocaleTimeString('tr-TR')}</b>
        <small>otomatik yenileme ${TVA_YENILE / 1000}sn</small></div>`;
  } catch {
    el.innerHTML = '<div class="tva-f"><span>Filo özeti alınamadı</span></div>';
  }
}

function tmKart({ baslik, ikon, renk, deger, alt, seri, sinif }) {
  const yok = deger === null || deger === undefined;
  return `<div class="tm-card ${sinif || ''}">
    <div class="tm-h"><span class="ad-ico ${renk.sinif}">${ikon}</span>${escapeHtml(baslik)}</div>
    ${yok
      ? '<div class="tm-yok">Ölçüm yok</div>'
      : `<div class="tm-v">${deger}</div><div class="tm-alt">${alt || ''}</div>`}
    ${yok ? '' : sparkline(seri, renk.cizgi)}
  </div>`;
}

function renderTelemetri(tel, a) {
  const L = tel.latest;
  const S = tel.series || [];
  const al = (k) => S.map((r) => r[k]);
  const yuzde = (kul, top) => (kul == null || !top ? null : Math.round((kul / top) * 100));

  const R = {
    cpu:  { sinif: 'kpi-ico--blue',  cizgi: 'var(--blue)' },
    ram:  { sinif: 'kpi-ico--accent', cizgi: 'var(--accent)' },
    disk: { sinif: 'kpi-ico--purple', cizgi: 'var(--purple)' },
    ag:   { sinif: 'kpi-ico--teal',  cizgi: 'var(--teal)' },
    pil:  { sinif: 'kpi-ico--green', cizgi: 'var(--green)' },
    isi:  { sinif: 'kpi-ico--orange', cizgi: 'var(--orange)' },
  };
  const I = {
    cpu: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
    ram: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3M12 17v3M18 17v3"/></svg>',
    disk: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
    ag: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
    pil: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/></svg>',
    isi: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
  };

  const ramPct  = L ? yuzde(L.ram_used_gb, L.ram_total_gb) : null;
  const diskPct = L ? yuzde(L.disk_used_gb, L.disk_total_gb) : null;
  const pilDurum = { sarj_oluyor: 'Şarj oluyor', pilde: 'Pilde', dolu: 'Dolu' };
  const isiEtiket = (c) => (c == null ? '' : c < 60 ? 'Normal' : c < 80 ? 'Yüksek' : 'Kritik');

  const kartlar = [
    tmKart({ baslik: 'CPU Kullanımı', sinif: 'tm-card--cpu', ikon: I.cpu, renk: R.cpu,
      deger: L && L.cpu_pct != null ? `${Math.round(L.cpu_pct)}%` : null,
      alt: L && L.cpu_pct != null ? (L.cpu_pct < 50 ? 'İyi' : L.cpu_pct < 85 ? 'Yoğun' : 'Kritik') : '',
      seri: al('cpu_pct') }),
    tmKart({ baslik: 'RAM Kullanımı', sinif: 'tm-card--ram', ikon: I.ram, renk: R.ram,
      deger: ramPct != null ? `${ramPct}%` : null,
      alt: L && L.ram_used_gb != null ? `${L.ram_used_gb} GB / ${L.ram_total_gb || '?'} GB` : '',
      seri: S.map((r) => yuzde(r.ram_used_gb, r.ram_total_gb)) }),
    tmKart({ baslik: 'Disk Kullanımı', sinif: 'tm-card--disk', ikon: I.disk, renk: R.disk,
      deger: diskPct != null ? `${diskPct}%` : null,
      alt: L && L.disk_used_gb != null ? `${Math.round(L.disk_used_gb)} GB / ${Math.round(L.disk_total_gb || 0)} GB` : '',
      seri: S.map((r) => yuzde(r.disk_used_gb, r.disk_total_gb)) }),
    tmKart({ baslik: 'Ağ Kullanımı', sinif: 'tm-card--net', ikon: I.ag, renk: R.ag,
      deger: L && L.net_rx_mbps != null
        ? `<span class="tm-net">↓ ${L.net_rx_mbps} <small>Mbps</small></span><span class="tm-net">↑ ${L.net_tx_mbps ?? '—'} <small>Mbps</small></span>` : null,
      alt: '', seri: al('net_rx_mbps') }),
    tmKart({ baslik: 'Pil Durumu', sinif: 'tm-card--bat', ikon: I.pil, renk: R.pil,
      deger: L && L.battery_pct != null ? `${Math.round(L.battery_pct)}%` : null,
      alt: L ? (pilDurum[L.battery_state] || '') : '', seri: al('battery_pct') }),
    tmKart({ baslik: 'Sıcaklık', sinif: 'tm-card--temp', ikon: I.isi, renk: R.isi,
      deger: L && L.temp_c != null ? `${L.temp_c}°C` : null,
      alt: L ? isiEtiket(L.temp_c) : '', seri: al('temp_c') }),
  ].join('');

  // ── Sistem Bilgileri: TAMAMI envanterden, collector kurulu olmasa da dolu ──
  const bootTarih = a.uptime_days != null
    ? fmtDate(new Date(Date.now() - Number(a.uptime_days) * 86400000).toISOString()) : '—';
  const upt = a.uptime_days != null
    ? `${Math.floor(a.uptime_days)} gün ${Math.round((a.uptime_days % 1) * 24)} saat` : '—';
  const sistem = `
    <div class="ad-card tm-panel tm-panel--sistem">
      <div class="ad-card-h"><h4>Sistem Bilgileri</h4></div>
      <div class="ad-row"><span>Hostname</span><b>${fmt(a.hostname)}</b></div>
      <div class="ad-row"><span>Domain</span><b>${fmt(a.domain)}</b></div>
      <div class="ad-row"><span>IP Adresi</span><b class="serial-cell">${fmt(a.ip_address)}</b></div>
      <div class="ad-row"><span>MAC Adresi</span><b class="serial-cell">${fmt(a.mac_address)}</b></div>
      <div class="ad-row"><span>Uptime</span><b>${upt}</b></div>
      <div class="ad-row"><span>Son Başlatma</span><b>${bootTarih}</b></div>
    </div>`;

  // ── Güvenlik Durumu ────────────────────────────────────────────────────────
  const G = tel.security;
  const rozet = (v) => {
    if (v === 'aktif')  return '<b class="tm-ok">Aktif</b>';
    if (v === 'pasif')  return '<b class="tm-kotu">Kapalı</b>';
    if (v === 'yok')    return '<b class="tm-kotu">Yok</b>';
    return '<b class="ad-bos">bilinmiyor</b>';
  };
  const guvenlik = `
    <div class="ad-card tm-panel tm-panel--guvenlik">
      <div class="ad-card-h"><h4>Güvenlik Durumu</h4>
        ${G ? `<span class="tm-zaman">${fmtDate(G.checked_at)}</span>` : ''}</div>
      ${G ? `
        <div class="ad-row"><span>Windows Defender</span>${rozet(G.defender)}</div>
        <div class="ad-row"><span>Güvenlik Duvarı</span>${rozet(G.firewall)}</div>
        <div class="ad-row"><span>Disk Şifreleme</span>${rozet(G.disk_encryption)}</div>
        <div class="ad-row"><span>Antivirüs</span>${G.antivirus_name
          ? `<b class="${G.antivirus === 'aktif' ? 'tm-ok' : 'tm-kotu'}">${escapeHtml(G.antivirus_name)}</b>`
          : rozet(G.antivirus)}</div>
        <div class="ad-row"><span>OS Güncellemesi</span><b class="${G.os_update === 'guncel' ? 'tm-ok' : G.os_update === 'bekliyor' ? 'ad-warn' : 'ad-bos'}">
          ${G.os_update === 'guncel' ? 'Güncel' : G.os_update === 'bekliyor' ? 'Bekliyor' : 'bilinmiyor'}</b></div>
        <div class="ad-row"><span>Kritik Yama</span><b class="${G.critical_patches > 0 ? 'ad-warn' : ''}">${G.critical_patches ?? '—'}</b></div>
        <div class="ad-row"><span>Bekleyen Güncelleme</span><b>${G.pending_updates ?? '—'}</b></div>`
      : `<p class="ad-hint">Bu cihazdan güvenlik durumu gelmedi. Toplama betiği (collector)
         sürüm 1.1.0 ve üzeri bu bilgiyi gönderir; BitLocker ve Windows Update
         okuması yönetici yetkisi ister.</p>`}
    </div>`;

  const olcumVar = !!L;
  return `
    ${olcumVar ? '' : `<div class="tm-uyari">
      <strong>Bu cihazdan henüz canlı ölçüm gelmedi.</strong>
      Aşağıdaki kartlar toplama betiği (collector) sürüm 1.1.0 ve üzeri kurulduğunda dolar.
      Sistem Bilgileri paneli envanter kaydından geldiği için şimdiden dolu.
      <em>Sıcaklık ve pil her makinede okunamaz</em> — sunucuda pil, sanal makinede
      sıcaklık sensörü yoktur; o kartlar o cihazlarda boş kalır.
    </div>`}
    <div class="tm-wrap">
      <div class="tm-grid">${kartlar}</div>
      <div class="tm-panels">${sistem}${guvenlik}</div>
    </div>
    ${olcumVar ? `<p class="ad-hint">Grafikler son 24 saati gösterir (${S.length} ölçüm).
      Ölçümler ${tel.retention_days || 30} gün saklanır.</p>` : ''}`;
}

async function openDeviceModal(asset) {
  const overlay = $(`#deviceModalOverlay`);
  if (!overlay || !asset) return;
  _deviceModalAsset = asset;
  $(`#deviceModalTitle`).textContent = 'Varlık Detayı';
  const body = $(`#deviceModalBody`);
  body.innerHTML = '<p class="loading-cell">Yükleniyor...</p>';
  overlay.classList.add('open');
  const pdfBtn = $(`#handoverPdfBtn`); if (pdfBtn) pdfBtn.style.display = '';

  let d = { asset, detail: null, usage: null, image: null, assignment: null };
  /* Telemetri, 'Son Envanter Taraması' satırında da kullanıldığı için sekme
     açılışını beklemeden detayla PARALEL çekilir (iki ayrı bekleme olmasın). */
  let tel = { latest: null, series: [], security: null };
  try {
    const [r, rt] = await Promise.all([
      fetch(`/api/assets/${asset.id}/detail`),
      fetch(`/api/assets/${asset.id}/telemetry`).catch(() => null),
    ]);
    if (r.ok) d = await r.json();
    if (rt && rt.ok) tel = await rt.json();
  } catch { /* çevrimdışı: yalnız listedeki alanlarla çiz */ }

  const a = d.asset || asset;
  const det = d.detail || {};
  const gorsel = d.image
    ? `<img src="${d.image.url}" alt="${escapeHtml(a.model || a.hostname || '')}" class="ad-img">`
    : katCizim(a.category);

  const satir = (k, v, cls = '') => `<div class="ad-row"><span>${k}</span><b class="${cls}">${v}</b></div>`;

  /* TV MODU: modal yerine tam ekran tek-cihaz panosu. Duvar ekranında kimse
     tıklamıyor — sekmeli düzen orada işe yaramaz, her şey aynı anda görünmeli
     ve kendi kendine tazelenmeli. */
  if (document.body.classList.contains('tv-mode')) {
    body.innerHTML = renderTvAsset(a, d, tel);
    overlay.classList.add('tva-open');
    window._tvaDetay = d;          // yenilemede aynı detayı kullan (tek fetch)
    tvaBaslat(a);
    return;
  }
  overlay.classList.remove('tva-open');

  body.innerHTML = `
    <div class="ad-grid">
      <!-- Sol: görsel + kimlik + QR + zimmet -->
      <div class="ad-left">
        <!-- Kimlik kartı: görsel + ad + kimlik satırları + QR. Tablette tek kart
             olarak sol üstte durur (tasarım böyle), telefonda parçalanır:
             hero her sekmede görünür kalır, QR 'Zimmet & Konum' sekmesine iner. -->
        <div class="ad-idbox">
        <!-- Hero: telefonda HER SEKMEDE görünür kalır (hangi cihaza baktığını
             kaybetmeyesin). Geri kalanı mobilde sekmelere dağılır. -->
        <div class="ad-hero">
        <div class="ad-photo${d.image ? '' : ' ad-photo--illus'}">
          ${gorsel}
          ${statusBadge(a.status)}
        </div>
        <div class="ad-hero-t">
        <h3 class="ad-name">${fmt(a.hostname)}</h3>
        <div class="ad-ident">
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5h8v2"/></svg>${fmt(a.serial_number)}</span>
          <span>${categoryBadge(a.category)}</span>
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</span>
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${escapeHtml(d.assignment?.assigned_to || 'Zimmetsiz')}</span>
        </div>
        </div>
        </div>

        <!-- Telefonda QR bloğu gizli durur; "QR Kod" düğmesi açar. Küçük ekranda
             sürekli görünen 98px'lik QR kutusu, asıl içeriği aşağı itiyordu. -->
        <div class="ad-actions">
          <button class="btn-pdf" id="adActLabel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/></svg>
            Etiket Yazdır</button>
          <button class="btn-pdf" id="adActQr">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 19h2v2h-2z"/></svg>
            QR Kod</button>
        </div>

        <div class="ad-qr">
          <img id="adQr" alt="QR etiketi">
          <div>
            <b>${fmt(a.serial_number)}</b>
            <button class="btn-pdf" id="adPrintLabel">Etiket Yazdır</button>
          </div>
        </div>
        </div>

        <div class="ad-sec ad-sec--zimmet">
        <div id="deviceAssignBox"></div>
        <div id="deviceLocationBox"></div>
        ${a.category === 'Telefon' ? '<div id="deviceLineBox"></div>' : ''}
        </div>
      </div>

      <!-- Orta: temel bilgiler -->
      <div class="ad-card ad-sec ad-sec--genel ad-sec--temel">
        <div class="ad-card-h"><h4><span class="ad-ico kpi-ico--blue"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg></span>Temel Bilgiler</h4>
          ${state.role === 'admin' || state.role === 'it' ? '<button class="btn-pdf" id="adEditBasic">Düzenle</button>' : ''}<svg class="ad-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
        ${satir('Varlık Kodu', det.asset_code
          ? `<span class="serial-cell">${escapeHtml(det.asset_code)}</span>`
          : '<span class="ad-bos">tanımlı değil</span>')}
        ${satir('Seri Numarası', `<span class="serial-cell">${fmt(a.serial_number)}</span>`)}
        ${satir('Üretici / Model', `${fmt(a.brand)} ${fmt(a.model, '')}`)}
        ${satir('Kategori', escapeHtml(a.category || 'Diğer'))}
        ${satir('İşletim Sistemi', fmt(a.os))}
        ${satir('CPU', fmt(a.cpu))}
        ${satir('RAM / Disk', `${a.ram_gb ? a.ram_gb + ' GB' : '—'} / ${a.storage_gb ? a.storage_gb + ' GB' : '—'}`)}
        ${satir('IP / MAC', `<span class="serial-cell">${fmt(a.ip_address)} · ${fmt(a.mac_address)}</span>`)}
        ${satir('Satın Alma Tarihi', trTarih(det.purchase_date))}
        ${satir('Satın Alma Bedeli', trPara(det.purchase_price, det.currency))}
        ${satir('Garanti Bitiş', trTarih(a.warranty_expiry))}
        ${satir('Tedarikçi', fmt(det.supplier))}
      </div>

      <!-- Sağ: durum bilgileri -->
      <div class="ad-card ad-sec ad-sec--genel ad-sec--durum">
        <div class="ad-card-h"><h4><span class="ad-ico kpi-ico--green"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>Durum Bilgileri</h4>${statusBadge(a.status)}<svg class="ad-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
        ${satir('Lokasyon', escapeHtml((a.location || '').trim() || '—'))}
        ${satir('Sorumlu Kişi', escapeHtml(d.assignment?.assigned_to || '—'))}
        ${satir('Son Giriş Yapan Kullanıcı', fmt(a.username))}
        ${satir('Kullanım Süresi', d.usage || '—')}
        ${satir('Son Bakım Tarihi', trTarih(det.last_maintenance))}
        ${satir('Sonraki Bakım', trTarih(det.next_maintenance), bakimGecti(det.next_maintenance) ? 'ad-warn' : '')}
        ${satir('Son Görülme', fmtDate(a.last_seen))}
        ${satir('Son IP', a.ip_address ? `<span class="serial-cell">${escapeHtml(a.ip_address)}</span>` : '—')}
        ${satir('Agent Versiyonu', a.collector_ver
          ? escapeHtml(a.collector_ver)
          : '<span class="ad-bos">agent kurulu değil</span>')}
        ${satir('Son Envanter Taraması', tel.latest ? fmtDate(tel.latest.measured_at) : '<span class="ad-bos">ölçüm yok</span>')}
        ${satir('Durum', statusBadge(a.status))}
        ${satir('Not', det.note ? escapeHtml(det.note) : '—')}
      </div>

      <!-- Alt: sekmeler -->
      <div class="ad-tabs-wrap">
        <div class="ad-tabs">
          <button class="ad-tab" data-t="telemetri"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 4-6"/></svg>Telemetri</button>
          <button class="ad-tab active" data-t="lifecycle"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>İşlem Geçmişi</button>
          <button class="ad-tab" data-t="maint"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.7 6.3a4 4 0 0 1 5 5l-9.4 9.4a2 2 0 0 1-2.8-2.8z"/><path d="M9 5 5 9 2 6l3-3z"/></svg>Bakım Geçmişi</button>
          <button class="ad-tab" data-t="docs"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Belgeler</button>
          <button class="ad-tab" data-t="note"><svg class="ad-tico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>Notlar</button>
        </div>
        <div class="ad-pane" id="adPane"></div>
      </div>
    </div>`;

  // QR (yerel üretim, dış servis yok)
  const qr = $(`#adQr`);
  if (qr) qr.src = `/api/qr?data=${encodeURIComponent(a.serial_number || a.hostname || '')}`;
  $(`#adPrintLabel`)?.addEventListener('click', () => printAssetLabel(a));
  $(`#adEditBasic`)?.addEventListener('click', () => editAssetDetail(a, det));

  // Sekmeler
  const paneler = {
    telemetri: () => renderTelemetri(tel, a),
    lifecycle: () => '<div id="deviceHistory" class="ad-hist">Yükleniyor...</div>',
    maint: () => `
      <div class="ad-maint">
        ${satir('Son Bakım', trTarih(det.last_maintenance))}
        ${satir('Sonraki Bakım', trTarih(det.next_maintenance), bakimGecti(det.next_maintenance) ? 'ad-warn' : '')}
        ${satir('Garanti Bitiş', trTarih(a.warranty_expiry))}
        <p class="ad-hint">Bakım kaydı geçmişi ayrı tutulmuyor; tarih alanları güncellenir.
        Kalıcı bakım günlüğü isterseniz yaşam döngüsüne <em>Bakımda</em> olayı kaydedin — imzalı ve denetlenebilir olur.</p>
      </div>`,
    docs: () => `
      <div class="ad-docs">
        <button class="ad-doc" id="adDocHandover">
          <span class="qa-ico kpi-ico--red"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
          <span><strong>Zimmet Teslim Tutanağı</strong><small>PDF olarak üretilir</small></span>
        </button>
        <button class="ad-doc" id="adDocLabel">
          <span class="qa-ico kpi-ico--blue"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
          <span><strong>QR Varlık Etiketi</strong><small>Yazdırılabilir etiket</small></span>
        </button>
        <p class="ad-hint">Belge yükleme/saklama henüz yok — buradaki belgeler talep anında üretilir.</p>
      </div>`,
    note: () => `
      <div class="ad-note">
        <p>${det.note ? escapeHtml(det.note) : '<span style="color:var(--text-muted)">Not girilmemiş.</span>'}</p>
        ${(state.role === 'admin' || state.role === 'it') ? '<button class="btn-pdf" id="adEditNote">Notu düzenle</button>' : ''}
      </div>`,
  };
  /* Telefonda 'genel'/'zimmet' sekmeleri #adPane'i DOLDURMAZ; grid'deki
     bölümleri gösterir/gizler (data-mtab + CSS). Böylece aynı DOM masaüstünde
     kolon, telefonda sekme olarak çalışır — içerik kopyalanmıyor. */
  const grid = body.querySelector('.ad-grid');
  const paneCiz = (t) => {
    if (grid) grid.dataset.mtab = t;
    const pane = $(`#adPane`);
    if (!pane) return;
      if (t === 'genel' || t === 'zimmet') return;   // geriye dönük: artık kullanılmıyor
    pane.innerHTML = paneler[t]();
    if (t === 'lifecycle') loadDeviceHistory(a);
    $(`#adDocHandover`)?.addEventListener('click', () => printHandoverReceipt(a));
    $(`#adDocLabel`)?.addEventListener('click', () => printAssetLabel(a));
    $(`#adEditNote`)?.addEventListener('click', () => editAssetDetail(a, det, 'note'));
  };
  $$('.ad-tab').forEach(b => b.addEventListener('click', () => {
    $$('.ad-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    paneCiz(b.dataset.t);
  }));

  /* Telefonda ilk sekme Telemetri (tasarım böyle: cihazın anlık durumu önce
     görünsün). Geniş ekranda da Telemetri ilk sekme. */
  const ilkSekme = $(`.ad-tab[data-t="telemetri"]`) ? 'telemetri' : 'lifecycle';
  $$('.ad-tab').forEach(x => x.classList.toggle('active', x.dataset.t === ilkSekme));
  paneCiz(ilkSekme);

  /* ── Telefon: bilgi kartları AKORDEON ──────────────────────────────────────
     Telefonda Temel + Durum Bilgileri 19 satır tutuyor; hepsini açık bırakmak
     asıl içeriği (telemetri) ekranın çok altına itiyordu. Tasarımda ikisi de
     kapalı, Resmi Zimmet açık geliyor. Masaüstünde akordeon YOK — kartlar
     kolonlarda zaten yan yana duruyor, gizlemenin anlamı olmaz. */
  const telefon = window.matchMedia('(max-width: 760px)').matches;
  body.querySelectorAll('.ad-sec--temel, .ad-sec--durum').forEach((kart) => {
    if (telefon) kart.classList.add('ad-kapali');
    const bas = kart.querySelector('.ad-card-h');
    if (!bas) return;
    bas.addEventListener('click', (e) => {
      // Başlıktaki "Düzenle" düğmesi akordeonu tetiklemesin
      if (e.target.closest('button.btn-pdf')) return;
      if (!window.matchMedia('(max-width: 760px)').matches) return;
      kart.classList.toggle('ad-kapali');
    });
  });

  // Telefonda QR bloğu düğmeyle açılır (sürekli görünmesi yer harcıyordu)
  $(`#adActLabel`)?.addEventListener('click', () => printAssetLabel(a));
  $(`#adActQr`)?.addEventListener('click', () => {
    const kutu = body.querySelector('.ad-qr');
    if (kutu) {
      kutu.classList.toggle('ad-qr--acik');
      if (kutu.classList.contains('ad-qr--acik')) kutu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  loadDeviceAssignment(a);
  loadDeviceLocation(a);
  if (a.category === 'Telefon' && a.id != null) loadDeviceLine(a.id);
}

function bakimGecti(tarih) {
  if (!tarih) return false;
  const t = Date.parse(tarih);
  return !Number.isNaN(t) && t < Date.now();
}

/* Ek alanları düzenle — tek diyalogda, sunucu doğrular */
async function editAssetDetail(asset, mevcut, odak) {
  const sor = (etiket, varsayilan) => prompt(etiket, varsayilan ?? '') ;
  let patch = {};
  if (odak === 'note') {
    const n = sor('Not:', mevcut.note || '');
    if (n === null) return;
    patch = { note: n };
  } else {
    const pd = sor('Satın alma tarihi (YYYY-AA-GG, boş bırakılabilir):', mevcut.purchase_date || '');
    if (pd === null) return;
    const pp = sor('Satın alma bedeli (yalnız sayı):', mevcut.purchase_price ?? '');
    if (pp === null) return;
    const cur = sor('Para birimi (TRY/USD/EUR):', mevcut.currency || 'TRY');
    if (cur === null) return;
    const sup = sor('Tedarikçi:', mevcut.supplier || '');
    if (sup === null) return;
    const lm = sor('Son bakım tarihi (YYYY-AA-GG):', mevcut.last_maintenance || '');
    if (lm === null) return;
    const nm = sor('Sonraki bakım tarihi (YYYY-AA-GG):', mevcut.next_maintenance || '');
    if (nm === null) return;
    patch = { purchase_date: pd, purchase_price: pp, currency: cur, supplier: sup,
      last_maintenance: lm, next_maintenance: nm };
  }
  try {
    const r = await fetch(`/api/assets/${asset.id}/detail`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error);
    openDeviceModal(asset);      // tazele
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
}

/* QR etiketi yazdır — yerel üretim */
function printAssetLabel(a) {
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) { alert('Açılır pencere engellendi.'); return; }
  const kod = a.serial_number || a.hostname || '';
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Etiket — ${escapeHtml(kod)}</title>
  <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px}
  img{width:190px;height:190px}h2{font-size:16px;margin:12px 0 2px}p{font-size:12px;color:#555;margin:0}
  @media print{@page{margin:8mm}}</style>
  <img src="/api/qr?data=${encodeURIComponent(kod)}">
  <h2>${escapeHtml(a.hostname || '')}</h2>
  <p>${escapeHtml(kod)}</p><p>${escapeHtml(a.category || '')} · ${escapeHtml((a.location || '').trim())}</p>
  <script>window.onload=()=>{window.print();}<\/script>`);
  w.document.close();
}


/* Cihaz modalı — lokasyon kutusu.
   BEKLENEN (resmi, kilitli) vs GÖRÜLEN (telemetri) ayrımı ekranda da korunur. */
async function loadDeviceLocation(asset) {
  const box = $(`#deviceLocationBox`);
  if (!box || asset.id == null) { if (box) box.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/assets/${asset.id}/location`);
    const j = await res.json();
    const exp = j.expected?.location || null;
    const seen = j.current?.to_location || (asset.location || '').trim() || null;
    const drift = exp && seen && exp.toLowerCase() !== seen.toLowerCase();
    const since = j.current?.first_seen_at;
    const days = since ? Math.floor((Date.now() - new Date(since).getTime()) / 86400000) : null;

    const hist = (j.history || []).slice(0, 5).map(h => `
      <div style="display:flex;gap:9px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="color:var(--text);font-weight:500;font-size:12px">
            ${h.from_location ? `${escapeHtml(h.from_location)} → ` : ''}${escapeHtml(h.to_location)}
          </div>
          <div style="color:var(--text-muted);font-size:11px">${fmtDate(h.first_seen_at)} · ${escapeHtml(h.source)}</div>
        </div>
      </div>`).join('') || '<p style="padding:4px 0;color:var(--text-muted);font-size:12px">Konum geçmişi yok.</p>';

    box.innerHTML = `
      <div class="ad-card" style="border-color:${drift ? 'var(--red)' : 'var(--border)'}">
        <div class="ad-card-h"><h4>Lokasyon</h4></div>
        <div class="ad-row"><span>Beklenen (resmi)</span><b>${exp ? escapeHtml(exp) : '—'}</b></div>
        <div class="ad-row"><span>Görülen (telemetri)</span>
          <b style="color:${drift ? 'var(--red)' : 'var(--text)'}">${seen ? escapeHtml(seen) : '—'}${days !== null ? ` (${days} gün)` : ''}</b></div>
        ${drift ? `<p style="color:var(--red);font-size:11.5px;margin:8px 0 0">⚠ Cihaz ait olduğu lokasyonun dışında.</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn-pdf" id="locSetExpected">${exp ? 'Beklenen lokasyonu değiştir' : 'Beklenen lokasyonu belirle'}</button>
          ${drift ? `<button class="btn-pdf" id="locAcceptMove">Transferi resmileştir</button>` : ''}
        </div>
        <div style="margin-top:10px">${hist}</div>
      </div>`;

    $(`#locSetExpected`)?.addEventListener('click', () => setExpectedLocationPrompt(asset, exp));
    $(`#locAcceptMove`)?.addEventListener('click', () => saveExpectedLocation(asset, seen));
  } catch (err) {
    box.innerHTML = `<p style="color:var(--red);font-size:12px">Lokasyon bilgisi alınamadı: ${escapeHtml(err.message)}</p>`;
  }
}

function setExpectedLocationPrompt(asset, current) {
  const v = prompt('Cihazın ait olduğu (resmi) lokasyon:', current || asset.location || '');
  if (v === null) return;
  if (!v.trim()) { alert('Lokasyon boş olamaz.'); return; }
  saveExpectedLocation(asset, v.trim());
}

async function saveExpectedLocation(asset, location) {
  try {
    const res = await fetch(`/api/assets/${asset.id}/expected-location`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, hostname: asset.hostname || null }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.detail || j.error);
    state.locGeo = null;
    loadDeviceLocation(asset);
  } catch (err) { alert('Kaydedilemedi: ' + err.message); }
}

async function loadDeviceAssignment(asset) {
  const box = $(`#deviceAssignBox`);
  if (!box || asset.id == null) { if (box) box.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/assets/${asset.id}/assignment`);
    const a = (await res.json()).assignment;
    const owner = a && a.assigned_to;
    const seen = (asset.username || '').trim();
    const mismatch = owner && seen && seen.toLowerCase() !== owner.toLowerCase();
    box.innerHTML = `
      <div style="padding:12px 14px;background:${mismatch ? 'var(--red-bg)' : 'var(--bg-card2)'};border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;font-weight:600;color:${mismatch ? 'var(--red)' : 'var(--text-muted)'};text-transform:uppercase;letter-spacing:.05em">🔒 Resmi Zimmet</span>
          <span>${owner ? `<button class="btn-icon" id="devReleaseBtn" title="İade al" style="display:inline-flex;width:26px;height:26px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}
          <button class="btn-icon" id="devAssignBtn" title="${owner ? 'Devret' : 'Zimmetle'}" style="display:inline-flex;width:26px;height:26px;margin-left:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></button></span>
        </div>
        <div style="font-size:14px;font-weight:600;color:var(--text)">${owner ? escapeHtml(owner) : '<span style="color:var(--text-muted);font-weight:400">Zimmetsiz</span>'}</div>
        ${mismatch ? `<div style="font-size:11.5px;color:var(--red);margin-top:5px">⚠ Telemetri farklı kullanıcı gördü: <b>${escapeHtml(seen)}</b> — izinsiz kullanım şüphesi</div>` : ''}
        ${a && a.assigned_at ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${fmtDate(a.assigned_at)}${a.assigned_by ? ` · ${escapeHtml(a.assigned_by)}` : ''}</div>` : ''}
      </div>`;
    $(`#devAssignBtn`)?.addEventListener('click', () => assignDevicePrompt(asset, owner));
    $(`#devReleaseBtn`)?.addEventListener('click', () => releaseDevice(asset));
  } catch { box.innerHTML = ''; }
}

async function assignDevicePrompt(asset, currentOwner) {
  const to = prompt(`"${asset.hostname}" cihazını kime zimmetleyelim?${currentOwner ? `\n\n(Şu an "${currentOwner}" kullanıcısına zimmetli — devir onayı istenecek)` : ''}`, currentOwner || (asset.username || ''));
  if (!to || !to.trim()) return;
  try {
    let res = await fetch(`/api/assets/${asset.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to.trim(), hostname: asset.hostname }) });
    if (res.status === 409) {
      const j = await res.json();
      if (!confirm(`${j.error}\n\nYine de devretmek istiyor musunuz? (yetkili onaylı devir)`)) return;
      res = await fetch(`/api/assets/${asset.id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), hostname: asset.hostname, force: true }) });
    }
    if (!res.ok) throw new Error((await res.json()).detail || 'Hata');
    loadDeviceAssignment(asset);
  } catch (err) { alert('Zimmet hatası: ' + err.message); }
}

async function releaseDevice(asset) {
  if (!confirm(`"${asset.hostname}" cihazının resmi zimmeti kaldırılsın (iade) mı?`)) return;
  try {
    const res = await fetch(`/api/assets/${asset.id}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('Hata');
    loadDeviceAssignment(asset);
  } catch (err) { alert('İade hatası: ' + err.message); }
}

async function loadDeviceLine(assetId) {
  const box = $(`#deviceLineBox`);
  if (!box) return;
  try {
    const res = await fetch(`/api/lines/for-asset/${assetId}`);
    const j = await res.json();
    const l = j.line;
    if (!l) {
      box.innerHTML = `<div style="padding:12px 14px;background:var(--bg-card2);border-radius:10px;font-size:12.5px;color:var(--text-muted)">
        📱 Bu telefona bağlı hat yok. <a href="#" id="goLinesLink" style="color:var(--accent)">Hatlar</a> sayfasından atayabilirsiniz.</div>`;
      $(`#goLinesLink`)?.addEventListener('click', (e) => { e.preventDefault(); $(`#deviceModalOverlay`)?.classList.remove('open'); showView('lines'); });
      return;
    }
    box.innerHTML = `<div style="padding:12px 14px;background:var(--accent-glow);border-radius:10px">
      <div style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">📱 Bağlı Hat</div>
      <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--text);font-weight:600">${escapeHtml(l.msisdn)}</span><span style="color:var(--text-muted)">${escapeHtml(l.operator)}</span></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">SIM: ${escapeHtml(l.iccid)}${l.tariff ? ` · ${escapeHtml(l.tariff)}` : ''}</div>
    </div>`;
  } catch { box.innerHTML = ''; }
}

async function loadDeviceHistory(asset) {
  const el = $(`#deviceHistory`);
  if (!el) return;
  try {
    const q = asset.serial_number ? `serial=${encodeURIComponent(asset.serial_number)}`
      : `hostname=${encodeURIComponent(asset.hostname || '')}`;
    const res = await fetch(`/api/lifecycle/log?${q}`);
    const data = await res.json();
    const events = data.events || data || [];
    if (!Array.isArray(events) || !events.length) {
      el.innerHTML = '<p style="padding:4px 0">Bu cihaz için kayıtlı yaşam döngüsü olayı yok.</p>';
      return;
    }
    el.innerHTML = events.slice().reverse().map((e) => `
      <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1">
          <div style="color:var(--text);font-weight:500">${escapeHtml(e.to_status || '—')}${e.from_status ? ` <span style="color:var(--text-muted);font-weight:400">← ${escapeHtml(e.from_status)}</span>` : ''}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:1px">${fmtDate(e.timestamp)} · ${escapeHtml(e.actor_upn || e.actor || '—')}${e.note ? ` · ${escapeHtml(e.note)}` : ''}</div>
        </div>
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<p style="color:var(--red)">Geçmiş yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

/* ─── Zimmet Teslim Tutanağı (PDF) ──────────────────────────────────────────── */
function printHandoverReceipt(asset) {
  if (!asset) return;
  const now = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const g = (v) => (v === null || v === undefined || v === '') ? '—' : String(v);
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"/>
  <title>Zimmet Tutanağı — ${g(asset.hostname)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1a1815; font-size:13px; line-height:1.7; padding:0; }
    .hdr { padding:44px 48px 0; }
    .hdr-top { display:flex; justify-content:space-between; align-items:center; padding-bottom:22px; border-bottom:1px solid #ece5da; }
    .brand { display:flex; align-items:center; gap:11px; }
    .brand-icon { width:34px; height:34px; background:linear-gradient(135deg,#6b5cff,#8a7dff); border-radius:9px; display:flex; align-items:center; justify-content:center; }
    .brand-icon svg { width:19px; height:19px; stroke:#fff; fill:none; stroke-width:1.8; }
    .brand-name { font-family:"Fraunces",Georgia,serif; font-size:17px; font-weight:600; color:#1a1815; letter-spacing:-.01em; }
    .brand-sub { font-size:11px; color:#8a8378; }
    .meta { text-align:right; font-size:11px; color:#8a8378; }
    .meta strong { color:#1a1815; }
    .title-block { padding:30px 0 4px; }
    .chip { display:inline-flex; align-items:center; gap:6px; background:#eeecff; color:#6b5cff; font-size:10.5px; font-weight:600; padding:4px 11px; border-radius:999px; margin-bottom:14px; }
    .chip::before { content:''; width:5px; height:5px; border-radius:50%; background:#6b5cff; }
    .title { font-family:"Fraunces",Georgia,serif; font-size:30px; font-weight:600; letter-spacing:-.01em; color:#1a1815; }
    .subtitle { font-size:12.5px; color:#8a8378; margin-top:6px; }
    .body { padding:26px 48px 44px; }
    .sec { font-size:11px; font-weight:600; color:#8a8378; text-transform:uppercase; letter-spacing:.06em; margin:22px 0 8px; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    td { padding:9px 0; border-bottom:1px solid #f0e9de; color:#5a544c; vertical-align:top; }
    td.k { color:#8a8378; width:38%; }
    td.v { color:#1a1815; font-weight:500; }
    .statement { margin:24px 0; padding:16px 18px; background:#f7f2ea; border-radius:12px; font-size:12.5px; color:#5a544c; line-height:1.75; }
    .sign-row { display:flex; gap:40px; margin-top:52px; }
    .sign { flex:1; }
    .sign-line { border-top:1px solid #1a1815; padding-top:8px; font-size:12px; color:#5a544c; }
    .sign-line strong { display:block; color:#1a1815; font-size:13px; margin-bottom:2px; }
    .footer { margin:0 48px; padding:16px 0; border-top:1px solid #ece5da; font-size:10.5px; color:#b3a89a; text-align:center; }
    @media print { @page { margin:0; size:A4; } body { -webkit-print-color-adjust:exact; print-color-adjust:exact; } .brand-icon,.chip,.statement{ -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  </style></head><body>
  <div class="hdr">
    <div class="hdr-top">
      <div class="brand">
        <div class="brand-icon"><svg viewBox="0 0 24 24" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg></div>
        <div><div class="brand-name">AssetMan</div><div class="brand-sub">IT Varlık Yönetimi</div></div>
      </div>
      <div class="meta"><div>Düzenlenme Tarihi</div><div><strong>${now}</strong></div></div>
    </div>
    <div class="title-block">
      <div class="chip">Resmi Belge</div>
      <div class="title">Zimmet Teslim Tutanağı</div>
      <div class="subtitle">Cihaz teslim / iade kaydı</div>
    </div>
  </div>
  <div class="body">
    <div class="sec">Cihaz Bilgileri</div>
    <table>
      <tr><td class="k">Cihaz Adı (Hostname)</td><td class="v">${g(asset.hostname)}</td></tr>
      <tr><td class="k">Kategori</td><td class="v">${g(asset.category)}</td></tr>
      <tr><td class="k">Marka / Model</td><td class="v">${g(asset.brand)} ${g(asset.model)}</td></tr>
      <tr><td class="k">Seri Numarası</td><td class="v">${g(asset.serial_number)}</td></tr>
      <tr><td class="k">Teknik Özellik</td><td class="v">${g(asset.cpu)}${asset.ram_gb ? ' · ' + asset.ram_gb + ' GB RAM' : ''}${asset.storage_gb ? ' · ' + asset.storage_gb + ' GB Disk' : ''}</td></tr>
      <tr><td class="k">İşletim Sistemi</td><td class="v">${g(asset.os)}</td></tr>
    </table>
    <div class="sec">Zimmet Bilgileri</div>
    <table>
      <tr><td class="k">Teslim Alan Personel</td><td class="v">${g(asset.username)}</td></tr>
      <tr><td class="k">Lokasyon / Departman</td><td class="v">${g(asset.location)}</td></tr>
      <tr><td class="k">Teslim Tarihi</td><td class="v">${now}</td></tr>
    </table>
    <div class="statement">Yukarıda özellikleri belirtilen cihaz, çalışır ve eksiksiz durumda tarafıma teslim edilmiştir. Cihazı kurumsal kullanım politikalarına uygun kullanacağımı, hasar/kayıp durumunda bilgi vereceğimi ve görevimden ayrılmam halinde eksiksiz iade edeceğimi kabul ederim.</div>
    <div class="sign-row">
      <div class="sign"><div class="sign-line"><strong>Teslim Eden (IT)</strong>Ad Soyad · İmza · Tarih</div></div>
      <div class="sign"><div class="sign-line"><strong>Teslim Alan (Personel)</strong>${g(asset.username)} · İmza · Tarih</div></div>
    </div>
  </div>
  <div class="footer">AssetMan — Bu belge sistem tarafından otomatik oluşturulmuştur.</div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  win.document.close();
}

function renderRecentTable(assets) {
  const tbody = $(`#recentBody`);
  if (!tbody) return;
  if (!assets.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">Henüz kayıt yok</td></tr>`;
    return;
  }
  tbody.innerHTML = assets.map((a) => `
    <tr data-asset-id="${a.id}" style="cursor:pointer">
      <td class="hostname-cell">${fmt(a.hostname)}</td>
      <td>${categoryBadge(a.category)}</td>
      <td>${a.location ? `<span class="location-tag">${escapeHtml(a.location)}</span>` : '—'}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${fmtDay(a.last_seen)}</td>
    </tr>`).join('');
  tbody.querySelectorAll('tr[data-asset-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const asset = state.assets.find(x => String(x.id) === tr.dataset.assetId);
      if (asset) openDeviceModal(asset);
    });
  });
}

/* ─── Assets View ───────────────────────────────────────────────────────── */
function populateLocationFilter(assets) {
  const sel = $(`#filterLocation`);
  if (!sel) return;
  const locations = [...new Set(assets.map(a => a.location).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Tüm Lokasyonlar</option>' +
    locations.map(l => `<option value="${l}" ${l === current ? 'selected' : ''}>${l}</option>`).join('');
}

/* ═══ VARLIKLAR v2 ════════════════════════════════════════════════════════
   Önceki tablo 13 sütundu (dar ekranda kesiliyordu), sayfalama ve satır
   aksiyonu yoktu. Tasarım referansına göre 7 sütun + seçim + sayfalama.
   Filtre/sıralama/sayfalama İSTEMCİDE — envanter zaten tek istekte geliyor. */
const ASSET_SORT_LABEL = { serial_number: 'Varlık Kodu', hostname: 'Varlık Adı',
  category: 'Kategori', location: 'Lokasyon', status: 'Durum' };

function assetSearchBlob(a) {
  return [a.hostname, a.serial_number, a.brand, a.model, a.location, a.category,
    a.ip_address, a.mac_address, a.username, a.os].filter(Boolean).join(' ');
}

function filteredAssets() {
  const q = trSlug($(`#assetSearch`)?.value || '').trim();
  const cat = $(`#filterCategory`)?.value || '';
  const loc = $(`#filterLocation`)?.value || '';
  const st  = $(`#filterStatus`)?.value || '';
  let list = (state.allAssets || []).slice();
  if (cat) list = list.filter(a => (a.category || 'Diğer') === cat);
  if (loc) list = list.filter(a => (a.location || '') === loc);
  if (st)  list = list.filter(a => (a.status || '') === st);
  // trSlug: Türkçe 'İ' toLowerCase'te birleşik nokta üretir → arama tutmazdı
  if (q)   list = list.filter(a => trSlug(assetSearchBlob(a)).includes(q));

  const key = state.assetSort?.key;
  if (key) {
    const dir = state.assetSort.dir === 'desc' ? -1 : 1;
    list.sort((x, y) => String(x[key] || '').localeCompare(String(y[key] || ''), 'tr') * dir);
  }
  return list;
}

async function renderAssetsTable() {
  const tbody = $(`#assetsBody`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Yükleniyor...</td></tr>`;
  try {
    // Envanter + resmi zimmetler TEK seferde (cihaz başına istek N+1 olurdu)
    const [data, asg, trendData, lcLog, locSum, anom, warr] = await Promise.all([
      fetchAssets({ size: 200 }),
      fetch('/api/assignments').then(r => r.ok ? r.json() : { assignments: {} }).catch(() => ({ assignments: {} })),
      // Dashboard'a hiç uğranmadan gelinirse trendler boş kalmasın
      state.trendSeries?.length ? Promise.resolve(null) : fetchTrends(state.rangeDays).catch(() => null),
      // Sağ ray verisi (yalnız bir kez)
      state.railEvents ? Promise.resolve(null) : fetchLifecycleLog(30).catch(() => ({ events: [] })),
      state.locSummary ? Promise.resolve(null) : fetchLocationSummary().catch(() => ({ ...EMPTY_SUMMARY })),
      state.critParts?.warranty !== undefined ? Promise.resolve(null) : fetchAnomalies().catch(() => ({})),
      state.critParts?.warranty !== undefined ? Promise.resolve(null) : fetchWarranty().catch(() => ({})),
    ]);
    if (trendData) {
      state.trends = trendData.trends || {};
      state.trendSeries = trendData.series || [];
      state.seriesOnline = trendData.series_online || [];
      state.seriesOffline = trendData.series_offline || [];
      state.seriesDepoda = trendData.series_depoda || [];
    }
    if (lcLog) state.railEvents = lcLog.events || lcLog.log || [];
    if (locSum) state.locSummary = locSum;
    if (anom || warr) {
      state.critParts = {
        drift:    state.locSummary?.tasinmis || 0,
        warranty: warr?.expired?.items?.length || 0,
        uptime:   anom?.long_uptime?.items?.length || 0,
        disk:     anom?.low_disk?.items?.length || 0,
        offline:  0,
      };
    }
    state.allAssets = data.results || [];
    state.assets = state.allAssets;
    state.assignments = asg.assignments || {};
    populateAssetFilters(state.allAssets);
    paintAssetsTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color:var(--red)">${escapeHtml(err.message)}</td></tr>`;
  }
}

function populateAssetFilters(assets) {
  const cats = [...new Set(assets.map(a => a.category || 'Diğer'))].sort((a, b) => a.localeCompare(b, 'tr'));
  const locs = [...new Set(assets.map(a => (a.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const fill = (id, items, hepsi) => {
    const el = $('#' + id); if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${hepsi}</option>` +
      items.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (items.includes(cur)) el.value = cur;
  };
  fill('filterCategory', cats, 'Tüm Kategoriler');
  fill('filterLocation', locs, 'Tüm Lokasyonlar');
}

/* Kategori ikonu — mobil kart listesindeki renkli kutu (tasarım referansı) */
const CAT_ICON = {
  'Bilgisayar': ['blue', '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'],
  'Sunucu': ['blue', '<rect x="2" y="3" width="20" height="7" rx="1"/><rect x="2" y="14" width="20" height="7" rx="1"/><path d="M6 6.5h.01M6 17.5h.01"/>'],
  'Telefon': ['green', '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>'],
  'Tablet': ['orange', '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>'],
  'El Terminali': ['orange', '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6"/>'],
  'Yazıcı': ['red', '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 17h12v5H6z"/>'],
  'Ağ Aygıtı': ['blue', '<rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 17.5h.01M10 17.5h.01"/><path d="M12 14V9M8 6l4-3 4 3"/>'],
  'Çevre Aygıtı': ['green', '<path d="M3 12a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-2v-7h4"/><path d="M3 17v-5h4v7H5a2 2 0 0 1-2-2z"/>'],
};
const CAT_ICON_DEFAULT = ['blue', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>'];

function catIcon(cat) {
  const [tone, path] = CAT_ICON[cat] || CAT_ICON_DEFAULT;
  return `<span class="ac-ico kpi-ico--${tone}">
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
}

/* Geniş ekran bağlam rayı — dashboard ile AYNI veriden, dikey liste sunumu.
   Veri yoksa (Varlıklar'a doğrudan gelinmişse) sessizce boş kalır, hata vermez. */
function renderAssetsRail() {
  const parts = state.critParts || {};
  const chips = [
    { n: parts.drift || 0,    t: 'Lokasyon Dışı Cihazlar', tone: 'red' },
    { n: parts.warranty || 0, t: 'Garanti Süresi Dolan',   tone: 'orange' },
    { n: parts.uptime || 0,   t: 'Bakım Süresi Geçen',     tone: 'orange' },
    { n: parts.disk || 0,     t: 'Disk Alanı Düşük',       tone: 'red' },
  ];
  setPill('railCritPill', chips.reduce((a, c) => a + c.n, 0));
  const crit = $(`#railCrit`);
  if (crit) {
    crit.innerHTML = chips.map(c => `
      <button class="sev-row" data-view="alerts">
        <span class="sev-ico sev-ico--${c.tone}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </span>
        <span class="sev-name">${c.t}<small>${c.n} cihaz</small></span>
        <span class="sev-count" style="color:var(--${c.tone})">${c.n}</span>
      </button>`).join('');
    crit.querySelectorAll('.sev-row').forEach(r => r.addEventListener('click', () => showView('alerts')));
  }

  renderActivities(state.railEvents || [], 'railActivity');

  // Öneri metni dashboard ile aynı kuraldan
  const el = $(`#railInsightText`), btn = $(`#railInsightBtn`);
  if (el && state.locSummary) {
    const tmpText = $(`#insightText`), tmpBtn = $(`#insightBtn`);
    const yedek = tmpText ? tmpText.textContent : null;
    renderInsight(state.locSummary, parts);
    if (tmpText) {
      el.textContent = tmpText.textContent;
      if (btn && tmpBtn) {
        btn.style.display = tmpBtn.style.display;
        btn.onclick = tmpBtn.onclick;
      }
      if (yedek !== null && state.currentView !== 'dashboard') tmpText.textContent = yedek;
    }
  }
}

/* Varlık durum kartları — tablet/masaüstünde tam KPI kartı, mobilde mini şerit.
   Tek fonksiyon, tek veri; sunumu CSS ayırır. Trend GERÇEK anlık görüntülerden
   (yoksa 'veri birikiyor' der — sıfır uydurmaz, dashboard ile aynı kural). */
function renderMiniStats() {
  const box = $(`#miniStats`);
  if (!box) return;
  const all = state.allAssets || [];
  const say = (st) => all.filter(a => (a.status || '') === st).length;
  const tr = state.trends || {};
  const win = tr.window_days || 30;
  const kartlar = [
    { k: '', ad: 'Toplam Varlık', n: all.length, tone: 'blue', renk: 'var(--accent)',
      t: tr.total, seri: state.trendSeries, sc: '#4f46e5',
      ico: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/>' },
    { k: 'online', ad: 'Aktif', n: say('online'), tone: 'green', renk: 'var(--green)',
      t: tr.online, seri: state.seriesOnline, sc: '#10b981',
      ico: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/>' },
    { k: 'depoda', ad: 'Depoda', n: say('depoda'), tone: 'orange', renk: 'var(--orange)',
      t: tr.depoda, seri: state.seriesDepoda, sc: '#f59e0b',
      ico: '<path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21V12h6v9"/>' },
    { k: 'offline', ad: 'Kullanım Dışı', n: say('offline'), tone: 'red', renk: 'var(--red)',
      t: tr.offline, seri: state.seriesOffline, sc: '#ef4444',
      ico: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' },
    // 5. kart yalnız geniş ekranda görünür (CSS); dashboard'la AYNI veri
    { k: null, ad: 'Lokasyon', n: state.locSummary?.location_count ?? 0, tone: 'blue',
      renk: 'var(--accent)', alt: 'Aktif lokasyon', git: 'locations',
      ico: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  ];
  box.innerHTML = kartlar.map((c, i) => `
    <button class="ms-card kpi" data-st="${c.k}" data-i="${i}">
      <span class="kpi-top">
        <span class="ms-ico kpi-ico kpi-ico--${c.tone}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.ico}</svg>
        </span>
        <span class="ms-label kpi-label" style="color:${c.renk}">${c.ad}</span>
      </span>
      <span class="ms-value kpi-value" style="color:${c.renk}">${c.n}</span>
      <span class="kpi-foot">
        ${c.alt ? `<span class="kpi-sub">${c.alt}</span>`
                : `<span class="kpi-trend" id="msTrend${i}"></span>
                   <span class="kpi-spark" id="msSpark${i}"></span>`}
      </span>
    </button>`).join('');

  kartlar.forEach((c, i) => {
    if (c.alt) return;                       // Lokasyon kartında trend yok
    renderTrend(`msTrend${i}`, c.t, win);
    sparkFromSeries(`msSpark${i}`, c.seri || [], c.sc);
  });

  box.querySelectorAll('.ms-card').forEach((b, i) => b.addEventListener('click', () => {
    if (kartlar[i].git) { showView(kartlar[i].git); return; }
    const sel = $(`#filterStatus`); if (sel) sel.value = b.dataset.st;
    state.assetPage = 1; state.mobileShown = 0; paintAssetsTable();
  }));
}

/* Mobil kart listesi — tablo ile AYNI filtrelenmiş listeden çizilir.
   Sayfalama yerine kümülatif "Daha Fazla Yükle" (tasarım referansı). */
function paintAssetCards(list, per) {
  const box = $(`#assetCards`);
  if (!box) return;
  const goster = Math.min(list.length, state.mobileShown || per);
  state.mobileShown = goster;
  const dilim = list.slice(0, goster);

  box.innerHTML = dilim.length ? dilim.map(a => `
    <div class="ac-item" data-id="${a.id}">
      ${catIcon(a.category)}
      <div class="ac-body">
        <div class="ac-top">
          <span class="ac-name">${fmt(a.hostname)}</span>
          ${statusBadge(a.status)}
          <button class="ac-kebab" data-id="${a.id}" aria-label="İşlemler">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>
          </button>
        </div>
        <div class="ac-code">${fmt(a.serial_number)}</div>
        <div class="ac-meta">${escapeHtml(a.category || 'Diğer')}<i>•</i>${escapeHtml((a.location || '').trim() || 'Lokasyon yok')}</div>
      </div>
    </div>`).join('')
    : `<p class="loading-cell">Filtreye uyan kayıt yok</p>`;

  const byId = (id) => (state.allAssets || []).find(x => String(x.id) === String(id));
  box.querySelectorAll('.ac-item').forEach(el => el.addEventListener('click', () => {
    const a = byId(el.dataset.id); if (a) openDeviceModal(a);
  }));
  box.querySelectorAll('.ac-kebab').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = byId(b.dataset.id); if (a) openDeviceModal(a);
  }));

  const more = $(`#loadMoreBtn`);
  if (more) more.hidden = goster >= list.length;
  const info = $(`#cardsInfo`);
  if (info) {
    const sayfa = Math.ceil(goster / per) || 1;
    const toplamSayfa = Math.max(1, Math.ceil(list.length / per));
    info.textContent = `Toplam ${list.length} varlık · Sayfa ${sayfa} / ${toplamSayfa}`;
  }
}

function paintAssetsTable() {
  const tbody = $(`#assetsBody`);
  if (!tbody) return;
  const list = filteredAssets();
  state.renderedAssets = list;

  const per = Number($(`#rowsPerPage`)?.value) || 25;
  const pages = Math.max(1, Math.ceil(list.length / per));
  if (!state.assetPage || state.assetPage > pages) state.assetPage = 1;
  const page = state.assetPage;
  const slice = list.slice((page - 1) * per, page * per);

  const countEl = $(`#assetCount`);
  if (countEl) {
    const toplam = (state.allAssets || []).length;
    countEl.textContent = list.length === toplam
      ? `${toplam} varlık bulundu`
      : `${list.length} / ${toplam} varlık`;
  }

  // Sıralama başlıkları
  $$('.asset-table--v2 th.sortable').forEach(th => {
    const k = th.dataset.sort;
    const aktif = state.assetSort?.key === k;
    th.className = 'sortable th-sort' + (aktif ? ' active' : '');
    th.innerHTML = `${ASSET_SORT_LABEL[k] || k}${aktif ? `<span class="arr">${state.assetSort.dir === 'desc' ? '▼' : '▲'}</span>` : ''}`;
  });

  const sel = state.selectedAssets || new Set();

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Filtreye uyan kayıt yok</td></tr>`;
    renderPager(0, per);
    updateBulkBar();
    paintAssetCards(list, per);
    renderMiniStats();
    return;
  }

  tbody.innerHTML = slice.map((a) => `
    <tr class="asset-row${sel.has(a.id) ? ' selected' : ''}" data-id="${a.id}">
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${a.id}" ${sel.has(a.id) ? 'checked' : ''} aria-label="Satırı seç"></td>
      <td class="code-cell" title="${escapeHtml(a.serial_number || '')}">${fmt(a.serial_number)}</td>
      <td class="hostname-cell">${fmt(a.hostname)}</td>
      <td>${categoryBadge(a.category)}</td>
      <td>${a.location ? `<span class="location-tag">${escapeHtml(a.location)}</span>` : '—'}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${escapeHtml(state.assignments?.[a.id] || '—')}</td>
      <td class="col-actions">
        <span class="row-actions">
          <button class="ra-btn" data-act="view" data-id="${a.id}" title="Detay">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="ra-btn" data-act="edit" data-id="${a.id}" title="Zimmet / lokasyon düzenle">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="ra-btn" data-act="lifecycle" data-id="${a.id}" title="Yaşam döngüsü kaydı">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9"/><polyline points="3 3 3 8 8 8"/><path d="M12 7v5l3 2"/></svg>
          </button>
        </span>
      </td>
    </tr>`).join('');

  const byId = (id) => (state.allAssets || []).find(x => String(x.id) === String(id));

  tbody.querySelectorAll('.asset-row').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.ra-btn') || e.target.closest('.row-check')) return;
      const a = byId(tr.dataset.id); if (a) openDeviceModal(a);
    });
  });
  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      state.selectedAssets = state.selectedAssets || new Set();
      const id = Number(cb.dataset.id);
      if (cb.checked) state.selectedAssets.add(id); else state.selectedAssets.delete(id);
      cb.closest('tr')?.classList.toggle('selected', cb.checked);
      updateBulkBar();
    });
  });
  tbody.querySelectorAll('.ra-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = byId(b.dataset.id); if (!a) return;
      if (b.dataset.act === 'lifecycle') { showView('lifecycle'); return; }
      openDeviceModal(a);   // detay + zimmet/lokasyon düzenleme aynı modalda
    });
  });

  renderPager(list.length, per);
  updateBulkBar();
  paintAssetCards(list, per);
  renderMiniStats();
  renderAssetsRail();
}

/* Sayfalama — 1 2 … n-1 [n] n+1 … son */
function renderPager(total, per) {
  const nav = $(`#assetsPager`);
  if (!nav) return;
  const pages = Math.max(1, Math.ceil(total / per));
  const cur = state.assetPage || 1;
  if (pages <= 1) { nav.innerHTML = ''; return; }

  const nums = [];
  const push = (n) => { if (!nums.includes(n) && n >= 1 && n <= pages) nums.push(n); };
  push(1); push(2);
  for (let i = cur - 1; i <= cur + 1; i++) push(i);
  push(pages - 1); push(pages);
  nums.sort((a, b) => a - b);

  let html = `<button data-p="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="Önceki">‹</button>`;
  let prev = 0;
  nums.forEach(n => {
    if (prev && n - prev > 1) html += `<span class="gap">…</span>`;
    html += `<button data-p="${n}" class="${n === cur ? 'active' : ''}">${n}</button>`;
    prev = n;
  });
  html += `<button data-p="${cur + 1}" ${cur === pages ? 'disabled' : ''} aria-label="Sonraki">›</button>`;
  nav.innerHTML = html;
  nav.querySelectorAll('button[data-p]').forEach(b => b.addEventListener('click', () => {
    const p = Number(b.dataset.p);
    if (p >= 1 && p <= pages) { state.assetPage = p; paintAssetsTable(); }
  }));
}

function updateBulkBar() {
  const bar = $(`#bulkBar`), cnt = $(`#bulkCount`);
  const n = (state.selectedAssets || new Set()).size;
  if (cnt) cnt.textContent = n;
  if (bar) bar.hidden = n === 0;
  const all = $(`#selectAll`);
  if (all) {
    const gorunen = state.renderedAssets || [];
    all.checked = n > 0 && gorunen.length > 0 && gorunen.every(a => state.selectedAssets?.has(a.id));
    all.indeterminate = n > 0 && !all.checked;
  }
}

/* ─── Licenses View ──────────────────────────────────────────────────────── */
const LIC_TYPE_CLS = {
  'ESD': 'esd', 'Volume': 'volume', 'Subscription': 'subscription', 'OEM': 'oem', 'Free': 'free',
};

function licTypeBadge(type) {
  if (!type || type === 'Unknown') return '<span class="lic-type lic-type--unknown">Unknown</span>';
  const cls = LIC_TYPE_CLS[type] || 'unknown';
  return `<span class="lic-type lic-type--${cls}">${type}</span>`;
}

function licStatusBadge(status) {
  if (!status) return '<span class="lic-status lic-status--unknown">—</span>';
  const s = status.toLowerCase();
  if (s === 'licensed')   return `<span class="lic-status lic-status--licensed">Lisanslı</span>`;
  if (s === 'unlicensed') return `<span class="lic-status lic-status--unlicensed">Lisanssız</span>`;
  if (s.includes('grace') || s.includes('notification')) return `<span class="lic-status lic-status--grace">${status}</span>`;
  return `<span class="lic-status lic-status--unknown">${status}</span>`;
}

async function loadLicenses() {
  const tbody = $(`#licenseBody`);
  const countEl = $(`#licenseCount`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="loading-cell">Yükleniyor...</td></tr>`;

  try {
    const [licData, stats] = await Promise.all([fetchLicenses({ size: 200 }), fetchLicenseStats()]);
    let licenses = licData.results || [];
    state.licenses = licenses;

    // Render stats
    const total = $(`#licTotal`);
    const licensed = $(`#licLicensed`);
    const unlicensed = $(`#licUnlicensed`);
    const expiring = $(`#licExpiring`);
    if (total) animateCount(total, stats.total || 0);
    if (licensed) animateCount(licensed, stats.by_status?.Licensed || 0);
    if (unlicensed) animateCount(unlicensed, stats.unlicensed || 0);
    if (expiring) animateCount(expiring, stats.expiring_soon || 0);

    // Software bar chart
    renderLicSoftwareChart(stats.by_software || {});
    renderLicStatusRings(stats.by_status || {});
    renderLicTypeChart(stats.by_type || {});

    renderLicenseTable(licenses);
    if (countEl) countEl.textContent = `${licenses.length} yazılım kaydı bulundu`;
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

function renderLicSoftwareChart(bySoftware) {
  const entries = Object.entries(bySoftware).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $(`#licSoftwareBars`);
  if (!container) return;
  container.innerHTML = entries.map(([name, count]) => `
    <div class="bar-row">
      <span class="bar-label" title="${name}">${name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:0%" data-pct="${Math.round((count/max)*100)}"></div></div>
      <span class="bar-count">${count}</span>
    </div>`).join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => container.querySelectorAll('.bar-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicStatusRings(byStatus) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  const container = $(`#licStatusRings`);
  if (!container) return;
  const items = [
    { key: 'Licensed',   label: 'Lisanslı',   cls: 'online' },
    { key: 'Unlicensed', label: 'Lisanssız',  cls: 'offline' },
    { key: 'Unknown',    label: 'Bilinmiyor', cls: 'unknown' },
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
  setTimeout(() => container.querySelectorAll('.ring-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicTypeChart(byType) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  const TYPE_COLORS = { ESD: 'var(--blue)', Volume: 'var(--purple)', Subscription: 'var(--teal)', OEM: 'var(--orange)', Unknown: 'var(--text-muted)' };
  const container = $(`#licTypeBars`);
  if (!container) return;
  container.innerHTML = entries.map(([type, count]) => {
    const color = TYPE_COLORS[type] || 'var(--text-muted)';
    return `
      <div class="bar-row">
        <span class="bar-label" title="${type}">${type}</span>
        <div class="bar-track"><div class="bar-fill" style="width:0%;background:${color}" data-pct="${Math.round((count/max)*100)}"></div></div>
        <span class="bar-count">${count}</span>
      </div>`;
  }).join('') || '<p style="color:var(--text-muted);font-size:12px;padding:8px 0">Veri bulunamadı</p>';
  setTimeout(() => container.querySelectorAll('.bar-fill').forEach(el => el.style.width = el.dataset.pct + '%'), 100);
}

function renderLicenseTable(licenses) {
  const tbody = $(`#licenseBody`);
  if (!tbody) return;

  // Apply client-side filters
  const statusF = $(`#licFilterStatus`)?.value || '';
  const typeF   = $(`#licFilterType`)?.value   || '';
  const searchF = ($(`#licSearch`)?.value || '').toLowerCase();

  // Skip empty/null rows (may come from manual Baserow entries)
  let filtered = licenses.filter(l => l.software_name);
  if (statusF) filtered = filtered.filter(l => (l.license_status || '') === statusF);
  if (typeF)   filtered = filtered.filter(l => (l.license_type || '') === typeF);
  if (searchF) filtered = filtered.filter(l =>
    (l.software_name || '').toLowerCase().includes(searchF) ||
    (l.hostname || '').toLowerCase().includes(searchF) ||
    (l.publisher || '').toLowerCase().includes(searchF));

  const countEl = $(`#licenseCount`);
  if (countEl) countEl.textContent = `${filtered.length} yazılım kaydı bulundu`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="loading-cell">Kayıt bulunamadı</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td style="font-weight:500;color:var(--text)">${fmt(l.software_name)}</td>
      <td class="serial-cell">${fmt(l.software_version, '—')}</td>
      <td>${fmt(l.publisher, '—')}</td>
      <td>${licTypeBadge(l.license_type)}</td>
      <td>${licStatusBadge(l.license_status)}</td>
      <td class="serial-cell">${l.key_hint ? `<span style="background:var(--bg-card2);border:1px solid var(--border);padding:2px 8px;border-radius:6px;font-size:12px;letter-spacing:0.08em">${l.key_hint}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="hostname-cell">${fmt(l.hostname)}</td>
      <td>${fmt(l.username, '—')}</td>
      <td>${l.install_date ? l.install_date.substring(0, 10) : '—'}</td>
      <td>${fmtDate(l.last_seen)}</td>
    </tr>`).join('');
}

/* ─── Alerts & Anomalies View ────────────────────────────────────────────── */
function brandModel(item) {
  const b = fmt(item.brand);
  const m = item.model && item.model !== '—' ? `<span style="color:var(--text-muted)">${item.model}</span>` : '';
  return `${b} ${m}`.trim();
}

function setPill(id, count) {
  const el = $(`#${id}`);
  if (!el) return;
  el.textContent = count;
  el.classList.toggle('count-pill--zero', count === 0);
}

function humanDuration(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  return `${days} gün`;
}

async function fetchLocationDrift() {
  const res = await fetch('/api/location-drift');
  if (!res.ok) throw new Error('Lokasyon sapması alınamadı');
  return res.json();
}

function renderLocationDrift(drift) {
  const items = drift.drifted || [];
  setPill('locDriftPill', items.length);
  const hint = $(`#locDriftHint`);
  if (hint) {
    // Kapsam dürüstlüğü: beklenen lokasyonu tanımsız cihazlar taramanın DIŞINDA kalır.
    // Bunu gizlemek "sapma yok ✓" ifadesini yanıltıcı yapardı.
    const scope = drift.unassigned > 0
      ? ` · ${drift.unassigned} cihaz kapsam dışı (beklenen lokasyon tanımsız)` : '';
    hint.textContent = `${drift.threshold_days}+ gündür ait olduğu lokasyonun dışında${scope}`;
  }
  const body = $(`#locDriftBody`);
  if (!body) return;
  body.innerHTML = items.length ? items.map(d => `
    <tr data-asset-id="${d.asset_id}" style="cursor:pointer">
      <td class="hostname-cell">${fmt(d.hostname)}</td>
      <td>${categoryBadge(d.category)}</td>
      <td><span class="location-tag">${escapeHtml(d.expected_location)}</span></td>
      <td><span class="location-tag" style="background:var(--red-bg);color:var(--red)">${escapeHtml(d.seen_location)}</span></td>
      <td>${d.days === null ? '<span style="color:var(--text-muted)">bilinmiyor</span>' : d.days + ' gün'}</td>
      <td style="color:var(--text-muted)">${escapeHtml(d.source)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="loading-cell" style="color:var(--green)">Lokasyon sapması yok ✓</td></tr>`;

  body.querySelectorAll('tr[data-asset-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const asset = state.assets.find(x => String(x.id) === tr.dataset.assetId);
      if (asset) openDeviceModal(asset);
    });
  });
}

async function loadAlerts(showLoading = true) {
  // Reset bodies to loading (arka plan tazelemede atlanır → titreme olmaz)
  if (showLoading) {
    const setLoading = (id, cols) => { const b = $(`#${id}`); if (b) b.innerHTML = `<tr><td colspan="${cols}" class="loading-cell">Yükleniyor...</td></tr>`; };
    setLoading('offlineBody', 6);
    setLoading('lowRamBody', 4);
    setLoading('lowDiskBody', 4);
    setLoading('longUptimeBody', 4);
    setLoading('licComplianceBody', 6);
    setLoading('shadowBody', 4);
    setLoading('eolBody', 5);
    setLoading('warrantyBody', 5);
    setLoading('locDriftBody', 6);
  }

  try {
    const [anomalies, offline, compliance, shadow, eol, warranty, drift] = await Promise.all([
      fetchAnomalies(),
      fetchOfflineAlerts(),
      fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0, items: [] } })),
      fetchEolOs().catch(() => ({ total_issues: 0, eol: { items: [] }, approaching: { items: [] } })),
      fetchWarranty().catch(() => ({ total_issues: 0, expired: { items: [] }, expiring_soon: { items: [] } })),
      fetchLocationDrift().catch(() => ({ count: 0, drifted: [], threshold_days: 7, unassigned: 0 })),
    ]);

    const shadowCount = shadow.shadow?.count || 0;
    const eolCount = eol.total_issues || 0;
    const warrantyCount = warranty.total_issues || 0;
    const driftCount = drift.count || 0;

    // Summary cards — kartlar birbirinden bağımsız ve nav rozetine tam toplanır
    const elA = $(`#alertTotalAnomalies`); if (elA) animateCount(elA, anomalies.total_anomalies || 0);
    const elO = $(`#alertOfflineCount`);   if (elO) animateCount(elO, offline.total_alerts || 0);
    const elL = $(`#alertLicenseIssues`);   if (elL) animateCount(elL, compliance.total_issues || 0);
    const elS = $(`#alertShadowCount`);     if (elS) animateCount(elS, shadowCount);
    const elE = $(`#alertEolCount`);        if (elE) animateCount(elE, eolCount);
    const elW = $(`#alertWarrantyCount`);   if (elW) animateCount(elW, warrantyCount);
    const elD = $(`#alertLocDriftCount`);   if (elD) animateCount(elD, driftCount);

    // Nav badge = total actionable alerts
    const totalAlerts = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + shadowCount + eolCount + warrantyCount + driftCount;
    updateAlertsBadge(totalAlerts);

    // ── Lokasyon sapması ──
    renderLocationDrift(drift);

    // ── Offline table ──
    const offItems = [...(offline.stale?.items || []), ...(offline.offline?.items || [])];
    setPill('offlinePill', offItems.length);
    const offBody = $(`#offlineBody`);
    if (offBody) {
      offBody.innerHTML = offItems.length ? offItems.map(d => {
        const isStale = (d.hours_offline || 0) >= 7 * 24;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td>${statusBadge(d.status)}</td>
          <td>${fmtDate(d.last_seen)}</td>
          <td><span class="badge ${isStale ? 'badge--offline' : 'badge--unknown'}">${humanDuration(d.hours_offline)}</span></td>
        </tr>`;
      }).join('') : `<tr><td colspan="6" class="loading-cell" style="color:var(--green,#22c55e)">Tüm cihazlar çevrimiçi ✓</td></tr>`;
    }

    // ── Low RAM ──
    const ramItems = anomalies.low_ram?.items || [];
    setPill('lowRamPill', ramItems.length);
    const ramBody = $(`#lowRamBody`);
    if (ramBody) {
      ramBody.innerHTML = ramItems.length ? ramItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--offline">${d.ram_gb} GB</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">Düşük RAM'li cihaz yok ✓</td></tr>`;
    }

    // ── Low Disk ──
    const diskItems = anomalies.low_disk?.items || [];
    setPill('lowDiskPill', diskItems.length);
    const diskBody = $(`#lowDiskBody`);
    if (diskBody) {
      diskBody.innerHTML = diskItems.length ? diskItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--offline">${d.storage_gb} GB</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">Düşük diskli cihaz yok ✓</td></tr>`;
    }

    // ── Long uptime (yeniden başlatma) ──
    const uptimeItems = anomalies.long_uptime?.items || [];
    setPill('longUptimePill', uptimeItems.length);
    const uptimeBody = $(`#longUptimeBody`);
    if (uptimeBody) {
      uptimeBody.innerHTML = uptimeItems.length ? uptimeItems.map(d => `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td><span class="badge badge--unknown">${d.uptime_days} gün</span></td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell">30+ gün açık cihaz yok ✓</td></tr>`;
    }

    // ── License compliance ──
    const licItems = [
      ...(compliance.unlicensed?.items   || []),
      ...(compliance.expired?.items      || []),
      ...(compliance.expiring_soon?.items|| []),
    ];
    // De-dup by software+hostname
    const seen = new Set();
    const licUnique = licItems.filter(l => {
      const k = `${l.software_name}|${l.hostname}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    setPill('licIssuePill', licUnique.length);
    const licBody = $(`#licComplianceBody`);
    if (licBody) {
      licBody.innerHTML = licUnique.length ? licUnique.map(l => `
        <tr>
          <td style="font-weight:500;color:var(--text)">${fmt(l.software_name)}</td>
          <td class="serial-cell">${fmt(l.version)}</td>
          <td class="hostname-cell">${fmt(l.hostname)}</td>
          <td>${fmt(l.username)}</td>
          <td>${licStatusBadge(l.license_status)}</td>
          <td>${l.expiry_date ? fmtDate(l.expiry_date) : '—'}</td>
        </tr>`).join('') : `<tr><td colspan="6" class="loading-cell">Lisans sorunu yok ✓</td></tr>`;
    }

    // ── Shadow IT / Kayıt dışı cihazlar ──
    const shadowItems = shadow.shadow?.items || [];
    setPill('shadowPill', shadowItems.length);
    const shadowBody = $(`#shadowBody`);
    if (shadowBody) {
      shadowBody.innerHTML = shadowItems.length ? shadowItems.map(d => `
        <tr>
          <td class="serial-cell">${fmt(d.ip)}</td>
          <td class="serial-cell">${fmt(d.mac)}</td>
          <td class="hostname-cell">${d.hostname ? fmt(d.hostname) : '—'}</td>
          <td>${d.vendor ? fmt(d.vendor) : '—'}</td>
        </tr>`).join('') : `<tr><td colspan="4" class="loading-cell" style="color:var(--green,#22c55e)">Kayıt dışı cihaz yok ✓</td></tr>`;
    }

    // ── EOL / Eski işletim sistemi ──
    const eolItems = [
      ...(eol.eol?.items || []).map(d => ({ ...d, _state: 'eol' })),
      ...(eol.approaching?.items || []).map(d => ({ ...d, _state: 'soon' })),
    ];
    setPill('eolPill', eolItems.length);
    const eolBody = $(`#eolBody`);
    if (eolBody) {
      eolBody.innerHTML = eolItems.length ? eolItems.map(d => {
        const badge = d._state === 'eol'
          ? `<span class="badge badge--offline">${d.days_past} gün önce bitti</span>`
          : `<span class="badge badge--unknown">${d.days_left} gün kaldı</span>`;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.os)}</td>
          <td>${fmt(d.username)}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5" class="loading-cell" style="color:var(--green,#22c55e)">Desteği biten işletim sistemi yok ✓</td></tr>`;
    }

    // ── Garanti takibi ──
    const warrItems = [
      ...(warranty.expired?.items || []).map(d => ({ ...d, _state: 'exp' })),
      ...(warranty.expiring_soon?.items || []).map(d => ({ ...d, _state: 'soon' })),
    ];
    setPill('warrantyPill', warrItems.length);
    const warrBody = $(`#warrantyBody`);
    if (warrBody) {
      warrBody.innerHTML = warrItems.length ? warrItems.map(d => {
        const badge = d._state === 'exp'
          ? `<span class="badge badge--offline">${d.days_past} gün önce bitti</span>`
          : `<span class="badge badge--unknown">${d.days_left} gün kaldı</span>`;
        return `
        <tr>
          <td class="hostname-cell">${fmt(d.hostname)}</td>
          <td>${brandModel(d)}</td>
          <td>${fmt(d.username)}</td>
          <td>${fmtDate(d.warranty_expiry)}</td>
          <td>${badge}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="5" class="loading-cell" style="color:var(--green,#22c55e)">Garanti sorunu yok ✓</td></tr>`;
    }
  } catch (err) {
    console.error('Alerts load error:', err);
    const offBody = $(`#offlineBody`);
    if (offBody) offBody.innerHTML = `<tr><td colspan="6" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
  }
}

function updateAlertsBadge(count) {
  // Topbar zil rozeti aynı sayıyı gösterir
  const bell = $(`#bellBadge`);
  if (bell) {
    bell.textContent = count > 99 ? '99+' : count;
    bell.style.display = count > 0 ? '' : 'none';
  }
  const tabB = $(`#tabAlertBadge`);
  if (tabB) {
    tabB.textContent = count > 99 ? '99+' : count;
    tabB.style.display = count > 0 ? '' : 'none';
  }
  const badge = $(`#alertsNavBadge`);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Sessiz arka plan: uyarı sayısını başlangıçta yükle (sidebar rozeti için)
async function preloadAlertsBadge() {
  try {
    const [anomalies, offline, compliance, shadow, eol, warranty, drift] = await Promise.all([
      fetchAnomalies(), fetchOfflineAlerts(), fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0 } })),
      fetchEolOs().catch(() => ({ total_issues: 0 })),
      fetchWarranty().catch(() => ({ total_issues: 0 })),
      fetchLocationDrift().catch(() => ({ count: 0 })),
    ]);
    const total = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + (shadow.shadow?.count || 0)
      + (eol.total_issues || 0) + (warranty.total_issues || 0) + (drift.count || 0);
    updateAlertsBadge(total);
  } catch (_) { /* sessiz */ }
}

// Periyodik tazeleme: yeni uyarı geldiğinde rozet + (açıksa) panel otomatik güncellensin.
// Uyarılar görünümü açıksa tabloları sessizce (spinner'sız) yeniler; değilse yalnız rozeti.
function startAlertsAutoRefresh(intervalMs = 60000) {
  setInterval(() => {
    if (state.currentView === 'alerts') {
      loadAlerts(false);            // tabloları + rozeti sessizce tazele
    } else {
      preloadAlertsBadge();         // yalnız rozeti tazele
    }
    if (state.currentView === 'lifecycle') {
      loadLifecycle(false);         // çelişki + log + rozet sessizce tazele
    } else {
      preloadLifecycleBadge();      // yalnız lifecycle rozetini tazele
    }
  }, intervalMs);
}

/* ─── Cihaz Yaşam Döngüsü & Audit Log ───────────────────────────────────────── */
const SEVERITY_META = {
  critical: { label: 'KRİTİK', cls: 'badge--offline' },
  high:     { label: 'YÜKSEK', cls: 'badge--offline' },
  medium:   { label: 'ORTA',   cls: 'badge--unknown' },
  low:      { label: 'DÜŞÜK',  cls: 'badge--unknown' },
};
const CONFLICT_LABEL = {
  depoda_ama_aktif:    'Depoda ama ağda aktif',
  kayip_suphesi:       'Kayıp şüphesi (depo girişi yok)',
  kritik_kayip:        'Kritik cihaz kayıp',
  kayip:               'Cihaz kayıp/belirsiz',
  imzasiz_kritik_islem:'Güvenlik ihlali (imzasız kritik işlem)',
  onay_zaman_asimi:    'Onay süresi doldu (yetkisiz/askıda)',
  onay_bekliyor:       'Dijital onay bekleniyor',
};

let lifecycleMetaCache = null; // { states, approvers, requires_approval }

async function getLifecycleMeta() {
  if (!lifecycleMetaCache) {
    try {
      const v = await fetchLifecycleVerify();
      lifecycleMetaCache = {
        states: v.states || [],
        approvers: v.approvers || [],
        requires_approval: v.requires_approval || [],
      };
    } catch { lifecycleMetaCache = { states: [], approvers: [], requires_approval: [] }; }
  }
  return lifecycleMetaCache;
}

async function populateLifecycleForm() {
  // Cihaz listesi
  const sel = $('#lifeAssetSelect');
  if (sel) {
    let assets = state.assets && state.assets.length ? state.assets : null;
    if (!assets) { try { assets = (await fetchAssets({ size: 200 })).results || []; state.assets = assets; } catch { assets = []; } }
    const opts = assets
      .slice()
      .sort((a, b) => (a.hostname || '').localeCompare(b.hostname || ''))
      .map(a => `<option value="${escapeHtml(a.serial_number || '')}" data-hostname="${escapeHtml(a.hostname || '')}" data-id="${a.id}">${escapeHtml(a.hostname || '—')} (${escapeHtml(a.serial_number || '—')})</option>`)
      .join('');
    sel.innerHTML = `<option value="">— Cihaz seçin —</option>${opts}`;
  }
  const meta = await getLifecycleMeta();
  // Durum listesi
  const ssel = $('#lifeStatusSelect');
  if (ssel) {
    ssel.innerHTML = meta.states.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    ssel.onchange = updateApproverRequirement;
  }
  // Onaylayan listesi
  const asel = $('#lifeApprover');
  if (asel) {
    asel.innerHTML = `<option value="">— Onaylayan seçin —</option>` +
      meta.approvers.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  }
  updateApproverRequirement();
}

// Seçili durum kritikse onaylayan alanını "zorunlu" göster + uyarı metni
function updateApproverRequirement() {
  const meta = lifecycleMetaCache || { requires_approval: [] };
  const status = $('#lifeStatusSelect')?.value;
  const req = meta.requires_approval.includes(status);
  const star = $('#lifeApproverReq');
  const hint = $('#lifeApproverHint');
  if (star) star.style.display = req ? '' : 'none';
  if (hint) {
    hint.textContent = req
      ? `⚠ "${status}" kritik bir durumdur — çift onay (dijital imza) gerektirir. Onaylayan seçilmezse işlem GÜVENLİK İHLALİ olarak loglanır.`
      : '';
    hint.style.color = req ? 'var(--orange, #f59e0b)' : 'var(--text-muted)';
  }
}

async function loadLifecycle(showLoading = true) {
  if (showLoading) {
    const cl = $('#lifeConflictList'); if (cl) cl.innerHTML = '<p class="loading-cell">Yükleniyor...</p>';
    const lb = $('#lifeLogBody');      if (lb) lb.innerHTML = '<tr><td colspan="8" class="loading-cell">Yükleniyor...</td></tr>';
    populateLifecycleForm();
  }
  try {
    const [conf, log, netscan, backup] = await Promise.all([
      fetchLifecycleConflicts(),
      fetchLifecycleLog(100),
      fetchNetworkScan().catch(() => ({ alarm: false, findings: { count: 0, items: [] } })),
      fetchBackupStatus().catch(() => null),
    ]);

    renderNetworkAlarm(netscan);
    renderBackupStatus(backup);

    // Özet kartları
    const critical = conf.by_severity?.critical || 0;
    const elC = $('#lifeConflictCount'); if (elC) animateCount(elC, conf.total_conflicts || 0);
    const elK = $('#lifeCriticalCount'); if (elK) animateCount(elK, critical);
    const elT = $('#lifeTotalEvents');   if (elT) animateCount(elT, conf.total_events || 0);

    // Bütünlük: hash zinciri sağlam VE imzasız kritik işlem yok
    const chain = conf.chain || { valid: true };
    const intact = conf.integrity_ok !== undefined ? conf.integrity_ok : chain.valid;
    const ct = $('#chainStatusText'), ci = $('#chainStatusIcon');
    if (ct) {
      ct.textContent = !chain.valid ? 'ZİNCİR BOZULDU!' : (intact ? 'Mühürlü ✓' : 'İHLAL VAR!');
      ct.title = !chain.valid ? (chain.reason || 'Hash zinciri tutarsız')
        : (intact ? `${chain.total} kayıt mühürlü · ${chain.signed_count || 0} dijital imza` : `${conf.security_breaches} imzasız kritik işlem (güvenlik ihlali)`);
    }
    if (ci) ci.className = 'stat-icon ' + (intact ? 'stat-icon--green' : 'stat-icon--red');

    // Nav badge (lifecycle'a özel, bağımsız)
    updateLifecycleBadge(conf.total_conflicts || 0);

    // Çelişki listesi
    setPill('lifeConflictPill', conf.total_conflicts || 0);
    const list = $('#lifeConflictList');
    if (list) {
      const items = conf.conflicts || [];
      list.innerHTML = items.length ? items.map(c => {
        const sev = SEVERITY_META[c.severity] || SEVERITY_META.high;
        const label = CONFLICT_LABEL[c.type] || c.type;
        const renewBtn = c.type === 'onay_zaman_asimi' && c.approval_id
          ? `<button class="btn-report life-renew-btn" data-approval-id="${escapeHtml(c.approval_id)}" style="margin-top:8px;font-size:12px;padding:6px 12px;">Onay talebini yenile</button>`
          : '';
        return `
        <div class="shadow-alert" style="margin-bottom:10px;">
          <p class="shadow-warn" style="display:flex;align-items:center;gap:8px;">
            <span class="badge ${sev.cls}">${sev.label}</span>
            <strong>${escapeHtml(c.hostname)}</strong>
            <span style="color:var(--text-muted);font-weight:400;">· ${escapeHtml(label)}</span>
          </p>
          <p style="margin:6px 0 4px;">${escapeHtml(c.message)}</p>
          <p class="shadow-rec">Loglayan: ${escapeHtml(c.logged_by)} · ${fmtDate(c.logged_at)} · Durum: <strong>${escapeHtml(c.lifecycle_status)}</strong>${c.approver ? ' · Onaylayan: ' + escapeHtml(c.approver) : ''}</p>
          ${renewBtn}
        </div>`;
      }).join('') : `<p class="loading-cell" style="color:var(--green,#22c55e)">Yaşam döngüsü çelişkisi tespit edilmedi ✓</p>`;
      list.querySelectorAll('.life-renew-btn').forEach(b => b.addEventListener('click', () => handleLifecycleRenew(b.dataset.approvalId)));
    }

    // Zaman çizelgesi
    setPill('lifeLogPill', log.total || 0);
    const body = $('#lifeLogBody');
    if (body) {
      const evs = log.events || [];
      body.innerHTML = evs.length ? evs.map(e => `
        <tr>
          <td class="serial-cell">${e.seq}</td>
          <td>${fmtDate(e.timestamp)}</td>
          <td class="hostname-cell">${fmt(e.hostname)}</td>
          <td>${e.from_status ? `<span class="badge badge--unknown">${escapeHtml(e.from_status)}</span> → ` : ''}<span class="badge ${LOST_OR_STORAGE(e.to_status)}">${escapeHtml(e.to_status)}</span></td>
          <td class="upn-cell">${actorIdentityCell(e)}</td>
          <td>${signoffSeal(e)}</td>
          <td class="note-cell" title="${e.note ? escapeHtml(e.note) : ''}">${e.note ? escapeHtml(e.note) : '—'}</td>
          <td class="serial-cell" title="${e.hash}" style="color:var(--text-muted);white-space:nowrap;">${String(e.hash).slice(0, 10)}…</td>
        </tr>`).join('') : `<tr><td colspan="8" class="loading-cell">Henüz log kaydı yok</td></tr>`;
    }
  } catch (err) {
    console.error('Lifecycle load error:', err);
    const cl = $('#lifeConflictList'); if (cl) cl.innerHTML = `<p class="loading-cell" style="color:#ef4444">${err.message}</p>`;
  }
}

// Sign-off / dijital imza mührü (durum ikonu + hover bilgisi)
function signoffSeal(e) {
  const lock = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const warn = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  const clock = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  if (e.signed && e.approver) {
    return `<span class="signoff signoff--ok" title="Onaylayan: ${escapeHtml(e.approver)} — Dijital Olarak İmzalandı">${lock}</span>`;
  }
  if (e.security_flag === 'imzasiz_kritik') {
    return `<span class="signoff signoff--breach" title="İMZASIZ — Güvenlik İhlali: kritik durum dijital onay olmadan değiştirildi">${warn}</span>`;
  }
  if (e.approval_status === 'expired') {
    return `<span class="signoff signoff--breach" title="Onay süresi doldu — ${escapeHtml(e.approver || '')} zamanında onaylamadı">${warn}</span>`;
  }
  if (e.approval_status === 'pending') {
    return `<span class="signoff signoff--pending" title="Onay bekliyor — ${escapeHtml(e.approver || '')} dijital imzası bekleniyor">${clock}</span>`;
  }
  return `<span style="color:var(--text-muted);">—</span>`;
}

// İşlem yapan kimlik hücresi: AD UPN + IP + MFA rozeti
function actorIdentityCell(e) {
  const upn = e.actor_upn || e.actor || '—';
  const ipm = (e.actor_ip && e.actor_ip !== '—') ? `${escapeHtml(e.actor_ip)}` : '';
  const mfa = e.mfa_verified === false
    ? `<span class="mfa-badge mfa-no" title="MFA doğrulanmadı / bypass">MFA ✗</span>`
    : `<span class="mfa-badge mfa-ok" title="${escapeHtml(e.mfa_method || 'MFA doğrulandı')}">MFA ✓</span>`;
  return `<div class="upn-cell"><div class="upn">${escapeHtml(upn)}</div><div class="ipm">${ipm}</div>${mfa}</div>`;
}

// Canlı ağ keşfi alarm banner'ı (kritik cihaz ağda aktifse kırmızı)
function renderNetworkAlarm(scan) {
  const el = $('#netAlarmBanner');
  if (!el) return;
  const items = scan?.findings?.items || [];
  if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <h4><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    CANLI AĞ KEŞFİ — ${items.length} KARANTİNA CİHAZI AĞDA AKTİF!</h4>
    <ul>${items.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>`;
}

// WORM yedek bütünlük kartı
function renderBackupStatus(b) {
  if (!b) return;
  const pill = $('#backupSyncPill');
  if (pill) { pill.textContent = b.in_sync ? 'SENKRON' : (b.recovery_needed ? 'KURTARMA GEREKLİ' : 'KONTROL'); }
  const lc = $('#backupLocalCount'); if (lc) lc.textContent = b.local_count;
  const rc = $('#backupRemoteCount'); if (rc) rc.textContent = b.backup_count;
  const det = $('#backupDetail');
  if (det) { det.textContent = b.detail; det.style.color = b.recovery_needed ? 'var(--red,#ef4444)' : 'var(--text-muted)'; }
  const btn = $('#backupRestoreBtn');
  if (btn) btn.style.display = b.recovery_needed ? '' : 'none';
}

function LOST_OR_STORAGE(status) {
  if (status === 'Kayıp' || status === 'Belirsiz') return 'badge--offline';
  if (status === 'Ayrılan Personelden Teslim Alındı' || status === 'Bakımda') return 'badge--unknown';
  return 'badge--online';
}

function updateLifecycleBadge(count) {
  const badge = $('#lifecycleNavBadge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = ''; }
  else badge.style.display = 'none';
}

async function preloadLifecycleBadge() {
  try { const c = await fetchLifecycleConflicts(); updateLifecycleBadge(c.total_conflicts || 0); } catch (_) {}
}

async function handleLifecycleRecord() {
  const sel = $('#lifeAssetSelect');
  const opt = sel && sel.options[sel.selectedIndex];
  const msg = $('#lifeRecordMsg');
  if (!opt || !opt.value && !opt.dataset.hostname) {
    if (msg) { msg.textContent = 'Lütfen bir cihaz seçin.'; msg.style.color = '#ef4444'; }
    return;
  }
  const to_status = $('#lifeStatusSelect')?.value;
  const approver = $('#lifeApprover')?.value || null;
  const note = $('#lifeNote')?.value?.trim() || null;
  const btn = $('#lifeRecordBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }
  try {
    const r = await postLifecycleEvent({
      serial_number: opt.value || null,
      hostname: opt.dataset.hostname || null,
      asset_id: opt.dataset.id ? Number(opt.dataset.id) : null,
      to_status, approver, note,
    });
    if (msg) {
      if (r.security_breach) {
        msg.style.color = '#ef4444';
        msg.innerHTML = `⚠ GÜVENLİK İHLALİ olarak loglandı (#${r.entry.seq}): "${escapeHtml(to_status)}" kritik durumu dijital onay olmadan kaydedildi. Alarm tetiklendi 🔔`;
      } else if (r.kind === 'pending') {
        msg.style.color = 'var(--accent-light, #818cf8)';
        msg.innerHTML = `🕓 Onaya sunuldu (#${r.entry.seq}). <b>${escapeHtml(approver)}</b> onaylayana kadar durum UYGULANMAZ.` +
          `<div style="margin-top:8px;padding:10px;background:var(--bg-hover,#1e293b);border-radius:8px;">` +
          `<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Onaylayana gönderilecek tek kullanımlık dijital onay bağlantısı:</div>` +
          `<a href="${r.approval_link}" target="_blank" style="color:var(--accent-light,#818cf8);word-break:break-all;">${r.approval_link}</a>` +
          `<div style="margin-top:8px;display:flex;gap:8px;">` +
          `<button class="btn-report" id="lifeCopyLink" style="font-size:12px;padding:6px 12px;">Linki kopyala</button>` +
          `<button class="btn-report" id="lifeOpenApprove" style="font-size:12px;padding:6px 12px;">Onay sayfasını aç (onaylayan simülasyonu)</button>` +
          `</div></div>`;
        const copyBtn = $('#lifeCopyLink');
        if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(r.approval_link); copyBtn.textContent = 'Kopyalandı ✓'; });
        const openBtn = $('#lifeOpenApprove');
        if (openBtn) openBtn.addEventListener('click', () => { window.open(r.approval_link, '_blank'); setTimeout(() => loadLifecycle(false), 800); });
      } else {
        msg.style.color = 'var(--green,#22c55e)';
        msg.textContent = `Kaydedildi (#${r.entry.seq}) · ${to_status}${r.notified ? ' · Bildirim gönderildi 🔔' : ''}`;
      }
    }
    if ($('#lifeNote')) $('#lifeNote').value = '';
    if ($('#lifeApprover')) $('#lifeApprover').value = '';
    await loadLifecycle(false); // listeyi + çelişkileri tazele
  } catch (err) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = 'Hata: ' + err.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kaydı Ekle'; }
  }
}

async function postLifecycleRenew(approval_id) {
  const res = await fetch('/api/lifecycle/renew', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approval_id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}

async function handleLifecycleRenew(approval_id) {
  const msg = $('#lifeRecordMsg');
  try {
    const r = await postLifecycleRenew(approval_id);
    if (msg) {
      msg.style.color = 'var(--accent-light, #818cf8)';
      msg.innerHTML = `🔄 Onay talebi yenilendi. Yeni tek kullanımlık bağlantı:` +
        `<div style="margin-top:8px;padding:10px;background:var(--bg-hover,#1e293b);border-radius:8px;">` +
        `<a href="${r.approval_link}" target="_blank" style="color:var(--accent-light,#818cf8);word-break:break-all;">${r.approval_link}</a>` +
        `<div style="margin-top:8px;"><button class="btn-report" id="lifeOpenApprove2" style="font-size:12px;padding:6px 12px;">Onay sayfasını aç</button></div></div>`;
      const ob = $('#lifeOpenApprove2');
      if (ob) ob.addEventListener('click', () => { window.open(r.approval_link, '_blank'); setTimeout(() => loadLifecycle(false), 800); });
    }
    // Yenileme eski ihlali çözer → listeyi tazele
    document.querySelector('#view-lifecycle')?.scrollIntoView({ behavior: 'smooth' });
    await loadLifecycle(false);
  } catch (err) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = 'Yenileme hatası: ' + err.message; }
  }
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
function filterTableBySearch(query) {
  const q = query.toLowerCase();
  const rows = $$('.asset-table tbody tr');
  rows.forEach((row) => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
}

/* ─── Chat ──────────────────────────────────────────────────────────────── */
function toggleChat() {
  state.chatOpen = !state.chatOpen;
  const panel = $(`#chatPanel`);
  const fab = $(`#chatFab`);
  panel.classList.toggle('open', state.chatOpen);
  fab.classList.toggle('active', state.chatOpen);
  if (state.chatOpen) $(`#chatInput`)?.focus();
}

function appendMessage(role, text) {
  const container = $(`#chatMessages`);
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const el = document.createElement('div');
  el.className = `msg msg--${role === 'user' ? 'user' : 'ai'}`;
  const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div><span class="msg-time">${now}</span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function showTyping() {
  const container = $(`#chatMessages`);
  const el = document.createElement('div');
  el.className = 'msg msg--ai';
  el.id = 'typingIndicator';
  el.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  $(`#typingIndicator`)?.remove();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

async function handleSendChat(message) {
  if (!message.trim()) return;
  const input = $(`#chatInput`);
  const sendBtn = $(`#chatSend`);
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  appendMessage('user', message);
  showTyping();

  try {
    const data = await sendChat(message);
    removeTyping();
    appendMessage('ai', sanitizeAiResponse(data.reply));
  } catch (err) {
    removeTyping();
    appendMessage('ai', `Hata: ${err.message}`);
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ─── AI Yanıt Temizleyici ────────────────────────────────────────────────── */
function sanitizeAiResponse(text) {
  const lines = text.split('\n');
  const clean = [];
  let inJsonBlock = false;

  for (const line of lines) {
    const t = line.trim();

    // Araç çağrısı JSON satırları (model bazen bunları yanıta karıştırıyor)
    if (/^\{"name"\s*:/.test(t) || /^\{"tool"\s*:/.test(t)) continue;

    // JSON bloğu başlangıcı/sonu (```json ... ```)
    if (/^```(json)?/.test(t)) { inJsonBlock = !inJsonBlock; continue; }
    if (inJsonBlock) continue;

    // Sadece > içeren satırlar (boş blockquote) — atla
    if (t === '>') continue;

    // > ile başlayan blockquote → içeriği al
    if (/^>\s/.test(t)) {
      clean.push(t.replace(/^>\s*/, ''));
      continue;
    }

    clean.push(line);
  }

  // "**Etiket:**\nDeğer" → "**Etiket:** Değer" (SADECE tek newline, tablo/liste değilse)
  let result = clean.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  result = result.replace(/(\*\*[^*\n]+:\*\*)\n([A-ZÇĞİÖŞÜa-zçğışöşü])/g, '$1 $2');

  // Yaygın yazım hataları
  result = result.replace(/çevrimiçe/gi, 'çevrimiçi');
  result = result.replace(/çevrimdışe/gi, 'çevrimdışı');

  // Model bazen "X cihaz yeni günden bugünü..." gibi hatalı cümle kuruyor → düzelt
  result = result.replace(
    /(\d+)\s+cihaz\s+yeni\s+gün[^\n.]*(?:güncellenmiştir|eklenmiştir|bulunmaktadır)[^\n]*/gi,
    'Bugün $1 yeni cihaz eklenmiştir.'
  );
  result = result.replace(
    /yeni\s+günden\s+bugün[ü]?[^\n]*/gi,
    'Bugün yeni cihaz eklenmiştir.'
  );

  return result;
}

/* ─── Markdown → HTML ────────────────────────────────────────────────────── */
function markdownToHtml(md) {
  const lines = md.split('\n');
  const html = [];
  let inTable = false;
  let inList  = false;
  let tableHeaderDone = false;

  const inlineFormat = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Heading
    if (/^###\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h3 class="rpt-h3">${inlineFormat(line.replace(/^###\s/, ''))}</h3>`);
      continue;
    }
    if (/^##\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h2 class="rpt-h2">${inlineFormat(line.replace(/^##\s/, ''))}</h2>`);
      continue;
    }
    if (/^#\s/.test(line)) {
      if (inList)  { html.push('</ul>'); inList = false; }
      if (inTable) { html.push('</tbody></table>'); inTable = false; }
      html.push(`<h1 class="rpt-h1">${inlineFormat(line.replace(/^#\s/, ''))}</h1>`);
      continue;
    }

    // Table row
    if (/^\|/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      // Separator row (---|---) → skip, marks header done
      if (cells.every(c => /^[-:]+$/.test(c))) {
        tableHeaderDone = true;
        continue;
      }
      if (!inTable) {
        html.push('<table class="rpt-table"><thead>');
        html.push('<tr>' + cells.map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr>');
        html.push('</thead><tbody>');
        inTable = true;
        tableHeaderDone = false;
      } else {
        html.push('<tr>' + cells.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }

    // Close table if open
    if (inTable && !/^\|/.test(line)) {
      html.push('</tbody></table>');
      inTable = false;
    }

    // List item (-, *, +, •, veya 1. 2. gibi numaralı)
    if (/^[-*+•]\s/.test(line) || /^\d+\.\s/.test(line)) {
      if (!inList) { html.push('<ul class="rpt-list">'); inList = true; }
      const text = line.replace(/^[-*+•]\s/, '').replace(/^\d+\.\s/, '');
      html.push(`<li>${inlineFormat(text)}</li>`);
      continue;
    }

    // Close list if open
    if (inList && !/^[-*+•]\s/.test(line) && !/^\d+\.\s/.test(line)) {
      html.push('</ul>');
      inList = false;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      html.push('<hr class="rpt-hr">');
      continue;
    }

    // Empty line
    if (!line) {
      html.push('<div class="rpt-spacer"></div>');
      continue;
    }

    // Paragraph
    html.push(`<p class="rpt-p">${inlineFormat(line)}</p>`);
  }

  if (inList)  html.push('</ul>');
  if (inTable) html.push('</tbody></table>');
  return html.join('\n');
}

/* ─── PDF Print ─────────────────────────────────────────────────────────── */
function printReport() {
  const title   = $(`#reportTitle`)?.textContent || 'Rapor';
  const content = $(`#reportContent`)?.innerHTML || '';
  const now     = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8"/>
  <title>${title} — AssetMan</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Hanken Grotesk", -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1815; background: #fff; font-size: 13px; line-height: 1.7; -webkit-font-smoothing: antialiased; letter-spacing: -0.006em; }

    /* ── Header (editoryal, açık zemin) ── */
    .pdf-header { padding: 44px 48px 0; }
    .pdf-header-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 22px; border-bottom: 1px solid #ece5da; }
    .pdf-brand { display: flex; align-items: center; gap: 11px; }
    .pdf-brand-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #6b5cff, #8a7dff); border-radius: 9px; display: flex; align-items: center; justify-content: center; }
    .pdf-brand-icon svg { width: 19px; height: 19px; stroke: #fff; fill: none; stroke-width: 1.8; }
    .pdf-brand-name { font-family: "Fraunces", Georgia, serif; font-size: 17px; font-weight: 600; color: #1a1815; letter-spacing: -0.01em; }
    .pdf-brand-sub  { font-size: 11px; color: #8a8378; margin-top: 1px; }
    .pdf-meta { text-align: right; font-size: 11px; color: #8a8378; line-height: 1.6; }
    .pdf-meta strong { color: #1a1815; font-weight: 600; }
    .pdf-title-block { padding: 30px 0 4px; }
    .pdf-chip { display: inline-flex; align-items: center; gap: 6px; background: #eeecff; color: #6b5cff; font-size: 10.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; letter-spacing: 0.02em; margin-bottom: 14px; }
    .pdf-chip::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #6b5cff; }
    .pdf-title { font-family: "Fraunces", Georgia, serif; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; color: #1a1815; }
    .pdf-subtitle { font-size: 12.5px; color: #8a8378; margin-top: 6px; }

    /* ── Body ── */
    .pdf-body { padding: 30px 48px 44px; max-width: 820px; }

    /* ── Typography ── */
    .rpt-h1 { font-size: 17px; font-weight: 600; color: #1a1815; margin: 26px 0 10px; padding-bottom: 8px; border-bottom: 1px solid #ece5da; letter-spacing: -0.01em; }
    .rpt-h2 { font-size: 14.5px; font-weight: 600; color: #1a1815; margin: 20px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #f0e9de; }
    .rpt-h3 { font-size: 11px; font-weight: 600; color: #8a8378; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; }
    .rpt-p  { color: #5a544c; margin: 6px 0; font-size: 13px; }
    .rpt-spacer { height: 8px; }
    .rpt-hr { border: none; border-top: 1px solid #f0e9de; margin: 16px 0; }
    strong { font-weight: 600; color: #1a1815; }
    code { background: #f4efe7; border: 1px solid #ece5da; border-radius: 5px; padding: 1px 6px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; color: #6b5cff; }

    /* ── Table (hairline, sıcak nötr başlık) ── */
    .rpt-table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 12px; }
    .rpt-table th { background: #f7f2ea; color: #5a544c; font-weight: 600; padding: 10px 14px; text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e4dbcf; }
    .rpt-table td { padding: 9px 14px; border-bottom: 1px solid #f0e9de; color: #5a544c; font-variant-numeric: tabular-nums; }
    .rpt-table tr:last-child td { border-bottom: none; }

    /* ── List ── */
    .rpt-list { padding-left: 20px; margin: 8px 0 10px; }
    .rpt-list li { padding: 3px 0; color: #5a544c; }
    .rpt-list li::marker { color: #b3a89a; }

    /* ── Footer ── */
    .pdf-footer { margin: 0 48px; padding: 16px 0; border-top: 1px solid #ece5da; display: flex; justify-content: space-between; font-size: 10.5px; color: #b3a89a; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .pdf-brand-icon, .pdf-chip, .rpt-table th, code { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 0; size: A4; }
    }
  </style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-header-top">
      <div class="pdf-brand">
        <div class="pdf-brand-icon">
          <svg viewBox="0 0 24 24" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>
        </div>
        <div>
          <div class="pdf-brand-name">AssetMan</div>
          <div class="pdf-brand-sub">IT Asset Management</div>
        </div>
      </div>
      <div class="pdf-meta">
        <div>Oluşturulma Tarihi</div>
        <div><strong>${now}</strong></div>
      </div>
    </div>
    <div class="pdf-title-block">
      <div class="pdf-chip">Yapay Zeka Analizi</div>
      <div class="pdf-title">${title}</div>
      <div class="pdf-subtitle">AssetMan tarafından otomatik oluşturulmuştur</div>
    </div>
  </div>

  <div class="pdf-body">
    ${content}
  </div>

  <div class="pdf-footer">
    <span>AssetMan — IT Asset Management</span>
    <span>Bu rapor yapay zeka destekli analiz ile oluşturulmuştur.</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`);
  win.document.close();
}

/* ─── Reports ────────────────────────────────────────────────────────────── */
async function runReport(prompt, title, appendShadow) {
  const output  = $(`#reportOutput`);
  const content = $(`#reportContent`);
  const titleEl = $(`#reportTitle`);
  const pdfBtn  = $(`#pdfBtn`);

  output.style.display = 'block';
  titleEl.textContent  = title;
  if (pdfBtn) pdfBtn.style.display = 'none';
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:32px 20px;color:var(--text-muted);">
      <div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
      <span style="font-size:13px;">Analiz yapılıyor, lütfen bekleyin...</span>
    </div>`;
  output.scrollIntoView({ behavior: 'smooth' });

  try {
    const data = await sendChat(prompt);
    const cleaned = sanitizeAiResponse(data.reply);
    content.innerHTML = markdownToHtml(cleaned);
    if (appendShadow) {
      try {
        const sdata = await fetchShadowIT();
        content.innerHTML += shadowItReportHtml(sdata);
      } catch (e) { /* Shadow IT taraması başarısızsa rapor yine de gösterilir */ }
      try {
        const edata = await fetchEolOs();
        content.innerHTML += eolReportHtml(edata);
      } catch (e) { /* EOL taraması başarısızsa rapor yine de gösterilir */ }
      try {
        const wdata = await fetchWarranty();
        content.innerHTML += warrantyReportHtml(wdata);
      } catch (e) { /* Garanti taraması başarısızsa rapor yine de gösterilir */ }
    }
    if (pdfBtn) pdfBtn.style.display = 'flex';
  } catch (err) {
    content.innerHTML = `<p style="color:#ef4444;padding:20px;">Hata: ${err.message}</p>`;
  }
}

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
  $(`#qaAddAsset`)?.addEventListener('click', () => $(`#qrModalOverlay`)?.classList.add('open'));
  $(`#qaBulk`)?.addEventListener('click', () => {
    $(`#qrModalOverlay`)?.classList.add('open');
    $(`.modal-tab[data-tab="bulk"]`)?.click();
  });
  $(`#qaLifecycle`)?.addEventListener('click', () => showView('lifecycle'));
  $(`#qaReport`)?.addEventListener('click', () => showView('reports'));

  // İşlemler görünümü + Kullanıcı ekle
  $(`#opAddAsset`)?.addEventListener('click', () => $(`#qrModalOverlay`)?.classList.add('open'));
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

  // Report buttons
  $$('.btn-report').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.report-card');
      if (!card) return; // #generateQr / #createBulk de btn-report sınıfı taşıyor ama report-card içinde değil
      const prompt = btn.dataset.prompt;
      const title = card.querySelector('h4').textContent;
      runReport(prompt, title, btn.dataset.shadow === '1');
    });
  });

  // Close report
  $(`#closeReport`)?.addEventListener('click', () => {
    $(`#reportOutput`).style.display = 'none';
  });

  // QR ile Cihaz Ekle modalı
  const qrOverlay = $(`#qrModalOverlay`);
  $(`#openAddModal`)?.addEventListener('click', () => qrOverlay?.classList.add('open'));
  $(`#closeQrModal`)?.addEventListener('click', () => qrOverlay?.classList.remove('open'));
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
  $(`#openAddLine`)?.addEventListener('click', openLineModal);
  $(`#closeLineModal`)?.addEventListener('click', () => lineOverlay?.classList.remove('open'));
  lineOverlay?.addEventListener('click', (e) => { if (e.target === lineOverlay) lineOverlay.classList.remove('open'); });
  $(`#saveLineBtn`)?.addEventListener('click', saveLine);
  $(`#importLinesBtn`)?.addEventListener('click', () => $(`#lineCsvInput`)?.click());
  $(`#lineCsvInput`)?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { importLinesCsv(String(reader.result || '')); e.target.value = ''; };
    reader.readAsText(file, 'utf-8');
  });

  $(`#generateQr`)?.addEventListener('click', async () => {
    const btn = $(`#generateQr`);
    const uyari = $(`#qrTokenInfo`);
    /* QR artik IMZALI JETON tasiyor. Jeton olmadan /api/register kayit kabul
       etmiyor — aksi halde adresi bilen herkes envantere sahte cihaz ekler. */
    let jeton;
    try {
      if (btn) { btn.disabled = true; }
      const r = await fetch('/api/register/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: Number($(`#qrHours`)?.value) || 24,
          uses: Number($(`#qrUses`)?.value) || 1,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || 'jeton üretilemedi');
      jeton = j;
    } catch (err) {
      if (uyari) {
        uyari.style.color = 'var(--red)';
        uyari.textContent = 'QR üretilemedi: ' + err.message;
      }
      if (btn) btn.disabled = false;
      return;
    }
    if (btn) btn.disabled = false;

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
    const qrSrc = `/api/qr?data=${encodeURIComponent(registerUrl)}`;

    $(`#qrImg`).src = qrSrc;
    $(`#qrLink`).textContent = registerUrl;
    $(`#qrLink`).href = registerUrl;
    $(`#qrPlaceholder`).style.display = 'none';
    $(`#qrBox`).style.display = 'flex';
    $(`#printQr`).style.display = 'flex';
    if (uyari) {
      uyari.style.color = 'var(--text-muted)';
      uyari.textContent = `Bu QR ${jeton.max_uses} cihaz için geçerli, ` +
        `${fmtDate(jeton.expires_at)} tarihinde geçerliliği bitiyor. ` +
        'Süresi dolunca yenisini üretin.';
    }
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
