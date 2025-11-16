import axios from 'axios';

// API base URL - must include /api prefix since backend routes are prefixed
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add Firebase token to requests
api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Simple global backoff after 429 to prevent hammering the backend
let backoffUntil = 0;

// Handle auth errors and 429 backoff
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 429) {
      const retryAfter = parseInt(error.response.headers?.['retry-after'] || '60', 10);
      backoffUntil = Date.now() + retryAfter * 1000;
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Request interceptor: if backoff active, short-circuit with a controlled error
api.interceptors.request.use(async (config) => {
  if (backoffUntil > Date.now()) {
    const err: any = new Error('Rate limit active, backing off');
    err.response = { status: 429, data: { error: 'Rate limit active' } };
    throw err;
  }
  return config;
});

export default api;

// Auth - Firebase handles authentication, no backend endpoints needed
export const authApi = {
  // Firebase handles login/signup on frontend
  // Token refresh is handled automatically by Firebase SDK
};

// Admin - routes already include /api prefix from baseURL
export const adminApi = {
  listKeys: () => api.get('/admin/keys'),
  getKey: (id: string) => api.get(`/admin/keys/${id}`),
  createKey: (data: any) => api.post('/admin/keys', data),
  updateKey: (id: string, data: any) => api.put(`/admin/keys/${id}`, data),
  deleteKey: (id: string) => api.delete(`/admin/keys/${id}`),
  toggleTestnet: () => api.post('/admin/toggle-testnet'),
  // New admin endpoints
  getUsers: () => api.get('/admin/users'),
  getUser: (uid: string) => api.get(`/admin/user/${uid}`),
  getUserLogs: (uid: string, limit?: number) => api.get(`/admin/user/${uid}/logs`, { params: { limit } }),
  getUserHFTLogs: (uid: string, limit?: number) => api.get(`/admin/user/${uid}/hft/logs`, { params: { limit } }),
  stopEngine: (uid: string) => api.post(`/admin/user/${uid}/stop-engine`),
  stopHFT: (uid: string) => api.post(`/admin/user/${uid}/stop-hft`),
  resetRisk: (uid: string) => api.post(`/admin/user/${uid}/reset-risk`),
  reloadKeys: (uid: string) => api.post(`/admin/user/${uid}/reload-keys`),
  unlockAgent: (uid: string, agentName: string) => api.post(`/admin/user/${uid}/unlock-agent`, { agentName }),
  lockAgent: (uid: string, agentName: string) => api.post(`/admin/user/${uid}/lock-agent`, { agentName }),
  getGlobalStats: () => api.get('/admin/global-stats'),
  reloadAllEngines: () => api.post('/admin/reload-all-engines'),
  getAgentStats: () => api.get('/admin/agents/stats'),
  getAgentUsers: (agentName: string) => api.get(`/admin/agents/${encodeURIComponent(agentName)}/users`),
};

// Orders - routes already include /api prefix from baseURL
export const ordersApi = {
  listOrders: (params?: any) => api.get('/orders', { params }),
  getOrder: (id: string) => api.get(`/orders/${id}`),
  placeOrder: (data: any) => api.post('/orders', data),
  cancelOrder: (id: string) => api.delete(`/orders/${id}`),
  listFills: (params?: any) => api.get('/fills', { params }),
};

// Engine - routes already include /api prefix from baseURL
export const engineApi = {
  getStatus: () => api.get('/engine/status'),
  start: (config: any) => api.post('/engine/start', config),
  stop: () => api.post('/engine/stop'),
  updateConfig: (config: any) => api.put('/engine/config', config),
  pauseRisk: () => api.post('/engine/risk/pause'),
  resumeRisk: () => api.post('/engine/risk/resume'),
  updateRiskLimits: (limits: any) => api.put('/engine/risk/limits', limits),
};

// Metrics - routes already include /api prefix from baseURL
export const metricsApi = {
  health: () => api.get('/health'),
  metrics: () => api.get('/metrics'),
};

// Research - routes already include /api prefix from baseURL
export const researchApi = {
  getLogs: (params?: any) => api.get('/research/logs', { params }),
  runResearch: (symbol: string) => api.post('/research/run', { symbol }),
  deepRun: (data: { symbols?: string[]; topN?: number }) => api.post('/research/deep-run', data),
};

// Settings - routes already include /api prefix from baseURL
export const settingsApi = {
  load: () => api.get('/settings/load'),
  update: (settings: any) => api.post('/settings/update', settings),
};

// Execution - routes already include /api prefix from baseURL
export const executionApi = {
  getLogs: (params?: any) => api.get('/execution/logs', { params }),
  close: (data: { symbol: string; orderId?: string }) => api.post('/execution/close', data),
  execute: (data: { symbol: string; signal: 'BUY' | 'SELL'; entry: number; size: number; sl?: number; tp?: number }) => 
    api.post('/execution/execute', data),
};

// Integrations - routes already include /api prefix from baseURL
export const integrationsApi = {
  load: () => api.get('/integrations/load'),
  update: (data: { apiName: string; enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string }) => 
    api.post('/integrations/update', data),
  connect: (data: { apiName: string; enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string }) => 
    api.post('/integrations/connect', data),
  delete: (apiName: string, apiType?: string) => api.post('/integrations/delete', { apiName, apiType }),
};

// HFT Engine - routes already include /api prefix from baseURL
export const hftApi = {
  getStatus: () => api.get('/hft/status'),
  start: () => api.post('/hft/start'),
  stop: () => api.post('/hft/stop'),
  getLogs: (params?: any) => api.get('/hft/logs', { params }),
  loadSettings: () => api.get('/hft/settings/load'),
  updateSettings: (settings: any) => api.post('/hft/settings/update', settings),
};

// Users - routes already include /api prefix from baseURL
export const usersApi = {
  getAll: () => api.get('/users'),
  get: (uid: string) => api.get(`/users/${uid}`),
  create: (data: any) => api.post('/users/create', data),
  update: (data: any) => api.post('/users/update', data),
};

// Agents - routes already include /api prefix from baseURL
export const agentsApi = {
  getAll: () => api.get('/agents'),
  unlock: (agentName: string) => api.post('/agents/unlock', { agentName }),
  getUnlocks: () => api.get('/agents/unlocks'),
};

// Activity Logs - routes already include /api prefix from baseURL
export const activityLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/activity-logs', { params }),
};

