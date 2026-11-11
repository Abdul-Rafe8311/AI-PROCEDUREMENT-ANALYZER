<!-- bmad:context -->
<!-- Verified 2026-11-11 against 1cab7e6. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## AI Procurement Analyzer

Compares supplier quotations and produces the TA form, report and analytics dashboard. Live product: `apps/web` (Next.js 15, Claude, Supabase). `apps/api` (NestJS, Render) only serves deep-document RAG. Solo project, commits go straight to `main`.

## Policy

- Never edit `.env*` (only `.env.example`) or `workflow.json` (Fastn workflow).
- Never edit an existing file in `apps/web/supabase/migrations/`; add the next numbered file instead.
- Never use Najran Cement's real supplier data in demos, videos, screenshots or test fixtures; invent fake suppliers.
- Never print, log or commit a secret (Anthropic key, Supabase service-role key, Fastn keys).
- Never call the production `ANTHROPIC_API_KEY` from `apps/web/.env.local` for testing; verify with `npx tsc --noEmit` and static checks unless given a separate non-prod key.
- Never reintroduce Groq; the pipeline is Claude-only (removed 2c3afa3).

## Where things are

- Scoring, risks, recommendation: `apps/web/src/lib/analysis-engine.ts`. Put scoring changes here, never in `apps/api` (its `recommendation.service.ts` is not wired to results).
- LLM extraction: `apps/web/src/lib/extraction-server.ts`.
- Approval/TA form PDF: `apps/web/src/lib/approval-form-acroform.ts`.
- Web routes: `apps/web/src/app/api/`. Migrations: `apps/web/supabase/migrations/`.

## Running and verifying

- Use Node 22; Node 25 breaks `next dev`.
- Quote the project path in shell commands; the directory name ends with a space (`AI PROCEDUREMENT `).
- `README.md` describes OpenAI and NestJS as the main stack; it is stale. Trust the code.
- There is no CI. Run `npm test` and `npx tsc --noEmit` in `apps/web` before committing.
- Local dev has no Supabase anon key, so it runs in demo mode; RAG and persistence only work on the deployment.
- Local `next dev` crashes on Node 25 (`require` in `apps/web/tailwind.config.ts:72`). If stuck on Node 25, temporarily swap it for `import tailwindcssAnimate from 'tailwindcss-animate'` and `plugins: [tailwindcssAnimate]`, then `git checkout -- apps/web/tailwind.config.ts` before committing.

## Conventions that differ from defaults

- TA form supplier columns are `analysis.quotations`, in order. To add columns, emit more `LlmSupplier` objects in `normalizeSuppliers` and `quotationsFromLlmSuppliers`; do not touch the renderers.

## Known pitfalls

- Verify PDFs by rendering them: `qlmanage -t -s 1600 -o <dir> file.pdf` (page 1 only). Swift PDFKit and Core Graphics renders show AcroForm fields wrongly. Test with a sample PDF before saying a form works.

<!-- /bmad:context -->
