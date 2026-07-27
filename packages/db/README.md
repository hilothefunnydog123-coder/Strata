# @assent/db

Server schema (Postgres, Drizzle) — PROMPT §4. Policies are **immutable and
versioned**: never update a policy row; insert a new version and link it via
`supersedesId`.

## The citation invariant, at the database (Level 2)

`criterion.span_id` and `criterion.verbatim_quote` are `NOT NULL`, and `span_id`
is a foreign key to `document_span`. Same for `coverage_stance`. The database
will not store a claim without its source.

## Embeddings and pgvector

The v0 corpus (8 sources) is small enough that vector similarity is computed
in-app over JSONB float arrays (`document_span.embedding`, `criterion.embedding`).
This keeps migrations runnable **without the pgvector extension**, which is not
present in every environment.

**Production upgrade path:** install `pgvector`, change those columns to
`vector(N)`, add an `ivfflat` index, and swap the in-app cosine loop in
`@assent/blueprint` for a `<->` ORDER BY. The retrieval interface is isolated so
this is a localized change.

## Commands

```bash
pnpm db:generate   # drizzle-kit: SQL migrations from the schema
pnpm db:migrate    # apply migrations (idempotent; drizzle tracks its journal)
```

`DATABASE_URL` defaults (in `.env.example`) to a local Postgres. A docker-compose
with a pgvector image is provided at the repo root for teams that want it.
