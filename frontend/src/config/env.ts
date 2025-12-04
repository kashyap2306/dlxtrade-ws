// API base URL with fallback for local development
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
export const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000/ws";
