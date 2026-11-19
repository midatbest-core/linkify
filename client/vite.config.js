import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    const apiUrl = process.env.VITE_API_URL;
    if (!apiUrl || !/^https:\/\//.test(apiUrl) || /localhost|127\.0\.0\.1/i.test(apiUrl)) {
      throw new Error('Production builds require VITE_API_URL set to the HTTPS deployed API origin.');
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5174, strictPort: true },
  };
});
