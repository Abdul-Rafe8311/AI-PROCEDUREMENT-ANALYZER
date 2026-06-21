# API Reference — AI Procurement Analyzer

Base URL: `http://localhost:4000/api`
Interactive docs (Swagger): `http://localhost:4000/api/docs`

All endpoints except those marked **Public** require an `Authorization: Bearer <accessToken>` header.

Standard error shape:

```json
{
  "statusCode": 400,
  "error": "BadRequest",
  "message": "validation message(s)",
  "path": "/api/...",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Paginated list shape:

```json
{
  "data": [ /* items */ ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

## Auth

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/auth/register` | Public | Create account → returns `{ user, accessToken, refreshToken }` |
| POST | `/auth/login` | Public | Authenticate → returns tokens |
| POST | `/auth/refresh` | Public | Body `{ refreshToken }` → new token pair |
| POST | `/auth/forgot-password` | Public | Body `{ email }` → issues reset token (returned in dev) |
| POST | `/auth/reset-password` | Public | Body `{ token, password }` |
| POST | `/auth/logout` | Auth | Revokes all refresh tokens |

**Register body**
```json
{ "email": "m@co.com", "password": "StrongP@ss123", "firstName": "Jane", "lastName": "Doe", "role": "PROCUREMENT_MANAGER" }
```

---

## Users

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/users/me` | Auth | Current user profile |
| GET | `/users` | Admin | List all users |

---

## Suppliers

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/suppliers` | Auth | Create supplier |
| GET | `/suppliers?page=&limit=&search=` | Auth | Paginated list |
| GET | `/suppliers/:id` | Auth | Supplier with ratings + quotations |
| GET | `/suppliers/:id/history` | Auth | Ratings + quotation participation |
| PATCH | `/suppliers/:id` | Auth | Update supplier |
| POST | `/suppliers/:id/ratings` | Auth | Body `{ score: 1-5, comment? }` → recomputes reliability |
| DELETE | `/suppliers/:id` | Admin | Delete supplier |

**Create body**
```json
{ "companyName": "Acme Steel", "contactPerson": "John", "email": "s@acme.com", "phone": "+1...", "country": "USA", "reliabilityScore": 75, "notes": "..." }
```

---

## Procurement Requests

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/requests` | Auth | Create request |
| GET | `/requests?page=&limit=&search=` | Auth | List (managers see own; admins see all) |
| GET | `/requests/:id` | Auth | Request with quotations, items, recommendation, reports |
| PATCH | `/requests/:id` | Auth | Update (incl. `status`) |
| POST | `/requests/:id/award/:quotationId` | Auth | Award the request to a quotation |
| DELETE | `/requests/:id` | Auth | Delete request |

**Create body**
```json
{ "title": "Steel beams", "description": "...", "requiredItems": "I-Beam W12x26\nSteel plate", "quantity": 500, "requiredDeliveryDate": "2026-09-01T00:00:00.000Z", "budget": 250000, "currency": "USD" }
```

---

## Quotations

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/requests/:requestId/quotations?supplierId=` | Auth | **Multipart** upload (`files`, up to 10). Triggers async AI extraction |
| GET | `/requests/:requestId/quotations` | Auth | List quotations for a request |
| GET | `/quotations/:id` | Auth | Single quotation + items |
| GET | `/quotations/:id/download` | Auth | Temporary download URL |
| POST | `/quotations/:id/reprocess` | Auth | Re-run AI extraction |
| DELETE | `/quotations/:id` | Auth | Delete quotation |

Allowed file types: `application/pdf`, `.docx`, `.doc`, `image/jpeg`, `image/png` (max 15 MB each).

Example:
```bash
curl -X POST http://localhost:4000/api/requests/<id>/quotations \
  -H "Authorization: Bearer <token>" \
  -F "files=@quote1.pdf" -F "files=@quote2.docx"
```

---

## Comparison, Recommendation & Chat

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/requests/:requestId/comparison` | Auth | Comparison table + risk + recommendation (persists risk & recommendation) |
| GET | `/requests/:requestId/recommendation` | Auth | AI recommendation only |
| POST | `/requests/:requestId/chat` | Auth | Body `{ question }` → RAG answer `{ answer, sources[] }` |

**Comparison response (abridged)**
```json
{
  "request": { "id": "...", "title": "...", "budget": 280000, "currency": "USD" },
  "rows": [
    {
      "quotationId": "...", "supplierName": "Acme Steel", "totalPrice": 252000,
      "deliveryDays": 21, "reliabilityScore": 88, "paymentTerms": "Net 30",
      "riskLevel": "LOW", "warnings": [], "isLowestCost": false, "isRecommended": true
    }
  ],
  "recommendation": { "recommendedQuotationId": "...", "summary": "...", "highlights": { "bullets": ["..."] } },
  "summary": { "quotationCount": 4, "lowestCost": 198000, "fastestDeliveryDays": 14, "highRiskCount": 1 }
}
```

---

## Reports

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/requests/:requestId/reports` | Auth | Generate PDF report → `{ ...report, downloadUrl }` |
| GET | `/requests/:requestId/reports` | Auth | List reports |
| GET | `/reports/:id/download` | Auth | Temporary download URL |

---

## Analytics

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/analytics/overview` | Auth | KPIs, monthly spend, volume, top suppliers |

---

## Audit

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/audit-logs?limit=` | Admin | Recent audit log entries |

---

## Health

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/health` | Public | `{ status: "ok", timestamp }` |
