# ── Build stage ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma engines
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm install
RUN npx prisma generate

COPY . .
RUN npm run build

# ── Runtime stage ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 4000

# Apply migrations (or db push for first run) then start the API
CMD ["sh", "-c", "npx prisma migrate deploy || npx prisma db push; node dist/main.js"]
