# ZimTutor

**A Zimbabwe curriculum-grounded adaptive Mathematics learning platform** for Grades 3–7 — _not_ a generic
AI chatbot with a Zimbabwean interface.

The authoritative curriculum source is the **Revised Junior Mathematics Syllabus MoPSE 2024–2030**
(Ministry of Primary and Secondary Education, Zimbabwe). The core loop every feature must reinforce:

```
Official Curriculum → Learning Objective → Explanation → Guided Practice → Assessment
  → Misconception Detection → Mastery Update → Adaptive Recommendation → Next Objective
```

## Principles (these are enforced in code, not just documented)

1. **The syllabus is the source of truth.** Every curriculum record keeps its provenance
   (document, page, verbatim source text, year, grade, topic, sub-topic). Nothing imported from the
   PDF is hand-typed into application code.
2. **Never mix content categories silently.** Content is labelled `OFFICIAL_CURRICULUM`,
   `OFFICIAL_ASSESSMENT`, `SUPPLEMENTAL`, `AI_GENERATED` or `UNVERIFIED`. AI output is never
   `OFFICIAL_*`.
3. **Mastery is tracked per learning objective** (the smallest unit in the syllabus), calculated by
   deterministic code. An LLM may explain and analyse; it never calculates mastery or decides that
   mathematics is correct.
4. **Marking is deterministic** (exact rational arithmetic, no `eval`). The LLM may assist with
   feedback on written reasoning but cannot award correctness.
5. **Fail loudly.** Ingestion that yields invalid curriculum relationships stops with an error.
6. **Child safety by design.** Minimal personal data, row-level security everywhere, no location
   collection, no off-platform contact, no advertising behaviour.
7. **Internal ZimTutor scores are never presented as official ZIMSEC results.**

## Stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS · Supabase (Postgres, Auth, Storage,
pgvector) · Vercel · Sentry · PostHog · provider-abstracted LLM layer.

## Commands

| Command                      | Purpose                                                          |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                | Start the web app                                                |
| `npm run check`              | Lint + typecheck + tests + production build (the CI gate)        |
| `npm run curriculum:extract` | PDF → validated, provenance-rich curriculum snapshot (JSON)      |
| `npm run curriculum:validate`| Validate a snapshot (fails loudly on any invalid relationship)   |
| `npm run curriculum:load`    | Load a validated snapshot into Postgres (atomic, stable IDs)     |
| `npm run curriculum:embed`   | Build RAG chunk embeddings into pgvector                         |
| `npm run db:migrate`         | Apply SQL migrations to `DATABASE_URL`                           |

## Repository layout

```
curriculum/source/      the official PDF + manifest (identity + checksum)
curriculum/overrides/   reviewed, audited corrections (e.g. maths notation the PDF flattens)
curriculum/snapshots/   generated curriculum snapshot (reviewable in diffs)
supabase/migrations/    SQL schema, RLS policies
src/ingestion/          PDF → snapshot pipeline (pure, unit-tested stages)
src/lib/                domain logic (mastery, marking, tutor, adaptive, rag, ai, ...)
src/app/                Next.js routes
scripts/                CLI entry points
tests/                  unit + database integration tests
```

See `.env.example` for configuration.
