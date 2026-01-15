import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { API_URL } from './env';

// KEEP THIS BLOCK: Firebase helpers used by axios interceptor.
// These functions are dynamically relied upon elsewhere; DO NOT remove.
import {
  auth,
  isUsingMockFirebase,
  isFirebaseAvailable,
  isFirebaseReady
} from "../config/firebase";
// END KEEP BLOCK

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    metadata?: {
      startTime: number;
      requestId: string;
    };
    _retry?: boolean;
  }
}

// Use centralized API URL from env.ts
const API_BASE_URL = API_URL;

console.log('[API CONFIG] Environment detection:');
console.log('  - hostname:', typeof window !== 'undefined' ? window.location.hostname : 'SSR');
console.log('  - API_BASE_URL:', API_BASE_URL);

// Axios instance (CORS-safe)
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

console.log('[AXIOS] Axios instance created:');
console.log('  - baseURL:', api.defaults.baseURL);
console.log('  - timeout:', api.defaults.timeout);

// Runtime guard and interceptor setup
// Runtime guard and interceptor setup - Attaching IMMEDIATELY to catch early requests
// We wait for Firebase inside the interceptor, not before attaching it.

console.log("[AXIOS] Setting up interceptors immediately...");

// Log helper
const logRequest = (config: InternalAxiosRequestConfig, context: string) => {
  const method = config.method?.toUpperCase() || 'UNKNOWN';
  const url = config.url || 'UNKNOWN_URL';
  const fullUrl = config.baseURL ? `${config.baseURL}${url}` : url;
  console.log(`[API ${context}] REQUEST:`, {
    method: method,
    url: url,
    fullUrl: fullUrl,
    timeout: config.timeout,
    headers: {
      'Content-Type': config.headers?.['Content-Type'],
      'Authorization': config.headers?.['Authorization'] ? 'Bearer [TOKEN]' : 'None'
    }
  });
};

const logResponse = (response: AxiosResponse, context: string) => {
  const duration = response.config.metadata ? Date.now() - response.config.metadata.startTime : 0;
  const method = response.config.method?.toUpperCase() || 'UNKNOWN';
  const url = response.config.url || 'UNKNOWN_URL';
  const fullUrl = response.config.baseURL ? `${response.config.baseURL}${url}` : url;
  console.log(`[API ${context}] SUCCESS:`, {
    status: response.status,
    statusText: response.statusText,
    method: method,
    url: url,
    fullUrl: fullUrl,
    duration: `${duration}ms`,
    dataSize: JSON.stringify(response.data).length + ' chars'
  });
};

const logError = (error: AxiosError, context: string, extra?: any) => {
  const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
  const url = error.config?.url || 'UNKNOWN_URL';
  const fullUrl = error.config?.baseURL ? `${error.config.baseURL}${url}` : url;
  const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : 0;

  console.error(`[API ${context}] ERROR:`, {
    method: method,
    url: url,
    fullUrl: fullUrl,
    timeout: error.config?.timeout,
    duration: duration ? `${duration}ms` : 'unknown',
    errorCode: error.code,
    errorMessage: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    responseData: error.response?.data,
    ...extra,
  });

  // Additional logging for debugging
  if (error.code === 'ECONNABORTED') {
    console.error('[API TIMEOUT] Request timed out - check if backend is running and accessible');
    console.error('[API TIMEOUT] Full URL attempted:', fullUrl);
  } else if (error.code === 'ENOTFOUND') {
    console.error('[API NETWORK] Host not found - check API_URL configuration');
    console.error('[API NETWORK] Attempted URL:', fullUrl);
  } else if (error.code === 'ECONNREFUSED') {
    console.error('[API NETWORK] Connection refused - backend server not running or unreachable');
    console.error('[API NETWORK] Attempted URL:', fullUrl);
  } else if (error.response?.status === 401) {
    console.error('[API AUTH] ❌ 401 Unauthorized - Access denied. Token may be invalid or expired.');
  } else if (error.response?.status >= 500) {
    console.error('[API SERVER] 5xx Server error - check backend logs');
  } else if (!error.response) {
    console.error('[API NETWORK] No response received - network or CORS issue');
    console.error('[API NETWORK] Check if backend is running and CORS is configured');
  }
};

