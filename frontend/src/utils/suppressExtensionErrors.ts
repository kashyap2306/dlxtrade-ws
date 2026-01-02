/**
 * Suppress Browser Extension Errors
 *
 * This utility suppresses errors and warnings from browser extensions that
 * interfere with the development experience. Common culprits include:
 * - Translation extensions (translate-page)
 * - Page saving extensions (save-page)
 * - Menu item injection errors
 *
 * These errors don't affect application functionality but clutter the console.
 */

const EXTENSION_ERROR_PATTERNS = [
  'translate-page',
  'save-page',
  'menu item',
  'chrome-extension',
  'moz-extension',
  'safari-extension',
  'edge-extension',
  'Cannot find menu item',
];

/**
 * Check if an error message is from a browser extension
 */
function isExtensionError(message: string): boolean {
  if (!message) return false;
  const lowerMessage = message.toLowerCase();
  return EXTENSION_ERROR_PATTERNS.some(pattern =>
    lowerMessage.includes(pattern.toLowerCase())
  );
}

/**
 * Suppress extension errors in the console
 */
export function suppressExtensionErrors(): void {
  // Suppress window.error events
  window.addEventListener('error', (event) => {
    if (event.message && isExtensionError(event.message)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }, true);

  // Suppress unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    if (
      event.reason &&
      (
        (event.reason.message && isExtensionError(event.reason.message)) ||
        (typeof event.reason === 'string' && isExtensionError(event.reason))
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  });

  // Patch console.error to filter extension errors
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    if (isExtensionError(message)) {
      // Silently ignore extension errors
      return;
    }

    originalConsoleError.apply(console, args);
  };

  // Patch console.warn to filter extension warnings
  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const message = args
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    if (isExtensionError(message)) {
      // Silently ignore extension warnings
      return;
    }

    originalConsoleWarn.apply(console, args);
  };
}

/**
 * Initialize extension error suppression
 * Call this early in your application bootstrap
 */
export function initExtensionErrorSuppression(): void {
  if (typeof window === 'undefined') {
    return; // Skip on server-side rendering
  }

  suppressExtensionErrors();

  if (import.meta.env.DEV) {
    console.log('[Extension Errors] Browser extension error suppression enabled');
  }
}

// Auto-initialize if this module is imported
initExtensionErrorSuppression();
