/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages are consumed as TypeScript source (no build step).
  transpilePackages: ["@assent/core", "@assent/ui", "@assent/db"],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // postgres (node) is only used in server code / route handlers.
    serverComponentsExternalPackages: ["postgres"],
  },
};
export default nextConfig;
