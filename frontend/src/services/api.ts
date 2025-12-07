import api, { cachedApi, timeoutApi, invalidateCache } from '@/config/axios';

// Mapping from provider ID to display name for backend API calls
const PROVIDER_ID_TO_NAME: Record<string, string> = {
  // Market Data Providers
  'coingecko': 'CoinGecko',
  'bravenewcoin': 'BraveNewCoin',
  'coinapi': 'CoinAPI',
  'coincheckup': 'CoinCheckup',
  'coinlore': 'CoinLore',
  'coinmarketcap': 'CoinMarketCap',
  'coinpaprika': 'CoinPaprika',
  'coinstats': 'CoinStats',
  'kaiko': 'Kaiko',
  'livecoinwatch': 'LiveCoinWatch',
  'messari': 'Messari',
  // News Providers
  'newsdataio': 'NewsData.io',
  'bingnews': 'BingNews',
  'contextualweb': 'ContextualWeb',
  'cryptopanic': 'CryptoPanic',
  'gnews': 'GNews',
  'mediastack': 'MediaStack',
  'newscatcher': 'NewsCatcher',
  'reddit': 'Reddit',
  'webzio': 'Webz.io',
  'yahoonews': 'YahooNews',
  'cointelegraph': 'Cointelegraph RSS',
  'altcoinbuzz': 'AltcoinBuzz RSS',
  'marketaux': 'Marketaux',
  'coinstatsnews': 'CoinStatsNews',
  'cryptocomparenews': 'CryptoCompare News',
  // Metadata Providers
  'cryptocompare': 'CryptoCompare',
  'coincap': 'CoinCap',
  'coinranking': 'CoinRanking',
  'nomics': 'Nomics'
};

export default api;

// Auth - Firebase handles authentication, no backend endpoints needed
export const authApi = {
  // Firebase handles login/signup on frontend
  // Token refresh is handled automatically by Firebase SDK
  afterSignIn: (idToken: string) => api.post('/auth/afterSignIn', { idToken }),
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
  giveFullAccess: (uid: string) => api.post(`/admin/user/${uid}/give-full-access`),
  getGlobalStats: () => api.get('/admin/global-stats'),
  reloadAllEngines: () => api.post('/admin/reload-all-engines'),
  getAgentStats: () => api.get('/admin/agents/stats'),
  getAgentUsers: (agentName: string) => api.get(`/admin/agents/${encodeURIComponent(agentName)}/users`),
  updateAgent: (agentId: string, data: any) => api.put(`/admin/agents/${agentId}`, data),
  createAgent: (data: any) => api.post('/admin/agents', data),
  deleteAgent: (agentId: string) => api.delete(`/admin/agents/${agentId}`),
  toggleAgent: (agentId: string) => api.post(`/admin/agents/${agentId}/toggle`),
  getUnlockRequests: () => api.get('/admin/unlock-requests'),
  approveUnlockRequest: (requestId: string) => api.post(`/admin/unlock-requests/${requestId}/approve`),
  denyUnlockRequest: (requestId: string, reason?: string) => api.post(`/admin/unlock-requests/${requestId}/deny`, { reason }),
  updateUserAgentSettings: (uid: string, agentName: string, settings: any) => api.put(`/admin/user/${uid}/agent/${encodeURIComponent(agentName)}/settings`, settings),
  getGlobalSettings: () => api.get('/admin/global-settings'),
  updateGlobalSettings: (settings: any) => api.post('/admin/global-settings', settings),
  getMarketData: () => timeoutApi.get('/api/market/top-coins', 8000),
  deleteUser: (uid: string) => api.delete(`/admin/users/${uid}`),
  // Agent purchases
  getPurchases: (params?: { status?: string; limit?: number }) => api.get('/admin/agents/purchases', { params }),
  approvePurchase: (purchaseId: string) => api.post(`/admin/agents/purchases/${purchaseId}/approve`),

  // Background Research
  backgroundResearch: {
    getSettings: () => api.get('/api/research/background-research/settings'),
    saveSettings: (data: {
      backgroundResearchEnabled: boolean;
      telegramBotToken?: string;
      telegramChatId?: string;
      researchFrequencyMinutes: number;
      accuracyTrigger: number;
    }) => api.post('/api/research/background-research/settings', data),
    test: (data: { botToken: string; chatId: string }) => api.post('/api/research/background-research/settings/test', data),
  },

  // Telegram
  telegram: {
    test: (data: { botToken: string; chatId: string }) => api.post('/api/telegram/test', data),
  },
  rejectPurchase: (purchaseId: string, reason?: string) => api.post(`/admin/agents/purchases/${purchaseId}/reject`, { reason }),
  // Broadcast Popup
  broadcastPopup: (data: any) => api.post('/admin/popup-broadcast', data),
  // Admin promotion
  promote: (email: string) => api.post('/admin/promote', { email }, {
    headers: {
      'x-admin-setup': 'SUPER-SECRET-998877'
    }
  }),
};

