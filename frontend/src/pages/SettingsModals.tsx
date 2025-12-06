import React from 'react';
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface SettingsModalsProps {
  showAutoTradeModal: boolean;
  notificationPrereqs: any;
  handleAutoTradeModalClose: () => void;
}

export const SettingsModals: React.FC<SettingsModalsProps> = ({
  showAutoTradeModal,
  notificationPrereqs,
  handleAutoTradeModalClose,
}) => {
  return (
    <>
      {/* Auto-Trade Prerequisite Modal */}
      {showAutoTradeModal && notificationPrereqs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-lg w-full text-center border border-amber-500/20 shadow-2xl">
            <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Auto-Trade Prerequisites Not Met</h3>
            <p className="text-gray-400 mb-4">You must complete the following steps before enabling Auto-Trade Alerts:</p>
            <ul className="text-left space-y-2 mb-6">
              <li className={`flex items-center gap-2 ${notificationPrereqs?.exchangeConnected ? 'text-green-400' : 'text-red-400'}`}>
                {notificationPrereqs?.exchangeConnected ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                Connect a supported crypto exchange.
              </li>
              <li className={`flex items-center gap-2 ${notificationPrereqs?.telegramConfigured ? 'text-green-400' : 'text-red-400'}`}>
                {notificationPrereqs?.telegramConfigured ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                Configure Telegram Bot and Chat ID.
              </li>
              <li className={`flex items-center gap-2 ${notificationPrereqs?.apiKeysValidated ? 'text-green-400' : 'text-red-400'}`}>
                {notificationPrereqs?.apiKeysValidated ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                Validate all required API keys.
              </li>
            </ul>
            <button
              onClick={handleAutoTradeModalClose}
              className="w-full px-6 py-3 bg-purple-500/80 text-white font-semibold rounded-xl hover:bg-purple-600/90 transition-all duration-300"
            >
              I Understand
            </button>
          </div>
        </div>
      )}
    </>
  );
};
