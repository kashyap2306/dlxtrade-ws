// Dynamic environment detection
const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

// PRODUCTION BACKEND URL - Always use Render backend in production
// This overrides any VITE_ environment variables that might be set incorrectly
const DEPLOYED_BACKEND_URL = 'https://dlxtrade-ws-1.onrender.com';

// API configuration with environment detection
// In production, ALWAYS use Render backend URL (ignore any env vars)
export const API_BASE_URL = import.meta.env.PROD
  ? DEPLOYED_BACKEND_URL
  : ((import.meta.env.VITE_API_URL as string | undefined) || (isLocalhost ? "http://localhost:4000" : DEPLOYED_BACKEND_URL));

// WebSocket URL construction
// Converts https:// to wss:// and http:// to ws://
export const WS_URL = (() => {
  if (isLocalhost) {
    const viteWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
    if (viteWsUrl && viteWsUrl.trim().length > 0) return viteWsUrl;
    return "ws://localhost:4000/ws";
  }
  // Convert https:// to wss:// for WebSocket (or http:// to ws://)
  const wsHost = DEPLOYED_BACKEND_URL.replace('https://', '').replace('http://', '');
  return `wss://${wsHost}/ws`;
})();

// Legacy compatibility
export const API_BASE = API_BASE_URL;
export const API_URL = `${API_BASE_URL}/api`;

// Log environment loading for debugging
console.log('[ENV] Dynamic environment detection:');
console.log('  - hostname:', typeof window !== 'undefined' ? window.location.hostname : 'SSR');
console.log('  - isLocalhost:', isLocalhost);
console.log('  - PROD_MODE:', import.meta.env.PROD);
console.log('  - DEPLOYED_BACKEND_URL (Render):', DEPLOYED_BACKEND_URL);
console.log('  - API_BASE_URL resolved to:', API_BASE_URL);
console.log('  - WS_URL resolved to:', WS_URL);
console.log('  - API_URL resolved to:', API_URL);
console.log('  - VITE_API_URL (ignored, using Render URL):', import.meta.env.VITE_API_URL || 'not set');
console.log('  - VITE_WS_URL (ignored, using Render URL):', import.meta.env.VITE_WS_URL || 'not set');
