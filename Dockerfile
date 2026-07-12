# ── AssetMan — Node.js 20 Alpine (küçük, güvenli) ─────────────────────────────
# Multi-stage: build katmanında sadece dependency install; runtime katmanı ince.
FROM node:20-alpine AS deps
WORKDIR /app

# package.json + lock: cache verimli
COPY package.json package-lock.json* ./
# Production dependency'leri kur (native module gerekirse build deps ekle)
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev \
    && apk del python3 make g++

# ── Runtime katmanı ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Güvenlik: root DEĞİL, ayrı kullanıcı
RUN addgroup -S assetman && adduser -S -G assetman assetman

# Runtime dosyaları
COPY --chown=assetman:assetman --from=deps /app/node_modules ./node_modules
COPY --chown=assetman:assetman . .

# Volume noktaları (docker-compose'da mount edilir)
# /app/data     → users.json, lifecycle-log.json, os-agents.json vs.
# /app/data/worm-repository → WORM şifreli halkalar (ayrı volume olabilir)
VOLUME ["/app/data"]

USER assetman

ENV NODE_ENV=production PORT=3000
EXPOSE 3000

# Healthcheck: /api/health 200 dönmüyorsa restart
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
