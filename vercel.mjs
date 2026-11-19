// Vercel evaluates this file during each deployment build. Fail closed: only
// Production receives the reverse proxy to the production admin API.
const production = process.env.VERCEL_ENV === 'production';

export const config = production
  ? {
      rewrites: [
        {
          source: '/api/:path*',
          destination: 'https://linkify-whvp.onrender.com/api/:path*',
        },
      ],
      headers: [
        {
          source: '/api/:path*',
          headers: [
            { key: 'Cache-Control', value: 'no-store' },
            { key: 'x-vercel-enable-rewrite-caching', value: '0' },
          ],
        },
      ],
    }
  : {};
