import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import Toast from '../components/Toast';

export default function VWAPStrategy() {
  const { user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agentStatus, setAgentStatus] = useState<'STOPPED' | 'RUNNING'>('STOPPED');
  const [loading, setLoading] = useState(false);
  const [agentConfig, setAgentConfig] = useState<any | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Load agent control data on component mount
  useEffect(() => {
    const loadAgentControl = async () => {
      if (!user) return;

      try {
        const response = await agentsApi.getTradingAgentControl('vwap-strategy');
        setAgentStatus(response.data.status || 'STOPPED');
        setAgentConfig(response.data.config || null);
      } catch (error) {
        console.error('Error loading VWAP Strategy control:', error);
        setAgentStatus('STOPPED');
      }
    };

    loadAgentControl();
  }, [user]);

  const handleStartTrading = async () => {
    setLoading(true);
    try {
      await agentsApi.startTradingAgent('vwap-strategy');
      setAgentStatus('RUNNING');
      showToast('VWAP Strategy started successfully', 'success');
    } catch (error: any) {
      console.error('Error starting VWAP Strategy:', error);
      showToast(error.response?.data?.message || 'Failed to start VWAP Strategy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStopTrading = async () => {
    setLoading(true);
    try {
      await agentsApi.stopTradingAgent('vwap-strategy');
      setAgentStatus('STOPPED');
      showToast('VWAP Strategy stopped successfully', 'success');
    } catch (error: any) {
      console.error('Error stopping VWAP Strategy:', error);
      showToast(error.response?.data?.message || 'Failed to stop VWAP Strategy', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center mb-4">
              <span className="text-4xl mr-4">📈</span>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  VWAP Strategy
                </h1>
                <p className="text-gray-400 text-lg mt-1">
                  Institutional-grade VWAP mean reversion scalping strategy
                </p>
              </div>
            </div>
            <div className="h-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
          </div>

          {/* Strategy Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div className="card">
              <h2 className="text-2xl font-bold text-white mb-4">Strategy Overview</h2>
              <div className="space-y-4 text-gray-300">
                <p>
                  This institutional-grade VWAP mean reversion scalping strategy identifies
                  price deviations from the Volume Weighted Average Price (VWAP) and executes
                  trades based on mean reversion principles.
                </p>
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="bg-slate-800/50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-green-400">BTC/USDT</div>
                    <div className="text-sm text-gray-400">Primary Pair</div>
                  </div>
                  <div className="bg-slate-800/50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-400">ETH/USDT</div>
                    <div className="text-sm text-gray-400">Secondary Pair</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="text-2xl font-bold text-white mb-4">Key Features</h2>
              <ul className="space-y-3 text-gray-300">
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  VWAP Mean Reversion Signals
                </li>
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  EMA 200 Trend Filter
                </li>
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  ATR Volatility-Based Stops
                </li>
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  Session-Based Trading (London/NY)
                </li>
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  Risk Management (1% per trade)
                </li>
                <li className="flex items-center">
                  <span className="text-green-400 mr-3">✓</span>
                  QuantConnect Integration Ready
                </li>
              </ul>
            </div>
          </div>

          {/* Technical Details */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="card">
              <h3 className="text-xl font-bold text-white mb-3">Indicators</h3>
              <div className="space-y-2 text-gray-300">
                <div className="flex justify-between">
                  <span>VWAP</span>
                  <span className="text-purple-400">14-period</span>
                </div>
                <div className="flex justify-between">
                  <span>EMA</span>
                  <span className="text-purple-400">200-period</span>
                </div>
                <div className="flex justify-between">
                  <span>ATR</span>
                  <span className="text-purple-400">14-period</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-xl font-bold text-white mb-3">Risk Parameters</h3>
              <div className="space-y-2 text-gray-300">
                <div className="flex justify-between">
                  <span>Risk per Trade</span>
                  <span className="text-red-400">0.5-1%</span>
                </div>
                <div className="flex justify-between">
                  <span>Stop Distance</span>
                  <span className="text-red-400">1.2 × ATR</span>
                </div>
                <div className="flex justify-between">
                  <span>Max Daily Trades</span>
                  <span className="text-red-400">3</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-xl font-bold text-white mb-3">Trading Sessions</h3>
              <div className="space-y-2 text-gray-300">
                <div className="flex justify-between">
                  <span>London</span>
                  <span className="text-blue-400">8:00-16:59 UTC</span>
                </div>
                <div className="flex justify-between">
                  <span>New York</span>
                  <span className="text-blue-400">14:30-21:29 UTC</span>
                </div>
                <div className="flex justify-between">
                  <span>Timeframe</span>
                  <span className="text-blue-400">5-minute</span>
                </div>
              </div>
            </div>
          </div>

          {/* Entry/Exit Rules */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div className="card">
              <h3 className="text-xl font-bold text-green-400 mb-4">Long Entry Rules</h3>
              <div className="space-y-3 text-gray-300">
                <div className="flex items-start">
                  <span className="text-green-400 mr-3 mt-1">1.</span>
                  <span>Price above EMA 200 (bullish bias)</span>
                </div>
                <div className="flex items-start">
                  <span className="text-green-400 mr-3 mt-1">2.</span>
                  <span>Price below VWAP (reversion opportunity)</span>
                </div>
                <div className="flex items-start">
                  <span className="text-green-400 mr-3 mt-1">3.</span>
                  <span>Deviation ≥ 0.6% (BTC) / 0.8% (ETH)</span>
                </div>
                <div className="flex items-start">
                  <span className="text-green-400 mr-3 mt-1">4.</span>
                  <span>Bullish rejection candle confirmation</span>
                </div>
                <div className="flex items-start">
                  <span className="text-green-400 mr-3 mt-1">5.</span>
                  <span>Entry at candle close</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-xl font-bold text-red-400 mb-4">Exit Rules</h3>
              <div className="space-y-3 text-gray-300">
                <div className="flex items-start">
                  <span className="text-red-400 mr-3 mt-1">•</span>
                  <span>Primary: Take profit at VWAP level</span>
                </div>
                <div className="flex items-start">
                  <span className="text-red-400 mr-3 mt-1">•</span>
                  <span>Stop Loss: 1.2 × ATR from entry</span>
                </div>
                <div className="flex items-start">
                  <span className="text-red-400 mr-3 mt-1">•</span>
                  <span>Optional: Trail remaining position</span>
                </div>
                <div className="flex items-start">
                  <span className="text-red-400 mr-3 mt-1">•</span>
                  <span>No averaging, no martingale</span>
                </div>
              </div>
            </div>
          </div>

          {/* Strategy Status & Controls */}
          <div className="card">
            <h3 className="text-xl font-bold text-white mb-4">Strategy Status & Controls</h3>
            <div className="bg-slate-800/50 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-300">Current Status:</span>
                <span className={`px-3 py-1 rounded-full text-sm ${
                  agentStatus === 'RUNNING'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {agentStatus === 'RUNNING' ? 'RUNNING' : 'STOPPED'}
                </span>
              </div>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={handleStartTrading}
                  disabled={agentStatus === 'RUNNING' || loading}
                  className="btn btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Starting...' : 'Start Auto Trading'}
                </button>
                <button
                  onClick={handleStopTrading}
                  disabled={agentStatus === 'STOPPED' || loading}
                  className="btn btn-danger flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Stopping...' : 'Stop Auto Trading'}
                </button>
              </div>

              <p className="text-gray-400 text-sm">
                This VWAP Mean Reversion strategy is fully integrated with the trading execution engine.
                When started, it will continuously monitor market conditions and execute trades according
                to the VWAP strategy rules with proper risk management.
              </p>
            </div>
          </div>

          {/* QuantConnect Code Preview */}
          <div className="card mt-8">
            <h3 className="text-xl font-bold text-white mb-4">QuantConnect Algorithm Preview</h3>
            <div className="bg-slate-900 p-4 rounded-lg overflow-x-auto">
              <pre className="text-green-400 text-sm">
{`class VWAPMeanReversionScalper(QCAlgorithm):
    def Initialize(self):
        # VWAP(14), EMA(200), ATR(14) strategy
        # Session filters: London 8:00-16:59 UTC, NY 14:30-21:29 UTC
        # Risk: 0.5-1% per trade, 1.2 ATR stops
        # Assets: BTC/USDT, ETH/USDT`}
              </pre>
            </div>
            <p className="text-gray-400 text-sm mt-4">
              Complete QuantConnect algorithm code is available for deployment.
              Includes backtesting-ready implementation with all safety measures.
            </p>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}