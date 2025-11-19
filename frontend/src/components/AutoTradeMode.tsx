import { useState } from 'react';
import { useAutoTradeMode } from '../hooks/useAutoTradeMode';
import Toast from './Toast';

interface AutoTradeModeProps {
  onStatusChange?: (enabled: boolean) => void;
}

export default function AutoTradeMode({ onStatusChange }: AutoTradeModeProps) {
  const {
    enabled,
    isApiConnected,
    allRequiredAPIsConnected,
    missingAPIs,
    loading,
    checking,
    toggle,
    canEnable,
  } = useAutoTradeMode();
  
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const handleToggle = async () => {
    try {
      await toggle();
      const newEnabled = !enabled;
      onStatusChange?.(newEnabled);
      
      setToast({
        message: newEnabled 
          ? 'Auto-Trade Mode enabled. Agent will execute trades when accuracy > 75%.' 
          : 'Auto-Trade Mode disabled.',
        type: 'success',
      });
    } catch (err: any) {
      const errorMessage = err.message || err.response?.data?.error || 'Failed to toggle Auto-Trade Mode';
      setToast({
        message: errorMessage,
        type: 'error',
      });
    }
  };

  return (
    <>
      <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
              Enable Auto-Trade Mode
            </h2>
            <p className="text-xs sm:text-sm text-gray-400">
              Agent will run research every cycle and execute trades when accuracy &gt; 75%
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Status Indicators */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`p-3 rounded-xl border ${
              isApiConnected 
                ? 'bg-green-500/10 border-green-400/30' 
                : 'bg-red-500/10 border-red-400/30'
            }`}>
              <div className="text-xs text-gray-400 mb-1">Exchange API</div>
              <div className={`text-sm font-semibold ${
                isApiConnected ? 'text-green-400' : 'text-red-400'
              }`}>
                {isApiConnected ? 'Connected' : 'Not Connected'}
              </div>
            </div>
            <div className={`p-3 rounded-xl border ${
              allRequiredAPIsConnected 
                ? 'bg-green-500/10 border-green-400/30' 
                : 'bg-yellow-500/10 border-yellow-400/30'
            }`}>
              <div className="text-xs text-gray-400 mb-1">Required APIs</div>
              <div className={`text-sm font-semibold ${
                allRequiredAPIsConnected ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {allRequiredAPIsConnected ? 'All Connected' : 'Missing APIs'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-purple-500/20 bg-black/40">
              <div className="text-xs text-gray-400 mb-1">Mode Status</div>
              <div className={`text-sm font-semibold ${
                enabled ? 'text-green-400' : 'text-gray-400'
              }`}>
                {enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-purple-500/20 bg-black/40">
              <div className="text-xs text-gray-400 mb-1">Accuracy Threshold</div>
              <div className="text-sm font-semibold text-purple-400">
                &gt; 75%
              </div>
            </div>
          </div>

          {/* Toggle Button */}
          <button
            onClick={handleToggle}
            disabled={loading || checking || (!enabled && !canEnable)}
            className={`w-full px-6 py-4 rounded-xl font-semibold text-lg transition-all duration-300 shadow-lg ${
              enabled
                ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white'
                : canEnable
                ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white'
                : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
            } disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3`}
          >
            {loading || checking ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                {checking ? 'Checking...' : 'Updating...'}
              </>
            ) : enabled ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Disable Auto-Trade Mode
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Enable Auto-Trade Mode
              </>
            )}
          </button>

          {!canEnable && !enabled && (
            <p className="text-xs text-yellow-400 text-center">
              Connect exchange API and all required APIs (CryptoQuant, LunarCrush, CoinAPI) to enable
            </p>
          )}
        </div>
      </div>

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type}
        />
      )}
    </>
  );
}