// Orders - routes already include /api prefix from baseURL
export const ordersApi = {
  listOrders: (params?: any) => api.get('/api/orders', { params }),
  getOrder: (id: string) => api.get(`/api/orders/${id}`),
  placeOrder: (data: any) => api.post('/api/orders', data),
  cancelOrder: (id: string) => api.delete(`/api/orders/${id}`),
  listFills: (params?: any) => api.get('/api/fills', { params }),
};

// Engine - routes already include /api prefix from baseURL
export const engineApi = {
  getStatus: () => api.get('/engine/status'),
  update: (payload: any) => api.post('/engine/update', payload),
  toggle: (payload: any) => api.post('/engine/toggle', payload),
  // Legacy endpoints for backward compatibility
  start: (config: any) => api.post('/engine/start', config),
  stop: () => api.post('/engine/stop'),
  updateConfig: (config: any) => api.put('/engine/config', config),
  pauseRisk: () => api.post('/engine/risk/pause'),
  resumeRisk: () => api.post('/engine/risk/resume'),
  updateRiskLimits: (limits: any) => api.put('/engine/risk/limits', limits),
};

// Metrics - routes already include /api prefix from baseURL
export const metricsApi = {
  health: () => api.get('/api/health'),
  metrics: () => api.get('/api/metrics'),
};

// Research - routes already include /api prefix from baseURL
export const researchApi = {
  run: (data?: { uid?: string; symbol?: string; symbols?: string[] }) =>
    api.post('/api/research/run', data), // Now internally calls FREE MODE
  getLogs: (params?: any) => api.get('/api/research/logs', { params }),

  // Deep Research endpoints
  deepResearch: {
    getTop10: () => api.get('/api/research/deep-research/top10'),
    getCoin: (symbol: string) => api.get(`/api/research/deep-research/coin/${symbol}`),
  },
};

// Settings - routes already include /api prefix from baseURL
export const settingsApi = {
  load: () => cachedApi.get('/api/settings/load'),
  save: async (settings: any) => {
    const response = await api.post('/api/settings/save', settings);
    // Invalidate settings cache after update
    invalidateCache('/api/settings/load');
    return response;
  },

  // Trading Settings (General Trading Config)
  general: {
    load: () => api.get('/api/settings/general'),
    save: (settings: any) => api.post('/api/settings/general', settings),
  },

  // Trading Settings
  trading: {
    load: () => api.get('/api/settings/trading/settings'),
    update: (settings: any) => api.post('/api/settings/trading/settings', settings),
    autotrade: {
      status: () => api.get('/api/auto-trade/status'),
    },
  },

  // Background Research Settings
  backgroundResearch: {
    getSettings: () => api.get('/api/background-research/settings'),
    saveSettings: (data: {
      backgroundResearchEnabled: boolean;
      telegramBotToken?: string;
      telegramChatId?: string;
      researchFrequencyMinutes: number;
      accuracyTrigger: number;
    }) => api.post('/api/background-research/settings', data),
    test: (data: { botToken: string; chatId: string }) => api.post('/api/background-research/settings/test', data),
  },

  // Provider Settings
  providers: {
    load: () => api.get('/api/settings/providers'),
    save: (data: {
      providerId: string;
      providerType: 'marketData' | 'news' | 'metadata';
      isPrimary: boolean;
      enabled: boolean;
      apiKey?: string;
    }) => api.post('/api/settings/providers/save', data),
    changeKey: (data: {
      providerId: string;
      providerType: 'marketData' | 'news' | 'metadata';
      isPrimary: boolean;
      newApiKey: string;
    }) => api.post('/api/settings/providers/change', data),
    test: (data: {
      providerName: string;
      type: 'marketData' | 'news' | 'metadata';
      apiKey?: string;
    }) => api.post('/api/settings/providers/test', data),
  },

  // Notification Settings
  notifications: {
    load: () => api.get('/api/settings/notifications'),
    update: (settings: any) => api.post('/api/settings/notifications', settings),
    checkPrereq: () => api.get('/api/settings/notifications/prereq'),
  },
};

