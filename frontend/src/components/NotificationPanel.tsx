import { useNotificationContext } from '../contexts/NotificationContext';
import { XMarkIcon, CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon, XCircleIcon, BellIcon } from '@heroicons/react/24/outline';

interface NotificationPanelProps {
  onClose: () => void;
}

function formatTimestamp(timestamp: string | number): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

export default function NotificationPanel({ onClose }: NotificationPanelProps) {
  const { notifications, markAsRead, markAllAsRead } = useNotificationContext();

  const getIcon = (type: string) => {
    switch (type) {
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

  const getBgColor = (type: string) => {
    switch (type) {
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
    <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg max-h-[400px] flex flex-col animate-fade-in overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/50">
        <h3 className="text-lg font-semibold text-white">Notifications</h3>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && notifications.some(n => !n.read) && (
            <button
              onClick={markAllAsRead}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors px-2 py-1"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
            aria-label="Close notifications"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 bg-black/50">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <BellIcon className="w-12 h-12 text-gray-500 mb-3" />
            <p className="text-sm font-medium text-gray-300">No notifications</p>
            <p className="text-xs text-gray-500 mt-1 opacity-70">You're all caught up</p>
          </div>
        ) : (
          <div className="p-2 bg-black/50">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                onClick={() => !notification.read && markAsRead(notification.id)}
                className={`mb-2 p-3 rounded-lg border cursor-pointer transition-all ${
                  notification.read
                    ? 'bg-slate-900/70 border-gray-700/30 opacity-70'
                    : getBgColor(notification.type)
                } hover:opacity-100`}
              >
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {getIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <h4 className={`text-sm font-semibold ${
                        notification.read ? 'text-gray-400' : 'text-white'
                      }`}>
                        {notification.title}
                      </h4>
                      {!notification.read && (
                        <span className="flex-shrink-0 w-2 h-2 bg-purple-500 rounded-full ml-2 mt-1 animate-pulse"></span>
                      )}
                    </div>
                    <p className={`text-xs mt-1 ${
                      notification.read ? 'text-gray-500' : 'text-gray-300'
                    }`}>
                      {notification.message}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      {formatTimestamp(notification.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

