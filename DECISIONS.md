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

### Netlify: three consequences of not having a server

Adding Netlify alongside Render was mostly configuration, but three differences
are structural rather than cosmetic, and each is handled rather than papered
over.

There is no start command, so migrations cannot run at boot. `pnpm
deploy:prepare` runs them in the build, followed by the first-operator
bootstrap. Both are idempotent, which is what makes running them on every deploy
correct rather than merely tolerable: the migrator skips what it has applied,
and the bootstrap does nothing unless the user table is empty. The bootstrap is
now reachable two ways, from `instrumentation.ts` on a host that runs a server
and from `scripts/bootstrap.ts` on one that does not, and both call the same
guarded function rather than reimplementing the guard.

The filesystem is not durable. `LOCAL_STORAGE_DIR` on a serverless host writes
to a function's own `/tmp`, which is not shared between invocations and does not
survive one, so an upload would be unreadable by the next request. This is not
worth a code change: `lib/env.ts` already refuses local storage in
`PHI_MODE=live`, and the same reasoning simply applies one host earlier. It is
recorded in `netlify.toml` and the README instead.

`resolveOrigin` now takes a list of platform candidates rather than one, and
prefers `DEPLOY_PRIME_URL` over `URL`. On a preview deploy those differ, and the
browser is talking to the first. Issuing cookies against the production origin
would produce a preview deploy that accepts a password and then does nothing,
which is the same silent failure the explicit-origin check was written to avoid.

### A test that was passing by luck

`tests/crypto.test.ts` checked that an altered ciphertext fails to decrypt by
flipping the last character of the base64url text. That is not always an
alteration: the trailing character of a base64 string can carry unused bits, so
two different characters decode to the same bytes, and the test passed or failed
depending on the random key and IV of that run. It failed once in a hundred-odd
runs, which is exactly the kind of test that gets rerun until green and then
believed.

It now decodes to bytes, flips a bit, and re-encodes, and there is a matching
test for a tampered authentication tag. Deterministic in both directions.

### Deploys are opt-in, because build minutes are metered

A repository under active development pushes far more often than it needs
deploying, and on Netlify every push to the production branch spends build
minutes whether or not anything user-visible changed.

Three things now stand between a push and a bill. Branch deploys and deploy
previews are cancelled by context in `netlify.toml`, so work in progress costs
nothing. Production builds run `scripts/netlify-should-build.sh`, which skips
the build when a push touched only documentation, since the artifact would be
identical. And the working rule is that `main` moves when a deploy is wanted
rather than whenever a commit exists.

The script inverts the way you would expect an exit code to read: Netlify treats
exit 0 as cancel and non-zero as proceed. It fails toward building. No cached
commit to compare against, or a git command that errors, both proceed, because a
cost control that silently stops deploys costs more than it saves.

Worth being precise about the limit: Netlify still starts a runner to evaluate
`ignore`, so a cancelled build is cheap rather than free. Turning the contexts
off in the dashboard stops it earlier.

### Importing a module should not open a socket

The first Netlify deploy failed, and the cause was worth more than a
configuration fix. `lib/db/index.ts` built its client at module scope and
`lib/auth/index.ts` called `betterAuth()` at module scope, so importing either
read the environment. `next build` imports every route module to collect its
metadata, which meant the build demanded a database URL and a session secret in
order to emit static assets. Both are now built on first use behind a proxy.

Pages behind a session also declare `dynamic = 'force-dynamic'`, at the layout
level for the three portal trees and per page for the auth and account pages
that have no layout of their own. They were already dynamic in effect. Saying so
stops the build attempting to prerender them and abandoning the attempt only
once a request API is touched, which is a detour that cost the build its
environment independence.

The build still requires the environment, and that is correct rather than a
remaining defect. `/contact` renders the address demo requests are delivered to.
A static page whose content comes from configuration needs that configuration
when the content is produced. What changed is that only pages that genuinely
consume a value now depend on one.

