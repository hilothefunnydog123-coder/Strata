import { describe, it, expect } from "vitest";
import { selectListPath, selectDetailPath } from "./sources/cms";

/**
 * The CMS fetcher now reads the API's own OpenAPI document and picks its endpoints
 * by shape rather than by a hardcoded guess. These tests pin that selection, because
 * it is the part that decides whether the corpus is real and the part that cannot be
 * exercised offline against the live host.
 *
 * The live API told us the base was right and the path invented:
 *
 *   400 {"message":"Hello MCIM API Users! Please reference the documentation at
 *        /docs/v1/swagger to make use of the proper endpoints.","id":404}
 *
 * so the shapes below are plausible routes such an API exposes. Selection has to
 * survive not knowing which one it will actually meet.
 */
describe("CMS endpoint discovery", () => {
  it("prefers an index route over a lookup for listing", () => {
    const paths = [
      "/v1/data/ncd/{ncdId}",
      "/v1/reports/ncd-alphabetical",
      "/v1/data/lcd/{lcdId}",
    ];
    expect(selectListPath(paths, "ncd")).toBe("/v1/reports/ncd-alphabetical");
  });

  it("never chooses a parameterised path to list with", () => {
    const paths = ["/v1/ncd/{id}", "/v1/ncd/{id}/versions"];
    expect(selectListPath(paths, "ncd")).toBeNull();
  });

  it("finds a listing route whose name we did not anticipate", () => {
    // The point of scoring rather than matching: an unexpected-but-reasonable name
    // still wins over giving up and falling back to a guess.
    const paths = ["/v1/ncd/search", "/v1/unrelated/thing"];
    expect(selectListPath(paths, "ncd")).toBe("/v1/ncd/search");
  });

  it("keeps NCD and LCD apart", () => {
    const paths = ["/v1/reports/ncd-alphabetical", "/v1/reports/lcd-alphabetical"];
    expect(selectListPath(paths, "lcd")).toBe("/v1/reports/lcd-alphabetical");
    expect(selectListPath(paths, "ncd")).toBe("/v1/reports/ncd-alphabetical");
  });

  it("picks the single-parameter route for document detail", () => {
    const paths = [
      "/v1/reports/ncd-alphabetical",
      "/v1/data/ncd/{ncdId}",
      "/v1/data/ncd/{ncdId}/versions/{version}",
    ];
    expect(selectDetailPath(paths, "ncd")).toBe("/v1/data/ncd/{ncdId}");
  });

  it("returns null rather than a wrong guess when nothing matches", () => {
    const paths = ["/v1/health", "/v1/docs/swagger"];
    expect(selectListPath(paths, "ncd")).toBeNull();
    expect(selectDetailPath(paths, "ncd")).toBeNull();
  });
});
