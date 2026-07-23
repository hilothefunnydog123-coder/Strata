# Strata — working agreement for parallel sessions

Several Claude Code sessions work this repository at the same time. Read this
before you write a single file. The failure mode here is not a merge conflict —
git would catch that — it is two sessions independently building the same thing
under two names, which git merges cleanly and which leaves the repo worse.

## Rule 1 — write only inside your workstream

Workstreams own **directories**, and no two own the same one. Find yours in
`docs/WORKSTREAMS.md`, and treat every path outside it as read-only. If the work
you were asked to do requires editing a file you do not own, stop and say so
rather than editing it.

If you have not been assigned a workstream, you do not have one. Ask.

## Rule 2 — a module and a package with the same name cannot coexist

`strata/meta.py` and `strata/meta/` in the same tree is not a duplicate, it is a
bug: the package shadows the module and every line of the `.py` becomes
unreachable code that still imports, still passes review, and never runs. The
repo currently has three instances of this (`appraisal`, `meta`, `reporting`).
Do not add a fourth. Before creating `strata/<name>/`, check that
`strata/<name>.py` does not exist, and vice versa.

## Rule 3 — before adding a concept, grep for it

Four independent risk-of-bias engines were written into this repo in eleven
minutes because nobody grepped. `rg -l "RoB 2|ROBINS|AMSTAR|QUADAS" strata/`
would have cost two seconds. Do that for whatever you are about to build.

## Rule 4 — the house style is honesty about limits

This codebase's whole argument is that it says what it does not know. That is a
technical constraint, not a tone:

- Never infer a fact from the absence of a statement. An abstract that does not
  mention blinding has not told you the trial was unblinded.
- Any derived judgement carries the evidence that produced it — a quoted span, a
  PMID, a named rule. A verdict with no traceable origin does not ship.
- Where a number cannot be computed from what was retrieved, return `None` and
  a reason. Do not substitute a plausible default. `sof.py` will not invent a
  baseline risk; `stats.pool` refuses under three studies; `stance` abstains
  rather than guessing. Follow that.
- No claim of regulatory status. Strata is not FDA-cleared, CE-marked, HIPAA-
  certified or clinically validated, and no file may imply otherwise. Write
  "designed to support X" and name the gap.

## Rule 5 — standard library only

No third-party dependencies, including in tests, including the neural layer.
This is the constraint that makes the project installable inside a hospital
network, and it is not negotiable for convenience.

## Rule 6 — commit your own work, on your own branch

Do not commit files you did not write. Do not `git add -A` — it will sweep up
another session's half-finished tree. Add paths explicitly.

## Orientation

- `docs/ARCHITECTURE.md` — how the pieces fit
- `docs/EVIDENCE.md` — the grading rules in full
- `docs/WORKSTREAMS.md` — who owns what, and what is unclaimed
- `README.md` — the product argument; keep it true

Tests: `python tests/test_strata.py`, `tests/test_stats.py`, `tests/test_nn.py`.
No network required.
