import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['pg', '@anthropic-ai/sdk'],
  experimental: {
    // Server actions carry appeal content. Keep the body cap tight; documents
    // are uploaded to object storage rather than through an action payload.
    serverActions: { bodySizeLimit: '2mb' },
    // Lets forbidden() render a real 403 rather than a not-found page, so an
    // authorisation failure is distinguishable from a missing record.
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
