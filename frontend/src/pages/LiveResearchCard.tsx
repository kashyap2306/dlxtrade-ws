import React from 'react';
import { canExecute } from './ResearchPanelUtils';

interface LiveData {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
}

interface Settings {
  strategy?: string;
  minAccuracyThreshold?: number;
  autoTradeEnabled?: boolean;
}

interface LiveResearchCardProps {
  liveData: LiveData | null;
  settings?: Settings;
}

const LiveResearchCard: React.FC<LiveResearchCardProps> = ({
  liveData,
  settings
}) => {
  if (!liveData) {
    return null;
  }

  return (
    <div className="relative bg-gradient-to-br from-slate-900/60 via-slate-800/60 to-slate-900/60 backdrop-blur-xl border border-cyan-500/40 rounded-3xl p-8 shadow-2xl shadow-cyan-500/20 hover:shadow-cyan-500/30 transition-all duration-500 overflow-hidden">
      {/* Gradient accent line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-t-3xl"></div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-1">
            Live Research
          </h2>
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
            Real-time market monitoring
          </p>
        </div>
      </div>
      <div className="bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-400/30 rounded-2xl p-6 mb-4 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
            <div>
              <div className="text-sm text-slate-400">Symbol</div>
              <div className="font-semibold text-white text-lg">{liveData.symbol}</div>
            </div>
            <div>
              <div className="text-sm text-slate-400">Signal</div>
              <div className={`font-semibold text-lg ${liveData.signal === 'BUY' ? 'text-green-400' :
                liveData.signal === 'SELL' ? 'text-red-400' :
                  'text-slate-400'
                }`}>
                {liveData.signal}
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-400">Accuracy</div>
              <div className={`font-semibold text-lg ${liveData.accuracy >= 0.85 ? 'text-green-400' :
                liveData.accuracy >= 0.7 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                {((liveData.accuracy ?? 0) * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-400">Imbalance</div>
              <div className="font-semibold text-white text-lg">
                {((liveData.orderbookImbalance ?? 0) * 100).toFixed(2)}%
              </div>
            </div>
          </div>
          <div className="ml-4">
            {canExecute(liveData.accuracy, settings) && liveData.signal !== 'HOLD' ? (
              <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-green-500/20 text-green-300 border border-green-400/30 shadow-lg shadow-green-500/10">
                ✓ Can Execute
              </span>
            ) : (
              <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-400/30">
                ⏸ Will Skip
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-blue-400/20">
          <div className="text-sm text-slate-400">Recommended Action</div>
          <div className="font-medium text-white text-lg">{liveData.recommendedAction}</div>
          {settings && (
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
              <span>Strategy: <span className="text-slate-300">{settings.strategy || 'orderbook_imbalance'}</span></span>
              <span>Threshold: <span className="text-slate-300">{(settings.minAccuracyThreshold || 0.85) * 100}%</span></span>
              <span>Auto-Trade: <span className="text-slate-300">{settings.autoTradeEnabled ? 'Enabled' : 'Disabled'}</span></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveResearchCard;
