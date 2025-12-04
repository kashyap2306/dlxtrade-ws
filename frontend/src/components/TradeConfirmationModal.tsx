import React, { useState, useEffect } from 'react';
import NotificationModal from './NotificationModal';

interface TradeConfirmationModalProps {
  isOpen: boolean;
  coin: string;
  accuracy: number;
  onConfirm: (tradeData: TradeData) => void;
  onCancel: () => void;
  soundEnabled?: boolean;
}

interface TradeData {
  tradeSize: number;
  leverage: number;
  maxLoss: number;
}

const TradeConfirmationModal: React.FC<TradeConfirmationModalProps> = ({
  isOpen,
  coin,
  accuracy,
  onConfirm,
  onCancel,
  soundEnabled = false
}) => {
  const [tradeSize, setTradeSize] = useState(10);
  const [leverage, setLeverage] = useState(1);
  const [maxLoss, setMaxLoss] = useState(2);

  useEffect(() => {
    if (!isOpen) {
      // Reset to defaults when modal closes
      setTradeSize(10);
      setLeverage(1);
      setMaxLoss(2);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm({
      tradeSize,
      leverage,
      maxLoss
    });
  };

  const message = `Auto-Trade triggered for ${coin} with ${accuracy.toFixed(1)}% accuracy. Please confirm the trade parameters below.`;

  return (
    <NotificationModal
      isOpen={isOpen}
      type="confirm"
      title="Trade Confirmation Required"
      message={message}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      confirmText="Execute Trade"
      cancelText="Cancel Trade"
      soundEnabled={soundEnabled}
    >
      <div className="space-y-4 bg-slate-800/30 rounded-xl p-4 border border-slate-600/30">
        {/* Accuracy Display */}
        <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
          <span className="text-sm text-gray-300 font-medium">Accuracy Score:</span>
          <span className={`text-lg font-bold ${
            accuracy >= 90 ? 'text-green-400' :
            accuracy >= 80 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {accuracy.toFixed(1)}%
          </span>
        </div>

        {/* Trade Size */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Trade Size (% of Portfolio)
          </label>
          <input
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={tradeSize}
            onChange={(e) => setTradeSize(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400">Recommended: 5-15% based on risk tolerance</p>
        </div>

        {/* Leverage */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Leverage (1x - 10x)
          </label>
          <input
            type="number"
            min="1"
            max="10"
            step="0.1"
            value={leverage}
            onChange={(e) => setLeverage(parseFloat(e.target.value) || 1)}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400">Higher leverage increases both profit and risk</p>
        </div>

        {/* Max Loss */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Max Loss (% of Trade)
          </label>
          <input
            type="number"
            min="0.1"
            max="20"
            step="0.1"
            value={maxLoss}
            onChange={(e) => setMaxLoss(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400">Stop-loss percentage to limit downside risk</p>
        </div>

        {/* Risk Warning */}
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
          <p className="text-sm text-yellow-200 flex items-center gap-2">
            <span className="text-yellow-400">⚠️</span>
            <span>Trading involves risk. Ensure these parameters align with your risk tolerance.</span>
          </p>
        </div>
      </div>
    </NotificationModal>
  );
};

export default TradeConfirmationModal;
