import { useState } from 'react';
import api from '../services/api';
import { useError } from '../contexts/ErrorContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { ArrowPathIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

type APIKey = 'lunarcrush' | 'coinapi' | 'cryptoquant' | 'exchange';
type ExchangeName = 'binance' | 'bitget' | 'bingx' | 'weex';

interface APIOption {
  key: APIKey;
  name: string;
  icon: string;
  requiresSecret?: boolean;
  requiresPassphrase?: boolean;
  exchanges?: ExchangeName[];
}

const API_OPTIONS: APIOption[] = [
  { key: 'lunarcrush', name: 'LunarCrush', icon: '🌙' },
  { key: 'coinapi', name: 'CoinAPI', icon: '🪙' },
  { key: 'cryptoquant', name: 'CryptoQuant', icon: '📊' },
  { 
    key: 'exchange', 
    name: 'Exchange API', 
    icon: '⚡',
    requiresSecret: true,
    requiresPassphrase: true,
    exchanges: ['binance', 'bitget', 'bingx', 'weex'],
  },
];

export default function APIDiagnosticPanel() {
  const [selectedAPI, setSelectedAPI] = useState<APIKey | ''>('');
  const [selectedExchange, setSelectedExchange] = useState<ExchangeName>('binance');
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [testing, setTesting] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { showError, showSuccess } = useError();

  const selectedAPIOption = API_OPTIONS.find(opt => opt.key === selectedAPI);
  const requiresSecret = selectedAPIOption?.requiresSecret || false;
  const requiresPassphrase = selectedAPIOption?.requiresPassphrase || false;
  const showPassphrase = requiresPassphrase && (selectedExchange === 'bitget' || selectedExchange === 'weex');

  const handleAPISelect = (apiKey: APIKey) => {
    setSelectedAPI(apiKey);
    setDropdownOpen(false);
    // Clear credentials when switching APIs
    setApiKey('');
    setSecretKey('');
    setPassphrase('');
    setSelectedExchange('binance');
  };

  const handleTest = async () => {
    if (!selectedAPI) {
      showError('Please select an API to test', 'validation');
      return;
    }

    // Validate required fields
    if (!apiKey) {
      showError('API Key is required', 'validation');
      return;
    }

    if (requiresSecret && !secretKey) {
      showError('Secret Key is required for Exchange API', 'validation');
      return;
    }

    if (showPassphrase && !passphrase) {
      showError('Passphrase is required for this exchange', 'validation');
      return;
    }

    setTesting(true);
    try {
      const requestBody: any = {
        api: selectedAPI,
        apiKey,
      };

      if (selectedAPI === 'exchange') {
        requestBody.secretKey = secretKey;
        requestBody.passphrase = passphrase;
        requestBody.exchange = selectedExchange;
      }

      const response = await api.post('/diagnostics/test', requestBody);
      const result = response.data;

      if (result.success) {
        showSuccess('API Connected Successfully');
      } else {
        const errorMsg = result.error || 'API test failed';
        showError(errorMsg, 'api');
      }
    } catch (err: any) {
      suppressConsoleError(err, `apiDiagnostic-${selectedAPI}`);
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6 mb-6 max-w-md mx-auto">
      <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">API Diagnostic Panel</h2>
      <p className="text-sm text-gray-400 mb-4">
        Test API connectivity and credentials for integrated services.
      </p>

      {/* API Selection Dropdown */}
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-2">Select API to Test</label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-full px-3 py-2.5 text-sm bg-slate-900/50 border border-purple-500/30 rounded-lg text-white text-left flex items-center justify-between hover:border-purple-500/50 transition-all"
          >
            <span className="flex items-center space-x-2">
              {selectedAPIOption ? (
                <>
                  <span>{selectedAPIOption.icon}</span>
                  <span>{selectedAPIOption.name}</span>
                </>
              ) : (
                <span className="text-gray-500">Select an API...</span>
              )}
            </span>
            <ChevronDownIcon className={`w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {dropdownOpen && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute z-20 w-full mt-1 bg-slate-900/95 backdrop-blur-xl border border-purple-500/30 rounded-lg shadow-lg max-h-60 overflow-auto">
                {API_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleAPISelect(option.key)}
                    className="w-full px-3 py-2.5 text-sm text-left flex items-center space-x-2 hover:bg-purple-500/10 transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span>{option.icon}</span>
                    <span className="text-white">{option.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Dynamic Credential Inputs */}
      {selectedAPI && (
        <div className="space-y-3 mb-4">
          {/* Exchange Selector (only for Exchange API) */}
          {selectedAPI === 'exchange' && selectedAPIOption?.exchanges && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Exchange</label>
              <select
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value as ExchangeName)}
                className="w-full px-3 py-2 text-sm bg-slate-900/50 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                {selectedAPIOption.exchanges.map((ex) => (
                  <option key={ex} value={ex}>
                    {ex.charAt(0).toUpperCase() + ex.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* API Key Input */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-900/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              placeholder="Enter API Key"
            />
          </div>

          {/* Secret Key Input (only for Exchange API) */}
          {requiresSecret && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Secret Key</label>
              <input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-900/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                placeholder="Enter Secret Key"
              />
            </div>
          )}

          {/* Passphrase Input (only for Bitget/Weex) */}
          {showPassphrase && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-900/50 border border-purple-500/30 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                placeholder="Enter Passphrase"
              />
            </div>
          )}
        </div>
      )}

      {/* Test Button */}
      {selectedAPI && (
        <button
          onClick={handleTest}
          disabled={testing || !apiKey || (requiresSecret && !secretKey) || (showPassphrase && !passphrase)}
          className="w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20"
        >
          <ArrowPathIcon className={`w-4 h-4 mr-2 ${testing ? 'animate-spin' : ''}`} />
          {testing ? 'Testing...' : 'Test API'}
        </button>
      )}
    </div>
  );
}
