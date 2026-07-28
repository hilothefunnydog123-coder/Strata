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
