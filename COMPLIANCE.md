# Compliance

Written for a hospital security reviewer. Each of the seven requirements is
listed with the file and function that implements it, so you can read the code
rather than take our word for it.

**Start here, because it changes how you should read the rest.** Medeal does not
currently process protected health information for anyone. It runs in synthetic
mode: every uploaded document must be affirmed as fabricated at upload, anything
without that affirmation is rejected before a byte is stored, and a banner says
so on every authenticated screen.

Live mode is unreachable without two independent things being configured: a
signed Business Associate Agreement with you, and model access inside a
HIPAA-ready Anthropic API organisation covered by a BAA with Anthropic. The
application refuses to start in live mode unless both are set. There is no
override flag, and adding one would mean editing `lib/env.ts` and getting it
through review.

---

## 1. Two data classes

**Every table holding clinical content is marked PHI in the schema and in code.
PHI tables are encrypted at rest with a separate key and are never joined into
analytics queries.**

| Where | What it does |
| --- | --- |
| `lib/db/schema.ts` → `PHI_TABLES`, `isPhiTable()` | The classification itself. Ten tables are listed: `denial`, `denial_document`, `denial_span`, `clinical_fact`, `appeal_draft`, `assertion`, `assertion_review`, `review_action`, `submission`, `outcome`. |
| `lib/db/crypto.ts` → `encryptedText` | A Drizzle custom column type. AES-256-GCM on the way in, decrypt on the way out. Encryption is a property of the column definition, so no query has to remember it. |
| `lib/db/crypto.ts` → `encryptField()`, `decryptField()` | The cipher. Stored form is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix exists so a future key rotation can read old rows while writing new ones. |
| `lib/env.ts` → `parse()` | Requires `PHI_ENCRYPTION_KEY`, requires it to decode to exactly 32 bytes, and **rejects the configuration if it equals `BETTER_AUTH_SECRET`**. PHI gets its own key so rotating or leaking a session secret does not expose clinical records. |
| `lib/analytics/guard.ts` → `assertAnalyticsSafe()`, `analyticsQuery()` | Cross-organisation metrics declare the tables they read. Naming a PHI table throws `PhiInAnalyticsError` at call time. |

Which columns are encrypted: `denial.denial_basis_text`, `denial_span.text`,
`clinical_fact.verbatim_quote`, `clinical_fact.normalized_value`,
`appeal_draft.body_json`, `assertion.text`, `assertion.verbatim_quote`,
`assertion_review.notes`, `review_action.notes`.

**A consequence worth knowing:** an encrypted column cannot be searched with SQL
`LIKE` or indexed for text search. That is intentional. Clinical text is
retrieved by span identifier, never by scanning.

**A deliberate line in the analytics guard.** `invoice` is on the analytics
allowlist because it holds money and an organisation identifier and nothing
about a patient. `outcome` is not, even though it also holds money, because it
hangs off a denial and is classified PHI. Cross-organisation revenue reporting
therefore reads invoices, which is the correct source for it anyway.

The key is required in **every** mode, not only live. Synthetic content is
encrypted too, so the code path that protects real records is the one exercised
every day rather than a branch that first runs in production on the day real
patient data arrives.

---

## 2. Protected information never enters a log

**No patient content in console output, error messages, exception traces, or
third-party telemetry.**

| Where | What it does |
| --- | --- |
| `lib/log/redact.ts` → `redact()` | The entry point. Walks any value, applying all three filters below. |
| `lib/log/redact.ts` → `isPhiKey()` | Filter one, by field name. A field called `notes`, `text`, or `verbatim_quote` is clinical by construction, whatever it happens to contain today. Matched case and separator insensitively, so `verbatimQuote`, `verbatim_quote`, and `VERBATIM-QUOTE` all match. |
| `lib/log/redact.ts` → `redactString()`, `VALUE_PATTERNS` | Filter two, by value shape. Social security numbers, medical record numbers, Medicare beneficiary identifiers, dates of birth, service dates, phone numbers, and email addresses are masked wherever they appear, including under an innocent key. |
| `lib/log/redact.ts` → `MAX_STRING` | Filter three, by length. Any string over 160 characters is replaced by its length. Free text beyond a few sentences is presumed to be clinical narrative. |
| `lib/log/redact.ts` → `redactError()` | Errors specifically: message scrubbed, stack scrubbed line by line and capped, nested `cause` recursed, and **the extra enumerable properties database drivers attach to an error** run through the object path. That last one is the usual way a row leaks into a log. |
| `lib/log/index.ts` → `emit()` | Calls `redact()` on every context object before serialising. This is inside the logger, not at the call site, so a developer cannot forget it. |
| `eslint.config.mjs` → `no-console` | `console.*` is a lint error everywhere except `lib/log/index.ts`. |

