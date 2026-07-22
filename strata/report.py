"""Terminal rendering. ANSI colour when attached to a TTY, plain text otherwise.

The terminal output is not a cut-down version of the web view. A clinician
checking one question from a shell should get the same three things the browser
gives: where the evidence sits on the pyramid, whether the papers agree, and what
the effect estimates look like side by side — including a forest plot, drawn on a
log axis with box sizes proportional to precision, in characters.
"""
from __future__ import annotations

import math
import os
import shutil
import sys

from .evidence import LEVEL_LABEL, MAX_LEVEL


def _supports_colour() -> bool:
    if os.environ.get("NO_COLOR") or os.environ.get("STRATA_NO_COLOR"):
        return False
    if os.environ.get("FORCE_COLOR"):
        return True
    return bool(getattr(sys.stdout, "isatty", lambda: False)())


def _supports_unicode() -> bool:
    """Whether stdout can actually encode the box-drawing set.

    A Windows console still running the cp1252 code page cannot, and printing to
    it raises UnicodeEncodeError mid-render. Rather than mangling the output with
    ``errors='replace'``, the whole glyph table drops to ASCII.
    """
    if os.environ.get("STRATA_ASCII") == "1":
        return False
    encoding = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        "─█░│├┤◆■□↓↑✓⊘·…≥".encode(encoding)
    except (UnicodeEncodeError, LookupError):
        return False
    return True


_COLOR = _supports_colour()
_UNICODE = _supports_unicode()

#: One table, two alphabets. Every glyph the renderer draws goes through here so
#: an ASCII terminal gets a complete, aligned rendering rather than a broken one.
_G = {
    True: {"rule": "─", "full": "█", "empty": "░", "vbar": "│", "hbar": "─",
           "lcap": "├", "rcap": "┤", "both": "┼", "dhbar": "═", "dlcap": "╞",
           "drcap": "╡", "diamond": "◆", "box": "■", "obox": "□", "dot": "·",
           "down": "↓", "up": "↑", "tick": "✓", "banned": "⊘", "mid": "▓",
           "ell": "…", "eye": "⌕"},
    False: {"rule": "-", "full": "#", "empty": ".", "vbar": "|", "hbar": "-",
            "lcap": "[", "rcap": "]", "both": "+", "dhbar": "=", "dlcap": "<",
            "drcap": ">", "diamond": "*", "box": "#", "obox": "o", "dot": ".",
            "down": "v", "up": "^", "tick": "+", "banned": "x", "mid": "=",
            "ell": "...", "eye": "?"},
}


def g(name: str) -> str:
    return _G[_UNICODE][name]


#: Typographic characters that reach the terminal from modules with no business
#: knowing what a console can encode — "I²" from the statistics layer, en dashes
#: and curly quotes from abstracts as PubMed supplies them.
_ASCII_FOLD = {
    "²": "2", "³": "3", "—": "-", "–": "-", "‑": "-", "−": "-",
    "'": "'", "'": "'", '"': '"', '"': '"', "…": "...", "×": "x",
    "≤": "<=", "≥": ">=", "±": "+/-", "°": "deg", "→": "->", "·": "-",
    "τ": "tau", "α": "alpha", "β": "beta", "μ": "u", "‰": "per mille",
}


def ascii_safe(text: str) -> str:
    """Fold a rendered page down to what this terminal can actually print.

    Applied once at the output boundary rather than scattered through the
    modules that produce the text: :mod:`strata.stats` should be free to say
    "I²" without knowing whether it is bound for a browser or a cp1252 console.
    The final encode/decode is a backstop for anything not in the table — a stray
    character from a journal title, most often.
    """
    if _UNICODE:
        return text
    for a, b in _ASCII_FOLD.items():
        text = text.replace(a, b)
    encoding = getattr(sys.stdout, "encoding", None) or "ascii"
    try:
        return text.encode(encoding, "replace").decode(encoding)
    except LookupError:
        return text.encode("ascii", "replace").decode("ascii")


def _truncate(text: str, width: int) -> str:
    """Shorten to exactly ``width`` display columns, ellipsis included.

    The ASCII ellipsis is three characters wide, so budgeting one for it — as the
    Unicode path can — overflows the column and shears the forest plot's axis.
    """
    if len(text) <= width:
        return text
    ell = g("ell")
    return text[:max(0, width - len(ell))] + ell

_STRENGTH_COLOUR = {"high": "32", "moderate": "33", "low": "38;5;208",
                    "very low": "31", "none": "2"}
