import React from 'react';
import { SettingsCard, SettingsInput, ToggleSwitch } from './SettingsUtils';

interface SettingsGeneralSectionProps {
  settings: {
    maxPositionPerTrade: number;
    maxDailyLoss: number;
    maxTradesPerDay: number;

    tradeConfirmationRequired: boolean;
    notifications?: {
      autoTradeAlerts: boolean;
      accuracyAlerts: {
        enabled: boolean;
        thresholdMin?: number;
        thresholdMax?: number;
        threshold?: number;
      };
      whaleAlerts: { enabled: boolean };
      soundEnabled: boolean;
      vibrateEnabled: boolean;
    };
  };
  setSettings: (settings: any) => void;
  savingSettings: boolean;
  autoTradeEnabled: boolean;
  handleToggleTradeConfirmation: (checked: boolean) => void;
  handleSaveGeneralSettings: () => void;
  handleNotificationToggle?: (type: string, checked: boolean) => void;
}

export const SettingsGeneralSection: React.FC<SettingsGeneralSectionProps> = ({
  settings,
  setSettings,
  savingSettings,
  autoTradeEnabled,
  handleToggleTradeConfirmation,
  handleSaveGeneralSettings,
  handleNotificationToggle,
}) => {
  return (
    <section id="general-settings" className="mb-12">
      <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
        ⚙️ General Trading Configuration
      </h2>
      <SettingsCard className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Max Position Per Trade */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Max Position % of Portfolio
          </label>
          <select
            value={settings.maxPositionPerTrade ?? ''}
            onChange={(e) => setSettings({ ...settings, maxPositionPerTrade: e.target.value ? parseInt(e.target.value) : undefined })}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all duration-300"
          >
            <option value="">Default (10%)</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                {num}%
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400">The maximum percentage of your total portfolio value allowed for a single trade.</p>
        </div>

        {/* Max Daily Loss */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Max Daily Loss %
          </label>
          <select
            value={settings.maxDailyLoss || 7}
            onChange={(e) => setSettings({ ...settings, maxDailyLoss: parseInt(e.target.value) })}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all duration-300"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                {num}%
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400">If total daily loss exceeds this, the engine will stop trading for the day.</p>
        </div>

        {/* Max Trades Per Day */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Max Trades Per Day
          </label>
          <select
            value={settings.maxTradesPerDay || 30}
            onChange={(e) => setSettings({ ...settings, maxTradesPerDay: parseInt(e.target.value) })}
            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all duration-300"
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                {num}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400">Limit the number of trades executed in a 24-hour period (Max 30).</p>
        </div>



        {/* Trade Confirmation Required */}
        <div className={`flex items-center justify-between col-span-1 md:col-span-2 p-4 rounded-xl border transition-all duration-300 ${autoTradeEnabled
          ? 'bg-slate-800/50 border-white/10'
          : 'bg-slate-900/40 border-red-500/20 opacity-80'
          }`}>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Trade Confirmation Required</h3>
              {!autoTradeEnabled && (
                <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 uppercase font-bold tracking-wider">
                  Enable Auto Trade first
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">Require manual confirmation for every trade suggested by the engine.</p>
          </div>
          <ToggleSwitch
            id="trade-confirmation-toggle"
            checked={settings.tradeConfirmationRequired && autoTradeEnabled}
            disabled={!autoTradeEnabled || autoTradeEnabled === undefined || autoTradeEnabled === null}
            onChange={handleToggleTradeConfirmation}
            ariaLabel="Toggle trade confirmation requirement"
          />
        </div>

        {/* Notification Settings */}
        <div className="md:col-span-2 space-y-4">
          <h3 className="text-lg font-semibold text-white border-b border-white/10 pb-2">Notification Settings</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Auto Trade Alerts */}
            <div className={`flex items-center justify-between p-3 rounded-lg border transition-all duration-300 ${autoTradeEnabled
              ? 'bg-slate-800/50 border-white/10'
              : 'bg-slate-900/40 border-red-500/20 opacity-80'
              }`}>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-white">Auto Trade Alerts</h4>
                  {!autoTradeEnabled && (
                    <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full border border-red-500/30 uppercase font-bold tracking-wider">
                      Enable Auto Trade first
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">Trigger on automatic executions</p>
              </div>
              <ToggleSwitch
                id="auto-trade-alerts-toggle"
                checked={Boolean(settings.notifications?.autoTradeAlerts && autoTradeEnabled)}
                disabled={!autoTradeEnabled || autoTradeEnabled === undefined || autoTradeEnabled === null}
                onChange={(checked) => handleNotificationToggle?.('autoTradeAlerts', checked)}
                ariaLabel="Toggle auto trade alerts"
              />
            </div>

            {/* Accuracy Alerts */}
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-white/10">
              <div>
                <h4 className="text-sm font-medium text-white">Accuracy Alerts</h4>
                <p className="text-xs text-gray-400">
                  {settings.notifications?.accuracyAlerts?.enabled
                    ? `Threshold: ${settings.notifications.accuracyAlerts.thresholdMin || settings.notifications.accuracyAlerts.threshold || 'N/A'}% - ${settings.notifications.accuracyAlerts.thresholdMax || settings.notifications.accuracyAlerts.threshold || 'N/A'}%`
                    : 'Trigger when accuracy reaches threshold range'}
                </p>
              </div>
              <ToggleSwitch
                id="accuracy-alerts-toggle"
                checked={settings.notifications?.accuracyAlerts?.enabled || false}
                onChange={(checked) => handleNotificationToggle?.('accuracyAlerts', checked)}
                ariaLabel="Toggle accuracy alerts"
              />
            </div>

            {/* Whale Alerts */}
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-white/10">
              <div>
                <h4 className="text-sm font-medium text-white">Whale Alerts</h4>
                <p className="text-xs text-gray-400">Trigger on &gt;2.5% candle move or volume spike</p>
              </div>
              <ToggleSwitch
                id="whale-alerts-toggle"
                checked={settings.notifications?.whaleAlerts?.enabled || false}
                onChange={(checked) => handleNotificationToggle?.('whaleAlerts', checked)}
                ariaLabel="Toggle whale alerts"
              />
            </div>

            {/* Sound Notifications */}
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-white/10">
              <div>
                <h4 className="text-sm font-medium text-white">Sound Notifications</h4>
                <p className="text-xs text-gray-400">Play sound for notifications</p>
              </div>
              <ToggleSwitch
                id="sound-notifications-toggle"
                checked={settings.notifications?.soundEnabled || false}
                onChange={(checked) => handleNotificationToggle?.('soundEnabled', checked)}
                ariaLabel="Toggle sound notifications"
              />
            </div>

            {/* Vibration */}
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg border border-white/10 md:col-span-2">
              <div>
                <h4 className="text-sm font-medium text-white">Vibration</h4>
                <p className="text-xs text-gray-400">Vibrate device for notifications</p>
              </div>
              <ToggleSwitch
                id="vibration-toggle"
                checked={settings.notifications?.vibrateEnabled || false}
                onChange={(checked) => handleNotificationToggle?.('vibrateEnabled', checked)}
                ariaLabel="Toggle vibration notifications"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="md:col-span-2 flex justify-end pt-4 border-t border-white/10">
          <button
            onClick={handleSaveGeneralSettings}
            disabled={savingSettings}
            className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
          >
            {savingSettings ? 'Saving...' : 'Save General Settings'}
          </button>
        </div>
      </SettingsCard>
    </section>
  );
};
