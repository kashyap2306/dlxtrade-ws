import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';
import { API_URL, WS_URL } from './config/env';

// Telemetry and performance monitoring
const startTime = performance.now();

console.log('[APP] Initializing DLXTRADE frontend...');
console.log('[CONFIG] Environment check:');
console.log('  - window.location.origin:', window.location.origin);
console.log('  - import.meta.env.MODE:', import.meta.env.MODE);
console.log('  - import.meta.env.DEV:', import.meta.env.DEV);
console.log('  - VITE_API_URL (env):', import.meta.env.VITE_API_URL);
console.log('  - VITE_WS_URL (env):', import.meta.env.VITE_WS_URL);
console.log('  - API_URL (imported):', API_URL);
console.log('  - WS_URL (imported):', WS_URL);
console.log("[API URL CHECK]", API_URL);
console.log("[WS URL CHECK]", WS_URL);

// Track first paint
if ('PerformanceObserver' in window) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          console.log(`[PERF] First Contentful Paint: ${entry.startTime}ms`);
        }
      }
    });
    observer.observe({ entryTypes: ['paint'] });
  } catch (e) {
    console.warn('[PERF] Performance observer not supported');
  }
}

// Track app initialization time
setTimeout(() => {
  const initTime = performance.now() - startTime;
  console.log(`[APP] App initialized in ${initTime.toFixed(2)}ms`);
}, 0);

// Global error logging for production
if (!import.meta.env.DEV) {
  window.addEventListener('error', (event) => {
    console.error('[ERROR] Global error:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[ERROR] Unhandled promise rejection:', event.reason);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

