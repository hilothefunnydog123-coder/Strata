# Working agreements

Standing rules for this repository. These are decisions the owner has made, not
suggestions, and they survive between sessions.

## Branches

**Push to `main`. Never to `work` unless explicitly told to in that message.**

`work` is Netlify's production branch, so every push to it spends build minutes
and changes what the world sees. `main` costs nothing: `netlify.toml` cancels
branch deploys and deploy previews by context, and `main` is a branch deploy.

Promoting to `work` is a deliberate act the owner asks for, and only once the
change is finished. "Push this" means `main`. Only "push to work", or an
explicit instruction to deploy, means `work`.

This is the reverse of the usual convention, and it was the reverse of what this
file said until 2026-08-16, which cost a session's worth of pushes landing on
the live site while everyone believed they were landing on a scratch branch.
The names are not a mnemonic here. Check which branch Netlify calls production
before assuming either one is safe.

Local `main` was also stale for a long time: it pointed at the pre-Medeal Ward
history rather than at `origin/main`. That history is preserved on
`origin/archive/coverage-engine` and several `origin/claude/*` branches. If a
checkout of `main` ever shows Prisma and a product called Ward, the branch
pointer is old, not the repository.

## Netlify build minutes are metered

Assume every `work` push is billable. Do not push documentation-only changes to
`work` to "keep it current"; `scripts/netlify-should-build.sh` will skip the
build, but the runner still starts.

Local verification is free and is where testing belongs: a local Postgres and
`pnpm build && pnpm start` reproduce production faithfully, and every bug found
in this repository so far was found that way rather than on a deploy.

## Writing

No em dashes anywhere: not in code, comments, documentation, commit messages, or
replies to the owner. `pnpm check:forbidden` catches them in the repository; the
rest is on you.

The public pages use weight rather than a lighter grey for secondary text. Do
not reintroduce `text-ink-2` there.

## Before pushing anything

```
pnpm check:forbidden && pnpm typecheck && pnpm lint && pnpm test
```

For a change that touches rendering, a passing test suite is not sufficient
evidence. Three bugs in this repository were invisible to tests and visible
immediately in a screenshot: counts that disagreed with the list beneath them.
Build it, run it against a seeded database, and look at the page.

## PHI

`PHI_MODE=synthetic` is the only supported mode until a signed Business
Associate Agreement exists with a named customer. Nothing in the codebase may
acquire a way to bypass that check. Real patient data must not be uploaded to
any environment, including local ones.
