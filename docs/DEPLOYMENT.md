# Deploying ZimTutor

This is the path from a clone of the repository to a running service, and what to check before
children use it. It assumes **Vercel** for the web app and **Supabase** (Postgres, Auth, pgvector)
for everything else, which is what the code is built and tested for.

> Nothing here is legal advice. Before launch the operator needs their own adviser to confirm what a
> children's learning service must do in the country it runs in (data-protection registration,
> notices, consent, retention). The technical side of those promises is described below and in
> [`SAFEGUARDING.md`](SAFEGUARDING.md); the wording of the privacy page (`src/app/privacy/page.tsx`)
> is a plain-language summary of what the product does, not a legal notice.

## 1. What runs where

| Part                  | Where                          | Notes                                                                                           |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| The web app           | Vercel (Node runtime)          | Every page is rendered per request (a Content Security Policy nonce is made for each response). |
| Database, Auth        | Supabase                       | Postgres 15+ with `pgvector`. Row-level security is on for every table.                         |
| Language model        | Optional; any provider         | The tutor works with **no model**. See section 5.                                               |
| Embeddings            | Optional; `local-hash` offline | For retrieval over the syllabus. See section 6.                                                 |
| Error / usage reports | Optional (Sentry, PostHog)     | Off unless configured; scrubbed first. See section 8.                                           |

The browser talks to **one** address: the app itself. There is no Supabase client in the browser,
and the Content Security Policy (`connect-src 'self'`) enforces it. If you add anything that must run
in the browser and talk to another service, the policy in `src/lib/security/csp.ts` has to be changed
on purpose.

## 2. Environment

Set these in the Vercel project (Production and Preview). Secrets are server-only; only the
`NEXT_PUBLIC_*` values are meant to be seen by browsers (and the app does not even send them there).

| Variable                                                                           | Required             | What it is                                                                                                                |
| ---------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                         | yes                  | The project's API URL.                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `…_PUBLISHABLE_KEY`)                           | yes                  | The anon/publishable key.                                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)                             | yes                  | **Secret.** Bypasses row-level security; used only after the calling action has checked who is asking.                    |
| `NEXT_PUBLIC_SITE_URL`                                                             | yes                  | The public address, **https** in production (session cookies are marked `Secure` from it).                                |
| `DATABASE_URL`                                                                     | for the CLIs only    | A direct Postgres connection used by `db:migrate` and the `curriculum:*` / `questions:*` commands. Not needed by the app. |
| `AI_PROVIDER`                                                                      | no (default `mock`)  | `anthropic`, `openai-compatible` or `mock` (no model).                                                                    |
| `AI_MODEL`, `AI_EFFORT`                                                            | with a real provider | The model name is configuration, never code. `AI_EFFORT` is optional (`low` … `max`, Anthropic only).                     |
| `ANTHROPIC_API_KEY`                                                                | `anthropic`          | **Secret.**                                                                                                               |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`                          | `openai-compatible`  | Any server that speaks `POST {base}/chat/completions`.                                                                    |
| `CHILD_HELPLINE_NAME`, `CHILD_HELPLINE_NUMBER`                                     | **confirm**          | Named in the reply to a worrying message. The default (Childline Zimbabwe, 116) **must be confirmed before launch**.      |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | no                   | See section 6.                                                                                                            |
| `RATE_LIMIT_SECRET`                                                                | no                   | At least 16 characters. The key rate-limit counters are hashed with. Empty: a key is made from the service key.           |
| `CLIENT_IP_HEADER`                                                                 | see section 7        | The header your host puts the visitor's address in. Empty is the safe default.                                            |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`                               | no                   | Errors, to Sentry. Off when `SENTRY_DSN` is empty.                                                                        |
| `POSTHOG_KEY`, `POSTHOG_HOST`                                                      | no                   | Anonymous counts, to PostHog. Both are needed; the host is named, never guessed.                                          |

The app validates its configuration lazily and says which variable is wrong; `next build` needs none of
the secrets.

## 3. Supabase

