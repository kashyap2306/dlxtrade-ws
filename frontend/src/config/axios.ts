import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';
import { API_BASE_URL } from './env';

// Construct API base URL with /api path and trailing slash
const baseURL = `${API_BASE_URL}/api/`;

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

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute before trying again
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

// Slow request tracking to avoid spamming console
const slowRequestWarnings = new Set<string>();

// API response cache
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

const apiCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000; // 5 seconds cache TTL

// Cacheable endpoints
const CACHEABLE_ENDPOINTS = [
  '/agents',
  '/agents/unlocked',
  '/notifications',
  '/settings/load'
];

// Check if endpoint should be cached
const shouldCache = (url: string): boolean => {
  return CACHEABLE_ENDPOINTS.some(endpoint => url.includes(endpoint));
};

// Get cached response if valid
const getCachedResponse = (url: string): any | null => {
  const cacheKey = url;
  const cached = apiCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }

  // Remove expired cache
  if (cached) {
    apiCache.delete(cacheKey);
  }

  return null;
};

// Cache response
const setCachedResponse = (url: string, data: any, ttl: number = CACHE_TTL): void => {
  const cacheKey = url;
  apiCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    ttl
  });
};

const api = axios.create({
  baseURL,
  withCredentials: false,
  timeout: 20000, // 20 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
  // Add retry configuration
  retryConfig: {
    retries: MAX_RETRIES,
    retryDelay: RETRY_DELAY,
    retryCondition: (error: AxiosError) => {
      // Retry on network errors, 5xx errors, and specific 4xx errors
      return (
        !error.response || // Network error
        error.response.status >= 500 || // Server errors
        error.response.status === 429 || // Rate limiting
        error.response.status === 408 // Request timeout
      );
    },
  },
});

// Enhanced logging utility
const logRequest = (config: InternalAxiosRequestConfig, context: string) => {
  if (import.meta.env.DEV) {
    console.log(`[API ${context}]`, `${config.method?.toUpperCase()} ${config.url}`);
  }
};

const logResponse = (response: AxiosResponse, context: string) => {
  const duration = response.config.metadata?.startTime
    ? Date.now() - response.config.metadata.startTime
    : 0;

  if (import.meta.env.DEV) {
    console.log(`[API ${context}]`, `${response.status} ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`);
  } else {
    // In production, log slow requests and errors (only once per endpoint to avoid spam)
    if (duration > 5000) {
      const endpointKey = `${response.config.method?.toUpperCase()} ${response.config.url}`;
      if (!slowRequestWarnings.has(endpointKey)) {
        console.warn(`[API SLOW] ${endpointKey} took ${duration}ms (warning shown once per endpoint)`);
        slowRequestWarnings.add(endpointKey);
        // Clear warning after 5 minutes to allow re-warning if issue persists
        setTimeout(() => slowRequestWarnings.delete(endpointKey), 300000);
      }
    }
  }
};

const logError = (error: AxiosError, context: string, extra?: any) => {
  const status = error.response?.status;
  const url = error.config?.url;
  const method = error.config?.method?.toUpperCase();

  console.error(`[API ${context}]`, `${method} ${url} failed:`, {
    status,
    message: error.message,
    data: error.response?.data,
    ...extra,
  });

  // In production, you might want to send this to a logging service
  if (!import.meta.env.DEV) {
    // Example: send to logging service
    // logToService('api_error', { status, url, method, error: error.message });
  }
};

