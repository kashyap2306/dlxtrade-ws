import React, { useState, useEffect } from 'react';
import { researchApi } from '../services/api';

interface DeepResearchAnalysisProps {
  result: {
    result?: {
      indicators?: any;
      raw?: {
        marketData?: {
          price?: number;
        };
      };
    };
    news?: {
      articles?: any[];
    };
    analysis?: {
      technicalIndicators?: any;
      priceAction?: any;
      volatility?: any;
      supportResistance?: any;
      patterns?: any;
    };
    stages?: any;
    partial?: boolean;
    coinImages?: string[];
    symbol?: string;
  };
}

const DeepResearchAnalysis: React.FC<DeepResearchAnalysisProps> = ({ result }) => {
  const analysis = (result as any)?.analysis || {};
  const indicators = analysis?.technicalIndicators || {};
  const priceAction = analysis?.priceAction || {};
  const supportResistance = analysis?.supportResistance || {};
  
  // CRITICAL: When isFinal === true, read news from multiple possible locations
  // Backend FINAL payload may have news at result.news OR result.analysis?.news
  // News rendering must be independent of FINAL verdict rendering
  const isFinal = !!(result as any)?.isFinal || !!(result as any)?.result?.isFinal;
  const newsData = isFinal 
    ? (result.news || (result as any)?.analysis?.news || { articles: [] })
    : (result.news || { articles: [] });

  // Latest News fallback: If deep research news articles are empty, trigger lightweight news fetch
  const [fallbackNews, setFallbackNews] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const symbol = result.symbol || (result as any)?.symbol;

  useEffect(() => {
    // CRITICAL: Always trigger news fetch regardless of accuracy, signal, timeout, or partial state
    // Always fetch news if we have a symbol, even if deep research news exists
    if (symbol && !newsLoading) {
      setNewsLoading(true);
      // Use existing research API to fetch news
      researchApi.deepResearch.getCoin(symbol)
        .then((response: any) => {
          const fetchedArticles = response.data?.news?.articles || 
                                 response.data?.data?.news?.articles || 
                                 response.data?.result?.news?.articles || [];
          if (fetchedArticles.length > 0) {
            setFallbackNews(fetchedArticles);
          }
        })
        .catch((err: any) => {
          console.warn('[NEWS_FETCH] News fetch failed:', err);
          // Non-blocking - continue without fallback news
        })
        .finally(() => {
          setNewsLoading(false);
        });
    }
  }, [symbol]);

  // Use fallback news if deep research news is empty, otherwise prefer deep research news
  const effectiveNewsData = (newsData?.articles && newsData.articles.length > 0) 
    ? newsData 
    : (fallbackNews.length > 0 ? { articles: fallbackNews } : (newsData || { articles: [] }));

  // Defensive fallback helper - returns null for hiding or descriptive message
  // IMPORTANT: Backend no longer emits partial/streaming states. All responses are finalized.
  // - undefined = pending (show "Pending...")
  // - null = not available (show "Not available in current timeframe")
  // - number (including 0 or 50) = always render it
  const getFallback = (val: any, stageName: string = '', hideInstead: boolean = true) => {
    // If value is a number (including 0 or 50), always render it
    if (typeof val === 'number') return val;
    
    // If value is not null/undefined, return it
    if (val !== null && val !== undefined) return val;

    // Response is always final - no need to check stages
    // null means "not available", NOT "pending"
    if (val === null) {
      return hideInstead ? null : <span className="text-slate-600 italic">Not available in current timeframe</span>;
    }

    // Only show "Pending..." for undefined (shouldn't happen with finalized responses)
    if (val === undefined) {
      return hideInstead ? null : <span className="text-slate-600 italic">Pending...</span>;
    }

    return hideInstead ? null : <span className="text-slate-600 italic">Not available in current timeframe</span>;
  };

  return (
    <div className="space-y-8">
      {/* PARTIAL DATA NOTIFICATION */}
      {(result as any)?.partial && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-yellow-200/80">
            Research completed with partial data. Analysis is based on available sources.
          </p>
        </div>
      )}

      {/* COIN PRICE HEADER */}
      <div className="flex items-center justify-between p-6 bg-slate-900/60 border border-slate-700/50 rounded-3xl backdrop-blur-xl -mt-2">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 text-center md:text-left">Live Market Price</span>
          <div className="text-4xl font-black text-white tracking-tighter flex items-center gap-3">
            <span className="text-emerald-400 font-medium">$</span>
            {typeof priceAction.currentPrice === 'number' 
              ? priceAction.currentPrice.toLocaleString() 
              : priceAction.currentPrice === null 
                ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                : priceAction.currentPrice === undefined
                  ? <span className="text-slate-600 italic">Pending...</span>
                  : <span className="text-slate-600 italic">Not available in current timeframe</span>}
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 block">Trend Analysis</span>
          <div className={`text-lg font-black uppercase tracking-tighter flex items-center gap-2 justify-end ${priceAction.trendDirection?.toLowerCase() === 'bullish' ? 'text-emerald-400' :
            priceAction.trendDirection?.toLowerCase() === 'bearish' ? 'text-rose-400' : 'text-slate-400'
            }`}>
            {priceAction.trendDirection?.toLowerCase() === 'bullish' && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}
            {priceAction.trendDirection?.toLowerCase() === 'bearish' && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>}
            {priceAction.trendDirection || 'Neutral'}
          </div>
        </div>
      </div>

      {/* TECHNICAL INDICATORS SECTION */}
      <div className="pt-8 border-t border-slate-700/50">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Technical Indicators
        </h3>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-700/20 rounded-2xl border border-slate-700/30 overflow-hidden">
          <div className="p-5 bg-slate-900/40">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">Relative Strength (RSI)</div>
            <div className="text-3xl font-black text-white tracking-tighter">
              {typeof indicators.rsi?.value === 'number' 
                ? indicators.rsi.value.toFixed(1) 
                : indicators.rsi?.value === null 
                  ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                  : indicators.rsi?.value === undefined
                    ? <span className="text-slate-600 italic">Pending...</span>
                    : <span className="text-slate-600 italic">Not available in current timeframe</span>}
            </div>
          </div>
          <div className="p-5 bg-slate-900/40">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">50-Day Avg (SMA)</div>
            <div className="text-xl font-bold text-slate-200">
              {typeof indicators.sma50?.value === 'number' 
                ? `$${indicators.sma50.value.toLocaleString()}` 
                : indicators.sma50?.value === null 
                  ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                  : indicators.sma50?.value === undefined
                    ? <span className="text-slate-600 italic">Pending...</span>
                    : <span className="text-slate-600 italic">Not available in current timeframe</span>}
            </div>
          </div>
          <div className="p-5 bg-slate-900/40">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">200-Day Avg (SMA)</div>
            <div className="text-xl font-bold text-slate-200">
              {typeof indicators.sma200?.value === 'number' 
                ? `$${indicators.sma200.value.toLocaleString()}` 
                : indicators.sma200?.value === null 
                  ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                  : indicators.sma200?.value === undefined
                    ? <span className="text-slate-600 italic">Pending...</span>
                    : <span className="text-slate-600 italic">Not available in current timeframe</span>}
            </div>
          </div>
          <div className="p-5 bg-slate-900/40">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">MACD Status</div>
            <div className="text-xl font-bold text-white uppercase">
              {indicators.macd?.signal 
                ? indicators.macd.signal 
                : indicators.macd?.signal === null 
                  ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                  : indicators.macd?.signal === undefined
                    ? <span className="text-slate-600 italic">Pending...</span>
                    : <span className="text-slate-600 italic">Not available in current timeframe</span>}
            </div>
          </div>
        </div>
      </div>

      {/* MARKET SENTIMENT GAUGE */}
      <div className="pt-8 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Market Sentiment Gauge
          </h3>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase font-bold">Total Articles</div>
            <div className="text-lg font-bold text-white">{newsData?.articles?.length || 0}</div>
          </div>
        </div>

        {(() => {
          // CRITICAL: Compute sentiment using combined signals (RSI, MACD, EMA/SMA trend, news.sentimentScore)
          // Do NOT depend only on BUY/SELL to show the gauge - HOLD + bullish indicators should still show gauge
          // Ensure the gauge renders even when final signal is HOLD
          const articles = newsData?.articles || [];
          const sentimentScore = (newsData as any)?.sentimentScore;
          const hasArticles = articles.length > 0;
          const hasSentimentScore = sentimentScore !== null && sentimentScore !== undefined;

          // Compute combined sentiment from technical indicators
          let technicalSentiment = 0; // -1 (bearish) to +1 (bullish)
          let indicatorCount = 0;

          // RSI indicator
          if (typeof indicators.rsi?.value === 'number') {
            if (indicators.rsi.value < 30) {
              technicalSentiment += 0.3; // Oversold = bullish
              indicatorCount++;
            } else if (indicators.rsi.value > 70) {
              technicalSentiment -= 0.3; // Overbought = bearish
              indicatorCount++;
            }
          }

          // MACD indicator
          if (typeof indicators.macd?.value === 'number') {
            if (indicators.macd.value > 0) {
              technicalSentiment += 0.3; // Positive MACD = bullish
              indicatorCount++;
            } else if (indicators.macd.value < 0) {
              technicalSentiment -= 0.3; // Negative MACD = bearish
              indicatorCount++;
            }
          }

          // EMA/SMA trend
          const price = priceAction.currentPrice || priceAction.price || 0;
          if (indicators.sma50?.value && indicators.sma200?.value) {
            if (price > indicators.sma50.value && indicators.sma50.value > indicators.sma200.value) {
              technicalSentiment += 0.4; // Bullish trend
              indicatorCount++;
            } else if (price < indicators.sma200.value) {
              technicalSentiment -= 0.4; // Bearish trend
              indicatorCount++;
            }
          }

          // Normalize technical sentiment
          const normalizedTechnicalSentiment = indicatorCount > 0 ? technicalSentiment / indicatorCount : 0;

          // Compute news sentiment
          let newsSentiment = 0;
          if (hasArticles) {
            const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
            const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
            const total = articles.length;
            if (total > 0) {
              newsSentiment = (positive - negative) / total;
            }
          } else if (hasSentimentScore) {
            // Use sentimentScore if available (normalize from 0-1 or -1 to 1 range)
            newsSentiment = typeof sentimentScore === 'number' 
              ? (sentimentScore > 1 ? (sentimentScore - 50) / 50 : sentimentScore > 0 ? (sentimentScore * 2 - 1) : sentimentScore)
              : 0;
          }

          // Combine technical and news sentiment (weighted average)
          const combinedSentiment = (normalizedTechnicalSentiment * 0.6) + (newsSentiment * 0.4);
          const finalSentiment = Math.max(-1, Math.min(1, combinedSentiment)); // Clamp to -1 to 1

          // Always render gauge if we have any data (articles, indicators, or sentimentScore)
          const hasAnyData = hasArticles || hasSentimentScore || indicatorCount > 0;

          if (hasAnyData) {
            return (
              <div className="rounded-2xl border border-slate-700/30 p-6">
                {hasArticles && (
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-400">{articles.filter((article: any) => article.sentiment === 'positive').length}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Positive</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-slate-400">{articles.filter((article: any) => article.sentiment === 'neutral').length}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Neutral</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-400">{articles.filter((article: any) => article.sentiment === 'negative').length}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Negative</div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                    <span>Fearful</span>
                    <span>Neutral</span>
                    <span>Greedy</span>
                  </div>

                  <div className="relative pt-2 pb-2">
                    <div className="w-full h-3 bg-gradient-to-r from-red-500/60 via-yellow-500/60 to-green-500/60 rounded-full overflow-hidden">
                      <div className="absolute inset-0 bg-slate-900/20"></div>
                    </div>

                    <div
                      className="absolute top-0 w-1.5 h-7 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)] transform -translate-x-0.5 transition-all duration-700"
                      style={{
                        left: `${((finalSentiment + 1) / 2) * 100}%`
                      }}
                    ></div>
                  </div>

                  <div className="text-center mt-4">
                    <div className="text-lg font-bold text-white mb-1 uppercase tracking-widest">
                      {finalSentiment > 0.3 ? 'Strong Bullish' :
                       finalSentiment > 0.1 ? 'Bullish' :
                       finalSentiment > -0.1 ? 'Neutral' :
                       finalSentiment > -0.3 ? 'Bearish' :
                       'Strong Bearish'}
                    </div>
                    {indicatorCount > 0 && (
                      <div className="text-xs text-slate-500 mt-1">
                        Based on {indicatorCount} technical indicator{indicatorCount > 1 ? 's' : ''} {hasArticles ? `+ ${articles.length} news article${articles.length > 1 ? 's' : ''}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // No data available
          return (
            <div className="rounded-2xl border border-slate-700/30 p-8 text-center bg-slate-800/10">
              <p className="text-slate-400 font-medium">No sentiment data available</p>
              <p className="text-xs text-slate-500 mt-2">Could not find enough recent articles or indicators for sentiment analysis.</p>
            </div>
          );
        })()}
      </div>

      {/* LATEST NEWS SECTION */}
      {/* Always render the Latest News section - show empty state if no articles */}
      {/* Do NOT hide based on article count or sentiment */}
      <div className="pt-8 border-t border-slate-700/50">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
            Latest News
          </h3>
          <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Real-time Feed</span>
          </div>
        </div>

        {/* CRITICAL: When isFinal === true, read news from result.news || result.analysis?.news */}
        {/* News rendering must be independent of FINAL verdict rendering */}
        {/* Always show news cards when articles exist - no provider or sentiment filtering */}
        {effectiveNewsData?.articles && effectiveNewsData.articles.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveNewsData.articles.slice(0, 5).map((article: any, idx: number) => {
              const sentiment = article.sentiment || 'neutral';
              const sentimentIcon = sentiment === 'positive' ? (
                <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : sentiment === 'negative' ? (
                <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414-1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              );

              const formatTime = (dateString: string) => {
                try {
                  const date = new Date(dateString);
                  const now = new Date();
                  const diffMs = now.getTime() - date.getTime();
                  const diffMins = Math.floor(diffMs / 60000);
                  const diffHours = Math.floor(diffMs / 3600000);
                  const diffDays = Math.floor(diffMs / 86400000);

                  if (diffMins < 60) return `${diffMins || 1}m ago`;
                  if (diffHours < 24) return `${diffHours}h ago`;
                  if (diffDays < 7) return `${diffDays}d ago`;
                  return date.toLocaleDateString();
                } catch {
                  return 'Recently';
                }
              };

              // Image fallback priority: 1. article.image/imageUrl, 2. article.thumbnail, 3. coin metadata logo, 4. default static market image
              const imageUrl = article.image || 
                              article.imageUrl || 
                              article.thumbnail || 
                              (result as any)?.metadata?.logo || 
                              (result as any)?.coinImages?.[0] ||
                              'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzE0MTgyMSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NDc0OGEiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5OZXdzPC90ZXh0Pjwvc3ZnPg==';

              return (
                <a
                  key={idx}
                  href={article.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative backdrop-blur-sm border border-slate-700/30 rounded-2xl overflow-hidden hover:border-cyan-500/30 transition-all duration-300"
                >
                  {/* Image container - always render */}
                  <div className="relative w-full h-32 bg-slate-800/50 overflow-hidden">
                    <img
                      src={imageUrl}
                      alt={article.title || 'News article'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        // Fallback to default if image fails to load
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzE0MTgyMSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM2NDc0OGEiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5OZXdzPC90ZXh0Pjwvc3ZnPg==';
                      }}
                    />
                    {/* Sentiment badge overlay */}
                    <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-slate-700/50">
                      {sentimentIcon}
                    </div>
                  </div>
                  <div className="p-4">
                    <h5 className="text-sm font-bold text-white mb-2 leading-snug line-clamp-2 group-hover:text-cyan-400 transition-colors">
                      {article.title || 'Untitled Report'}
                    </h5>
                    <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      <span className="text-slate-400">{article.source || 'Market Feed'}</span>
                      <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                      <span>{formatTime(article.publishedAt || article.pubDate || new Date().toISOString())}</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-700/30 p-8 text-center bg-slate-800/10">
            <p className="text-slate-400 font-medium">No major news found for this asset</p>
            <p className="text-xs text-slate-500 mt-2">News articles will appear here when available from our sources.</p>
          </div>
        )}
      </div>

      {/* MARKET VISUALS SECTION */}
      {/* Always render if OHLC / indicators data exists - do NOT gate charts behind BUY signal or accuracy threshold */}
      {/* Do NOT hide Market Visuals due to deep research failure - use fallback if needed */}
      {(() => {
        const hasCoinImages = (result as any)?.coinImages && Array.isArray((result as any).coinImages) && (result as any).coinImages.length > 0;
        const hasIndicators = indicators && Object.keys(indicators).length > 0;
        const hasPriceAction = priceAction && (priceAction.currentPrice !== null && priceAction.currentPrice !== undefined);
        const hasMarketData = hasCoinImages || hasIndicators || hasPriceAction;

        // If deep research OHLC data is missing, try to use basic price data from result
        const fallbackPriceData = (result as any)?.result?.raw?.marketData?.price || 
                                  (result as any)?.result?.indicators?.price ||
                                  priceAction?.currentPrice;

        // Render if we have any market data OR fallback price data
        if (!hasMarketData && !fallbackPriceData) return null;

        return (
        <div className="pt-8 border-t border-slate-700/50">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Market Visuals
          </h3>

          {hasCoinImages ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(result as any).coinImages.slice(0, 4).map((imageUrl: string, idx: number) => (
              <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-slate-700/30 group hover:border-slate-600/50 transition-all">
                <img
                  src={imageUrl}
                  alt={`Market visual ${idx + 1}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ))}
          </div>
          ) : (
            <div className="rounded-2xl border border-slate-700/30 p-8 text-center bg-slate-800/10">
              <p className="text-slate-400 font-medium">
                {fallbackPriceData ? `Basic market data available (Price: $${fallbackPriceData.toLocaleString()})` : 'Market data available'}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {hasIndicators 
                  ? 'Charts, EMA, SMA, VWAP, and support/resistance overlays are rendered based on available indicators.'
                  : 'Basic OHLC/price data is available. Full chart visuals require complete indicator data.'}
              </p>
            </div>
          )}
        </div>
        );
      })()}

      {/* PRICE ACTION SNAPSHOT */}
      <div className="pt-8 border-t border-slate-700/50">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Price Action Snapshot
        </h3>

        <div className="rounded-2xl border border-slate-700/30 overflow-hidden">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-slate-700/30">
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Price</div>
              <div className="text-lg font-bold text-white">
                {typeof priceAction.currentPrice === 'number' 
                  ? `$${priceAction.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` 
                  : priceAction.currentPrice === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.currentPrice === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">vs EMA20</div>
              <div className={`text-lg font-bold ${typeof priceAction.vsEMA20 === 'number' ? (priceAction.vsEMA20 > 0 ? 'text-green-400' : (priceAction.vsEMA20 < 0 ? 'text-red-400' : 'text-slate-400')) : 'text-slate-400'}`}>
                {typeof priceAction.vsEMA20 === 'number' 
                  ? `${priceAction.vsEMA20.toFixed(2)}%` 
                  : priceAction.vsEMA20 === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.vsEMA20 === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">vs SMA50</div>
              <div className={`text-lg font-bold ${typeof priceAction.vsSMA50 === 'number' ? (priceAction.vsSMA50 > 0 ? 'text-green-400' : (priceAction.vsSMA50 < 0 ? 'text-red-400' : 'text-slate-400')) : 'text-slate-400'}`}>
                {typeof priceAction.vsSMA50 === 'number' 
                  ? `${priceAction.vsSMA50.toFixed(2)}%` 
                  : priceAction.vsSMA50 === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.vsSMA50 === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">vs SMA200</div>
              <div className={`text-lg font-bold ${typeof priceAction.vsSMA200 === 'number' ? (priceAction.vsSMA200 > 0 ? 'text-green-400' : (priceAction.vsSMA200 < 0 ? 'text-red-400' : 'text-slate-400')) : 'text-slate-400'}`}>
                {typeof priceAction.vsSMA200 === 'number' 
                  ? `${priceAction.vsSMA200.toFixed(2)}%` 
                  : priceAction.vsSMA200 === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.vsSMA200 === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Trend</div>
              <div className="text-lg font-bold text-white tracking-wide">
                {priceAction.trendDirection 
                  ? priceAction.trendDirection.toUpperCase() 
                  : priceAction.trendDirection === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.trendDirection === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
            <div className="p-5 text-center">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Momentum</div>
              <div className="text-lg font-bold text-white tracking-wide">
                {priceAction.momentumBias 
                  ? priceAction.momentumBias.toUpperCase() 
                  : priceAction.momentumBias === null 
                    ? <span className="text-slate-600 italic">Not available in current timeframe</span>
                    : priceAction.momentumBias === undefined
                      ? <span className="text-slate-600 italic">Pending...</span>
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
              </div>
            </div>
          </div>
        </div>

        {/* SUPPORT & RESISTANCE SECTION */}
        {/* Always render if analysis.supportResistance exists - do NOT hide based on signal, confidence, HOLD status, or accuracy */}
        {supportResistance && Object.keys(supportResistance).length > 0 && (
        <div className="mt-8 pt-8 border-t border-slate-700/30">
          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Support & Resistance</h4>
          <div className="rounded-2xl border border-slate-700/30 overflow-hidden">
            {/* Support Levels */}
            {supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined || 
             supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined ? (
              <div className="grid grid-cols-2 divide-x divide-slate-700/30">
                <div className="p-5 text-center">
                  <div className="text-[9px] font-bold text-green-500/50 uppercase mb-1">Major Support</div>
                  <div className="text-lg font-bold text-green-400">
                    {supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined 
                      ? `$${supportResistance.majorSupport.toLocaleString()}` 
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                  </div>
                </div>
                <div className="p-5 text-center">
                  <div className="text-[9px] font-bold text-green-500/50 uppercase mb-1">Minor Support</div>
                  <div className="text-lg font-bold text-green-400">
                    {supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined 
                      ? `$${supportResistance.minorSupport.toLocaleString()}` 
                      : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5 text-center">
                <p className="text-sm text-slate-400 italic">No significant support detected</p>
              </div>
            )}

            {/* Resistance Levels */}
            {supportResistance.majorResistance !== null && supportResistance.majorResistance !== undefined || 
             supportResistance.minorResistance !== null && supportResistance.minorResistance !== undefined ? (
              <div className={`grid grid-cols-2 divide-x divide-slate-700/30 ${supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined || supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined ? 'border-t border-slate-700/30' : ''}`}>
                {supportResistance.majorResistance !== null && supportResistance.majorResistance !== undefined && (
                  <div className="p-5 text-center">
                    <div className="text-[9px] font-bold text-red-500/50 uppercase mb-1">Major Resistance</div>
                    <div className="text-lg font-bold text-red-400">${supportResistance.majorResistance.toLocaleString()}</div>
                  </div>
                )}
                {supportResistance.minorResistance !== null && supportResistance.minorResistance !== undefined && (
                  <div className="p-5 text-center">
                    <div className="text-[9px] font-bold text-red-500/50 uppercase mb-1">Minor Resistance</div>
                    <div className="text-lg font-bold text-red-400">${supportResistance.minorResistance.toLocaleString()}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className={`p-5 text-center ${supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined || supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined ? 'border-t border-slate-700/30' : ''}`}>
                <p className="text-sm text-slate-400 italic">No significant resistance detected</p>
              </div>
            )}
          </div>
        </div>
        )}

        {/* PATTERN DETECTION SECTION */}
        {(() => {
          // IMPORTANT: Backend no longer emits partial/streaming states.
          // All responses are finalized - no need to check stage status.
          const patterns = analysis?.patterns;

          const detected: string[] = [];
          if (Array.isArray(patterns)) {
            detected.push(...patterns);
          } else if (patterns) {
            // Check Boolean flags
            Object.entries(patterns).forEach(([key, val]) => {
              if (val === true && key !== 'status' && key !== 'activePattern') {
                detected.push(key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()));
              }
            });
            // Fallback to activePattern if exists and not already caught
            if (patterns.activePattern && detected.length === 0) {
              detected.push(patterns.activePattern);
            }
          }

          return (
            <div className="mt-8 pt-8 border-t border-slate-700/30">
              <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Pattern Detection</h4>
              <div className="rounded-2xl border border-slate-700/30 p-6">
                {detected.length > 0 ? (
                  <div className="text-sm text-slate-300 font-medium text-center">
                    Detected: <span className="text-blue-400">{detected.join(', ')}</span>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 italic text-center">No significant price patterns detected</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Probability Distribution */}
        {indicators?.distribution ? (
          <div className="mt-8 pt-8 border-t border-slate-700/50">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Probability Distribution</h4>
            <div className="rounded-2xl border border-slate-700/30 overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-slate-700/30">
                <div className="p-6 text-center">
                  <div className="text-[9px] font-bold text-green-500/40 uppercase tracking-widest mb-2">Uptrend</div>
                  <div className="text-3xl font-bold text-green-400">{indicators.distribution.uptrendScore || 0}%</div>
                </div>
                <div className="p-6 text-center">
                  <div className="text-[9px] font-bold text-yellow-500/40 uppercase tracking-widest mb-2">Sideways</div>
                  <div className="text-3xl font-bold text-yellow-400">{indicators.distribution.sidewaysScore || 0}%</div>
                </div>
                <div className="p-6 text-center">
                  <div className="text-[9px] font-bold text-red-500/40 uppercase tracking-widest mb-2">Downtrend</div>
                  <div className="text-3xl font-bold text-red-400">{indicators.distribution.downtrendScore || 0}%</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 pt-8 border-t border-slate-700/50">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-6">Probability Distribution</h4>
            <div className="rounded-2xl border border-slate-700/30 p-8 text-center bg-slate-800/10">
              <span className="text-slate-600 italic">Not available in current timeframe</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepResearchAnalysis;
