import React, { useState, useEffect } from 'react';
import { settingsApi } from '../services/api';

interface AccuracyRiskConfigItem {
  minAccuracy: number;
  maxAccuracy: number | null;
  tradeSizePct: number;
  leverage: number;
}

interface AccuracyRiskConfigSectionProps {
  user: any;
  showToast: (message: string, type: 'success' | 'error') => void;
}

// Default system configuration
// CRITICAL: Must match backend defaults exactly
// Leverage for ≥90% is 9x by default (10x is hard cap only)
const DEFAULT_CONFIG: AccuracyRiskConfigItem[] = [
  { minAccuracy: 75, maxAccuracy: 79, tradeSizePct: 3, leverage: 4 },
  { minAccuracy: 80, maxAccuracy: 84, tradeSizePct: 5, leverage: 5 },
  { minAccuracy: 85, maxAccuracy: 89, tradeSizePct: 7, leverage: 7 },
  { minAccuracy: 90, maxAccuracy: null, tradeSizePct: 10, leverage: 9 }, // 9x default, 10x is hard cap
];

export const AccuracyRiskConfigSection: React.FC<AccuracyRiskConfigSectionProps> = ({ user, showToast }) => {
  const [config, setConfig] = useState<AccuracyRiskConfigItem[]>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ [key: number]: string }>({});

  // Load configuration on mount
  useEffect(() => {
    if (user) {
      loadConfig();
    }
  }, [user]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await settingsApi.trading.load();
      const tradingSettings = response.data || {};
      
      if (tradingSettings.accuracyRiskConfig && Array.isArray(tradingSettings.accuracyRiskConfig) && tradingSettings.accuracyRiskConfig.length > 0) {
        setConfig(tradingSettings.accuracyRiskConfig);
      } else {
        // Use defaults if not configured
        setConfig(DEFAULT_CONFIG);
      }
    } catch (err: any) {
      console.error('Failed to load accuracy-risk config:', err);
      showToast('Failed to load configuration', 'error');
      // Fallback to defaults
      setConfig(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  };

  const validateConfig = (): boolean => {
    const newErrors: { [key: number]: string } = {};
    const sorted = [...config].sort((a, b) => a.minAccuracy - b.minAccuracy);

    // Validate each row
    config.forEach((item, index) => {
      if (item.minAccuracy < 75) {
        newErrors[index] = 'Minimum accuracy must be ≥ 75%';
      }
      if (item.maxAccuracy !== null && item.maxAccuracy < item.minAccuracy) {
        newErrors[index] = 'Max accuracy must be ≥ min accuracy';
      }
      if (item.tradeSizePct < 0 || item.tradeSizePct > 10) {
        newErrors[index] = 'Trade size must be 0-10%';
      }
      if (item.leverage < 1 || item.leverage > 10) {
        newErrors[index] = 'Leverage must be 1-10x';
      }
    });

    // Validate continuity
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevMax = prev.maxAccuracy ?? 100;
      if (curr.minAccuracy !== prevMax + 1 && curr.minAccuracy !== prevMax) {
        newErrors[i] = 'Ranges must be continuous (no gaps or overlaps)';
      }
    }

    // Last range should cover up to 100%
    const last = sorted[sorted.length - 1];
    if (last && last.maxAccuracy !== null && last.maxAccuracy < 100) {
      newErrors[sorted.length - 1] = 'Last range must cover up to 100% (set max to null)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateConfig()) {
      showToast('Please fix validation errors before saving', 'error');
      return;
    }

    setSaving(true);
    try {
      // Get current trading settings
      const currentSettings = await settingsApi.trading.load();
      const tradingSettings = currentSettings.data || {};

      // Update with new accuracyRiskConfig
      await settingsApi.trading.update({
        ...tradingSettings,
        accuracyRiskConfig: config,
      });

      showToast('Accuracy-risk configuration saved successfully', 'success');
    } catch (err: any) {
      console.error('Failed to save accuracy-risk config:', err);
      showToast(err.response?.data?.error || 'Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset to default configuration? This will discard your changes.')) {
      setConfig(DEFAULT_CONFIG);
      setErrors({});
    }
  };

  const updateConfig = (index: number, field: keyof AccuracyRiskConfigItem, value: number | null) => {
    const newConfig = [...config];
    newConfig[index] = { ...newConfig[index], [field]: value };
    setConfig(newConfig);
    // Clear error for this row
    if (errors[index]) {
      const newErrors = { ...errors };
      delete newErrors[index];
      setErrors(newErrors);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-blue-200">Loading configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-blue-200">Accuracy-Based Risk Configuration</h2>
          <p className="text-sm text-blue-100/60 mt-1">
            Configure trade size and leverage based on signal accuracy. This is the single source of truth for auto-trade execution.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            disabled={saving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-blue-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || Object.keys(errors).length > 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-blue-500/20">
              <th className="pb-3 text-blue-200 font-semibold">Min Accuracy (%)</th>
              <th className="pb-3 text-blue-200 font-semibold">Max Accuracy (%)</th>
              <th className="pb-3 text-blue-200 font-semibold">Trade Size (%)</th>
              <th className="pb-3 text-blue-200 font-semibold">Leverage</th>
            </tr>
          </thead>
          <tbody>
            {config.map((item, index) => (
              <tr key={index} className="border-b border-blue-500/10 hover:bg-blue-500/5">
                <td className="py-3">
                  <input
                    type="number"
                    min="75"
                    max="100"
                    value={item.minAccuracy}
                    onChange={(e) => updateConfig(index, 'minAccuracy', parseFloat(e.target.value) || 75)}
                    className="w-24 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 focus:outline-none focus:border-blue-400"
                  />
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="75"
                      max="100"
                      value={item.maxAccuracy ?? ''}
                      onChange={(e) => updateConfig(index, 'maxAccuracy', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="∞"
                      className="w-24 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 focus:outline-none focus:border-blue-400"
                    />
                    <span className="text-xs text-blue-100/60">(null = no limit)</span>
                  </div>
                </td>
                <td className="py-3">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={item.tradeSizePct}
                    onChange={(e) => updateConfig(index, 'tradeSizePct', parseFloat(e.target.value) || 0)}
                    className="w-24 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 focus:outline-none focus:border-blue-400"
                  />
                </td>
                <td className="py-3">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={item.leverage}
                    onChange={(e) => updateConfig(index, 'leverage', parseInt(e.target.value) || 1)}
                    className="w-24 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 focus:outline-none focus:border-blue-400"
                  />
                </td>
                {errors[index] && (
                  <td className="py-3">
                    <span className="text-xs text-red-400">{errors[index]}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-4 border-t border-blue-500/20">
        <p className="text-xs text-blue-100/60">
          <strong>Rules:</strong> Minimum accuracy must be ≥ 75%. Ranges must be continuous and non-overlapping. 
          Trade size max: 10%. Leverage max: 10x. Last range should cover up to 100% (set max to null for unlimited).
        </p>
      </div>
    </div>
  );
};

