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
};

/* ─── Utils ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
    const av = $(`#userAvatar`);
    if (av && data.user) {
      av.textContent = userInitials(data.user);
      av.title = `${data.user} · ${data.role || ''}`;
    }
    state.role = data.role;
    // Ayarlar nav'ı yalnız admin'e görünür
    if (data.role === 'admin') { const n = $(`#navSettings`); if (n) n.style.display = ''; }
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

  state.currentView = name;
  if (name === 'assets')   renderAssetsTable();
  if (name === 'licenses') loadLicenses();
  if (name === 'lines')    loadLines();
  if (name === 'settings') loadSettings();
  if (name === 'alerts')   loadAlerts();
  if (name === 'lifecycle') loadLifecycle();
  if (name === 'insights') loadInsights();
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
async function loadDashboard() {
  try {
    const [assetsData, stats] = await Promise.all([fetchAssets({ size: 200 }), fetchStats()]);
    state.assets = assetsData.results || [];
    state.stats = stats;
    renderStats(stats);
    renderBrandChart(stats.by_brand || {});
    renderCategoryChart(stats.by_category || {});
    renderStatusChart(stats.by_status || {});
    renderLocationChart(state.assets);
    renderRecentTable(state.assets.slice(0, 10));
  } catch (err) {
    console.error('Dashboard load error:', err);
    $('tbody#recentBody').innerHTML = `<tr><td colspan="9" class="loading-cell" style="color:#ef4444">Baserow bağlantısı kurulamadı. .env dosyasını kontrol edin.</td></tr>`;
  }
}

function renderStats(stats) {
  const total = $(`#statTotal`);
  const online = $(`#statOnline`);
  const newToday = $(`#statNew`);
  const avgRam = $(`#statAvgRam`);
  if (total) animateCount(total, stats.total || 0);
  if (online) animateCount(online, stats.by_status?.online || 0);
  if (newToday) animateCount(newToday, stats.new_today || 0);
  if (avgRam) avgRam.textContent = (stats.avg_ram_gb || 0) + ' GB';
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

/* ─── Excel/CSV Export ──────────────────────────────────────────────────────── */
function exportAssetsCSV() {
  // Görünen (filtrelenmiş) envanteri dışa aktar
  let assets = state.assets || [];
  if (state.categoryFilter) assets = assets.filter((a) => (a.category || '') === state.categoryFilter);
  if (state.locationFilter)  assets = assets.filter((a) => (a.location  || '') === state.locationFilter);
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
    setV('setTheme', data.settings?.appearance?.theme || 'auto');
    renderSystemStatus(data.system || {});
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
    ['WORM yedek', s.backup ? (s.backup.in_sync ? '<span class="badge badge--online">senkron</span>' : '<span class="badge badge--offline">senkron değil</span>') : '—'],
  ];
  tbody.innerHTML = rows.map(([k, v]) => `<tr><td style="color:var(--text-muted);width:40%">${k}</td><td class="hostname-cell">${v}</td></tr>`).join('');
}

