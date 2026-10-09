# Known limitations

What ZimTutor does not do, does only partly, or has not been shown to do. Read this before deciding
who may use it, and keep it honest as things change. Each item says what it means and what to do
about it. Where something is untested, it says so.

## Safety and children

- **The safety screen is English-only and made of regular expressions.** It has no Shona or Ndebele
  and cannot understand meaning, spelling variants or code words. A child who writes in their own
  language and is in trouble will not be flagged. _Do:_ have fluent speakers with child-protection
  experience extend `src/lib/ai/patterns.ts` before launch (see `SAFEGUARDING.md`).
- **Answer boxes are not read for worrying content.** Personal details typed there are removed;
  worrying words are not looked for. The place a child is invited to talk is "Ask ZimTutor a question".
- **No real-time alerting.** Flagged messages wait in a list at `/admin/safety`; someone has to look.
  There is no email, SMS or push to the safeguarding lead.
- **An administrator sees only the flagged message, not the conversation around it.** That is
  deliberate privacy, and it means decisions are sometimes made on very little context.
- **The helpline default (Childline Zimbabwe, 116) is unconfirmed.** It must be checked before launch.
- **The privacy page is a plain-language summary, not a legal notice.** It names no data controller or
  contact address; the operator's adviser must settle those, and what registration or consent rules
  apply where the service runs.
- **A reviewer's note outlives the child's account** (it is part of the audit record). Reviewers are
  asked to record actions, not names or the child's words, but nothing in the product stops them.
- **Deleting an account is immediate and cannot be undone**, and there is no grace period. Backups keep
  copies until they expire. There is no way yet for a parent to _export_ a child's data before deleting.

## The curriculum and the practice

- **The syllabus is ingested and checked; the practice is generated.** All 444 objectives are in the
  database with their source page and text, and the extraction was verified several independent ways
  (see the README). The practice questions come from 127 templates and are labelled _ZimTutor practice
  question (not part of the syllabus)_, stored as `SUPPLEMENTAL` / `UNVERIFIED`. Each is checked by code
  (it marks its own answer right and each predicted wrong answer wrong), but **no teacher has reviewed
  them**; the review screen exists (`/admin/questions`), the reviewing has not happened.
- **437 of 444 objectives have practice.** The other seven are practical tasks (draw or build solids,
  draw lines of symmetry) or facts about Zimbabwean currency that need verified source material. The
  tutor says so rather than inventing questions.
- **For some objectives a level has only a few distinct questions**, so a child who practises a lot will
  see repeats (the tutor repeats the one met longest ago).
- **No past examination papers are included.** Nothing carries the label `OFFICIAL_ASSESSMENT`:
  practice papers are made from ZimTutor's own questions in the _shape_ the syllabus describes.
- **Local and heritage context** (names, places, money, everyday settings) is written into templates,
  but local teachers have not reviewed it for fit or tone.
- **Marking is exact but literal.** It understands decimal commas, spaces in numbers, words,
  percentages, mixed numbers, units, orderings and matching, but a correct answer written in a form it
  does not know is marked wrong. Working-out and written reasoning are not marked at all.
- **English only.** Everything a child reads is in English; there are no Shona or Ndebele versions of
  the screens, the explanations or the questions.

## Practice papers (Grade 7)

- **The shape is the syllabus's; the paper is not an exam.** Paper 1 (40 multiple-choice questions) and
  Paper 2 (Section A: 10 questions, 25 marks, all answered; Section B: six questions of five marks,
  three chosen) are built from the syllabus's own description, with the skill shares of its
  specification grid (knowledge and comprehension 50 %, application and analysis 40 %, problem
  solving 10 %) as the target. The skill tag on a question comes from the template that made it, not
  from an examiner, and a paper's difficulty is not calibrated against real papers.
- **A "structured question" is a set of related parts on one theme**, not a question an examiner wrote
  with its own marking scheme.
- **The mark is a ZimTutor practice score, always called that, never a ZIMSEC result.** The database
  makes it impossible to store one as official.
- Where the bank cannot fill a section to the target shares, the shortfall is shown, not hidden.

## Mastery and adaptation

- **The mastery model uses untuned defaults.** It is a Bayesian knowledge-tracing update with
  difficulty-aware slip and guess rates and gates for `MASTERED`; the numbers were chosen by reasoning,
  not fitted to data from children, because there is none yet. It needs calibration once real use
  exists, and the state labels should be read as estimates.
- **Retrieval defaults to a hashed bag-of-words embedding** (`EMBEDDING_PROVIDER=local-hash`). It finds
  the right objective's text from a child's words, but it matches words, not meaning. A real embedding
  model (1536 dimensions) is better.

## The language model

