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

## Getting started

Requirements: Node ≥ 22.13 and a PostgreSQL 15+ database with the `pgvector` extension — a Supabase
project (cloud or local) provides both, plus Auth and Storage.

```bash
npm ci
cp .env.example .env.local        # fill in the Supabase URL/keys and DATABASE_URL
npm run db:migrate                # schema, constraints, row-level security
npm run curriculum:load           # the syllabus: 5 grades · 20 topics · 142 sub-topics · 444 objectives
npm run curriculum:embed          # retrieval embeddings (offline `local-hash` by default)
npm run curriculum:audit -- --snapshot --require-embeddings
npm run dev
```

The first administrator signs up like a parent, then is promoted out-of-band (roles can never be
chosen from the browser): `npm run admin:promote -- you@example.com`.

## Commands

| Command                       | Purpose                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                 | Start the web app                                                                 |
| `npm run check`               | Lint + typecheck + tests + production build (the CI gate)                         |
| `npm run curriculum:extract`  | PDF → validated, provenance-rich curriculum snapshot (JSON)                       |
| `npm run curriculum:validate` | Validate a snapshot file (fails loudly on any invalid relationship)               |
| `npm run curriculum:load`     | Load the snapshot into Postgres: atomic, repeatable, refuses silent changes       |
| `npm run curriculum:embed`    | Build RAG chunk embeddings into pgvector (idempotent, resumable)                  |
| `npm run curriculum:audit`    | Audit the curriculum **as stored in the database** (orphans, provenance, chunks…) |
| `npm run questions:coverage`  | Which of the 444 objectives have generated practice (and why the rest do not)     |
| `npm run questions:sample`    | Print sample questions for objectives, e.g. `-- G5-MEA-AREA-002 --difficulty=3`   |
| `npm run questions:seed`      | Fill the question bank from the templates (idempotent; supplemental, unverified)  |
| `npm run db:migrate`          | Apply SQL migrations to `DATABASE_URL`                                            |
| `npm run admin:promote`       | Make an existing parent account an administrator (needs database access)          |

## Testing

| Layer                 | Runs against                                                    | Enabled by                                                     |
| --------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit + pipeline tests | the real PDF and pure code                                      | always (`npm test`)                                            |
| Database tests        | real PostgreSQL 16 + pgvector, every migration, RLS, the loader | `TEST_DATABASE_URL` (superuser URL; CI sets it)                |
| API integration tests | a running Supabase stack: Auth (GoTrue) **and** PostgREST       | `INTEGRATION_SUPABASE_URL`, `…_ANON_KEY`, `…_SERVICE_ROLE_KEY` |

The database tests use a small shim for `auth.*` so they run on vanilla Postgres. The integration
tests exercise exactly what a browser or a hostile client can reach — sign-up, learner provisioning,
what each role can read or write through the API, the function allow-list — and exist because the
shim cannot reproduce how Supabase Auth really behaves (for example it creates a user and merges
`app_metadata` in two steps; migration 0012 exists because of that).

```bash
supabase start && supabase db reset       # applies supabase/migrations
npm run curriculum:load                   # DATABASE_URL = the local DB URL
INTEGRATION_SUPABASE_URL=<API URL> INTEGRATION_SUPABASE_ANON_KEY=<anon key> \
INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=<service_role key> npx vitest run tests/integration
```

Email confirmation must be off for these tests (it is in `supabase/config.toml`).

## Practice questions, marking and mastery

Practice is generated, checked and marked by code — a language model is never the authority on
whether an answer is right.

```
objective + difficulty + seed ─► template ─► question + answer key + hints + predicted wrong answers
   ─► verified (marks its own answer right, each predicted wrong answer wrong, hints leak nothing)
   ─► question bank (`questions` for the screen, `question_keys` for the server only)
   ─► learner answers ─► deterministic marking ─► misconception diagnosis ─► mastery update
```

- **Templates** (`src/lib/questions/templates`, 127 of them) are scoped to the _Content_ column of the
  syllabus row they serve: fraction denominators, decimal places, Roman numeral ranges, sums, products,
  money limits, polygon sizes and the rest are the grade's own, and `tests/questions/scope.test.ts`
  states those limits independently of the templates so a template that drifts outside them fails.
  The same seed always gives the same question. 437 of the 444 objectives have templates; the other
  seven are practical tasks (draw or build solids, draw lines of symmetry) or facts about Zimbabwean
  currency that need verified source content, and `tests/questions/coverage.test.ts` pins each with its
  reason. For some objectives a level has only a few different questions (converting hours to days);
  the tutor then repeats the one the child met longest ago.
- **Marking** (`src/lib/marking`) uses exact rational arithmetic: decimal commas, spaces in numbers,
  words, percentages, mixed numbers, units and their dimensions, ordered lists, matching, multi-part
  answers. The stored detail of an attempt never contains the expected answer.
- **Misconceptions** (`src/lib/misconceptions`) are structured codes (`PLACE_VALUE_CONFUSION`,
  `AREA_VS_PERIMETER`, …) predicted per question from its wrong answers, never guessed from free text.
- **Mastery** (`src/lib/mastery`) is per objective: a Bayesian knowledge-tracing update with soft
  evidence (hints and retries count for less), difficulty-aware slip and guess rates, gates for
  `MASTERED`, and spaced `REVIEW`. It is a pure function; the service only stores its result.
- **Labelling.** Generated questions are stored as `SUPPLEMENTAL` / `UNVERIFIED` practice and shown as
  "ZimTutor practice question (not part of the syllabus)"; the database function that stores them
  refuses any `OFFICIAL_*` label. A teacher can mark a question reviewed.
