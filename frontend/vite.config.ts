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
        target: process.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_WS_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'ws://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

