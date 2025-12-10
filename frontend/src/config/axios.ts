import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

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

// Dynamic API base URL detection
const isLocalhost = window.location.hostname === 'localhost';
const DEPLOYED_BACKEND_URL = 'https://dlx-trading-backend.web.app'; // Replace with actual backend URL

const API_BASE_URL = isLocalhost
  ? "http://localhost:4000/api"
  : `${DEPLOYED_BACKEND_URL}/api`;

console.log('[API CONFIG] Environment detection:');
console.log('  - hostname:', window.location.hostname);
console.log('  - isLocalhost:', isLocalhost);
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
const setupAxiosInterceptors = async () => {
  // Wait for Firebase to be ready
  await firebaseReady;

  // Runtime guard: Ensure Firebase helpers are available
  if (typeof isFirebaseAvailable !== "function" || typeof getAuthToken !== "function") {
    console.error("[GUARD] Firebase helper missing in axios.ts — aborting interceptor setup");
    return;
  }

  console.log("[GUARD] Firebase helpers present for axios, setting up interceptors");

  // Runtime debugging - show what's actually imported
  console.log("[DEBUG] axios.ts runtime imports:", {
    isFirebaseAvailable: typeof isFirebaseAvailable,
    getAuthToken: typeof getAuthToken,
    auth: typeof auth,
    isUsingMockFirebase: typeof isUsingMockFirebase,
    axiosBaseURL: api.defaults.baseURL
  });

  // Logging with safe guards
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
    console.error('[API AUTH] 401 Unauthorized - check Firebase authentication');
    console.error('[API AUTH] This may be expected for unauthenticated requests');
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

      // Wait until Firebase auth state is known
      try {
        await firebaseReady;
      } catch (e) {
        console.warn('[AXIOS] firebaseReady rejection (ignored):', e);
      }

      // Try to obtain a fresh token, but do not block indefinitely
      try {
        const token = await getAuthToken(false);
        if (token) {
          if (!config.headers) config.headers = {} as any;
          (config.headers as any)['Authorization'] = `Bearer ${token}`;
          // optional: attach uid header if you rely on it
          // (config.headers as any)['uid'] = auth.currentUser?.uid;
          console.log('[AXIOS] 🔐 Request authenticated with Firebase token');
        } else {
          console.log('[AXIOS] ℹ️ No Firebase token available for request; sending unauthenticated');
        }
      } catch (err) {
        console.warn('[AXIOS] failed to attach token:', err);
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

      // Handle 401 errors with token refresh retry
      if (error.response?.status === 401 && config.url?.startsWith('/api') && !config._retry) {
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
};

// Import the updated firebase utilities
import { firebaseReady, getAuthToken } from './firebase-utils';

// Setup interceptors after Firebase auth state is determined
firebaseReady.then(() => {
  setupAxiosInterceptors();
  console.log("[AXIOS] Interceptors attached after Firebase ready");
}).catch(err => {
  console.warn("[AXIOS] Firebase ready failed:", err);
});

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

if (typeof window !== 'undefined') {
  setTimeout(() => healthPingService.start(), 2000);
}

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
