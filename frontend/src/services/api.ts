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
  getUsers: () => api.get('/admin/users'),
  getUser: (uid: string) => api.get(`/admin/user/${uid}`),
  stopEngine: (uid: string) => api.post(`/admin/user/${uid}/stop-engine`),
  stopHFT: (uid: string) => api.post(`/admin/user/${uid}/stop-hft`),
  unlockAgent: (uid: string, agentName: string) => api.post(`/admin/user/${uid}/unlock-agent`, { agentName }),
  lockAgent: (uid: string, agentName: string) => api.post(`/admin/user/${uid}/lock-agent`, { agentName }),
  giveFullAccess: (uid: string) => api.post(`/admin/user/${uid}/give-full-access`),
  getUnlockRequests: () => api.get('/admin/unlock-requests'),
  approveUnlockRequest: (requestId: string) => api.post(`/admin/unlock-requests/${requestId}/approve`),
  denyUnlockRequest: (requestId: string, reason?: string) => api.post(`/admin/unlock-requests/${requestId}/deny`, { reason }),
  deleteUser: (uid: string) => api.delete(`/admin/users/${uid}`),
};


// Orders - routes include /api prefix from baseURL
export const ordersApi = {
  listOrders: (params?: any) => api.get('/orders', { params }),
  getOrder: (id: string) => api.get(`/orders/${id}`),
  placeOrder: (data: any) => api.post('/orders', data),
  cancelOrder: (id: string) => api.delete(`/orders/${id}`),
  listFills: (params?: any) => api.get('/fills', { params }),
};

// Engine API
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

// Metrics - routes include /api prefix from baseURL
export const metricsApi = {
  health: () => api.get('/health'),
  metrics: () => api.get('/metrics'),
};

// Research - routes include /api prefix from baseURL
export const researchApi = {
  run: (data?: { uid?: string; symbol?: string; symbols?: string[]; mode?: 'manual' | 'global'; type?: string; source?: string; timeframe?: string[] }) =>
    api.post('/research/run', data), // Now internally calls FREE MODE
  getLogs: (params?: any) => api.get('/research/logs', { params }),

  // Deep Research endpoints
  deepResearch: {
    getTop10: () => api.get('/research/deep-research/top10'),
    // CRITICAL: Increased timeout to 20s for cache-only endpoint (backend target < 300ms, but safety margin for network)
    getTop50: () => api.get('/research/deep-research/top50', { timeout: 20000 }),
    getCoin: (symbol: string) => api.get(`/research/deep-research/coin/${symbol}`),
    getHistory: (limit?: number) => api.get('/research/history', { params: { limit } }),
  },
};

