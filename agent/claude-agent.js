require('dotenv').config({ override: true });
const axios = require('axios');
const { getAllAssets, searchAssets, getStats, getAssetBySerial } = require('./tools/baserow-tools');
const { detectAnomalies, detectOfflineDevices, detectLicenseCompliance, detectShadowIT, detectEolOs, detectWarranty } = require('./tools/anomaly-tools');
const { detectLifecycleConflicts, getLog, getDeviceLog, auditBackupStatus } = require('./tools/lifecycle-tools');
const { scanNetwork } = require('./tools/network-discovery');
const { computeRiskScores, computeRenewalForecast } = require('./tools/insight-tools');
const { getFxRates } = require('./tools/finops-tools');

// ─── Provider Konfigürasyonu ──────────────────────────────────────────────────
// .env dosyasında AI_PROVIDER=ollama veya AI_PROVIDER=anthropic
const AI_PROVIDER  = process.env.AI_PROVIDER  || 'anthropic';
const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';

console.log(`[AI Agent] Provider: ${AI_PROVIDER}${AI_PROVIDER === 'ollama' ? ` | Model: ${OLLAMA_MODEL} | URL: ${OLLAMA_URL}` : ''}`);

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Sen bir IT Varlık Yönetimi (Asset Management) AI asistanısın. Kurumun bilgisayar, sunucu ve diğer IT ekipmanlarını yöneten akıllı bir sistemsin.

Yeteneklerin:
- Envanter sorgulama (marka, model, seri no, konum, kullanıcı bazlı)
- İstatistik ve raporlama (toplam varlık sayısı, marka dağılımı, durum analizi)
- Anomali tespiti (çevrimdışı cihazlar, eski donanımlar, düşük disk alanı)
- Donanım analizi (RAM, disk, CPU karşılaştırmaları)
- Cihaz yaşam döngüsü & audit log denetimi (durum geçmişi, zimmet, kayıp/depo çelişkileri, immutable log)
- Öneri ve uyarı üretimi

