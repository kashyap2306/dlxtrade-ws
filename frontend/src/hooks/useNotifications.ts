import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import api from '../services/api';

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'success' | 'warning' | 'error' | 'info';
  read: boolean;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRef, setLoadingRef] = useState(false); // Prevent duplicate calls

  useEffect(() => {
    if (user) {
      loadNotifications();
      // Poll for new notifications every 30 seconds
      const interval = setInterval(loadNotifications, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadNotifications = async () => {
    if (!user || loadingRef) return; // Prevent duplicate calls

    try {
      setLoadingRef(true);
      setLoading(true);
      const response = await api.get('/api/notifications', { params: { limit: 50 } });
      setNotifications(response.data || []);
    } catch (err: any) {
      // Silent fail - don't show errors for notification loading
    } finally {
      setLoading(false);
      setLoadingRef(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch (err: any) {
      // Silent fail
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.post('/api/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err: any) {
      // Silent fail
    }
  };

  const addNotification = async (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    try {
      const response = await api.post('/api/notifications', notification);
      setNotifications((prev) => [response.data, ...prev].slice(0, 50));
    } catch (err: any) {
      // Silent fail
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    addNotification,
    refresh: loadNotifications,
  };
}

