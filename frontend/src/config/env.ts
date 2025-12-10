// Dynamic environment detection
const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const DEPLOYED_BACKEND_URL = 'https://dlx-trading-backend.web.app'; // Replace with actual backend URL

// API configuration with environment detection
export const API_BASE_URL = isLocalhost
  ? "http://localhost:4000"
  : DEPLOYED_BACKEND_URL;

export const WS_URL = isLocalhost
  ? "ws://localhost:4000/ws"
  : `wss://${DEPLOYED_BACKEND_URL.replace('https://', '')}/ws`;

// Legacy compatibility
export const API_BASE = API_BASE_URL;
export const API_URL = `${API_BASE_URL}/api`;

// Log environment loading for debugging
console.log('[ENV] Dynamic environment detection:');
console.log('  - hostname:', typeof window !== 'undefined' ? window.location.hostname : 'SSR');
console.log('  - isLocalhost:', isLocalhost);
console.log('  - DEPLOYED_BACKEND_URL:', DEPLOYED_BACKEND_URL);
console.log('  - API_BASE_URL resolved to:', API_BASE_URL);
console.log('  - WS_URL resolved to:', WS_URL);
console.log('  - API_URL resolved to:', API_URL);