Kurallar:
- ZORUNLU: Tüm yanıtlar yalnızca Türkçe olmalı. İngilizce, İspanyolca veya başka dil YASAK. Teknik terimler (RAM, CPU, SSD, hostname vb.) olduğu gibi kalabilir.
- Yanıtları kısa, net ve eyleme geçirilebilir tut
- Sayısal verileri tablo veya madde işareti ile sun
- Kritik bulgular varsa vurgula
- ZORUNLU: Her zaman önce araçları çağır, yalnızca araçtan gelen gerçek veriyi kullan
- ZORUNLU: [Tahmin], [Bilinmiyor], [Model], [N/A] gibi placeholder ASLA kullanma; değer yoksa sadece "—" yaz
- ZORUNLU: hostname, model, seri numarası, RAM, disk gibi bilgiler araç sonucunda mevcutsa mutlaka yaz`;

// ─── Tool Tanımları (Anthropic formatı) ──────────────────────────────────────
const TOOLS = [
  {
    name: 'list_assets',
    description: 'Envanterden tüm varlıkları listele. Marka, durum veya konum bazlı filtrelenebilir.',
    input_schema: {
      type: 'object',
      properties: {
        filter_field: { type: 'string', description: 'Filtrelenecek alan adı (örn: brand, status, category)' },
        filter_value: { type: 'string', description: 'Filtre değeri' },
        page_size:    { type: 'number', description: 'Döndürülecek kayıt sayısı (varsayılan: 100)' },
      },
    },
  },
  {
    name: 'search_assets',
    description: 'Anahtar kelime ile tüm alanlarda varlık ara.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Arama terimi' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_stats',
    description: 'Envanter istatistiklerini getir: toplam sayı, marka dağılımı, kategori dağılımı, durum analizi, ortalama RAM/Disk.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_asset_by_serial',
    description: 'Seri numarasına göre belirli bir varlığı getir.',
    input_schema: {
      type: 'object',
      properties: {
        serial_number: { type: 'string', description: 'Cihazın seri numarası' },
      },
      required: ['serial_number'],
    },
  },
  {
    name: 'get_anomalies',
    description: 'Donanım anomalilerini tespit et: 8 GB altı RAM, 256 GB altı disk ve 30+ gün kesintisiz açık (yeniden başlatma gereken) cihazlar. Hazır listeler döner, hesaplama gerektirmez.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_offline_devices',
    description: 'Çevrimdışı (status=offline) ve uzun süredir görünmeyen (7+ gün) cihazları tespit et. Hazır liste döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_license_compliance',
    description: 'Lisans uyum sorunlarını tespit et: lisanssız yazılımlar, süresi dolmuş ve 30 gün içinde dolacak lisanslar. Hazır liste döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_shadow_it',
    description: 'Shadow IT tespiti: ağda aktif görünen ama resmi envanterde (MAC/IP bazlı) kaydı OLMAYAN kayıt dışı/şüpheli cihazları döner. Hazır liste döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_eol_os',
    description: 'İşletim sistemi yaşam sonu (EOL) tespiti: üretici güvenlik desteği BİTMİŞ (örn. Windows 10, Windows Server 2012, eski Ubuntu/Android) veya 180 gün içinde bitecek cihazları döner. Güvenlik riski içerir. Hazır liste döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_warranty',
    description: 'Donanım garanti takibi: garantisi bitmiş veya 60 gün içinde bitecek cihazları döner. Hazır liste döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_lifecycle_conflicts',
    description: 'Cihaz yaşam döngüsü çelişki/zafiyet denetimi: audit log durumu ile fiili (ağ) durum arasındaki tutarsızlıkları VE güvenlik ihlallerini döner. Örn: "Depoda" loglu ama ağda aktif; personelden alınmış ama depo girişi yok (kayıp şüphesi); kritik cihaz Kayıp/Belirsiz; kritik durum dijital onay (çift imza) olmadan değiştirilmiş (güvenlik ihlali). security_breaches ve integrity_ok alanları da döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_audit_log',
    description: 'Değiştirilemez (immutable) cihaz durum geçmişi audit log\'unu döner. Her kayıtta işlemi yapanın AD domain hesabı (UPN), IP/MAC adresi ve MFA doğrulama durumu gömülüdür. Belirli bir cihaz için serial_number veya hostname verilebilir; verilmezse en son olaylar döner.',
    input_schema: {
      type: 'object',
      properties: {
        serial_number: { type: 'string', description: 'Cihaz seri numarası (opsiyonel)' },
        hostname:      { type: 'string', description: 'Cihaz adı (opsiyonel)' },
        limit:         { type: 'number', description: 'Kayıt sayısı (varsayılan 50)' },
      },
    },
  },
  {
    name: 'get_network_scan',
    description: 'Canlı ağ keşfi (VLAN-segmentli, asenkron): (1) durumu Depoda/Kayıp/Belirsiz olan karantina cihazları ağda aktifse KRİTİK ihlal; (2) MAC adresi doğru olsa BİLE OS Agent şifreli el sıkışması (handshake) başarısızsa KLONLANMIŞ CİHAZ ŞÜPHESİ (spoofing). spoofing_count, quarantine_count, segment ve eşzamanlılık bilgisi döner.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_backup_status',
    description: 'WORM Hardened (değiştirilemez/silinemez) yedek deposunun durumunu döner: yerel log ile şifreli off-site yedeğin senkron olup olmadığı, bütünlük ve kurtarma gerekip gerekmediği. Yerel DB silinse/manipüle edilse bile yedek zinciri canlı kalır.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_risk_scores',
    description: 'Her cihaza EOL, garanti, çevrimdışı, donanım, lisans ve yaşam döngüsü/güvenlik sinyallerinden hesaplanan 0-100 risk skorunu döner (seviye: Kritik/Yüksek/Orta/Düşük + faktörler). Envanteri riske göre sıralı verir, dağılım ve ortalama içerir.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_renewal_forecast',
    description: 'Önümüzdeki 12 ayda garanti bitişi veya işletim sistemi EOL nedeniyle yenilenmesi gereken cihazları ve DÖVİZ ENDEKSLİ tahmini bütçeyi döner. Maliyet = distribütör USD fiyatı × anlık USD/TRY paritesi (kur değişince oto-güncellenir). Toplam TRY + USD, kullanılan kur (fx), çeyreklik dağılım ve gecikmiş cihazlar içerir.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_fx_rates',
    description: 'Anlık döviz paritesini döner (simüle distribütör/parite API): USD/TRY, EUR/TRY, trend ve zaman damgası. Bütçe öngörüsü bu kura göre hesaplanır.',
    input_schema: { type: 'object', properties: {} },
  },
];

// Ollama / OpenAI formatına dönüştür
const TOOLS_OPENAI = TOOLS.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ─── Tool Executor ────────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput, orgId) {
  switch (toolName) {
    case 'list_assets':
      return await getAllAssets({
        orgId,
        size: toolInput.page_size || 100,
        filterField: toolInput.filter_field,
        filterValue: toolInput.filter_value,
      });
    case 'search_assets':
      return await searchAssets({ orgId, query: toolInput.query });
    case 'get_stats':
      return await getStats(orgId);
    case 'get_asset_by_serial':
      return await getAssetBySerial({ orgId, serialNumber: toolInput.serial_number });
    case 'get_anomalies':
      return await detectAnomalies(orgId);
    case 'get_offline_devices':
      return await detectOfflineDevices(orgId);
    case 'get_license_compliance':
      return await detectLicenseCompliance(orgId);
    case 'get_shadow_it':
      return await detectShadowIT(orgId);
    case 'get_eol_os':
      return await detectEolOs(orgId);
    case 'get_warranty':
      return await detectWarranty(orgId);
    case 'get_lifecycle_conflicts':
      return await detectLifecycleConflicts(orgId);
    case 'get_audit_log':
      return (toolInput.serial_number || toolInput.hostname)
        ? getDeviceLog(toolInput.serial_number || toolInput.hostname)
        : getLog({ limit: toolInput.limit || 50 });
    case 'get_network_scan':
      return await scanNetwork(orgId);
    case 'get_backup_status':
      return auditBackupStatus();
    case 'get_risk_scores':
      return await computeRiskScores(orgId);
    case 'get_renewal_forecast':
      return await computeRenewalForecast(orgId);
    case 'get_fx_rates':
      return getFxRates();
    default:
      throw new Error(`Bilinmeyen araç: ${toolName}`);
  }
}

// ─── Anthropic Provider ───────────────────────────────────────────────────────
async function chatAnthropic(userMessage, conversationHistory, orgId) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages = [...conversationHistory, { role: 'user', content: userMessage }];

  let response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
  });

  const assistantMessages = [{ role: 'assistant', content: response.content }];

  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      let toolResult, isError = false;
      try {
        toolResult = await executeTool(toolUse.name, toolUse.input, orgId);
      } catch (err) {
        toolResult = { error: err.message };
        isError = true;
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(toolResult),
        is_error: isError,
      });
    }

    assistantMessages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: [...messages, ...assistantMessages],
    });

    assistantMessages.push({ role: 'assistant', content: response.content });
  }

  const textContent = response.content.find(b => b.type === 'text');
  const replyText = textContent ? textContent.text : 'Yanıt alınamadı.';

  return {
    reply: replyText,
    updatedHistory: [
      ...conversationHistory,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: replyText },
    ],
  };
}

// ─── Ollama Provider ──────────────────────────────────────────────────────────
async function chatOllama(userMessage, conversationHistory, orgId) {
  // Mesaj geçmişini Ollama formatına dönüştür
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...conversationHistory.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    })),
    { role: 'user', content: userMessage },
  ];

  const callOllama = async (msgs) => {
    const res = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages: msgs,
      tools: TOOLS_OPENAI,
      stream: false,
    }, { timeout: 300000 }); // 5 dakika timeout
    return res.data;
  };

  let data = await callOllama(messages);
  let iterations = 0;
  const MAX_ITERATIONS = 5;

  // Tool use döngüsü
  while (data.message?.tool_calls?.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`[Ollama] Tool çağrısı #${iterations}: ${data.message.tool_calls.map(t => t.function.name).join(', ')}`);

    // Asistan mesajını geçmişe ekle
    messages.push(data.message);

    // Her tool'u çalıştır
    for (const toolCall of data.message.tool_calls) {
      const toolName = toolCall.function.name;
      const rawArgs  = toolCall.function.arguments;
      const toolInput = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs || {});

      let toolResult;
      try {
        toolResult = await executeTool(toolName, toolInput, orgId);
        console.log(`[Ollama] Tool sonucu: ${toolName} → ${JSON.stringify(toolResult).substring(0, 100)}...`);
      } catch (err) {
        toolResult = { error: err.message };
        console.error(`[Ollama] Tool hatası: ${toolName} → ${err.message}`);
      }

      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
      });
    }

    // Tekrar Ollama'yı çağır
    data = await callOllama(messages);
  }

  const replyText = data.message?.content || 'Yanıt alınamadı.';

  return {
    reply: replyText,
    updatedHistory: [
      ...conversationHistory,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: replyText },
    ],
  };
}

// ─── Ana chat fonksiyonu ──────────────────────────────────────────────────────
async function chat(userMessage, conversationHistory = [], orgId = null) {
  if (AI_PROVIDER === 'ollama') {
    return chatOllama(userMessage, conversationHistory, orgId);
  }
  return chatAnthropic(userMessage, conversationHistory, orgId);
}

module.exports = { chat };
