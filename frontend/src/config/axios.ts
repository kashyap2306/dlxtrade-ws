import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';
import { API_URL } from './env';

declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    metadata?: {
      startTime: number;
      requestId: string;
    };
    _retry?: boolean;
  }
}

// Set baseURL to API_URL only
const baseURL = API_URL;
console.log('API_URL loaded:', API_URL);
console.log("[API URL CHECK]", API_URL);

// Axios instance (CORS-safe)
const api = axios.create({
  baseURL,
  timeout: 30000,
});

console.log('[AXIOS] Axios instance created:');
console.log('  - baseURL:', api.defaults.baseURL);
console.log('  - timeout:', api.defaults.timeout);

// Logging
const logRequest = (config: InternalAxiosRequestConfig, context: string) => {
  const fullUrl = config.baseURL ? `${config.baseURL}${config.url}` : config.url;
  console.log(`[API ${context}] REQUEST:`, {
    method: config.method?.toUpperCase(),
    url: config.url,
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
  const fullUrl = response.config.baseURL ? `${response.config.baseURL}${response.config.url}` : response.config.url;
  console.log(`[API ${context}] SUCCESS:`, {
    status: response.status,
    statusText: response.statusText,
    method: response.config.method?.toUpperCase(),
    url: response.config.url,
    fullUrl: fullUrl,
    duration: `${duration}ms`,
    dataSize: JSON.stringify(response.data).length + ' chars'
  });
};

const logError = (error: AxiosError, context: string, extra?: any) => {
  const fullUrl = error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url;
  const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : 0;

  console.error(`[API ${context}] ERROR:`, {
    method: error.config?.method?.toUpperCase(),
    url: error.config?.url,
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

    // Firebase Token - ALWAYS attach if user exists
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      console.log('[AUTH] Request interceptor - user exists:', !!user);

      if (user) {
        console.log('[AUTH] Getting Firebase ID token...');
        // Ensure we get a fresh token if needed, but standard getIdToken() handles expiration
        const idToken = await user.getIdToken();
        console.log('[AUTH] Token retrieved, length:', idToken?.length || 0);

        // CRITICAL FIX: Secure header attachment
        config.headers = {
          ...(config.headers || {}),
          Authorization: `Bearer ${idToken}`
        } as any;
        console.log('[AUTH] Authorization header attached');
      } else {
        console.warn('[AUTH] No authenticated user - request will be unauthenticated');
      }
    } catch (e) {
      console.error('[AUTH] Could not attach idToken:', e.message);
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

    // 401 errors - let Firebase SDK handle token refresh automatically
    // No manual token refresh needed - Firebase handles this internally

    logError(error, 'ERROR');
    return Promise.reject(error);
  }
);

// Health Ping Service
class HealthPingService {
  private intervalId: number | null = null;
  private isHealthy = false;

  start() {
    if (this.intervalId) return;

    this.intervalId = window.setInterval(async () => {
      try {
        const healthUrl = `${baseURL}/health`;
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
