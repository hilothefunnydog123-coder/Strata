# Ship check

Section 17 of the build specification, line by line, with the evidence rather
than a tick. Where something is not fully met, it says so and says why.

Run these to reproduce every claim below:

```bash
pnpm typecheck && pnpm lint && pnpm check:forbidden && pnpm test && pnpm e2e
```

---

## The list

### No mock, seed, demo, or placeholder data anywhere in the codebase

**Met.** There is no seed script and no fixture data in any shipped path.

Every figure the application shows is computed from records:
`lib/denials/queries.ts` for the client dashboard, `lib/corpus/pipeline.ts` for
corpus health, and direct aggregates for model spend and the job queue. With no
records, they return zeros and the interface says so in words.

Two places contain fabricated content on purpose, and neither ships as data:

- `app/styleguide/page.tsx` renders illustrative rows so a table can be checked
  against a change to a primitive. It is a component gallery, not a data source,
  and it is `robots: noindex`.
- `tests/` and `e2e/` contain fabricated denials and decisions. Test fixtures.

### No TODO or unimplemented function in any shipped path

**Met.** No `TODO`, `FIXME`, or stub returning a hardcoded value in `app/` or
`lib/`. Verify with `grep -rn "TODO\|FIXME" app lib`.

### Every button, link, and form works

**Met for everything that ships.** Every form posts to a real server action that
writes to the database, every link resolves to a route that exists, and every
button either performs its action or is disabled with the reason stated next to
it.

Two behaviours depend on credentials that are absent here, and both degrade
honestly rather than pretending:

- **Email** records the composed message in `email_send` and reports
  "no mail provider is configured" rather than claiming a send. The demo request
  row is stored either way, and `notified_at` stays null so the lead is
  recoverable.
- **Generation** requires `ANTHROPIC_API_KEY`. Without it the boundary throws a
  message naming the missing configuration and stating that nothing was
  transmitted.

### Every role tested against every route

**Met, twice over.**

- `tests/authorization.test.ts`: 233 assertions walking every role against every
  permission and every surface, plus a test that fails if a permission is added
  without a decision being recorded for it.
- `e2e/auth.spec.ts`: the same matrix by request against a running server. Each
  role signs in for real, then fetches each surface from inside its own
  authenticated session. Allowed surfaces must answer 200 at the address asked
  for; refused ones must answer 403, which is distinguishable from the 307 an
  unauthenticated request gets.

### No patient content in any log output

**Met.** `redact()` runs inside the logger, so there is no call path that skips
it. Three independent filters: field name, value shape, and length. Exception
traces go through the same path, including the extra properties database drivers
attach to an error, which is the usual way a row leaks into a log.

16 tests in `tests/redact.test.ts`, including clinical narrative hidden under an
innocent key, a driver error carrying the offending row, a nested `cause`, and
binary payloads.

`console.*` is a lint error everywhere except the logger itself.

### Every assertion in every generated letter verified

**Met, structurally.** Four levels, described in `README.md` and implemented in
`lib/appeals/assertion.ts`, the schema, `lib/appeals/verify.ts`, and
`components/appeal/letter-view.tsx`.

A draft with any failing assertion is discarded whole and regenerated. Three
consecutive failures throw `GenerationError`, which the interface surfaces with
the specific failures rather than inviting another attempt.

24 tests in `tests/verify.test.ts`, and the ones that matter are the rejections:
a changed word, a dropped negation, a silently elided qualifying clause,
reordered words, and a punctuation change that flips the meaning.

**Not demonstrated end to end here**, because generation needs an Anthropic key
this environment does not have. What is demonstrated is that the verifier
correctly rejects every category of bad quote, which is the half that protects
the customer.

### PHI_MODE defaults to synthetic with a visible banner

**Met.** Default is in `lib/env.ts`. `PhiBanner` is rendered by
`components/shell.tsx`, which frames every authenticated surface, and separately
by the account pages that sit outside the shell. `instrumentation.ts` logs a
warning at startup.

`PHI_MODE=live` refuses to boot without `ANTHROPIC_BAA_CONFIRMED=true`, without
a distinct `PHI_ENCRYPTION_KEY`, and without R2 storage. Verified by running the
env guard with each condition removed.

### Untagged uploads rejected

**Met.** `assertUploadPermitted()` in `lib/denials/upload.ts` throws before any
byte reaches storage or any row reaches the database.
`app/(portal)/app/denials/new/actions.ts` calls it before reading the uploaded
files. There is no parameter that skips it.

### The Anthropic SDK is called from exactly one file

**Met and enforced.** `lib/llm/client.ts`. The `no-restricted-imports` rule in
`eslint.config.mjs` makes importing `@anthropic-ai/sdk` anywhere else a build
failure. Verify with `grep -rn "@anthropic-ai/sdk" app lib scripts`.

### No forbidden design pattern from section 14 present

**Met.** The mechanically checkable half runs in CI as `pnpm check:forbidden`:
em dashes, gradients, backdrop blur, purple and indigo and violet, emoji, and
any visual reference to artificial intelligence. It currently reports clean.

The judgment calls are argued in `DESIGN.md` section 8, item by item.

Two things the check caught and that were fixed rather than excused: literal em
dashes inside the character classes that normalise them, now written as unicode
escapes, and a check mark glyph in the review checklist, now a drawn SVG.

### No em dash anywhere in the repository

**Met.** `pnpm check:forbidden` reports clean. `DESIGN.md` is the one allowed
file, because it quotes the rule itself.

### Demo request email verified delivered to a real inbox

**Not met, and it cannot be met from here.** `api.resend.com` is blocked at this
environment's egress proxy, and no `RESEND_API_KEY` was provided. See
`BLOCKED.md`.

What is verified instead, by `e2e/demo-request.spec.ts` against a real build and
a real database: a submission stores the row, composes the operator notification
carrying every field, composes the confirmation to the requester, and hands both
to the mail layer, which records the outcome either way rather than dropping it.
The assertion checks the message body for every field by name.

To finish this line: set `RESEND_API_KEY` and `EMAIL_FROM`, submit the form, and
confirm the message at `DEMO_REQUEST_TO`. No code change is needed.

### All work pushed

**Met**, to `claude/appeals-platform-build-topyk5` rather than to `main`. The
reason is recorded in `DECISIONS.md`: this session carries a standing constraint
that pushes go to the designated branch. Merging that branch into `main` reaches
the same end state under the repository owner's control.

The prior project is preserved on `archive/coverage-engine` at commit `87e3aff`.

---

## What is not finished

Stated plainly, because a ship check that only lists successes is not a ship
check.

1. **The corpus is empty.** Every government source is unreachable from this
   environment by network policy. The pipeline is written and unit tested but
   has never made a live request, so M5's "at least 200 real decisions" is not
   met. This is the largest gap in the build. `BLOCKED.md` entry 2.

2. **Generation has never run against a live model.** No API key. The
   classification, extraction, retrieval, gap check, drafting, and verification
   code paths are all written; verification is heavily tested in isolation.

3. **Not deployed.** No Vercel or Neon credentials. `README.md` has the deploy
   steps; none of them requires a code change.

4. **The e2e suite covers the workflow gates but not generation.**
   `e2e/workflow.spec.ts` builds a draft directly through the same tables
   generation writes to, then exercises everything downstream: both review gates,
   the export block, rejection returning the case with notes visible, an edit
   being refused when its quote is not in the source, and a recorded win
   producing an invoice at the organisation's rate to the cent. What it does not
   cover is whether the model produces a good draft, because that needs a key
   this environment does not have. The gap is stated rather than papered over.
