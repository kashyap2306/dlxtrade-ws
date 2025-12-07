// API base URL with proper fallbacks
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";

// Log environment loading for debugging
console.log('[ENV] Loading environment variables:');
console.log('  - VITE_API_URL from env:', import.meta.env.VITE_API_URL);
console.log('  - VITE_WS_URL from env:', import.meta.env.VITE_WS_URL);
console.log('  - API_URL resolved to:', API_URL);
console.log('  - WS_URL resolved to:', WS_URL);