_LEVEL_COLOUR = {1: "32", 2: "32", 3: "33", 4: "38;5;208", 5: "31", 6: "2", 7: "2"}
_STANCE_COLOUR = {"supports": "32", "no_effect": "33", "against": "31",
                  "unclear": "2", "mixed": "38;5;208", "insufficient": "2"}

#: Safeguard keys are terse because they are model labels; a reader gets English.
_SAFEGUARD_NAME = {"randomised": "randomised", "blinded": "blinded",
                   "registered": "pre-registered", "itt": "intention-to-treat",
                   "powered": "power calculation",
                   "confounding_adjusted": "adjusted for confounding"}


def safeguards(keys) -> str:
    return ", ".join(_SAFEGUARD_NAME.get(k, k) for k in keys)


def c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if _COLOR else s


def _width(default: int = 92) -> int:
    try:
        return max(60, min(shutil.get_terminal_size().columns, 110))
    except Exception:
        return default


def _rule(width: int, char: str | None = None) -> str:
    return c("2", (char or g("rule")) * width)


def strength_badge(strength: str) -> str:
    return c(_STRENGTH_COLOUR.get(strength, "2"),
             f"[{strength.upper()} CERTAINTY]")


# ------------------------------------------------------------------- pyramid

def pyramid(level_counts: dict, width: int) -> str:
    """The evidence pyramid as stacked bars, widest at the base.

    Tier *width* draws the pyramid's shape; tier *fill* counts the papers that
    landed there — and fill uses one scale across every tier. An earlier version
    scaled fill as a fraction of each tier's own width, which meant one paper at
    level 6 drew a longer bar than one paper at level 1 and read as "more".
    """
    lines = [c("1", "Evidence pyramid")]
    label_w = max(len(v) for v in LEVEL_LABEL.values())
    bar_w = max(12, min(34, width - label_w - 12))
    peak = max(level_counts.values()) if level_counts else 0
    narrowest = int(bar_w * 0.42)
    unit = (narrowest / peak) if peak else 0.0

    for level in range(1, MAX_LEVEL + 1):
        n = level_counts.get(level, 0)
        tier = int(bar_w * (0.42 + 0.58 * (level - 1) / (MAX_LEVEL - 1)))
        fill = min(tier, max(1, round(n * unit))) if n else 0
        bar = g("full") * fill + g("empty") * (tier - fill)
        colour = _LEVEL_COLOUR.get(level, "2")
        count = f"{n:>2}" if n else c("2", " " + g("dot"))
        lines.append(f"  {c('2', str(level))} {LEVEL_LABEL[level]:<{label_w}}  "
                     + (c(colour, bar) if n else c("2", bar)) + f"  {count}")
    return "\n".join(lines)


# ------------------------------------------------------------------ consensus

def consensus_bar(consensus, width: int) -> str:
    """A weighted bar showing where the evidence's weight actually sits."""
    if consensus is None or consensus.direction == "insufficient":
        return ""
    order = ["supports", "no_effect", "unclear", "against"]
    glyphs = {"supports": g("full"), "no_effect": g("mid"),
              "unclear": g("empty"), "against": g("full")}
    total = sum(consensus.weights.values()) or 1.0
    bar_w = max(20, min(46, width - 30))

    segments = []
    for stance in order:
        w = consensus.weights.get(stance, 0.0)
        n = int(round(bar_w * w / total))
        if n:
            segments.append(c(_STANCE_COLOUR[stance], glyphs[stance] * n))
    bar = "".join(segments) or c("2", g("empty") * bar_w)

    head = c("1", "Consensus  ") + c(_STANCE_COLOUR.get(consensus.direction, "2"),
                                     consensus.direction.replace("_", " ").upper())
    legend = "  ".join(
        c(_STANCE_COLOUR[s], g("box")) + f" {s.replace('_', ' ')} "
        + c("2", f"({consensus.counts.get(s, 0)})")
        for s in order if consensus.counts.get(s))
    return (f"{head}\n  {bar}  {c('2', f'{consensus.agreement:.0%} agreement')}\n"
            f"  {legend}")


# ---------------------------------------------------------------- forest plot

