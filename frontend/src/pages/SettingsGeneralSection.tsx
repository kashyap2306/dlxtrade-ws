import React from 'react';
import { SettingsCard, SettingsInput, ToggleSwitch } from './SettingsUtils';

interface SettingsGeneralSectionProps {
  settings: {
    maxPositionPerTrade: number;
    maxDailyLoss: number;
    maxTradesPerDay: number;
    tradeType: string;
    tradeConfirmationRequired: boolean;
  };
  setSettings: (settings: any) => void;
  savingSettings: boolean;
  handleToggleTradeConfirmation: (checked: boolean) => void;
  handleSaveGeneralSettings: () => void;
}

export const SettingsGeneralSection: React.FC<SettingsGeneralSectionProps> = ({
  settings,
  setSettings,
  savingSettings,
  handleToggleTradeConfirmation,
  handleSaveGeneralSettings,
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
          <SettingsInput
            type="number"
            min="1"
            max="100"
            value={settings.maxPositionPerTrade}
            onChange={(e) => setSettings({ ...settings, maxPositionPerTrade: Math.max(1, Math.min(100, parseInt(e.target.value))) })}
            placeholder="e.g., 10"
          />
          <p className="text-xs text-gray-400">The maximum percentage of your total portfolio value allowed for a single trade.</p>
        </div>

        {/* Max Daily Loss */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Max Daily Loss %
          </label>
          <SettingsInput
            type="number"
            min="1"
            max="100"
            value={settings.maxDailyLoss}
            onChange={(e) => setSettings({ ...settings, maxDailyLoss: Math.max(1, Math.min(100, parseInt(e.target.value))) })}
            placeholder="e.g., 5"
          />
          <p className="text-xs text-gray-400">If total daily loss exceeds this, the engine will stop trading for the day.</p>
        </div>

        {/* Max Trades Per Day */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Max Trades Per Day
          </label>
          <SettingsInput
            type="number"
            min="1"
            value={settings.maxTradesPerDay}
            onChange={(e) => setSettings({ ...settings, maxTradesPerDay: Math.max(1, parseInt(e.target.value)) })}
            placeholder="e.g., 50"
          />
          <p className="text-xs text-gray-400">Limit the number of trades executed in a 24-hour period.</p>
        </div>

        {/* Trade Type */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-200">
            Preferred Trade Type
          </label>
          <select
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10 appearance-none"
            value={settings.tradeType}
            onChange={(e) => setSettings({ ...settings, tradeType: e.target.value })}
          >
            <option value="scalping" className="bg-slate-900">Scalping (Fast)</option>
            <option value="swing" className="bg-slate-900">Swing (Medium)</option>
            <option value="long-term" className="bg-slate-900">Long-Term (Slow)</option>
          </select>
          <p className="text-xs text-gray-400">Adjusts the engine's sensitivity and holding periods.</p>
        </div>

        {/* Trade Confirmation Required */}
        <div className="flex items-center justify-between col-span-1 md:col-span-2 p-4 bg-slate-800/50 rounded-xl border border-white/10">
          <div>
            <h3 className="text-lg font-semibold text-white">Trade Confirmation Required</h3>
            <p className="text-sm text-gray-400">Require manual confirmation for every trade suggested by the engine.</p>
          </div>
          <ToggleSwitch
            id="trade-confirmation-toggle"
            checked={settings.tradeConfirmationRequired}
            onChange={handleToggleTradeConfirmation}
            ariaLabel="Toggle trade confirmation requirement"
          />
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
