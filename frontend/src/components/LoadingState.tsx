import React from 'react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  overlay?: boolean;
  className?: string;
}

export function LoadingState({
  message = 'Loading...',
  size = 'md',
  overlay = false,
  className = ''
}: LoadingStateProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  const spinner = (
    <div className={`flex flex-col items-center justify-center gap-4 ${className}`}>
      <div className={`${sizeClasses[size]} border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin`}></div>
      {message && (
        <p className="text-slate-300 text-sm font-medium animate-pulse">
          {message}
        </p>
      )}
    </div>
  );

  if (overlay) {
    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center emergency-hide-overlay">
        {spinner}
      </div>
    );
  }

  return spinner;
}

export function SkeletonLoader({ className = '', lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-slate-700/50 rounded animate-pulse"
          style={{ width: `${Math.random() * 40 + 60}%` }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 animate-pulse ${className}`}>
      <div className="space-y-4">
        <div className="h-6 bg-slate-700/50 rounded-lg w-1/3"></div>
        <div className="space-y-3">
          <div className="h-4 bg-slate-700/50 rounded w-2/3"></div>
          <div className="h-4 bg-slate-700/50 rounded w-1/2"></div>
          <div className="h-4 bg-slate-700/50 rounded w-3/4"></div>
        </div>
      </div>
    </div>
  );
}
