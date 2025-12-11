import React, { useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
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
  handleProviderKeyChange: (providerName: string, keyName: string, value: string, uid?: string, setProviders?: (providers: any) => void) => void;
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
  // State for edit mode and confirmation
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [originalApiKey, setOriginalApiKey] = useState<string>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingEditProvider, setPendingEditProvider] = useState<string>('');

  const getProviderKey = (providerName: string) => {
    // Find the provider key from PROVIDER_CONFIG
    for (const [groupKey, config] of Object.entries(PROVIDER_CONFIG)) {
      if (config.primary.name === providerName) {
        return config.primary.key;
      }
      const backup = config.backups.find(b => b.name === providerName);
      if (backup) {
        return backup.key;
      }
    }
    return '';
  };

  const maskKey = (key?: string) => {
    if (!key) return '••••••';
    if (key.length <= 4) return '••••';
    return `${key.slice(0, 2)}••••${key.slice(-2)}`;
  };

  const getSavedKey = (providerName: string) => {
    const providerId = PROVIDER_ID_MAP[providerName];
    return apiKeys[providerId]?.apiKey || settings[getProviderKey(providerName)] || '';
  };

  const handleChangeApiClick = (providerName: string) => {
    setPendingEditProvider(providerName);
    setShowConfirmDialog(true);
  };

  const confirmEditApi = () => {
    const providerName = pendingEditProvider;
    const providerId = PROVIDER_ID_MAP[providerName];
    const currentKey = apiKeys[providerId]?.apiKey || settings[getProviderKey(providerName)] || '';
    setOriginalApiKey(currentKey);
    setEditingProvider(providerName);
    setShowConfirmDialog(false);
    setPendingEditProvider('');
  };

  const cancelEditApi = () => {
    // Restore original API key
    const providerName = editingProvider!;
    const providerKey = getProviderKey(providerName);
    setSettings({ ...settings, [providerKey]: originalApiKey });
    setEditingProvider(null);
    setOriginalApiKey('');
    setShowConfirmDialog(false);
    setPendingEditProvider('');
  };

  const saveApiKey = async (providerName: string) => {
    const providerKey = getProviderKey(providerName);
    await handleProviderKeyChange(providerName, providerKey, settings[providerKey], '', () => {});
    setEditingProvider(null);
    setOriginalApiKey('');
  };

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
                <div className="space-y-3">
                  {(() => {
                    const savedKey = getSavedKey(config.primary.name);
                    const hasKey = !!savedKey;
                    const isEditing = editingProvider === config.primary.name || !hasKey;

                    if (!isEditing) {
                      return (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900/40 p-3 rounded-lg border border-white/10">
                          <div>
                            <div className="text-sm text-gray-300 font-semibold">{config.primary.name}</div>
                            <div className="text-xs text-gray-400">Key: {maskKey(savedKey)}</div>
                          </div>
                          <div className="flex flex-wrap gap-2 justify-end">
                            <button
                              onClick={() => testProviderConnection(config.primary.name, settings[config.primary.key], config.primary.key)}
                              disabled={savingProvider === config.primary.name}
                              className="px-3 py-2 bg-slate-700/60 text-slate-200 text-xs rounded-lg hover:bg-slate-600/70 transition-all duration-300 disabled:opacity-50"
                            >
                              {savingProvider === config.primary.name ? 'Testing...' : 'Test'}
                            </button>
                            <button
                              onClick={() => handleChangeApiClick(config.primary.name)}
                              className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-xs sm:text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                            >
                              Change API
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <>
                        <SettingsInput
                          type="password"
                          placeholder={config.primary.placeholder}
                          value={settings[config.primary.key] || ''}
                          onChange={(e) => setSettings({ ...settings, [config.primary.key]: e.target.value })}
                          disabled={false}
                        />

                        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                          <button
                            onClick={() => saveApiKey(config.primary.name)}
                            disabled={savingProvider === config.primary.name || !settings[config.primary.key]}
                            className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium rounded-lg text-sm hover:from-green-600 hover:to-emerald-600 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                          >
                            {savingProvider === config.primary.name ? 'Saving...' : hasKey ? 'Update' : 'Save'}
                          </button>
                          {hasKey && (
                            <button
                              onClick={cancelEditApi}
                              disabled={savingProvider === config.primary.name}
                              className="px-4 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={() => testProviderConnection(config.primary.name, settings[config.primary.key], config.primary.key)}
                            disabled={savingProvider === config.primary.name}
                            className="px-3 py-2 bg-slate-700/60 text-slate-200 text-xs rounded-lg hover:bg-slate-600/70 transition-all duration-300 disabled:opacity-50"
                          >
                            {savingProvider === config.primary.name ? 'Testing...' : 'Test'}
                          </button>
                        </div>

                        <ProviderTestResult result={providerTestResults[config.primary.name]} />
                      </>
                    );
                  })()}
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
                      <div className="space-y-3 mt-3">
                        {(() => {
                          const savedKey = getSavedKey(backup.name);
                          const hasKey = !!savedKey;
                          const isEditing = editingProvider === backup.name || !hasKey;

                          if (!isEditing) {
                            return (
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-900/40 p-3 rounded-lg border border-white/10">
                                <div>
                                  <div className="text-sm text-gray-200 font-semibold">{backup.name}</div>
                                  <div className="text-xs text-gray-400">Key: {maskKey(savedKey)}</div>
                                </div>
                                <div className="flex flex-wrap gap-2 justify-end">
                                  <button
                                    onClick={() => testProviderConnection(backup.name, settings[backup.key], backup.key)}
                                    disabled={savingProvider === backup.name}
                                    className="px-3 py-2 bg-slate-700/60 text-slate-200 text-xs rounded-lg hover:bg-slate-600/70 transition-all duration-300 disabled:opacity-50"
                                  >
                                    {savingProvider === backup.name ? 'Testing...' : 'Test'}
                                  </button>
                                  <button
                                    onClick={() => handleChangeApiClick(backup.name)}
                                    className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-xs sm:text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                                  >
                                    Change API
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <>
                              <SettingsInput
                                type="password"
                                placeholder={backup.placeholder}
                                value={settings[backup.key] || ''}
                                onChange={(e) => setSettings({ ...settings, [backup.key]: e.target.value })}
                              />

                              <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                                <button
                                  onClick={() => saveApiKey(backup.name)}
                                  disabled={savingProvider === backup.name || !settings[backup.key]}
                                  className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium rounded-lg text-sm hover:from-green-600 hover:to-emerald-600 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                >
                                  {savingProvider === backup.name ? 'Saving...' : hasKey ? 'Update' : 'Save'}
                                </button>
                                {hasKey && (
                                  <button
                                    onClick={cancelEditApi}
                                    disabled={savingProvider === backup.name}
                                    className="px-4 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  onClick={() => testProviderConnection(backup.name, settings[backup.key], backup.key)}
                                  disabled={savingProvider === backup.name}
                                  className="px-3 py-2 bg-slate-700/60 text-slate-200 text-xs rounded-lg hover:bg-slate-600/70 transition-all duration-300 disabled:opacity-50"
                                >
                                  {savingProvider === backup.name ? 'Testing...' : 'Test'}
                                </button>
                              </div>

                              <ProviderTestResult result={providerTestResults[backup.name]} size="small" />
                            </>
                          );
                        })()}
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

      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="w-6 h-6 text-yellow-500" />
              <h3 className="text-lg font-semibold text-white">Confirm API Key Change</h3>
            </div>
            <p className="text-gray-300 mb-6">
              Are you sure you want to change the API key for <span className="text-purple-400 font-medium">{pendingEditProvider}</span>?
              This will allow you to modify the current API key.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-gray-300 rounded-lg transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={confirmEditApi}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors duration-200"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
