import React from 'react';
import { getApiErrorMessage } from '../utils/errorHandler';

interface ErrorStateProps {
  error?: any;
  message?: string;
  onRetry?: () => void;
  showRetry?: boolean;
  className?: string;
}

export function ErrorState({
  error,
  message,
  onRetry,
  showRetry = true,
  className = ''
}: ErrorStateProps) {
  const errorInfo = error ? getApiErrorMessage(error) : null;
  const displayMessage = message || errorInfo?.message || 'Something went wrong';

  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      <div className="w-16 h-16 mx-auto mb-4 bg-red-500/20 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-white mb-2">Error</h3>

      <p className="text-slate-300 text-sm mb-6 max-w-md">
        {displayMessage}
      </p>

      {showRetry && onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          Try Again
        </button>
      )}

      {import.meta.env.DEV && error && (
        <details className="mt-4 text-left">
          <summary className="text-slate-400 cursor-pointer hover:text-white text-xs">
            Debug Info
          </summary>
          <pre className="text-xs text-red-300 mt-2 bg-slate-900/50 p-3 rounded whitespace-pre-wrap overflow-x-auto">
            {JSON.stringify(error, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function InlineError({ error, className = '' }: { error?: any; className?: string }) {
  if (!error) return null;

  const errorInfo = getApiErrorMessage(error);

  return (
    <div className={`p-3 bg-red-500/10 border border-red-500/30 rounded-lg ${className}`}>
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <div className="flex-1">
          <p className="text-red-300 text-sm">{errorInfo.message}</p>
        </div>
      </div>
    </div>
  );
}
