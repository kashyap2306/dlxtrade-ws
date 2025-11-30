import { useEffect, useState } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Notification } from '../contexts/NotificationContext';

export default function NotificationToast() {
  const [toast, setToast] = useState<Notification | null>(null);

  useEffect(() => {
    const handleNewNotification = (event: CustomEvent<Notification>) => {
      setToast(event.detail);
      // Auto-hide after 3 seconds
      setTimeout(() => setToast(null), 3000);
    };

    window.addEventListener('newNotification', handleNewNotification as EventListener);

    return () => {
      window.removeEventListener('newNotification', handleNewNotification as EventListener);
    };
  }, []);

  if (!toast) return null;

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircleIcon className="w-5 h-5 text-green-400" />;
      case 'warning':
        return <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" />;
      case 'error':
        return <XCircleIcon className="w-5 h-5 text-red-400" />;
      case 'info':
      default:
        return <InformationCircleIcon className="w-5 h-5 text-blue-400" />;
    }
  };

  const getBgColor = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-green-500/10 border-green-500/30';
      case 'warning':
        return 'bg-yellow-500/10 border-yellow-500/30';
      case 'error':
        return 'bg-red-500/10 border-red-500/30';
      case 'info':
      default:
        return 'bg-blue-500/10 border-blue-500/30';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-slide-up">
      <div
        className={`
          ${getBgColor()}
          border rounded-lg shadow-2xl p-4 min-w-[300px] max-w-[400px]
          backdrop-blur-xl
        `}
      >
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0 mt-0.5">
            {getIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-white mb-1">
              {toast.title}
            </h4>
            <p className="text-xs text-gray-300">
              {toast.message}
            </p>
          </div>
          <button
            onClick={() => setToast(null)}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

