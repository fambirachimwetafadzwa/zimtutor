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

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS · Supabase (Postgres, Auth, pgvector) ·
Vercel · provider-abstracted LLM layer · optional Sentry and PostHog, sent from the server only,
scrubbed first and **off unless an operator turns them on**.

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
| `npm run e2e`                 | Browser tests (Playwright, desktop + phone) against a running production build    |
| `npm run db:migrate`          | Apply SQL migrations to `DATABASE_URL`                                            |
| `npm run admin:promote`       | Make an existing parent account an administrator (needs database access)          |

## Testing

| Layer                 | Runs against                                                    | Enabled by                                                     |
| --------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit + pipeline tests | the real PDF and pure code                                      | always (`npm test`)                                            |
| Database tests        | real PostgreSQL 16 + pgvector, every migration, RLS, the loader | `TEST_DATABASE_URL` (superuser URL; CI sets it)                |
| API integration tests | a running Supabase stack: Auth (GoTrue) **and** PostgREST       | `INTEGRATION_SUPABASE_URL`, `…_ANON_KEY`, `…_SERVICE_ROLE_KEY` |
| Browser tests         | a production build, in desktop and phone-sized Chromium         | `E2E_BASE_URL` + the three above (+ `E2E_CLIENT_IP_HEADER`)    |

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

The **browser tests** (`tests/e2e`) sign up their own parents, learners and administrator through the real
screens and work like a child, a parent and an administrator would: a lesson with a wrong try and a
hint, a question with a phone number in it (which is never kept), a practice paper written over two
visits, a flagged message reviewed, an account deleted. They run on a desktop and a Pixel 7-sized
Chromium, and fail on any Content Security Policy refusal or hydration error. They need the app built
and started with the same Supabase settings, plus a header only the tests send for the visitor's
address (Next.js fills in `x-forwarded-for` itself, so it cannot be used):

```bash
npm run build && CLIENT_IP_HEADER=x-e2e-client-address npm start &
E2E_BASE_URL=http://localhost:3000 E2E_CLIENT_IP_HEADER=x-e2e-client-address \
INTEGRATION_SUPABASE_URL=… INTEGRATION_SUPABASE_ANON_KEY=… INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=… \
npm run e2e
```

`E2E_SCREENSHOTS=<folder>` also saves the screenshots the specs take (`docs/screenshots` has a few).

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

## The AI layer and child safety

The tutor works with **no language model at all**. A model, when one is configured, only _phrases_
what the application has already decided; it never marks an answer, never calculates mastery and is
never shown the answer to a question the child has not solved.

```
learner message ─► safety screen (deterministic) ─► fixed reply, or on to the tutor
tutor move (facts) ─► plain template text (the draft) ─► [model rewrites the draft] ─► output guards
   ─► the model's words if every guard passes, otherwise the template text
```

- **Providers** (`src/lib/ai/llm`): the official Anthropic SDK, any server that speaks
  `POST /chat/completions` (other vendors, Azure, OpenRouter, vLLM, Ollama), and an offline `mock`.
  The model name is configuration (`AI_MODEL`), never code. Timeouts are short and retries few: a
  child is waiting, and the template text is the fallback.
- **Safety screen** (`src/lib/ai/safety.ts`, rules in `patterns.ts`): everything a child types is
  checked by plain regular expressions before anything else. Personal details (phone numbers,
  addresses, e-mail, links, passwords, ID numbers) are never forwarded and never stored (the record
  keeps `[removed]`); worrying messages (harm, abuse, fear, bullying, hunger) get a warm fixed reply
  that points to trusted adults and a child helpline; attempts to move to other apps, to change the
  tutor's rules and unkind words get a short fixed reply. Messages with personal details or worrying
  content are stored flagged so an administrator can review them (the only private-chat rows an
  administrator can read). Maths such as `4 305 000`, `0.5 0.25` or `0 1 2 3 4` is not mistaken for a
  phone number.
