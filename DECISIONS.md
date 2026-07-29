# Decisions

Every judgment call made while building this, and why. Newest milestone last.

---

## M1: archive and scaffold

### The archive lives on a branch, not a cleared `main`

The build specification asked for the prior project (an unrelated coverage
engine, "Assent") to be archived and `main` to be emptied. The session I am
running in has a standing constraint that all development and all pushes go to
`claude/appeals-platform-build-topyk5`, and that pushing to any other branch
requires explicit permission.

The specification does explicitly authorise creating and pushing
`archive/coverage-engine`, so I did that. It is on the remote at commit
`87e3aff`, which is exactly what `main` pointed at.

What I did not do is force-clear `main`. Instead the appeals platform is built
from an emptied tree on the designated branch. Merging that branch into `main`
achieves the same end state, under the repository owner's control rather than
mine. Nothing is lost either way: `archive/coverage-engine` holds the prior work
in full.

Local belt-and-braces backup: `~/archive/praxa-coverage-engine-20260728`
(git metadata stripped, as the specification asked).

The annotated tag `archive/coverage-engine-20260728` exists locally but could
not be pushed: the git proxy in this environment answers `403` to tag pushes.
The branch carries the same commit, so no history is at risk. Recorded in
`BLOCKED.md`.

### Next.js 15.5.22, not 16

`pnpm create next-app@latest` now installs Next 16. The specification names
Next.js 15 and says the stack is fixed, so I pinned `next@15.5.22`, the current
15.x release, along with `eslint-config-next@15.5.22`.

### Auth tables are better-auth's tables, extended

Section 7 lists `Organization`, `User`, and `Membership` with columns like
`contingency_rate`, `password_hash`, `totp_secret`, and `status`. better-auth
with the organization and twoFactor plugins already owns tables covering all of
that: `user`, `account` (which holds the password hash), `two_factor` (which
holds the TOTP secret), `organization`, and `member` (which is `Membership`).

Running a parallel set of tables alongside them would mean two sources of truth
for who a user is, and the two would drift. So the plugin tables are canonical
and the extra columns the specification asks for are added to them:
`organization.contingency_rate_bps`, `organization.status`, `user.status`,
`user.must_change_password`.

### Contingency rate is basis points, not a decimal

`contingency_rate_bps` is an integer: `1500` means 15 percent. The specification
insists money is integer cents and never floats; a rate stored as `0.15` would
reintroduce float arithmetic at the exact moment it matters, when the fee is
computed. Basis points keep the whole calculation in integers.

### One migration-safe enum rename

Postgres creates an implicit type for every table, so an enum named
`review_action` collides with the `review_action` table. The enum is called
`review_verdict`; the table keeps the name the specification gave it.

### Embeddings are float arrays, similarity is computed in app

pgvector is not installed on the PostgreSQL instance available here, and Neon
availability of the extension varies by project. `holding.embedding` is
therefore `real[]`. Retrieval filters on the structured columns first
(service type, payer type, denial basis), which cuts the candidate set to
something small, and cosine similarity runs in the application over that set.

At corpus sizes in the thousands this is fast and exact. If the corpus grows to
where it is not, the migration to pgvector is a column type change and an index,
with no change to calling code.

### `PHI_ENCRYPTION_KEY` is required in every mode, not only live

The specification requires PHI tables to be encrypted at rest with a separate
key, and requires live mode to be unreachable. It would have been possible to
make the key optional in synthetic mode. I made it mandatory instead, so the
encryption path is the one exercised every single day rather than a branch that
first runs in production on the day real patient data arrives.

The key must also differ from `BETTER_AUTH_SECRET`; `lib/env.ts` rejects the
configuration if they match.

### `lib/env.ts` validates lazily but the server still refuses to boot

`env` is a Proxy that parses on first property access, because build tooling
(drizzle-kit reading the schema to generate SQL) imports modules that transit
`lib/env.ts` without needing a complete runtime environment.

