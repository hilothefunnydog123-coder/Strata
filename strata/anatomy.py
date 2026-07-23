"""Anatomical mapping — where a body of evidence acts.

A living review is *about* something: a disease, an organ system, a physiological
process. This module maps the language of a review (its question plus the titles and
abstracts it retrieved) onto regions of the body, so the Console can pinpoint — on a
live 3-D model — where the literature concentrates.

This is a map of the *evidence*, not of a patient. It says "this body of literature
concerns the lungs," never "this person has a lung problem." That distinction keeps
Strata firmly in decision-support / research territory — no diagnosis, no advice.

Coordinate convention (shared verbatim with the front-end model):

    origin at the pelvis; y up (feet ≈ -1.0, head-top ≈ +1.02),
    x to the subject's right (+), z toward the viewer / front (+),
    all in a normalized humanoid ~2 units tall.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Region:
    id: str
    name: str
    x: float
    y: float
    z: float
    systemic: bool          # acts body-wide (immune, vascular, metabolic, skin, skeleton)
    patterns: tuple         # regex fragments (already lowercased)


# The regions. Coordinates are hand-placed in the shared normalized space so the pins
# land on the right part of the rendered model. `systemic` regions also raise a
# body-wide aura in the viewer instead of reading as a single point source.
REGIONS = (
    Region("brain", "Brain / CNS", 0.0, 0.92, 0.02, False,
           (r"\bbrain", r"cerebr", r"\bstroke", r"cognit", r"dementia", r"alzheimer",
            r"parkinson", r"epilep", r"seizure", r"migraine", r"neurolog", r"\bcns\b",
            r"multiple sclerosis", r"depress", r"anxiety", r"psychiatr", r"schizophren")),
    Region("eyes", "Eyes / vision", 0.0, 0.82, 0.12, False,
           (r"\bocular", r"\bretina", r"macular", r"glaucoma", r"vision", r"\beye\b", r"cataract")),
    Region("thyroid", "Thyroid", 0.0, 0.68, 0.07, False,
           (r"thyroid", r"hypothyroid", r"hyperthyroid", r"goitre", r"goiter")),
    Region("lungs", "Lungs / respiratory", 0.0, 0.47, 0.04, False,
           (r"respiratory", r"pulmon", r"\blung", r"\bcopd\b", r"asthma", r"pneumonia",
            r"bronch", r"influenza", r"\bard[s]?\b", r"\bcovid", r"sars-cov", r"airway")),
    Region("heart", "Heart / cardiovascular", -0.05, 0.43, 0.07, False,
           (r"cardiovascular", r"\bcardiac", r"\bheart", r"coronary", r"myocard",
            r"\bmi\b", r"atrial", r"arrhythm", r"heart failure", r"\bhf\b", r"ischemi",
            r"ischaemi", r"angina", r"atheroscler")),
    Region("vascular", "Vasculature / blood", -0.05, 0.40, 0.06, True,
           (r"hypertension", r"blood pressure", r"\bbp\b", r"thrombo", r"embol",
            r"anticoagul", r"\bstroke", r"\bvascular", r"lipid", r"cholesterol", r"statin")),
    Region("liver", "Liver", 0.11, 0.25, 0.07, False,
           (r"hepat", r"\bliver", r"cirrhos", r"nafld", r"nash\b", r"fibros")),
    Region("stomach", "Stomach / upper GI", -0.05, 0.27, 0.09, False,
           (r"gastric", r"\bstomach", r"peptic", r"\bulcer", r"reflux", r"\bgerd\b",
            r"dyspepsia", r"\bppi\b", r"\bh\.? pylori")),
    Region("pancreas", "Pancreas / metabolic", 0.0, 0.23, 0.02, True,
           (r"diabet", r"glycaemi", r"glycemi", r"insulin", r"glucose", r"metabol",
            r"pancrea", r"\bhba1c", r"metformin", r"\bsglt2", r"\bglp-?1", r"obesity",
            r"weight loss", r"\bbmi\b")),
    Region("kidneys", "Kidneys", 0.0, 0.17, -0.08, False,
           (r"\brenal", r"kidney", r"nephro", r"\bckd\b", r"dialysis", r"glomerul",
            r"albuminuria", r"\begfr\b")),
    Region("intestines", "Intestine / lower GI", 0.0, 0.09, 0.08, False,
           (r"\bbowel", r"intestin", r"\bcolon", r"colorect", r"crohn", r"colitis",
            r"\bibd\b", r"\bibs\b", r"diverticul", r"microbiome", r"\bgut\b")),
    Region("bladder", "Bladder / urogenital", 0.0, -0.02, 0.07, False,
           (r"bladder", r"urinary", r"prostat", r"incontinence", r"\buti\b")),
    Region("repro", "Reproductive", 0.0, -0.04, 0.05, False,
           (r"pregnan", r"obstetr", r"gynaecolog", r"gynecolog", r"fertil",
            r"menopaus", r"contracept", r"endometri", r"\bovar", r"\buter")),
    Region("bones", "Bones / joints", -0.12, -0.45, 0.03, True,
           (r"\bbone", r"osteo", r"fracture", r"arthr", r"\bjoint", r"musculoskeletal",
            r"rheumat", r"\bspine", r"\bhip\b", r"\bknee")),
    Region("skin", "Skin", 0.24, 0.30, 0.04, True,
           (r"\bskin", r"dermat", r"eczema", r"psorias", r"\bwound", r"melanoma", r"\bacne")),
    Region("immune", "Immune / infection", 0.0, 0.47, 0.0, True,
           (r"immun", r"infection", r"\bsepsis", r"antibiotic", r"antimicrob", r"vaccin",
            r"inflammat", r"autoimmun", r"\bhiv\b", r"\bcovid", r"supplement", r"vitamin")),
    Region("blood_ca", "Haematologic / systemic", 0.0, 0.35, 0.0, True,
           (r"leukaem", r"leukem", r"lymphoma", r"myeloma", r"anaem", r"anem", r"haematolog")),
)

# a generic representative point for tumours qualified by an organ; oncology without a
# site falls back to systemic.
_CANCER = (r"cancer", r"tumou?r", r"oncolog", r"carcinoma", r"malignan", r"metasta", r"chemotherap")


def _score_text(text: str) -> dict:
    """Count regex hits per region across the review's text."""
    t = text.lower()
    hits: dict[str, int] = {}
    for r in REGIONS:
        c = 0
        for p in r.patterns:
            c += len(re.findall(p, t))
        if c:
            hits[r.id] = c
    # oncology: attribute to whichever organ region is already lit, else systemic
    if any(re.search(p, t) for p in _CANCER):
        if hits:
            top = max(hits, key=hits.get)
            hits[top] = hits.get(top, 0) + 2
        else:
            hits["immune"] = hits.get("immune", 0) + 2
    return hits