`scripts/check-env.ts` runs first in `deploy:prepare` for the same reason. A
missing variable used to surface two minutes into a build as a prerender error
naming one page, leaving the real cause to be inferred. It now appears at the
top of the log, listing every missing variable at once, before anything is
compiled.

### An unconfigured deployment serves its public pages

Refusing to start without an environment is right for a production instance and
wrong for a first deploy, where the point is to see whether the thing deploys
and what it looks like. Setting up a database in order to find that out is the
wrong order.

So absence and misconfiguration are now different states. A deployment with
nothing set is unconfigured: it builds, it starts, it serves every public page,
and a banner on every one of them names the variables that are missing. Sign in
answers with the same explanation rather than offering a form that cannot work.
The portals redirect there. Nothing pretends to function.

The safety of this rests on one condition, and it is enforced in `envStatus()`
rather than documented and hoped for: unconfigured mode is available only when
there is no `DATABASE_URL`. No database means no data, which means a half
running instance has nothing it could expose. The genuinely dangerous shape, a
reachable database while the encryption key or session secret is missing, is not
degraded, it throws exactly as it did before. That case is now a louder error
than it used to be, because it says which of the two situations it is in.

The unconfigured environment uses empty strings rather than invented values.
A page that would show a configured address shows nothing, under a banner
explaining why. Inventing a plausible looking address would be fabricating
content, which is a worse answer than a blank.

`lib/db` and `lib/auth` check the same status and refuse before constructing
anything, so the empty strings are unreachable rather than merely unused.

### The build skip skipped the first build

The cost control cancelled the deploy it was supposed to be protecting. Netlify
set `CACHED_COMMIT_REF` and `COMMIT_REF` to the same commit, having no earlier
successful build to measure against, and `git diff` between a commit and itself
reports no changes, which the script read as a documentation-only push.

The bug is not the comparison, it is the assumption underneath it: that two
refs always describe a range. Identical refs mean there is nothing to compare,
which is a different thing from nothing having changed, and it also describes
every manual retry of the same commit. So the retry button could never have
worked either.

Three guards now precede the diff, and all three build: refs absent, refs
identical, and a cached commit that is not present in the clone, which Netlify
makes possible by cloning with `--filter=blob:none`. That last one previously
would have had git fail and the script decide on an error.

The original note said this script fails toward building. It did not, in the
one case that mattered most, which was the first build. Stating a principle is
not implementing it.

### The public pages carry weight instead of grey

Secondary text on the marketing pages was a lighter grey at a smaller size. It
is now full strength ink at semibold, same sizes, so nothing moves. Emphasis
inside those passages went to bold, because the first pass left highlighted
spans lighter than the body around them, which inverted the hierarchy it was
meant to create.

This is closer to the original design brief rather than a departure from it.
That brief forbade low contrast grey and asked for 7:1 throughout; a second ink
tone for long passages was a compromise that crept back in.

The unconfigured banner is gone from the public pages. It was right that a
half configured deployment should say so, and wrong about where. Those pages are
static marketing that reads correctly whether or not a database exists, so a
warning across them told a visitor something true and useless about a page that
was working perfectly, and told anyone being shown the product that it was
broken. The explanation now lives only where it is load bearing: on sign in,
where the alternative is a form that takes a password and fails.

### The demonstration seeds real verification over synthetic content

`scripts/seed-demo.ts` exists because a deployment with an empty corpus and no
model key is impossible to evaluate, and the gap between "the product is built"
and "here, look at it" was doing real damage in conversations.

The design rule is the one that matters: the content is invented, the checking
is not. Every quote the script writes is produced by slicing it out of the
passage it cites, so it cannot drift through a typo, and is then put through the
production `verifyQuote` against the real source text. If any quote fails, the
script refuses to write anything. The letter view's click-to-source, the
highlight offsets and the reviewer checklist are therefore exercising the same
code paths on this data that they would on a real case.

