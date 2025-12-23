import React from 'react';
import NotificationModal from './NotificationModal';

interface WhaleAlertsActivationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnable: () => Promise<void>;
  apiStatus: {
    cryptocompare: boolean;
    newsdata: boolean;
  };
}

const WhaleAlertsActivationModal: React.FC<WhaleAlertsActivationModalProps> = ({
  isOpen,
  onClose,
  onEnable,
  apiStatus,
}) => {
  const allApisReady = apiStatus.cryptocompare && apiStatus.newsdata;

  const handleEnable = async () => {
    if (allApisReady) {
      await onEnable();
      onClose();
    }
  };

  return (
    <NotificationModal
      isOpen={isOpen}
      type={allApisReady ? 'confirm' : 'warning'}
      title="Whale Alerts Activation"
      message={
        allApisReady
          ? "Whale Alerts will notify you when significant market movements are detected. Enable now?"
          : "To enable Whale Alerts, you must have all PRIMARY market data APIs configured and active."
      }
      onConfirm={allApisReady ? handleEnable : undefined}
      onCancel={onClose}
      confirmText="Enable Whale Alerts"
      cancelText="Cancel"
    >
      {!allApisReady && (
        <div className="space-y-3 mt-4">
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-yellow-200 mb-2">Required APIs:</h4>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className={`flex items-center gap-2 ${apiStatus.cryptocompare ? 'text-green-400' : 'text-red-400'}`}>
                <span>{apiStatus.cryptocompare ? '✓' : '✗'}</span>
                <span>CryptoCompare (Market Data - Primary)</span>
              </li>
              <li className={`flex items-center gap-2 ${apiStatus.newsdata ? 'text-green-400' : 'text-red-400'}`}>
                <span>{apiStatus.newsdata ? '✓' : '✗'}</span>
                <span>NewsData.io (News - Primary)</span>
              </li>
            </ul>
            <p className="text-xs text-gray-400 mt-3">
              Please configure these APIs in Settings → API Providers before enabling Whale Alerts.
            </p>
          </div>
        </div>
      )}

      {allApisReady && (
        <div className="space-y-3 mt-4">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-200 mb-2">Detection Logic:</h4>
            <ul className="space-y-1 text-sm text-gray-300">
              <li>• Price movement ≥ 2.5% within short interval</li>
              <li>• Abnormal volume spike compared to recent average</li>
              <li>• Sudden large order / liquidity shift</li>
            </ul>
            <p className="text-xs text-gray-400 mt-3">
              Alerts include cooldown per symbol to prevent spam. Backend decides when alerts trigger.
            </p>
          </div>
        </div>
      )}
    </NotificationModal>
  );
};

export default WhaleAlertsActivationModal;
