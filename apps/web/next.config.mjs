/**
 * @type {import('next').NextConfig}
 *
 * Response headers are set here rather than in a proxy so they travel with the app:
 * the same protections apply on Render, locally, and anywhere else it is deployed,
 * and they cannot be lost by a platform change nobody remembers making.
 */

/**
 * The CSP is written against what this app actually loads — everything from its own
 * origin, plus two exceptions that are real rather than lazy:
 *
 *   'unsafe-inline' for scripts — Next inlines its hydration bootstrap and flight
 *   payload. Removing it needs per-request nonces threaded through every entry
 *   point. Worth doing; dishonest to claim as done.
 *
 *   data: for images — the enrollment QR is generated server-side and handed over as
 *   a data URI precisely so no third party ever sees a TOTP secret.
 *
 * frame-ancestors 'none' is the one that matters most: the console renders coverage
 * positions behind a session, and nothing should be able to frame it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // The terminal injects <base href="/terminal/">; 'self' permits that and no more.
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Render terminates TLS in front of this, so HSTS is safe to assert.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // no free version disclosure
  // Internal packages are consumed as TypeScript source (no build step).
  transpilePackages: ["@assent/core", "@assent/ui", "@assent/db"],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // postgres and nodemailer (node) are only used in server code / route handlers.
    serverComponentsExternalPackages: ["postgres", "nodemailer"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
export default nextConfig;
