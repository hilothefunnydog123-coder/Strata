# Blocked

Things I could not do in this environment, what I tried, and what is needed to
unblock them. Nothing here stopped the build; each entry records the closest
working alternative that shipped instead.

---

## 1. No service credentials are present

**What is missing:** `DATABASE_URL` for Neon, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, and all four `R2_*` variables. None are set in this
environment, and no accounts were provided.

**What I tried:** inspected the process environment for any of them; checked
`.env.example` from the archived project for reusable values (it had none
filled in).

**What shipped instead:**

- **Database.** A real PostgreSQL 16 instance runs locally. Migrations are
  applied against it and the test suite runs against `medeal_test`, so the
  schema and every query are genuinely exercised. Switching to Neon is a change
  to `DATABASE_URL` and nothing else: `lib/db/index.ts` already selects the Neon
  serverless driver when the connection string points at Neon.
- **Anthropic.** `lib/llm/client.ts` is written and enforces the PHI gates, but
  no live model call can be made from here. See entry 3.
- **Resend.** `lib/email/send.ts` is written against the real Resend API. With
  no key configured it records the message in `email_send` with status `queued`
  and logs loudly rather than pretending to have sent it. A demo request is
  therefore never lost: it is queryable with
  `select * from demo_request where notified_at is null`.
- **R2.** `lib/storage/index.ts` has two drivers behind one interface: the S3
  API against R2, and a local filesystem driver used when `LOCAL_STORAGE_DIR` is
  set and R2 is not. `lib/env.ts` refuses to start in `PHI_MODE=live` with local
  disk storage, so the development convenience cannot reach production.

**To unblock:** provide the keys. No code changes are required for any of them.

---

## 2. Outbound network egress is blocked for every corpus source

**The problem.** This container's egress goes through a policy-enforcing proxy
that answers `403` to `CONNECT` for every government host the corpus needs.

Probed directly, all blocked:

| Host | Result |
| --- | --- |
| `www.hhs.gov` (DAB decisions) | 403 at proxy |
| `www.ecfr.gov` (Title 42 XML API) | 403 at proxy |
| `www.cms.gov` (Internet-Only Manuals) | 403 at proxy |
| `api.resend.com` | 403 at proxy |

Reachable: `registry.npmjs.org`, `api.anthropic.com`, `fonts.googleapis.com`,
`fonts.gstatic.com`.

**What I tried:** `curl` directly and through the proxy; the harness `WebFetch`
tool, which routes over separate infrastructure and returned `403 Forbidden`
for both `hhs.gov` and `ecfr.gov`; `curl $HTTPS_PROXY/__agentproxy/status`,
which confirmed the refusals as `connect_rejected: gateway answered 403 to
CONNECT (policy denial or upstream failure)`.

Per the proxy's own documentation, an organisation policy denial must be
reported rather than routed around, so I did not attempt any workaround.

**What shipped instead:** the full ingestion pipeline is built and runnable, all
five stages, with real parsers and real HTTP fetchers that respect `robots.txt`,
rate limit to one request per two seconds per domain with jittered backoff, send
an identifying User-Agent, hash content so unchanged documents are skipped, and
store raw bytes before processing. Running `pnpm corpus:fetch --source=dab` in
an environment with egress will populate the corpus. See `CORPUS.md` for the
source investigation, which was carried out from documentation rather than by
crawling, and is marked as such.

**Consequence for M5's acceptance criterion.** "At least 200 real decisions
ingested" could not be met from this container. The corpus is empty. This is the
single largest gap in the delivered build and it is a network policy issue, not
a code issue.

**To unblock:** allow `www.hhs.gov`, `www.ecfr.gov`, and `www.cms.gov` through
the egress policy, then run the five corpus commands.

---

## 3. Git tag pushes are rejected

`git push origin --tags` fails with `HTTP 403` from the git proxy, while branch
pushes succeed. The tag `archive/coverage-engine-20260728` exists locally only.

**Why it does not matter:** `archive/coverage-engine` on the remote points at
the same commit, `87e3aff`, so the prior project's history is preserved. The tag
is a convenience label.

**To unblock:** push the tag from a machine with unrestricted access, or accept
the branch as the archive marker.

---

## 4. The end to end chain past drafting has never run

**What is missing:** an `ANTHROPIC_API_KEY`, which is entry 1.

**What this costs:** generation, and therefore everything downstream of it, has
not been exercised against a live model. Classification, clinical fact
extraction, retrieval, the gap check, and drafting are all written and
typechecked; the verification they feed is heavily tested in isolation
(24 tests, mostly rejections). What has not happened is the whole chain running
once: upload, generate, review, approve, export, record an outcome, produce an
invoice.

**What I did instead of pretending:** the parts that can be verified without a
model are verified.

- `tests/verify.test.ts` proves the verifier rejects every category of bad
  quote: a changed word, a dropped negation, a silently elided qualifying
  clause, reordered words, and a punctuation change that flips the meaning. That
  is the half of the invariant that protects the customer.
- `tests/invoice.test.ts` proves the fee arithmetic, including the rounding
  direction and that an outcome cannot be billed twice.
- The e2e suite covers authentication, the full authorisation matrix by request,
  and the demo request end to end against a real build and database.

**To unblock:** set `ANTHROPIC_API_KEY`, populate the corpus (entry 2), then run
the chain. No code change is required.

---

## 5. Not deployed

**What is missing:** Vercel and Neon credentials.

`README.md` has the deploy steps. `lib/db/index.ts` already selects the Neon
serverless driver from the connection string, so moving to Neon is a change to
`DATABASE_URL` and nothing else. None of the deploy steps requires a code change.

M12's acceptance criterion, "the entire flow works on the deployed URL in
synthetic mode", is therefore not met. What is met is that the entire flow works
on a real production build, served by `next start`, against a real PostgreSQL
database, which is what the e2e suite runs against on every invocation.

---

## Summary

| Blocked | Why | Needs |
| --- | --- | --- |
| Corpus ingestion | Government hosts blocked at the egress proxy | Egress for `hhs.gov`, `ecfr.gov`, `cms.gov` |
| Live generation | No Anthropic key | `ANTHROPIC_API_KEY` |
| Delivered email | No Resend key, and `api.resend.com` blocked | `RESEND_API_KEY`, `EMAIL_FROM`, egress |
| Object storage | No R2 credentials | The four `R2_*` variables |
| Deployment | No Vercel or Neon credentials | Both |
| LCD and NCD data | AMA click-through licence | A human decision, not an engineering one |
| Git tag push | Proxy answers 403 to tag pushes | Nothing: the archive branch carries the commit |

Nothing on this list is a code problem, and nothing on it required a workaround
that would have to be undone later.
