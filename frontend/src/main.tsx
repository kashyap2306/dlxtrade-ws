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

// Global Firebase debug function (development only)
if (import.meta.env.DEV) {
  setTimeout(async () => {
    console.log('[DEBUG] === Firebase Integration Status ===');

    try {
      // Import Firebase services dynamically to avoid circular dependencies
      const { auth, isFirebaseAvailable, isFirebaseReady } = await import('./config/firebase');

      console.log('✅ Firebase initialized:', isFirebaseReady());
      console.log('✅ Firebase available:', isFirebaseAvailable());
      console.log('✅ Auth instance exists:', !!auth);
      console.log('✅ Current user:', auth?.currentUser ? 'YES' : 'NO');

      if (auth?.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken();
          console.log('✅ Token retrievable:', !!token);
        } catch (error) {
          console.log('❌ Token retrieval failed:', error.message);
        }
      }

      // Test axios interceptor
      const { default: api } = await import('./config/axios');
      console.log('✅ Axios instance available:', !!api);
      console.log('✅ Axios baseURL:', api.defaults.baseURL);
      console.log('✅ Axios interceptor active:', !!(api.interceptors?.request?.handlers?.length > 0));

      // Test WebSocket token
      const { getAuthToken } = await import('./config/firebase');
      const wsToken = await getAuthToken();
      console.log('✅ WebSocket token available:', !!wsToken);

      // Runtime checks as specified in requirements
      console.log('[RUNTIME CHECK] typeof isFirebaseAvailable:', typeof isFirebaseAvailable);
      console.log('[RUNTIME CHECK] typeof getAuthToken:', typeof getAuthToken);
      console.log('[RUNTIME CHECK] api.defaults.baseURL:', api.defaults.baseURL);

    } catch (error) {
      console.error('❌ Debug function failed:', error);
    }

    console.log('==========================================');
    console.log('💡 Run window.debugFirebase() for more details');
  }, 2000);

  // Run smoke tests in development
  setTimeout(async () => {
    console.log('[SMOKE TESTS] Starting smoke tests...');

    try {
      const { testDashboard } = await import('./tests/test-dashboard');
      const { testAgentsMarketplace } = await import('./tests/test-agents-marketplace');
      const { testResearch } = await import('./tests/test-research');
      const { testAutoTrade } = await import('./tests/test-auto-trade');
      const { testSettings } = await import('./tests/test-settings');
      const { testProfile } = await import('./tests/test-profile');

      await Promise.all([
        testDashboard(),
        testAgentsMarketplace(),
        testResearch(),
        testAutoTrade(),
        testSettings(),
        testProfile(),
      ]);

      console.log('[SMOKE TESTS] All tests completed');
    } catch (error) {
      console.error('[SMOKE TESTS] Error running tests:', error);
    }
  }, 3000);
}

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