A demonstration that stubbed the verification would be demonstrating the one
thing this product cannot afford to fake.

Two honesty markers are built in. The regulation passages are genuine federal
text and cited as such; the two appeal decisions are written for the
demonstration and cited as DEMO-DAB-0001 and DEMO-DAB-0002 so they cannot be
mistaken for precedent. Every denial is tagged synthetic, so the same upload
rule that protects real records applies to the demonstration too.

### A correlated subquery bound to the wrong table

Seeding the demonstration surfaced four bugs that an empty database had been
hiding, all from one root cause, and one of them was silent.

Drizzle renders an interpolated column inside a `sql` template as a bare
identifier: `${organization.id}` becomes `"id"`, not `"organization"."id"`. At
the top level of a query that is unambiguous. Inside a correlated subquery it is
not. `select count(*) from member m where m.organization_id = "id"` resolves
`"id"` against `member`, so the condition compares a row to itself and matches
nothing.

Where the two columns had different types the database refused outright: the
organisations console page returned 500 with `operator does not exist: text =
uuid`, because `"id"` had bound to `invoice.id`. Where the types happened to
agree there was no error at all, just wrong numbers. The review queue reported
zero assertions on a draft holding six, and the campaign counters reported zero
sent, zero queued, zero skipped, forever.

The silent case is the one worth remembering. A reviewer opening a draft that
says "0 assertions" concludes the drafting failed, when in fact the letter is
there and the count is lying.

Every instance now writes the qualified identifier literally. Fixed in the
organisations page, the email console's campaign and contact counters, and the
review queue's assertion count and approval flags.

None of this was reachable with an empty database, which is exactly why the
demonstration seed earned its place: the first data in the system found four
faults in an hour.

### The database pool was rebuilt on every query

Found while measuring why a page failed under the demonstration: connections
peaked at ninety six from a handful of page views, then Postgres refused.

Making the client lazy, to keep secrets out of the build, left the cache behind.
`client()` consulted `globalThis.__medealDb`, which is only ever populated
outside production, so in production nothing was cached and every property
access through the proxy built a fresh pool of ten. The development path worked
precisely because it had a cache, and the production path silently had none.

There is now a module level cache consulted first, with the global kept only for
the hot reload case it was written for. The same measurement afterwards peaks at
sixteen. On a hosted database with a connection ceiling this would have looked
like the database falling over under trivial load.

### Walking the onboarding, and one more ambiguous column

The demonstration seed answers "can I see it working". It does not answer "what
is it like to set a customer up", so the operator path was walked end to end in
a browser with nothing pre-seeded: provision the operator, create the hospital,
create its first user, hand over the password, sign in as that user, file a
denial.

It works, and it is quick. Roughly eight and a half seconds of machine time
across the whole sequence, the slowest single step being the denial intake at
2.2 seconds including two file uploads.

One fault was found and fixed. `/admin/users` returned 500 with `column
reference "id" is ambiguous`, the same drizzle interpolation problem as the
others: `${user.id}` renders as a bare `"id"` and the subquery joins `member`
to `organization`, both of which have one. Qualified now.

One piece of friction is real and left as is for the moment: creating an
organisation does not derive the slug from the name, so an operator types it
twice in different shapes. Worth fixing when the console next gets attention;
not worth a schema change today.

Two hypotheses were pursued and both were wrong, which is worth recording
because the changes looked plausible. The provisioning form appeared not to
render the one time password, and `router.refresh()` and then `revalidatePath`
were each blamed and each removed. Neither was the cause. The test harness was
reading the DOM after the network went idle, which happens before React commits
the transition, so the result had genuinely not rendered yet. Waiting for the
rendered notice rather than the network showed the password every time. Both
speculative changes were reverted rather than left in as harmless, because a
change with a wrong reason attached is worse than no change.
