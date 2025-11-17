import { useState, useEffect } from 'react';
import { integrationsApi } from '../services/api';
import Toast from './Toast';
import { useNotificationContext } from '../contexts/NotificationContext';
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
} from '@heroicons/react/24/outline';

type ApiName = 'binance' | 'cryptoquant' | 'lunarcrush' | 'coinapi';
type CoinApiType = 'market' | 'flatfile' | 'exchangerate';

interface ApiConfig {
  name: ApiName;
  displayName: string;
  requiresSecret: boolean;
  description: string;
  icon: React.ReactNode;
  gradient: string;
}

const API_CONFIGS: Record<ApiName, ApiConfig> = {
  binance: {
    name: 'binance',
    displayName: 'Binance API',
    requiresSecret: true,
    description: 'Trading and market data from Binance exchange',
    icon: '⚡',
    gradient: 'from-yellow-500/20 via-orange-500/20 to-red-500/20',
  },
  cryptoquant: {
    name: 'cryptoquant',
    displayName: 'CryptoQuant API',
    requiresSecret: false,
    description: 'On-chain analytics and market intelligence',
    icon: '📊',
    gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20',
  },
  lunarcrush: {
    name: 'lunarcrush',
    displayName: 'LunarCrush API',
    requiresSecret: false,
    description: 'Social sentiment and influencer analytics',
    icon: '🌙',
    gradient: 'from-purple-500/20 via-pink-500/20 to-rose-500/20',
  },
  coinapi: {
    name: 'coinapi',
    displayName: 'CoinAPI',
    requiresSecret: false,
    description: 'Cryptocurrency market data and historical prices',
    icon: '🪙',
    gradient: 'from-green-500/20 via-emerald-500/20 to-teal-500/20',
  },
};

const COINAPI_TYPES: { value: CoinApiType; label: string; icon: string }[] = [
  { value: 'market', label: 'Market API', icon: '📈' },
  { value: 'flatfile', label: 'Flat File API', icon: '📄' },
  { value: 'exchangerate', label: 'Exchange Rate API', icon: '💱' },
];

interface CoinApiIntegration {
  enabled: boolean;
  apiKey: string | null;
  updatedAt?: string;
}

interface Integration {
  enabled: boolean;
  apiKey: string | null;
  secretKey: string | null;
  updatedAt?: string;
}

interface CoinApiData {
  market?: CoinApiIntegration;
  flatfile?: CoinApiIntegration;
  exchangerate?: CoinApiIntegration;
}

