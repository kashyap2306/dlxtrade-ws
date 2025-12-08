import React, { useEffect, useState } from 'react';
import { XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface NotificationBannerProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  duration?: number;
  onClose?: () => void;
  soundEnabled?: boolean;
}

const NotificationBanner: React.FC<NotificationBannerProps> = ({
  message,
  type,
  title,
  duration = 8000,
  onClose,
  soundEnabled = false
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    // Play sound if enabled
    if (soundEnabled) {
      try {
        const audio = new Audio('/alert.mp3');
        audio.volume = 0.4;
        audio.play().catch(() => {}); // Ignore errors if audio fails
      } catch (error) {
        // Silently fail if audio not available
      }
    }

    // Add vibration for mobile
    if (soundEnabled && 'vibrate' in navigator) {
      navigator.vibrate(200);
    }

    // Auto-dismiss with progress bar
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev <= 0) {
          setIsVisible(false);
          onClose?.();
          return 0;
        }
        return prev - (100 / (duration / 100));
      });
    }, 100);

    const timeout = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [duration, onClose, soundEnabled]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircleIcon className="w-6 h-6 text-green-400" />;
      case 'error':
        return <XCircleIcon className="w-6 h-6 text-red-400" />;
      case 'warning':
        return <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400" />;
      case 'info':
      default:
        return <InformationCircleIcon className="w-6 h-6 text-blue-400" />;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case 'success':
        return 'bg-gradient-to-r from-green-500/20 to-green-600/20 border-green-500/30';
      case 'error':
        return 'bg-gradient-to-r from-red-500/20 to-red-600/20 border-red-500/30';
      case 'warning':
        return 'bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 border-yellow-500/30';
      case 'info':
      default:
        return 'bg-gradient-to-r from-blue-500/20 to-blue-600/20 border-blue-500/30';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-4 right-4 sm:top-6 sm:left-6 sm:right-6 z-50 animate-in slide-in-from-top-2 duration-300">
      <div className={`backdrop-blur-xl border rounded-xl shadow-2xl p-3 sm:p-4 ${getBgColor()}`}>
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-700/50 rounded-b-xl overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0 mt-0.5">
            {getIcon()}
          </div>
          <div className="flex-1 min-w-0">
            {title && (
              <h4 className="text-lg font-bold text-white mb-2">
                {title}
              </h4>
            )}
            <p className="text-sm text-gray-300 leading-relaxed">
              {message}
            </p>
          </div>
          <button
            onClick={() => {
              setIsVisible(false);
              onClose?.();
            }}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors p-1"
            aria-label="Close banner"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationBanner;
