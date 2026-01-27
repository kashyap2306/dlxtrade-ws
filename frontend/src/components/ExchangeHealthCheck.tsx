import { useState } from 'react';
import { agentsApi } from '../services/api';
import { CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/outline';

interface ExchangeHealthCheckProps {
  agentId: string;
}

interface HealthCheckResult {
  orderEndpointReachable: boolean;
  permissionsOk: boolean;
  futuresEnabled: boolean;
  symbolTradable: boolean;
  exchange?: string;
  message?: string;
  error?: string;
  rawError?: string;
}

export default function ExchangeHealthCheck({ agentId }: ExchangeHealthCheckProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HealthCheckResult | null>(null);

  const handleTestExecution = async () => {
    setTesting(true);
    setResult(null);

    try {
      const response = await agentsApi.testExchangeExecution(agentId);
      setResult(response.data);
    } catch (err: any) {
      const errorData = err.response?.data;
      setResult({
        orderEndpointReachable: false,
        permissionsOk: false,
        futuresEnabled: false,
        symbolTradable: false,
        error: errorData?.error || 'Test failed',
        rawError: errorData?.rawError || err.message
      });
    } finally {
      setTesting(false);
    }
  };

  const getStatusIcon = (status: boolean) => {
    return status ? (
      <CheckCircleIcon className="w-5 h-5 text-green-400" />
    ) : (
      <XCircleIcon className="w-5 h-5 text-red-400" />
    );
  };

  return (
    <div className="space-y-4">
      <button
        onClick={handleTestExecution}
        disabled={testing}
        className="btn btn-primary w-full"
      >
        {testing ? (
          <div className="flex items-center gap-2">
            <ClockIcon className="w-4 h-4 animate-spin" />
            Testing Exchange...
          </div>
        ) : (
          'Test Exchange Execution'
        )}
      </button>

      {result && (
        <div className="space-y-3 p-4 bg-slate-900/50 rounded-lg border border-purple-500/20">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white">Health Check Results</h4>
            {result.exchange && (
              <span className="text-xs text-gray-400 bg-slate-800 px-2 py-1 rounded">
                {result.exchange.toUpperCase()}
              </span>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Order Endpoint Reachable</span>
              <div className="flex items-center gap-2">
                {getStatusIcon(result.orderEndpointReachable)}
                <span className={`text-xs font-medium ${result.orderEndpointReachable ? 'text-green-400' : 'text-red-400'}`}>
                  {result.orderEndpointReachable ? 'OK' : 'FAILED'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Permissions OK</span>
              <div className="flex items-center gap-2">
                {getStatusIcon(result.permissionsOk)}
                <span className={`text-xs font-medium ${result.permissionsOk ? 'text-green-400' : 'text-red-400'}`}>
                  {result.permissionsOk ? 'OK' : 'FAILED'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Futures Enabled</span>
              <div className="flex items-center gap-2">
                {getStatusIcon(result.futuresEnabled)}
                <span className={`text-xs font-medium ${result.futuresEnabled ? 'text-green-400' : 'text-red-400'}`}>
                  {result.futuresEnabled ? 'OK' : 'FAILED'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Symbol Tradable</span>
              <div className="flex items-center gap-2">
                {getStatusIcon(result.symbolTradable)}
                <span className={`text-xs font-medium ${result.symbolTradable ? 'text-green-400' : 'text-red-400'}`}>
                  {result.symbolTradable ? 'OK' : 'FAILED'}
                </span>
              </div>
            </div>
          </div>

          {(result.error || result.rawError) && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
              <div className="text-xs font-semibold text-red-400 mb-1">Exchange Error Details:</div>
              <div className="text-xs text-gray-300 leading-relaxed">
                {result.error === 'EXCHANGE_CORRUPTED' && (
                  <div className="space-y-1">
                    <div className="text-red-400 font-medium">EXCHANGE_CORRUPTED</div>
                    <div>Exchange keys are invalid due to encryption secret change. Please reconnect exchange.</div>
                  </div>
                )}
                {result.error === 'EXCHANGE_KEYS_NOT_DECRYPTED' && (
                  <div className="space-y-1">
                    <div className="text-red-400 font-medium">EXCHANGE_KEYS_NOT_DECRYPTED</div>
                    <div>Exchange API keys could not be decrypted. Please reconnect your exchange in Settings.</div>
                  </div>
                )}
                {result.error === 'PERMISSION_DENIED' && (
                  <div className="space-y-1">
                    <div className="text-red-400 font-medium">PERMISSION_DENIED</div>
                    <div>Exchange API permissions are insufficient for trading operations.</div>
                  </div>
                )}
                {result.error === 'FUTURES_DISABLED' && (
                  <div className="space-y-1">
                    <div className="text-red-400 font-medium">FUTURES_DISABLED</div>
                    <div>Futures trading is not enabled on your exchange account.</div>
                  </div>
                )}
                {result.error === 'SYMBOL_NOT_TRADABLE' && (
                  <div className="space-y-1">
                    <div className="text-red-400 font-medium">SYMBOL_NOT_TRADABLE</div>
                    <div>The requested trading symbol is not available or tradable.</div>
                  </div>
                )}
                {!['EXCHANGE_CORRUPTED', 'EXCHANGE_KEYS_NOT_DECRYPTED', 'PERMISSION_DENIED', 'FUTURES_DISABLED', 'SYMBOL_NOT_TRADABLE'].includes(result.error || '') && (
                  <div>
                    <div className="text-red-400 font-medium">{result.error}</div>
                    <div className="mt-1">{result.rawError || result.error}</div>
                  </div>
                )}
              </div>
              
              {(result.error === 'EXCHANGE_CORRUPTED' || result.error === 'EXCHANGE_KEYS_NOT_DECRYPTED') && (
                <div className="mt-3 p-2 bg-yellow-900/20 border border-yellow-500/30 rounded">
                  <div className="text-xs text-yellow-300">
                    <strong>Action Required:</strong> Go to Settings → Exchange and reconnect your exchange to fix this issue.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}