- **No live provider has been exercised.** The Anthropic and OpenAI-compatible adapters are tested with
  stand-ins and their error handling is checked, but this repository has no API key, so real replies,
  latency and cost are unmeasured. The default (`mock`) uses no model, and that is a complete tutor.
- **The guards are a net.** They catch an answer given away, an invented number, links, contacts and
  the other things listed in the README; they cannot judge whether an explanation is good.
- **There is no global spend cap.** Per-child limits bound cost per child; set a limit with the provider.

## Limits on trying

- **Windows are fixed**, so a determined script can use a limit twice around the edge of a window.
- **A child's account can be locked by someone else's wrong guesses** (eight in fifteen minutes). A
  parent can end it at once by choosing a new password for the child.
- **Limits per address apply only with a trusted header** (always on Vercel; elsewhere only if
  `CLIENT_IP_HEADER` is set). Without one, only the limits per account protect anyone.
- **Supabase Auth has its own per-address limits**, and because the app calls it from the server it sees
  one address for everyone. They may need raising at scale (`DEPLOYMENT.md`).
- **The reporting throttle is per server instance** (in memory), not shared.

## Accounts and roles

- **A parent's forgotten password is reset by email, which needs working email.** The reset link works
  from any device once the project's email templates are in place (`DEPLOYMENT.md`). The parent is told
  the same thing whether or not the address has an account, so a failure to send is visible only in the
  log and the monitor. A learner cannot reset their own password (they have no email); their parent
  chooses a new one.
- **No teacher, school or class role.** There are learners, parents and administrators. Administrators
  are operator staff (made with a CLI), and the administration area reads the curriculum and reviews
  content; it cannot edit the official curriculum (by design).
- **No notifications to parents** (no weekly email, no alert) apart from Supabase Auth's own emails.
- **One administrator list, managed in the database**, with no screen for it.

## Accessibility, reach and devices

- **Checked by machine, not yet by people.** An automated scan (axe, WCAG 2.0 and 2.1 levels A and AA:
  names and labels, roles, headings, landmarks, contrast, keyboard reach) passes on every screen a
  learner, a parent and an administrator sees and on the public pages, on a desktop and a phone-sized
  screen, and on a gallery of every kind of question picture. It found, and the code now fixes, a
  yellow text colour at 1.7:1 contrast, a focus ring that could hardly be seen, and a table that
  scrolled sideways but could not be reached by keyboard. A scan cannot say whether a screen makes
  sense to someone using a screen reader or a switch, and nobody who relies on one has tried ZimTutor.
  WCAG 2.2 criteria (such as target size) are not scanned. There is no dark mode.
- **No offline mode, no data-saver mode.** Pages are rendered on the server and kept small, but there
  is no service worker; a child with no connection cannot continue.
- **Browsers tested: Chromium only** (a desktop window and a phone-sized one). Safari and Firefox have
  not been tried.
- **Reading level has not been checked by educators.**

## Security

- **The Content Security Policy forces every page to be rendered per request** (the nonce is made for
  each response). That costs compute and rules out caching pages in a CDN. Inline `style` attributes
  are allowed (`style-src-attr`), a small residue of the inline styles React and the pictures use;
  scripts, stylesheets, images, fonts and connections are all limited to the site itself.
- **Fault reports come from the server only.** A fault that happens only in a child's browser (a script
  error after the page loads) is not collected, and there is no performance tracing.
- **Dependency advisories**: `npm audit` is clean for production dependencies. Five advisories remain
  in the development toolchain (`braces` through `eslint-config-next`, a denial of service in glob
  expansion); they affect linting, not the running app.
- **HSTS is sent with `preload`.** Deploy only on a domain that will be https for good.

## How it was tested, and what was not

- **Verified**: 2 900+ unit, real-Postgres and real-API tests; a browser suite (about 100 tests, each on a
  desktop and a phone-sized Chromium) against a production build; a real fault, in a real server,
  reaching a stand-in for Sentry scrubbed. The database and API suites ran against PostgreSQL 16 with
  `pgvector`, Supabase Auth (GoTrue) and PostgREST run directly and put behind a small gateway.
- **Not verified**: `supabase start` (the route the README's "Try it on your own computer" uses) and
  the GitHub Actions workflow built on it (`integration.yml`) have not been run, because the machine
  ZimTutor was built on could not download the Supabase container images; Vercel deployment has not
  been done; no load or soak testing; no test with a live language
  model or embedding provider; no test by children, parents or teachers.
- **The database tests create and drop their own databases** and need a superuser: never point
  `TEST_DATABASE_URL` at anything that matters.

## Scale and operations

- **Not load-tested.** A lesson step is several database calls plus one counter call, and is written to
  stay correct under concurrent use (each step is committed atomically with a revision check, and
  tested for it), but how many children one project carries is unknown.
- **Counters are cleaned as a side effect of use**, not by a scheduled job; a deployment with no
  traffic keeps what it has until it has some.
