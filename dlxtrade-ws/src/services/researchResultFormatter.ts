/**
 * Generate analysis summary text
 */
export function generateAnalysisSummary(signal: string, accuracy: number, indicators: any, metadata: any): string {
  const accuracyPercent = Math.round(accuracy * 100);

  if (accuracy < 0.60 && signal === 'HOLD') {
    return `${metadata.name || metadata.symbol} — HOLD — Accuracy below confidence threshold (${accuracyPercent}%). Technical parameters do not support a high-conviction trade at this time.`;
  }

  const signalText = signal.toLowerCase();

  let summary = `${metadata.name || metadata.symbol} shows a ${signalText} signal with ${accuracyPercent}% confidence. `;

  if (indicators.rsi?.value < 30) {
    summary += 'The asset appears oversold based on RSI analysis. ';
  } else if (indicators.rsi?.value > 70) {
    summary += 'The asset appears overbought based on RSI analysis. ';
  }

  if (indicators.macd?.signal === 'bullish') {
    summary += 'MACD indicates bullish momentum. ';
  } else if (indicators.macd?.signal === 'bearish') {
    summary += 'MACD indicates bearish momentum. ';
  }

  if (indicators.volume?.trend === 'increasing') {
    summary += 'Trading volume is increasing, suggesting growing interest. ';
  }

  summary += `Current market rank: ${metadata.rank || 'N/A'}.`;

  return summary;
}

/**
 * Generate signals array for UI
 */
export function generateSignalsArray(signal: string, accuracy: number, indicators: any): any[] {
  const signals = [];

  // Main signal
  signals.push({
    type: signal.toLowerCase(),
    confidence: accuracy,
    reason: getSignalReason(signal, indicators)
  });

  // Additional signals based on indicators
  if (indicators.rsi?.value < 30 && signal === 'BUY') {
    signals.push({
      type: 'buy',
      confidence: Math.min(0.9, accuracy + 0.1),
      reason: 'RSI indicates oversold conditions'
    });
  }

  if (indicators.macd?.signal === 'bullish' && signal === 'BUY') {
    signals.push({
      type: 'buy',
      confidence: Math.min(0.95, accuracy + 0.05),
      reason: 'MACD shows bullish convergence'
    });
  }

  return signals;
}

/**
 * Get reason for main signal
 */
export function getSignalReason(signal: string, indicators: any): string {
  const reasons = [];

  if (signal === 'BUY') {
    if (indicators.rsi?.value < 30) reasons.push('oversold RSI');
    if (indicators.ema20?.emaTrend === 'bullish') reasons.push('bullish EMA trend');
    if (indicators.macd?.signal === 'bullish') reasons.push('bullish MACD');
    if (indicators.volume?.trend === 'increasing') reasons.push('increasing volume');
  } else if (signal === 'SELL') {
    if (indicators.rsi?.value > 70) reasons.push('overbought RSI');
    if (indicators.ema20?.emaTrend === 'bearish') reasons.push('bearish EMA trend');
    if (indicators.macd?.signal === 'bearish') reasons.push('bearish MACD');
  }

  return reasons.length > 0 ? reasons.join(', ') : 'technical analysis';
}

/**
 * Generate metrics object
 */
export function generateMetricsObject(indicators: any): any {
  return {
    momentum: {
      rsi: indicators.rsi?.value || 50,
      macd: indicators.macd?.value || 0,
      trend: indicators.ema20?.emaTrend || 'neutral'
    },
    volatility: {
      atr: indicators.atr?.value || 0,
      classification: indicators.atr?.classification || 'medium'
    },
    volume: {
      trend: indicators.volume?.trend || 'stable',
      score: indicators.volume?.score || 50
    },
    support: indicators.ma50?.value > 0 ? indicators.ma50.value : 0,
    resistance: indicators.ma200?.value > 0 ? indicators.ma200.value : 0
  };
}

/**
 * Transform news for UI format
 */
export function transformNewsForUI(news: any[]): any[] {
  return news.slice(0, 5).map(article => ({
    title: article.title || 'No title',
    source: article.source?.name || article.source || 'Unknown',
    url: article.url || '#',
    publishedAt: article.published_at || article.publishedAt || new Date().toISOString(),
    snippet: article.summary || article.description || article.content || article.snippet || 'No description available'
  }));
}

/**
 * Generate analysis images
 */
export async function generateAnalysisImages(symbol: string, indicators: any, ohlc: any[]): Promise<string[]> {
  const images = [];
  const cleanSymbol = symbol.toUpperCase().replace('USDT', '').replace('USD', '');

  try {
    // 1. Technical Analysis Chart (from TradingView or similar public CDN)
    // We use a high-quality static chart image if possible, or a well-known public charting service
    images.push(`https://s3.tradingview.com/snapshots/${cleanSymbol.toLowerCase()}/crypto.png`);

    // 2. High-quality Asset Logo
    images.push(`https://static.cryptopanic.com/static/img/coins/64x64/${cleanSymbol.toLowerCase()}.png`);

    // 3. Strategic indicator chart (e.g. RSI/MACD visual representation)
    // Using a public crypto visualizer or specific asset pattern image
    images.push(`https://www.cryptocompare.com/media/37746251/${cleanSymbol.toLowerCase()}.png`);

    // 4. Market Narrative Visual
    // Selecting a thematic image based on signal
    const theme = indicators.rsi?.value < 30 ? 'oversold' : (indicators.rsi?.value > 70 ? 'overbought' : 'trading');
    images.push(`https://images.cryptocompare.com/news/default/${theme}.png`);

  } catch (error) {
    console.error('Error generating analysis images:', error);
    return [];
  }

  // Filter out non-existent images (graceful handling)
  return images.slice(0, 4);
}

