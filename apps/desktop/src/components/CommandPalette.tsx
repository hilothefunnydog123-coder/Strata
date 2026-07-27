import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatLives } from "@assent/core";
import { useCorpus } from "../data/corpus";
import { MODULES } from "../nav";

interface PaletteItem {
  group: "Modules" | "Payers" | "Policies";
  kind: string; // mono tag (module number / PAYER / external id)
  label: string;
  sub: string;
  run: () => void;
}

/** ⌘K / Ctrl+K overlay to jump to any module, payer, or policy. Fully keyboard
 *  driven; the open/close animation is disabled under prefers-reduced-motion. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const corpus = useCorpus();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const go = (path: string) => {
    navigate(path);
    onClose();
  };

  const allItems = useMemo<PaletteItem[]>(() => {
    const modules: PaletteItem[] = MODULES.filter((m) => m.enabled).map((m) => ({
      group: "Modules",
      kind: m.num,
      label: m.label,
      sub: m.blurb,
      run: () => go(m.path),
    }));
    const payers: PaletteItem[] = corpus.payers.map((p) => ({
      group: "Payers",
      kind: "PAYER",
      label: p.name,
      sub: `${formatLives(corpus.livesForPayer(p.id))} covered lives`,
      run: () => go(`/corpus?payer=${p.id}`),
    }));
    const policies: PaletteItem[] = corpus.documents.map((d) => ({
      group: "Policies",
      kind: d.externalId,
      label: d.title,
      sub: corpus.payerById(d.payerId)?.name ?? d.payerId,
      run: () => go(`/criteria/${d.id}`),
    }));
    return [...modules, ...payers, ...policies];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpus]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter((it) => `${it.label} ${it.kind} ${it.sub} ${it.group}`.toLowerCase().includes(q));
  }, [allItems, query]);

  useEffect(() => {
    if (active >= items.length) setActive(items.length > 0 ? items.length - 1 : 0);
  }, [items.length, active]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  };

  let lastGroup = "";
  return (
    <div className="d-palette-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="d-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="d-palette-input"
          placeholder="Jump to a module, payer, or policy…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          aria-activedescendant={items.length ? `d-pal-${active}` : undefined}
        />
        <div className="d-palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <div className="d-empty">No matches for “{query}”.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={`${it.group}-${it.kind}-${it.label}-${i}`}>
                {header && <div className="d-palette-group">{header}</div>}
                <div
                  id={`d-pal-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={"d-palette-item" + (i === active ? " d-palette-item--active" : "")}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => it.run()}
                >
                  <span className="d-palette-item-kind a-mono">{it.kind}</span>
                  <span>{it.label}</span>
                  <span className="d-palette-item-sub">{it.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="d-palette-foot">
          <span><span className="d-kbd" style={{ color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>↑↓</span> navigate</span>
          <span><span className="d-kbd" style={{ color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>↵</span> open</span>
          <span><span className="d-kbd" style={{ color: "var(--a-chrome-500)", borderColor: "var(--a-chrome-200)" }}>esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
