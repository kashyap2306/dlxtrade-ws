import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import ErrorPopup, { ErrorType } from '../components/ui/ErrorPopup';

interface ErrorContextType {
  showError: (message: string, type?: ErrorType) => void;
  showSuccess: (message: string) => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

interface ErrorProviderProps {
  children: ReactNode;
}

export function ErrorProvider({ children }: ErrorProviderProps) {
  const [error, setError] = useState<{ message: string; type: ErrorType } | null>(null);

  const showError = useCallback((message: string, type: ErrorType = 'info') => {
    // Suppress console errors for user-facing errors
    setError({ message, type });
  }, []);

  const showSuccess = useCallback((message: string) => {
    setError({ message, type: 'info' });
  }, []);

  const handleClose = useCallback(() => {
    setError(null);
  }, []);

  // Global error boundary for unhandled promise rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      // Prevent the default browser behavior (logging to console)
      event.preventDefault();
      // Show a user-friendly error instead
      showError('An unexpected error occurred. Please refresh the page.', 'critical');
    };

    const handleError = (event: ErrorEvent) => {
      console.error('Unhandled error:', event.error);
      // Show a user-friendly error instead
      showError('An unexpected error occurred. Please refresh the page.', 'critical');
    };

    // Add global error handlers
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      // Clean up event listeners
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, [showError]);

  return (
    <ErrorContext.Provider value={{ showError, showSuccess }}>
      {children}
      {error && (
        <ErrorPopup
          message={error.message}
          type={error.type}
          onClose={handleClose}
          duration={4000}
        />
      )}
    </ErrorContext.Provider>
  );
}

export function useError() {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
}

