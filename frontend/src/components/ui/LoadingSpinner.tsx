import { ArrowPathIcon } from '@heroicons/react/24/outline';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  fullScreen?: boolean;
  message?: string;
}

export default function LoadingSpinner({ size = 'md', className = '', fullScreen = false, message }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
        <div className="flex flex-col items-center space-y-4">
          <div className="relative">
            <div className={`${sizeClasses[size]} border-4 border-purple-500/20 rounded-full`}></div>
            <div className={`absolute inset-0 ${sizeClasses[size]} border-4 border-transparent border-t-purple-500 rounded-full animate-spin`}></div>
            <div className={`absolute inset-0 ${sizeClasses[size]} border-4 border-transparent border-r-pink-500 rounded-full animate-spin`} style={{ animationDelay: '0.15s' }}></div>
            <div className={`absolute inset-0 ${sizeClasses[size]} border-4 border-transparent border-b-blue-500 rounded-full animate-spin`} style={{ animationDelay: '0.3s' }}></div>
          </div>
          {message && (
            <p className="text-sm text-gray-300 font-medium">{message}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <ArrowPathIcon className={`${sizeClasses[size]} text-purple-400 animate-spin`} />
    </div>
  );
}