// Circuit breaker logic
const isCircuitBreakerOpen = (): boolean => {
  if (circuitBreaker.state === 'open') {
    if (Date.now() - circuitBreaker.lastFailureTime > CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreaker.state = 'half-open';
      console.warn('[API] Circuit breaker entering half-open state');
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
    console.error(`[API] Circuit breaker opened after ${circuitBreaker.failures} failures`);
  }
};

const recordSuccess = () => {
  if (circuitBreaker.state === 'half-open') {
    circuitBreaker.state = 'closed';
    circuitBreaker.failures = 0;
    console.log('[API] Circuit breaker closed - service recovered');
  } else if (circuitBreaker.state === 'closed') {
    circuitBreaker.failures = Math.max(0, circuitBreaker.failures - 1);
  }
};

// Request interceptor
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // Check circuit breaker
    if (isCircuitBreakerOpen()) {
      const error = new Error('Circuit breaker is open - service temporarily unavailable');
      (error as any).isCircuitBreakerError = true;
      throw error;
    }

    // Add Firebase token
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (tokenError) {
      logError(tokenError as AxiosError, 'TOKEN', { context: 'Failed to get auth token' });
    }

    // Add request ID for tracking
    config.metadata = {
      requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
    };

    logRequest(config, 'REQUEST');
    return config;
  },
  (error) => {
    logError(error, 'REQUEST_SETUP');
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response: AxiosResponse) => {
    recordSuccess();
    logResponse(response, 'SUCCESS');

    // Cache successful GET responses
    if (response.config.method?.toLowerCase() === 'get' && shouldCache(response.config.url || '')) {
      setCachedResponse(response.config.url || '', response.data);
    }

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as any;
    const retryConfig = config?.retryConfig || api.defaults.retryConfig;

    // Handle circuit breaker errors
    if ((error as any).isCircuitBreakerError) {
      return Promise.reject(error);
    }

    // Handle auth errors
    if (error.response?.status === 401) {
      localStorage.removeItem('firebaseToken');
      localStorage.removeItem('firebaseUser');
      window.location.href = '/login';
      return Promise.reject(error);
    }

    // Check if we should retry
    const shouldRetry = retryConfig?.retryCondition(error) &&
                       (config?.retryCount || 0) < retryConfig.retries;

    if (shouldRetry) {
      config.retryCount = (config.retryCount || 0) + 1;
      const delay = retryConfig.retryDelay * Math.pow(2, config.retryCount - 1); // Exponential backoff

      logError(error, 'RETRY', {
        attempt: config.retryCount,
        maxRetries: retryConfig.retries,
        delay,
      });

      return new Promise((resolve) => {
        setTimeout(() => resolve(api.request(config)), delay);
      });
    }

    // Record failure for circuit breaker
    recordFailure();
    logError(error, 'FINAL_FAILURE', { retryCount: config?.retryCount || 0 });

    return Promise.reject(error);
  }
);

// Background health ping service
class HealthPingService {
  private intervalId: NodeJS.Timeout | null = null;
  private isHealthy = false;

  start() {
    if (this.intervalId) return; // Already running

    console.log('[API] Starting background health ping service (every 60s)');
    this.intervalId = setInterval(async () => {
      try {
        const response = await axios.get(`${import.meta.env.VITE_API_URL}/health`, {
          timeout: 5000, // Short timeout for health checks
        });

        if (response.data?.status === 'ok') {
          if (!this.isHealthy) {
            console.log('[API] Health check successful - service is healthy');
            this.isHealthy = true;
          }
        } else {
          if (this.isHealthy) {
            console.warn('[API] Health check failed - service may be unhealthy');
            this.isHealthy = false;
          }
        }
      } catch (error) {
        if (this.isHealthy) {
          console.warn('[API] Health check failed - service may be down');
          this.isHealthy = false;
        }
      }
    }, 60000); // 60 seconds
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[API] Stopped background health ping service');
    }
  }

  isServiceHealthy(): boolean {
    return this.isHealthy;
  }
}

export const healthPingService = new HealthPingService();

// Auto-start health ping service when module loads
if (typeof window !== 'undefined') {
  // Start after a short delay to allow app initialization
  setTimeout(() => healthPingService.start(), 2000);
}

// Cached API wrapper for frequently called endpoints
export const cachedApi = {
  get: async (url: string, config?: any) => {
    if (shouldCache(url)) {
      const cached = getCachedResponse(url);
      if (cached) {
        return { data: cached };
      }
    }

    const response = await api.get(url, config);

    if (shouldCache(url)) {
      setCachedResponse(url, response.data);
    }

    return response;
  },

  post: (url: string, data?: any, config?: any) => api.post(url, data, config),
  put: (url: string, data?: any, config?: any) => api.put(url, data, config),
  patch: (url: string, data?: any, config?: any) => api.patch(url, data, config),
  delete: (url: string, config?: any) => api.delete(url, config),
};

export default api;
