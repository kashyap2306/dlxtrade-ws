import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { getAuth } from 'firebase/auth';
import { API_URL } from './env';

// Ensure API_URL has trailing slash
const baseURL = API_URL.endsWith('/') ? API_URL : `${API_URL}/`;

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

const api = axios.create({
  baseURL,
  withCredentials: false,
  timeout: 30000, // Increased timeout
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
    // In production, log slow requests and errors
    if (duration > 5000) {
      console.warn(`[API SLOW] ${response.config.method?.toUpperCase()} ${response.config.url} took ${duration}ms`);
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

    // Add timing info
    if (response.config.metadata) {
      const duration = Date.now() - response.config.metadata.startTime;
      if (duration > 5000) { // Log slow requests
        console.warn(`[API] Slow request: ${duration}ms for ${response.config.method?.toUpperCase()} ${response.config.url}`);
      }
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

export default api;
