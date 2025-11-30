// Environment configuration with validation
export const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error('VITE_API_URL environment variable is not set. Please set VITE_API_URL=https://dlxtrade-ws-1.onrender.com/api');
}
