import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Toast from './Toast';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import {
  CheckCircleIcon,
  XCircleIcon,
  KeyIcon,
  LockClosedIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

type ExchangeName = 'binance' | 'bitget' | 'bingx' | 'weex';

interface ExchangeInfo {
  name: string;
  requiresPassphrase: boolean;
  description: string;
  icon: string;
  gradient: string;
}

const EXCHANGE_INFO: Record<ExchangeName, ExchangeInfo> = {
  binance: {
    name: 'Binance',
    requiresPassphrase: false,
    description: 'World\'s largest cryptocurrency exchange',
    icon: '⚡',
    gradient: 'from-yellow-500/20 via-orange-500/20 to-red-500/20',
  },
  bitget: {
    name: 'Bitget',
    requiresPassphrase: true,
    description: 'Leading crypto derivatives exchange',
    icon: '🚀',
    gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20',
  },
  bingx: {
    name: 'BingX',
    requiresPassphrase: false,
    description: 'Social trading platform',
    icon: '💎',
    gradient: 'from-green-500/20 via-emerald-500/20 to-teal-500/20',
  },
  weex: {
    name: 'WEEX',
    requiresPassphrase: false,
    description: 'Professional crypto trading platform',
    icon: '⭐',
    gradient: 'from-purple-500/20 via-pink-500/20 to-rose-500/20',
  },
};

interface ExchangeCredentials {
  apiKey: string;
  secretKey: string;
  passphrase?: string;
}

interface SavedConfig {
  exchange: ExchangeName;
  testnet: boolean;
  lastTested?: string;
}

export default function ExchangeAccountsSection() {
  const { user } = useAuth();
  const [selectedExchange, setSelectedExchange] = useState<ExchangeName | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<Record<ExchangeName, SavedConfig | null>>({
    binance: null,
    bitget: null,
    bingx: null,
    weex: null,
  });
  const [credentials, setCredentials] = useState<ExchangeCredentials>({
    apiKey: '',
    secretKey: '',
    passphrase: '',
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTrading, setTestTrading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const { showError } = useError();
  const { addNotification } = useNotificationContext();

  useEffect(() => {
    if (user) {
      loadSavedConfigs();
    }
  }, [user]);

  const loadSavedConfigs = async () => {
    if (!user) return;
    try {
      const response = await api.get(`/users/${user.uid}/exchange-config`);
      if (response.data && response.data.exchange) {
        const exchange = response.data.exchange as ExchangeName;
        setSavedConfigs((prev) => ({
          ...prev,
          [exchange]: {
            exchange,
            testnet: response.data.testnet ?? true,
            lastTested: response.data.lastTested,
          },
        }));
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        suppressConsoleError(err, 'loadExchangeConfigs');
      }
    }
  };

  const handleExchangeClick = (exchange: ExchangeName) => {
    setSelectedExchange(exchange);
    setCredentials({
      apiKey: '',
      secretKey: '',
      passphrase: '',
    });
    setShowModal(true);
  };

  const handleTestConnection = async () => {
    if (!selectedExchange || !credentials.apiKey || !credentials.secretKey) {
      showError('Please enter API key and secret key', 'validation');
      return;
    }

    const exchangeInfo = EXCHANGE_INFO[selectedExchange];
    if (exchangeInfo.requiresPassphrase && !credentials.passphrase) {
      showError('Please enter passphrase', 'validation');
      return;
    }

    try {
      setTesting(true);
      const response = await api.post('/exchange/test', {
        exchange: selectedExchange,
        apiKey: credentials.apiKey,
        secret: credentials.secretKey,
        passphrase: exchangeInfo.requiresPassphrase ? credentials.passphrase : undefined,
        testnet: true,
      });
      
      if (response.data.success) {
        showToast(`Connection successful: ${response.data.message}`, 'success');
        await addNotification({
          title: 'Exchange Connected',
          message: `${exchangeInfo.name} connection test successful`,
          type: 'success',
        });
      } else {
        showError(`Connection failed: ${response.data.message}`, 'exchange');
      }
    } catch (err: any) {
      suppressConsoleError(err, 'testConnection');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedExchange || !user) return;

    const exchangeInfo = EXCHANGE_INFO[selectedExchange];
    if (!credentials.apiKey || !credentials.secretKey) {
      showError('API key and secret key are required', 'validation');
      return;
    }
    if (exchangeInfo.requiresPassphrase && !credentials.passphrase) {
      showError('Passphrase is required for this exchange', 'validation');
      return;
    }

    try {
      setLoading(true);
      await api.post(`/users/${user.uid}/exchange-config`, {
        exchange: selectedExchange,
        apiKey: credentials.apiKey,
        secret: credentials.secretKey,
        passphrase: exchangeInfo.requiresPassphrase ? credentials.passphrase : undefined,
        testnet: true,
      });
      
      showToast('Exchange credentials saved successfully', 'success');
      await addNotification({
        title: 'Exchange Credentials Updated',
        message: `${exchangeInfo.name} credentials saved and encrypted`,
        type: 'success',
      });
      await loadSavedConfigs();
      setShowModal(false);
      setCredentials({
        apiKey: '',
        secretKey: '',
        passphrase: '',
      });
    } catch (err: any) {
      suppressConsoleError(err, 'saveExchangeConfig');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleTestTrade = async () => {
    if (!selectedExchange || !user || !savedConfigs[selectedExchange]) {
      showError('Exchange not configured', 'exchange');
      return;
    }

    try {
      setTestTrading(true);
      const response = await api.post('/exchange/test-trade', {
        exchange: selectedExchange,
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity: 0.001, // Small test order
      });

      if (response.data.success) {
        showToast(
          `Test trade successful! Order ID: ${response.data.orderId || 'N/A'}`,
          'success'
        );
        await addNotification({
          title: 'Test Trade Placed',
          message: `Market order executed: ${response.data.symbol} ${response.data.side} - Order ID: ${response.data.orderId || 'N/A'}`,
          type: 'success',
        });
      } else {
        showError(`Test trade failed: ${response.data.message || 'Unknown error'}`, 'exchange');
      }
    } catch (err: any) {
      suppressConsoleError(err, 'testTrade');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setTestTrading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const getExchangeStatus = (exchange: ExchangeName): 'connected' | 'not_connected' => {
    return savedConfigs[exchange] ? 'connected' : 'not_connected';
  };

  return (
    <>
      <div className="border-t border-purple-500/20 pt-6 mt-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-2">Exchange Accounts</h3>
          <p className="text-sm text-gray-400">
            Connect your trading exchange account to enable real trading.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(Object.keys(EXCHANGE_INFO) as ExchangeName[]).map((exchange) => {
            const info = EXCHANGE_INFO[exchange];
            const status = getExchangeStatus(exchange);
            const isConnected = status === 'connected';
            const savedConfig = savedConfigs[exchange];

            return (
              <div
                key={exchange}
                onClick={() => handleExchangeClick(exchange)}
                className={`relative bg-gradient-to-br ${info.gradient} backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl transition-all duration-300 hover:scale-[1.02] hover:shadow-purple-500/20 cursor-pointer ${
                  isConnected ? 'ring-2 ring-green-400/50' : ''
                }`}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="text-4xl">{info.icon}</div>
                    {isConnected ? (
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
                  <h4 className="text-lg font-semibold text-white mb-1">{info.name}</h4>
                  <p className="text-xs text-gray-300 mb-3">{info.description}</p>
                  {savedConfig && (
                    <div className="text-xs text-gray-400">
                      {savedConfig.testnet ? 'Testnet' : 'Live'} Mode
                      {savedConfig.lastTested && (
                        <div className="mt-1">
                          Last tested: {new Date(savedConfig.lastTested).toLocaleDateString()}
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

      {/* Credentials Modal */}
      {showModal && selectedExchange && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-purple-500/50 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">
                {EXCHANGE_INFO[selectedExchange].icon} {EXCHANGE_INFO[selectedExchange].name}
              </h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setSelectedExchange(null);
                }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <XCircleIcon className="w-6 h-6" />
              </button>
            </div>

            <p className="text-sm text-gray-400 mb-6">
              {EXCHANGE_INFO[selectedExchange].description}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">
                  API Key <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <KeyIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
                  <input
                    type="text"
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={credentials.apiKey}
                    onChange={(e) => setCredentials({ ...credentials, apiKey: e.target.value })}
                    placeholder="Enter your API key"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">
                  Secret Key <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <LockClosedIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
                  <input
                    type="password"
                    className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    value={credentials.secretKey}
                    onChange={(e) => setCredentials({ ...credentials, secretKey: e.target.value })}
                    placeholder="Enter your secret key"
                  />
                </div>
              </div>

              {EXCHANGE_INFO[selectedExchange].requiresPassphrase && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-gray-300">
                    Passphrase <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <LockClosedIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
                    <input
                      type="password"
                      className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-900/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      value={credentials.passphrase}
                      onChange={(e) => setCredentials({ ...credentials, passphrase: e.target.value })}
                      placeholder="Enter your passphrase"
                    />
                  </div>
                </div>
              )}

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start space-x-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-200">
                  All credentials are encrypted in the backend and saved securely. Test connection before saving.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={loading || testing}
                  className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowPathIcon className={`w-4 h-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading || testing}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/50"
                >
                  {loading ? 'Saving...' : 'Save & Connect'}
                </button>
              </div>

              {/* Test Trade Button - Only show if exchange is already connected */}
              {savedConfigs[selectedExchange] && (
                <div className="mt-4 pt-4 border-t border-purple-500/20">
                  <button
                    type="button"
                    onClick={handleTestTrade}
                    disabled={testTrading}
                    className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg hover:from-green-600 hover:to-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/50"
                  >
                    <ArrowPathIcon className={`w-4 h-4 mr-2 ${testTrading ? 'animate-spin' : ''}`} />
                    {testTrading ? 'Placing Test Trade...' : 'Open Test Trade (Market Order)'}
                  </button>
                  <p className="text-xs text-gray-400 mt-2 text-center">
                    Place a small test order (0.001 or minimum size) to verify trading permissions
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}
