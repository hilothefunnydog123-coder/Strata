"""Model abstraction layer — route tasks to models, degrade gracefully.

Strata is *bring-your-own-model* by design: a model is any ``str -> str``
callable. Different stages of the pipeline want different capability/cost
trade-offs, so the router lets you register a model per task and always falls
back cleanly — a stronger model for contradiction analysis, a cheap one for
query expansion, and, when nothing is configured, deterministic heuristics.

The cardinal rule (enforced by callers, not hidden here): **the model never
invents a medical fact.** It only ever restructures text we already retrieved.
If a model is unavailable or errors, the stage falls back to a transparent
heuristic and the result is labelled as such — an analysis is never faked.

    from strata.models import ROUTER
    ROUTER.register("synthesize", my_llm)          # any str->str callable
    text = ROUTER.generate("synthesize", prompt)   # -> str | None (None => no model)

Tasks used across the pipeline:

    expand       query expansion / synonym mining        (cheap model)
    classify     study-design classification              (cheap model)
    extract      structured evidence extraction           (mid model)
    contradict   supporting/contradicting analysis        (stronger model)
    synthesize   final grounded narrative                 (strongest model)
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

Model = Callable[[str], str]

TASKS = ("expand", "classify", "extract", "contradict", "synthesize")


class ModelRouter:
    """Maps task names to models, with per-task and global fallback chains.

    Registration is programmatic (no vendor SDKs, no hardcoded providers). A
    task with no registered model returns ``None`` from :meth:`generate`, which
    is the signal every caller uses to take its deterministic path.
    """

    def __init__(self) -> None:
        self._models: Dict[str, List[Model]] = {t: [] for t in TASKS}
        self._default: List[Model] = []

    def register(self, task: str, model: Model, *, fallback: bool = False) -> "ModelRouter":
        """Register ``model`` for ``task`` (or as a global default).

        ``task="*"`` registers a default used by any task with no model of its
        own. ``fallback=True`` appends after existing models instead of taking
        priority.
        """
        if task == "*":
            chain = self._default
        elif task in self._models:
            chain = self._models[task]
        else:
            raise ValueError(f"unknown task {task!r}; expected one of {TASKS} or '*'")
        if fallback:
            chain.append(model)
        else:
            chain.insert(0, model)
        return self

    def chain(self, task: str) -> List[Model]:
        return list(self._models.get(task, [])) + list(self._default)

    def has(self, task: str) -> bool:
        return bool(self.chain(task))

    @property
    def any(self) -> bool:
        """True if *any* model is registered — i.e. narrative synthesis is possible."""
        return any(self.chain(t) for t in TASKS)

    def generate(self, task: str, prompt: str, *, fallback: Optional[str] = None) -> Optional[str]:
        """Run the first working model for ``task``; return ``fallback`` if none.

        Never raises on model failure — a dead model is skipped and the next in
        the chain is tried. Returns ``None`` (or ``fallback``) when no model
        produces output, which callers read as "take the deterministic path".
        """
        for model in self.chain(task):
            try:
                out = model(prompt)
            except Exception:
                continue
            if out and out.strip():
                return out.strip()
        return fallback


# A process-wide default router. Applications register models onto it once at
# startup; the pipeline reads from it. Tests construct their own.
ROUTER = ModelRouter()
