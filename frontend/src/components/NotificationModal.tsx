import React, { useEffect, useState } from 'react';
import { XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface NotificationModalProps {
  isOpen: boolean;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info' | 'confirm';
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  soundEnabled?: boolean;
  children?: React.ReactNode;
}

const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  message,
  type,
  title,
  onClose,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  soundEnabled = false,
  children
}) => {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);

      // Play sound if enabled
      if (soundEnabled) {
        try {
          const audio = new Audio('/modal.mp3');
          audio.volume = 0.5;
          audio.play().catch(() => {}); // Ignore errors if audio fails
        } catch (error) {
          // Silently fail if audio not available
        }
      }

      // Add vibration for mobile
      if (soundEnabled && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } else {
      setIsAnimating(false);
    }
  }, [isOpen, soundEnabled]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircleIcon className="w-12 h-12 text-green-400" />;
      case 'error':
        return <XCircleIcon className="w-12 h-12 text-red-400" />;
      case 'warning':
        return <ExclamationTriangleIcon className="w-12 h-12 text-yellow-400" />;
      case 'confirm':
        return <ExclamationTriangleIcon className="w-12 h-12 text-yellow-400" />;
      case 'info':
      default:
        return <InformationCircleIcon className="w-12 h-12 text-blue-400" />;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case 'success':
        return 'bg-gradient-to-br from-green-500/20 to-green-600/20 border-green-500/30';
      case 'error':
        return 'bg-gradient-to-br from-red-500/20 to-red-600/20 border-red-500/30';
      case 'warning':
        return 'bg-gradient-to-br from-yellow-500/20 to-yellow-600/20 border-yellow-500/30';
      case 'confirm':
        return 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border-yellow-500/30';
      case 'info':
      default:
        return 'bg-gradient-to-br from-blue-500/20 to-blue-600/20 border-blue-500/30';
    }
  };

  if (!isOpen && !isAnimating) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 transition-all duration-300 ${
      isOpen ? 'opacity-100' : 'opacity-0'
    }`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel || onClose}
      />

      {/* Modal */}
      <div className={`relative bg-slate-900/95 backdrop-blur-xl border rounded-2xl shadow-2xl max-w-md w-full transform transition-all duration-300 ${
        isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
      } ${getBgColor()}`}>

        {/* Close button */}
        <button
          onClick={onCancel || onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors p-1"
          aria-label="Close modal"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>

        <div className="p-4 sm:p-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className={`w-20 h-20 rounded-full bg-slate-800/50 flex items-center justify-center ${getBgColor()}`}>
              {getIcon()}
            </div>
          </div>

          {/* Title */}
          <h3 className="text-xl font-bold text-white text-center mb-3">
            {title}
          </h3>

          {/* Message */}
          <p className="text-gray-300 text-center leading-relaxed mb-6">
            {message}
          </p>

          {/* Custom content */}
          {children && (
            <div className="mb-6">
              {children}
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {type === 'confirm' && onCancel && (
              <button
                onClick={onCancel}
                className="px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all"
              >
                {cancelText}
              </button>
            )}

            {onConfirm && (
              <button
                onClick={onConfirm}
                className={`px-6 py-3 font-medium rounded-xl focus:outline-none focus:ring-2 transition-all ${
                  type === 'error'
                    ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
                    : type === 'warning' || type === 'confirm'
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700 focus:ring-yellow-500'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 focus:ring-purple-500'
                }`}
              >
                {confirmText}
              </button>
            )}

            {!onConfirm && !onCancel && (
              <button
                onClick={onClose}
                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
              >
                OK
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationModal;
