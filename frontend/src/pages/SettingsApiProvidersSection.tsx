import React from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { SettingsCard, SettingsInput, ToggleSwitch, ProviderTestResult } from './SettingsUtils';
import { PROVIDER_CONFIG, API_NAME_MAP as PROVIDER_ID_MAP } from '../constants/providers';
import { settingsApi } from '../services/api';

interface SettingsApiProvidersSectionProps {
  settings: any;
  setSettings: (settings: any) => void;
  showProviderDetails: any;
  setShowProviderDetails: (details: any) => void;
  savingProvider: string | null;
  providerTestResults: any;
  apiKeys: Record<string, { apiKey: string; saved: boolean }>;
  testProviderConnection: (providerName: string, apiKey: string, keyName: string) => void;
  handleProviderKeyChange: (providerName: string, keyName: string, value: string, uid: string, setProviders: (providers: any) => void) => void;
  handleToggleProviderEnabled: (providerName: string, enabledKey: string, checked: boolean) => void;
}

export const SettingsApiProvidersSection: React.FC<SettingsApiProvidersSectionProps> = ({
  settings,
  setSettings,
  showProviderDetails,
  setShowProviderDetails,
  savingProvider,
  providerTestResults,
  apiKeys,
  testProviderConnection,
  handleProviderKeyChange,
  handleToggleProviderEnabled,
}) => {
  return (
    <section id="api-providers" className="mb-12">
      <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
        🔗 API Provider Configuration
      </h2>
      <div className="space-y-8">
        {Object.entries(PROVIDER_CONFIG).map(([groupKey, config]) => (
          <SettingsCard key={groupKey}>
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-10 h-10 ${config.bgColor} rounded-full flex items-center justify-center text-xl`}>
                {config.icon}
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{config.title}</h3>
                <p className="text-sm text-gray-400">{config.description}</p>
              </div>
            </div>

            {/* Primary Provider */}
            <div className="mb-6 p-4 bg-slate-800/30 rounded-xl border border-purple-500/30">
              <h4 className="text-lg font-semibold text-white mb-3 flex items-center justify-between">
                <span>Primary: {config.primary.name}</span>
              </h4>

              {/* Special case for CoinGecko in marketData and metadata groups for free-tier info */}
              {config.primary.name !== 'CoinGecko' ? (
                <div className="space-y-2">
                  <SettingsInput
                    type={settings.showUnmaskedKeys ? 'text' : 'password'}
                    placeholder={config.primary.placeholder}
                    value={apiKeys[PROVIDER_ID_MAP[config.primary.name]]?.apiKey || settings[config.primary.key] || ''}
                    onChange={(e) => setSettings({ ...settings, [config.primary.key]: e.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => testProviderConnection(config.primary.name, settings[config.primary.key], config.primary.key)}
                      disabled={savingProvider === config.primary.name}
                      className="px-3 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                    >
                      {savingProvider === config.primary.name ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => handleProviderKeyChange(config.primary.name, config.primary.key, settings[config.primary.key], '', () => {})}
                      disabled={savingProvider === config.primary.name || !settings[config.primary.key]}
                      className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                    >
                      {savingProvider === config.primary.name ? 'Saving...' : (() => {
                        const providerId = PROVIDER_ID_MAP[config.primary.name];
                        const hasApiKey = apiKeys[providerId]?.saved === true;
                        return hasApiKey ? 'Change API' : 'Enter API Key';
                      })()}
                    </button>
                  </div>
                  <ProviderTestResult result={providerTestResults[config.primary.name]} />
                </div>
              ) : (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-300">
                  CoinGecko is automatically integrated for free tier use.
                </div>
              )}
            </div>

            {/* Backup Providers */}
            <div className="border-t border-white/10 pt-4">
              <button
                onClick={() => setShowProviderDetails(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                className="w-full flex justify-between items-center text-gray-300 hover:text-white transition-all duration-300"
              >
                <span className="font-semibold text-md">
                  Backup Providers ({config.backups.length})
                </span>
                {showProviderDetails[groupKey] ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
              </button>
            </div>

            {showProviderDetails[groupKey] && (
              <div className="mt-4 space-y-4">
                {config.backups.map((backup) => (
                  <div key={backup.name} className="p-3 bg-slate-800/30 rounded-xl border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-200">
                        {backup.name} <span className={`text-xs font-normal ${backup.type === 'api' ? 'text-red-400' : 'text-green-400'}`}>({backup.type === 'api' ? 'API Required' : 'Free'})</span>
                      </span>
                      <ToggleSwitch
                        id={`toggle-${backup.key}`}
                        checked={settings[backup.enabledKey] || false}
                        onChange={(checked) => handleToggleProviderEnabled(backup.name, backup.enabledKey, checked)}
                        ariaLabel={`Toggle ${backup.name}`}
                        size="small"
                      />
                    </div>

                    {settings[backup.enabledKey] && backup.type === 'api' && (
                      <div className="space-y-2 mt-3">
                        <SettingsInput
                          type={settings.showUnmaskedKeys ? 'text' : 'password'}
                          placeholder={backup.placeholder}
                          value={apiKeys[PROVIDER_ID_MAP[backup.name]]?.apiKey || settings[backup.key] || ''}
                          onChange={(e) => setSettings({ ...settings, [backup.key]: e.target.value })}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => testProviderConnection(backup.name, settings[backup.key], backup.key)}
                            disabled={savingProvider === backup.name}
                            className="px-3 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                          >
                            {savingProvider === backup.name ? 'Testing...' : 'Test'}
                          </button>
                          <button
                            onClick={() => handleProviderKeyChange(backup.name, backup.key, settings[backup.key], '', () => {})}
                            disabled={savingProvider === backup.name || !settings[backup.key]}
                            className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                          >
                            {savingProvider === backup.name ? 'Saving...' : (() => {
                              const providerId = PROVIDER_ID_MAP[backup.name];
                              const hasApiKey = apiKeys[providerId]?.saved === true;
                              return hasApiKey ? 'Change API' : 'Enter API Key';
                            })()}
                          </button>
                        </div>
                        <ProviderTestResult result={providerTestResults[backup.name]} size="small" />
                      </div>
                    )}
                    {settings[backup.enabledKey] && backup.type === 'free' && (
                      <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-300">
                        {backup.name} is enabled and does not require an API key.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SettingsCard>
        ))}

        <div className="flex items-center justify-end pt-4 border-t border-white/10">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.showUnmaskedKeys}
              onChange={(e) => setSettings({ ...settings, showUnmaskedKeys: e.target.checked })}
            />
            <div className="w-10 h-5 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
            <span className="ml-3 text-sm font-medium text-gray-300">Show Keys</span>
          </label>
        </div>
      </div>
    </section>
  );
};
