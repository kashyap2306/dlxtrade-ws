import React from 'react';

interface DeepResearchNewsProps {
  result: {
    news?: {
      articles?: any[];
    };
  };
}

const DeepResearchNews: React.FC<DeepResearchNewsProps> = ({
  result
}) => {
  return (
    <>
      {/* NEWS IMPACT SUMMARY */}
      {result.news?.articles && result.news.articles.length > 0 && (
        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-pink-500/5"></div>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-pink-500"></div>

          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                News Impact Summary
              </h3>
              <div className="text-right">
                <div className="text-sm text-slate-400">Total Articles</div>
                <div className="text-lg font-bold text-white">{result.news.articles.length}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                  <span className="text-sm font-medium text-slate-300">Positive</span>
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {result.news.articles.filter((article: any) => article.sentiment === 'positive').length}
                </div>
                <div className="text-xs text-slate-400">Bullish articles</div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 bg-slate-400 rounded-full"></div>
                  <span className="text-sm font-medium text-slate-300">Neutral</span>
                </div>
                <div className="text-2xl font-bold text-slate-400">
                  {result.news.articles.filter((article: any) => article.sentiment === 'neutral').length}
                </div>
                <div className="text-xs text-slate-400">Neutral articles</div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                  <span className="text-sm font-medium text-slate-300">Negative</span>
                </div>
                <div className="text-2xl font-bold text-red-400">
                  {result.news.articles.filter((article: any) => article.sentiment === 'negative').length}
                </div>
                <div className="text-xs text-slate-400">Bearish articles</div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 bg-blue-400 rounded-full"></div>
                  <span className="text-sm font-medium text-slate-300">Impact</span>
                </div>
                <div className={`text-2xl font-bold ${(() => {
                  const positive = result.news.articles.filter((a: any) => a.sentiment === 'positive').length;
                  const negative = result.news.articles.filter((a: any) => a.sentiment === 'negative').length;
                  const total = result.news.articles.length;

                  if (total === 0) return 'text-slate-400';
                  const netSentiment = (positive - negative) / total;

                  if (netSentiment > 0.3) return 'text-green-400';
                  if (netSentiment < -0.3) return 'text-red-400';
                  return 'text-yellow-400';
                })()
                  }`}>
                  {(() => {
                    const positive = result.news.articles.filter((a: any) => a.sentiment === 'positive').length;
                    const negative = result.news.articles.filter((a: any) => a.sentiment === 'negative').length;
                    const total = result.news.articles.length;

                    if (total === 0) return 'N/A';
                    const netSentiment = (positive - negative) / total;

                    if (netSentiment > 0.3) return 'High';
                    if (netSentiment > 0.1) return 'Medium';
                    if (netSentiment > -0.1) return 'Low';
                    if (netSentiment > -0.3) return 'Medium';
                    return 'High';
                  })()}
                </div>
                <div className="text-xs text-slate-400">News influence</div>
              </div>
            </div>

            <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-2">Market Sentiment Analysis</h4>
              <div className="text-sm text-slate-400 leading-relaxed">
                {(() => {
                  const positive = result.news.articles.filter((a: any) => a.sentiment === 'positive').length;
                  const negative = result.news.articles.filter((a: any) => a.sentiment === 'negative').length;
                  const neutral = result.news.articles.filter((a: any) => a.sentiment === 'neutral').length;
                  const total = result.news.articles.length;

                  if (total === 0) return 'No news articles available for sentiment analysis.';

                  const positivePercent = (positive / total) * 100;
                  const negativePercent = (negative / total) * 100;
                  const neutralPercent = (neutral / total) * 100;

                  let analysis = `Analysis of ${total} articles shows `;
                  if (positivePercent > negativePercent && positivePercent > 35) {
                    analysis += `${positivePercent.toFixed(0)}% positive sentiment, indicating bullish market outlook. `;
                  } else if (negativePercent > positivePercent && negativePercent > 35) {
                    analysis += `${negativePercent.toFixed(0)}% negative sentiment, suggesting bearish market conditions. `;
                  } else {
                    analysis += `mixed sentiment with ${neutralPercent.toFixed(0)}% neutral articles, indicating market uncertainty. `;
                  }

                  if (positive > negative) {
                    analysis += 'Overall sentiment leans positive.';
                  } else if (negative > positive) {
                    analysis += 'Overall sentiment leans negative.';
                  } else {
                    analysis += 'Overall sentiment is balanced.';
                  }

                  return analysis;
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEWS SECTION */}
      {result.news?.articles && result.news.articles.length > 0 && (
        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 via-emerald-500/5 to-teal-500/5"></div>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500"></div>

          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                News Feed
              </h3>
              <div className="text-right">
                <div className="text-sm text-slate-400">{result.news.articles.length} Articles</div>
                <div className="text-xs text-green-400">Latest Updates</div>
              </div>
            </div>

            <div className="space-y-3">
              {result.news.articles.map((article: any, index: number) => (
                <div
                  key={index}
                  onClick={() => window.open(article.url, '_blank')}
                  className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 hover:border-slate-500/50 transition-all duration-200 cursor-pointer group"
                >
                  <div className="flex items-start gap-4">
                    {/* Sentiment Badge */}
                    <div className="flex-shrink-0 mt-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${article.sentiment === 'positive' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                        article.sentiment === 'negative' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                        }`}>
                        {article.sentiment === 'positive' ? 'Bullish' :
                          article.sentiment === 'negative' ? 'Bearish' : 'Neutral'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-white font-medium text-sm leading-tight mb-2 group-hover:text-blue-300 transition-colors">
                            {article.title}
                          </h4>
                          <p className="text-slate-400 text-xs leading-relaxed mb-3 line-clamp-2">
                            {article.summary || article.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="flex items-center gap-2">
                          <span>{article.source}</span>
                          {article.published_at && (
                            <>
                              <span>•</span>
                              <span>{new Date(article.published_at).toLocaleDateString()}</span>
                            </>
                          )}
                        </span>
                        <svg className="w-3 h-3 text-slate-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DeepResearchNews;
