import { describe, it, expect } from "vitest";
import { parseHtmlToSpans } from "./html";
import { verifyQuote } from "@assent/core";

const HTML = `
<html><body>
<nav>site nav should be ignored</nav>
<main>
  <h1>MolDX: Molecular Testing</h1>
  <h2>Coverage Indications, Limitations, and/or Medical Necessity</h2>
  <p>The test is covered when clinical validity has been established in a peer-reviewed study.</p>
  <h3>Analytical Validity</h3>
  <ul>
    <li>Analytical validity must be demonstrated with a concordance of at least 95%.</li>
    <li>Specimen requirements must be documented.</li>
  </ul>
  <h2>Limitations</h2>
  <p>Testing is considered investigational for screening in asymptomatic individuals.</p>
</main>
<footer>footer text ignored</footer>
</body></html>`;

describe("parseHtmlToSpans", () => {
  const doc = parseHtmlToSpans(HTML);

  it("emits one span per block, skipping nav/footer and headings", () => {
    expect(doc.spans.length).toBe(4);
    expect(doc.fullText).not.toContain("site nav");
    expect(doc.fullText).not.toContain("footer text");
  });

  it("carries the heading path root → leaf", () => {
    const av = doc.spans.find((s) => s.text.includes("concordance"))!;
    expect(av.headingPath).toEqual([
      "MolDX: Molecular Testing",
      "Coverage Indications, Limitations, and/or Medical Necessity",
      "Analytical Validity",
    ]);
    const lim = doc.spans.find((s) => s.text.includes("investigational"))!;
    expect(lim.headingPath).toEqual(["MolDX: Molecular Testing", "Limitations"]);
  });

  it("produces char offsets that slice the reconstructed document text", () => {
    for (const s of doc.spans) {
      expect(doc.fullText.slice(s.charStart, s.charEnd)).toBe(s.text);
    }
  });

  it("produces spans whose text a verbatim quote verifies against (the invariant path)", () => {
    const av = doc.spans.find((s) => s.text.includes("concordance"))!;
    expect(verifyQuote(av.text, "concordance of at least 95%").ok).toBe(true);
    expect(verifyQuote(av.text, "concordance of at least 99%").ok).toBe(false);
  });
});
