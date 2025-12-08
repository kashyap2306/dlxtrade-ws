import React from 'react';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { SettingsCard, SettingsInput } from './SettingsUtils';

interface SettingsPositionSizingSectionProps {
  tradingSettings: {
    positionSizingMap: Array<{ min: number; max: number; percent: number }>;
    manualCoins: string[];
  };
  setTradingSettings: (settings: any) => void;
  maxPositionPerTrade: number;
  sampleAccuracy: number;
  setSampleAccuracy: (accuracy: number) => void;
  updatePositionSizingMap: (index: number, field: string, value: number) => void;
  coinSearch: string;
  setCoinSearch: (search: string) => void;
  showCoinDropdown: boolean;
  setShowCoinDropdown: (show: boolean) => void;
  filteredCoins: string[];
  addCoinToManual: (coin: string) => void;
  removeCoinFromManual: (coin: string) => void;
  savingSettings: boolean;
  handleSaveTradingSettings: () => void;
  calculatePositionForAccuracy: (accuracy: number) => number;
}

export const SettingsPositionSizingSection: React.FC<SettingsPositionSizingSectionProps> = ({
  tradingSettings,
  setTradingSettings,
  maxPositionPerTrade,
  sampleAccuracy,
  setSampleAccuracy,
  updatePositionSizingMap,
  coinSearch,
  setCoinSearch,
  showCoinDropdown,
  setShowCoinDropdown,
  filteredCoins,
  addCoinToManual,
  removeCoinFromManual,
  savingSettings,
  handleSaveTradingSettings,
  calculatePositionForAccuracy,
}) => {
  return (
    <section id="position-sizing" className="mb-12">
      <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
        📊 Position Sizing & Coin Selection
      </h2>
      <SettingsCard>
        {/* Position Sizing Map */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-white mb-3">Position Sizing Map</h3>
          <p className="text-sm text-gray-400 mb-4">Define position size percentage based on predicted signal accuracy.</p>
          <div className="space-y-4">
            {tradingSettings.positionSizingMap.map((range: any, index: number) => (
              <div key={index} className="flex flex-col sm:flex-row gap-4 items-center p-3 bg-slate-800/30 rounded-xl border border-white/10">
                <div className="flex-1 w-full sm:w-auto">
                  <label className="block text-xs font-medium text-gray-300 mb-1">Min Accuracy (%)</label>
                  <SettingsInput
                    type="number"
                    min="0"
                    max="100"
                    value={range.min}
                    onChange={(e) => updatePositionSizingMap(index, 'min', parseInt(e.target.value))}
                  />
                </div>
                <div className="flex-1 w-full sm:w-auto">
                  <label className="block text-xs font-medium text-gray-300 mb-1">Max Accuracy (%)</label>
                  <SettingsInput
                    type="number"
                    min="0"
                    max="100"
                    value={range.max}
                    onChange={(e) => updatePositionSizingMap(index, 'max', parseInt(e.target.value))}
                  />
                </div>
                <div className="flex-1 w-full sm:w-auto">
                  <label className="block text-xs font-medium text-gray-300 mb-1">Position %</label>
                  <SettingsInput
                    type="number"
                    min="0"
                    max={maxPositionPerTrade}
                    value={range.percent}
                    onChange={(e) => updatePositionSizingMap(index, 'percent', parseInt(e.target.value))}
                  />
                </div>
                <button
                  onClick={() => {
                    const newMap = tradingSettings.positionSizingMap.filter((_, i) => i !== index);
                    setTradingSettings({ ...tradingSettings, positionSizingMap: newMap });
                  }}
                  className="flex-shrink-0 p-3 bg-red-500/50 text-white rounded-xl hover:bg-red-600/70 transition-all duration-300"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setTradingSettings({
                ...tradingSettings,
                positionSizingMap: [...tradingSettings.positionSizingMap, { min: 0, max: 0, percent: 0 }]
              })}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-purple-500/50 text-purple-400 rounded-xl hover:bg-purple-500/10 transition-all duration-300"
            >
              <PlusIcon className="w-5 h-5" /> Add Range
            </button>
          </div>
        </div>

        {/* Live Preview */}
        <div className="mt-8 p-5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <h4 className="text-sm font-semibold text-blue-200 mb-2">Live Preview:</h4>
          <div className="flex items-center gap-4">
            <label className="text-sm text-blue-200">Test Accuracy:</label>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={sampleAccuracy}
              onChange={(e) => setSampleAccuracy(parseInt(e.target.value))}
              className="w-full h-2 bg-purple-900/50 rounded-lg appearance-none cursor-pointer transition-all duration-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
            />
            <span className="text-lg font-bold text-white w-12 flex-shrink-0">{sampleAccuracy}%</span>
          </div>
          <div className="mt-2 text-center text-lg font-bold text-white">
            Position Size: <span className="text-purple-400">{calculatePositionForAccuracy(sampleAccuracy)}%</span> of Max ({maxPositionPerTrade}%)
          </div>
        </div>

        {/* Coin Selection */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-3">Manual Coin Selection</h3>
          <p className="text-sm text-gray-400 mb-4">Select specific coins for the engine to trade (if disabled, engine scans all markets)</p>
          <div className="relative">
            <SettingsInput
              type="text"
              placeholder="Search and add coin (e.g., BTCUSDT)"
              value={coinSearch}
              onChange={(e) => {
                setCoinSearch(e.target.value);
                setShowCoinDropdown(true);
              }}
              onFocus={() => setShowCoinDropdown(true)}
              onBlur={() => setTimeout(() => setShowCoinDropdown(false), 200)} // Delay hide to allow click
            />
            {showCoinDropdown && coinSearch && filteredCoins.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-slate-800/90 backdrop-blur-md rounded-xl shadow-xl max-h-60 overflow-y-auto border border-purple-500/30">
                {filteredCoins.slice(0, 10).map((coin) => (
                  <div
                    key={coin}
                    className="px-4 py-3 text-gray-200 hover:bg-purple-500/20 cursor-pointer transition-all duration-200"
                    onClick={() => addCoinToManual(coin)}
                  >
                    {coin}
                  </div>
                ))}
                {filteredCoins.length > 10 && (
                  <div className="px-4 py-3 text-gray-400 text-sm">...and {filteredCoins.length - 10} more</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {tradingSettings.manualCoins.map((coin) => (
              <span key={coin} className="flex items-center gap-1 bg-purple-500/20 text-purple-300 text-sm px-3 py-1 rounded-full">
                {coin}
                <button onClick={() => removeCoinFromManual(coin)} className="ml-1 text-purple-300 hover:text-white transition-all duration-200">
                  <XMarkIcon className="w-4 h-4" />
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Save Button for Trading Settings */}
        <div className="flex justify-end pt-4 border-t border-white/10">
          <button
            onClick={handleSaveTradingSettings}
            disabled={savingSettings}
            className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
          >
            {savingSettings ? 'Saving...' : 'Save Trading Configuration'}
          </button>
        </div>
      </SettingsCard>
    </section>
  );
};