**Tested in `tests/redact.test.ts`**, 16 tests, including clinical narrative
hidden under an innocent key, a driver error carrying the offending row, a
nested `cause`, circular structures, and binary payloads.

---

## 3. Every access is audited

**Every read or write of a PHI record writes an AuditLog row: who, which record,
what action, when, from what IP. Append only.**

| Where | What it does |
| --- | --- |
| `lib/db/schema.ts` → `auditLog` | The table. Carries `user_id`, `organization_id`, `action`, `entity_type`, `entity_id`, a `phi` boolean, `ip`, `user_agent`, `created_at`. |
| `lib/audit.ts` → `audit()` | The only writer. Derives the `phi` flag from `isPhiTable(entityType)` rather than trusting the caller to set it. |
| `lib/audit.ts` → `requestIdentity()` | Reads the client address from `x-forwarded-for` (first entry), `x-real-ip`, or `cf-connecting-ip`, plus the user agent. |
| `lib/audit.ts` | Exports one write and two reads: `audit()`, `auditForEntity()`, `recentAudit()`. **There is no update and no delete path** for this table anywhere in the codebase. |
| `lib/auth/index.ts` → `databaseHooks.session.create.after` | Every sign in leaves a row. Hooked at session creation rather than at the sign-in route, so the second factor path and any future provider are covered too, because all of them end in a session. |
| `lib/appeals/workflow.ts` → `transition()` | Every workflow transition writes a row. |

Audit rows carry identifiers and never content. An audit trail that quoted the
record it was protecting would be a second copy of the PHI under weaker
handling, which is the opposite of the point.

**One honest caveat.** `audit()` logs and swallows a write failure rather than
failing the user's request. That is a considered trade: an audit write failing
should not take down a clinician's screen mid-appeal. If your policy requires
"no read without a durable audit row", `lib/audit.ts` is the one place that
changes, and we will make that change.

---

## 4. Synthetic mode

**Every uploaded document must be explicitly tagged synthetic. A persistent
banner displays across every authenticated surface. No bypass.**

| Where | What it does |
| --- | --- |
| `lib/env.ts` → `PHI_MODE` | Defaults to `synthetic`. |
| `lib/denials/upload.ts` → `assertUploadPermitted()` | The gate. Throws `UntaggedUploadError` before any byte reaches storage or any row reaches the database. |
| `app/(portal)/app/denials/new/actions.ts` → `createDenial()` | Calls the gate before writing anything, and before reading the uploaded files. |
| `lib/db/schema.ts` → `denial.is_synthetic` | `NOT NULL`. Every case records the affirmation that was made about it. |
| `components/phi-banner.tsx` → `PhiBanner` | The banner. Rendered by `components/shell.tsx`, which frames every authenticated surface, and separately by the account pages that sit outside the shell. |
| `instrumentation.ts` → `register()` | Logs the mode at startup and warns when it is synthetic. |

The tag runs one way on purpose: in synthetic mode the uploader must affirm the
documents are fabricated. In live mode no affirmation is demanded, because real
patient documents are the expected content there and requiring a tick would
train people to click through it.

---

## 5. The model boundary

**All model calls route through one module, which checks `PHI_MODE` and
`ANTHROPIC_BAA_CONFIRMED` and throws before transmitting anything if the
combination is not permitted. No other file may call the Anthropic SDK.**

| Where | What it does |
| --- | --- |
| `lib/llm/client.ts` → `assertTransmissionPermitted()` | The three gates: a key must exist; live mode requires `ANTHROPIC_BAA_CONFIRMED=true`; synthetic mode refuses any call the caller declared as containing PHI. Each failure names which gate closed and states that nothing was transmitted. |
| `lib/llm/client.ts` → `complete()` | The only function that calls the SDK. Every model interaction in the product goes through it and returns validated against a Zod schema, so no downstream code handles a free text completion. |
| `eslint.config.mjs` → `no-restricted-imports` | Importing `@anthropic-ai/sdk` anywhere except `lib/llm/client.ts` is a build failure. A second call path cannot quietly appear beside this one. |
| `lib/llm/client.ts` → `LlmRequest.containsPhi` | Required, not optional. A caller that cannot make the declaration cannot make the call. |
| `lib/db/schema.ts` → `llmCall` | Records a SHA-256 of the input, token counts, latency, and cost. **The prompt and the completion are never stored.** A table of prompts would be a second uncontrolled copy of the clinical record. |

