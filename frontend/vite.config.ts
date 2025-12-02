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
  envPrefix: 'VITE_',
  base: process.env.VITE_BASE_PATH || '/',
  appType: 'spa',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          ui: ['@headlessui/react', '@heroicons/react', 'recharts'],
          utils: ['axios'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: 'https://dlxtrade-ws-1.onrender.com',
        changeOrigin: true,
      },
      '/ws': {
        target: 'https://dlxtrade-ws-1.onrender.com',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    historyApiFallback: true,
  },
});