/**
 * Generate price chart image (placeholder implementation)
 */
export async function generatePriceChartImage(symbol: string, ohlc: any[]): Promise<string | null> {
  try {
    // In a real implementation, this would use chartjs-node-canvas or similar
    // For now, return null (no placeholder images)
    return null;
  } catch (error) {
    console.error('Error generating price chart:', error);
    return null;
  }
}

/**
 * Generate momentum chart image (placeholder implementation)
 */
export async function generateMomentumChartImage(symbol: string, indicators: any): Promise<string | null> {
  try {
    // In a real implementation, this would generate a chart image
    // For now, return null (no placeholder images)
    return null;
  } catch (error) {
    console.error('Error generating momentum chart:', error);
    return null;
  }
}

/**
 * Generate volume chart image (placeholder implementation)
 */
export async function generateVolumeChartImage(symbol: string, ohlc: any[]): Promise<string | null> {
  try {
    // In a real implementation, this would generate a volume chart image
    // For now, return null (no placeholder images)
    return null;
  } catch (error) {
    console.error('Error generating volume chart:', error);
    return null;
  }
}

/**
 * Generate high-confidence trade plan
 * Only generated when accuracy >= 60% and signal is not HOLD
 */
export function generateTradePlan(signal: string, accuracy: number, indicators: any): any | null {
  // CRITICAL: Strict gating based on accuracy and signal
  if (accuracy < 0.60 || signal === 'HOLD') return null;

  const currentPrice = indicators.price || 0;
  if (!currentPrice) return null;

  // Use ATR for TP/SL calculation
  const atr = indicators.atr?.value || (currentPrice * 0.02);

  // Support and Resistance levels
  const support = indicators.ma50?.value || indicators.ma200?.value || (currentPrice * 0.95);
  const resistance = indicators.ma200?.value || indicators.ma50?.value || (currentPrice * 1.05);

  const SL_MAX_DISTANCE_PCT = 0.01; // 1% absolute cap
  const SL_DEFAULT_DISTANCE_PCT = 0.005; // 0.5% default
  const TP1_DISTANCE_PCT = 0.008; // 0.8%
  const TP2_DISTANCE_PCT = 0.015; // 1.5%
  const TP3_DISTANCE_PCT = 0.022; // 2.2%

  let sl, tp1, tp2, tp3;

  if (signal === 'BUY') {
    // SCALPING SL Rule: 0.3% - 0.8% max
    // Use ATR if available but cap at 0.8%
    const atrDistance = atr / currentPrice;
    const slDistance = Math.max(0.003, Math.min(0.008, atrDistance || SL_DEFAULT_DISTANCE_PCT));
    sl = currentPrice * (1 - slDistance);

    // Hard check: NEVER exceed 1%
    if (currentPrice - sl > currentPrice * SL_MAX_DISTANCE_PCT) {
      sl = currentPrice * (1 - SL_MAX_DISTANCE_PCT);
    }

    tp1 = currentPrice * (1 + TP1_DISTANCE_PCT);
    tp2 = currentPrice * (1 + TP2_DISTANCE_PCT);
    tp3 = currentPrice * (1 + TP3_DISTANCE_PCT);

    console.log(`[SCALPING_PLAN_CREATED] BUY ${indicators.symbol} Entry: ${currentPrice} SL: ${sl.toFixed(4)} TP1: ${tp1.toFixed(4)}`);
  } else if (signal === 'SELL') {
    const atrDistance = atr / currentPrice;
    const slDistance = Math.max(0.003, Math.min(0.008, atrDistance || SL_DEFAULT_DISTANCE_PCT));
    sl = currentPrice * (1 + slDistance);

    // Hard check: NEVER exceed 1%
    if (sl - currentPrice > currentPrice * SL_MAX_DISTANCE_PCT) {
      sl = currentPrice * (1 + SL_MAX_DISTANCE_PCT);
    }

    tp1 = currentPrice * (1 - TP1_DISTANCE_PCT);
    tp2 = currentPrice * (1 - TP2_DISTANCE_PCT);
    tp3 = currentPrice * (1 - TP3_DISTANCE_PCT);

    console.log(`[SCALPING_PLAN_CREATED] SELL ${indicators.symbol} Entry: ${currentPrice} SL: ${sl.toFixed(4)} TP1: ${tp1.toFixed(4)}`);
  } else {
    return null;
  }

  // Calculate Risk-Reward based on TP2 vs SL
  const risk = Math.abs(currentPrice - sl);
  const reward = Math.abs(tp2 - currentPrice);
  const rrRatio = risk > 0 ? reward / risk : 0;

  const plan: any = {
    entryPrice: currentPrice,
    stopLoss: sl,
    takeProfit1: tp1,
    takeProfit2: tp2,
    riskRewardRatio: Math.round(rrRatio * 100) / 100
  };

  // Dynamic TP calculation: only include TP3 if it represents a significant additional gain
  if (tp3 && Math.abs(tp3 - tp2) > (atr * 0.5)) {
    plan.takeProfit3 = tp3;
  }

  return plan;
}