// Settings - routes include /api prefix from baseURL
export const settingsApi = {
  load: () => cachedApi.get('/settings/load'),
  save: async (settings: any) => {
    const response = await api.post('/settings/save', settings);
    // Invalidate settings cache after update
    invalidateCache('/settings/load');
    return response;
  },

  // Trading Settings (General Trading Config)
  general: {
    load: () => api.get('/settings/general'),
    save: (settings: any) => api.post('/settings/general', settings),
  },

  // Trading Settings
  trading: {
    load: () => api.get('/trading/settings'),
    update: (settings: any) => api.post('/trading/settings', settings),
    autotrade: {
      // CRITICAL: Use longer timeout for status endpoint - it does heavy work (resolveExchangeConnector)
      // Default 10s timeout causes frequent failures; 30s gives backend enough time
      status: () => api.get('/auto-trade/status', { timeout: 30000 }),
    },
  },

  // Background Research Settings
  backgroundResearch: {
    getSettings: () => api.get('/background-research/settings/get'),
    saveSettings: (data: {
      backgroundResearchEnabled: boolean;
      telegramBotToken?: string;
      telegramChatId?: string;
      researchFrequencyMinutes: number;
      accuracyTrigger: number;
    }) =>api.post('/background-research/settings/save', data),
    test: (data: { botToken: string; chatId: string }) => api.post('/background-research/settings/test', data),
    getDiagnostic: () => api.get('/background-research/diagnostic'),
    start: () => api.post('/background-research/start'),
  },

  // Provider Settings
  providers: {
    load: () => api.get('/settings/providers'),
    save: (uid: string, data: {
      providerId: string;
      providerType: 'marketData' | 'news' | 'metadata';
      isPrimary: boolean;
      enabled: boolean;
      apiKey?: string;
    }) => {
      const maskedApiKeyLength = data.apiKey ? data.apiKey.length : 0;
      console.log('Saving provider:', data.providerId, data.providerType, 'maskedApiKeyLength:', maskedApiKeyLength);
      if (data.providerId === 'newsdata') {
        console.log('Saving NewsData payload:', data);
      }
      return api.post('/settings/providers/save', data);
    },
    changeKey: (data: {
      providerId: string;
      providerType: 'marketData' | 'news' | 'metadata';
      isPrimary: boolean;
      newApiKey: string;
    }) => api.post('/settings/providers/change', data),
    test: (data: {
      providerName: string;
      type: string;
      apiKey?: string;
    }) => api.post('/settings/providers/test', data),
  },

  // Notification Settings
  notifications: {
    load: () => api.get('/settings/notifications'),
    update: (settings: any) => api.post('/settings/notifications', settings),
    checkPrereq: () => api.get('/settings/notifications/prereq'),
  },

  // New settings endpoints
  saveTradingConfig: (uid: string, config: any) => api.post(`/users/${uid}/trading-config`, config),
  loadTradingConfig: (uid: string) => api.get(`/users/${uid}/trading-config`),
  saveProviderConfig: async (uid: string, providerBody: any) => {
    const fullUrl = `/users/${uid}/provider-config`;
    console.log("[FETCH-PROVIDER-CONFIG]", uid, fullUrl);
    const response = await api.post(fullUrl, providerBody);
    return {
      success: response.data.success,
      providerConfig: response.data.providerConfig
    };
  },
  loadProviderConfig: async (uid: string) => {
    const fullUrl = `/users/${uid}/provider-config`;
    console.log("[FETCH-PROVIDER-CONFIG]", uid, fullUrl);
    const response = await api.get(fullUrl);
    const raw = response?.data;
    const cfg = raw?.providerConfig ?? raw?.config ?? raw ?? {};
    const flat = cfg?.providerConfig ?? cfg ?? {};

    // Normalize backend lowercase keys to frontend camelCase keys
    const normalized = {
      marketData: flat?.marketdata || flat?.marketData || {},
      news: flat?.news || {},
      metadata: flat?.metadata || {}
    };

    console.log("[FETCH-PROVIDER-CONFIG] Normalized response keys:", {
      receivedKeys: Object.keys(flat || {}),
      normalizedKeys: Object.keys(normalized),
      marketDataKeys: Object.keys(normalized.marketData),
      newsKeys: Object.keys(normalized.news),
      metadataKeys: Object.keys(normalized.metadata)
    });

    return normalized;
  },
  loadExchangeConfig: (uid: string) => cachedApi.get(`/users/${uid}/exchangeConfig/current`, { timeout: 25000 }),
};

// Execution API
export const executionApi = {
  getLogs: (params?: any) => api.get('/execution/logs', { params }),
  close: (data: { symbol: string; orderId?: string }) => api.post('/execution/close', data),
  execute: (data: { symbol: string; signal: 'BUY' | 'SELL'; entry: number; size: number; sl?: number; tp?: number }) =>
    api.post('/execution/execute', data),
};

// Provider Config API
export const providerApi = {
  list: (type?: string) => api.get(type ? `/provider/list?type=${type}` : '/provider/list'),
  update: (data: any) => api.post('/provider/update', data),
  test: (data: any) => api.post('/provider/test', data),
};

