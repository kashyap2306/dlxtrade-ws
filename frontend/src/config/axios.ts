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

// Axios instance (CORS-safe)
const api = axios.create({
  baseURL,
  timeout: 30000,
});

// Logging
const logRequest = (config: InternalAxiosRequestConfig, context: string) => {
  if (import.meta.env.DEV) {
    console.log(`[API ${context}]`, `${config.method?.toUpperCase()} ${config.url}`);
  }
};

const logResponse = (response: AxiosResponse, context: string) => {
  const duration = response.config.metadata ? Date.now() - response.config.metadata.startTime : 0;
  if (import.meta.env.DEV) {
    console.log(
      `[API ${context}]`,
      `${response.status} ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`
    );
  }
};

const logError = (error: AxiosError, context: string, extra?: any) => {
  console.error(`[API ${context}]`, {
    method: error.config?.method,
    url: error.config?.url,
    status: error.response?.status,
    message: error.message,
    data: error.response?.data,
    ...extra,
  });
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
      if (user) {
        // Ensure we get a fresh token if needed, but standard getIdToken() handles expiration
        const idToken = await user.getIdToken();

        // CRITICAL FIX: Secure header attachment
        config.headers = {
          ...(config.headers || {}),
          Authorization: `Bearer ${idToken}`
        } as any;
      }
    } catch (e) {
      console.warn('Could not attach idToken', e);
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

    // 401 Retry Logic
    if (error.response?.status === 401 && config && !config._retry) {
      config._retry = true;
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (user) {
          console.log('[API] 401 detected, refreshing token...');
          // Force refresh token
          const newToken = await user.getIdToken(true);

          // Update header with new token
          config.headers = {
            ...(config.headers || {}),
            Authorization: `Bearer ${newToken}`
          } as any;

          // Retry request
          return api(config);
        }
      } catch (refreshError) {
        console.error('Failed to refresh token on 401', refreshError);
      }
    }

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
