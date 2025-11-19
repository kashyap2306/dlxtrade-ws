import React, { memo } from 'react';

interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number;
  maxConcurrentTrades: number;
  maxDailyLossPct: number;
  stopLossPct: number;
  takeProfitPct: number;
}

interface ConfigCardProps {
  config: AutoTradeConfig;
  loading: boolean;
  isApiConnected: boolean;
  onUpdate: (updates: Partial<AutoTradeConfig>) => void;
  onSave: (updates: Partial<AutoTradeConfig>) => Promise<void>;
  onEnableToggle: (enabled: boolean) => Promise<void>;
  isConfigValid: boolean;
}

export default memo(function ConfigCard({ 
  config, 
  loading, 
  isApiConnected,
  onUpdate, 
  onSave,
  onEnableToggle,
  isConfigValid 
}: ConfigCardProps) {
  const handleSave = async () => {
    await onSave(config);
  };

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
      <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
        Trading Configuration
      </h2>

      <div className="space-y-4">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-3 bg-black/40 rounded-lg">
          <span className="text-sm text-gray-300">Enable Auto-Trade</span>
          <button
            onClick={() => onEnableToggle(!config.autoTradeEnabled)}
            disabled={loading}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              config.autoTradeEnabled ? 'bg-green-500' : 'bg-gray-600'
            } ${!isApiConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={config.autoTradeEnabled ? 'Disable Auto-Trade' : 'Enable Auto-Trade'}
            title={!isApiConnected ? 'Connect exchange API first' : ''}
          >
            <span
              className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                config.autoTradeEnabled ? 'translate-x-6' : ''
              }`}
            />
          </button>
        </div>
        {!isApiConnected && (
          <p className="text-xs text-yellow-400 -mt-2">
            Connect your exchange API to enable Auto-Trade
          </p>
        )}

        {/* Risk Settings */}
        <div className="space-y-3 pt-3 border-t border-purple-500/20">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Per-Trade Risk (%)
            </label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={config.perTradeRiskPct}
              onChange={(e) => onUpdate({ perTradeRiskPct: parseFloat(e.target.value) || 0 })}
              disabled={loading}
              className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max Concurrent Trades
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={config.maxConcurrentTrades}
              onChange={(e) => onUpdate({ maxConcurrentTrades: parseInt(e.target.value) || 0 })}
              disabled={loading}
              className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max Daily Loss (%)
            </label>
            <input
              type="number"
              min="0.5"
              max="50"
              step="0.5"
              value={config.maxDailyLossPct}
              onChange={(e) => onUpdate({ maxDailyLossPct: parseFloat(e.target.value) || 0 })}
              disabled={loading}
              className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Stop Loss (%)
            </label>
            <input
              type="number"
              min="0.5"
              max="10"
              step="0.1"
              value={config.stopLossPct}
              onChange={(e) => onUpdate({ stopLossPct: parseFloat(e.target.value) || 0 })}
              disabled={loading}
              className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Take Profit (%)
            </label>
            <input
              type="number"
              min="0.5"
              max="20"
              step="0.1"
              value={config.takeProfitPct}
              onChange={(e) => onUpdate({ takeProfitPct: parseFloat(e.target.value) || 0 })}
              disabled={loading}
              className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Save Configuration Button */}
        <div className="pt-4 border-t border-purple-500/20">
          <button
            onClick={handleSave}
            disabled={loading || !isConfigValid}
            className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
});