async function saveThresholds() {
  const body = {
    low_ram_gb: $(`#setLowRam`)?.value, low_disk_gb: $(`#setLowDisk`)?.value,
    old_uptime_days: $(`#setUptime`)?.value, offline_hours: $(`#setOffline`)?.value, stale_days: $(`#setStale`)?.value,
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

function openDeviceModal(asset) {
  _deviceModalAsset = asset;
  const overlay = $(`#deviceModalOverlay`);
  const title = $(`#deviceModalTitle`);
  const body = $(`#deviceModalBody`);
  if (!overlay || !body) return;
  if (title) title.textContent = asset.hostname || asset.serial_number || 'Cihaz Detayı';

  const row = (label, val) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="color:var(--text-muted)">${label}</span>
      <span style="color:var(--text);font-weight:500;text-align:right">${val}</span></div>`;

  body.innerHTML = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${categoryBadge(asset.category)} ${statusBadge(asset.status)}
      ${asset.location ? `<span class="location-tag">${escapeHtml(asset.location)}</span>` : ''}
    </div>
    <div style="margin-bottom:18px">
      ${row('Marka / Model', `${fmt(asset.brand)} ${fmt(asset.model, '')}`)}
      ${row('Seri No', `<span class="serial-cell">${fmt(asset.serial_number)}</span>`)}
      ${row('Son gören kullanıcı (telemetri)', fmt(asset.username, '—'))}
      ${row('CPU', fmt(asset.cpu))}
      ${row('RAM / Disk', `${asset.ram_gb ? asset.ram_gb + ' GB' : '—'} / ${asset.storage_gb ? asset.storage_gb + ' GB' : '—'}`)}
      ${row('IP / MAC', `<span class="serial-cell">${fmt(asset.ip_address)} · ${fmt(asset.mac_address)}</span>`)}
      ${row('İşletim Sistemi', fmt(asset.os))}
      ${row('Son Görülme', fmtDate(asset.last_seen))}
    </div>
    <div id="deviceAssignBox" style="margin-bottom:18px"></div>
    ${asset.category === 'Telefon' ? '<div id="deviceLineBox" style="margin-bottom:18px"></div>' : ''}
    <h4 style="font-size:13px;font-weight:600;margin:0 0 10px;color:var(--text)">Yaşam Döngüsü Geçmişi</h4>
    <div id="deviceHistory" style="font-size:12.5px;color:var(--text-muted)">Yükleniyor...</div>`;

  const pdfBtn = $(`#handoverPdfBtn`); if (pdfBtn) pdfBtn.style.display = '';
  overlay.classList.add('open');
  loadDeviceHistory(asset);
  loadDeviceAssignment(asset);
  if (asset.category === 'Telefon' && asset.id != null) loadDeviceLine(asset.id);
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
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; color:#1a1815; font-size:13px; line-height:1.7; padding:0; }
    .hdr { padding:44px 48px 0; }
    .hdr-top { display:flex; justify-content:space-between; align-items:center; padding-bottom:22px; border-bottom:1px solid #ece5da; }
    .brand { display:flex; align-items:center; gap:11px; }
    .brand-icon { width:34px; height:34px; background:linear-gradient(135deg,#6b5cff,#8a7dff); border-radius:9px; display:flex; align-items:center; justify-content:center; }
    .brand-icon svg { width:19px; height:19px; stroke:#fff; fill:none; stroke-width:1.8; }
    .brand-name { font-size:16px; font-weight:600; color:#1a1815; letter-spacing:-.02em; }
    .brand-sub { font-size:11px; color:#8a8378; }
    .meta { text-align:right; font-size:11px; color:#8a8378; }
    .meta strong { color:#1a1815; }
    .title-block { padding:30px 0 4px; }
    .chip { display:inline-flex; align-items:center; gap:6px; background:#eeecff; color:#6b5cff; font-size:10.5px; font-weight:600; padding:4px 11px; border-radius:999px; margin-bottom:14px; }
    .chip::before { content:''; width:5px; height:5px; border-radius:50%; background:#6b5cff; }
    .title { font-size:27px; font-weight:600; letter-spacing:-.03em; color:#1a1815; }
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
    tbody.innerHTML = `<tr><td colspan="8" class="loading-cell">Henüz kayıt yok</td></tr>`;
    return;
  }
  tbody.innerHTML = assets.map((a) => `
    <tr>
      <td class="hostname-cell">${fmt(a.hostname)}</td>
      <td>${categoryBadge(a.category)}</td>
      <td>${fmt(a.brand)} ${a.model ? `<span style="color:var(--text-muted)">${a.model}</span>` : ''}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${fmt(a.cpu)}</td>
      <td>${a.ram_gb ? a.ram_gb + ' GB' : '—'}</td>
      <td>${a.storage_gb ? a.storage_gb + ' GB' : '—'}</td>
      <td>${fmt(a.os)}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${fmtDate(a.last_seen)}</td>
    </tr>`).join('');
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

async function renderAssetsTable() {
  const tbody = $(`#assetsBody`);
  const countEl = $(`#assetCount`);
  if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="loading-cell">Yükleniyor...</td></tr>`;

  try {
    const filterStatus = $(`#filterStatus`)?.value || '';
    const params = { size: 200 };
    if (filterStatus) { params.filter_field = 'status'; params.filter_value = filterStatus; }

    const data = await fetchAssets(params);
    let assets = data.results || [];
    state.assets = assets;

    populateLocationFilter(assets);

    // Client-side filters
    if (state.categoryFilter) assets = assets.filter((a) => (a.category || '') === state.categoryFilter);
    if (state.locationFilter)  assets = assets.filter((a) => (a.location  || '') === state.locationFilter);

    if (countEl) countEl.textContent = `${assets.length} cihaz bulundu`;
    state.renderedAssets = assets;

    if (!assets.length) {
      tbody.innerHTML = `<tr><td colspan="13" class="loading-cell">Kayıt bulunamadı</td></tr>`;
      return;
    }

    tbody.innerHTML = assets.map((a, i) => `
      <tr class="asset-row" data-idx="${i}" style="cursor:pointer">
        <td class="hostname-cell">${fmt(a.hostname)}</td>
        <td><span class="location-tag">${fmt(a.location, '—')}</span></td>
        <td>${categoryBadge(a.category)}</td>
        <td>${fmt(a.brand)}</td>
        <td>${fmt(a.model)}</td>
        <td class="serial-cell">${fmt(a.serial_number)}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${fmt(a.cpu)}">${fmt(a.cpu)}</td>
        <td>${a.ram_gb ? a.ram_gb + ' GB' : '—'}</td>
        <td>${a.storage_gb ? a.storage_gb + ' GB' : '—'}</td>
        <td class="serial-cell">${fmt(a.ip_address)}</td>
        <td>${fmt(a.os)}</td>
        <td>${statusBadge(a.status)}</td>
        <td>${fmtDate(a.last_seen)}</td>
      </tr>`).join('');

    tbody.querySelectorAll('.asset-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.dataset.idx);
        const asset = (state.renderedAssets || [])[idx];
        if (asset) openDeviceModal(asset);
      });
    });
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="loading-cell" style="color:#ef4444">${err.message}</td></tr>`;
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
  }

  try {
    const [anomalies, offline, compliance, shadow, eol, warranty] = await Promise.all([
      fetchAnomalies(),
      fetchOfflineAlerts(),
      fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0, items: [] } })),
      fetchEolOs().catch(() => ({ total_issues: 0, eol: { items: [] }, approaching: { items: [] } })),
      fetchWarranty().catch(() => ({ total_issues: 0, expired: { items: [] }, expiring_soon: { items: [] } })),
    ]);

    const shadowCount = shadow.shadow?.count || 0;
    const eolCount = eol.total_issues || 0;
    const warrantyCount = warranty.total_issues || 0;

    // Summary cards — kartlar birbirinden bağımsız ve nav rozetine tam toplanır
    const elA = $(`#alertTotalAnomalies`); if (elA) animateCount(elA, anomalies.total_anomalies || 0);
    const elO = $(`#alertOfflineCount`);   if (elO) animateCount(elO, offline.total_alerts || 0);
    const elL = $(`#alertLicenseIssues`);   if (elL) animateCount(elL, compliance.total_issues || 0);
    const elS = $(`#alertShadowCount`);     if (elS) animateCount(elS, shadowCount);
    const elE = $(`#alertEolCount`);        if (elE) animateCount(elE, eolCount);
    const elW = $(`#alertWarrantyCount`);   if (elW) animateCount(elW, warrantyCount);

    // Nav badge = total actionable alerts
    const totalAlerts = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + shadowCount + eolCount + warrantyCount;
    updateAlertsBadge(totalAlerts);

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
    const [anomalies, offline, compliance, shadow, eol, warranty] = await Promise.all([
      fetchAnomalies(), fetchOfflineAlerts(), fetchLicenseCompliance(),
      fetchShadowIT().catch(() => ({ shadow: { count: 0 } })),
      fetchEolOs().catch(() => ({ total_issues: 0 })),
      fetchWarranty().catch(() => ({ total_issues: 0 })),
    ]);
    const total = (anomalies.total_anomalies || 0) + (offline.total_alerts || 0)
      + (compliance.total_issues || 0) + (shadow.shadow?.count || 0)
      + (eol.total_issues || 0) + (warranty.total_issues || 0);
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
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1a1815; background: #fff; font-size: 13px; line-height: 1.7; -webkit-font-smoothing: antialiased; letter-spacing: -0.005em; }

    /* ── Header (editoryal, açık zemin) ── */
    .pdf-header { padding: 44px 48px 0; }
    .pdf-header-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 22px; border-bottom: 1px solid #ece5da; }
    .pdf-brand { display: flex; align-items: center; gap: 11px; }
    .pdf-brand-icon { width: 34px; height: 34px; background: linear-gradient(135deg, #6b5cff, #8a7dff); border-radius: 9px; display: flex; align-items: center; justify-content: center; }
    .pdf-brand-icon svg { width: 19px; height: 19px; stroke: #fff; fill: none; stroke-width: 1.8; }
    .pdf-brand-name { font-size: 16px; font-weight: 600; color: #1a1815; letter-spacing: -0.02em; }
    .pdf-brand-sub  { font-size: 11px; color: #8a8378; margin-top: 1px; }
    .pdf-meta { text-align: right; font-size: 11px; color: #8a8378; line-height: 1.6; }
    .pdf-meta strong { color: #1a1815; font-weight: 600; }
    .pdf-title-block { padding: 30px 0 4px; }
    .pdf-chip { display: inline-flex; align-items: center; gap: 6px; background: #eeecff; color: #6b5cff; font-size: 10.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; letter-spacing: 0.02em; margin-bottom: 14px; }
    .pdf-chip::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #6b5cff; }
    .pdf-title { font-size: 27px; font-weight: 600; letter-spacing: -0.03em; color: #1a1815; }
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

  // Sidebar daralt/genişlet (tercih localStorage'da saklanır)
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  $(`#sidebarToggle`)?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  });

  // Search
  $(`#searchInput`)?.addEventListener('input', (e) => {
    if (state.currentView === 'assets') filterTableBySearch(e.target.value);
  });

  // Filters
  $(`#filterStatus`)?.addEventListener('change', renderAssetsTable);
  $(`#filterLocation`)?.addEventListener('change', () => {
    state.locationFilter = $(`#filterLocation`).value;
    renderAssetsTable();
  });

  // Category tabs
  $$('.cat-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.cat-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.categoryFilter = tab.dataset.cat;
      renderAssetsTable();
    });
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
  $(`#closeDeviceModal`)?.addEventListener('click', () => devOverlay?.classList.remove('open'));
  devOverlay?.addEventListener('click', (e) => { if (e.target === devOverlay) devOverlay.classList.remove('open'); });
  $(`#handoverPdfBtn`)?.addEventListener('click', () => printHandoverReceipt(_deviceModalAsset));

  // Ayarlar kaydet butonları
  $(`#saveThresholds`)?.addEventListener('click', saveThresholds);
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

  $(`#generateQr`)?.addEventListener('click', () => {
    // Mobil kayıt URL'sini bu tarayıcının origin'inden kur (aynı ağdaki telefon erişebilsin)
    const params = new URLSearchParams();
    const cat  = $(`#qrCategory`)?.value || '';
    const loc  = $(`#qrLocation`)?.value.trim() || '';
    const user = $(`#qrUsername`)?.value.trim() || '';
    if (cat)  params.set('category', cat);
    if (loc)  params.set('location', loc);
    if (user) params.set('username', user);

    const registerUrl = `${location.origin}/register${params.toString() ? '?' + params.toString() : ''}`;
    const qrSrc = `/api/qr?data=${encodeURIComponent(registerUrl)}`;

    $(`#qrImg`).src = qrSrc;
    $(`#qrLink`).textContent = registerUrl;
    $(`#qrLink`).href = registerUrl;
    $(`#qrPlaceholder`).style.display = 'none';
    $(`#qrBox`).style.display = 'flex';
    $(`#printQr`).style.display = 'flex';
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
