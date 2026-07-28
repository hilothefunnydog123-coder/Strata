import { describe, it, expect } from "vitest";
import { selectListPath, selectDetailPath, routeExists, extractItems, specUrlsFromHtml } from "./sources/cms";

/**
 * These pin what the LIVE API taught us, using its real response bodies. They are
 * the difference between "we think the endpoint looks like this" and "the host said
 * so and here is the string it said it with".
 */
describe("what the live CMS API told us", () => {
  const NOT_FOUND = '{"message":"Hello MCIM API Users! Please reference the documentation at /docs/v1/swagger to make use of the proper endpoints.","id":404}';

  it("treats the MCIM greeting as route-not-found", () => {
    // Every invented path returned exactly this, so it is the negative signal.
    expect(routeExists(NOT_FOUND)).toBe(false);
  });

  it("treats a missing-parameter complaint as a route that EXISTS", () => {
    // /v1/data/ncd answered this. A 400 here is a discovery, not a failure.
    expect(routeExists('{"message":"You must include a ncdid","id":400}')).toBe(true);
    // /v1/data named a real sibling collection the same way.
    expect(routeExists('{"message":"Please add one of the data endpoints, like /contractor","id":404}')).toBe(true);
  });

  it("does not mistake an empty body for a live route", () => {
    expect(routeExists("")).toBe(false);
  });

  it("finds the row array whatever the envelope is called", () => {
    expect(extractItems([{ a: 1 }])).toHaveLength(1);
    expect(extractItems({ data: [{ a: 1 }, { a: 2 }] })).toHaveLength(2);
    expect(extractItems({ results: [{ a: 1 }] })).toHaveLength(1);
    // An unanticipated key still works, because committing to `data` would fail for
    // no good reason on an API whose shape we have not seen.
    expect(extractItems({ ncdDocuments: [{ a: 1 }, { a: 2 }, { a: 3 }] })).toHaveLength(3);
    expect(extractItems({ message: "nope" })).toBeNull();
  });

  it("scrapes the spec URL out of a Swagger UI page", () => {
    // /docs returns HTML titled "Coverage API"; such a page always names its spec.
    const html = `<html><head><title>Coverage API</title></head><body>
      <script>SwaggerUIBundle({ url: "/docs/v1/swagger/v1/swagger.json", dom_id: "#ui" })</script>
    </body></html>`;
    expect(specUrlsFromHtml(html, "https://api.coverage.cms.gov/docs")).toContain(
      "https://api.coverage.cms.gov/docs/v1/swagger/v1/swagger.json",
    );
  });

  it("ignores unrelated URLs on the docs page", () => {
    const html = `<link rel="stylesheet" href="/css/site.css"><a href="https://cms.gov/about">About</a>`;
    expect(specUrlsFromHtml(html, "https://api.coverage.cms.gov/docs")).toEqual([]);
  });
});

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
