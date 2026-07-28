# Assent

**The queryable specification of US health-insurance coverage policy.**

FDA approval is not permission to get paid. A diagnostic must separately win a coverage
decision from each of ~900 payers, each of which publishes — in prose — exactly what
evidence it requires before it will pay. Nobody has ever compiled that corpus into
structured form. Assent does, for one therapeutic area first (molecular oncology
diagnostics), and turns *"what will payers require of my $40M trial?"* from an
unknowable guess into a lives-weighted, fully-cited cost/benefit decision.

> Working name is **Assent** (trademark unverified). It lives in one place —
> `packages/core/src/product.ts` — so it can be changed in one edit.

## The one commitment: the citation invariant

> No claim may exist in this system without a verbatim span of source text supporting
> it, and that span must be programmatically verified to exist in the stored source.

Enforced at four levels: **types** (`Criterion`/`CoverageStanceRecord` require `spanId`
+ `verbatimQuote`; the only constructors are `makeVerifiedCriterion`/`makeVerifiedStance`),
**database** (`NOT NULL` + FK), **verification** (`verifyQuote` folds whitespace/unicode
and asserts a verbatim substring; failure is *discarded* to `RejectedExtraction`, never
repaired), and **UI** (every requirement is click-to-source; the signature highlight
illuminates the exact supporting paragraph). Precision beats recall by an enormous margin:
one fabricated requirement would end the customer's company and ours.

## Repo layout

```
apps/web            Next.js — marketing + gated dashboard + API (auth, device flow, demo)
apps/desktop        Tauri v2 (Rust shell) + React — the instrument (modules M1–M6)
packages/core       Shared types, the citation invariant, zod schemas, product constants
packages/db         Server Postgres schema (Drizzle) — immutable, versioned policies
packages/local-db   Desktop SQLite schema + FTS5 (the reason it's a desktop app)
packages/ingest     Fetchers (one per source), robots + rate-limit, fixture loader
packages/parse      HTML/PDF → normalized text + span index
packages/extract    LLM extraction + citation verification + diff classification
packages/blueprint  Clustering, lives-weighting, frontier synthesis
packages/ui         Design system (reserved colors) + the CitationView signature
packages/evals      Golden set + scoring harness (built in week one)
scripts             Pipeline CLI (ingest/parse/extract/verify/diff/blueprint/…)
fixtures            Committed raw snapshots + golden sets for offline dev
```

## Quick start (offline — no network, no API key)

```bash
pnpm install
pnpm eval                       # precision/recall/F1, kind accuracy, hallucination = 0
pnpm --filter @assent/local-db bench   # FTS5 over 300k spans, < 50ms

# The full server pipeline (needs a Postgres — see below):
createdb assent_dev && export DATABASE_URL=postgres://localhost/assent_dev
pnpm db:generate && pnpm db:migrate
pnpm db:seed                    # account + admin user (password + TOTP) + a demo asset
pnpm pipeline                   # ingest → parse → extract → verify → diff (all offline)
pnpm blueprint --asset=asset_demo
pnpm export-desktop ./data/assent-desktop.sqlite

# Web app (marketing + dashboard):
pnpm --filter @assent/web dev   # http://localhost:3000
# Get the demo TOTP code:  pnpm --filter @assent/scripts exec tsx src/cli.ts totp
```

### Standalone mode (no database)

With `DATABASE_URL` unset, the console runs from the corpus bundled in the image
instead of failing: sign-in, the dashboard, the coverage summary and `/terminal` all
work against `corpus.json`, backed by the committed founder account.

It is a travel/demo posture, not a deployment target — one account, nothing durable,
and sessions plus authenticator enrollment reset when the process restarts. Demo
requests, device pairing and eval runs still need Postgres and say so rather than
pretending to work.

**Reverting is setting one variable.** The mode is chosen by whether `DATABASE_URL`
exists, asked at each call site; there is no flag to unset and nothing to migrate,
because standalone never writes anything durable. Set it and the Postgres paths
resume unchanged. `/api/diagnostics` always reports which mode is live.

### Your own console login

`pnpm db:seed` creates a *demo* login whose password is a constant in this repo and
whose TOTP secret is otplib's published example — fine for a fixture, useless as a
credential.

**On a deploy**, the founder account provisions itself: the container runs
`pnpm founder --bootstrap` on boot, creating an admin account from the committed
email and password hash in `scripts/src/founder.ts`. It is inert once the account
exists, so a redeploy never resets the owner's credentials.

That account is created with **no second factor**, because there is no safe channel
to ship one over — anything committed alongside the password is a shared secret, and
a shared second factor is not a second factor. It signs in on the password alone,
reaches only `/enroll`, and the console refuses to render until an authenticator is
bound. Enrolling flips `totp_enrolled` and the password-only path becomes permanently
unreachable for that user.

**With a shell on the database**, the interactive form generates everything locally
and prints it once:

```bash
pnpm founder --email you@yourdomain.com --org "Your Company, Inc."
```

Only a scrypt hash is stored, so nothing is recoverable afterwards. `--rotate` issues
new credentials and revokes every live session and paired desktop.

`PIPELINE_MODE=fixture` (default) runs everything from committed fixtures with zero network.
`PIPELINE_MODE=live` fetches real documents (robots-respecting, rate-limited) and calls the
LLM — see `.env.example` and `docs/STATUS.md`.

## Pipeline (discrete, resumable, idempotent — checkpoints to Postgres)

```
pnpm ingest    --source=aetna --since=2024-01-01
pnpm parse
pnpm extract   --limit=50
pnpm verify
pnpm diff      --payer=moldx
pnpm blueprint --asset=<id>
```

## What's proven, and what needs external resources

See **`docs/STATUS.md`** for the milestone-by-milestone acceptance table and the honest
boundaries (live payer crawling, a paid LLM key at scale, notarized desktop binaries,
pgvector). **`docs/PRE-BUILD.md`** has the source/robots analysis, the criterion taxonomy
derivation, and the design plan; **`docs/DESIGN.md`** is the visual language.

## Design

A professional instrument for a nine-figure decision — closer to a trading terminal than
consumer SaaS. Dense, quiet, high information ratio. Color is load-bearing and rationed:
coverage stance, change direction, and the citation accent are three reserved, non-
overlapping palettes used nowhere else, so state is readable from color alone. The
signature is the citation highlight — the product's thesis made physical.

## Stack

TypeScript everywhere (Node 20+). pnpm workspaces + Turborepo. Next.js App Router, Postgres +
Drizzle. Tauri v2 + React for desktop; SQLite + FTS5 local. `@anthropic-ai/sdk`
(`claude-sonnet-4-6`) for extraction/diff. Vitest.
