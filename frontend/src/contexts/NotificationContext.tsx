import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string | number;
  type: 'success' | 'error' | 'info' | 'warning' | 'autoTrade' | 'accuracy' | 'whale' | 'confirmTrade';
  read: boolean;
  data?: any; // Additional data for specific notification types
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
  // Specialized notification methods
  notifyAutoTrade: (coin: string, accuracy: number) => Promise<void>;
  notifyHighAccuracy: (coin: string, accuracy: number) => Promise<void>;
  notifyWhaleAlert: (coin: string, type: 'buy' | 'sell', amount: number) => Promise<void>;
  notifyTradeConfirmation: (coin: string, accuracy: number, tradeData?: any) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastNotificationIdsRef = useRef<Set<string>>(new Set());

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }

    try {
      setLoading(true);
      const response = await api.get('/notifications', { params: { limit: 50 } });
      // Handle both response formats: { notifications, unreadCount } or array
      const fetchedNotifications = Array.isArray(response.data)
        ? response.data
        : (response.data?.notifications || []);

      // Check for new notifications
      const currentIds = new Set(fetchedNotifications.map((n: Notification) => n.id));
      const newNotifications = fetchedNotifications.filter(
        (n: Notification) => !lastNotificationIdsRef.current.has(n.id)
      );

      // Update last known IDs
      lastNotificationIdsRef.current = currentIds;

      // Update notifications
      setNotifications(fetchedNotifications);

      // Check if we just logged in (to prevent showing login success on refresh)
      const justLoggedIn = sessionStorage.getItem('justLoggedIn') === 'true';

      // Clear the flag after first use
      if (justLoggedIn) {
        sessionStorage.removeItem('justLoggedIn');
      }

      // Trigger toast for new notifications (only unread ones)
      // Skip login success notifications if we didn't just log in
      newNotifications
        .filter((n: Notification) => {
          if (!n.read) {
            // If it's a login success notification and we didn't just log in, skip it
            if (n.title === 'Login Success' && !justLoggedIn) {
              // Mark it as read to prevent future toasts
              markAsRead(n.id).catch(() => {});
              return false;
            }
            return true;
          }
          return false;
        })
        .forEach((notification: Notification) => {
          // Dispatch custom event for toast
          window.dispatchEvent(
            new CustomEvent('newNotification', { detail: notification })
          );
        });
    } catch (err: any) {
      // Silent fail - don't show errors for notification loading
      console.debug('Error loading notifications:', err);

      // If we get persistent errors, reduce polling frequency or stop polling
      // This prevents spamming the logs with notification errors
      if (err.response?.status === 401 || err.response?.status === 403) {
        // Auth issues - stop polling
        console.warn('Notification polling stopped due to auth issues');
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadNotifications();
      // Poll every 10 seconds
      pollingIntervalRef.current = setInterval(loadNotifications, 10000);
    } else {
      setNotifications([]);
      lastNotificationIdsRef.current.clear();
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [user, loadNotifications]);

  const addNotification = useCallback(async (
    notification: Omit<Notification, 'id' | 'timestamp' | 'read'>
  ) => {
    if (!user) return;

    try {
      const response = await api.post('/notifications/push', {
        uid: user.uid,
        ...notification,
        timestamp: Date.now(),
      });

      // Add to local state immediately for instant feedback
      const newNotification: Notification = {
        id: response.data?.id || `temp-${Date.now()}`,
        ...notification,
        timestamp: Date.now(),
        read: false,
      };

      setNotifications((prev) => [newNotification, ...prev].slice(0, 50));
      lastNotificationIdsRef.current.add(newNotification.id);

      // Trigger toast
      window.dispatchEvent(
        new CustomEvent('newNotification', { detail: newNotification })
      );

      // Refresh from server to get the real notification
      setTimeout(() => loadNotifications(), 500);
    } catch (err: any) {
      console.error('Error adding notification:', err);
      // Still add locally for UX
      const tempNotification: Notification = {
        id: `temp-${Date.now()}`,
        ...notification,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications((prev) => [tempNotification, ...prev].slice(0, 50));
    }
  }, [user, loadNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await api.post('/notifications/mark-read', { notificationId: id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err: any) {
      // Optimistic update even if API fails
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err: any) {
      // Optimistic update
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }, []);

  // Memoize unreadCount to prevent unnecessary recalculations
  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  // Specialized notification methods
  const notifyAutoTrade = useCallback(async (coin: string, accuracy: number) => {
    await addNotification({
      title: 'Auto-Trade Triggered',
      message: `Auto-Trade triggered for ${coin} with ${accuracy.toFixed(1)}% accuracy`,
      type: 'autoTrade',
      data: { coin, accuracy, timestamp: Date.now() }
    });
  }, [addNotification]);

  const notifyHighAccuracy = useCallback(async (coin: string, accuracy: number) => {
    await addNotification({
      title: 'High Accuracy Alert',
      message: `High accuracy detected: ${accuracy.toFixed(1)}% for ${coin}`,
      type: 'accuracy',
      data: { coin, accuracy, timestamp: Date.now() }
    });
  }, [addNotification]);

  const notifyWhaleAlert = useCallback(async (coin: string, type: 'buy' | 'sell', amount: number) => {
    await addNotification({
      title: 'Whale Movement Alert',
      message: `Whale Alert: Large ${type} detected on ${coin} (${amount.toLocaleString()} USD)`,
      type: 'whale',
      data: { coin, type, amount, timestamp: Date.now() }
    });
  }, [addNotification]);

  const notifyTradeConfirmation = useCallback(async (coin: string, accuracy: number, tradeData?: any) => {
    await addNotification({
      title: 'Trade Confirmation Required',
      message: `Trade confirmation needed for ${coin} with ${accuracy.toFixed(1)}% accuracy`,
      type: 'confirmTrade',
      data: { coin, accuracy, tradeData, timestamp: Date.now() }
    });
  }, [addNotification]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      addNotification,
      markAsRead,
      markAllAsRead,
      refresh: loadNotifications,
      notifyAutoTrade,
      notifyHighAccuracy,
      notifyWhaleAlert,
      notifyTradeConfirmation,
    }),
    [notifications, unreadCount, loading, addNotification, markAsRead, markAllAsRead, loadNotifications, notifyAutoTrade, notifyHighAccuracy, notifyWhaleAlert, notifyTradeConfirmation]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotificationContext must be used within a NotificationProvider');
  }
  return context;
}

