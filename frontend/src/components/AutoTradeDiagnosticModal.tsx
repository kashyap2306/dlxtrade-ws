import React from 'react';

interface DiagnosticCheck {
  status: 'PASS' | 'FAIL';
  message: string;
  value?: any;
  threshold?: number;
  minRequired?: number;
  exchangeName?: string;
  signalType?: 'BUY' | 'SELL' | 'HOLD' | null;
  passed?: boolean;
  blockedBy?: string;
  cooldownUntil?: string;
  limit?: number;
}

interface DiagnosticResults {
  timestamp: string;
  systemChecks: {
    encryptionSecretConfigured?: DiagnosticCheck;
    autoTradeEnabled: DiagnosticCheck;
    exchangeConnected: DiagnosticCheck;
    futuresTradingEnabled: DiagnosticCheck;
    apiPermissionsValid: DiagnosticCheck;
    disableAutoTradeEnv?: DiagnosticCheck;
    backgroundTasksEnabled?: DiagnosticCheck;
    schedulerRunning?: DiagnosticCheck;
    userJobScheduled?: DiagnosticCheck;
    backgroundResearchEnabled?: DiagnosticCheck;
    researchKeysConfigured?: DiagnosticCheck;
  };
  walletChecks: {
    futuresWalletDetected: DiagnosticCheck;
    freeBalanceAvailable: DiagnosticCheck;
    minimumBalanceMet: DiagnosticCheck;
  };
  strategyChecks: {
    signalGenerated: DiagnosticCheck;
    accuracyTrigger: DiagnosticCheck;
    researchCycleActive?: DiagnosticCheck;
    accuracyAndSignalPassed?: DiagnosticCheck;
  };
  safetyChecks: {
    riskLimits: DiagnosticCheck;
    cooldown: DiagnosticCheck;
    dailyTradesLimit: DiagnosticCheck;
    circuitBreaker: DiagnosticCheck;
    manualOverride: DiagnosticCheck;
    concurrentTradesLimit: DiagnosticCheck;
  };
  primaryBlockingReason: string | null;
  finalVerdict: string;
}

interface AutoTradeDiagnosticModalProps {
  visible: boolean;
  onClose: () => void;
  results: DiagnosticResults | null;
  isRunning: boolean;
}

