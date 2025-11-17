import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
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

