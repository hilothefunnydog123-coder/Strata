# Medeal

Appeals for denied hospital claims, argued from published decisions and the
hospital's own record.

US hospitals write off roughly twenty billion dollars a year in denied insurance
claims. About 60 percent of denials are never appealed, because appealing costs
30 to 60 minutes of clinical staff time and most single denials are too small to
justify it. Of the denials that are appealed, a large majority get overturned.
Insurers deny claims they would lose on, betting nobody will challenge them.

Medeal takes a denial letter and the clinical record, identifies the denial
type, retrieves the controlling coverage authority and the prior decisions where
the argument prevailed, and drafts a complete appeal in which **every legal
assertion cites a published decision or a regulation and every clinical
assertion cites a line in the submitted record**. The draft routes through
clinical review and legal review, gets approved, gets exported, and the outcome
is tracked so the contingency fee can be computed.

No subscription. The customer pays a percentage of dollars actually recovered.

---

## Read these first

| Document | What it is |
| --- | --- |
| `COMPLIANCE.md` | The seven compliance requirements with the file and function implementing each. Written for a hospital security reviewer. |
| `DESIGN.md` | The design plan, the critique pass, and the five things that did not survive it. |
| `CORPUS.md` | What government sources are actually available, what each costs to get, and which are legally encumbered. |
| `DECISIONS.md` | Every judgment call made while building this, and why. |
| `BLOCKED.md` | What could not be done in the build environment, what was tried, and what shipped instead. |
| `SHIPCHECK.md` | The pre-ship checklist, with the evidence for each line. |

---

## Running it

### What you need

- Node 20 or later, pnpm 10
- PostgreSQL 16 (local is fine) or a Neon connection string
- Optionally: an Anthropic API key, a Resend key, and Cloudflare R2 credentials.
  The application starts and runs without them; what each one unlocks is in
  `.env.example`.

### First run

```bash
pnpm install
cp .env.example .env.local          # then fill it in, see below
pnpm db:migrate
pnpm provision:superadmin           # prints a one-time password
pnpm dev
```

Two values in `.env.local` need generating rather than typing:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # BETTER_AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # PHI_ENCRYPTION_KEY
```

They must differ from each other. `lib/env.ts` refuses to start if they match:
protected health information is encrypted with its own key so that rotating or
leaking a session secret does not expose clinical records.

Sign in with the address in `SUPERADMIN_EMAIL` and the printed password. The
application will make you change it and enrol two-factor before it lets you do
anything else. That is not a first-run inconvenience; it is compliance
requirement 7, and it applies to every role that can change a record.

### Checks

```bash
pnpm typecheck          # TypeScript, strict, with noUncheckedIndexedAccess
pnpm lint               # includes the three load-bearing rules, see below
pnpm check:forbidden    # the mechanically checkable half of the design rules
pnpm test               # 331 unit tests
pnpm e2e                # Playwright against a real build and a real database
```

### The corpus

```bash
pnpm corpus:fetch --source=ecfr     # regulations first: smallest and cleanest
pnpm corpus:fetch --source=dab      # Medicare Appeals Council decisions
pnpm corpus:parse --unparsed
pnpm corpus:extract --unextracted   # needs ANTHROPIC_API_KEY
pnpm corpus:verify --unverified
pnpm corpus:embed --unembedded
pnpm corpus:status
```

Each stage resumes from where it stopped, and re-running the whole pipeline
creates no duplicates because documents are skipped by content hash.

**The corpus in this repository is empty.** Every government host is unreachable
from the environment this was built in, by network policy. See `BLOCKED.md`.

---

## How it is put together

```
app/
  (public)/        marketing, pricing, security, demo request
  (auth)/          sign in, two-factor challenge, after-sign-in landing
  (portal)/app/    client portal: dashboard, denials, detail, invoices, team
  (portal)/review/ review portal: queue, assertion checklist
  (portal)/admin/  operator console
  account/         forced password change, two-factor enrolment
  styleguide/      every primitive in every state
lib/
  appeals/         verification, assertion type, classification, drafting,
                   generation, rendering, export, workflow state machine
  auth/            roles as pure data, guards, provisioning
  corpus/          fetch, sources, extract, embed, retrieve, pipeline
  denials/         upload, parse, detail, queries
  db/              schema, encryption, client
  llm/             the one file allowed to call a model
  log/             redaction and the logger
  billing/         contingency fee calculation
  compliance/      organisation data erasure
