import { useState, useEffect } from 'react';
import { integrationsApi } from '../services/api';
import api from '../services/api';
import Toast from './Toast';
import { useNotificationContext } from '../contexts/NotificationContext';
import { useAuth } from '../hooks/useAuth';
import {
  CheckCircleIcon,
  XCircleIcon,
  KeyIcon,
  LockClosedIcon,
  ArrowPathIcon,
  PencilIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

type ApiName = 'cryptocompare' | 'newsdata' | 'binance' | 'coinmarketcap';

// Auto-enabled providers that don't require user input
interface AutoEnabledProvider {
  name: string;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
}

interface ApiConfig {
  name: ApiName;
  displayName: string;
  requiresSecret: boolean;
  description: string;
  icon: React.ReactNode;
  gradient: string;
}

const API_CONFIGS: Record<ApiName, ApiConfig> = {
  cryptocompare: {
    name: 'cryptocompare',
    displayName: 'CryptoCompare API',
    requiresSecret: false,
    description: 'Main market data and fundamentals provider',
    icon: '📊',
    gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20',
  },
  newsdata: {
    name: 'newsdata',
    displayName: 'NewsData.io API',
    requiresSecret: false,
    description: 'News and sentiment analysis provider',
    icon: '📰',
    gradient: 'from-green-500/20 via-emerald-500/20 to-teal-500/20',
  },
  binance: {
    name: 'binance',
    displayName: 'Binance API',
    requiresSecret: true,
    description: 'Optional backup market data provider',
    icon: '🪙',
    gradient: 'from-yellow-500/20 via-orange-500/20 to-red-500/20',
  },
  coinmarketcap: {
    name: 'coinmarketcap',
    displayName: 'CoinMarketCap API',
    requiresSecret: false,
    description: 'Metadata backup and market data',
    icon: '💎',
    gradient: 'from-purple-500/20 via-pink-500/20 to-rose-500/20',
  },
};

const AUTO_ENABLED_PROVIDERS: AutoEnabledProvider[] = [
  {
    name: 'binance_public',
    displayName: 'Binance Public API',
    description: 'Public cryptocurrency trading data',
    icon: '🪙',
    gradient: 'from-yellow-500/20 via-orange-500/20 to-red-500/20',
  },
];

interface Integration {
  enabled: boolean;
  apiKey: string | null;
  secretKey: string | null;
  updatedAt?: string;
}

interface BackupApi {
  id: string;
  providerName: string;
  apiKey: string;
  apiType: string;
}

interface APIIntegrationsSectionProps {
  backupApis?: BackupApi[];
  onBackupApisChange?: (backupApis: BackupApi[]) => void;
}

export default function APIIntegrationsSection({ backupApis: propBackupApis, onBackupApisChange }: APIIntegrationsSectionProps = {}) {
  const { addNotification } = useNotificationContext();
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<Record<ApiName, Integration>>({
    cryptocompare: { enabled: false, apiKey: null, secretKey: null },
    newsdata: { enabled: false, apiKey: null, secretKey: null },
    binance: { enabled: false, apiKey: null, secretKey: null },
    coinmarketcap: { enabled: false, apiKey: null, secretKey: null },
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingApi, setEditingApi] = useState<ApiName | null>(null);
  const [expandedApi, setExpandedApi] = useState<ApiName | null>(null);
  const [formData, setFormData] = useState<{ apiKey: string; secretKey: string }>({
    apiKey: '',
    secretKey: '',
  });
  const [backupApis, setBackupApis] = useState<BackupApi[]>(propBackupApis || []);
  const [showBackupApiForm, setShowBackupApiForm] = useState<ApiName | null>(null);
  const [backupApiForm, setBackupApiForm] = useState({
    providerName: '',
    apiKey: '',
    apiType: '',
  });

  // Update local state when props change
  useEffect(() => {
    if (propBackupApis) {
      setBackupApis(propBackupApis);
    }
  }, [propBackupApis]);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      const response = await integrationsApi.load();
      const data = response.data;

      const loaded: Record<ApiName, Integration> = {
        cryptocompare: { enabled: false, apiKey: null, secretKey: null },
        newsdata: { enabled: false, apiKey: null, secretKey: null },
        binance: { enabled: false, apiKey: null, secretKey: null },
        coinmarketcap: { enabled: false, apiKey: null, secretKey: null },
      };

      ['cryptocompare', 'newsdata', 'binance', 'coinmarketcap'].forEach((apiName) => {
        const api = apiName as ApiName;
        if (data[api]) {
          loaded[api] = {
            enabled: data[api].enabled || false,
            apiKey: data[api].apiKey || null,
            secretKey: data[api].secretKey || null,
            updatedAt: data[api].updatedAt,
          };
        }
      });

      setIntegrations(loaded);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error loading integrations', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };


  const handleToggle = async (apiName: ApiName) => {
    const current = integrations[apiName];
    const newEnabled = !current.enabled;

    if (!newEnabled) {
      try {
        setLoading(true);
        await integrationsApi.update({
          apiName,
          enabled: false,
        });
        setIntegrations((prev) => ({
          ...prev,
          [apiName]: { ...prev[apiName], enabled: false },
        }));
        setExpandedApi(null);
        showToast(`${API_CONFIGS[apiName].displayName} disabled`, 'success');
      } catch (err: any) {
        showToast(err.response?.data?.error || 'Error updating integration', 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    setExpandedApi(apiName);
    setEditingApi(apiName);
    setFormData({ apiKey: '', secretKey: '' });
  };

  const handleEdit = (apiName: ApiName) => {
    setEditingApi(apiName);
    setExpandedApi(apiName);
    setFormData({ apiKey: '', secretKey: '' });
  };

  const handleRotate = (apiName: ApiName) => {
    handleEdit(apiName);
  };

  const handleSave = async (apiName: ApiName) => {
    const config = API_CONFIGS[apiName];

    if (!formData.apiKey.trim()) {
      showToast('API key is required', 'error');
      return;
    }

    if (config.requiresSecret && !formData.secretKey.trim()) {
      showToast('Secret key is required', 'error');
      return;
    }

    try {
      setLoading(true);

      await integrationsApi.update({
        apiName,
        enabled: true,
        apiKey: formData.apiKey.trim(),
        secretKey: config.requiresSecret ? formData.secretKey.trim() : undefined,
      });

      await loadIntegrations();
      setEditingApi(null);
      setFormData({ apiKey: '', secretKey: '' });
      showToast(`${config.displayName} saved successfully`, 'success');
      await addNotification({
        title: 'API Connected Successfully',
        message: `${config.displayName} has been connected and configured`,
        type: 'success',
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Error saving integration';
      showToast(errorMsg, 'error');
      await addNotification({
        title: 'API Connection Failed',
        message: `${config.displayName}: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (apiName: ApiName) => {
    const name = API_CONFIGS[apiName].displayName;
    if (!confirm(`Are you sure you want to delete ${name} integration?`)) {
      return;
    }

    try {
      setLoading(true);
      await integrationsApi.delete(apiName);
      await loadIntegrations();
      setExpandedApi(null);
      showToast(`${name} deleted`, 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error deleting integration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (apiName: ApiName) => {
    if (expandedApi === apiName) {
      setExpandedApi(null);
      setEditingApi(null);
    } else {
      setExpandedApi(apiName);
    }
  };

  const handleAddBackupApi = () => {
    if (!backupApiForm.providerName.trim() || !backupApiForm.apiKey.trim() || !backupApiForm.apiType.trim()) {
      showToast('All fields are required', 'error');
      return;
    }

    const newBackupApi: BackupApi = {
      id: Date.now().toString(),
      providerName: backupApiForm.providerName.trim(),
      apiKey: backupApiForm.apiKey.trim(),
      apiType: backupApiForm.apiType.trim(),
    };

    const updatedBackupApis = [...backupApis, newBackupApi];
    setBackupApis(updatedBackupApis);
    onBackupApisChange?.(updatedBackupApis);

    setBackupApiForm({ providerName: '', apiKey: '', apiType: '' });
    setShowBackupApiForm(false);
    showToast('Backup API added successfully', 'success');
  };

  const handleRemoveBackupApi = (id: string) => {
    const updatedBackupApis = backupApis.filter(api => api.id !== id);
    setBackupApis(updatedBackupApis);
    onBackupApisChange?.(updatedBackupApis);
    showToast('Backup API removed', 'success');
  };

  const isEditing = (apiName: ApiName) => {
    return editingApi === apiName;
  };

  const isConnected = (apiName: ApiName) => {
    const integration = integrations[apiName];
    return integration.enabled && integration.apiKey;
  };

  return (
    <>
      <div className="border-t border-purple-500/20 pt-6 mt-6">
        <h3 className="text-lg font-semibold text-white mb-4">Research API Integration</h3>
        <p className="text-sm text-gray-400 mb-6">
          Connect your API credentials. CryptoCompare and NewsData.io are required for research.
          Binance and CoinMarketCap are optional backups. Binance Public API is automatically enabled.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
          </div>
        )}

        {/* Required APIs Section */}
        <div className="mb-8">
          <h4 className="text-md font-semibold text-white mb-4">Required API Credentials</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {(['cryptocompare', 'newsdata'] as ApiName[]).map((apiName) => {
              const config = API_CONFIGS[apiName];
              const integration = integrations[apiName];
              const isExpanded = expandedApi === apiName;
              const connected = isConnected(apiName);
              const apiBackupApis = backupApis.filter(api => api.apiType === apiName);

              return (
                <div
                  key={apiName}
                  className={`relative bg-gradient-to-br ${config.gradient} backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-purple-500/20 ${
                    connected ? 'ring-2 ring-green-400/50' : ''
                  }`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="text-4xl">{config.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <h3 className="text-xl font-semibold text-white">{config.displayName}</h3>
                            {connected ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                                <CheckCircleIcon className="w-3 h-3 mr-1" />
                                Connected
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-400/30">
                                <XCircleIcon className="w-3 h-3 mr-1" />
                                Not Connected
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-300">{config.description}</p>
                          {apiBackupApis.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              {apiBackupApis.length} backup{apiBackupApis.length > 1 ? 's' : ''} configured
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <ShieldCheckIcon
                          className={`w-5 h-5 ${
                            apiBackupApis.length > 0
                              ? 'text-green-400'
                              : 'text-gray-500'
                          }`}
                        />
                        <button
                          onClick={() => toggleExpand(apiName)}
                          className="p-2 text-gray-400 hover:text-white transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronUpIcon className="w-5 h-5" />
                          ) : (
                            <ChevronDownIcon className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={integration.enabled}
                          onChange={() => handleToggle(apiName)}
                          disabled={loading}
                          className="sr-only"
                        />
                        <div
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            integration.enabled ? 'bg-purple-500' : 'bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              integration.enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </div>
                        <span className="ml-3 text-sm font-medium text-gray-300">
                          {integration.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </div>

                    {isExpanded && (
                      <div className="mt-6 pt-6 border-t border-purple-500/30 animate-fade-in">
                        {!isEditing(apiName) ? (
                          <div className="space-y-4">
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1.5">API Key</label>
                                <div className="flex items-center space-x-2 p-3 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-purple-500/20">
                                  <KeyIcon className="w-4 h-4 text-purple-400" />
                                  <span className="text-sm font-mono text-gray-300 flex-1">
                                    {integration.apiKey || 'Not configured'}
                                  </span>
                                </div>
                              </div>
                              {config.requiresSecret && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Secret Key</label>
                                  <div className="flex items-center space-x-2 p-3 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-purple-500/20">
                                    <LockClosedIcon className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm font-mono text-gray-300 flex-1">
                                      {integration.secretKey || 'Not configured'}
                                    </span>
                                  </div>
                                </div>
                              )}
                              {integration.updatedAt && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Last Updated</label>
                                  <div className="text-xs text-gray-400">
                                    {new Date(integration.updatedAt).toLocaleString()}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 pt-2">
                              <button
                                onClick={() => handleEdit(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                              >
                                <PencilIcon className="w-4 h-4 mr-2" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleRotate(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                              >
                                <ArrowPathIcon className="w-4 h-4 mr-2" />
                                Rotate
                              </button>
                              <button
                                onClick={() => handleDelete(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                              >
                                <TrashIcon className="w-4 h-4 mr-2" />
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                  API Key <span className="text-red-400">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="w-full px-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                  value={formData.apiKey}
                                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                  placeholder="Enter your API key"
                                />
                              </div>
                              {config.requiresSecret && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                    Secret Key <span className="text-red-400">*</span>
                                  </label>
                                  <input
                                    type="password"
                                    className="w-full px-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                    value={formData.secretKey}
                                    onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                                    placeholder="Enter your secret key"
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 pt-2">
                              <button
                                onClick={() => {
                                  setEditingApi(null);
                                  setFormData({ apiKey: '', secretKey: '' });
                                }}
                                className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                disabled={loading}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSave(apiName)}
                                className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/50"
                                disabled={loading}
                              >
                                {loading ? 'Connecting...' : 'Connect API'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Optional APIs Section */}
        <div className="mb-8">
          <h4 className="text-md font-semibold text-white mb-4">Optional API Credentials</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {(['binance', 'coinmarketcap'] as ApiName[]).map((apiName) => {
              const config = API_CONFIGS[apiName];
              const integration = integrations[apiName];
              const isExpanded = expandedApi === apiName;
              const connected = isConnected(apiName);

              return (
                <div
                  key={apiName}
                  className={`relative bg-gradient-to-br ${config.gradient} backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-purple-500/20 ${
                    connected ? 'ring-2 ring-green-400/50' : ''
                  }`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="text-4xl">{config.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <h3 className="text-xl font-semibold text-white">{config.displayName}</h3>
                            {connected ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                                <CheckCircleIcon className="w-3 h-3 mr-1" />
                                Connected
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-400/30">
                                <XCircleIcon className="w-3 h-3 mr-1" />
                                Not Connected
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-300">{config.description}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleExpand(apiName)}
                        className="ml-4 p-2 text-gray-400 hover:text-white transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUpIcon className="w-5 h-5" />
                        ) : (
                          <ChevronDownIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={integration.enabled}
                          onChange={() => handleToggle(apiName)}
                          disabled={loading}
                          className="sr-only"
                        />
                        <div
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            integration.enabled ? 'bg-purple-500' : 'bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              integration.enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </div>
                        <span className="ml-3 text-sm font-medium text-gray-300">
                          {integration.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    </div>

                    {isExpanded && (
                      <div className="mt-6 pt-6 border-t border-purple-500/30 animate-fade-in">
                        {!isEditing(apiName) ? (
                          <div className="space-y-4">
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1.5">API Key</label>
                                <div className="flex items-center space-x-2 p-3 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-purple-500/20">
                                  <KeyIcon className="w-4 h-4 text-purple-400" />
                                  <span className="text-sm font-mono text-gray-300 flex-1">
                                    {integration.apiKey || 'Not configured'}
                                  </span>
                                </div>
                              </div>
                              {config.requiresSecret && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Secret Key</label>
                                  <div className="flex items-center space-x-2 p-3 bg-slate-800/50 backdrop-blur-sm rounded-lg border border-purple-500/20">
                                    <LockClosedIcon className="w-4 h-4 text-purple-400" />
                                    <span className="text-sm font-mono text-gray-300 flex-1">
                                      {integration.secretKey || 'Not configured'}
                                    </span>
                                  </div>
                                </div>
                              )}
                              {integration.updatedAt && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Last Updated</label>
                                  <div className="text-xs text-gray-400">
                                    {new Date(integration.updatedAt).toLocaleString()}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 pt-2">
                              <button
                                onClick={() => handleEdit(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                              >
                                <PencilIcon className="w-4 h-4 mr-2" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleRotate(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                              >
                                <ArrowPathIcon className="w-4 h-4 mr-2" />
                                Rotate
                              </button>
                              <button
                                onClick={() => handleDelete(apiName)}
                                className="btn-mobile-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                              >
                                <TrashIcon className="w-4 h-4 mr-2" />
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                  API Key <span className="text-red-400">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="w-full px-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                  value={formData.apiKey}
                                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                  placeholder="Enter your API key"
                                />
                              </div>
                              {config.requiresSecret && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                    Secret Key <span className="text-red-400">*</span>
                                  </label>
                                  <input
                                    type="password"
                                    className="w-full px-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                    value={formData.secretKey}
                                    onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                                    placeholder="Enter your secret key"
                                  />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-2 pt-2">
                              <button
                                onClick={() => {
                                  setEditingApi(null);
                                  setFormData({ apiKey: '', secretKey: '' });
                                }}
                                className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                disabled={loading}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSave(apiName)}
                                className="btn-mobile-full px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/50"
                                disabled={loading}
                              >
                                Connect API
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Auto-Enabled Providers Section */}
        <div>
          <h4 className="text-md font-semibold text-white mb-4">Auto-Enabled Providers</h4>
          <p className="text-sm text-gray-400 mb-4">
            These providers are automatically enabled for all users and don't require configuration.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {AUTO_ENABLED_PROVIDERS.map((provider) => (
              <div
                key={provider.name}
                className={`relative bg-gradient-to-br ${provider.gradient} backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-purple-500/20 ring-2 ring-green-400/50`}
              >
                <div className="p-6">
                  <div className="flex items-start space-x-4">
                    <div className="text-4xl">{provider.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="text-xl font-semibold text-white">{provider.displayName}</h3>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                          <CheckCircleIcon className="w-3 h-3 mr-1" />
                          Auto-Enabled
                        </span>
                      </div>
                      <p className="text-sm text-gray-300">{provider.description}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}

