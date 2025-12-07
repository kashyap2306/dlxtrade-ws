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

// Admin API
export const adminApi = {
  listKeys: () => api.get('/api/admin/keys'),
  getKey: (id: string) => api.get(`/api/admin/keys/${id}`),
  createKey: (data: any) => api.post('/api/admin/keys', data),
  updateKey: (id: string, data: any) => api.put(`/api/admin/keys/${id}`, data),
  deleteKey: (id: string) => api.delete(`/api/admin/keys/${id}`),
  toggleTestnet: () => api.post('/api/admin/toggle-testnet'),
  // New admin endpoints
  getUsers: () => api.get('/api/admin/users'),
  getUser: (uid: string) => api.get(`/api/admin/user/${uid}`),
  getUserLogs: (uid: string, limit?: number) => api.get(`/api/admin/user/${uid}/logs`, { params: { limit } }),
  getUserHFTLogs: (uid: string, limit?: number) => api.get(`/api/admin/user/${uid}/hft/logs`, { params: { limit } }),
  stopEngine: (uid: string) => api.post(`/api/admin/user/${uid}/stop-engine`),
  stopHFT: (uid: string) => api.post(`/api/admin/user/${uid}/stop-hft`),
  resetRisk: (uid: string) => api.post(`/api/admin/user/${uid}/reset-risk`),
  reloadKeys: (uid: string) => api.post(`/api/admin/user/${uid}/reload-keys`),
  unlockAgent: (uid: string, agentName: string) => api.post(`/api/admin/user/${uid}/unlock-agent`, { agentName }),
  lockAgent: (uid: string, agentName: string) => api.post(`/api/admin/user/${uid}/lock-agent`, { agentName }),
  giveFullAccess: (uid: string) => api.post(`/api/admin/user/${uid}/give-full-access`),
  getGlobalStats: () => api.get('/api/admin/global-stats'),
  reloadAllEngines: () => api.post('/api/admin/reload-all-engines'),
  getAgentStats: () => api.get('/api/admin/agents/stats'),
  getAgentUsers: (agentName: string) => api.get(`/api/admin/agents/${encodeURIComponent(agentName)}/users`),
  updateAgent: (agentId: string, data: any) => api.put(`/api/admin/agents/${agentId}`, data),
  createAgent: (data: any) => api.post('/api/admin/agents', data),
  deleteAgent: (agentId: string) => api.delete(`/api/admin/agents/${agentId}`),
  toggleAgent: (agentId: string) => api.post(`/api/admin/agents/${agentId}/toggle`),
  getUnlockRequests: () => api.get('/api/admin/unlock-requests'),
  approveUnlockRequest: (requestId: string) => api.post(`/api/admin/unlock-requests/${requestId}/approve`),
  denyUnlockRequest: (requestId: string, reason?: string) => api.post(`/api/admin/unlock-requests/${requestId}/deny`, { reason }),
  updateUserAgentSettings: (uid: string, agentName: string, settings: any) => api.put(`/api/admin/user/${uid}/agent/${encodeURIComponent(agentName)}/settings`, settings),
  getGlobalSettings: () => api.get('/api/admin/global-settings'),
  updateGlobalSettings: (settings: any) => api.post('/api/admin/global-settings', settings),
  getMarketData: () => timeoutApi.get('/api/market/top-coins', 8000),
  deleteUser: (uid: string) => api.delete(`/api/admin/users/${uid}`),
  // Agent purchases
  getPurchases: (params?: { status?: string; limit?: number }) => api.get('/api/admin/agents/purchases', { params }),
  approvePurchase: (purchaseId: string) => api.post(`/api/admin/agents/purchases/${purchaseId}/approve`),

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
  rejectPurchase: (purchaseId: string, reason?: string) => api.post(`/api/admin/agents/purchases/${purchaseId}/reject`, { reason }),
  // Broadcast Popup
  broadcastPopup: (data: any) => api.post('/api/admin/popup-broadcast', data),
  // Admin promotion
  promote: (email: string) => api.post('/api/admin/promote', { email }, {
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

// Engine API
export const engineApi = {
  getStatus: () => api.get('/api/engine/status'),
  update: (payload: any) => api.post('/api/engine/update', payload),
  toggle: (payload: any) => api.post('/api/engine/toggle', payload),
  // Legacy endpoints for backward compatibility
  start: (config: any) => api.post('/api/engine/start', config),
  stop: () => api.post('/api/engine/stop'),
  updateConfig: (config: any) => api.put('/api/engine/config', config),
  pauseRisk: () => api.post('/api/engine/risk/pause'),
  resumeRisk: () => api.post('/api/engine/risk/resume'),
  updateRiskLimits: (limits: any) => api.put('/api/engine/risk/limits', limits),
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

// Execution API
export const executionApi = {
  getLogs: (params?: any) => api.get('/api/execution/logs', { params }),
  close: (data: { symbol: string; orderId?: string }) => api.post('/api/execution/close', data),
  execute: (data: { symbol: string; signal: 'BUY' | 'SELL'; entry: number; size: number; sl?: number; tp?: number }) =>
    api.post('/api/execution/execute', data),
};

// Provider Config API
export const providerApi = {
  list: (type?: string) => api.get(type ? `/api/provider/list?type=${type}` : '/api/provider/list'),
  update: (data: any) => api.post('/api/provider/update', data),
  test: (data: any) => api.post('/api/provider/test', data),
};

// Legacy integrations API (keeping for backward compatibility)
export const integrationsApi = {
  load: () => api.get('/api/integrations'),
  update: (data: { apiName: string; enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string; passphrase?: string }) =>
    api.post('/api/settings/provider/save', {
      providerName: PROVIDER_ID_TO_NAME[data.apiName] || data.apiName,
      type: data.apiType || 'marketData',
      enabled: data.enabled,
      apiKey: data.apiKey
    }),
  checkKey: (apiName: string) => api.get(`/api/integrations/check/${apiName}`),
  testProvider: (apiName: string, data: { apiKey?: string }) =>
    api.post('/api/settings/provider/test', {
      providerName: PROVIDER_ID_TO_NAME[apiName] || apiName,
      type: 'marketData', // Default, will be determined by backend
      apiKey: data.apiKey
    }),
};

// HFT Engine API
export const hftApi = {
  getStatus: () => api.get('/api/hft/status'),
  start: () => api.post('/api/hft/start'),
  stop: () => api.post('/api/hft/stop'),
  getLogs: (params?: any) => api.get('/api/hft/logs', { params }),
  loadSettings: () => api.get('/api/hft/settings/load'),
  updateSettings: (settings: any) => api.post('/api/hft/settings/update', settings),
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

// UI Preferences API
export const uiPreferencesApi = {
  get: () => api.get('/api/ui-preferences'),
  update: (preferences: any) => api.post('/api/ui-preferences/update', preferences),
};

// Global Stats API
export const globalStatsApi = {
  get: () => api.get('/api/global-stats').catch(() => ({ data: {} })),
};

// Engine Status API
export const engineStatusApi = {
  get: (params?: { uid?: string }) => api.get('/api/engine-status/status', { params }).catch(() => ({ data: {} })),
};

// HFT Logs API
export const hftLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/api/hft-logs/logs', { params }),
};

// Auto Trade API
export const autoTradeApi = {
  getStatus: () => api.get('/api/trading/autotrade/status'),
  getConfig: () => api.get('/api/auto-trade/config'),
  updateConfig: (config: any) => api.post('/api/auto-trade/config', config),
  toggle: (enabled: boolean) => api.post('/api/trading/autotrade/toggle', { enabled }),
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
  getProposals: () => api.get('/api/auto-trade/proposals'),
  getLogs: (limit?: number) => api.get('/api/auto-trade/logs', { params: { limit } }),
};

// Market API
export const marketApi = {
  getSymbols: () => api.get('/api/market/symbols'),
};

// Chatbot API
export const chatbotApi = {
  sendMessage: (data: { message: string }) => api.post('/api/chatbot', data),
};

// Wallet - removed, endpoints don't exist
// export const walletApi = {
//   getBalances: () => api.get('/wallet/balances'),
// };

// Exchange API
export const exchangeApi = {
  connect: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/api/exchange/connect', config),
  disconnect: (exchange: string) =>
    api.post('/api/exchange/disconnect', { exchange }),
  status: (exchange?: string) =>
    api.get('/api/exchange/status', { params: exchange ? { exchange } : {} }),
  // Legacy endpoints for backward compatibility
  saveConfig: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post(`/api/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`, config),
  getConfig: () =>
    api.get(`/api/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`),
  removeConfig: () =>
    api.post(`/api/users/${localStorage.getItem('firebaseUser') ? JSON.parse(localStorage.getItem('firebaseUser')!).uid : ''}/exchange-config`, {
      exchange: 'binance',
      apiKey: '',
      secret: '',
      testnet: true
    }),
  testConnection: (config: { exchange?: string; apiKey?: string; secret?: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/api/exchange/test', config),
  loadConnected: () =>
    api.get('/api/exchange/connected'),
};

// Alias for backward compatibility - export exchangeService as well
export const exchangeService = exchangeApi;

