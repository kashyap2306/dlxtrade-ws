import React, { useState, useEffect } from 'react';
import { settingsApi } from '../services/api';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

interface NotificationDiagnosticsProps {
  config?: {
    autoTradeEnabled?: boolean;
  };
}

export const NotificationDiagnosticsSection: React.FC<NotificationDiagnosticsProps> = ({ config }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [notificationSettings, setNotificationSettings] = useState<{
    autoTradeAlerts: boolean;
    soundEnabled: boolean;
    vibrateEnabled: boolean;
  }>({
    autoTradeAlerts: false,
    soundEnabled: false,
    vibrateEnabled: false
  });
  const [lastAlertTime, setLastAlertTime] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await settingsApi.notifications.load();
        const data = response.data || {};
        setNotificationSettings({
          autoTradeAlerts: data.autoTradeAlerts || false,
          soundEnabled: data.soundEnabled || localStorage.getItem('notificationSounds') === 'true',
          vibrateEnabled: data.vibrateEnabled || localStorage.getItem('notificationVibration') === 'true'
        });
      } catch (err) {
        // Fallback to localStorage
        setNotificationSettings({
          autoTradeAlerts: false,
          soundEnabled: localStorage.getItem('notificationSounds') === 'true',
          vibrateEnabled: localStorage.getItem('notificationVibration') === 'true'
        });
      }
    };
    loadSettings();

    // Listen for notification events to track last alert time
    const handleNotification = () => {
      setLastAlertTime(new Date().toLocaleTimeString());
    };
    window.addEventListener('showBanner', handleNotification);
    window.addEventListener('showToast', handleNotification);

    return () => {
      window.removeEventListener('showBanner', handleNotification);
      window.removeEventListener('showToast', handleNotification);
    };
  }, []);

  return (
    <div className="bg-[#0a0f1a] backdrop-blur-sm border border-purple-500/20 rounded-xl p-6 mb-8 shadow-lg">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between text-left"
      >
        <h2 className="text-xl font-semibold text-purple-200">Notification Settings</h2>
        {isCollapsed ? (
          <ChevronDownIcon className="w-5 h-5 text-purple-400" />
        ) : (
          <ChevronUpIcon className="w-5 h-5 text-purple-400" />
        )}
      </button>

      {!isCollapsed && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-purple-100">Auto Trade Alerts</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              notificationSettings.autoTradeAlerts && config?.autoTradeEnabled
                ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                : 'bg-red-600/40 text-red-300 border border-red-500/30'
            }`}>
              {notificationSettings.autoTradeAlerts && config?.autoTradeEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-purple-100">Sound Notifications</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              notificationSettings.soundEnabled
                ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                : 'bg-red-600/40 text-red-300 border border-red-500/30'
            }`}>
              {notificationSettings.soundEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-purple-100">Vibration</span>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              notificationSettings.vibrateEnabled
                ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                : 'bg-red-600/40 text-red-300 border border-red-500/30'
            }`}>
              {notificationSettings.vibrateEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          {lastAlertTime && (
            <div className="flex items-center justify-between pt-2 border-t border-purple-500/20">
              <span className="text-purple-100 text-sm">Last Alert</span>
              <span className="text-purple-300 text-sm">{lastAlertTime}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

