import React from 'react';
import CoinResearchLoading from './CoinResearchLoading';
import CoinResearchHeader from './CoinResearchHeader';
import CoinResearchAnalysis from './CoinResearchAnalysis';
import CoinResearchImages from './CoinResearchImages';
import CoinResearchNews from './CoinResearchNews';

interface CoinResearchSectionProps {
  selectedCoinSymbol: string | null;
  coinResearchLoading: boolean;
  selectedCoinData: any;
  mobileSectionsOpen: {
    analysis: boolean;
    metrics: boolean;
    news: boolean;
    images: boolean;
  };
  setMobileSectionsOpen: React.Dispatch<React.SetStateAction<{
    analysis: boolean;
    metrics: boolean;
    news: boolean;
    images: boolean;
  }>>;
}

const CoinResearchSection: React.FC<CoinResearchSectionProps> = ({
  selectedCoinSymbol,
  coinResearchLoading,
  selectedCoinData,
  mobileSectionsOpen,
  setMobileSectionsOpen
}) => {
  return (
    <section className="mb-16">
      <div className="relative">
        {/* Background gradient card */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/40 via-slate-800/40 to-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-900/30"></div>

        {/* Gradient accent lines */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500 rounded-t-3xl"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-b-3xl"></div>

        <div className="relative p-8 rounded-3xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
                Deep Research
              </h2>
              <p className="text-slate-300">Comprehensive market analysis with real-time data and provider failover</p>
            </div>
          </div>

          {/* Coin Research Display */}
          {selectedCoinSymbol && (
            <div className="space-y-6">
              {coinResearchLoading ? (
                <CoinResearchLoading
                  selectedCoinSymbol={selectedCoinSymbol}
                  coinResearchLoading={coinResearchLoading}
                />
              ) : selectedCoinData ? (
                <div className="space-y-4 lg:space-y-6">
                  {/* Mobile: Accordion Sections */}
                  <div className="lg:hidden space-y-4">
                    <CoinResearchHeader
                      selectedCoinSymbol={selectedCoinSymbol}
                      selectedCoinData={selectedCoinData}
                    />

                    <CoinResearchAnalysis
                      selectedCoinData={selectedCoinData}
                      mobileSectionsOpen={mobileSectionsOpen}
                      setMobileSectionsOpen={setMobileSectionsOpen}
                    />

                    <CoinResearchImages
                      selectedCoinSymbol={selectedCoinSymbol}
                      selectedCoinData={selectedCoinData}
                      mobileSectionsOpen={mobileSectionsOpen}
                      setMobileSectionsOpen={setMobileSectionsOpen}
                    />

                    <CoinResearchNews
                      selectedCoinData={selectedCoinData}
                      mobileSectionsOpen={mobileSectionsOpen}
                      setMobileSectionsOpen={setMobileSectionsOpen}
                    />
                  </div>

                  {/* Desktop: Grid Layout */}
                  <div className="hidden lg:grid lg:grid-cols-3 gap-6">
                    {/* Left Column - Charts & Images */}
                    <div className="lg:col-span-2 space-y-6">
                      <CoinResearchHeader
                        selectedCoinSymbol={selectedCoinSymbol}
                        selectedCoinData={selectedCoinData}
                      />

                      <CoinResearchImages
                        selectedCoinSymbol={selectedCoinSymbol}
                        selectedCoinData={selectedCoinData}
                        mobileSectionsOpen={mobileSectionsOpen}
                        setMobileSectionsOpen={setMobileSectionsOpen}
                      />
                    </div>

                    {/* Right Column - Analysis & News */}
                    <div className="space-y-6">
                      <CoinResearchAnalysis
                        selectedCoinData={selectedCoinData}
                        mobileSectionsOpen={mobileSectionsOpen}
                        setMobileSectionsOpen={setMobileSectionsOpen}
                      />

                      <CoinResearchNews
                        selectedCoinData={selectedCoinData}
                        mobileSectionsOpen={mobileSectionsOpen}
                        setMobileSectionsOpen={setMobileSectionsOpen}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <CoinResearchLoading
                  selectedCoinSymbol={selectedCoinSymbol}
                  coinResearchLoading={coinResearchLoading}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default CoinResearchSection;