// Request Interceptor
api.interceptors.request.use(
  async (config) => {
    // Metadata
    config.metadata = {
      startTime: Date.now(),
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    };

    // Wait until Firebase auth state is known (resolved once)
    try {
      if (!isFirebaseReady()) {
        console.warn('[AXIOS] Firebase is not ready');
        // Optionally, throw or handle the not-ready state here
      } else {
        console.log('[AXIOS] ✅ isFirebaseReady true');
      }
    } catch (e) {
      console.warn('[AXIOS] firebaseReady rejection:', e);
    }

    // Try to obtain a fresh token
    try {
      if (typeof getAuthToken === 'function') {
        const token = await getAuthToken(false);

        // REQ: Authorization header attached ONLY after token exists
        // REQ: Block all protected API calls if token is null
        // REQ: Do NOT allow requests with "Bearer undefined"
        if (token && token !== 'undefined') {
          if (!config.headers) config.headers = {} as any;
          (config.headers as any)['Authorization'] = `Bearer ${token}`;
          console.log(`[AXIOS] 🔐 AUTH_HEADER_PRESENT for ${config.url}`);
        } else {
          // BaseURL is API_URL (e.g. http://localhost:4000/api), so most calls are protected even if url doesn't start with "/api".
          // Only allow unauthenticated requests for explicitly public endpoints.
          const url = config.url || '';
          const isPublic =
            url.startsWith('/auth/afterSignIn') ||
            url.startsWith('/health') ||
            url.startsWith('/test');

          if (!isPublic) {
            console.error(`[AXIOS] 🛑 ABORTING protected call (${url}) - No token available`);
            return Promise.reject(new Error('Unauthenticated: No Firebase token available'));
          }
          console.log(`[AXIOS] ℹ️ Public request: ${url}`);
        }
      }
    } catch (err) {
      console.warn('[AXIOS] Error during token attachment:', err);
    }

    logRequest(config, 'REQUEST');
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    logResponse(response, 'SUCCESS');
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig;

    // Handle timeout errors for non-critical APIs - return safe defaults
    if (error.code === 'ECONNABORTED' && config.url) {
      const url = config.url;

      // Check if this is a non-critical API that should return safe defaults on timeout
      if (url.includes('/broadcast-popup/current')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for broadcast-popup/current');
        return {
          data: { active: false },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/agents/unlocked')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for agents/unlocked');
        return {
          data: { unlocked: [] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/notifications') && config.method?.toLowerCase() === 'get') {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for notifications');
        return {
          data: [],
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/users/') && url.includes('/features')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for users/:uid/features');
        return {
          data: { features: {} },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/background-research/settings/get')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for background-research/settings/get');
        return {
          data: { enabled: false },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/agents') && config.method?.toLowerCase() === 'get' && !url.includes('/unlocked')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for agents');
        return {
          data: { agents: [] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/settings/load')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for settings/load');
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      } else if (url.includes('/provider-config')) {
        console.warn('[AXIOS TIMEOUT HANDLED] Returning safe default for provider-config (non-blocking)');
        return {
          data: { providerConfig: { marketData: {}, news: {}, metadata: {} } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      }
    }

    // Handle 401 errors with token refresh retry
    // NOTE: config.url is typically like "/auto-trade/status" because baseURL already contains "/api".
    // So we MUST NOT gate this retry on url.startsWith('/api').
    if (error.response?.status === 401 && !config._retry) {
      console.log('[AXIOS] 401 received — forcing token refresh and retry');
      config._retry = true;

      try {
        const token = await getAuthToken(true); // Force refresh
        if (token && auth?.currentUser) {
          config.headers = {
            ...config.headers,
            Authorization: `Bearer ${token}`,
            uid: auth.currentUser.uid,
          } as any;
          console.log('[AXIOS] Retrying request with refreshed token');
          return api(config);
        }
      } catch (retryError) {
        console.error('[AXIOS] Token refresh failed:', retryError);
      }
    }

    logError(error, 'ERROR');
    return Promise.reject(error);
  }
);

// Import the updated firebase utilities
import { getAuthToken } from './firebase-utils';

// Health Ping Service
class HealthPingService {
  private intervalId: number | null = null;
  private isHealthy = false;

  start() {
    if (this.intervalId) return;

    this.intervalId = window.setInterval(async () => {
      try {
        const healthUrl = `${API_BASE_URL.replace('/api', '')}/health`;
        const res = await axios.get(healthUrl, { timeout: 5000 });
        this.isHealthy = res.data?.status === 'ok';
      } catch {
        this.isHealthy = false;
      }
    }, 60000);
  }

  isServiceHealthy(): boolean {
    return this.isHealthy;
  }
}

export const healthPingService = new HealthPingService();

// Temporarily disabled health polling to reduce noise during debugging
// if (typeof window !== 'undefined') {
//   setTimeout(() => healthPingService.start(), 2000);
// }

// Timeout wrapper for long-running calls
export const timeoutApi = {
  get: async (url: string, config: any = {}, timeoutMs: number = 10000) => {
    const source = axios.CancelToken.source();
    const timeoutId = setTimeout(() => source.cancel("timeout"), timeoutMs);

    try {
      // Do NOT override config here, merge it
      const response = await api.get(url, {
        ...config,
        cancelToken: source.token,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (axios.isCancel(error) && error.message === 'timeout') {
        console.warn(`[API TIMEOUT] ${url} timed out after ${timeoutMs}ms`);
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  },
  post: async (url: string, data?: any, config: any = {}, timeoutMs: number = 10000) => {
    const source = axios.CancelToken.source();
    const timeoutId = setTimeout(() => source.cancel("timeout"), timeoutMs);

    try {
      const response = await api.post(url, data, {
        ...config,
        cancelToken: source.token,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (axios.isCancel(error) && error.message === 'timeout') {
        console.warn(`[API TIMEOUT] ${url} timed out after ${timeoutMs}ms`);
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  },
};

// Simplified Cached Wrapper - Removed complex caching logic that might block Auth
export const cachedApi = {
  get: async (url: string, config?: any) => {
    // Direct pass-through for now to ensure freshness and correct Auth
    return api.get(url, config);
  },
  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
  put: (url: string, data?: any, config?: any) => api.put(url, data, config),
  patch: (url: string, data?: any, config?: any) => api.patch(url, data, config),
  delete: (url: string, config?: any) => api.delete(url, config),
};

export const invalidateCache = (urlPattern: string) => {
  // No-op since cache is removed
  console.log('[Cache] Invalidation requested for', urlPattern);
};

export default api;
