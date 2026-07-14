# ── Build stage ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma engines
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate

# Toolchain to bundle the embedding model at build time (uint8 quantization).
# Cached across source changes. Discarded — the runtime stage stays slim.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends curl python3 python3-pip libgomp1 \
  && python3 -m pip install --break-system-packages --no-cache-dir onnx onnxruntime \
  && rm -rf /var/lib/apt/lists/*

COPY . .
# Build and fail loudly if the compiled entrypoint wasn't produced.
RUN npm run build && test -f dist/main.js

# Fetch (Qdrant GCS, not huggingface.co) + quantize the embedding model INTO the
# image so deep-search makes ZERO network calls at runtime. Fails loudly.
RUN sh scripts/prepare-embedding-model.sh ./models \
  && test -f models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx

# ── Runtime stage ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
# The pre-quantized embedding model (~22 MB) — loaded from here at runtime, no network.
COPY --from=builder /app/models ./models
ENV RAG_MODEL_DIR=/app/models

EXPOSE 4000

# Apply committed migrations (non-destructive, idempotent) then start the API.
# No db push — migrations are versioned and safe to run on every deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