export default function APIIntegrationsSection() {
  const { addNotification } = useNotificationContext();
  const [integrations, setIntegrations] = useState<Record<ApiName, Integration | CoinApiData>>({
    binance: { enabled: false, apiKey: null, secretKey: null },
    cryptoquant: { enabled: false, apiKey: null, secretKey: null },
    lunarcrush: { enabled: false, apiKey: null, secretKey: null },
    coinapi: {},
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [editingApi, setEditingApi] = useState<{ apiName: ApiName; apiType?: CoinApiType } | null>(null);
  const [expandedApi, setExpandedApi] = useState<ApiName | null>(null);
  const [expandedCoinApiType, setExpandedCoinApiType] = useState<CoinApiType | null>(null);
  const [formData, setFormData] = useState<{ apiKey: string; secretKey: string }>({
    apiKey: '',
    secretKey: '',
  });

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    try {
      setLoading(true);
      const response = await integrationsApi.load();
      const data = response.data;

      const loaded: Record<ApiName, Integration | CoinApiData> = {
        binance: { enabled: false, apiKey: null, secretKey: null },
        cryptoquant: { enabled: false, apiKey: null, secretKey: null },
        lunarcrush: { enabled: false, apiKey: null, secretKey: null },
        coinapi: {},
      };

      ['binance', 'cryptoquant', 'lunarcrush'].forEach((apiName) => {
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

      if (data.coinapi) {
        loaded.coinapi = {
          market: data.coinapi.market || { enabled: false, apiKey: null },
          flatfile: data.coinapi.flatfile || { enabled: false, apiKey: null },
          exchangerate: data.coinapi.exchangerate || { enabled: false, apiKey: null },
        };
      }

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

  const getCoinApiStatus = (): 'fully' | 'partial' | 'none' => {
    const coinApi = integrations.coinapi as CoinApiData;
    const connected = [
      coinApi.market?.enabled && coinApi.market?.apiKey,
      coinApi.flatfile?.enabled && coinApi.flatfile?.apiKey,
      coinApi.exchangerate?.enabled && coinApi.exchangerate?.apiKey,
    ].filter(Boolean).length;

    if (connected === 3) return 'fully';
    if (connected > 0) return 'partial';
    return 'none';
  };

  const handleCoinApiSubCardClick = (apiType: CoinApiType) => {
    if (expandedCoinApiType === apiType) {
      setExpandedCoinApiType(null);
      setEditingApi(null);
    } else {
      setExpandedCoinApiType(apiType);
      const coinApi = integrations.coinapi as CoinApiData;
      const integration = coinApi[apiType];
      if (integration?.enabled && integration?.apiKey) {
        setEditingApi(null);
      } else {
        setEditingApi({ apiName: 'coinapi', apiType });
      }
      setFormData({ apiKey: '', secretKey: '' });
    }
  };

  const handleToggle = async (apiName: ApiName, apiType?: CoinApiType) => {
    if (apiName === 'coinapi' && apiType) {
      const coinApi = integrations.coinapi as CoinApiData;
      const current = coinApi[apiType];
      const newEnabled = !current?.enabled;

      if (!newEnabled) {
        try {
          setLoading(true);
          await integrationsApi.update({
            apiName: 'coinapi',
            apiType,
            enabled: false,
          });
          await loadIntegrations();
          showToast(`${COINAPI_TYPES.find((t) => t.value === apiType)?.label} disabled`, 'success');
        } catch (err: any) {
          showToast(err.response?.data?.error || 'Error updating integration', 'error');
        } finally {
          setLoading(false);
        }
        return;
      }

      setExpandedCoinApiType(apiType);
      setEditingApi({ apiName, apiType });
      setFormData({ apiKey: '', secretKey: '' });
      return;
    }

    const current = integrations[apiName] as Integration;
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
          [apiName]: { ...(prev[apiName] as Integration), enabled: false },
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
    setEditingApi({ apiName });
    setFormData({ apiKey: '', secretKey: '' });
  };

  const handleEdit = (apiName: ApiName, apiType?: CoinApiType) => {
    setEditingApi({ apiName, apiType });
    setExpandedApi(apiName);
    setFormData({ apiKey: '', secretKey: '' });
  };

  const handleRotate = (apiName: ApiName, apiType?: CoinApiType) => {
    handleEdit(apiName, apiType);
  };

  const handleSave = async (apiName: ApiName, apiType?: CoinApiType) => {
    const config = API_CONFIGS[apiName];

    if (!formData.apiKey.trim()) {
      showToast('API key is required', 'error');
      return;
    }

    if (config.requiresSecret && !formData.secretKey.trim()) {
      showToast('Secret key is required for Binance', 'error');
      return;
    }

    try {
      setLoading(true);
      await integrationsApi.update({
        apiName,
        apiType,
        enabled: true,
        apiKey: formData.apiKey.trim(),
        secretKey: config.requiresSecret ? formData.secretKey.trim() : undefined,
      });

      await loadIntegrations();
      setEditingApi(null);
      if (apiType) {
        setExpandedCoinApiType(apiType);
      }
      setFormData({ apiKey: '', secretKey: '' });
      const apiDisplayName = apiType ? COINAPI_TYPES.find((t) => t.value === apiType)?.label : config.displayName;
      showToast(`${apiDisplayName} saved successfully`, 'success');
      await addNotification({
        title: 'API Connected Successfully',
        message: `${apiDisplayName} has been connected and configured`,
        type: 'success',
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Error saving integration';
      showToast(errorMsg, 'error');
      await addNotification({
        title: 'API Connection Failed',
        message: `${apiType ? COINAPI_TYPES.find((t) => t.value === apiType)?.label : config.displayName}: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (apiName: ApiName, apiType?: CoinApiType) => {
    const name = apiType ? COINAPI_TYPES.find((t) => t.value === apiType)?.label : API_CONFIGS[apiName].displayName;
    if (!confirm(`Are you sure you want to delete ${name} integration?`)) {
      return;
    }

    try {
      setLoading(true);
      await integrationsApi.delete(apiName, apiType);
      await loadIntegrations();
      if (apiType) {
        setExpandedApi('coinapi');
      } else {
        setExpandedApi(null);
      }
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
      if (apiName === 'coinapi') {
        setExpandedCoinApiType(null);
      }
    } else {
      setExpandedApi(apiName);
    }
  };

  const isEditing = (apiName: ApiName, apiType?: CoinApiType) => {
    return editingApi?.apiName === apiName && editingApi?.apiType === apiType;
  };

  const isConnected = (apiName: ApiName, apiType?: CoinApiType) => {
    if (apiName === 'coinapi' && apiType) {
      const coinApi = integrations.coinapi as CoinApiData;
      return coinApi[apiType]?.enabled && coinApi[apiType]?.apiKey;
    }
    const integration = integrations[apiName] as Integration;
    return integration.enabled && integration.apiKey;
  };

  return (
    <>
      <div className="border-t border-purple-500/20 pt-6 mt-6">
        <h3 className="text-lg font-semibold text-white mb-4">Trading API Integration</h3>
        <p className="text-sm text-gray-400 mb-6">Connect and manage your API integrations. All keys are encrypted and stored securely.</p>

        {loading && !integrations.binance && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {(['binance', 'cryptoquant', 'lunarcrush'] as ApiName[]).map((apiName) => {
            const config = API_CONFIGS[apiName];
            const integration = integrations[apiName] as Integration;
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

          {/* CoinAPI Card with Sub-types */}
          <div
            className={`relative bg-gradient-to-br ${API_CONFIGS.coinapi.gradient} backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-purple-500/20 ${
              getCoinApiStatus() !== 'none' ? 'ring-2 ring-green-400/50' : ''
            }`}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start space-x-4 flex-1">
                  <div className="text-4xl">{API_CONFIGS.coinapi.icon}</div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <h3 className="text-xl font-semibold text-white">{API_CONFIGS.coinapi.displayName}</h3>
                      {getCoinApiStatus() === 'fully' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                          <CheckCircleIcon className="w-3 h-3 mr-1" />
                          Fully Connected
                        </span>
                      ) : getCoinApiStatus() === 'partial' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                          <CheckCircleIcon className="w-3 h-3 mr-1" />
                          Partially Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-400/30">
                          <XCircleIcon className="w-3 h-3 mr-1" />
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-300">{API_CONFIGS.coinapi.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleExpand('coinapi')}
                  className="ml-4 p-2 text-gray-400 hover:text-white transition-colors"
                >
                  {expandedApi === 'coinapi' ? (
                    <ChevronUpIcon className="w-5 h-5" />
                  ) : (
                    <ChevronDownIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {expandedApi === 'coinapi' && (
              <div className="px-6 pb-6 animate-fade-in">
                <div className="space-y-4">
                  {COINAPI_TYPES.map((type) => {
                    const coinApi = integrations.coinapi as CoinApiData;
                    const integration = coinApi[type.value];
                    const connected = isConnected('coinapi', type.value);
                    const editing = isEditing('coinapi', type.value);
                    const isSubExpanded = expandedCoinApiType === type.value;

                    return (
                      <div
                        key={type.value}
                        className="bg-slate-800/40 backdrop-blur-sm rounded-xl border border-purple-500/20 transition-all hover:border-purple-500/40 cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('label, button')) return;
                          handleCoinApiSubCardClick(type.value);
                        }}
                      >
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-3 flex-1">
                              <span className="text-2xl">{type.icon}</span>
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-white">{type.label}</h4>
                                {connected ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30 mt-1">
                                    Connected
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-300 border border-gray-400/30 mt-1">
                                    Not Connected
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <label 
                                className="flex items-center cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={integration?.enabled || false}
                                  onChange={() => handleToggle('coinapi', type.value)}
                                  disabled={loading}
                                  className="sr-only"
                                />
                                <div
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                    integration?.enabled ? 'bg-purple-500' : 'bg-gray-600'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                      integration?.enabled ? 'translate-x-5' : 'translate-x-1'
                                    }`}
                                  />
                                </div>
                              </label>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCoinApiSubCardClick(type.value);
                                }}
                                className="p-1 text-gray-400 hover:text-white transition-colors"
                              >
                                {isSubExpanded ? (
                                  <ChevronUpIcon className="w-4 h-4" />
                                ) : (
                                  <ChevronDownIcon className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        {isSubExpanded && (
                          <div className="px-4 pb-4 pt-2 border-t border-purple-500/20 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                            {!editing ? (
                              integration?.enabled && integration?.apiKey ? (
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1.5">API Key</label>
                                    <div className="flex items-center space-x-2 p-3 bg-slate-900/50 backdrop-blur-sm rounded-lg border border-purple-500/20">
                                      <KeyIcon className="w-4 h-4 text-purple-400" />
                                      <span className="text-sm font-mono text-gray-300 flex-1">
                                        {integration.apiKey}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      onClick={() => handleEdit('coinapi', type.value)}
                                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                    >
                                      <PencilIcon className="w-3 h-3 mr-1.5" />
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleRotate('coinapi', type.value)}
                                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                    >
                                      <ArrowPathIcon className="w-3 h-3 mr-1.5" />
                                      Rotate
                                    </button>
                                    <button
                                      onClick={() => handleDelete('coinapi', type.value)}
                                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all"
                                    >
                                      <TrashIcon className="w-3 h-3 mr-1.5" />
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                      API Key <span className="text-red-400">*</span>
                                    </label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                      value={formData.apiKey}
                                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                      placeholder="Enter your API key"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => {
                                        setEditingApi(null);
                                        setExpandedCoinApiType(null);
                                        setFormData({ apiKey: '', secretKey: '' });
                                      }}
                                      className="flex-1 px-3 py-2 text-xs font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                      disabled={loading}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => handleSave('coinapi', type.value)}
                                      className="flex-1 px-3 py-2 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                      disabled={loading}
                                    >
                                      {loading ? 'Saving...' : 'Save'}
                                    </button>
                                  </div>
                                </div>
                              )
                            ) : (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                    API Key <span className="text-red-400">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    className="w-full px-3 py-2 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                    value={formData.apiKey}
                                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                                    placeholder="Enter your API key"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      setEditingApi(null);
                                      setFormData({ apiKey: '', secretKey: '' });
                                    }}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                                    disabled={loading}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSave('coinapi', type.value)}
                                    className="flex-1 px-3 py-2 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    disabled={loading}
                                  >
                                    {loading ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}

