import React, { useState, useEffect, useCallback } from 'react';
import { useNotificationContext } from '../contexts/NotificationContext';
import { wsService } from '../services/ws';
import { settingsApi } from '../services/api';
import { playNotificationSound, triggerVibration, isVibrationEnabled } from '../utils/soundNotification';
import { useAuth } from '../hooks/useAuth';
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
  const { user, loading: authLoading } = useAuth();
  const [activeNotifications, setActiveNotifications] = useState<any[]>([]);
  const [notificationSettings, setNotificationSettings] = useState<{
    soundEnabled: boolean;
    vibrationEnabled: boolean;
    autoTradeAlerts: boolean;
  }>({
    soundEnabled: false,
    vibrationEnabled: false,
    autoTradeAlerts: false
  });
  const [tradeConfirmation, setTradeConfirmation] = useState<{
    isOpen: boolean;
    coin: string;
    side: 'buy' | 'sell';
    entryPrice: number;
    stopLoss: number;
    takeProfit?: number;
    accuracy: number;
    requestId: string;
  } | null>(null);

  // Load notification settings from backend ONLY when auth is ready
  useEffect(() => {
    // Skip API call if auth is still loading or no user
    if (authLoading || !user) {
      console.log('[NotificationManager] Skipping notification settings load - auth not ready:', {
        authLoading,
        hasUser: !!user
      });
      return;
    }

    const loadNotificationSettings = async () => {
      try {
        console.log('[NotificationManager] Loading notification settings from backend...');
        const response = await settingsApi.notifications.load();
        const data = response.data || {};
        const newSettings = {
          soundEnabled: data.soundEnabled || localStorage.getItem('notificationSounds') === 'true',
          vibrationEnabled: data.vibrateEnabled || localStorage.getItem('notificationVibration') === 'true',
          autoTradeAlerts: data.autoTradeAlerts || false
        };
        setNotificationSettings(newSettings);
        console.log('[NotificationManager] Notification settings loaded successfully');
      } catch (err) {
        console.warn('[NotificationManager] Backend notification settings failed, using localStorage fallback:', err);
        // Fallback to localStorage if backend fails
        setNotificationSettings({
          soundEnabled: localStorage.getItem('notificationSounds') === 'true',
          vibrationEnabled: localStorage.getItem('notificationVibration') === 'true',
          autoTradeAlerts: false
        });
      }
    };

    loadNotificationSettings();

    // Listen for real-time updates from Settings page
    const handleSettingsUpdate = (e: CustomEvent) => {
      console.log('[NotificationManager] Settings updated, reloading...', e.detail);
      if (e.detail) {
        setNotificationSettings(prev => ({
          ...prev,
          ...e.detail
        }));
      } else {
        loadNotificationSettings();
      }
    };

    window.addEventListener('settingsUpdated', handleSettingsUpdate as EventListener);
    return () => {
      window.removeEventListener('settingsUpdated', handleSettingsUpdate as EventListener);
    };
  }, [authLoading, user]); // Depend on auth state to trigger when auth becomes ready

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
    // Use backend settings (unified source of truth) with localStorage fallback
    const soundEnabled = notificationSettings.soundEnabled;
    const vibrationEnabled = notificationSettings.vibrationEnabled;

    // Trigger sound and vibration for specific notification types
    const triggerSoundAndVibration = (notificationType: string) => {
      if (soundEnabled) {
        playNotificationSound(notificationType).catch(() => {
          // Silently fail if sound is blocked
        });
      }
      if (vibrationEnabled && 'vibrate' in navigator) {
        triggerVibration([200, 100, 200]);
      }
    };

    switch (notification.type) {
      case 'autoTrade':
        // CRITICAL: Only show if autoTradeAlerts is enabled
        if (!notificationSettings.autoTradeAlerts) {
          return; // Don't show alert if disabled
        }
        // Show as banner (high priority) - Banner handles sound/vibration
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
        // Show trade confirmation modal with detailed data

        const alertData = notification.data || {};
        setTradeConfirmation({
          isOpen: true,
          coin: alertData.coin || notification.coin || 'Unknown',
          side: alertData.side || notification.side || 'buy',
          entryPrice: alertData.entryPrice || alertData.entry || notification.entryPrice || 0,
          stopLoss: alertData.stopLoss || alertData.sl || notification.stopLoss || 0,
          takeProfit: alertData.takeProfit || alertData.tp || notification.takeProfit,
          accuracy: alertData.accuracy || notification.accuracy || 0,
          requestId: alertData.requestId || notification.requestId || `req-${Date.now()}`
        });
        // Also show a banner notification
        showBanner({
          ...notification,
          title: 'Trade Confirmation Required',
          message: `Action Required: Confirm your ${alertData.side?.toUpperCase() || 'NEW'} trade for ${alertData.coin || 'Unknown'}`,
          soundEnabled,
          vibrationEnabled
        });
        break;

      default:
        // Show as toast for other types
        showToast({ ...notification, soundEnabled, vibrationEnabled });
    }
  }, [notificationSettings]);

  const showToast = useCallback((notification: any) => {
    // Implementation handled by NotificationToast component listening to events
    window.dispatchEvent(
      new CustomEvent('showToast', {
        detail: {
          ...notification,
          soundEnabled: notificationSettings.soundEnabled,
          vibrationEnabled: notificationSettings.vibrationEnabled
        }
      })
    );
  }, [notificationSettings]);

  const showBanner = useCallback((notification: any) => {
    window.dispatchEvent(
      new CustomEvent('showBanner', {
        detail: {
          ...notification,
          soundEnabled: notificationSettings.soundEnabled,
          vibrationEnabled: notificationSettings.vibrationEnabled
        }
      })
    );
  }, [notificationSettings]);

  const handleTradeConfirm = useCallback(async (tradeData: any) => {
    try {
      // Execute trade via API approve
      console.log('Confirming and executing trade:', tradeData);
      const response = await autoTradeApi.approveTrade(tradeData.requestId);

      if (response.data?.success) {
        // Show success notification
        window.dispatchEvent(
          new CustomEvent('showToast', {
            detail: {
              title: 'Trade Executed',
              message: `Successfully executed ${tradeData.side} trade for ${tradeData.symbol}`,
              type: 'success',
              duration: 5000,
              soundEnabled,
              vibrationEnabled
            }
          })
        );
      } else {
        throw new Error(response.data?.error || 'Failed to execute trade');
      }
    } catch (error: any) {
      console.error('Error executing trade:', error);
      window.dispatchEvent(
        new CustomEvent('showToast', {
          detail: {
            title: 'Trade Failed',
            message: `Execution failed: ${error.message}`,
            type: 'error',
            duration: 7000,
            soundEnabled,
            vibrationEnabled
          }
        })
      );
    } finally {
      // Close modal
      setTradeConfirmation(null);
    }
  }, [soundEnabled, vibrationEnabled]);

  const handleTradeCancel = useCallback(async () => {
    if (tradeConfirmation?.requestId) {
      try {
        await autoTradeApi.rejectTrade(tradeConfirmation.requestId);
      } catch (e) {
        console.error('Failed to reject trade on backend:', e);
      }
    }
    setTradeConfirmation(null);
  }, [tradeConfirmation]);

  return (
    <>
      {/* Trade Confirmation Modal */}
      {tradeConfirmation && (
        <TradeConfirmationModal
          isOpen={tradeConfirmation.isOpen}
          coin={tradeConfirmation.coin}
          side={tradeConfirmation.side}
          entryPrice={tradeConfirmation.entryPrice}
          stopLoss={tradeConfirmation.stopLoss}
          takeProfit={tradeConfirmation.takeProfit}
          accuracy={tradeConfirmation.accuracy}
          requestId={tradeConfirmation.requestId}
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
