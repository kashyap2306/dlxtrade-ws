import React from 'react';
import NewsItem from './NewsItem';

interface CoinResearchNewsProps {
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

const CoinResearchNews: React.FC<CoinResearchNewsProps> = ({
  selectedCoinData,
  mobileSectionsOpen,
  setMobileSectionsOpen
}) => {
  return (
    <>
      {/* Mobile News Section */}
      <div className="lg:hidden bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
        <button
          onClick={() => setMobileSectionsOpen(prev => ({ ...prev, news: !prev.news }))}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <h4 className="text-lg font-semibold text-white">Recent News</h4>
          <svg
            className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.news ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {mobileSectionsOpen.news && (
          <div className="px-4 pb-4">
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {selectedCoinData.news?.length > 0 ? (
                selectedCoinData.news.slice(0, 5).map((newsItem, index) => (
                  <NewsItem key={index} article={newsItem} />
                ))
              ) : (
                <p className="text-slate-400 text-sm">No recent news available</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop News Feed */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
        <h4 className="text-lg font-semibold text-white mb-4">Recent News</h4>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {selectedCoinData.news?.length > 0 ? (
            selectedCoinData.news.slice(0, 5).map((newsItem, index) => (
              <NewsItem key={index} article={newsItem} />
            ))
          ) : (
            <p className="text-slate-400 text-sm">No recent news available</p>
          )}
        </div>
      </div>
    </>
  );
};

export default CoinResearchNews;