def forest(evidence, pooled, width: int) -> str:
    """An ASCII forest plot on a log axis.

    Only studies reporting an interval appear — a point estimate without one
    cannot be drawn honestly, and inventing a width for it would be the kind of
    plausible-looking fabrication this tool exists to avoid.
    """
    rows = [e for e in evidence
            if e.grade.effect is not None and e.grade.effect.has_interval]
    if len(rows) < 2:
        return ""

    ratio = rows[0].grade.effect.is_ratio
    rows = [e for e in rows if e.grade.effect.is_ratio == ratio]
    if len(rows) < 2:
        return ""

    def tx(v: float) -> float:
        return math.log(max(v, 1e-6)) if ratio else v

    lows = [tx(e.grade.effect.ci_low) for e in rows]
    highs = [tx(e.grade.effect.ci_high) for e in rows]
    null = tx(1.0) if ratio else 0.0
    if pooled is not None:
        lows.append(tx(pooled.ci_low))
        highs.append(tx(pooled.ci_high))

    lo, hi = min(lows + [null]), max(highs + [null])
    span = (hi - lo) or 1.0
    lo, hi = lo - span * 0.08, hi + span * 0.08
    span = hi - lo

    label_w = 22
    plot_w = max(24, min(48, width - label_w - 22))

    def pos(v: float) -> int:
        return max(0, min(plot_w - 1, int(round((tx(v) - lo) / span * (plot_w - 1)))))

    null_col = max(0, min(plot_w - 1, int(round((null - lo) / span * (plot_w - 1)))))

    out = [c("1", "Forest plot") + c("2", f"  ({rows[0].grade.effect.measure}, "
                                          f"{'log' if ratio else 'linear'} scale)")]
    axis = [g("dot")] * plot_w
    axis[null_col] = g("vbar")
    out.append(" " * (label_w + 2) + c("2", "".join(axis)))

    # Box size encodes precision: a narrower interval gets a heavier marker,
    # which is the convention and also the correct visual emphasis.
    widths = [tx(e.grade.effect.ci_high) - tx(e.grade.effect.ci_low) for e in rows]
    tightest = min(widths) if widths else 1.0

    for e, w in zip(rows, widths):
        eff = e.grade.effect
        line = [" "] * plot_w
        a, b = pos(eff.ci_low), pos(eff.ci_high)
        for i in range(a, b + 1):
            line[i] = g("hbar")
        line[a] = g("lcap") if a != b else g("both")
        line[b] = g("rcap") if a != b else g("both")
        if line[null_col] == " ":
            line[null_col] = g("vbar")
        marker = g("box") if w <= tightest * 1.6 else g("obox")
        line[pos(eff.estimate)] = marker

        colour = "31" if e.grade.retracted else _STRENGTH_COLOUR.get(
            e.grade.strength, "2")
        title = e.article.title
        # A withdrawn result is drawn — hiding it would leave a reader unable to
        # see that the study they half-remember has been pulled — but it is
        # marked, and it contributed nothing to the pooled diamond below.
        prefix = g("banned") + " " if e.grade.retracted else ""
        label = prefix + _truncate(title, label_w - len(prefix))
        out.append(f"  {label:<{label_w}}" + c(colour, "".join(line))
                   + c("2", f"  {eff.estimate:.2f} "
                            f"[{eff.ci_low:.2f}, {eff.ci_high:.2f}]"))

    if pooled is not None:
        line = [" "] * plot_w
        a, b = pos(pooled.ci_low), pos(pooled.ci_high)
        for i in range(a, b + 1):
            line[i] = g("dhbar")
        line[a], line[b] = g("dlcap"), g("drcap")
        line[pos(pooled.estimate)] = g("diamond")
        out.append(f"  {'POOLED (indicative)':<{label_w}}" + c("1", "".join(line))
                   + c("2", f"  {pooled.estimate:.2f} "
                            f"[{pooled.ci_low:.2f}, {pooled.ci_high:.2f}]"))
        out.append(" " * (label_w + 2)
                   + c("2", f"I² = {pooled.i_squared:.0f}% "
                            f"({pooled.heterogeneity} heterogeneity), "
                            f"{pooled.n_studies} studies"))

    out.append(" " * (label_w + 2)
               + c("2", f"dashed line = no effect ({'1.0' if ratio else '0'}); "
                        f"marker size = precision"))
    if any(e.grade.retracted for e in rows):
        out.append(" " * (label_w + 2)
                   + c("31", g("banned") + " retracted - shown for transparency, "
                             "excluded from the pooled estimate"))
    return "\n".join(out)


# ------------------------------------------------------------------- sources

