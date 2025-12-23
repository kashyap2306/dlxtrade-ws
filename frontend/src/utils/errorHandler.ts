import { ErrorType } from '../components/ui/ErrorPopup';

/**
 * Converts Firebase error codes to user-friendly messages
 */
export function getFirebaseErrorMessage(error: any): { message: string; type: ErrorType } {
  const code = error?.code || '';
  const message = error?.message || '';

  // Firebase Auth Errors
  if (code.includes('auth/user-not-found')) {
    return { message: 'No account found for this email.', type: 'auth' };
  }
  if (code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')) {
    return { message: 'Incorrect password. Try again.', type: 'auth' };
  }
  if (code.includes('auth/invalid-email')) {
    return { message: 'Enter a valid email address.', type: 'validation' };
  }
  if (code.includes('auth/email-already-in-use')) {
    return { message: 'This email is already registered.', type: 'auth' };
  }
  if (code.includes('auth/weak-password')) {
    return { message: 'Password must be strong.', type: 'validation' };
  }
  if (code.includes('auth/invalid-phone-number')) {
    return { message: 'Enter a valid phone number.', type: 'validation' };
  }
  if (code.includes('auth/network-request-failed')) {
    return { message: 'Network issue. Please try again.', type: 'network' };
  }
  if (code.includes('auth/too-many-requests')) {
    return { message: 'Too many requests. Please try again later.', type: 'warning' };
  }

  // Generic Firebase errors
  if (code.includes('auth/')) {
    const cleanMessage = message.replace('Firebase: Error (', '').replace(').', '').replace('auth/', '');
    return { message: cleanMessage || 'Authentication error occurred.', type: 'auth' };
  }

  return { message: message || 'An error occurred.', type: 'api' };
}

/**
 * Converts API errors to user-friendly messages
 */
export function getApiErrorMessage(error: any): { message: string; type: ErrorType } {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const message = data?.error || data?.message || error?.message || 'An error occurred';

  // Network errors
  if (!error.response || error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return { message: 'Unable to reach server. Please check your connection.', type: 'network' };
  }

  // HTTP status codes
  if (status === 401) {
    return { message: 'Invalid API credentials.', type: 'auth' };
  }
  if (status === 403) {
    return { message: 'Access denied. Please check your permissions.', type: 'auth' };
  }
  if (status === 404) {
    return { message: 'Resource not found.', type: 'api' };
  }
  if (status === 429) {
    return { message: 'API request limit exceeded. Please try again later.', type: 'warning' };
  }
  if (status === 500 || status === 502 || status === 503) {
    return { message: 'Server error. Please try again later.', type: 'critical' };
  }

  // Exchange-specific errors
  if (message.toLowerCase().includes('api key') || message.toLowerCase().includes('invalid key')) {
    return { message: 'Invalid API Key', type: 'exchange' };
  }
  if (message.toLowerCase().includes('credentials') || message.toLowerCase().includes('authentication')) {
    return { message: 'Exchange credentials incorrect', type: 'exchange' };
  }
  if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('trading')) {
    return { message: 'Trading permission missing', type: 'exchange' };
  }
  if (message.toLowerCase().includes('coinapi')) {
    return { message: 'CoinAPI request failed', type: 'api' };
  }
  if (message.toLowerCase().includes('connection') || message.toLowerCase().includes('timeout')) {
    return { message: 'Connection timeout', type: 'network' };
  }

  // Clean up technical jargon
  let cleanMessage = message;
  cleanMessage = cleanMessage.replace(/Firebase: Error \(.*?\)\.?/g, '');
  cleanMessage = cleanMessage.replace(/Error: /g, '');
  cleanMessage = cleanMessage.replace(/auth\//g, '');
  cleanMessage = cleanMessage.trim();

  return { message: cleanMessage || 'An error occurred', type: 'api' };
}

/**
 * Suppress console errors in production
 */
export function suppressConsoleError(error: any, context?: string) {
  // In development, still log for debugging
  if (import.meta.env.DEV && context) {
    console.error(`[${context}]`, error);
  }
  // In production, don't log user-facing errors to console
}