// Removed: integrationsApi (invalid endpoint)
// Use settingsApi.providers instead

// HFT Engine API
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
  logoutAllSessions: (uid: string) => api.post(`/users/${uid}/logout-all`),
  requestAccountDeletion: (uid: string) => api.post(`/users/${uid}/request-delete`),
  create: (data: any) => api.post('/users/create', data),
  update: (data: any) => api.post('/users/update', data),
  // Profile endpoints
  getProfile: () => api.get('/users/user/profile'),
  updateProfile: (data: any) => api.post('/users/user/profile/update', data),
  // Performance stats
  getPerformanceStats: (uid: string) => api.get(`/users/${uid}/performance-stats`),
  // Active trades
  getActiveTrades: (uid: string) => api.get(`/users/${uid}/active-trades`),
  // Provider config - increased timeout to 20s with retry-once logic
  getProviderConfig: async (uid: string) => {
    let response;
    try {
      // First attempt with 20s timeout
      response = await api.get(`/users/${uid}/provider-config`, { timeout: 20000 });
    } catch (error: any) {
      // Retry once if timeout or network error
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || !error.response) {
        console.warn('[PROVIDER_CONFIG] First attempt failed, retrying once...', error.message);
        try {
          response = await api.get(`/users/${uid}/provider-config`, { timeout: 20000 });
        } catch (retryError: any) {
          console.warn('[PROVIDER_CONFIG] Retry also failed, using empty config', retryError.message);
          // Return empty config instead of throwing - non-blocking
          return { data: { marketData: {}, news: {}, metadata: {} } };
        }
      } else {
        throw error;
      }
    }
    const raw = response?.data;
    const cfg = raw?.providerConfig ?? raw?.config ?? raw ?? {};
    const flat = cfg?.providerConfig ?? cfg ?? {};

    // Normalize backend lowercase keys to frontend camelCase keys
    const normalized = {
      marketData: flat?.marketdata || flat?.marketData || {},
      news: flat?.news || {},
      metadata: flat?.metadata || {}
    };

    console.log("[GET-PROVIDER-CONFIG] Normalized response keys:", {
      receivedKeys: Object.keys(flat || {}),
      normalizedKeys: Object.keys(normalized),
      marketDataKeys: Object.keys(normalized.marketData),
      newsKeys: Object.keys(normalized.news),
      metadataKeys: Object.keys(normalized.metadata)
    });

    return { data: normalized };
  },
  // Exchange config
  getExchangeConfig: (uid: string) => cachedApi.get(`/users/${uid}/exchangeConfig/current`, { timeout: 25000 }),
  // Temp test
  tempTest: () => api.get('/users/temp-test'),
  // Usage stats
  getUsageStats: (uid: string) => api.get(`/users/${uid}/usage-stats`),
  // Removed: get, getSessions (invalid endpoints)
  // Removed: getStats, getExchangeStatus, getUsageStats (endpoints don't exist)
};