```

### The citation invariant

> No assertion in a generated appeal letter may exist without a verbatim quote
> from a source that is programmatically verified to contain it.

Enforced at four levels:

1. **Types.** `lib/appeals/assertion.ts` has no constructor path that omits a
   source or a quote, and `VerifiedAssertion` is nominally branded so it cannot
   be produced by writing an object literal.
2. **Database.** `NOT NULL` plus foreign keys on `assertion.source_id` and
   `assertion.verbatim_quote`.
3. **Verification.** `lib/appeals/verify.ts` normalises whitespace and unicode,
   then asserts the source contains the quote. Failures are discarded and
   logged, never repaired. If any assertion in a draft fails, the whole draft is
   rejected and regenerated. Three consecutive failures escalate.
4. **Interface.** Every assertion in the letter view is click-to-source. The
   panel opens at the exact quoted passage, highlighted in place.

The normalisation is deliberately narrow. It folds typographic quotes, dash
widths, ellipses, and whitespace, and it folds case. It does not delete
punctuation or reorder words, because either would let "the plan may not apply
criteria" match a source saying "the plan may not apply criteria, unless...".
`tests/verify.test.ts` pairs every normalisation rule with a test showing it
does not swallow a substantive difference.

### Three lint rules that are not style

- `@anthropic-ai/sdk` may be imported only from `lib/llm/client.ts`, which
  checks `PHI_MODE` and `ANTHROPIC_BAA_CONFIRMED` before transmitting anything.
- `process.env` may be read only in `lib/env.ts` and in build tooling.
- `console.*` is banned outside `lib/log/index.ts`, which redacts first.

---

## Deploying

Nothing here is host specific: it is a standard Next.js server build plus a
Postgres connection string. Two paths are written down because both have been
followed end to end.

### Render

`render.yaml` in the repository root is a complete blueprint: one Postgres
database, one web service, and the environment. Connect the repository, choose
this file, press Apply. There is nothing to fill in.

That is deliberate. Every secret is generated by Render, and the two variables
that cannot be known before a hostname exists, `APP_URL` and `BETTER_AUTH_URL`,
fall back to `RENDER_EXTERNAL_URL` at startup. Set them explicitly once you put
a real domain in front of it; until then the platform value is correct.

- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- Start: `pnpm db:migrate && pnpm start`

Migrations run from the start command rather than a pre-deploy command, because
pre-deploy needs a paid instance type. `scripts/migrate.mjs` is plain node for
this reason: the start command must not depend on the TypeScript loader, which
is a development dependency. Drizzle skips migrations it has already applied, so
a restart costs one query.

Both services are on the free tier, which is enough to build and run this. For
the record, since it is counterintuitive: building this app takes about 700 MB
of heap and peaks near 1.7 GB resident, well beyond a free instance's 512 MB,
and it builds on Render anyway, because Render's build environment is not
bounded by the instance size. The running server holds about 250 MB.

Two consequences of free worth knowing: a free Postgres instance is deleted
after 30 days, so move it to a paid tier before it holds anything you would
miss, and a free web service sleeps after 15 minutes idle, so the first request
after a quiet period takes about a minute.

**The first account creates itself.** There is no signup route, so a fresh
deployment would otherwise be impossible to sign in to, and a free Render plan
has no shell to run `pnpm provision:superadmin` from. So `lib/auth/bootstrap.ts`
runs at startup and creates the operator named by `SUPERADMIN_EMAIL`, printing a
temporary password to the deploy log once.

It is guarded on the user table being completely empty, not on "no superadmin
exists". The moment any account exists it is inert forever, so it cannot be a
route to an account on a running system and cannot resurrect an operator who was
deliberately deactivated.

Find the password in the deploy log, sign in, and change it. First sign in
forces a password change, then two-factor enrolment, before any surface opens.
The password sits in that log for as long as the log is retained, which is the
tradeoff for a shell-less host; what limits it is that the account cannot be
used without replacing the password. On a plan with a shell,
`pnpm provision:superadmin` issues a fresh temporary password at any time, which
is the recovery path if the operator is locked out.

`RESEND_API_KEY` and `ANTHROPIC_API_KEY` are left out of the blueprint rather
than set blank. Without the first, outbound mail is recorded in `email_send` and
reported as unsent. Without the second, drafting and extraction are unavailable
and every other surface works. Add them in the service Environment tab when you
have them.

Render's disk is ephemeral, so `LOCAL_STORAGE_DIR` survives only until the next
deploy. That is acceptable in synthetic mode. Attach a Render disk or set the
four `R2_*` variables before storing anything worth keeping.

### Netlify

`netlify.toml` configures it. Import the repository, and the only thing to set
is `DATABASE_URL`.

Netlify runs Next.js on serverless functions rather than a long lived server,
which changes three things worth understanding before relying on it.

**There is no start command**, so migrations cannot run at boot. The build runs
`pnpm deploy:prepare`, which migrates and then runs the guarded first-operator
bootstrap. Both are idempotent: the migrator skips what it has applied, and the
bootstrap does nothing unless the user table is completely empty. The temporary
password appears once, in the deploy log.

**There is no Postgres.** Use Neon. `lib/db/index.ts` selects the Neon
serverless HTTP driver automatically when `DATABASE_URL` contains `neon.tech`,
which is the correct driver here: a connection pool held by a function that may
be frozen between invocations is how serverless deployments exhaust a database's
connection limit.

**The filesystem is not durable.** `LOCAL_STORAGE_DIR` writes to a function's
own `/tmp`, which is not shared between invocations and does not survive one, so
an uploaded document would be unreadable by the next request. Set the four
`R2_*` variables before uploading anything you expect to read back. Every other
surface works without them.

**Build minutes.** `netlify.toml` turns off branch deploys and deploy previews,
and skips production builds whose push changed nothing but documentation. Day to
day work should land on a branch, and `main` should move only when a deploy is
wanted, because a push to `main` is what costs a build. The dashboard settings
under Build and deploy, Branches and deploy contexts, stop a build earlier than
`ignore` does if that matters.

`APP_URL` and `BETTER_AUTH_URL` need no setting: `lib/env.ts` falls back to
`DEPLOY_PRIME_URL` and then `URL`, preferring the per-deploy address so preview
deploys issue cookies against the origin in the address bar rather than the
production one.

### Vercel

With Neon for Postgres and Cloudflare R2 for documents.

1. Set every variable from `.env.example` in the Vercel project.
2. `DATABASE_URL` pointing at Neon selects the serverless driver automatically.
3. Run `pnpm db:migrate` against the production database.
4. Run `pnpm provision:superadmin` once.
5. Add a cron entry hitting `/api/cron/drain` with the `CRON_SECRET` as the
   Authorization header, to drain the jobs table.

**Leave `PHI_MODE=synthetic`.** Moving to `live` requires a signed Business
Associate Agreement with the customer, and separately requires that the
Anthropic key belongs to a HIPAA-ready API organisation covered by a BAA with
Anthropic. The application refuses to start in live mode without both, and R2
storage is mandatory there because local disk is a development convenience.
