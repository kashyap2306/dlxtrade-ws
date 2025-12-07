import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../services/api';
import Toast from './Toast';
import SuccessPopup from './SuccessPopup';
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
  XMarkIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  BinanceLogo,
  BybitLogo,
  KuCoinLogo,
  OKXLogo,
  CoinbaseLogo,
  BitgetLogo,
  KrakenLogo,
  GateIOLogo,
  BingXLogo,
  WEEXLogo,
} from './exchangeLogos';

type ExchangeName = 'binance' | 'bybit' | 'kucoin' | 'okx' | 'coinbase' | 'bitget' | 'kraken' | 'gateio' | 'bingx' | 'weex';

interface ExchangeInfo {
  name: string;
  requiresPassphrase: boolean;
  description: string;
  LogoComponent: React.ComponentType<{ className?: string }>;
  gradient: string;
}

const EXCHANGE_INFO: Record<ExchangeName, ExchangeInfo> = {
  binance: {
    name: 'Binance',
    requiresPassphrase: false,
    description: 'World\'s largest cryptocurrency exchange',
    LogoComponent: BinanceLogo,
    gradient: 'from-yellow-500/20 via-orange-500/20 to-red-500/20',
  },
  bybit: {
    name: 'Bybit',
    requiresPassphrase: false,
    description: 'Leading crypto derivatives exchange',
    LogoComponent: BybitLogo,
    gradient: 'from-blue-500/20 via-cyan-500/20 to-teal-500/20',
  },
  kucoin: {
    name: 'KuCoin',
    requiresPassphrase: true,
    description: 'Global cryptocurrency exchange',
    LogoComponent: KuCoinLogo,
    gradient: 'from-green-500/20 via-emerald-500/20 to-teal-500/20',
  },
  okx: {
    name: 'OKX',
    requiresPassphrase: true,
    description: 'Professional crypto trading platform',
    LogoComponent: OKXLogo,
    gradient: 'from-purple-500/20 via-pink-500/20 to-rose-500/20',
  },
  coinbase: {
    name: 'Coinbase',
    requiresPassphrase: true,
    description: 'Secure crypto exchange platform',
    LogoComponent: CoinbaseLogo,
    gradient: 'from-indigo-500/20 via-blue-500/20 to-cyan-500/20',
  },
  bitget: {
    name: 'Bitget',
    requiresPassphrase: true,
    description: 'Leading crypto derivatives exchange',
    LogoComponent: BitgetLogo,
    gradient: 'from-orange-500/20 via-red-500/20 to-pink-500/20',
  },
  kraken: {
    name: 'Kraken',
    requiresPassphrase: false,
    description: 'Secure cryptocurrency exchange',
    LogoComponent: KrakenLogo,
    gradient: 'from-blue-500/20 via-indigo-500/20 to-purple-500/20',
  },
  gateio: {
    name: 'Gate.io',
    requiresPassphrase: false,
    description: 'Global crypto trading platform',
    LogoComponent: GateIOLogo,
    gradient: 'from-teal-500/20 via-cyan-500/20 to-blue-500/20',
  },
  bingx: {
    name: 'BingX',
    requiresPassphrase: false,
    description: 'Social trading platform',
    LogoComponent: BingXLogo,
    gradient: 'from-green-500/20 via-emerald-500/20 to-teal-500/20',
  },
  weex: {
    name: 'WEEX',
    requiresPassphrase: false,
    description: 'Professional crypto trading platform',
    LogoComponent: WEEXLogo,
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

type ModalStep = 'selection' | 'form';

export default function ExchangeAccountsSection() {
  const { user } = useAuth();
  const [currentExchange, setCurrentExchange] = useState<ExchangeName | null>(null);
  const [selectedExchange, setSelectedExchange] = useState<ExchangeName | null>(null);
  const [savedConfig, setSavedConfig] = useState<SavedConfig | null>(null);
  const [credentials, setCredentials] = useState<ExchangeCredentials>({
    apiKey: '',
    secretKey: '',
    passphrase: '',
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTrading, setTestTrading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalStep, setModalStep] = useState<ModalStep>('selection');
  const { showError } = useError();
  const { addNotification } = useNotificationContext();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      loadSavedConfig();
    }
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        handleCloseModal();
      }
    };

    if (showModal) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [showModal]);

  const loadSavedConfig = async () => {
    if (!user) return;
    try {
      const response = await api.get(`/users/${user.uid}/exchange-config`);
      if (response.data && response.data.exchange) {
        const exchange = response.data.exchange as ExchangeName;
        setCurrentExchange(exchange);
        setSavedConfig({
          exchange,
          testnet: response.data.testnet ?? true,
          lastTested: response.data.lastTested,
        });
      } else {
        setCurrentExchange(null);
        setSavedConfig(null);
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        suppressConsoleError(err, 'loadExchangeConfig');
      } else {
        setCurrentExchange(null);
        setSavedConfig(null);
      }
    }
  };

  const handleOpenModal = () => {
    setShowModal(true);
    setModalStep('selection');
    setSelectedExchange(null);
    setCredentials({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setModalStep('selection');
    setSelectedExchange(null);
    setCredentials({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleExchangeSelect = (exchange: ExchangeName) => {
    setSelectedExchange(exchange);
  };

  const handleContinueToForm = () => {
    if (selectedExchange) {
      setModalStep('form');
    }
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
      const response = await api.post('/api/exchange/test', {
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
      // Save via exchange-config endpoint
      await api.post(`/users/${user.uid}/exchange-config`, {
        exchange: selectedExchange,
        type: selectedExchange,
        apiKey: credentials.apiKey,
        secret: credentials.secretKey,
        passphrase: exchangeInfo.requiresPassphrase ? credentials.passphrase : undefined,
        testnet: true,
      });
      
      // Also save to integrations for consistency
      const { integrationsApi } = await import('../services/api');
      await integrationsApi.update({
        apiName: selectedExchange,
        enabled: true,
        apiKey: credentials.apiKey,
        secretKey: credentials.secretKey,
      });
      
      // Show success popup
      setSuccessMessage('Exchange API connected successfully');
      setShowSuccessPopup(true);
      
      showToast('Exchange credentials saved successfully', 'success');
      await addNotification({
        title: 'Exchange Credentials Updated',
        message: `${exchangeInfo.name} credentials saved and encrypted`,
        type: 'success',
      });
      
      // Reload config to update status immediately
      await loadSavedConfig();
      handleCloseModal();
    } catch (err: any) {
      suppressConsoleError(err, 'saveExchangeConfig');
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleTestTrade = async () => {
    if (!selectedExchange || !user || !savedConfig) {
      showError('Exchange not configured', 'exchange');
      return;
    }

    try {
      setTestTrading(true);
      const response = await api.post('/api/exchange/test-trade', {
        exchange: selectedExchange,
        symbol: 'BTCUSDT',
        side: 'BUY',
        quantity: 0.001,
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

  const getMaskedApiKey = (apiKey: string | null | undefined) => {
    if (!apiKey) return null;
    if (apiKey.length <= 4) return apiKey;
    return `****${apiKey.slice(-4)}`;
  };

  return (
    <>
      <div className="border-t border-purple-500/20 pt-6 mt-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">Exchange Accounts</h3>
            <p className="text-sm text-gray-400">
              Connect your trading exchange account to enable real trading. Only one exchange can be active at a time.
            </p>
          </div>
          <button
            onClick={handleOpenModal}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/40 hover:shadow-purple-500/60"
          >
            <PlusIcon className="w-5 h-5" />
            Add Exchange
          </button>
        </div>

        {/* Connected Exchange Display */}
        {currentExchange && savedConfig && (
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-purple-500/30 shadow-2xl p-6">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
                {React.createElement(EXCHANGE_INFO[currentExchange].LogoComponent, { className: 'w-full h-full' })}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <h3 className="text-xl font-semibold text-white">{EXCHANGE_INFO[currentExchange].name}</h3>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                    <CheckCircleIcon className="w-3 h-3 mr-1" />
                    Connected
                  </span>
                </div>
                <p className="text-sm text-gray-300 mb-2">{EXCHANGE_INFO[currentExchange].description}</p>
                <div className="text-xs text-gray-400">
                  API Key: {getMaskedApiKey(savedConfig.apiKey) || 'N/A'}
                  {savedConfig.testnet && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                      Testnet
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            ref={modalRef}
            className="bg-slate-800 border border-purple-500/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-purple-500/30 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">
                  {modalStep === 'selection' ? 'Select Exchange' : `${EXCHANGE_INFO[selectedExchange!]?.name} API Setup`}
                </h3>
                <p className="text-sm text-gray-400 mt-1">
                  {modalStep === 'selection' 
                    ? 'Choose an exchange to connect' 
                    : 'Enter your API credentials'}
                </p>
              </div>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {modalStep === 'selection' ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                    {(Object.keys(EXCHANGE_INFO) as ExchangeName[]).map((exchange) => {
                      const info = EXCHANGE_INFO[exchange];
                      const isSelected = selectedExchange === exchange;

                      const LogoComponent = info.LogoComponent;
                      return (
                        <button
                          key={exchange}
                          onClick={() => handleExchangeSelect(exchange)}
                          className={`relative p-4 rounded-xl border-2 transition-all duration-300 ${
                            isSelected
                              ? 'border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/30 scale-105'
                              : 'border-purple-500/30 bg-gradient-to-br ' + info.gradient + ' hover:border-purple-500/50 hover:scale-102'
                          }`}
                        >
                          <div className="w-12 h-12 mb-2 flex items-center justify-center mx-auto">
                            <LogoComponent className="w-full h-full" />
                          </div>
                          <div className="text-sm font-semibold text-white">{info.name}</div>
                          {isSelected && (
                            <div className="absolute top-2 right-2">
                              <CheckCircleIcon className="w-5 h-5 text-purple-400" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {selectedExchange && (
                    <div className="flex justify-end">
                      <button
                        onClick={handleContinueToForm}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg"
                      >
                        Continue
                        <ChevronRightIcon className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {selectedExchange && (
                    <>
                      <div className="mb-6 p-4 bg-gradient-to-br from-slate-700/50 to-slate-800/50 rounded-xl border border-purple-500/30">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 flex items-center justify-center">
                            {React.createElement(EXCHANGE_INFO[selectedExchange].LogoComponent, { className: 'w-full h-full' })}
                          </div>
                          <div>
                            <h4 className="text-lg font-semibold text-white">
                              {EXCHANGE_INFO[selectedExchange].name}
                            </h4>
                            <p className="text-sm text-gray-400">
                              {EXCHANGE_INFO[selectedExchange].description}
                            </p>
                          </div>
                        </div>
                      </div>

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
                            onClick={() => setModalStep('selection')}
                            className="px-4 py-2.5 text-sm font-medium text-gray-200 bg-slate-700/50 backdrop-blur-sm border border-purple-500/30 rounded-lg hover:bg-slate-700/70 transition-all"
                          >
                            Back
                          </button>
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
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
      
      {showSuccessPopup && (
        <SuccessPopup
          message={successMessage}
          onClose={() => setShowSuccessPopup(false)}
        />
      )}
    </>
  );
}