// Agents - routes already include /api prefix from baseURL
export const agentsApi = {
  // ===== NEW POSTGRESQL-BASED AGENT APPROVAL SYSTEM =====
  // Agent marketplace
  getAvailableAgents: () => api.get('/agents/available'),
  // requestAgent: (agentId: string) => api.post('/agents/request', { agent_id: agentId }),
  // getMyRequests: () => api.get('/agents/my-requests'),
  // getMyApprovedAgents: () => api.get('/agents/my-approved'),

  // Admin endpoints (DISABLED: Use Firebase/Firestore only for agent approval)
  // getAdminAgentRequests: () => api.get('/admin/agents/requests'),
  // approveAgentRequest: (requestId: number) => api.post('/admin/agents/approve', { request_id: requestId }),
  // rejectAgentRequest: (requestId: number, reason?: string) => api.post('/admin/agents/reject', { request_id: requestId, reason }),
  // assignAgentToUser: (email: string, agentId: string) => api.post('/admin/agents/assign', { email, agent_id: agentId }),
  // revokeAgentAccess: (userId: string, agentId: string) => api.delete('/admin/agents/revoke', { data: { user_id: userId, agent_id: agentId } }),
  // getAgentStats: () => api.get('/admin/agents/stats'),
  // Trading agent endpoints
  createTradingAgentRequest: (data: { userId: string; name: string; tradingPair: 'BTC/USDT' | 'ETH/USDT'; marketType: 'spot' | 'futures' }) =>
    api.post('/agents/trading-agent-request', data),
  getTradingAgentRequests: () => api.get('/agents/admin/trading-agent-requests'),
  approveTradingAgentRequest: (agentId: string) => api.post('/agents/admin/approve-trading-agent', { agentId }),
  rejectTradingAgentRequest: (agentId: string) => api.post('/agents/admin/reject-trading-agent', { agentId }),
  getTradingAgentControl: (agentId: string) => api.get(`/agents/${agentId}/control`),
  updateTradingAgentSettings: (agentId: string, settings: any) => api.put(`/agents/${agentId}/settings`, settings),
  startTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/start`),
  stopTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/stop`),
  pauseTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/pause`),
  resumeTradingAgent: (agentId: string) => api.post(`/agents/${agentId}/resume`),
  getTradingAgentTrades: (agentId: string, limit?: number) => api.get(`/agents/${agentId}/trades`, { params: { limit } }),
  getTradingAgentPerformance: (agentId: string) => api.get(`/agents/${agentId}/performance`),
  getTradingAgentDiagnostics: (agentId: string, limit?: number) => api.get(`/agents/trading-agent/diagnostics`, { params: { limit, agentId } }),
  // Individual agent endpoints
  getAgentDashboard: (agentId: string) => api.get(`/agent/${agentId}/dashboard`),
  getAgentSettings: (agentId: string) => api.get(`/agent/${agentId}/settings`),
  updateAgentSettings: (agentId: string, settings: any) => api.put(`/agent/${agentId}/settings`, settings),
  startAgent: (agentId: string) => api.post(`/agent/${agentId}/start`),
  stopAgent: (agentId: string) => api.post(`/agent/${agentId}/stop`),
  // Launchpad Hunter specific endpoints
  getLaunchpadDashboard: () => api.get('/agent/launchpad-hunter/dashboard'),
  getLaunchpadAlerts: (limit?: number) => api.get('/agent/launchpad-hunter/alerts', { params: { limit } }),
  updateLaunchpadSettings: (settings: any) => api.put('/agent/launchpad-hunter/settings', settings),
  // Crowd Consensus Copy Trade endpoints
  getCrowdConsensusDashboard: () => api.get('/agent/crowd-consensus/dashboard'),
  getCrowdConsensusSignals: (limit?: number) => api.get('/agent/crowd-consensus/signals', { params: { limit } }),
  getCrowdConsensusTrades: (limit?: number) => api.get('/agent/crowd-consensus/trades', { params: { limit } }),
  getCrowdConsensusSettings: () => api.get('/agent/crowd-consensus/settings'),
  updateCrowdConsensusSettings: (settings: any) => api.put('/agent/crowd-consensus/settings', settings),
  getCrowdConsensusStatus: () => api.get('/agent/crowd-consensus/status'),
  startCrowdConsensusAutoTrade: () => api.post('/agent/crowd-consensus/start'),
  stopCrowdConsensusAutoTrade: () => api.post('/agent/crowd-consensus/stop'),
  getCrowdConsensusSkippedTrades: (limit?: number) => api.get('/agent/crowd-consensus/skipped-trades', { params: { limit } }),
  getCrowdConsensusExchangeStatus: () => api.get('/agent/crowd-consensus/exchange-status'),
};

// Activity Logs - routes include /api prefix from baseURL
export const activityLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/activity-logs', { params }),
};

// Trades - routes include /api prefix from baseURL
export const tradesApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/trades', { params }),
  add: (data: any) => api.post('/trades/add', data),
};

// Notifications - routes include /api prefix from baseURL
export const notificationsApi = {
  get: (params?: { limit?: number }) => cachedApi.get('/notifications', { params }),
  markRead: (notificationId: string) => api.post('/notifications/mark-read', { notificationId }),
  push: (data: { uid: string; type: 'success' | 'error' | 'info' | 'warning'; title: string; message: string; timestamp?: number }) =>
    api.post('/notifications/push', data),
};

// Broadcast Popup API
export const broadcastPopupApi = {
  getCurrent: () => api.get('/broadcast-popup/current'),
  markAsSeen: (popupId: string) => api.post('/broadcast-popup/mark-seen', { popupId }),
  getSeenPopups: () => api.get('/broadcast-popup/seen'),
};
// System Logs - routes include /api prefix from baseURL
export const systemLogsApi = {
  get: (params?: { limit?: number }) => api.get('/logs', { params }),
};

// UI Preferences API
export const uiPreferencesApi = {
  get: () => api.get('/ui-preferences'),
  update: (preferences: any) => api.post('/ui-preferences/update', preferences),
};

// Global Stats API
export const globalStatsApi = {
  get: () => api.get('/global-stats').catch(() => ({ data: {} })),
};

// Engine Status API
export const engineStatusApi = {
  get: (params?: { uid?: string }) => api.get('/engine-status/status', { params }).catch(() => ({ data: {} })),
};

// HFT Logs API
export const hftLogsApi = {
  get: (params?: { uid?: string; limit?: number }) => api.get('/hft-logs/logs', { params }),
};

// Auto Trade API
export const autoTradeApi = {
  // CRITICAL: Use longer timeout for status endpoint - it does heavy work (resolveExchangeConnector)
  getStatus: () => api.get('/auto-trade/status', { timeout: 30000 }),
  getConfig: () => api.get('/auto-trade/config'),
  updateConfig: (config: any) => api.post('/auto-trade/config', config),
  toggle: (enabled: boolean) => api.post('/auto-trade/toggle', { enabled }),
  approveTrade: (requestId: string) => api.post('/auto-trade/approve-trade', { requestId }),
  rejectTrade: (requestId: string) => api.post('/auto-trade/reject-trade', { requestId }),
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
  getPendingTrades: () => api.get('/auto-trade/pending-trades'),
  getDiagnostics: () => api.get('/auto-trade/diagnostics'),
  runDiagnosticCheck: () => api.get('/auto-trade/diagnostic-check'),
};

// Market API
export const marketApi = {
  getSymbols: () => api.get('/market/symbols'),
};


// Wallet - removed, endpoints don't exist
// export const walletApi = {
//   getBalances: () => api.get('/wallet/balances'),
// };

// Exchange API
export const exchangeApi = {
  connect: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/exchange/connect', config),
  disconnect: (exchange: string) =>
    api.post('/exchange/disconnect', { exchange }),
  status: (exchange?: string) =>
    api.get('/exchange/status', { params: exchange ? { exchange } : {} }),
  // Legacy endpoints for backward compatibility
  saveConfig: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/exchange/connect', config),
  testConnection: (config: { exchange?: string; apiKey?: string; secret?: string; passphrase?: string; testnet?: boolean }) =>
    api.post('/exchange/test', config),
  testExchangeConnection: (config: { exchange: string; apiKey: string; secret: string; passphrase?: string }) =>
    api.post('/exchange/test', config, { params: { exchange: config.exchange }, headers: { 'Content-Type': 'application/json' } }),
  loadConnected: () =>
    api.get('/exchange/connected'),
};

// Alias for backward compatibility - export exchangeService as well
export const exchangeService = exchangeApi;