// Trades - routes already include /api prefix from baseURL
export const tradesApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/trades', { params }),
  add: (data: any) => api.post('/trades/add', data),
};

// Notifications - routes already include /api prefix from baseURL
export const notificationsApi = {
  get: (params?: { limit?: number }) => api.get('/notifications', { params }),
  markRead: (notificationId: string) => api.post('/notifications/mark-read', { notificationId }),
};

// System Logs - routes already include /api prefix from baseURL
export const systemLogsApi = {
  get: (params?: { limit?: number }) => api.get('/logs', { params }),
};

// UI Preferences - routes already include /api prefix from baseURL
export const uiPreferencesApi = {
  get: () => api.get('/ui-preferences'),
  update: (preferences: any) => api.post('/ui-preferences/update', preferences),
};

// Global Stats - routes already include /api prefix from baseURL
export const globalStatsApi = {
  get: () => api.get('/global-stats'),
};

// Engine Status - routes already include /api prefix from baseURL
export const engineStatusApi = {
  get: (params?: { uid?: string }) => api.get('/engine-status/status', { params }),
};

// HFT Logs - routes already include /api prefix from baseURL
export const hftLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/hft-logs/logs', { params }),
};

// Auto Trade - routes already include /api prefix from baseURL
export const autoTradeApi = {
  getStatus: () => api.get('/auto-trade/status'),
  toggle: (enabled: boolean) => api.post('/auto-trade/toggle', { enabled }),
};

