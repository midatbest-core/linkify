import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const apiUrl = process.env.VITE_API_URL;
    const isVercel = Boolean(process.env.VERCEL);
    const vercelEnvironment = process.env.VERCEL_ENV;
    const productionProxyOrigin = 'https://linkify-3jnh.vercel.app';
    if (isVercel && vercelEnvironment === 'production' && apiUrl !== productionProxyOrigin) {
      throw new Error('Vercel Production builds require VITE_API_URL=https://linkify-3jnh.vercel.app.');
    }
    if (isVercel && vercelEnvironment === 'preview' && apiUrl) {
      throw new Error('Vercel Preview builds must not set VITE_API_URL; same-origin API calls are rejected by the production Origin check.');
    }
    if (apiUrl && apiUrl !== productionProxyOrigin) {
      throw new Error('Production API requests must use the same-origin Vercel API proxy.');
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5174, strictPort: true },
  };
});
