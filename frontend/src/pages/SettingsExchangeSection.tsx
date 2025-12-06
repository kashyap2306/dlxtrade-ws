import React from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { SettingsCard, SettingsInput, ProviderTestResult } from './SettingsUtils';
import { EXCHANGES } from '../constants/exchanges';

interface SettingsExchangeSectionProps {
  connectedExchange: any;
  selectedExchange: string | null;
  handleExchangeSelect: (exchangeId: string) => void;
  exchangeForm: any;
  handleExchangeFormChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  exchangeTestResult: any;
  handleTestExchange: () => void;
  handleSaveExchange: () => void;
  handleDisconnectExchange: () => void;
  savingExchange: boolean;
  settings: { showUnmaskedKeys: boolean };
}

export const SettingsExchangeSection: React.FC<SettingsExchangeSectionProps> = ({
  connectedExchange,
  selectedExchange,
  handleExchangeSelect,
  exchangeForm,
  handleExchangeFormChange,
  exchangeTestResult,
  handleTestExchange,
  handleSaveExchange,
  handleDisconnectExchange,
  savingExchange,
  settings,
}) => {
  return (
    <section id="exchange-connection" className="mb-12">
      <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
        🏦 Exchange Connection
      </h2>
      <SettingsCard>
        {connectedExchange ? (
          <div className="p-6 bg-green-500/10 border border-green-500/30 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircleIcon className="w-6 h-6 text-green-400" />
                <span className="text-xl font-bold text-white">Connected to {connectedExchange.name}</span>
              </div>
              <button
                onClick={handleDisconnectExchange}
                className="px-4 py-2 bg-red-500/70 text-white font-medium rounded-lg hover:bg-red-600/80 transition-all duration-300"
              >
                Disconnect
              </button>
            </div>
            <p className="text-sm text-green-300">API Key: {connectedExchange.apiKey.slice(0, 4)}...{connectedExchange.apiKey.slice(-4)}</p>
            <p className="text-xs text-green-400">The trading engine can now execute trades directly on your account.</p>
          </div>
        ) : (
          <div className="p-6 bg-yellow-500/10 border border-yellow-500/30 rounded-xl space-y-4">
            <div className="flex items-center gap-3">
              <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400" />
              <span className="text-xl font-bold text-white">No Exchange Connected</span>
            </div>
            <p className="text-sm text-yellow-300">Connect a supported exchange to enable automated trading features.</p>

            {/* Exchange Selection Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-4 pt-4 border-t border-white/10">
              {EXCHANGES.map((exchange) => (
                <div
                  key={exchange.id}
                  onClick={() => handleExchangeSelect(exchange.id)}
                  className={`flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:scale-[1.05] ${selectedExchange === exchange.id
                    ? 'border-purple-500 bg-purple-500/20 shadow-lg'
                    : 'border-slate-700/50 bg-slate-800/50 hover:bg-slate-700/50' }`}
                >
                  {React.createElement(exchange.logo, { size: 32 })}
                  <span className="text-xs text-gray-300 font-medium mt-1">{exchange.name}</span>
                </div>
              ))}
            </div>

            {selectedExchange && (
              <div className="space-y-4 mt-6">
                <h3 className="text-lg font-semibold text-white pt-2 border-t border-white/10">Enter API Credentials for {EXCHANGES.find(e => e.id === selectedExchange)?.name}</h3>
                {EXCHANGES.find(e => e.id === selectedExchange)?.fields.map(field => (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-300 mb-1 capitalize">
                      {field.replace('Key', ' Key').replace('passphrase', 'Passphrase')}
                    </label>
                    <SettingsInput
                      // Adjust type based on field name or global 'Show Keys' setting
                      type={field.toLowerCase().includes('passphrase') || settings.showUnmaskedKeys ? 'text' : 'password'}
                      name={field}
                      placeholder={`Enter ${field.replace('Key', ' Key').replace('passphrase', 'Passphrase')}`}
                      value={exchangeForm[field as keyof typeof exchangeForm]}
                      onChange={handleExchangeFormChange}
                    />
                  </div>
                ))}

                <ProviderTestResult result={exchangeTestResult} />

                <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                  <button
                    onClick={handleTestExchange}
                    disabled={savingExchange}
                    className="px-6 py-3 bg-blue-500/70 text-white font-semibold rounded-xl hover:bg-blue-600/80 transition-all duration-300 disabled:opacity-50"
                  >
                    {savingExchange ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={handleSaveExchange}
                    disabled={savingExchange || !exchangeForm.apiKey || !exchangeForm.secretKey}
                    className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50"
                  >
                    {savingExchange ? 'Saving...' : 'Save & Connect'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SettingsCard>
    </section>
  );
};
