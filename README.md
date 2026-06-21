# AI Procurement Analyzer

A production-ready, full-stack SaaS application that helps procurement managers **compare supplier quotations automatically, analyze costs, detect risks, and generate professional procurement reports** — powered by AI.

Upload supplier quotations (PDF / DOCX / images), and the platform extracts structured pricing data, builds a comparison dashboard, flags risks, recommends the best supplier, and lets you chat with your quotations using Retrieval-Augmented Generation (RAG).

---

## ✨ Features

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Authentication** | Register, login, forgot/reset password, JWT access + refresh tokens, role-based access control (Admin / Procurement Manager) |
| 2 | **Supplier Management** | CRUD, supplier profiles, reliability scoring, star ratings, supplier history |
| 3 | **Procurement Requests** | Create requests with items, quantity, delivery date, budget |
| 4 | **Quotation Upload** | Multi-file upload (PDF, DOCX, JPG, PNG) to S3-compatible storage |
| 5 | **AI Extraction Engine** | Extracts supplier, items, unit/total price, delivery time, payment terms, currency → PostgreSQL |
| 6 | **Comparison Dashboard** | Sortable/filterable table: cost, delivery, reliability, payment terms |
| 7 | **AI Recommendation** | "Supplier A is lowest cost", "best balance of cost/delivery/reliability", etc. |
| 8 | **Risk Detection** | Missing dates/items, pricing outliers, incomplete quotations, budget overruns |
| 9 | **Report Generator** | One-click professional PDF report (summary, comparison, cost & risk analysis, recommendation) |
| 10 | **Analytics Dashboard** | Monthly spend, top suppliers, cost savings, volume, avg. response time |
| 11 | **AI Chat (RAG)** | Ask natural-language questions grounded in your uploaded quotations |

---

## 🧱 Tech Stack

- **Frontend:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · shadcn/ui-style components · TanStack Query · Recharts
- **Backend:** NestJS · TypeScript · Clean modular architecture (service + repository pattern)
- **Database:** PostgreSQL · Prisma ORM
- **Auth:** JWT (access + refresh) · bcrypt · RBAC guards
- **Storage:** AWS S3-compatible (MinIO out of the box)
- **AI:** OpenAI API (extraction, recommendation, embeddings/RAG) with graceful heuristic fallbacks
- **Documents:** `pdf-parse` (PDF), `mammoth` (DOCX), `tesseract.js` (image OCR), `pdfkit` (report PDFs)
- **Security:** Helmet, global validation/whitelisting, rate limiting (Throttler), secure file-type filtering
- **Deployment:** Docker + Docker Compose

---

## 📁 Project Structure

```
.
├── docker-compose.yml          # Postgres, MinIO, API, Web
├── .env.example                # copy to .env
├── docs/
│   └── API.md                  # full REST API reference
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # complete data model
│   │   │   └── seed.ts         # demo users, suppliers, requests, quotations
│   │   └── src/
│   │       ├── common/         # guards, decorators, filters, DTOs (RBAC, rate limiting)
│   │       ├── prisma/         # PrismaService (global)
│   │       ├── auth/           # register/login/forgot/reset, JWT strategy
│   │       ├── users/          # repository + service + controller
│   │       ├── suppliers/      # CRUD + ratings + history
│   │       ├── procurement/    # procurement requests + award
│   │       ├── quotations/     # upload + AI processing pipeline
│   │       ├── storage/        # S3 wrapper
│   │       ├── ai/             # OpenAI, parser, extraction, risk, recommendation, RAG chat
│   │       ├── comparison/     # comparison dashboard + chat endpoints
│   │       ├── reports/        # PDF report generation
│   │       ├── analytics/      # KPIs + charts data
│   │       └── audit/          # audit logging (global)
│   └── web/                    # Next.js 15 frontend
│       └── src/
│           ├── app/(auth)/     # login, register, forgot-password
│           ├── app/(dashboard)/# dashboard, suppliers, requests, requests/[id], analytics
│           ├── components/     # ui/ (shadcn-style) + feature components
│           └── lib/            # api client, auth store, types, utils
```

---

## 🚀 Quick Start (Docker — recommended)

> Requires Docker & Docker Compose.

```bash
# 1. Configure environment
cp .env.example .env
# (optional) add your OPENAI_API_KEY to .env to enable full AI features

# 2. Build & start everything (Postgres, MinIO, API, Web)
docker compose up --build

# 3. Seed demo data (in a second terminal, after the API is healthy)
docker compose exec api npm run db:seed
```

Then open:

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| API | http://localhost:4000/api |
| Swagger docs | http://localhost:4000/api/docs |
| MinIO console | http://localhost:9001 (minioadmin / minioadmin) |

**Demo logins** (password `Password123!`):
- `admin@procurement.ai` — Admin
- `manager@procurement.ai` — Procurement Manager

---

## 🛠️ Local Development (without Docker)

### Prerequisites
- Node.js 20+ (tested on 22)
- A running PostgreSQL instance
- (optional) MinIO or AWS S3 for file uploads
- (optional) OpenAI API key

### 1. Backend

```bash
cd apps/api
cp ../../.env.example .env      # adjust DATABASE_URL to your local Postgres
npm install
npx prisma generate
npx prisma db push             # or: npx prisma migrate dev
npm run db:seed
npm run start:dev              # http://localhost:4000/api
```

### 2. Frontend

```bash
cd apps/web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
npm run dev                    # http://localhost:3000
```

---

## 🤖 AI Behavior & Fallbacks

The app is fully functional **with or without** an OpenAI key:

- **With `OPENAI_API_KEY`:** GPT-powered structured extraction, natural-language recommendations, and RAG chat with embeddings.
- **Without a key:** a regex/heuristic extractor, a deterministic weighted recommendation engine (cost 45% / delivery 30% / reliability 25%), and keyword-based chat retrieval. Risk detection is **always rule-based** and works regardless.

This keeps the comparison dashboard, reports, and analytics meaningful in any environment (and makes the seed data instantly explorable).

---

## 🔐 Security

- **Input validation:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + type transformation.
- **SQL injection:** all DB access via Prisma (parameterized queries).
- **AuthN/Z:** JWT access/refresh tokens; refresh tokens hashed & revocable; global `JwtAuthGuard` + `RolesGuard`.
- **Rate limiting:** `@nestjs/throttler` (configurable via `RATE_LIMIT_*`).
- **Secure uploads:** MIME allow-list (PDF/DOCX/JPG/PNG), 15 MB size cap, in-memory buffering, randomized object keys.
- **Headers:** Helmet.
- **Audit trail:** every mutating action recorded in `audit_logs` (admin-viewable).

---

## 🗄️ Database Schema

See [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma). Models:

`User` · `RefreshToken` · `Supplier` · `SupplierRating` · `ProcurementRequest` · `Quotation` · `QuotationItem` · `QuotationEmbedding` · `Recommendation` · `Report` · `AuditLog`

---

## 📚 API Documentation

- Interactive: **Swagger UI** at `/api/docs`
- Reference: [`docs/API.md`](docs/API.md)

---

## 🧪 Useful Commands

```bash
# Backend
cd apps/api
npm run build            # compile
npm run prisma:migrate   # create a migration
npm run db:seed          # seed demo data
npm run start:dev        # watch mode

# Frontend
cd apps/web
npm run build
npm run dev
```

---

## 📝 License

MIT — provided as a reference implementation.

# AI-PROCEDUREMENT-ANALYZER
