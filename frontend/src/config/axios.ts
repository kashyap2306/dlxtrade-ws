import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';
import { API_URL } from './env';

// Set baseURL to API_URL only
const baseURL = API_URL;

// Circuit breaker state
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuitBreaker: CircuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'closed',
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const slowRequestWarnings = new Set<string>();

// Cache system
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const apiCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000;

const CACHEABLE_ENDPOINTS = [
  '/agents',
  '/agents/unlocked',
  '/notifications',
  '/settings/load'
];

const shouldCache = (url: string): boolean =>
  CACHEABLE_ENDPOINTS.some(endpoint => url.includes(endpoint));

const getCachedResponse = (url: string): any | null => {
  const cached = apiCache.get(url);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }
  if (cached) apiCache.delete(url);
  return null;
};

const setCachedResponse = (url: string, data: any, ttl: number = CACHE_TTL): void => {
  apiCache.set(url, { data, timestamp: Date.now(), ttl });
};

// Axios instance (CORS-safe)
const api = axios.create({
  baseURL,
  timeout: 30000,
  retryConfig: {
    retries: MAX_RETRIES,
    retryDelay: RETRY_DELAY,
    retryCondition: (error: AxiosError) =>
      !error.response ||
      error.response.status >= 500 ||
      error.response.status === 429 ||
      error.response.status === 408,
  },
});

// Logging
const logRequest = (config: InternalAxiosRequestConfig, context: string) => {
  if (import.meta.env.DEV) {
    console.log(`[API ${context}]`, `${config.method?.toUpperCase()} ${config.url}`);
  }
};

const logResponse = (response: AxiosResponse, context: string) => {
  const duration = Date.now() - (response.config.metadata?.startTime || 0);

  if (import.meta.env.DEV) {
    console.log(
      `[API ${context}]`,
      `${response.status} ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`
    );
  } else if (duration > 5000) {
    const key = `${response.config.method?.toUpperCase()} ${response.config.url}`;
    if (!slowRequestWarnings.has(key)) {
      console.warn(`[API SLOW] ${key} took ${duration}ms`);
      slowRequestWarnings.add(key);
      setTimeout(() => slowRequestWarnings.delete(key), 300000);
    }
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

// Circuit Breaker logic
const isCircuitBreakerOpen = (): boolean => {
  if (circuitBreaker.state === 'open') {
    if (Date.now() - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreaker.state = 'half-open';
      return false;
    }
    return true;
  }
  return false;
};

const recordFailure = () => {
  circuitBreaker.failures++;
  circuitBreaker.lastFailureTime = Date.now();

  if (circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.state = 'open';
  }
};

const recordSuccess = () => {
  if (circuitBreaker.state === 'half-open') {
    circuitBreaker.state = 'closed';
    circuitBreaker.failures = 0;
  } else {
    circuitBreaker.failures = Math.max(0, circuitBreaker.failures - 1);
  }
};

// Request Interceptor
api.interceptors.request.use(
  async (config) => {
    if (isCircuitBreakerOpen()) {
      const error = new Error('Circuit breaker is open');
      (error as any).isCircuitBreakerError = true;
      throw error;
    }

    // Firebase Token - get fresh token on each request
    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (user) {
        const idToken = await user.getIdToken(/* forceRefresh= */ false);
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${idToken}`,
        };
      }
    } catch (e) {
      // swallow here; request will continue without token
      console.warn('Could not attach idToken', e);
    }

    // Metadata
    config.metadata = {
      startTime: Date.now(),
      requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    };

    logRequest(config, 'REQUEST');
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => {
    recordSuccess();
    logResponse(response, 'SUCCESS');

    if (response.config.method === 'get' && shouldCache(response.config.url || '')) {
      setCachedResponse(response.config.url || '', response.data);
    }

    return response;
  },

  async (error: AxiosError) => {
    const config = error.config || {};

    if ((error as any).isCircuitBreakerError) return Promise.reject(error);

    // Only trigger circuit breaker for server errors, not client errors (like 401 auth failures)
    const shouldTriggerCircuitBreaker = !error.response ||
      error.response.status >= 500 ||
      error.response.status === 429 ||
      error.response.status === 408;

    if (shouldTriggerCircuitBreaker) {
      recordFailure();
    }

    logError(error, 'ERROR');
    return Promise.reject(error);
  }
);

// Health Ping Service
class HealthPingService {
  private intervalId: NodeJS.Timeout | null = null;
  private isHealthy = false;

  start() {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      try {
        const res = await axios.get('/health', { timeout: 5000 });
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
  get: async (url: string, config?: any, timeoutMs: number = 10000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await api.get(url, {
        ...config,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.warn(`[API TIMEOUT] ${url} timed out after ${timeoutMs}ms`);
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  },
  post: async (url: string, data?: any, config?: any, timeoutMs: number = 10000) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await api.post(url, data, {
        ...config,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.warn(`[API TIMEOUT] ${url} timed out after ${timeoutMs}ms`);
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  },
};

// Cached Wrapper
export const cachedApi = {
  get: async (url: string, config?: any) => {
    const cached = shouldCache(url) ? getCachedResponse(url) : null;
    if (cached) return { data: cached };

    const res = await api.get(url, config);

    if (shouldCache(url)) setCachedResponse(url, res.data);

    return res;
  },
  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
  put: (url: string, data?: any, config?: any) => api.put(url, data, config),
  patch: (url: string, data?: any, config?: any) => api.patch(url, data, config),
  delete: (url: string, config?: any) => api.delete(url, config),
};

// Cache invalidation function
export const invalidateCache = (urlPattern: string) => {
  for (const [url, _] of apiCache) {
    if (url.includes(urlPattern)) {
      apiCache.delete(url);
    }
  }
};

export default api;
