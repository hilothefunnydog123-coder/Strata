import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { ParsedDocument, ParsedSpan } from "./types";

/**
 * HTML → normalized text + span index (PROMPT §6 Parse). Every span carries a
 * page number, character offsets into the reconstructed document text, and a
 * heading_path (root → leaf). Payer policies are deeply sectioned and that
 * section context substantially improves extraction quality, so we keep it.
 */

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "HEADER", "FOOTER", "ASIDE", "FORM", "BUTTON"]);
// Block elements we treat as leaf spans (do not descend past them for emission).
const EMIT = new Set(["P", "LI", "BLOCKQUOTE", "DT", "DD", "TD", "TH", "FIGCAPTION", "PRE"]);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

function normText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface Heading {
  level: number;
  text: string;
}

interface WalkState {
  spans: ParsedSpan[];
  parts: string[];
  cursor: number;
  ordinal: number;
  page: number;
  headings: Heading[];
}

function isElement(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName !== undefined && (n as HTMLElement).tagName !== null;
}

function emit(state: WalkState, text: string): void {
  const clean = normText(text);
  if (clean.length === 0) return;
  const sep = state.parts.length > 0 ? "\n\n" : "";
  const charStart = state.cursor + sep.length;
  const charEnd = charStart + clean.length;
  state.parts.push(sep + clean);
  state.cursor = charEnd;
  state.spans.push({
    ordinal: state.ordinal++,
    pageNumber: state.page,
    charStart,
    charEnd,
    text: clean,
    headingPath: state.headings.map((h) => h.text),
  });
}

function walk(node: Node, state: WalkState): void {
  if (!isElement(node)) return;
  const tag = node.tagName?.toUpperCase();
  if (!tag || SKIP.has(tag)) return;

  // Explicit page markers (real PDFs paginate; fixtures may simulate it).
  const dataPage = node.getAttribute?.("data-page");
  if (dataPage && /^\d+$/.test(dataPage)) state.page = Number(dataPage);
  const cls = node.getAttribute?.("class") ?? "";
  if (/\bpage-?break\b/.test(cls)) state.page += 1;

  if (HEADINGS[tag] !== undefined) {
    const level = HEADINGS[tag]!;
    while (state.headings.length && state.headings[state.headings.length - 1]!.level >= level) {
      state.headings.pop();
    }
    const text = normText(node.text);
    if (text) state.headings.push({ level, text });
    return;
  }

  if (EMIT.has(tag)) {
    emit(state, node.text);
    return;
  }

  for (const child of node.childNodes) walk(child, state);
}

export interface ParseOptions {
  /** CSS selector for the content root; defaults to main/article/body. */
  contentSelector?: string;
}

export function parseHtmlToSpans(html: string, opts: ParseOptions = {}): ParsedDocument {
  const root = parse(html, { blockTextElements: { pre: true } });
  let content: HTMLElement | null = null;
  if (opts.contentSelector) content = root.querySelector(opts.contentSelector);
  content =
    content ??
    root.querySelector("main") ??
    root.querySelector("article") ??
    root.querySelector("body") ??
    root;

  const state: WalkState = { spans: [], parts: [], cursor: 0, ordinal: 0, page: 1, headings: [] };
  for (const child of content.childNodes) walk(child, state);

  return { fullText: state.parts.join(""), spans: state.spans };
}
