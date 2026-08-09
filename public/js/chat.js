/* AssetMan · chat.js
   Arama, AI sohbet paneli, yanit temizleyici, markdown

   NOT: Bu dosya app.js'ten bolundu. ES modul DEGIL - index.html'de
   sirayla yuklenen duz scriptler; global kapsam paylasiliyor.
   Yukleme sirasi index.html'deki <script> siralamasidir. */

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


