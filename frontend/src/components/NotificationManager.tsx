import React, { useState, useEffect, useCallback } from 'react';
import { useNotificationContext } from '../contexts/NotificationContext';
import { wsService } from '../services/ws';
import NotificationToast from './NotificationToast';
import NotificationBanner from './NotificationBanner';
import NotificationModal from './NotificationModal';
import TradeConfirmationModal from './TradeConfirmationModal';

interface NotificationManagerProps {
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}

const NotificationManager: React.FC<NotificationManagerProps> = ({
  soundEnabled = false,
  vibrationEnabled = false
}) => {
  const { notifications } = useNotificationContext();
  const [activeNotifications, setActiveNotifications] = useState<any[]>([]);
  const [tradeConfirmation, setTradeConfirmation] = useState<{
    isOpen: boolean;
    coin: string;
    accuracy: number;
  } | null>(null);

  // Handle WebSocket newAlert messages
  useEffect(() => {
    const unsubscribe = wsService.subscribe('newAlert', (data) => {
      const alert = data.alert;
      if (alert) {
        console.log('Received WebSocket alert:', alert);
        handleNotification({
          id: `ws-${Date.now()}-${Math.random()}`,
          title: alert.title,
          message: alert.message,
          type: alert.type,
          timestamp: data.timestamp,
          data: alert.data,
          read: false
        });
      }
    });

    return unsubscribe;
  }, []);

  // Handle new notifications
  useEffect(() => {
    const newNotifications = notifications.filter(n => !n.read);

    // Process each new notification
    newNotifications.forEach(notification => {
      if (!activeNotifications.find(an => an.id === notification.id)) {
        handleNotification(notification);
      }
    });

    // Update active notifications
    setActiveNotifications(prev => {
      const updated = [...prev];
      newNotifications.forEach(notification => {
        if (!updated.find(an => an.id === notification.id)) {
          updated.push(notification);
        }
      });
      return updated;
    });
  }, [notifications]);

  const handleNotification = useCallback((notification: any) => {
    // Get user preferences from localStorage (set via Settings page)
    const soundEnabled = localStorage.getItem('notificationSounds') === 'true';
    const vibrationEnabled = localStorage.getItem('notificationVibration') === 'true';

    switch (notification.type) {
      case 'autoTrade':
        // Show as banner (high priority)
        showBanner({ ...notification, soundEnabled, vibrationEnabled });
        break;

      case 'accuracy':
        // Show as toast (medium priority)
        showToast({ ...notification, soundEnabled, vibrationEnabled });
        break;

      case 'whale':
        // Show as banner (high priority)
        showBanner({ ...notification, soundEnabled, vibrationEnabled });
        break;

      case 'confirmTrade':
        // Show trade confirmation modal
        setTradeConfirmation({
          isOpen: true,
          coin: notification.data?.coin || 'Unknown',
          accuracy: notification.data?.accuracy || 0
        });
        // Also show a banner notification
        showBanner({
          ...notification,
          title: 'Trade Confirmation Required',
          message: `Please confirm trade for ${notification.data?.coin || 'Unknown'}`,
          soundEnabled,
          vibrationEnabled
        });
        break;

      default:
        // Show as toast for other types
        showToast({ ...notification, soundEnabled, vibrationEnabled });
    }
  }, []);

  const showToast = useCallback((notification: any) => {
    // Implementation handled by NotificationToast component listening to events
    window.dispatchEvent(
      new CustomEvent('showToast', {
        detail: {
          ...notification,
          soundEnabled,
          vibrationEnabled
        }
      })
    );
  }, [soundEnabled, vibrationEnabled]);

  const showBanner = useCallback((notification: any) => {
    window.dispatchEvent(
      new CustomEvent('showBanner', {
        detail: {
          ...notification,
          soundEnabled,
          vibrationEnabled
        }
      })
    );
  }, [soundEnabled, vibrationEnabled]);

  const handleTradeConfirm = useCallback(async (tradeData: any) => {
    // Execute trade logic here
    console.log('Executing trade:', tradeData);

    // Close modal
    setTradeConfirmation(null);

    // Show success notification
    window.dispatchEvent(
      new CustomEvent('showToast', {
        detail: {
          title: 'Trade Executed',
          message: `Successfully executed trade for ${tradeConfirmation?.coin}`,
          type: 'success',
          soundEnabled,
          vibrationEnabled
        }
      })
    );
  }, [tradeConfirmation, soundEnabled, vibrationEnabled]);

  const handleTradeCancel = useCallback(() => {
    setTradeConfirmation(null);
  }, []);

  return (
    <>
      {/* Trade Confirmation Modal */}
      {tradeConfirmation && (
        <TradeConfirmationModal
          isOpen={tradeConfirmation.isOpen}
          coin={tradeConfirmation.coin}
          accuracy={tradeConfirmation.accuracy}
          onConfirm={handleTradeConfirm}
          onCancel={handleTradeCancel}
          soundEnabled={soundEnabled}
        />
      )}

      {/* Global Toast Container */}
      <ToastContainer />

      {/* Global Banner Container */}
      <BannerContainer />
    </>
  );
};

// Toast Container Component
function ToastContainer() {
  const [toasts, setToasts] = useState<any[]>([]);

  useEffect(() => {
    const handleShowToast = (event: CustomEvent) => {
      const newToast = {
        id: Date.now(),
        ...event.detail
      };

      setToasts(prev => [...prev, newToast]);

      // Auto-remove after duration
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== newToast.id));
      }, event.detail.duration || 5000);
    };

    window.addEventListener('showToast', handleShowToast as EventListener);

    return () => {
      window.removeEventListener('showToast', handleShowToast as EventListener);
    };
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-4">
      {toasts.map((toast) => (
        <NotificationToast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          title={toast.title}
          duration={toast.duration}
          soundEnabled={toast.soundEnabled}
          onClose={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
        />
      ))}
    </div>
  );
}

// Banner Container Component
function BannerContainer() {
  const [banners, setBanners] = useState<any[]>([]);

  useEffect(() => {
    const handleShowBanner = (event: CustomEvent) => {
      const newBanner = {
        id: Date.now(),
        ...event.detail
      };

      setBanners(prev => [...prev, newBanner]);

      // Auto-remove after duration
      setTimeout(() => {
        setBanners(prev => prev.filter(b => b.id !== newBanner.id));
      }, event.detail.duration || 8000);
    };

    window.addEventListener('showBanner', handleShowBanner as EventListener);

    return () => {
      window.removeEventListener('showBanner', handleShowBanner as EventListener);
    };
  }, []);

  return (
    <div className="fixed top-6 left-6 right-6 z-50 space-y-4">
      {banners.map((banner) => (
        <NotificationBanner
          key={banner.id}
          message={banner.message}
          type={banner.type}
          title={banner.title}
          duration={banner.duration}
          soundEnabled={banner.soundEnabled}
          onClose={() => setBanners(prev => prev.filter(b => b.id !== banner.id))}
        />
      ))}
    </div>
  );
}

export default NotificationManager;
