import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The desktop terminal, served to a signed-in browser.
 *
 * M7 ships as a Tauri app, which is not something you can try from a phone in an
 * airport. The renderer is plain React over a bundled corpus with no Tauri IPC in
 * the data path, so the same build runs unmodified in a browser — this route puts
 * it behind the console session instead of behind a download and a code signature.
 *
 * Two things are deliberate:
 *
 * Every byte goes through the session check, not just the entry page. Serving the
 * HTML privately while its chunks and corpus sat on a public path would be a gate
 * in appearance only.
 *
 * A <base> tag is injected rather than maintaining a second build. Tauri loads the
 * bundle from file://, which forces Vite's `base: "./"`, and relative asset URLs
 * resolve against the document path — so /terminal and /terminal/ would resolve
 * differently and one of them would 404. <base href="/terminal/"> pins them both,
 * and it is also what `document.baseURI` gives the corpus loader in App.tsx.
 */

const MOUNT = "/terminal/";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/** cwd is apps/web under `next start`, and the repo root under some runners. */
const CANDIDATES = [
  join(process.cwd(), "..", "desktop", "dist"),
  join(process.cwd(), "apps", "desktop", "dist"),
  join(process.cwd(), "..", "..", "apps", "desktop", "dist"),
];

let resolvedRoot: string | null | undefined;
async function distRoot(): Promise<string | null> {
  if (resolvedRoot !== undefined) return resolvedRoot;
  for (const dir of CANDIDATES) {
    try {
      await stat(join(dir, "index.html"));
      resolvedRoot = dir;
      return dir;
    } catch {
      /* try the next candidate */
    }
  }
  resolvedRoot = null;
  return null;
}

function withBaseTag(html: string): string {
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${MOUNT}">`);
}

export async function GET(_req: Request, ctx: { params: { path?: string[] } }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", _req.url));

  const root = await distRoot();
  if (!root) {
    return NextResponse.json(
      {
        error: "The terminal bundle is not in this image.",
        remedy: "It is produced by `pnpm --filter @assent/desktop build`, which the Dockerfile runs before the web build.",
      },
      { status: 503 },
    );
  }

  const segments = ctx.params.path ?? [];
  const requested = segments.length === 0 ? "index.html" : segments.join("/");

  // Contain the read inside dist: normalize first, then require the resolved path
  // to still start with the root, which rejects `..` however it was encoded.
  const target = normalize(join(root, requested));
  if (target !== root && !target.startsWith(root + sep)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let body: Buffer;
  try {
    body = await readFile(target);
  } catch {
    // Unknown path under a hash-routed SPA: hand back the shell, not a 404.
    if (!extname(requested)) {
      try {
        const html = await readFile(join(root, "index.html"), "utf8");
        return new NextResponse(withBaseTag(html), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      } catch {
        return new NextResponse("Not found", { status: 404 });
      }
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = extname(target).toLowerCase();
  if (ext === ".html") {
    return new NextResponse(withBaseTag(body.toString("utf8")), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // Vite fingerprints asset filenames, so they are safe to cache hard. Private
      // because this is per-session content and must not land in a shared cache.
      "cache-control": /\/assets\//.test(target) ? "private, max-age=31536000, immutable" : "private, no-cache",
    },
  });
}
