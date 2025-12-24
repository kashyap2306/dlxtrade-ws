import React from 'react';

interface TradeSkipPopupProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    symbol: string;
    accuracy: number;
    accuracyTrigger: number;
    skipReasons: string[];
    timestamp: string;
  };
}

export default function TradeSkipPopup({ isOpen, onClose, data }: TradeSkipPopupProps) {
  if (!isOpen) return null;

  // Format skip reasons for display
  const formatSkipReason = (reason: string): string => {
    // Remove prefix codes (e.g., "LOW_RR:", "EXTREME_VOLATILITY:")
    const cleaned = reason.replace(/^[A-Z_]+:\s*/, '');
    
    // Map common reason codes to user-friendly messages
    if (reason.includes('LOW_RR') || reason.includes('Risk-Reward')) {
      return 'Risk-Reward ratio too low (< 1.2 minimum)';
    }
    if (reason.includes('EXTREME_VOLATILITY') || reason.includes('ATR')) {
      return 'High volatility (ATR ≥ 95%)';
    }
    if (reason.includes('COOLDOWN')) {
      return 'Cooldown period active';
    }
    if (reason.includes('DAILY_LOSS_LIMIT')) {
      return 'Daily loss limit reached';
    }
    if (reason.includes('NOT_TOP_25')) {
      return 'Coin not in top 25 high-liquidity non-stablecoins';
    }
    if (reason.includes('OPEN_POSITION_EXISTS')) {
      return 'Open position already exists for this coin';
    }
    if (reason.includes('MAX_CONCURRENT_TRADES')) {
      return 'Maximum concurrent trades limit reached';
    }
    if (reason.includes('MAX_TRADES_PER_DAY')) {
      return 'Maximum trades per day limit reached';
    }
    if (reason.includes('INVALID_ENTRY_ZONE') || reason.includes('BUY near resistance') || reason.includes('SELL near support')) {
      return 'Invalid entry zone (BUY near resistance or SELL near support)';
    }
    
    return cleaned || reason;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Trade Skipped</h3>
              <p className="text-sm text-slate-400">Accuracy trigger met but trade was not executed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-800"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Coin & Accuracy Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Coin</div>
              <div className="text-lg font-bold text-white">{data.symbol}</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Accuracy</div>
              <div className="text-lg font-bold text-emerald-400">{data.accuracy.toFixed(1)}%</div>
            </div>
          </div>

          {/* Accuracy Trigger Info */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Your Accuracy Trigger</span>
              <span className="text-sm font-semibold text-blue-400">{data.accuracyTrigger}%</span>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Accuracy threshold was met, but trade was blocked by risk guards
            </div>
          </div>

          {/* Skip Reasons */}
          <div>
            <div className="text-sm font-semibold text-slate-300 mb-2">Blocking Reasons:</div>
            <div className="space-y-2">
              {data.skipReasons.length > 0 ? (
                data.skipReasons.map((reason, index) => (
                  <div
                    key={index}
                    className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2"
                  >
                    <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <div className="text-sm text-slate-300 flex-1">{formatSkipReason(reason)}</div>
                  </div>
                ))
              ) : (
                <div className="bg-slate-800/50 rounded-lg p-3 text-sm text-slate-400">
                  No specific reason provided
                </div>
              )}
            </div>
          </div>

          {/* Timestamp */}
          <div className="text-xs text-slate-500 text-center pt-2 border-t border-slate-700">
            Research cycle: {new Date(data.timestamp).toLocaleString()}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

