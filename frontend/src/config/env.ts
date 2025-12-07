// API base URL - use VITE_API_BASE as the primary source
export const API_BASE = import.meta.env.VITE_API_BASE || "";
export const API_URL = API_BASE ? `${API_BASE}/api` : import.meta.env.VITE_API_URL || "";
export const WS_URL = import.meta.env.VITE_WS_URL || "";

// Log environment loading for debugging
console.log('[ENV] Loading environment variables:');
console.log('  - VITE_API_BASE from env:', import.meta.env.VITE_API_BASE);
console.log('  - VITE_API_URL from env:', import.meta.env.VITE_API_URL);
console.log('  - VITE_WS_URL from env:', import.meta.env.VITE_WS_URL);
console.log('  - API_BASE resolved to:', API_BASE);
console.log('  - API_URL resolved to:', API_URL);
console.log('  - WS_URL resolved to:', WS_URL);
