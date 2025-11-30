// Environment configuration with graceful fallback
export const API_URL = import.meta.env.VITE_API_URL || 'https://dlxtrade-ws-1.onrender.com/api';

// Log warning if using fallback (for debugging)
if (!import.meta.env.VITE_API_URL) {
  console.warn('[ENV] VITE_API_URL not set, using fallback:', API_URL);
}
