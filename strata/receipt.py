"""The Evidence Receipt — Strata's core output.

Every claim Strata checks produces a standardized, portable receipt: a status, a strength,
the count of supporting vs. contradicting studies, the single strongest piece of evidence,
the key limitation, the citations, and whether the evidence has changed since last check.

Simple enough for a person to read; structured enough for a medical-AI system to embed. A
receipt is a *transparent appraisal of published evidence*, never a claim of absolute truth
— and it says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

DISCLAIMER = ("Heuristic appraisal of public literature for decision support. Not a "
              "determination of truth, not medical advice. Read the cited sources.")

STATUS_COLOR = {"Supported": "#16a34a", "Mixed": "#d97706", "Contested": "#d97706",
                "Contradicted": "#dc2626", "Insufficient": "#64748b", "Unsupported": "#64748b"}
STRENGTH_COLOR = {"high": "#16a34a", "moderate": "#d97706", "low": "#ea580c",
                  "very low": "#dc2626", "none": "#64748b"}
STATUS_BLURB = {
    "Supported": "The weight of evidence supports this claim.",
    "Mixed": "The evidence is mixed — meaningful support and meaningful conflict.",
    "Contradicted": "The weight of evidence runs against this claim.",
    "Insufficient": "Too little good-quality evidence to judge this claim.",
    "Unsupported": "No directional evidence was found for this exact claim.",
}


@dataclass
class Receipt:
    receipt_id: str
    claim: str
    status: str                    # Supported | Mixed | Contradicted | Insufficient | Unsupported
    strength: str                  # high | moderate | low | very low | none
    supporting: int
    contradicting: int
    neutral: int
    total: int
    checked: str                   # ISO timestamp
    highest_evidence: dict | None = None
    key_limitation: str | None = None
    citations: list = field(default_factory=list)
    evidence_changed: bool = False
    change: dict | None = None
    query: str = ""
    sources: dict = field(default_factory=dict)     # {source_name: count} across the databases searched
    population_note: str | None = None              # generalizability to an imported cohort (local only)
    synthesis: str | None = None                    # optional plain-language AI summary of the evidence
    disclaimer: str = DISCLAIMER

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Receipt":
        allowed = cls.__dataclass_fields__.keys()
        return cls(**{k: v for k, v in d.items() if k in allowed})


# ----------------------------------------------------------------- renderers
def render_terminal(r: Receipt, color: bool = True) -> str:
    def c(code, s):
        return f"\033[{code}m{s}\033[0m" if color else s
    scol = {"Supported": "32", "Mixed": "33", "Contradicted": "31",
            "Insufficient": "2", "Unsupported": "2"}.get(r.status, "2")
    W = 62
    line = "─" * W
    out = [f"┌{line}┐",
           f"│ {c('1','STRATA EVIDENCE RECEIPT'):<{W+7}}│",
           f"│ {c('2', r.receipt_id):<{W+7}}│",
           f"├{line}┤",
           f"│ {('Claim: ' + r.claim)[:W-1]:<{W-1}} │",
           f"│{' '*W}│",
           f"│ {c(scol, 'Evidence: ' + r.status.upper() + '  ·  ' + r.strength.upper()):<{W+len(scol)+6}}│",
           f"│ {f'{r.supporting} supporting   {r.contradicting} contradicting   {r.neutral} neutral':<{W-1}} │"]
    if r.highest_evidence:
        he = r.highest_evidence
        out.append(f"│ {('Strongest: ' + he.get('label','') + ' (' + str(he.get('year') or 'n.d.') + ')')[:W-1]:<{W-1}} │")
    if r.key_limitation:
        out.append(f"│ {('Limitation: ' + r.key_limitation)[:W-1]:<{W-1}} │")
    out.append(f"│ {('Last checked: ' + r.checked[:10] + '   Evidence changed: ' + ('YES' if r.evidence_changed else 'no')):<{W-1}} │")
    out.append(f"└{line}┘")
    return "\n".join(out)


def _badge_colors(r: Receipt):
    return STATUS_COLOR.get(r.status, "#64748b"), STRENGTH_COLOR.get(r.strength, "#64748b")


def seal_svg(r: Receipt, *, width: int = 240) -> str:
    """The 'Strata Evidence Verified' trust mark — a self-contained SVG badge."""
    scol, stcol = _badge_colors(r)
    h = 52
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{h}" '
        f'viewBox="0 0 {width} {h}" role="img" aria-label="Strata Evidence Verified: {r.status}">'
        f'<rect width="{width}" height="{h}" rx="9" fill="#0c181a"/>'
        f'<rect x="1" y="1" width="{width-2}" height="{h-2}" rx="8" fill="none" stroke="{scol}" stroke-opacity="0.5"/>'
        f'<g transform="translate(13,10)">'
        f'<rect width="14" height="4" rx="2" y="0" fill="#16a34a"/>'
        f'<rect width="20" height="4" rx="2" y="6" fill="#d97706"/>'
        f'<rect width="26" height="4" rx="2" y="12" fill="#dc2626"/></g>'
        f'<text x="49" y="20" font-family="ui-monospace,Menlo,monospace" font-size="10" '
        f'letter-spacing="1.2" fill="#8ba39f">STRATA · EVIDENCE VERIFIED</text>'
        f'<text x="49" y="38" font-family="system-ui,sans-serif" font-size="15" font-weight="700" '
        f'fill="{scol}">{r.status}</text>'
        f'<text x="{width-13}" y="38" text-anchor="end" font-family="ui-monospace,Menlo,monospace" '
        f'font-size="11" font-weight="700" fill="{stcol}">{r.strength.upper()}</text>'
        f'<text x="{width-13}" y="19" text-anchor="end" font-family="ui-monospace,Menlo,monospace" '
        f'font-size="8" fill="#5d7573">{r.supporting}▲ {r.contradicting}▼</text>'
        f'</svg>'
    )


def render_html_card(r: Receipt) -> str:
    """A standalone, inline-styled receipt card — safe to embed anywhere."""
    scol, stcol = _badge_colors(r)
    changed = ('<span style="color:#f59e0b;font-weight:700">● evidence changed</span>'
               if r.evidence_changed else '<span style="color:#5d7573">no change</span>')
    cites = "".join(
        f'<div style="display:flex;gap:8px;padding:6px 0;border-top:1px solid #16302f">'
        f'<span style="font-family:ui-monospace,monospace;color:{STRENGTH_COLOR.get(cc.get("strength"),"#64748b")};'
        f'font-size:11px;white-space:nowrap">{_stance_glyph(cc.get("stance"))}</span>'
        f'<span style="font-size:12px;color:#c7d6d3">[{cc.get("label","")}, {cc.get("year") or "n.d."}] '
        f'{_esc(cc.get("title",""))}</span></div>'
        for cc in r.citations[:6])
    lim = (f'<div style="font-size:12px;color:#e8b769;margin-top:8px">⚠ {_esc(r.key_limitation)}</div>'
           if r.key_limitation else "")
    return (
        f'<div style="font-family:system-ui,sans-serif;background:#0a1315;border:1px solid #193034;'
        f'border-radius:14px;padding:16px 18px;max-width:520px;color:#e8f2f0">'
        f'<div style="display:flex;justify-content:space-between;align-items:center;font-family:ui-monospace,monospace;'
        f'font-size:10px;letter-spacing:1.5px;color:#5d7573">STRATA EVIDENCE RECEIPT<span>{r.receipt_id}</span></div>'
        f'<div style="font-size:15px;font-weight:600;margin:10px 0 12px;line-height:1.35">"{_esc(r.claim)}"</div>'
        f'<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px">'
        f'<span style="background:{scol};color:#04120f;font-weight:800;font-size:13px;padding:4px 10px;border-radius:7px">{r.status}</span>'
        f'<span style="color:{stcol};font-weight:700;text-transform:capitalize">{r.strength} certainty</span></div>'
        f'<div style="display:flex;gap:16px;font-size:13px;margin-bottom:6px">'
        f'<span style="color:#22c55e">▲ {r.supporting} supporting</span>'
        f'<span style="color:#f2564a">▼ {r.contradicting} contradicting</span>'
        f'<span style="color:#8ba39f">◦ {r.neutral} neutral</span></div>'
        f'{lim}'
        f'<div style="margin-top:12px">{cites}</div>'
        f'<div style="display:flex;justify-content:space-between;font-family:ui-monospace,monospace;font-size:10px;'
        f'color:#5d7573;margin-top:12px;border-top:1px solid #16302f;padding-top:8px">'
        f'<span>checked {r.checked[:10]}</span>{changed}</div></div>')


def _stance_glyph(stance):
    return {"support": "▲", "contradict": "▼", "neutral": "◦"}.get(stance, "◦")


def _esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))