`lib/env.ts` also refuses to boot in live mode without the BAA confirmation, so
the check exists at startup as well as at call time.

---

## 6. Deletion

**Any organisation can request complete deletion of its data. Implemented
properly, cascading, with an audit record of the deletion itself.**

| Where | What it does |
| --- | --- |
| `lib/compliance/delete.ts` → `deleteOrganizationData()` | The erasure. Counts rows per table first, deletes the organisation row, and lets the foreign keys cascade. |
| `lib/db/schema.ts` | Every dependent table declares `onDelete: 'cascade'` against `organization`, so nothing is orphaned and nothing is missed by a hand-written delete list that drifts. |
| `lib/storage/index.ts` → `deletePrefix()` | Removes the stored documents. Keys are structured `org/<orgId>/…` so erasing an organisation's files is a prefix delete rather than a join against rows that are about to disappear. |
| `lib/db/schema.ts` → `deletionRequest` | Survives the deletion, carrying who asked, when, and the per-table counts. The erasure is evidenced after the rows are gone. |
| `lib/compliance/delete.ts` | Writes an `erase` audit row. Audit rows about a deletion survive it by design. |

---

## 7. Session security

**30 minute idle timeout, mandatory 2FA above read-only, secure httpOnly
cookies, CSRF protection.**

| Requirement | Where | How |
| --- | --- | --- |
| 30 minute idle timeout | `lib/auth/index.ts` → `session` | `expiresIn: 1800` with `updateAge: 0`, so every authenticated request pushes the expiry out and a session that goes quiet for half an hour is dead. `freshAge` caps the absolute life at 12 hours, so a tab left open and poked all day still ends. |
| Mandatory 2FA above read-only | `lib/auth/roles.ts` → `requiresTwoFactor()` | Returns true for every platform role except `none`, and for any membership above `readonly`. |
| Enforced, not merely configured | `lib/auth/guards.ts` → `pendingAccountAction()` | Called by every authenticated layout. Returns the path the principal must visit before doing anything else. A user who needs a second factor and has not enrolled cannot reach any surface. |
| Enforced on the sign-in path too | `app/(auth)/after-sign-in/page.tsx` | Every sign in lands here and the server decides where the account goes, so the gates sit on the path every session takes rather than only on the surfaces middleware covers. |
| Secure httpOnly cookies | `lib/auth/index.ts` → `advanced` | `httpOnly: true`, `sameSite: 'lax'`, `useSecureCookies` in production. The session token is never readable from JavaScript. |
| CSRF protection | `lib/auth/index.ts` → `trustedOrigins` | Cross-origin form posts are rejected. Next.js server actions carry their own origin check on top. |
| Brute force | `lib/auth/index.ts` → `rateLimit` | Sign in and password change are capped per address, and the two-factor verification endpoints more tightly. better-auth locks a second factor after repeated wrong codes (`two_factor.failed_verification_count`, `two_factor.locked_until`). |
| No self-service accounts | `lib/auth/index.ts` → `disableSignUp: true` | There is no signup route anywhere in the application. Accounts are provisioned by an operator. |
| Temporary passwords | `lib/auth/provision.ts` → `provisionUser()` | Every account lands with `mustChangePassword` set and a one-time password nobody stores in readable form. |
| Deactivation bites immediately | `lib/auth/provision.ts` → `deactivateUser()` | Destroys the account's sessions rather than waiting for them to expire. A deactivation that takes half an hour to take effect is not a deactivation. |
| Disabled accounts hold nothing | `lib/auth/guards.ts` → `getPrincipal()` | Returns null for a user whose status is `disabled`, whatever their session says, and drops memberships in deactivated organisations. |

**Authorisation is server side everywhere.** `lib/auth/roles.ts` is pure data
and pure functions; `lib/auth/guards.ts` enforces it. Hiding a button is never
the control. `tests/authorization.test.ts` walks every role against every
permission and every surface (233 assertions), and `e2e/auth.spec.ts` repeats
the check by request against a running server, because a page that renders only
because nobody linked to it is not access control.

---

## What we do not claim

- We are not SOC 2 certified. We have not been audited.
- We hold no Business Associate Agreement with anyone today.
- No penetration test has been performed, so there is no report to share.
- The corpus of published decisions is currently empty in this build. See
  `BLOCKED.md`: the government sources are unreachable from the environment it
  was built in, by network policy.

If any of those is a hard requirement for your review, we would rather you knew
now than three weeks into a procurement cycle.
