import { useEffect, useState } from 'react';
import { XCircleIcon, ExclamationTriangleIcon, ShieldExclamationIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

export type ErrorType = 'auth' | 'api' | 'network' | 'validation' | 'exchange' | 'research' | 'warning' | 'critical' | 'info';

interface ErrorPopupProps {
  message: string;
  type?: ErrorType;
  onClose: () => void;
  duration?: number;
}

export default function ErrorPopup({ message, type = 'error', onClose, duration = 4000 }: ErrorPopupProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setIsVisible(false);
        onClose();
      }, 300); // Fade-out animation duration
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const getConfig = () => {
    switch (type) {
      case 'auth':
        return {
          icon: ShieldExclamationIcon,
          title: 'Authentication Error',
          gradient: 'from-red-500/20 via-orange-500/20 to-red-500/20',
          border: 'border-red-500/50',
          text: 'text-red-300',
          iconColor: 'text-red-400',
          glow: 'shadow-red-500/50',
        };
      case 'api':
        return {
          icon: XCircleIcon,
          title: 'API Error',
          gradient: 'from-orange-500/20 via-red-500/20 to-orange-500/20',
          border: 'border-orange-500/50',
          text: 'text-orange-300',
          iconColor: 'text-orange-400',
          glow: 'shadow-orange-500/50',
        };
      case 'network':
        return {
          icon: XCircleIcon,
          title: 'Network Error',
          gradient: 'from-yellow-500/20 via-orange-500/20 to-yellow-500/20',
          border: 'border-yellow-500/50',
          text: 'text-yellow-300',
          iconColor: 'text-yellow-400',
          glow: 'shadow-yellow-500/50',
        };
      case 'validation':
        return {
          icon: ExclamationTriangleIcon,
          title: 'Validation Error',
          gradient: 'from-blue-500/20 via-cyan-500/20 to-blue-500/20',
          border: 'border-blue-500/50',
          text: 'text-blue-300',
          iconColor: 'text-blue-400',
          glow: 'shadow-blue-500/50',
        };
      case 'exchange':
        return {
          icon: XCircleIcon,
          title: 'Exchange Error',
          gradient: 'from-purple-500/20 via-pink-500/20 to-purple-500/20',
          border: 'border-purple-500/50',
          text: 'text-purple-300',
          iconColor: 'text-purple-400',
          glow: 'shadow-purple-500/50',
        };
      case 'research':
        return {
          icon: InformationCircleIcon,
          title: 'Research Info',
          gradient: 'from-indigo-500/20 via-blue-500/20 to-indigo-500/20',
          border: 'border-indigo-500/50',
          text: 'text-indigo-300',
          iconColor: 'text-indigo-400',
          glow: 'shadow-indigo-500/50',
        };
      case 'warning':
        return {
          icon: ExclamationTriangleIcon,
          title: 'Warning',
          gradient: 'from-yellow-500/20 via-amber-500/20 to-yellow-500/20',
          border: 'border-yellow-500/50',
          text: 'text-yellow-300',
          iconColor: 'text-yellow-400',
          glow: 'shadow-yellow-500/50',
        };
      case 'critical':
        return {
          icon: ShieldExclamationIcon,
          title: 'Critical Error',
          gradient: 'from-red-500/20 via-rose-500/20 to-red-500/20',
          border: 'border-red-500/50',
          text: 'text-red-300',
          iconColor: 'text-red-400',
          glow: 'shadow-red-500/50',
        };
      case 'info':
      default:
        return {
          icon: InformationCircleIcon,
          title: 'Information',
          gradient: 'from-blue-500/20 via-cyan-500/20 to-blue-500/20',
          border: 'border-blue-500/50',
          text: 'text-blue-300',
          iconColor: 'text-blue-400',
          glow: 'shadow-blue-500/50',
        };
    }
  };

  const config = getConfig();
  const Icon = config.icon;

  return (
    <div
      className={`fixed top-4 right-4 z-[9999] max-w-md w-full sm:w-96 animate-slide-in-right ${
        isAnimating ? 'animate-fade-out' : ''
      }`}
    >
      <div
        className={`relative bg-gradient-to-br ${config.gradient} backdrop-blur-xl rounded-2xl border-2 ${config.border} shadow-2xl ${config.glow} p-4 sm:p-5`}
      >
        <div className="flex items-start space-x-3">
          <div className={`flex-shrink-0 ${config.iconColor}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={`text-sm font-semibold ${config.text} mb-1`}>{config.title}</h4>
            <p className={`text-sm ${config.text} break-words`}>{message}</p>
          </div>
          <button
            onClick={() => {
              setIsAnimating(true);
              setTimeout(() => {
                setIsVisible(false);
                onClose();
              }, 300);
            }}
            className={`flex-shrink-0 ${config.text} hover:opacity-70 transition-opacity`}
          >
            <XCircleIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

