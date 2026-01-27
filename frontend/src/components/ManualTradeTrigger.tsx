import { useState } from 'react';
import { agentsApi } from '../services/api';
import { CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/outline';

interface ManualTradeTriggerProps {
  agentId: string;
}

interface TradeResult {
  success: boolean;
  message: string;
  orderId?: string;
  executionDetails?: any;
  error?: string;
  rawError?: string;
}

export default function ManualTradeTrigger({ agentId }: ManualTradeTriggerProps) {
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [formData, setFormData] = useState({
    pair: 'BTCUSDT',
    side: 'LONG' as 'LONG' | 'SHORT',
    quantity: '0.001'
  });

  const handleExecuteTrade = async () => {
    setExecuting(true);
    setResult(null);

    try {
      const tradeData = {
        pair: formData.pair,
        side: formData.side,
        quantity: parseFloat(formData.quantity)
      };
      
      const response = await agentsApi.executeManualTrade(agentId, tradeData);
      setResult(response.data);
    } catch (err: any) {
      const errorData = err.response?.data;
      setResult({
        success: false,
        message: errorData?.error || 'Trade execution failed',
        error: errorData?.error,
        rawError: errorData?.rawError || err.message
      });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Trading Pair</label>
          <select
            value={formData.pair}
            onChange={(e) => setFormData({ ...formData, pair: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="BTCUSDT">BTC/USDT</option>
            <option value="ETHUSDT">ETH/USDT</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Side</label>
          <select
            value={formData.side}
            onChange={(e) => setFormData({ ...formData, side: e.target.value as 'LONG' | 'SHORT' })}
            className="w-full px-3 py-2 bg-slate-700 border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
          >
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Quantity</label>
          <input
            type="number"
            step="0.001"
            min="0.001"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
            className="w-full px-3 py-2 bg-slate-700 border border-purple-500/20 rounded-lg text-white focus:outline-none focus:border-purple-500/50"
            placeholder="0.001"
          />
        </div>
      </div>

      <button
        onClick={handleExecuteTrade}
        disabled={executing}
        className="btn btn-primary w-full"
      >
        {executing ? (
          <div className="flex items-center gap-2">
            <ClockIcon className="w-4 h-4 animate-spin" />
            Executing Test Trade...
          </div>
        ) : (
          'Execute Test Trade'
        )}
      </button>

      {result && (
        <div className="p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
          <div className="flex items-center gap-2 mb-3">
            {result.success ? (
              <CheckCircleIcon className="w-5 h-5 text-green-400" />
            ) : (
              <XCircleIcon className="w-5 h-5 text-red-400" />
            )}
            <h4 className={`text-sm font-semibold ${result.success ? 'text-green-400' : 'text-red-400'}`}>
              {result.success ? 'Trade Executed Successfully' : 'Trade Execution Failed'}
            </h4>
          </div>
          
          <div className="space-y-2">
            <div className="text-sm text-gray-300">
              <span className="font-medium">Result:</span> {result.message}
            </div>
            
            {result.orderId && (
              <div className="text-sm text-gray-300">
                <span className="font-medium">Order ID:</span> {result.orderId}
              </div>
            )}
          </div>

          {(result.error || result.rawError) && (
            <div className="mt-3 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
              <div className="text-xs font-semibold text-red-400 mb-1">Exchange Error Details:</div>
              <div className="text-xs text-gray-300 leading-relaxed">
                {result.rawError || result.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}