@dataclass
class Hotspot:
    id: str
    name: str
    x: float
    y: float
    z: float
    systemic: bool
    intensity: float        # 0..1, share of matched signal
    weight: int             # raw hit count
    strength: str           # carried from the review's overall verdict


def hotspots_for(text: str, strength: str = "moderate", *, top: int = 4) -> list[Hotspot]:
    """Return the anatomical regions this body of evidence concerns, strongest first.

    `intensity` is each region's share of the total matched signal; the front-end uses
    it to size and brighten the pin. Empty when nothing matches — honest silence, the
    same way the grader reports absent evidence.
    """
    hits = _score_text(text)
    if not hits:
        return []
    by_id = {r.id: r for r in REGIONS}
    total = sum(hits.values()) or 1
    ranked = sorted(hits.items(), key=lambda kv: -kv[1])[:top]
    out = []
    for rid, w in ranked:
        r = by_id[rid]
        out.append(Hotspot(id=r.id, name=r.name, x=r.x, y=r.y, z=r.z,
                           systemic=r.systemic, intensity=round(w / total, 3),
                           weight=w, strength=strength))
    return out


def to_dict(h: Hotspot) -> dict:
    return {"id": h.id, "name": h.name, "x": h.x, "y": h.y, "z": h.z,
            "systemic": h.systemic, "intensity": h.intensity, "weight": h.weight,
            "strength": h.strength}
