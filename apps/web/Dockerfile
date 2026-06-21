# ── Build stage ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# API URL must be available at build time for Next.js public env inlining
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# ── Runtime stage (standalone output) ──
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