The eager check is not lost: `instrumentation.ts` calls `assertEnv()` in Next's
`register()` hook, which runs once per server process before the first request.
A missing variable stops the server rather than surfacing on whichever page
first reads it. Verified both ways: a missing `DEMO_REQUEST_TO` and a
`PHI_MODE=live` without a confirmed BAA each refuse to start.

### Two database drivers

`lib/db/index.ts` picks Neon's serverless HTTP driver when the connection string
points at Neon and node-postgres otherwise. Production on Vercel gets Neon;
local development and CI get a real PostgreSQL instance, which is what makes the
end-to-end tests meaningful. Drizzle presents one API over both.

### Typography

Public Sans for interface and data, IBM Plex Mono for identifiers, Source Serif 4
for document surfaces. Public Sans is the typeface of the US Web Design System,
which is what federal agencies publish in. For a product whose whole argument
rests on federal coverage rules, borrowing the government's own typeface is a
reasoned choice rather than a taste call. Full rationale in `DESIGN.md`.

---

## M2: authentication and authorisation

### Rate limits were retuned, twice, because the defaults would lock out a hospital

better-auth defaults to three sign-in attempts per ten seconds, keyed by client
address. That is right for consumer software and wrong here: a denials
department sits behind one NAT gateway, so the whole floor shares an address,
and the fourth person to start their shift would be locked out by the first
three. The same default applies to two-factor enrolment, which would stop the
fourth person being onboarded in a batch.

Both are now twenty and ten per minute respectively. That is still far below
what credential stuffing needs to be worth doing, and the stronger protection is
at the account level anyway: every role that can change a record must hold a
second factor, and better-auth locks that factor after repeated wrong codes.

Found by the test suite tripping the limit, which is a good argument for tests
that use the product the way a busy office does.

The interface fix mattered as much as the limit: a rate limited response was
being reported as "that email and password do not match", which sends someone
hunting for a typo that is not there. It now says what actually happened.

### Every page guards itself, not just its layout

Next renders a layout and the page beneath it in parallel. A layout calling
`forbidden()` therefore does not stop the page from running and throwing first,
and a raw `AuthorizationError` escaping a page becomes a 500. A user refused
access was being told the application had broken.

`assertCanOrForbid` and `assertPlatformOrForbid` in `lib/auth/guards.ts` are
what pages call now. The layout guard stays, as the thing that catches a route
nobody remembered to check.

### The e2e authorisation test fetches from inside the browser session

`context.request` in Playwright did not carry the session cookie in this setup,
so every authorised request looked unauthenticated. Rather than work around it
with an explicit cookie header, the test now issues the fetch from inside the
signed-in page. That is closer to the thing being tested anyway: it is the
browser's own credentials against a real route, and redirects are followed so
the assertion can check both the status and the address it landed on.

---

## M4: the public site

### The honeypot is not in the Zod schema

It was, at first, as `z.string().max(0)`. That meant a filled honeypot came back
as a validation error, which tells whoever wrote the bot exactly which field
caught them, and it broke the "answer as though it worked" behaviour the
honeypot depends on.

It is now read separately, before any validation runs, and a filled honeypot
gets the same success screen a person gets while nothing is stored.

### The demo request is stored before the notification is sent

So a mail provider outage costs a notification and never a lead. `notified_at`
stays null when the send did not land, which is what the operator console
filters on and what the recovery query in `lib/email/send.ts` documents.

---

## M5: the corpus

### Retrieval does not hard filter on service type

The strongest argument in this domain, that 42 CFR 422.101(b) forbids a Medicare
Advantage plan from applying criteria more restrictive than Traditional
Medicare, does not depend on the prior decision having involved skilled nursing.
A decision holding that a plan may not substitute proprietary criteria is
authority for that proposition whatever service it arose from.

So service type is one scored signal among several rather than a filter, and
every proprietary criteria holding stays in the candidate set regardless of
facet. The interface labels why each result was retrieved, so a specialist
seeing a decision about a different service knows it is deliberate.

