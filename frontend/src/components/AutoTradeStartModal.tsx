import React, { useState, useEffect } from 'react';
import { settingsApi } from '../services/api';
import { AccuracyRiskConfigSection } from './AccuracyRiskConfigSection';

interface AccuracyRiskConfigItem {
  minAccuracy: number;
  maxAccuracy: number | null;
  tradeSizePct: number;
  leverage: number;
}

interface AutoTradeStartModalProps {
    onConfirm: (frequencyMinutes: number, accuracyRiskConfig?: AccuracyRiskConfigItem[]) => void;
    onCancel: () => void;
    isOpen: boolean;
    user: any;
    showToast: (message: string, type: 'success' | 'error') => void;
}

// Default system configuration
const DEFAULT_CONFIG: AccuracyRiskConfigItem[] = [
  { minAccuracy: 75, maxAccuracy: 79, tradeSizePct: 3, leverage: 4 },
  { minAccuracy: 80, maxAccuracy: 84, tradeSizePct: 5, leverage: 5 },
  { minAccuracy: 85, maxAccuracy: 89, tradeSizePct: 7, leverage: 7 },
  { minAccuracy: 90, maxAccuracy: null, tradeSizePct: 10, leverage: 9 }, // 9x default, 10x is hard cap
];

export const AutoTradeStartModal: React.FC<AutoTradeStartModalProps> = ({
    onConfirm,
    onCancel,
    isOpen,
    user,
    showToast,
}) => {
    const [step, setStep] = useState<'frequency' | 'risk' | 'confirm'>('frequency');
    const [selectedFrequency, setSelectedFrequency] = useState<number>(5);
    const [riskConfig, setRiskConfig] = useState<AccuracyRiskConfigItem[]>(DEFAULT_CONFIG);
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [errors, setErrors] = useState<{ [key: number]: string }>({});

    // Load existing config when modal opens
    useEffect(() => {
        if (isOpen && user) {
            loadConfig();
        } else if (!isOpen) {
            // Reset to first step when modal closes
            setStep('frequency');
            setSelectedFrequency(5);
        }
    }, [isOpen, user]);

    const loadConfig = async () => {
        try {
            setLoadingConfig(true);
            const response = await settingsApi.trading.load();
            const tradingSettings = response.data || {};
            
            if (tradingSettings.accuracyRiskConfig && Array.isArray(tradingSettings.accuracyRiskConfig) && tradingSettings.accuracyRiskConfig.length > 0) {
                setRiskConfig(tradingSettings.accuracyRiskConfig);
            } else {
                setRiskConfig(DEFAULT_CONFIG);
            }
        } catch (err: any) {
            console.error('Failed to load accuracy-risk config:', err);
            setRiskConfig(DEFAULT_CONFIG);
        } finally {
            setLoadingConfig(false);
        }
    };

    const validateConfig = (): boolean => {
        const newErrors: { [key: number]: string } = {};
        const sorted = [...riskConfig].sort((a, b) => a.minAccuracy - b.minAccuracy);

        riskConfig.forEach((item, index) => {
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

        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            const prevMax = prev.maxAccuracy ?? 100;
            if (curr.minAccuracy !== prevMax + 1 && curr.minAccuracy !== prevMax) {
                newErrors[i] = 'Ranges must be continuous (no gaps or overlaps)';
            }
        }

        const last = sorted[sorted.length - 1];
        if (last && last.maxAccuracy !== null && last.maxAccuracy < 100) {
            newErrors[sorted.length - 1] = 'Last range must cover up to 100% (set max to null)';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNext = () => {
        if (step === 'frequency') {
            setStep('risk');
        } else if (step === 'risk') {
            if (validateConfig()) {
                setStep('confirm');
            } else {
                showToast('Please fix validation errors before continuing', 'error');
            }
        }
    };

    const handleBack = () => {
        if (step === 'risk') {
            setStep('frequency');
        } else if (step === 'confirm') {
            setStep('risk');
        }
    };

    const handleFinalConfirm = async () => {
        // Save risk config before enabling auto-trade
        try {
            const currentSettings = await settingsApi.trading.load();
            const tradingSettings = currentSettings.data || {};

            await settingsApi.trading.update({
                ...tradingSettings,
                accuracyRiskConfig: riskConfig,
            });

            onConfirm(selectedFrequency, riskConfig);
        } catch (err: any) {
            console.error('Failed to save risk config:', err);
            showToast('Failed to save risk configuration', 'error');
        }
    };

    const updateConfig = (index: number, field: keyof AccuracyRiskConfigItem, value: number | null) => {
        const newConfig = [...riskConfig];
        newConfig[index] = { ...newConfig[index], [field]: value };
        setRiskConfig(newConfig);
        if (errors[index]) {
            const newErrors = { ...errors };
            delete newErrors[index];
            setErrors(newErrors);
        }
    };

    if (!isOpen) return null;

    const frequencies = [
        { value: 1, label: '1 minute' },
        { value: 3, label: '3 minutes' },
        { value: 5, label: '5 minutes (DEFAULT / recommended)' },
        { value: 10, label: '10 minutes' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#1a1f2e] border border-blue-500/30 rounded-xl p-6 w-[90%] max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-200">
                {/* Step indicator */}
                <div className="flex items-center justify-center mb-6">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'frequency' ? 'bg-blue-600' : 'bg-blue-600/50'}`}>
                            <span className="text-white text-sm font-bold">1</span>
                        </div>
                        <div className={`w-16 h-1 ${step !== 'frequency' ? 'bg-blue-600' : 'bg-gray-600'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'risk' ? 'bg-blue-600' : step === 'confirm' ? 'bg-blue-600/50' : 'bg-gray-600'}`}>
                            <span className="text-white text-sm font-bold">2</span>
                        </div>
                        <div className={`w-16 h-1 ${step === 'confirm' ? 'bg-blue-600' : 'bg-gray-600'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'confirm' ? 'bg-blue-600' : 'bg-gray-600'}`}>
                            <span className="text-white text-sm font-bold">3</span>
                        </div>
                    </div>
                </div>

                {/* Step 1: Frequency Selection */}
                {step === 'frequency' && (
                    <>
                        <h2 className="text-xl font-bold text-white mb-2 text-center">
                            Background Deep Research Frequency
                        </h2>
                        <p className="text-gray-400 text-sm mb-6 text-center">
                            Select how often deep research should run while Auto Trade is active.
                        </p>

                        <div className="space-y-3 mb-6">
                            {frequencies.map((option) => (
                                <label
                                    key={option.value}
                                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all duration-200 ${selectedFrequency === option.value
                                            ? 'bg-blue-600/20 border-blue-500 shadow-md transform scale-[1.02]'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="frequency"
                                        value={option.value}
                                        checked={selectedFrequency === option.value}
                                        onChange={() => setSelectedFrequency(option.value)}
                                        className="w-4 h-4 text-blue-500 bg-gray-800 border-gray-600 focus:ring-blue-500 focus:ring-opacity-50"
                                    />
                                    <span className={`ml-3 text-sm font-medium ${selectedFrequency === option.value ? 'text-white' : 'text-gray-300'
                                        }`}>
                                        {option.label}
                                    </span>
                                </label>
                            ))}
                        </div>

                        <div className="flex gap-3 justify-end pt-2 border-t border-white/10">
                            <button
                                onClick={onCancel}
                                className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleNext}
                                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-500/20 transition-all transform hover:scale-[1.02]"
                            >
                                Next: Risk Configuration
                            </button>
                        </div>
                    </>
                )}

                {/* Step 2: Risk Configuration */}
                {step === 'risk' && (
                    <>
                        <h2 className="text-xl font-bold text-white mb-2 text-center">
                            Accuracy-Based Risk Configuration
                        </h2>
                        <p className="text-gray-400 text-sm mb-4 text-center">
                            Configure trade size and leverage based on signal accuracy. This will be finalized before Auto-Trade is enabled.
                        </p>

                        {loadingConfig ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                                <span className="ml-3 text-blue-200">Loading configuration...</span>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto mb-4">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="border-b border-blue-500/20">
                                                <th className="pb-3 text-blue-200 font-semibold text-sm">Min Accuracy (%)</th>
                                                <th className="pb-3 text-blue-200 font-semibold text-sm">Max Accuracy (%)</th>
                                                <th className="pb-3 text-blue-200 font-semibold text-sm">Trade Size (%)</th>
                                                <th className="pb-3 text-blue-200 font-semibold text-sm">Leverage</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {riskConfig.map((item, index) => (
                                                <tr key={index} className="border-b border-blue-500/10 hover:bg-blue-500/5">
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min="75"
                                                            max="100"
                                                            value={item.minAccuracy}
                                                            onChange={(e) => updateConfig(index, 'minAccuracy', parseFloat(e.target.value) || 75)}
                                                            className="w-20 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 text-sm focus:outline-none focus:border-blue-400"
                                                        />
                                                    </td>
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min="75"
                                                            max="100"
                                                            value={item.maxAccuracy ?? ''}
                                                            onChange={(e) => updateConfig(index, 'maxAccuracy', e.target.value ? parseFloat(e.target.value) : null)}
                                                            placeholder="∞"
                                                            className="w-20 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 text-sm focus:outline-none focus:border-blue-400"
                                                        />
                                                    </td>
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="10"
                                                            step="0.1"
                                                            value={item.tradeSizePct}
                                                            onChange={(e) => updateConfig(index, 'tradeSizePct', parseFloat(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 text-sm focus:outline-none focus:border-blue-400"
                                                        />
                                                    </td>
                                                    <td className="py-3">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="10"
                                                            value={item.leverage}
                                                            onChange={(e) => updateConfig(index, 'leverage', parseInt(e.target.value) || 1)}
                                                            className="w-20 px-2 py-1 bg-[#1a1f2e] border border-blue-500/30 rounded text-blue-100 text-sm focus:outline-none focus:border-blue-400"
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

                                <div className="mb-4 pt-2 border-t border-blue-500/20">
                                    <p className="text-xs text-blue-100/60">
                                        <strong>Rules:</strong> Minimum accuracy must be ≥ 75%. Ranges must be continuous and non-overlapping. 
                                        Trade size max: 10%. Leverage max: 10x. Last range should cover up to 100% (set max to null for unlimited).
                                    </p>
                                </div>

                                <div className="flex gap-3 justify-end pt-2 border-t border-white/10">
                                    <button
                                        onClick={handleBack}
                                        className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNext}
                                        disabled={Object.keys(errors).length > 0}
                                        className="px-6 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-500/20 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next: Review
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {/* Step 3: Confirmation */}
                {step === 'confirm' && (
                    <>
                        <h2 className="text-xl font-bold text-white mb-2 text-center">
                            Review Configuration
                        </h2>
                        <p className="text-gray-400 text-sm mb-6 text-center">
                            Review your settings before enabling Auto-Trade.
                        </p>

                        <div className="space-y-4 mb-6">
                            <div className="bg-white/5 rounded-lg p-4">
                                <h3 className="text-blue-200 font-semibold mb-2">Research Frequency</h3>
                                <p className="text-white">{selectedFrequency} minute{selectedFrequency !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4">
                                <h3 className="text-blue-200 font-semibold mb-2">Risk Configuration</h3>
                                <div className="text-sm text-gray-300 space-y-1">
                                    {riskConfig.map((item, idx) => (
                                        <div key={idx}>
                                            {item.minAccuracy}-{item.maxAccuracy ?? '∞'}%: {item.tradeSizePct}% size, {item.leverage}x leverage
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 justify-end pt-2 border-t border-white/10">
                            <button
                                onClick={handleBack}
                                className="px-4 py-2 bg-gray-700/50 hover:bg-gray-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleFinalConfirm}
                                className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-green-500/20 transition-all transform hover:scale-[1.02]"
                            >
                                Start Auto Trade
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
