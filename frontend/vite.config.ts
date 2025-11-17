import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL?.replace('/api', '') || 'https://dlxtrade-ws-1.onrender.com',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_WS_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'https://dlxtrade-ws-1.onrender.com',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