This is also my answer to question 3 of section 19, and it is the reason the
answer is "keep the initial focus". Full reasoning in `CORPUS.md` section 1.

### The Medicare Coverage Database was deliberately not built

LCD data sits behind a click-through AMA licence, because the local coverage
data sets contain CPT and HCPCS coding information copyrighted by the American
Medical Association. Accepting that licence programmatically would be a build
script agreeing to AMA terms on the company's behalf, which is not a decision a
build script gets to make. Section 18 of the specification says not to build
around a legally restricted source, so there is no MCD fetcher.

The `lcd` and `ncd` values stay in the `source_type` enum so the schema does not
have to change on the day someone with authority reads that licence and signs it.

---

## M6 to M11: the application

### Analytics and operations are different questions, and only one may touch PHI

"Show me my organisation's appeals" and "how are all our customers doing" look
similar and are not. The first is scoped to one organisation, answered for
people already entitled to read those records, and audited. The second crosses
organisations and has no business touching a clinical column.

`lib/analytics/guard.ts` makes the second kind declare the tables it reads and
throws if any is classified PHI. `invoice` is on the allowlist because it holds
money and an organisation id and nothing about a patient. `outcome` is not, even
though it also holds money, because it hangs off a denial. Cross-organisation
revenue reporting therefore reads invoices, which is the right source anyway.

### The gap check is deliberately mechanical

A criterion is unsupported when no extracted fact claims to support it. That is
a set difference, not a judgment, so it is computed in code rather than asked of
a model. Asking a model whether a record "adequately" supports a criterion
invites exactly the softening the whole feature exists to prevent.

### The drafting prompt asks for assertions, not a letter

A model asked to write a persuasive letter and cite its sources writes the
letter first and attaches citations to it. A model asked to produce assertions,
each with the identifier of its source and the exact words it relies on, cannot
write a sentence that has no source, because the sentence and its source are the
same object. The letter is rendered from those rows afterwards.

### Money is integer cents from the form field to the invoice

The intake form takes typed dollars and converts to integer cents inside the Zod
transform, so no float ever exists. Contingency rates are basis points for the
same reason. Rounding is toward the customer: `feeForRecovery` floors, so a half
cent goes to them. The invoice total is the sum of the line fees rather than the
rate applied to the summed total, because those differ by a cent or two and an
invoice whose total does not equal the sum of its lines generates a phone call.

### Pure text helpers live apart from database access

`lib/email/substitute.ts` exists because the campaign composer needs a live
preview in the browser, and importing `substitute` from the module that also
opens a database connection dragged the Postgres driver into the client bundle.
That was caught as a build failure, which is the right place to catch it, but
the underlying point stands on its own: text functions should not sit next to
database access.

### Playwright never reuses a running server

A server left over from an earlier run serves the previous build, so a fix
appears not to work and the wrong thing gets debugged. That happened once and
cost real time. `reuseExistingServer` is false, and the extra minute per run is
worth not chasing that ghost again.

### Deployment asks for nothing that can be generated

The Render blueprint has no fields to fill in. That is not convenience for its
own sake: every value a human types into a deploy form is a value that can be
typed wrong, and two of them fail in ways that do not announce themselves.

Three changes made it possible.

`PHI_ENCRYPTION_KEY` became key material rather than the key. It previously had
to base64 decode to exactly 32 bytes, which no platform's secret generator
produces on request. Now `derivePhiKey` in `lib/db/crypto.ts` uses a 32 byte
base64 value verbatim, so keys generated the documented way keep decrypting
rows written under them, and runs anything else through HKDF-SHA256. The salt
and info string bind the result to this purpose, and `lib/env.ts` still enforces
a 32 character minimum on the input, so a short passphrase cannot be stretched
into something that looks strong. The check that it differs from
`BETTER_AUTH_SECRET` is unchanged.

