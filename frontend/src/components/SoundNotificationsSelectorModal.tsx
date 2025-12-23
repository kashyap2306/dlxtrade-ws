import React, { useState } from 'react';
import NotificationModal from './NotificationModal';

interface SoundNotificationsSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (selectedTypes: string[]) => Promise<void>;
  existingPreferences?: string[];
}

const NOTIFICATION_TYPES = [
  { id: 'autoTradeExecuted', label: 'Auto-Trade Executed' },
  { id: 'tradeApproved', label: 'Trade Approved' },
  { id: 'tradeRejected', label: 'Trade Rejected' },
  { id: 'accuracyAlert', label: 'Accuracy Alert' },
  { id: 'whaleAlert', label: 'Whale Alert' },
  { id: 'dailyLossLimitHit', label: 'Daily Loss Limit Hit' },
  { id: 'maxTradesLimitHit', label: 'Max Trades Limit Hit' },
  { id: 'autoTradeEnabled', label: 'Auto-Trade Enabled' },
  { id: 'autoTradeDisabled', label: 'Auto-Trade Disabled' },
  { id: 'engineStarted', label: 'Engine Started' },
  { id: 'engineStopped', label: 'Engine Stopped' },
  { id: 'pendingTradeConfirmation', label: 'Pending Trade Confirmation' },
  { id: 'apiFailure', label: 'API Failure' },
  { id: 'exchangeDisconnected', label: 'Exchange Disconnected' },
  { id: 'riskRuleViolation', label: 'Risk Rule Violation' },
];

const SoundNotificationsSelectorModal: React.FC<SoundNotificationsSelectorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingPreferences = [],
}) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>(existingPreferences);
  const [saving, setSaving] = useState(false);

  const toggleType = (typeId: string) => {
    setSelectedTypes(prev =>
      prev.includes(typeId)
        ? prev.filter(id => id !== typeId)
        : [...prev, typeId]
    );
  };

  const handleSelectAll = () => {
    if (selectedTypes.length === NOTIFICATION_TYPES.length) {
      setSelectedTypes([]);
    } else {
      setSelectedTypes(NOTIFICATION_TYPES.map(t => t.id));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selectedTypes);
      onClose();
    } catch (error) {
      console.error('Failed to save sound preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-slate-900/95 backdrop-blur-xl border border-purple-500/30 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Sound Notification Preferences</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Description */}
          <p className="text-gray-300 mb-4">
            Select which notification types should play a sound. Sound will play when any selected notification type triggers.
          </p>

          {/* Select All */}
          <button
            onClick={handleSelectAll}
            className="mb-4 px-4 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-all"
          >
            {selectedTypes.length === NOTIFICATION_TYPES.length ? 'Deselect All' : 'Select All'}
          </button>

          {/* Notification Types Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6 max-h-96 overflow-y-auto">
            {NOTIFICATION_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => toggleType(type.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  selectedTypes.includes(type.id)
                    ? 'border-purple-500 bg-purple-500/20'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{type.label}</span>
                  {selectedTypes.includes(type.id) && (
                    <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Selection Count */}
          <div className="mb-6 text-sm text-gray-400">
            {selectedTypes.length} of {NOTIFICATION_TYPES.length} notification types selected
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-slate-700 text-white font-medium rounded-xl hover:bg-slate-600 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || selectedTypes.length === 0}
              className="flex-1 px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SoundNotificationsSelectorModal;