- **Assumptions the syllabus does not settle** are stated in the question itself rather than hidden:
  the form of dates in "SI notation" (year-month-day), the unit _are_ (100 m²), and the exchange rates
  in exchange-rate problems (made-up, labelled as such).

## The curriculum data model

The syllabus prints, for every sub-topic, a table of rows: **Objectives · Content · Suggested notes
and activities · Suggested resources**. The four cells of a row are parallel bullet lists — the
printed document does **not** pair an objective with a particular content bullet. The model
therefore keeps the printed row as an entity instead of inventing relationships:

```
curricula → grades (3–7)
         → subjects (Mathematics)
              └─ topics            per grade: Number · Operations · Measures · Relationships
                  └─ subtopics
                      └─ competency_rows        one printed row of the competency matrix
                          ├─ learning_objectives     one bullet of OBJECTIVES — the unit of mastery
                          ├─ curriculum_content      bullets of CONTENT
                          ├─ curriculum_activities   bullets of SUGGESTED NOTES AND ACTIVITIES
                          └─ curriculum_resources    bullets of SUGGESTED RESOURCES
```

`v_objective_content`, `v_objective_activities` and `v_objective_resources` give the per-objective
view (every objective of a row shares that row's bullets) without losing the original structure.

- **Stable ids** — `G5-NUM-PROPER-FRACTIONS-004` is derived only from grade, topic, sub-topic wording and
  order, so re-ingesting the same document reproduces them and learner progress stays attached. They
  are _application_ identifiers, never presented as Ministry identifiers.
- **Provenance on every record** — `source_document_id`, `source_page`, printed `source_page_label`,
  verbatim `source_text`, `source_type = OFFICIAL_CURRICULUM`, `verification_status =
VERIFIED_FROM_SOURCE`. Database `CHECK` constraints forbid anything else in the official tables, and
  forbid AI-generated content from ever being `VERIFIED_FROM_SOURCE`.
- **Assessment (syllabus §9)** is data too: the 20 % school-based continuous assessment / 80 %
  summative split, the Grade 7 paper structures, the specification grid, the 11 assessment objectives
  and the six project stages.

## Curriculum ingestion

```
PDF ─► tagged structure tree + text geometry ─► sub-topics / rows / bullets ─► reviewed overrides
   ─► deterministic JSON snapshot ─► validation ─► atomic DB load ─► retrieval chunks ─► embeddings
```

1. **Extract** (`curriculum:extract`) reads the PDF's tagged structure (tables, lists) with pdf.js and
   assigns text to columns by geometry. Every character of the matrix pages is accounted for in a
   ledger; extraction fails if anything is dropped or ambiguous. The output
   (`curriculum/snapshots/…json`) contains no timestamps, so re-running on the same PDF is
   byte-identical (tested).
2. **Overrides** (`curriculum/overrides/…json`) are the only way to change extracted text: Word
   equations and stacked fractions are flattened by the PDF (`3654¹` for 365 ¼). Each fix names the page,
   the exact text it replaces and how a person verified it against the rendered page; stale fixes fail
   the run. Printed mistakes in the syllabus are recorded as _errata_ and **not** silently corrected.
3. **Validate** (`curriculum:validate`) checks missing grades/topics/sub-topics, orphaned records,
   duplicate ids, missing source pages, wrong grade/topic relationships, ordinal gaps and the
   assessment arithmetic.
4. **Load** (`curriculum:load`) — one transaction; upserts by stable id; then runs the database audit
   and **rolls everything back** if it finds an error.
5. **Embed** (`curriculum:embed`) — one chunk per objective (objective + its row's content, activities
   and resources) plus scope-and-sequence and assessment/preamble chunks, each carrying grade,
   subject, topic, sub-topic, objective id and page, so retrieval filters on metadata _before_ ranking.

### Re-ingesting safely

Learner progress is keyed by objective id, so `curriculum:load` **refuses** (exit code 2) to:
reword an existing objective, move one, remove one, revive a retired one, or accept a different PDF
under the same document id — and prints exactly what would change. After reviewing, re-run with
`--accept-changes`. Objectives that leave the syllabus are **retired, never deleted** (`retired_at`),
along with their questions; mastery history survives. `--dry-run` shows the plan without writing.

### How the extraction was verified

Beyond unit tests (see `tests/ingestion/`), the extraction was checked against independent
evidence: poppler's `pdftotext` and the snapshot agree on every character of the matrix pages
(65 996 = 65 996, both directions); an independent implementation using different libraries
(pikepdf + pdfplumber) reproduces all 444 objectives per grade/topic; and pages were compared visually.

## Repository layout

```
curriculum/source/      the official PDF + manifest (identity + checksum)
curriculum/overrides/   reviewed, audited corrections (e.g. maths notation the PDF flattens)
curriculum/snapshots/   generated curriculum snapshot (reviewable in diffs)
supabase/migrations/    SQL schema, RLS policies
src/ingestion/          PDF → snapshot → database pipeline (pure, unit-tested stages)
src/lib/marking/        deterministic answer marking
src/lib/mastery/        per-objective mastery engine and its persistence
src/lib/misconceptions/ misconception registry and diagnosis
src/lib/questions/      question templates, generator, verifier, question bank
src/lib/                other domain logic (auth, db helpers, ai/embeddings, …)
src/app/                Next.js routes
scripts/                CLI entry points
tests/                  unit + database integration tests
```

See `.env.example` for configuration.
