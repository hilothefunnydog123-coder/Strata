# Design plan (PROMPT §8)

Derived from the subject's own materials — policy documents, redlines, effective dates, code
numbers, submission packets, the physical act of marking up a page with a highlighter — not from
SaaS convention. The plan comes first; the genericness critique is in §4 of `PRE-BUILD.md`.

## Positioning
A professional instrument for a nine-figure decision. Closer to legal-research software or a
trading terminal than consumer SaaS. Dense, quiet, high information ratio, open eight hours a day.

## Palette (named hex — meaning is load-bearing)

**Paper / chrome (neutral, no meaning):**
- `paper` `#FBFAF7` — document reading surface (warm off-white, like policy paper)
- `ink` `#1A1A17` — primary text
- `chrome-900` `#14161A`, `chrome-700` `#2A2E35`, `chrome-500` `#5B626E`, `chrome-200` `#D9DBDE`,
  `chrome-050` `#F1F1EE` — app frame (near-neutral, faintly cool so paper reads warm against it)

**Coverage stance scale — RESERVED. Appears only on stance:**
- `covered` `#2E7D57` (green) · `conditional` `#B9822B` (amber) · `investigational` `#7A5CA8` (violet)
- `not_covered` `#B23B3B` (red) · `silent` `#9AA0A8` (neutral grey — most of the board, shown honestly)

**Change-direction scale — RESERVED. Appears only on diffs:**
- `tightened` `#B23B3B` · `loosened` `#2E7D57` · `added` `#2B5F8A` · `removed` `#5B626E` · `clarified` `#9AA0A8`

**Signature accent — RESERVED for the citation highlight and nothing else:**
- `citation` `#2B5F8A` (citation blue), with `citation-wash` `#FFF3C4` (highlighter amber) for the
  illuminated source span. The highlighter wash is the one warm, physical, "marker on paper" moment.

Rule enforced in tokens: coverage hues, diff hues, and the citation accent are exported as separate,
non-overlapping token groups. Neutral chrome carries all decoration. A user can read state from color
alone across the whole app because no hue means two things.

## Type (three faces, defined roles)
- **Reading surface (documents):** a serif — `Source Serif 4` / Georgia fallback. Documents look
  like documents; the reading pane is visually distinct from the chrome.
- **Chrome / UI:** a grotesque sans — `Inter` / system-ui. Labels, nav, tables.
- **Data:** a monospace — `IBM Plex Mono` / ui-monospace. Every code, date, LCD number, dollar
  amount, and identifier, so they align and compare down a column.

## Layout
- App: a fixed left module rail (M1–M8), a dense content region, and — in the Criteria Rail — a
  two-pane split: document (serif, paper) left, extracted criteria (mono identifiers, sans labels)
  right. No card grids, no gradients, no hero type inside the app. Tables over cards.
- Marketing: more expressive, responsive to mobile, but still restrained.

## Signature element — the citation highlight
Clicking a requirement scrolls the source document to the supporting span and illuminates it with
the highlighter wash, with a single 240ms ease (respecting `prefers-reduced-motion`). This is the
product's thesis made physical. It is the only place we spend boldness. Everything around it is disciplined.

## Motion
Only where it conveys state change: a citation illuminating, a diff resolving. No ambient animation.

## Quality floor (not announced in the UI)
Responsive marketing site; visible keyboard focus everywhere; `prefers-reduced-motion` respected;
desktop app fully keyboard-navigable with a command palette (⌘K).