- **Output guards** (`src/lib/ai/guards.ts`): a model reply is used only if it gives away no answer
  to an open question (digits, words, option letters, true/false, a whole ordering, a matching pair),
  introduces no number the application did not supply (and no wrong digit inside a sum), does not
  contradict the verdict ("well done" after a wrong answer), contains no links, contacts or personal
  questions, claims neither to be a person nor to speak for the exam board, uses no secrecy, guilt or
  pressure to stay, and is plain text of a child-sized length that was not cut off.
- **Circuit breaker** (`src/lib/tutor/voice.ts`): after three failures in a row the model is left
  alone for a minute, so a provider outage costs nothing but warmth.
- **Limits, stated plainly.** The screen and the guards are a net, not a guarantee: they cannot
  understand every way a child might say something (other languages, spelling, code words), and a
  model could in principle word a wrong idea in a way no rule catches. The deployment still needs a
  person who reads the flagged messages and a written safeguarding procedure for what to do about
  them. `CHILD_HELPLINE_*` names the helpline in the reply to a worrying message; the default
  (Childline Zimbabwe, 116) must be confirmed before launch.

## The lesson

A lesson is one learning objective, taught in the order the specification gives: identify the goal
(quoted from the syllabus, with its page), introduce it, explain it simply, show a worked example, let
the child try, evaluate, name the misconception, give a hint, allow another attempt, explain the
correction, ask another question at the right difficulty, update mastery, then continue, review or
move on. The rules are plain functions of counters in `src/lib/tutor/policy.ts`:

