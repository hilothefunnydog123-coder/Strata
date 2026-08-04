# Blocked

Things I could not do in this environment, what I tried, and what is needed to
unblock them. Nothing here stopped the build; each entry records the closest
working alternative that shipped instead.

---

## 1. No service credentials are present

**What is missing:** `DATABASE_URL` for Neon, `MODEL_API_KEY`,
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
- **Model provider.** `lib/llm/client.ts` is written and enforces the PHI gates,
  but no live model call can be made from here. See entry 4.
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

Reachable: `registry.npmjs.org`, `fonts.googleapis.com`, `fonts.gstatic.com`,
`raw.githubusercontent.com`.

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

**What the pipeline is now proven to do.** `tests/corpus-pipeline.test.ts` runs a
real HTTP server on localhost serving a decision and a regulation in the shape
the real sources publish, and runs the real pipeline against it. Ten tests
covering: the identifying User Agent, a path refused because robots.txt
disallows it, both documents fetched and hashed and stored, a re-run skipped on
content hash, parsing into spans with usable offsets, extraction, verification
passing, a holding whose quote is not in its span being deleted rather than
flagged, embedding, and a corpus health report that is no longer empty.

So the remaining unknown is narrow: whether the government hosts serve what
`lib/corpus/sources.ts` expects at the paths it expects. Everything after the
response body is exercised.

**To unblock:** allow `www.hhs.gov`, `www.ecfr.gov`, and `www.cms.gov` through
the egress policy, then run the five corpus commands on any machine with normal
network access:

```bash
pnpm corpus:fetch --source=dab
pnpm corpus:fetch --source=ecfr
pnpm corpus:fetch --source=manual
pnpm corpus:parse && pnpm corpus:extract
pnpm corpus:verify && pnpm corpus:embed
```

`CRAWLER_CONTACT` has to be set first, and `MODEL_API_KEY` is needed for the
extract step. Until that runs, generation refuses rather than writing a letter
with no law in it. See entry 4.

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

## 4. The end to end chain has now run, against a stand-in model

**What is still missing:** a `MODEL_API_KEY`, which is entry 1.

**What has changed:** the chain now runs as one thing. `tests/generation-chain.test.ts`
drives classify, extract, retrieve, gap check, draft, verify, and persist against
a real PostgreSQL database, with the model boundary substituted and nothing else
substituted. Ten tests, including the two that matter most: a fabricated quote
discards all three attempts and leaves no partial draft behind, and an empty
corpus refuses to produce a letter at all.

The stand-in is constrained rather than scripted. It quotes only text it was
actually shown, by slicing passages out of the prompt it was given, and its
output is parsed through the caller's own Zod schema exactly as the real
boundary does. So a wiring fault anywhere between the database and the verifier
shows up as a failing test rather than as a passing one. Two real defects were
found this way on the first run: a regulation whose citation did not match what
retrieval looks for was silently never retrieved, and a fixture that said
"coverage guidelines" where the regulation says "coverage criteria" scored zero
and never reached a draft.

**What this still costs:** nobody has seen what the model actually writes. Draft
quality, and whether the prompts hold up on a real denial letter, are unmeasured.

**To unblock:** set `MODEL_API_KEY` and run the chain against a real case.

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

**To unblock:** set `MODEL_API_KEY`, populate the corpus (entry 2), then run
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
| Corpus ingestion, against the real sources | Government hosts blocked at the egress proxy. The pipeline itself is proven against a local server. | Egress for `hhs.gov`, `ecfr.gov`, `cms.gov` |
| Generation against a real model | No model provider key. The chain is proven against a stand-in at the boundary. | `MODEL_API_KEY` |
| Delivered email | No Resend key, and `api.resend.com` blocked | `RESEND_API_KEY`, `EMAIL_FROM`, egress |
| Object storage | No R2 credentials | The four `R2_*` variables |
| Deployment | No Vercel or Neon credentials | Both |
| LCD and NCD data | AMA click-through licence | A human decision, not an engineering one |
| Git tag push | Proxy answers 403 to tag pushes | Nothing: the archive branch carries the commit |

Nothing on this list is a code problem, and nothing on it required a workaround
that would have to be undone later.
