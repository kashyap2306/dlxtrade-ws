import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string | number;
  type: 'success' | 'error' | 'info' | 'warning';
  read: boolean;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refresh: () => Promise<void>;
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

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        addNotification,
        markAsRead,
        markAllAsRead,
        refresh: loadNotifications,
      }}
    >
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