export const AutoTradeDiagnosticModal: React.FC<AutoTradeDiagnosticModalProps> = ({
  visible,
  onClose,
  results,
  isRunning,
}) => {
  if (!visible) return null;

  const getStatusBadge = (status: 'PASS' | 'FAIL') => {
    if (status === 'PASS') {
      return (
        <span className="px-2 py-1 rounded text-xs font-medium bg-green-600/40 text-green-300 border border-green-500/30">
          PASS
        </span>
      );
    }
    return (
      <span className="px-2 py-1 rounded text-xs font-medium bg-red-600/40 text-red-300 border border-red-500/30">
        FAIL
      </span>
    );
  };

  const getVerdictColor = (verdict: string) => {
    if (verdict.includes('READY')) {
      return 'bg-green-600/40 text-green-300 border-green-500/30';
    }
    if (verdict.includes('DISABLED')) {
      return 'bg-gray-600/40 text-gray-300 border-gray-500/30';
    }
    return 'bg-red-600/40 text-red-300 border-red-500/30';
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#0a0f1a] border border-blue-500/20 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-blue-200">Auto-Trade Diagnostic Check</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {isRunning && (
          <div className="flex items-center gap-3 text-blue-100 mb-6">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm">Running diagnostic check...</p>
          </div>
        )}

        {results && (
          <div className="space-y-6">
            {/* Final Verdict */}
            <div className={`p-4 rounded-lg border ${getVerdictColor(results.finalVerdict)}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold">Final Verdict</h4>
                <span className="text-sm font-medium">{results.finalVerdict}</span>
              </div>
              {results.primaryBlockingReason && (
                <p className="text-sm mt-2 opacity-90">
                  Primary blocking reason: {results.primaryBlockingReason}
                </p>
              )}
            </div>

            {/* System & User Level Checks */}
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-blue-200 border-b border-blue-500/20 pb-2">
                1. System & User Level Checks
              </h4>
              {Object.entries(results.systemChecks).map(([key, check]) => (
                <div key={key} className="p-3 bg-gray-900/50 border border-gray-600/40 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-100 font-medium capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    {getStatusBadge(check.status)}
                  </div>
                  <p className="text-sm text-blue-100/80">{check.message}</p>
                  {check.exchangeName && (
                    <p className="text-xs text-gray-400 mt-1">Exchange: {check.exchangeName}</p>
                  )}
                  {check.lastResearchTime && (
                    <p className="text-xs text-gray-400 mt-1">Last Research: {new Date(check.lastResearchTime).toLocaleString()}</p>
                  )}
                  {check.lastResearchAgeMinutes !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">Age: {check.lastResearchAgeMinutes} minutes ago</p>
                  )}
                  {check.lastRunAt && (
                    <p className="text-xs text-gray-400 mt-1">Last Run: {new Date(check.lastRunAt).toLocaleString()}</p>
                  )}
                  {check.nextRunAt && (
                    <p className="text-xs text-gray-400 mt-1">Next Run: {new Date(check.nextRunAt).toLocaleString()}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Wallet & Capital Checks */}
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-blue-200 border-b border-blue-500/20 pb-2">
                2. Wallet & Capital Checks
              </h4>
              {Object.entries(results.walletChecks).map(([key, check]) => (
                <div key={key} className="p-3 bg-gray-900/50 border border-gray-600/40 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-100 font-medium capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    {getStatusBadge(check.status)}
                  </div>
                  <p className="text-sm text-blue-100/80">{check.message}</p>
                  {check.value !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">
                      Value: {typeof check.value === 'number' ? check.value.toFixed(2) : String(check.value)}
                      {check.minRequired && ` (Min: ${check.minRequired})`}
                      {check.threshold && ` (Threshold: ${check.threshold})`}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Strategy & Signal Checks */}
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-blue-200 border-b border-blue-500/20 pb-2">
                3. Strategy & Signal Checks
              </h4>
              {Object.entries(results.strategyChecks).map(([key, check]) => (
                <div key={key} className="p-3 bg-gray-900/50 border border-gray-600/40 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-100 font-medium capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    {getStatusBadge(check.status)}
                  </div>
                  <p className="text-sm text-blue-100/80">{check.message}</p>
                  {check.signalType && (
                    <p className="text-xs text-gray-400 mt-1">Signal Type: {check.signalType}</p>
                  )}
                  {check.value !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">
                      Accuracy: {typeof check.value === 'number' ? `${check.value.toFixed(1)}%` : String(check.value)}
                      {check.threshold && ` (Required: ${check.threshold}%)`}
                      {check.passed !== undefined && (
                        <span className={check.passed ? 'text-green-400' : 'text-red-400'}>
                          {' '}
                          {check.passed ? '✓ PASSED' : '✗ FAILED'}
                        </span>
                      )}
                    </p>
                  )}
                  {check.blockedBy && (
                    <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-500/40 rounded text-xs text-yellow-200">
                      ⚠ Accuracy and signal were valid, but execution was blocked due to: {check.blockedBy}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Safety & Rule Checks */}
            <div className="space-y-3">
              <h4 className="text-lg font-semibold text-blue-200 border-b border-blue-500/20 pb-2">
                4. Safety & Rule Checks
              </h4>
              {Object.entries(results.safetyChecks).map(([key, check]) => (
                <div key={key} className="p-3 bg-gray-900/50 border border-gray-600/40 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-100 font-medium capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    {getStatusBadge(check.status)}
                  </div>
                  <p className="text-sm text-blue-100/80">{check.message}</p>
                  {check.value !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">
                      {typeof check.value === 'number' ? `Value: ${check.value.toFixed(2)}` : `Value: ${String(check.value)}`}
                      {check.limit && ` (Limit: ${check.limit})`}
                    </p>
                  )}
                  {check.cooldownUntil && (
                    <p className="text-xs text-gray-400 mt-1">
                      Cooldown until: {new Date(check.cooldownUntil).toLocaleString()}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Timestamp */}
            <div className="text-xs text-gray-500 text-center pt-4 border-t border-gray-700/50">
              Check performed at: {new Date(results.timestamp).toLocaleString()}
            </div>
          </div>
        )}

        {/* Close Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-blue-100 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