// Execution - routes already include /api prefix from baseURL
export const executionApi = {
  getLogs: (params?: any) => api.get('/execution/logs', { params }),
  close: (data: { symbol: string; orderId?: string }) => api.post('/execution/close', data),
  execute: (data: { symbol: string; signal: 'BUY' | 'SELL'; entry: number; size: number; sl?: number; tp?: number }) =>
    api.post('/execution/execute', data),
};

// Provider Config - routes already include /api prefix from baseURL
export const providerApi = {
  list: (type?: string) => api.get(type ? `/provider/list?type=${type}` : '/provider/list'),
  update: (data: any) => api.post('/provider/update', data),
  test: (data: any) => api.post('/provider/test', data),
};

// Legacy integrations API (keeping for backward compatibility)
export const integrationsApi = {
  load: () => api.get('/integrations'),
  update: (data: { apiName: string; enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string; passphrase?: string }) =>
    api.post('/settings/provider/save', {
      providerName: PROVIDER_ID_TO_NAME[data.apiName] || data.apiName,
      type: data.apiType || 'marketData',
      enabled: data.enabled,
      apiKey: data.apiKey
    }),
  checkKey: (apiName: string) => api.get(`/integrations/check/${apiName}`),
  testProvider: (apiName: string, data: { apiKey?: string }) =>
    api.post('/settings/provider/test', {
      providerName: PROVIDER_ID_TO_NAME[apiName] || apiName,
      type: 'marketData', // Default, will be determined by backend
      apiKey: data.apiKey
    }),
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
  getAll: () => api.get('/api/users'),
  get: (uid: string) => api.get(`/api/users/${uid}/details`),
  getSessions: (uid: string) => api.get(`/api/users/${uid}/sessions`),
  logoutAllSessions: (uid: string) => api.post(`/api/users/${uid}/logout-all`),
  requestAccountDeletion: (uid: string) => api.post(`/api/users/${uid}/request-delete`),
  create: (data: any) => api.post('/api/users/create', data),
  update: (data: any) => api.post('/api/users/update', data),
  // Profile endpoints
  getProfile: () => api.get('/api/user/profile'),
  updateProfile: (data: any) => api.post('/api/user/profile/update', data),
  // Removed: getStats, getExchangeStatus, getUsageStats (endpoints don't exist)
};

// Agents - routes already include /api prefix from baseURL
export const agentsApi = {
  getAll: () => cachedApi.get('/api/agents'),
  get: (id: string) => api.get(`/api/agents/${id}`),
  unlock: (agentName: string) => api.post('/api/agents/unlock', { agentName }),
  getUnlocked: () => cachedApi.get('/api/agents/unlocked'),
  submitUnlockRequest: (data: { agentId: string; agentName: string; fullName: string; phoneNumber: string; email: string }) =>
    api.post('/api/agents/submit-unlock-request', data),
  updateAgentSettings: (agentId: string, settings: any) => api.put(`/api/agents/${agentId}/settings`, settings),
};

// Activity Logs - routes already include /api prefix from baseURL
export const activityLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/api/activity-logs', { params }),
};

// Trades - routes already include /api prefix from baseURL
export const tradesApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/api/trades', { params }),
  add: (data: any) => api.post('/api/trades/add', data),
};

