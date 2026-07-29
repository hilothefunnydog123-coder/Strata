# Design

Written before the CSS, critiqued, revised, then built. The critique pass is
kept in place rather than tidied away, because the revisions only make sense
next to what they replaced.

---

## 1. What this thing is

A recovery instrument. The subject is money that was taken and is being taken
back, argued through evidence. Everything on screen is either a figure, a
document, or a claim traced to its source.

The visual language comes from three real places:

- **The ledger.** Columns of figures that must align. Rules, not boxes.
- **The legal filing.** Numbered assertions, each with a citation. A caption at
  the top saying who is arguing what against whom.
- **The remittance advice.** The dense, unglamorous document a hospital's
  billing office already reads all day, where every line means a dollar.

It does not come from SaaS. There is no hero gradient, no floating card, no
soft shadow, no product tour. A denials specialist works this queue for eight
hours and is measured on throughput. Density is respect for her time.

---

## 2. Palette

Five values. Each carries exactly one meaning, and nothing is decorative.
Contrast ratios are computed against `--color-paper` (#F6F5F1), not estimated.

| Token | Hex | Meaning | Contrast |
| --- | --- | --- | --- |
| `--color-ink` | `#12100E` | Body text, rules, everything read. | 17.6:1 |
| `--color-paper` | `#F6F5F1` | The ground. Warm, slightly off white, like paper. | ground |
| `--color-denied` | `#9B1C1C` | Dollars withheld. Deadlines inside seven days. Rejections. Failed verification. | 7.6:1 |
| `--color-recovered` | `#0E5540` | Dollars returned. Approvals. Verified assertions. | 8.2:1 |
| `--color-action` | `#1B4A8F` | Interactive elements only. Links, buttons, focus rings. | 8.1:1 |

Supporting values are all derived from these and carry no independent meaning:
`--color-ink-2` (#3D3934, 10.4:1) for secondary text that is still fully
readable, `--color-rule` and `--color-rule-strong` for borders, `--color-paper-2`
and `--color-paper-sunk` for the two surface steps, and a wash of each semantic
colour for tag backgrounds.

**The rule that makes this work:** if a colour appears, it is telling you
something. There is no "brand accent". A denials specialist scanning a queue can
read the state of every row from colour alone, because colour is never spent on
anything else.

**A note on red and green.** They are the semantically right pair here: money
out, money back. To make sure the interface does not depend on hue alone,
every place they appear also carries a word (`Won`, `Lost`, `Verified`,
`Rejected`) or a sign. The specification asks that state be readable from colour
alone; it is, and it is also readable without colour, which is a stronger
property.

**Why federal blue and not something warmer.** The action colour ties to the
government-record theme running through the whole product. It is also as far
from purple as a blue can sensibly get, which was a constraint.

---

## 3. Typography

Three typefaces, three jobs. Not one family at three weights.

| Role | Face | Why |
| --- | --- | --- |
| Interface and data | **Public Sans** 400/500/600/700 | The typeface of the US Web Design System, which is what federal agencies publish in. For a product whose whole argument rests on 42 CFR 422.101 and published Council decisions, borrowing the government's own type is a reasoned choice rather than a taste call. It is a Libre Franklin derivative: sturdy, slightly condensed, institutional. Nothing like the neutral geometric sans every dashboard uses. |
| Identifiers | **IBM Plex Mono** 400/500/600 | Claim numbers, DAB citations, CFR references, denial codes, dates. These are data. They align down a column or they are not identifiers. Slashed zero on. |
| Documents | **Source Serif 4** 400/600 | The appeal letter, the published decision, the clinical record. A serif at reading size makes the document surface unmistakably not application chrome, which is the whole point of the source panel. |

`font-variant-numeric: tabular-nums` is set on `body`, not sprinkled on
components. In a financial product the default must be right, because the one
place someone forgets is the column that visibly jitters.

Type scale is tight: 11px, 12px, 13px, 15px, then headings. Interface text is
15px and dense; document text steps up to 16px with 1.65 line height, because
that surface is for reading rather than scanning.

---

## 4. Layout

The denial detail view is the application. Three panes:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Synthetic data only. This environment is not approved for patient info.      │
├──────────────────────────────────────────────────────────────────────────────┤
│ MEDEAL  Appeals   Dashboard  Denials  Invoices  Team    Northgate  you  out  │
├───────────────────┬────────────────────────────────┬─────────────────────────┤
│ CASE              │ APPEAL LETTER          v3      │ SOURCE                  │
│                   │                                │                         │
│ DEN-2026-0184     │  Northgate Regional Medical    │ DAB No. 3145            │
│ Meridian Health   │  Center appeals the denial of  │ Medicare Appeals Council│
│ Skilled nursing   │  claim 4471902 for skilled     │ decided 2024-03-18      │
│ $18,420.00        │  nursing services provided     │ ───────────────────────│
│ Due in 6 days ●   │  between 2026-01-04 and        │ ...the plan may not     │
│                   │  2026-01-29.                   │ ┌─────────────────────┐ │
│ ── TIMELINE ──    │                                │ │ apply criteria more │ │
│ intake            │  1. The plan applied criteria  │ │ restrictive than    │ │
│ parsing           │     more restrictive than      │ │ those used in       │ │
│ ready             │     Traditional Medicare. [1]  │ │ Traditional         │ │
│ generating        │     ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔      │ │ Medicare...         │ │
│ clinical review ● │                                │ └─────────────────────┘ │
│                   │  2. The record documents daily │  ↑ the exact passage    │
│ ── GAPS ──        │     skilled nursing observ-    │    behind assertion 1   │
│ ! No physician    │     ation. [2]                 │                         │
│   order for       │                                │                         │
│   therapy found   │  3. ...                        │                         │
├───────────────────┴────────────────────────────────┴─────────────────────────┤
```

Left pane is metadata and state, and it never scrolls away. Middle is the
letter, set as a document. Right is the source panel, which is empty until you
click an assertion and then shows exactly the passage behind it.

The client portal at large is a header rule and then content, edge to edge. No
sidebar: the surfaces are shallow enough that a horizontal nav is honest, and a
sidebar would cost 220 pixels of table width all day.

Lists are tables, not cards. `Panel` is a bordered rectangle on paper, never a
floating box on grey.

---

## 5. Signature element

**The assertion-to-source link.**

Every sentence in a generated appeal letter is an `Assertion` row with a source
identifier and a verbatim quote that has been programmatically verified to
appear in that source. Clicking the sentence opens the source panel at the exact
quoted passage, highlighted in place, with enough surrounding text to see the
context.

The interaction earns the visual boldness:

- The assertion is underlined in the action colour, with a superscript index in
  mono. It reads like a footnote in a brief, because that is what it is.
- The panel opens to the containing span, not to the top of the document, and
  the quoted characters carry a solid highlight.
- A legal assertion resolves to a published decision or a regulation. A clinical
  assertion resolves to a line in the hospital's own submitted record.
- There is no state in which an assertion has no link, because a draft
  containing an unverified assertion is rejected before a human ever sees it.

Everything else in the interface stays quiet so this can be loud.

---

## 6. Critique of the first plan, and what changed

I wrote the plan above, then went looking for the parts that were generic. Five
things did not survive.

**One. Warm cream paper with a serif was heading somewhere specific and bad.**
The first palette had `#FAF8F4` paper, and the document surface was set in a
high contrast serif throughout. Cream plus high-contrast serif plus a warm
accent is a named, tired look, and it was two steps away. Fixed: paper cooled to
`#F6F5F1`, the serif is confined to actual document surfaces, and the accent is
a cold federal blue rather than anything terracotta.

**Two. "Recovered green" was too light to read.** The first pick, `#12654A`,
measured 6.5:1 against paper, under the 7:1 floor the brief sets. I did not
round it up and move on; I darkened it to `#0E5540`, which measures 8.2:1.
Every colour in the table above was computed rather than eyeballed, and the two
that failed were changed rather than excused.

**Three. Colour was leaking into decoration.** The first draft had the action
blue on the wordmark and on section headings. That immediately breaks the rule
that colour means something: a blue heading is not clickable. The wordmark and
all headings are ink now. Blue appears only where a click does something.

**Four. The dashboard was a row of four equal tiles.** Four tiles of equal
weight is the universal admin-template opening, and it also lies about what
matters. Total recovered to date is the emotional core of this product: it is
the number that justifies the contingency model and the number a CFO repeats in
a meeting. It is set enormous and alone, and the supporting figures sit
underneath it at a fraction of the size. One number leads.

**Five. The empty states said nothing.** "No appeals yet" is technically not a
placeholder but it is not useful either. Every empty state now names what is
missing and what to do next, in the words the user would use. The dashboard with
no appeals explains what the first action is, rather than showing a zero and
leaving her to guess.

One thing survived the critique that I expected to cut: the three-pane detail
view is close to an email client, which is a familiar shape. I kept it because
the shape is right for the task, the middle pane is a document rather than a
message, and the third pane is doing something no email client does. Familiar is
not the same as generic.

---

## 7. Quality floor

- Public site is responsive to mobile. The application is laid out for a desk,
  which is where the work happens, and degrades to a single column rather than
  pretending a dense queue is usable on a phone.
- Visible keyboard focus on every interactive element: a 2px action-coloured
  outline at 2px offset, switching to paper-coloured on elements that are
  already the action colour.
- `prefers-reduced-motion` is respected globally in `app/globals.css`.
- The client portal is fully keyboard navigable and carries a command palette on
  `Cmd+K` / `Ctrl+K`.
- Loading, error, and empty states are written in plain language, say what
  happened, and say what to do next. Errors never apologise.

---

## 8. The forbidden list, checked

Every item in the brief's section 14, and where it stands:

| Forbidden | Status |
| --- | --- |
| Em dashes in any copy | None in the repository. Checked by `scripts/check-forbidden.ts` in CI. |
| Grey secondary text below 7:1 | Lowest secondary is `--color-ink-2` at 10.4:1. |
| Gradients of any kind | None. No `linear-gradient`, no `bg-gradient-*`. |
| Purple, indigo, violet | None. Action colour is `#1B4A8F`. |
| Glassmorphism, backdrop blur | None. No `backdrop-filter`. |
| Floating rounded cards on grey | Panels are bordered rectangles on paper. Radius is 2px and 3px. |
| Emoji | None. |
| Sparkles, AI badges, robot imagery | None. The model is never mentioned in the interface. |
| Stock photography | No photography at all. |
| Centred hero over full bleed background | The home page is left aligned on paper. |
| Inter 400 as the whole type system | Three families, four weights, three distinct roles. |
| Testimonial cards with circular avatars | None. There are no testimonials. |
| Cream plus high-contrast serif plus terracotta | Cooled paper, serif confined to documents, cold blue accent. |

---

## 9. What got built, against the plan

Written after the fact, because a design document that never records what
actually happened is a wish list.

**Held.** The three pane detail view is the shape described in section 4, and
the assertion-to-source link works as specified: click a sentence, the source
panel opens at the exact quoted characters with a wash behind them and the rest
of the passage around it for context. The offsets are recomputed from the same
comparison the citation invariant rests on, so a passage that somehow no longer
contains its quote shows no highlight and says so, rather than highlighting the
wrong thing.

**Held.** The dashboard leads with one number. Total recovered is set at
`text-7xl` and alone; everything else is a fifth of that size in a row of tiles
underneath.

**Held.** Colour never appears without meaning. The check in
`scripts/check-forbidden.ts` catches gradients, blur, and purple mechanically;
the discipline about not using the action colour decoratively is held by review
rather than by a script, and section 6 records where it slipped in the first
draft.

**Changed.** The review checklist originally used a check mark character.
Correct typographically, but the forbidden-pattern check flagged it inside the
emoji range, and rather than widen the exemption I drew the tick as an SVG. It
is a better control anyway: it takes `currentColor`, so it inverts correctly on
the filled state without a second rule.

**Changed.** The required-field asterisk moved outside the `<label>` element.
Text inside a label becomes the control's label text, so the asterisk was making
the field's accessible name "New password*". That broke every lookup by label,
for a screen reader user and for the test suite alike. The required state is
carried by the `required` attribute on the control, which is what assistive
technology announces anyway. Caught by a test failing, which is the cheapest
place to catch an accessibility bug.
