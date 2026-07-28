import { describe, it, expect } from "vitest";
import { sslOptionFor } from "./client";

/**
 * Managed Postgres (Render, Neon, Supabase) terminates TLS with a cert whose chain
 * the container does not carry; local development uses no TLS at all. Getting this
 * wrong is a deploy-time-only failure, so it is pinned here.
 */
describe("sslOptionFor", () => {
  it("disables TLS for local development", () => {
    expect(sslOptionFor("postgres://assent@localhost:5432/assent_dev")).toBe(false);
    expect(sslOptionFor("postgres://assent@127.0.0.1:5433/assent_dev")).toBe(false);
  });

  it("enables TLS without chain verification for a managed host", () => {
    expect(sslOptionFor("postgres://u:p@dpg-abc123.oregon-postgres.render.com/assent"))
      .toEqual({ rejectUnauthorized: false });
  });

  it("honors an explicit sslmode in the URL", () => {
    expect(sslOptionFor("postgres://u:p@host.example.com/db?sslmode=disable")).toBe(false);
    expect(sslOptionFor("postgres://u:p@host.example.com/db?sslmode=require"))
      .toEqual({ rejectUnauthorized: false });
    expect(sslOptionFor("postgres://u:p@host.example.com/db?sslmode=verify-full")).toBe("verify-full");
  });

  it("does not throw on an unparseable URL", () => {
    expect(() => sslOptionFor("not a url")).not.toThrow();
  });
});