- **The answer is never the first reaction.** A child gets three tries; after a wrong try the tutor
  offers a hint (up to the question's hints) and only after a hint, or a second wrong try, does it work
  the question through with them. "Show me how" is still offered, and says it is showing.
- **Near misses cost nothing** (the right idea in the wrong form: a missing unit, a fraction not in
  lowest terms, a decimal when a fraction was asked for): the child is told what to fix and tries
  again. Spaces and decimal commas in numbers (`1 000`, `0,5`) are simply understood.
- **Eight questions to a sitting**, a short review when something already mastered comes back, a
  foundation check of three when a prerequisite looks shaky, and a break offered after a run of
  wrong answers.
- **A child's own question** ("Ask ZimTutor a question") goes through the safety screen, is answered
  from the objective's syllabus text (found by retrieval, cited), and never gives away an open
  question's answer.
- **State lives in the database** (`tutor_sessions`, `tutor_messages`). Every step is committed as one
  unit by `tutor_commit()` with a revision check, so two tabs or a double click cannot corrupt a lesson
  (a conflict is a plain `PT409`, because PostgREST hangs on the standard serialization error code).
- **What the browser receives is a view** (`src/lib/tutor/view.ts`): the words, the question without
  its key, the buttons that make sense now. Marking, mastery and recommendations all happen on the
  server; the answer key (`question_keys`) is readable by nobody but the server.

## Practice papers (Grade 7)

`/student/exams` offers Paper 1 style (40 multiple-choice questions) and Paper 2 style (Section A: 10
questions, 25 marks, all answered; Section B: six questions of five marks, answer three), each in a
full or a half-length version. The shape comes from the syllabus as stored (`assessment_papers`,
`assessment_skill_bands`, cited to page 78), not from code. Questions are chosen once, when the paper
is started, to the skill shares the specification grid asks for (knowledge and comprehension, application
and analysis, problem solving), kept with the plan, answered over as many visits as needed, and
**marked once**, when the child finishes. The result is a **ZimTutor practice score**, shown by skill
and topic with what to practise next; the database makes it impossible to store one as an official
ZIMSEC result. What was answered also goes into the child's record and mastery. Where the bank cannot
fill a section to the target, the shortfall is shown.

## The screens

| Who           | Where                                     | What                                                                                                                            |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Learner       | `/student`                                | Continue, start something new, practise, recent work (counts and outcomes: not a word of what was said)                         |
|               | `/student/progress`                       | Every goal in the grade by topic and sub-topic, with its state                                                                  |
|               | `/student/learn/<goal>`                   | The lesson                                                                                                                      |
|               | `/student/exams`                          | Practice papers                                                                                                                 |
| Parent        | `/parent`                                 | Their learners; add one. `/forgot-password`: a forgotten password, by a one-time link in an email                               |
|               | `/parent/learners/<id>`                   | The week, progress by topic, where to help, recently mastered, practice papers: **never** conversations, typed words or answers |
|               | …and the same page                        | A new password for the child; deleting the child's account and everything saved about it                                        |
|               | `/parent/account`                         | Deleting their own account (and the children they alone look after)                                                             |
| Administrator | `/admin/curriculum`                       | Grade → topic → sub-topic → objective with content, activities, resources, source page and label                                |
|               | `/admin/supplemental`, `/admin/questions` | Label supplemental content (the five categories never mix); review practice questions                                           |
|               | `/admin/safety`, `/admin/audit`           | Messages the safety screen flagged (and no others); the record of every administrative decision, without a child's words        |

`docs/screenshots` has a few of the learner's screens. `/dev/pictures` (development only) shows every
picture the questions can draw.

## Security, privacy and operations

Child safety is a property of the whole system, so these are enforced and tested rather than promised:

- **Row-level security on every table**, closed-by-default grants, and an allow-list of functions the
  API may call (database tests enumerate them all). Roles come from server-set metadata, never from the
  browser.
- **A Content Security Policy with a fresh nonce on every response.** Scripts run only with that nonce;
  everything else, including connections, is limited to the site itself (there is no browser-side
  Supabase client). A browser test fails on any refusal and shows the browser refusing an injected
  script, a handler, a request and a form that are not the page's.
- **Session cookies are `httpOnly`**, so even an injected script could not read a session.
- **Limits on trying**, counted in the database under a keyed hash: wrong guesses at an account,
  failed sign-ins from one place, a child's lesson buttons, questions and practice papers
  (`src/lib/ratelimit/policy.ts`). An address is believed only from a header that cannot be forged.
  If the counters cannot be reached, the answer is yes: a lesson must not stop for a counter.
- **Server actions** each find out who is asking from the session before they do anything (a source
  scan fails the build if one does not), and take the child they concern from the page only to check
  that the parent is their guardian.
- **Accounts can be deleted** by the parent (a child's, or their own with the children they alone
  look after). One deletion of the sign-in identity removes everything: a database test searches every
  table for any trace of a deleted child.
- **Monitoring is off unless an operator sets `SENTRY_DSN` / `POSTHOG_*`**, goes from the server, and
  passes through a scrubber: no names, emails, numbers, addresses, ids, tokens or sentences, and counts
  carry no person. Tests read the bytes at the far end of a real connection.
- **Nothing secret reaches the browser**: a test reads every file of a production build for keys,
  tokens and the names of server-only tables.
- **Plain error pages**: a child sees "Something went wrong, that was not your fault", never a stack
  trace; an unknown page and someone else's page are the same 404.

To run it for real, read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Whoever reads the flagged
messages needs [`docs/SAFEGUARDING.md`](docs/SAFEGUARDING.md) (an outline to adopt and adapt), and
anyone deciding who may use ZimTutor should read [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md):
the safety screen is English-only, the practice questions have not been reviewed by teachers, and no
live language model has been exercised.

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
src/lib/ai/             language-model providers, safety screen, output guards, embeddings
src/lib/tutor/          the lesson: state machine, rules, moves, template wording, prompts, voice
src/lib/adaptive/       what to learn next: planner and progress summaries
src/lib/exam/           practice papers: structure, plan, assembly, choice conversion, marking, results
src/lib/student/ parent/ safety/   the screens' view-models; the safety review rules
src/lib/ratelimit/      limits on trying (policy, hashing, address, database counters)
src/lib/monitoring/     scrubbing, the event catalogue, Sentry/PostHog reporters (off by default)
src/lib/security/       the Content Security Policy
src/lib/auth/           credentials, roles, sessions, learner provisioning, account removal
src/lib/                other domain logic (db helpers, ai/embeddings, …)
src/app/                Next.js routes and server actions
scripts/                CLI entry points
tests/                  unit, database, API integration and browser (tests/e2e) tests
docs/                   DEPLOYMENT, SAFEGUARDING, KNOWN-LIMITATIONS, screenshots
```

See `.env.example` for configuration.
