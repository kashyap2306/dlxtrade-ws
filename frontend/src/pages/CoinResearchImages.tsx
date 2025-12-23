import React from 'react';

interface CoinResearchImagesProps {
  selectedCoinSymbol: string;
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

const CoinResearchImages: React.FC<CoinResearchImagesProps> = ({
  selectedCoinSymbol,
  selectedCoinData,
  mobileSectionsOpen,
  setMobileSectionsOpen
}) => {
  return (
    <>
      {/* Mobile Images Section */}
      <div className="lg:hidden bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
        <button
          onClick={() => setMobileSectionsOpen(prev => ({ ...prev, images: !prev.images }))}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <h4 className="text-lg font-semibold text-white">Images & Charts</h4>
          <svg
            className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.images ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {mobileSectionsOpen.images && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {selectedCoinData.coinImages?.slice(0, 4).map((image, index) => (
                <div key={index} className="bg-slate-700/50 rounded-lg p-2">
                  {image ? (
                    <img
                      src={image}
                      alt={`${selectedCoinSymbol} ${index === 0 ? 'logo' : 'chart'}`}
                      className="w-full h-24 object-cover rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-24 bg-slate-700/50 rounded flex items-center justify-center">
                      <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Desktop Images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {selectedCoinData.coinImages?.slice(0, 4).map((image, index) => (
          <div key={index} className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
            {image ? (
              <img
                src={image}
                alt={`${selectedCoinSymbol} ${index === 0 ? 'logo' : 'chart'}`}
                className="w-full h-32 object-cover rounded-lg"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-32 bg-slate-700/50 rounded-lg flex items-center justify-center">
                <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default CoinResearchImages;
