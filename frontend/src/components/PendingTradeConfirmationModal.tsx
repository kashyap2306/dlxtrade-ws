import React from 'react';
import NotificationModal from './NotificationModal';

interface PendingTrade {
  id: string;
  requestId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  accuracy?: number;
  strategy?: string;
  createdAt?: string;
  expiresAt?: string;
}

interface PendingTradeConfirmationModalProps {
  isOpen: boolean;
  trade: PendingTrade | null;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  isProcessing?: boolean;
}

const PendingTradeConfirmationModal: React.FC<PendingTradeConfirmationModalProps> = ({
  isOpen,
  trade,
  onApprove,
  onReject,
  isProcessing = false,
}) => {
  if (!trade) return null;

  const handleApprove = () => {
    onApprove(trade.requestId || trade.id);
  };

  const handleReject = () => {
    if (!isProcessing) {
      onReject(trade.requestId || trade.id);
    }
  };

  const sideColor = trade.side === 'BUY' ? 'text-green-400' : 'text-red-400';
  const sideBg = trade.side === 'BUY' ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30';

  const isExpired = trade.expiresAt ? new Date(trade.expiresAt) < new Date() : false;

  return (
    <NotificationModal
      isOpen={isOpen}
      type={isExpired ? "alert" : "confirm"}
      title={isExpired ? "Trade Expired" : "Trade Confirmation Required"}
      message={isExpired
        ? "This trade signal has expired. Please re-run research to get updated entry points."
        : `A pending trade has been detected. Please review the details below and confirm or reject.`
      }
      onConfirm={isExpired ? undefined : handleApprove}
      onCancel={isProcessing ? undefined : handleReject}
      confirmText={isExpired ? "Expired" : (isProcessing ? "Processing..." : "Approve Trade")}
      cancelText={isExpired ? "Close" : (isProcessing ? "Processing..." : "Reject Trade")}
      soundEnabled={!isExpired}
    >
      <div className="space-y-4 bg-slate-800/30 rounded-xl p-4 border border-slate-600/30">
        {/* Symbol and Side */}
        <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
          <span className="text-sm text-gray-300 font-medium">Symbol:</span>
          <span className="text-lg font-bold text-white">{trade.symbol}</span>
        </div>

        <div className={`flex items-center justify-between p-3 rounded-lg border ${sideBg}`}>
          <span className="text-sm text-gray-300 font-medium">Side:</span>
          <span className={`text-lg font-bold ${sideColor}`}>
            {trade.side}
          </span>
        </div>

        {/* Quantity */}
        <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
          <span className="text-sm text-gray-300 font-medium">Quantity:</span>
          <span className="text-lg font-bold text-white">
            {trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}
          </span>
        </div>

        {/* Price / Market */}
        <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
          <span className="text-sm text-gray-300 font-medium">Entry Price:</span>
          <span className="text-lg font-bold text-white">
            ${trade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* Strategy / Trade Type */}
        {trade.strategy && (
          <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
            <span className="text-sm text-gray-300 font-medium">Strategy:</span>
            <span className="text-sm font-medium text-blue-300">{trade.strategy}</span>
          </div>
        )}

        {/* Accuracy (if available) */}
        {trade.accuracy !== undefined && (
          <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
            <span className="text-sm text-gray-300 font-medium">Accuracy:</span>
            <span className={`text-lg font-bold ${trade.accuracy >= 90 ? 'text-green-400' :
                trade.accuracy >= 80 ? 'text-yellow-400' :
                  'text-red-400'
              }`}>
              {trade.accuracy.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Stop Loss (if available) */}
        {trade.stopLoss && (
          <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
            <span className="text-sm text-gray-300 font-medium">Stop Loss:</span>
            <span className="text-sm font-medium text-red-300">
              ${trade.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Take Profit (if available) */}
        {trade.takeProfit && (
          <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
            <span className="text-sm text-gray-300 font-medium">Take Profit:</span>
            <span className="text-sm font-medium text-green-300">
              ${trade.takeProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Warning */}
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
          <p className="text-sm text-yellow-200 flex items-center gap-2">
            <span className="text-yellow-400">⚠️</span>
            <span>This trade will execute immediately upon approval. Reject to cancel.</span>
          </p>
        </div>
      </div>
    </NotificationModal>
  );
};

export default PendingTradeConfirmationModal;
