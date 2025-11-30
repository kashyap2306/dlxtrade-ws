import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Toast from './Toast';
import {
  CheckCircleIcon,
  XCircleIcon,
  KeyIcon,
  LockClosedIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

type ExchangeName = 'binance' | 'bitget' | 'weex' | 'bingx';

interface ExchangeConfig {
  exchange: ExchangeName;
  apiKey: string;
  secret: string;
  passphrase?: string;
  testnet: boolean;
}

const EXCHANGE_INFO: Record<ExchangeName, { name: string; requiresPassphrase: boolean; description: string }> = {
  binance: {
    name: 'Binance',
    requiresPassphrase: false,
    description: 'World\'s largest cryptocurrency exchange',
  },
  bitget: {
    name: 'Bitget',
    requiresPassphrase: true,
    description: 'Leading crypto derivatives exchange',
  },
  weex: {
    name: 'WEEX',
    requiresPassphrase: false,
    description: 'Professional crypto trading platform',
  },
  bingx: {
    name: 'BingX',
    requiresPassphrase: false,
    description: 'Social trading platform',
  },
};

export default function ExchangeConfigSection() {
  const { user } = useAuth();
  const [selectedExchange, setSelectedExchange] = useState<ExchangeName>('binance');
  const [config, setConfig] = useState<ExchangeConfig>({
    exchange: 'binance',
    apiKey: '',
    secret: '',
    passphrase: '',
    testnet: true,
  });
  const [savedConfig, setSavedConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (user) {
      loadSavedConfig();
    }
  }, [user]);

  const loadSavedConfig = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await api.get(`/users/${user.uid}/exchange-config`);
      if (response.data) {
        setSavedConfig(response.data);
        if (response.data.exchange) {
          setSelectedExchange(response.data.exchange);
          setConfig((prev) => ({ ...prev, exchange: response.data.exchange }));
        }
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error('Error loading exchange config:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExchangeChange = (exchange: ExchangeName) => {
    setSelectedExchange(exchange);
    setConfig({
      exchange,
      apiKey: '',
      secret: '',
      passphrase: '',
      testnet: true,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const exchangeInfo = EXCHANGE_INFO[selectedExchange];
    if (!config.apiKey || !config.secret) {
      showToast('API key and secret are required', 'error');
      return;
    }
    if (exchangeInfo.requiresPassphrase && !config.passphrase) {
      showToast('Passphrase is required for this exchange', 'error');
      return;
    }

    try {
      setLoading(true);
      await api.post(`/users/${user.uid}/exchange-config`, {
        exchange: selectedExchange,
        apiKey: config.apiKey,
        secret: config.secret,
        passphrase: exchangeInfo.requiresPassphrase ? config.passphrase : undefined,
        testnet: config.testnet,
      });
      showToast('Exchange configuration saved successfully', 'success');
      await loadSavedConfig();
      // Clear form
      setConfig({
        exchange: selectedExchange,
        apiKey: '',
        secret: '',
        passphrase: '',
        testnet: true,
      });
    } catch (err: any) {
      console.error('Error saving exchange config:', err);
      showToast(err.response?.data?.error || 'Error saving exchange configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!user) return;

    const exchangeInfo = EXCHANGE_INFO[selectedExchange];
    if (!config.apiKey || !config.secret) {
      showToast('Please enter API key and secret first', 'error');
      return;
    }
    if (exchangeInfo.requiresPassphrase && !config.passphrase) {
      showToast('Please enter passphrase first', 'error');
      return;
    }

    try {
      setTesting(true);
      const response = await api.post('/exchange/test', {
        exchange: selectedExchange,
        apiKey: config.apiKey,
        secret: config.secret,
        passphrase: exchangeInfo.requiresPassphrase ? config.passphrase : undefined,
        testnet: config.testnet,
      });
      
      if (response.data.success) {
        showToast(`Connection successful: ${response.data.message}`, 'success');
      } else {
        showToast(`Connection failed: ${response.data.message}`, 'error');
      }
    } catch (err: any) {
      console.error('Error testing connection:', err);
      showToast(err.response?.data?.error || err.response?.data?.message || 'Error testing connection', 'error');
    } finally {
      setTesting(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const exchangeInfo = EXCHANGE_INFO[selectedExchange];

  return (
    <>
      <div className="border-t border-purple-500/20 pt-6 mt-6">
        <h3 className="text-lg font-semibold text-white mb-4">Exchange Configuration</h3>
        <p className="text-sm text-gray-400 mb-6">
          Configure your exchange API credentials for Deep Research. Credentials are encrypted and stored securely.
        </p>

        {savedConfig && (
          <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center space-x-2">
              <CheckCircleIcon className="w-5 h-5 text-green-400" />
              <span className="text-sm text-green-300">
                {EXCHANGE_INFO[savedConfig.exchange as ExchangeName]?.name || savedConfig.exchange} configured
                {savedConfig.testnet ? ' (Testnet)' : ' (Live)'}
              </span>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Select Exchange <span className="text-red-400">*</span>
            </label>
            <select
              className="w-full px-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              value={selectedExchange}
              onChange={(e) => handleExchangeChange(e.target.value as ExchangeName)}
              disabled={loading}
            >
              {Object.entries(EXCHANGE_INFO).map(([key, info]) => (
                <option key={key} value={key}>
                  {info.name} - {info.description}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{exchangeInfo.description}</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              API Key <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <KeyIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
              <input
                type="text"
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="Enter your API key"
                required
                disabled={loading}
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
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                value={config.secret}
                onChange={(e) => setConfig({ ...config, secret: e.target.value })}
                placeholder="Enter your secret key"
                required
                disabled={loading}
              />
            </div>
          </div>

          {exchangeInfo.requiresPassphrase && (
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Passphrase <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <LockClosedIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-purple-400" />
                <input
                  type="password"
                  className="w-full pl-10 pr-3 py-2.5 text-sm bg-slate-800/50 backdrop-blur-sm border border-purple-500/30 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  value={config.passphrase}
                  onChange={(e) => setConfig({ ...config, passphrase: e.target.value })}
                  placeholder="Enter your passphrase"
                  required
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Required for {exchangeInfo.name}</p>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="testnet"
              checked={config.testnet}
              onChange={(e) => setConfig({ ...config, testnet: e.target.checked })}
              disabled={loading}
              className="w-4 h-4 text-purple-600 bg-slate-800 border-purple-500 rounded focus:ring-purple-500"
            />
            <label htmlFor="testnet" className="text-sm text-gray-300">
              Use Testnet (Recommended for testing)
            </label>
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
              type="submit"
              disabled={loading || testing}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/50"
            >
              {loading ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  );
}

