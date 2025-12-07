// API configuration with proper fallbacks
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";

// Legacy compatibility
export const API_BASE = API_BASE_URL;
export const API_URL = `${API_BASE_URL}/api`;

// Log environment loading for debugging
console.log('[ENV] Loading environment variables:');
console.log('  - VITE_API_BASE_URL from env:', import.meta.env.VITE_API_BASE_URL);
console.log('  - VITE_WS_URL from env:', import.meta.env.VITE_WS_URL);
console.log('  - API_BASE_URL resolved to:', API_BASE_URL);
console.log('  - WS_URL resolved to:', WS_URL);
console.log('  - API_URL resolved to:', API_URL);