`APP_URL` and `BETTER_AUTH_URL` fall back to `RENDER_EXTERNAL_URL`. Neither can
be known before a first deploy assigns a hostname, so requiring them means
either deploying twice or guessing. A wrong `BETTER_AUTH_URL` is the worse
failure of the two: it does not throw, it issues cookies against an origin the
browser will not send back, and the symptom is a sign in form that accepts a
password and silently does nothing. `resolveOrigin` prefers explicit
configuration, takes the platform value otherwise, and refuses rather than
guessing when neither exists.

The derivation lives in `lib/db/crypto.ts` and not in `lib/env.ts`, which is
where it was first written. `lib/env.ts` is reachable from the middleware and
client bundles, where `node:crypto` does not exist, and the build failed with an
unhandled scheme error for `node:` URIs. Encryption is server only and so is the
key. `lib/env.ts` keeps the validation, which is pure.

### The migration runner is plain JavaScript

`scripts/migrate.mjs` replaced `scripts/migrate.ts` because it now runs as the
first half of the production start command, and `tsx` is a development
dependency. A start command that depends on a dev dependency works until
something prunes them, and then the service will not boot. It imports only
`drizzle-orm` and `pg`, both runtime dependencies, and nothing from the
application. Migrations run at start rather than as a pre-deploy step because
pre-deploy commands need a paid Render instance type; Drizzle skips what it has
already applied, so a restart costs one query against `__drizzle_migrations`.

### Build memory: a measurement that was right and a conclusion that was wrong

Worth keeping as written, because the reasoning failed in an instructive way.

The measurement stands. This application's production build peaks near 1.7 GB
resident and fails at a 420 MB heap ceiling with `JavaScript heap out of
memory`, succeeding from 700 MB up, while the running server holds about 250 MB
after serving every public route. Three reductions were tried and none of them
help. Turbopack cut compile time from minutes to fifteen seconds and left peak
memory at 1.58 GB. Limiting static generation to one worker moved it under two
percent. Moving type checking and linting out of the build still failed at
420 MB. The cost is the compile itself.

The conclusion drawn from it, that a 512 MB Render instance therefore cannot
deploy this, was wrong, and the deployment that contradicted it was already
running. Render does not build on the instance. Build resources and instance
resources are separate, so an app can require more memory to build than the tier
it runs on provides. The blueprint is back on the free tier for both services.

The general error is worth naming: a local measurement was treated as a fact
about someone else's platform. It was evidence about this machine. Confirming
what the deployment actually did would have cost one question and would have
skipped the whole detour.

### The first operator account creates itself

There is no signup route, on purpose, so a fresh deployment has nobody who can
sign in. `pnpm provision:superadmin` solves that where a shell exists, and a
free Render plan has no shell, which leaves the application deployed, healthy,
and impossible to enter.

So `lib/auth/bootstrap.ts` runs from `instrumentation.ts` at startup. The guard
is that the user table must be completely empty, not that no superadmin exists.
That distinction is the whole safety argument: the moment any account exists
this is inert forever, so it can never be a way to obtain an account on a
running system, and it cannot resurrect an operator account that was
deliberately deactivated. Without `SUPERADMIN_EMAIL` it does nothing at all.

The temporary password goes to the startup log, because on a shell-less host
that is the only channel back to the operator. Anyone who can read the deploy
log can read it for as long as the log is retained. What bounds the damage is
that the account cannot be used as it stands: `mustChangePassword` is set, so
the first sign in leads to a forced change, and superadmin is above read only,
so two factor enrolment follows immediately. Someone reading the log later finds
a password that has already been replaced, and using it before then means
changing it, which is not quiet.

`instrumentation.ts` guards the import with `process.env.NEXT_RUNTIME`. That is
not defensive style, it is what makes it compile: `register()` is bundled for
the edge runtime as well as node because this application has middleware, and
the database client pulls in `pg`, which needs `fs`. Next replaces the value
with a literal per bundle, so the edge bundle eliminates the branch and never
follows the import. It is a build-time constant rather than configuration, which
is why it is read there rather than through `lib/env.ts`.