def sources(evidence, width: int, *, explain: bool = False) -> str:
    from .synthesize import key_finding

    out = [c("1", "Sources") + c("2", "  " + g("dot") + " strongest first")]
    sep = c("2", " " + g("dot") + " ")

    for i, e in enumerate(evidence, 1):
        a, gr = e.article, e.grade
        colour = _LEVEL_COLOUR.get(gr.level, "2")
        head = (f"  {c('1', f'[{i}]')} {c(colour, gr.label)}{sep}"
                f"{c(_STRENGTH_COLOUR.get(gr.strength, '2'), gr.strength)}{sep}"
                f"{c('2', str(a.year or 'n.d.'))}")
        if gr.is_guideline:
            head += sep + c("36", "guideline")
        if gr.retracted:
            head += " " + c("41;97", " RETRACTED ")
        elif gr.concern:
            head += " " + c("43;30", " CONCERN ")
        out.append(head)

        out.append(f"      {_truncate(a.title, width - 6)}")

        finding = key_finding(a.abstract) or "(no abstract)"
        for line in _wrap(finding, width - 6):
            out.append(c("2", f"      {line}"))

        facts = []
        if gr.effect is not None:
            facts.append(gr.effect.format())
        if gr.sample_size:
            facts.append(f"n = {gr.sample_size:,}")
        if gr.stance:
            facts.append(c(_STANCE_COLOUR.get(gr.stance, "2"),
                           gr.stance.replace("_", " ")))
        if facts:
            out.append("      " + sep.join(facts))

        if gr.safeguards:
            out.append(c("32", "      " + g("tick") + " ")
                       + c("2", safeguards(gr.safeguards)))
        for d in gr.downgrades:
            out.append(c("31", "      " + g("down") + " ")
                       + c("2", f"{d.name.lower()}: {d.reason}"))
        for d in gr.upgrades:
            out.append(c("32", "      " + g("up") + " ")
                       + c("2", f"{d.name.lower()}: {d.reason}"))

        if explain and gr.spans:
            phrases = ", ".join(f'"{t}"' for t, _ in gr.spans[:3])
            out.append(c("35", "      " + g("eye") + " ")
                       + c("2", f"network attended to: {phrases}"))

        out.append(c("2", f"      {a.url}"))
        out.append("")
    return "\n".join(out)


def _wrap(text: str, width: int) -> list[str]:
    words = (text or "").split()
    lines, current = [], ""
    for w in words:
        if len(current) + len(w) + 1 > width:
            if current:
                lines.append(current)
            current = w
        else:
            current = f"{current} {w}" if current else w
    if current:
        lines.append(current)
    return lines[:4]


# -------------------------------------------------------------------- render

def render(result, *, explain: bool = False, show_query: bool = False) -> str:
    width = _width()
    out = ["", c("1", "Q  ") + c("1", result.question),
           "   " + strength_badge(result.body.overall_strength)]

    meta = []
    if result.total_hits:
        meta.append(f"{result.total_hits:,} PubMed hits")
    if result.retrieved:
        meta.append(f"{result.retrieved} appraised")
    if result.duplicates_removed:
        meta.append(f"{result.duplicates_removed} duplicate"
                    f"{'s' if result.duplicates_removed > 1 else ''} merged")
    if result.broadened:
        meta.append("search broadened")
    if result.elapsed:
        meta.append(f"{result.elapsed:.1f}s")
    if meta:
        out.append("   " + c("2", " · ".join(meta)))

    if show_query and result.pico is not None:
        out.append("   " + c("2", f"PICO — {result.pico.summary()}"))
        out.append("   " + c("2", f"query — {result.query}"))

    out.append("")
    out.append(result.answer)
    out.append("")
    out.append(_rule(width))
    out.append("")
    out.append(pyramid(result.body.level_counts, width))

    bar = consensus_bar(result.consensus, width)
    if bar:
        out.append("")
        out.append(bar)

    plot = forest(result.evidence, result.pooled, width)
    if plot:
        out.append("")
        out.append(plot)

    if not result.grounded and result.evidence:
        out.append("")
        out.append(_rule(width))
        out.append("")
        out.append(sources(result.evidence, width, explain=explain))
    elif explain and result.evidence:
        out.append("")
        out.append(_rule(width))
        out.append("")
        out.append(sources(result.evidence, width, explain=True))

    # Folded once, here at the boundary — the modules that produced this text
    # have no business knowing what the console can encode.
    return ascii_safe("\n".join(out))
