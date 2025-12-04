import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';
import { API_BASE_URL } from './env';

// Construct correct base URL (do NOT append /api again if env already has it)
const baseURL = API_BASE_URL;

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
  withCredentials: true,
  timeout: 20000,
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

    // Firebase Token
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {}

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
    const retryConfig = config.retryConfig;

    if ((error as any).isCircuitBreakerError) return Promise.reject(error);

    if (!error.response) return Promise.reject(error);

    if (error.response.status >= 400) return Promise.reject(error);

    recordFailure();
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
        const res = await axios.get(`${API_BASE_URL}/health`, { timeout: 5000 });
        this.isHealthy = res.data?.status === 'ok';
      } catch {
        this.isHealthy = false;
      }
    }, 60000);
  }
}

export const healthPingService = new HealthPingService();

if (typeof window !== 'undefined') {
  setTimeout(() => healthPingService.start(), 2000);
}

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

export default api;
