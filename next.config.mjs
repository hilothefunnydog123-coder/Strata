/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server output, used to package the Electron desktop app.
  output: "standalone",
};

export default nextConfig;