1. **Create the project** in the region closest to the children who will use it.
2. **Auth settings** (Dashboard → Authentication):
   - _Site URL_: the production address. _Redirect URLs_: add `https://<your-domain>/auth/callback`.
   - _Email confirmations_: **on** for production (parents sign up with a real address). The code
     works either way (`supabase/config.toml` turns it off for local development). Configure a real
     **SMTP** sender: the built-in one is limited to a few messages an hour.
   - _Minimum password length_: 8, as in the app. Leaving anonymous sign-ins off is correct: nothing uses them.
   - _Email templates_ (Authentication → Email Templates): paste the two in `supabase/templates/` (the
     local `supabase start` uses them already). Their links go to `/auth/confirm` with a one-time token
     (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` for
     "Reset password", `…&type=signup&next=/` for "Confirm signup"), and add
     `https://<your-domain>/auth/confirm` to the redirect URLs. Without them the default links still
     work, but only in the browser that asked for them: a parent who asks for a new password on a
     phone and opens the email in another app would be turned away.
   - Learners never get a real email address. They sign in with a username, which the server turns into
     `username@learners.zimtutor.invalid` (a reserved, undeliverable domain) and creates already confirmed,
     so no mail is ever sent to them.
3. **Auth rate limits.** The app calls Supabase Auth from the server, so Auth sees the server's
   address, not the child's. Auth's own per-address limits on sign-in and sign-up therefore apply to
   _everyone at once_. At more than a few dozen sign-ins in a few minutes, raise them (Authentication →
   Rate Limits) or children will be refused by Auth, not by ZimTutor. ZimTutor's own limits are
   per account (see section 7) and do not depend on this.
4. **Apply the schema.** With `DATABASE_URL` set to a **direct** connection (not a transaction pooler):

   ```bash
   npm ci
   npm run db:migrate
   npm run curriculum:load                           # 5 grades · 20 topics · 142 sub-topics · 444 objectives
   npm run curriculum:embed                          # retrieval chunks (see section 6)
   npm run curriculum:audit -- --snapshot --require-embeddings
   npm run questions:seed                            # the practice-question bank (idempotent)
   ```

5. **The first administrator** signs up like a parent, then is promoted out of band (a role can never
   be chosen from the browser): `npm run admin:promote -- you@example.com`.
6. **Never** point `TEST_DATABASE_URL` (used by the database tests) at a real project. Those tests
   create and drop their own databases and need a superuser.

## 4. Vercel

- Framework preset: Next.js. Node 22.13 or newer.
- Build command `npm run build`. The build needs no secrets.
- **Do not put a CDN cache in front of the HTML.** Pages depend on who is signed in and carry a
  per-request nonce; the responses already say `Cache-Control: private, no-cache, no-store`.
- The site sends `Strict-Transport-Security` with `preload`. Only deploy it on a domain that will be
  served over https for good: a preloaded domain is hard to take back to http.
- Region: put the functions in the same region as the Supabase project; a lesson step makes several
  database calls.

## 5. The language model

`AI_PROVIDER=mock` (the default) means **no model**: every word the child reads is the plain template
text, labelled as such. That is a complete, working tutor. With a real provider the model only
_rephrases_ a draft the application wrote, and its words are used only if they pass every guard
(`src/lib/ai/guards.ts`): no answer given away, no number the application did not supply, no links or
contacts, no claim to be a person or the exam board. A provider error, a timeout or a failed guard all
mean the child simply reads the template text, and after three failures in a row the model is left
alone for a minute.

- Costs are bounded per child (10 own questions a minute and 150 a day, see `src/lib/ratelimit/policy.ts`)
  but there is **no global budget**. Set a spend limit in the provider's console as well.
- Nothing about a child (name, username, id) is ever put in a prompt; only the goal, the facts of the
  question and what the child typed, after the safety screen has removed personal details.
- The live-provider paths are unit-tested with stand-ins; this repository has no live API key, so a
  first call to a real provider should be done on staging and read.

## 6. Embeddings and retrieval

Retrieval finds the syllabus text a child's own question is about. `EMBEDDING_PROVIDER=local-hash`
(the default) is a deterministic, offline, bag-of-words embedding: it needs nothing and is good enough
to find the right objective's text, but it matches words, not meaning. For better retrieval use an
`openai-compatible` embedding model that supports **1536 dimensions** (the database column is
`vector(1536)`; `text-embedding-3-small` works) and re-run `npm run curriculum:embed` after any change
of provider or model.

## 7. Limits on trying, and the visitor's address

Wrong guesses at one account, lesson buttons, a child's own questions, practice papers, sign-ups and
learner accounts are counted in the database (`rate_limit_counters`) under a keyed hash, so nothing in
that table names anyone. The limits, and the reasons for the numbers, are in
`src/lib/ratelimit/policy.ts`.

Limits **per account** need no configuration. Limits **per address** (failed sign-ins and sign-ups from
one place) need an address that cannot be forged:

- On **Vercel** nothing is needed: `x-forwarded-for` is used, because Vercel sets it itself.
- Anywhere else the default is **no limit by address**. Next.js fills in `x-forwarded-for` from the
  connection only when the visitor sent none, so a visitor who sends their own is believed by anything
  that reads it. If your platform sets a header visitors cannot forge (for example `x-real-ip` behind a
  proxy that overwrites it), name it in `CLIENT_IP_HEADER`.
- Per-address limits are loose on purpose: a mobile network or a school can look like one address.

If the counters cannot be reached the answer is "yes" and the failure is reported: a child's lesson
must not stop because a counter is down. A lockout after eight wrong sign-ins lasts until the end of the
fifteen-minute window; a parent can end it at once by choosing a new password for the child.

## 8. Reports (optional, off by default)

Set `SENTRY_DSN` for errors, and `POSTHOG_KEY` with `POSTHOG_HOST` for anonymous counts. They are sent
by the server over plain HTTPS (no SDK, nothing in the browser), after being scrubbed
(`src/lib/monitoring/scrub.ts`):

- **Errors**: the kind of error, a scrubbed and shortened message, stack frames, the route _template_
  (`/student/learn/[objectiveId]`, never the address that was asked for) and a few plain facts.
  Emails, phone numbers, addresses, ids, tokens, keys and quoted sentences are replaced; an error's
  cause and details are never read.
- **Counts**: lesson started/finished, practice paper started/finished, a message flagged (by kind), a
  limit reached (by name), the tutor falling back to its own text. All use one anonymous id and no
  person profile.

Before enabling either, agree a data-processing arrangement with the vendor and choose its region; the
code cannot make that decision. To check what is sent, point `SENTRY_DSN` at a local listener
(`http://key@127.0.0.1:PORT/1`) and read the requests.

## 9. Before children use it: the checklist

- [ ] `CHILD_HELPLINE_NAME` / `CHILD_HELPLINE_NUMBER` confirmed for the country (a wrong number is
      worse than none; `none` names no helpline).
- [ ] A named person (and a deputy) reads the flagged messages at `/admin/safety` on a schedule, and
      the procedure in [`SAFEGUARDING.md`](SAFEGUARDING.md) is adopted, adapted and trained on.
- [ ] The privacy page is reviewed by the operator's adviser; a data controller and a contact address
      are added (the page deliberately names none).
- [ ] Backups are on and a restore has been tried. Deleting an account removes it from the live
      database at once; copies in backups disappear when those backups expire, which the notice to
      parents should say.
- [ ] Email confirmation and SMTP are working for parents (sign up, confirm, sign in, and "Forgot your
      password?", opened on a different device from the one that asked). A failure to send a reset email
      is logged and reported, but the parent is told the same thing either way, so watch for it.
- [ ] `/admin/curriculum` and `/admin/audit` were opened by someone who compared a few objectives with
      the printed syllabus.
- [ ] Practice questions are labelled _ZimTutor practice question (not part of the syllabus)_; decide
      who reviews them (`/admin/questions`) and when.
- [ ] The browser suite and the database/API suites pass against **staging** (section 10).
- [ ] [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) has been read by whoever signs off.

## 10. Verifying a deployment

```bash
npm run check                      # lint, types, unit tests, build

# against a database that may be thrown away (never production):
TEST_DATABASE_URL=postgresql://postgres:…@host:5432/postgres npx vitest run tests/db

# against a staging Supabase project (needs the service key):
INTEGRATION_SUPABASE_URL=… INTEGRATION_SUPABASE_ANON_KEY=… INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=… \
  npx vitest run tests/integration

# the browser suite, against a production build of the same code:
npm run build && CLIENT_IP_HEADER=x-e2e-client-address npm start &
E2E_BASE_URL=http://localhost:3000 E2E_CLIENT_IP_HEADER=x-e2e-client-address \
INTEGRATION_SUPABASE_URL=… INTEGRATION_SUPABASE_ANON_KEY=… INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=… \
  npm run e2e
```

The browser suite signs up its own parents, learners and administrator through the real screens (so
use a staging project), runs on a desktop and a phone-sized Chromium, and fails on any Content Security
Policy refusal, hydration error or limit that does not hold. After `npm run build`, the unit suite also
reads every file the build would send to a browser and fails if one holds a secret, a provider key, the
service key's token or the name of a server-only table (`tests/security/bundle.test.ts`).

## 11. Running it

- **Logs** are one JSON line each on stdout, for ids, counts and kinds only: never a child's words, a
  prompt or a model's reply. Page faults also reach Sentry if it is on.
- **Rotating keys**: change the service key or `RATE_LIMIT_SECRET` and the rate-limit counters start
  again (their hashes change); nothing else depends on them. Rotate the Supabase JWT secret by the
  provider's procedure and update the three Supabase variables together.
- **A child is locked out** by wrong guesses: wait out the window, or the parent chooses a new password
  for the child (their page → "Change … password").
- **A parent asks to delete everything**: they can do it themselves (My account → Delete my account),
  or delete one child (the child's page). Both are immediate and cannot be undone.
- **Housekeeping**: rate-limit counters older than two days are removed as part of normal use. Nothing
  needs a scheduled job.
