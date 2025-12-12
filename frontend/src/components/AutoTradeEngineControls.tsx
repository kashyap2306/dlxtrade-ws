import React, { useState, useEffect, useRef } from 'react';
import { autoTradeApi } from '../services/api';

interface AutoTradeEngineControlsProps {
  config: {
    autoTradeEnabled: boolean;
    cooldownSeconds: number;
  };
  engineStatus: 'Running' | 'Paused' | 'Stopped' | 'Outside Hours';
  cooldownRemaining: number;
  setCooldownRemaining: (value: number) => void;
  exchangeConfig: any;
  providerConfig: any;
  isExchangeConnected: (config: any) => boolean;
  updateEngineStatus: () => void;
  setAutoTradeStatus: (status: any) => void;
  setConfig: (config: any) => void;
  runSelfTest: () => Promise<any>;
  isRunningDiagnostics: boolean;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export const AutoTradeEngineControls: React.FC<AutoTradeEngineControlsProps> = ({
  config,
  engineStatus,
  cooldownRemaining,
  setCooldownRemaining,
  exchangeConfig,
  providerConfig,
  isExchangeConnected,
  updateEngineStatus,
  setAutoTradeStatus,
  setConfig,
  runSelfTest,
  isRunningDiagnostics,
  showToast,
}) => {
  const togglingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  // Cooldown timer effect
  useEffect(() => {
    if (config.cooldownSeconds > 0 && cooldownRemaining > 0) {
      const interval = setInterval(() => {
        setCooldownRemaining(prev => {
          if (prev <= 1) {
            // Cooldown finished
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [config.cooldownSeconds, cooldownRemaining, setCooldownRemaining]);

  const handleAutoTradeToggle = async (enabled: boolean) => {
    console.log("handleAutoTradeToggle called with:", enabled);
    console.log("exchangeConfig at toggle:", exchangeConfig);
    console.log("providerConfig at toggle:", providerConfig);

    if (togglingRef.current) return;
    togglingRef.current = true;

    // Create safe exchange connection flag from the authoritative exchange config
    const exchangeConnected = isExchangeConnected(exchangeConfig);

    if (!enabled || exchangeConnected) {
      setSaving(true);
      try {
        const response = await autoTradeApi.toggle(enabled);

        // Set correct state after enable
        const isEnabled = response?.data?.enabled ?? enabled;
        setAutoTradeStatus(prev => ({ ...prev, enabled: isEnabled }));
        setConfig(prev => ({ ...prev, autoTradeEnabled: isEnabled }));

        if (isEnabled) {
          updateEngineStatus();
          // Note: Research status would be set by backend updates
        }

        showToast(`Auto-Trade ${enabled ? 'started' : 'stopped'}`, 'success');
        return response; // Return the promise result
      } catch (err: any) {
        console.error("AUTO-TRADE ENABLE API ERROR:", err);

        const backendStatus =
          err?.response?.status ||
          err?.status ||
          "NO_STATUS";

        const backendMessage =
          err?.response?.data?.message ||
          err?.message ||
          "Unknown backend error.";

        const backendDetails =
          err?.response?.data ||
          null;

        const errors = [
          {
            title: "Auto-Trade Enable Failed",
            reason: `Backend returned status: ${backendStatus}`,
            fix: backendMessage
          }
        ];

        if (backendDetails) {
          errors.push({
            title: "Backend Details",
            reason: JSON.stringify(backendDetails, null, 2),
            fix: "Review API keys, futures mode, permissions, and required settings."
          });
        }

        showToast(errors[0].title, 'error');
      } finally {
        setSaving(false);
        togglingRef.current = false;
      }
    } else {
      togglingRef.current = false;
      showToast('Exchange connection required', 'error');
      throw new Error('Exchange connection required');
    }
  };

  const validateAutoTradeRequirements = async () => {
    // Only check exchange connection
    const canEnableAutoTrade = exchangeConfig?.apiKey === "[ENCRYPTED]"
        || exchangeConfig?.secret === "[ENCRYPTED]"
        || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);

    return {
      valid: canEnableAutoTrade,
      errors: canEnableAutoTrade ? [] : [{
        title: "No Exchange Connected",
        reason: "Connect your exchange to enable Auto-Trade.",
        fix: "Submit your exchange API keys in settings."
      }]
    };
  };

  // Auto-enable when exchange is connected
  const checkAndEnableAutoTrade = async () => {
    const canEnableAutoTrade = exchangeConfig?.apiKey === "[ENCRYPTED]"
        || exchangeConfig?.secret === "[ENCRYPTED]"
        || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);

    if (canEnableAutoTrade && !config.autoTradeEnabled) {
      try {
        await handleAutoTradeToggle(true);
        showToast("Auto-Trade Enabled (Exchange Connected)", "success");
      } catch (err) {
        console.error("Auto-enable error:", err);
      }
    }
  };

  return (
    <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
      <h2 className="text-xl font-semibold text-blue-200 mb-4">Engine Status</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center justify-between">
          <span className="text-blue-100">Engine Status</span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            engineStatus === 'Running' ? 'bg-green-600/40 text-green-300 border border-green-500/30' :
            'bg-red-600/40 text-red-300 border border-red-500/30'
          }`}>
            {engineStatus === 'Running' ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-blue-100">Auto-Trade</span>
          {config.autoTradeEnabled ? (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-600/40 text-green-300 border border-green-500/30">
              Enabled
            </span>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={runSelfTest}
                disabled={isRunningDiagnostics}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isRunningDiagnostics ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Testing...
                  </>
                ) : (
                  <>
                    🔍 Run Self-Test
                  </>
                )}
              </button>
              <button
                onClick={async () => {
                  const isAutoTradeEnabled = () => {
                    return exchangeConfig?.apiKey === "[ENCRYPTED]"
                        || exchangeConfig?.secret === "[ENCRYPTED]"
                        || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);
                  };

                  if (isAutoTradeEnabled()) {
                    await handleAutoTradeToggle(true);
                    showToast("Auto-Trade Enabled", "success");
                  } else {
                    showToast("Connect your exchange first", "error");
                  }
                }}
                disabled={saving || (() => {
                  const isAutoTradeEnabled = () => {
                    return exchangeConfig?.apiKey === "[ENCRYPTED]"
                        || exchangeConfig?.secret === "[ENCRYPTED]"
                        || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);
                  };
                  return !isAutoTradeEnabled();
                })()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Enabling...' : (() => {
                  const isAutoTradeEnabled = () => {
                    return exchangeConfig?.apiKey === "[ENCRYPTED]"
                        || exchangeConfig?.secret === "[ENCRYPTED]"
                        || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);
                  };
                  return isAutoTradeEnabled() ? 'Enable Auto-Trade' : 'Connect Exchange First';
                })()}
              </button>
            </div>
          )}
        </div>

                <div className="flex items-center justify-between">
                  <span className="text-blue-100">Exchange</span>
                  <span className={`text-sm ${
                    !exchangeConfig ? 'text-yellow-400' :
                    isExchangeConnected(exchangeConfig) ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {!exchangeConfig ? "Unknown" :
                     isExchangeConnected(exchangeConfig) ? "Connected" : "Not Connected"}
                  </span>
                </div>
      </div>
    </div>
  );
};