// Notifications - routes already include /api prefix from baseURL
export const notificationsApi = {
  get: (params?: { limit?: number }) => cachedApi.get('/api/notifications', { params }),
  markRead: (notificationId: string) => api.post('/api/notifications/mark-read', { notificationId }),
  push: (data: { uid: string; type: 'success' | 'error' | 'info' | 'warning'; title: string; message: string; timestamp?: number }) =>
    api.post('/api/notifications/push', data),
};

// System Logs - routes already include /api prefix from baseURL
export const systemLogsApi = {
  get: (params?: { limit?: number }) => api.get('/api/logs', { params }),
};

// UI Preferences - routes already include /api prefix from baseURL
export const uiPreferencesApi = {
  get: () => api.get('/ui-preferences'),
  update: (preferences: any) => api.post('/ui-preferences/update', preferences),
};

// Global Stats - routes already include /api prefix from baseURL
export const globalStatsApi = {
  get: () => api.get('/global-stats').catch(() => ({ data: {} })),
};

// Engine Status - routes already include /api prefix from baseURL
export const engineStatusApi = {
  get: (params?: { uid?: string }) => api.get('/engine-status/status', { params }).catch(() => ({ data: {} })),
};

// HFT Logs - routes already include /api prefix from baseURL
export const hftLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/hft-logs/logs', { params }),
};

// Auto Trade - routes already include /api prefix from baseURL
export const autoTradeApi = {
  getStatus: () => api.get('/trading/autotrade/status'),
  getConfig: () => api.get('/auto-trade/config'),
  updateConfig: (config: any) => api.post('/auto-trade/config', config),
  toggle: (enabled: boolean) => api.post('/trading/autotrade/toggle', { enabled }),
  panicStop: (reason?: string) => api.post('/auto-trade/panic-stop', { reason }),
  getActiveTrades: (limit?: number) => api.get('/auto-trade/active-trades', { params: { limit } }),
  closeTrade: (tradeId: string) => api.post('/auto-trade/close-trade', { tradeId }),
  getActivity: (limit?: number) => api.get('/auto-trade/activity', { params: { limit } }),
  forceScan: () => api.post('/auto-trade/force-scan'),
  queue: (signal: any) => api.post('/auto-trade/queue', signal),
  run: () => api.post('/auto-trade/run'),
  execute: (data: { requestId: string; signal: any }) => api.post('/auto-trade/execute', data),
  resetCircuitBreaker: () => api.post('/auto-trade/reset-circuit-breaker'),
  // New auto-trade endpoints
  trigger: (params?: { dryRun?: boolean; symbol?: string }) => api.post('/auto-trade/trigger', {}, { params }),
  getProposals: () => api.get('/auto-trade/proposals'),
  getLogs: (limit?: number) => api.get('/auto-trade/logs', { params: { limit } }),
};

// Market - routes already include /api prefix from baseURL
export const marketApi = {
  getSymbols: () => api.get('/api/market/symbols'),
};

// Chatbot - routes already include /api prefix from baseURL
export const chatbotApi = {
  sendMessage: (data: { message: string }) => api.post('/chatbot', data),
};

// Wallet - removed, endpoints don't exist
// export const walletApi = {
//   getBalances: () => api.get('/wallet/balances'),
// };

// Exchange - routes already include /api prefix from baseURL
export const exchangeApi = {
  connect: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/exchange/connect', config),
  disconnect: (exchange: string) =>
    api.post('/exchange/disconnect', { exchange }),
  status: (exchange?: string) =>
    api.get('/exchange/status', { params: exchange ? { exchange } : {} }),
  // Legacy endpoints for backward compatibility
  saveConfig: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post(`/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`, config),
  getConfig: () =>
    api.get(`/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`),
  removeConfig: () =>
    api.post(`/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`, {
      exchange: 'binance',
      apiKey: '',
      secret: '',
      testnet: true
    }),
  testConnection: (config: { exchange?: string; apiKey?: string; secret?: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/exchange/test', config),
  loadConnected: () =>
    api.get('/exchange/connected'),
};

// Alias for backward compatibility - export exchangeService as well
export const exchangeService = exchangeApi;

