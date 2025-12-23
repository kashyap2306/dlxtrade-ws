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
  const images: string[] = [];
  const cleanSymbol = symbol.toUpperCase().replace('USDT', '').replace('USD', '').replace('BTC', 'bitcoin').replace('ETH', 'ethereum');

  try {
    // 1. CoinGecko coin image (most reliable source)
    // Format: https://assets.coingecko.com/coins/images/{id}/large/{symbol}.png
    // For major coins, use known CoinGecko IDs
    const coinGeckoMap: { [key: string]: string } = {
      'BTC': '1',
      'ETH': '279',
      'BNB': '825',
      'SOL': '4128',
      'XRP': '52',
      'ADA': '2010',
      'DOGE': '5',
      'DOT': '6636',
      'MATIC': '4713',
      'AVAX': '12559',
      'LINK': '197',
      'UNI': '12504',
      'ATOM': '3794',
      'LTC': '2',
      'BCH': '1831'
    };
    
    const coinId = coinGeckoMap[cleanSymbol] || cleanSymbol.toLowerCase();
    if (coinId) {
      images.push(`https://assets.coingecko.com/coins/images/${coinId}/large/${cleanSymbol.toLowerCase()}.png`);
    }

    // 2. GitHub cryptocurrency-icons (reliable fallback)
    const symbolUpper = cleanSymbol.toUpperCase();
    images.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbolUpper}.png`);

    // 3. CoinGecko small image variant
    if (coinId) {
      images.push(`https://assets.coingecko.com/coins/images/${coinId}/small/${cleanSymbol.toLowerCase()}.png`);
    }

    // 4. Additional GitHub icon variant (thumb)
    images.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/64/color/${symbolUpper}.png`);

    // 5. CoinGecko thumb image if available
    if (coinId) {
      images.push(`https://assets.coingecko.com/coins/images/${coinId}/thumb/${cleanSymbol.toLowerCase()}.png`);
    }

  } catch (error) {
    console.error('Error generating analysis images:', error);
    // Fallback to GitHub icons
    const symbolUpper = cleanSymbol.toUpperCase();
    return [
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${symbolUpper}.png`,
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/64/color/${symbolUpper}.png`,
      `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${symbolUpper}.png`
    ];
  }

  // Filter out duplicates and return 2-3 images
  const uniqueImages = Array.from(new Set(images.filter(img => img && img.length > 0)));
  return uniqueImages.slice(0, 3);
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
 * Calculate dynamic price precision based on price value
 * Preserves full calculation precision internally, only used for display
 * @param price - The price value
 * @returns Number of decimal places for display
 */
function getPricePrecision(price: number): number {
  if (price >= 1000) return 2;  // Large coins: 2 decimals (e.g., BTC)
  if (price >= 100) return 3;   // Medium coins: 3 decimals
  if (price >= 10) return 4;    // Small-medium coins: 4 decimals
  if (price >= 1) return 5;      // Small coins: 5 decimals
  if (price >= 0.01) return 6;   // Very small coins: 6 decimals
  return 8;                      // Micro coins: 8 decimals
}

/**
 * Generate professional structure-based trade plan with risk-reward logic
 * CRITICAL: No fixed percentages - all based on structure, invalidation, and risk-reward
 * Only generated when accuracy >= 60% and signal is not HOLD
 * Prices are stored with FULL precision - no rounding in calculation
 */
export function generateTradePlan(signal: string, accuracy: number, indicators: any): any | null {
  // CRITICAL: Strict gating based on accuracy and signal
  if (accuracy < 0.60 || signal === 'HOLD') return null;

  const currentPrice = indicators.price || 0;
  if (!currentPrice || currentPrice <= 0) return null;

  // Get ATR for validation and SL distance
  const atr = indicators.atr?.value || 0;
  const atrPct = atr > 0 ? (atr / currentPrice) : 0;

  // Get support/resistance levels
  const majorSupport = indicators.supportResistance?.majorSupport || indicators.ma200?.value || indicators.ma50?.value || null;
  const majorResistance = indicators.supportResistance?.majorResistance || null;
  const minorSupport = indicators.supportResistance?.minorSupport || indicators.ma50?.value || null;
  const minorResistance = indicators.supportResistance?.minorResistance || null;

  // Get recent price data for structure analysis (if available)
  // Extract from ohlc data if available, otherwise use fallbacks
  const ohlc = indicators.ohlc || indicators.marketData?.ohlc || [];
  const recentLows: number[] = [];
  const recentHighs: number[] = [];
  
  // Extract recent lows and highs from OHLC data if available
  if (Array.isArray(ohlc) && ohlc.length > 0) {
    const recentCandles = ohlc.slice(-10); // Last 10 candles
    recentCandles.forEach((candle: any) => {
      if (candle?.low) recentLows.push(candle.low);
      if (candle?.high) recentHighs.push(candle.high);
    });
  }

  // ============================================
  // 1. ENTRY LOGIC (STRUCTURE FIRST)
  // ============================================
  let entryValid = false;
  let entryReason = '';

  if (signal === 'BUY') {
    // Check for support bounce
    if (majorSupport && currentPrice > majorSupport * 0.995 && currentPrice < majorSupport * 1.01) {
      entryValid = true;
      entryReason = 'Support bounce';
    }
    // Check for trendline support (using MA50 as proxy)
    else if (minorSupport && currentPrice > minorSupport * 0.998 && currentPrice < minorSupport * 1.005) {
      entryValid = true;
      entryReason = 'Trendline support bounce';
    }
    // Check for higher low confirmation
    else if (recentLows.length >= 2) {
      const lastLow = recentLows[recentLows.length - 1];
      const prevLow = recentLows[recentLows.length - 2];
      if (lastLow > prevLow && currentPrice > lastLow * 1.002) {
        entryValid = true;
        entryReason = 'Higher low confirmation';
      }
    }
    // Check for resistance breakout with strong close
    else if (majorResistance && currentPrice > majorResistance * 1.002) {
      // Check if there was a retest (price came back to resistance and bounced)
      const resistanceZone = majorResistance * 0.998;
      if (ohlc.length >= 2) {
        const prevCandle = ohlc[ohlc.length - 2];
        const prevClose = prevCandle?.close || prevCandle?.price || currentPrice;
        if (prevClose <= resistanceZone && currentPrice > majorResistance) {
          entryValid = true;
          entryReason = 'Resistance breakout with retest';
        }
      } else {
        // If no OHLC data, accept breakout if price is clearly above resistance
        entryValid = true;
        entryReason = 'Resistance breakout';
      }
    }

    // REJECT entry if price is below resistance (not a valid BUY setup)
    if (majorResistance && currentPrice < majorResistance * 0.98) {
      entryValid = false;
      entryReason = 'Price below resistance - invalid BUY setup';
    }
    // REJECT if price is in range middle (no clear structure)
    if (majorSupport && majorResistance) {
      const rangeMiddle = (majorSupport + majorResistance) / 2;
      if (Math.abs(currentPrice - rangeMiddle) < (majorResistance - majorSupport) * 0.1) {
        entryValid = false;
        entryReason = 'Price in range middle - no clear structure';
      }
    }
  } else if (signal === 'SELL') {
    // For SELL, check for resistance rejection or breakdown
    if (majorResistance && currentPrice < majorResistance * 1.005 && currentPrice > majorResistance * 0.995) {
      entryValid = true;
      entryReason = 'Resistance rejection';
    }
    // Check for lower high confirmation
    else if (recentHighs.length >= 2) {
      const lastHigh = recentHighs[recentHighs.length - 1];
      const prevHigh = recentHighs[recentHighs.length - 2];
      if (lastHigh < prevHigh && currentPrice < lastHigh * 0.998) {
        entryValid = true;
        entryReason = 'Lower high confirmation';
      }
    }
    // Check for support breakdown
    else if (majorSupport && currentPrice < majorSupport * 0.998) {
      entryValid = true;
      entryReason = 'Support breakdown';
    }

    // REJECT if price is above support (not a valid SELL setup)
    if (majorSupport && currentPrice > majorSupport * 1.02) {
      entryValid = false;
      entryReason = 'Price above support - invalid SELL setup';
    }
  }

  // If entry validation fails, reject trade
  if (!entryValid) {
    console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - ${entryReason || 'Invalid entry structure'}`);
    return null;
  }

  // ============================================
  // 2. TRADE REJECTION RULES
  // ============================================
  
  // Reject if ATR below threshold (low volatility = sideways/choppy)
  const MIN_ATR_PCT = 0.003; // 0.3% minimum ATR
  if (atrPct < MIN_ATR_PCT) {
    console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - ATR too low (${(atrPct * 100).toFixed(3)}%), sideways/choppy market`);
    return null;
  }

  // Reject if low liquidity (check volume if available)
  const volume = indicators.volume?.value || 0;
  const avgVolume = indicators.volume?.average || volume;
  if (volume > 0 && avgVolume > 0 && volume < avgVolume * 0.5) {
    console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Low liquidity (volume ${(volume / avgVolume * 100).toFixed(1)}% of average)`);
    return null;
  }

  // Check for fake breakout (if price broke resistance but immediately reversed)
  if (signal === 'BUY' && majorResistance && ohlc.length >= 3) {
    const candle2 = ohlc[ohlc.length - 2];
    const candle3 = ohlc[ohlc.length - 1];
    const candle2High = candle2?.high || candle2?.price || currentPrice;
    const candle3Close = candle3?.close || candle3?.price || currentPrice;
    if (candle2High > majorResistance && candle3Close < majorResistance * 0.998) {
      console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Fake breakout detected`);
      return null;
    }
  }

  // ============================================
  // 3. STOP LOSS (SL) — INVALIDATION BASED
  // ============================================
  let stopLoss: number | null = null;

  if (signal === 'BUY') {
    // SL must be below last higher low or below support
    if (recentLows.length >= 1) {
      const lastHigherLow = Math.max(...recentLows.slice(-3)); // Last 3 lows, take highest
      stopLoss = lastHigherLow * 0.998; // Slightly below higher low
    } else if (majorSupport) {
      stopLoss = majorSupport * 0.995; // Below support
    } else if (minorSupport) {
      stopLoss = minorSupport * 0.997; // Below minor support
    }

    // If no structure-based SL, use ATR-based minimum
    if (!stopLoss) {
      stopLoss = currentPrice - (atr * 1.5);
    }

    // CRITICAL: SL distance must be >= ATR × 0.8
    const slDistance = currentPrice - stopLoss;
    const minSlDistance = atr * 0.8;
    if (slDistance < minSlDistance) {
      stopLoss = currentPrice - minSlDistance;
    }

    // If SL too tight (less than ATR × 0.8), reject trade
    const finalSlDistance = currentPrice - stopLoss;
    if (finalSlDistance < minSlDistance) {
      console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - SL too tight (${(finalSlDistance / currentPrice * 100).toFixed(3)}% < ATR×0.8)`);
      return null;
    }
  } else if (signal === 'SELL') {
    // SL must be above last lower high or above resistance
    if (recentHighs.length >= 1) {
      const lastLowerHigh = Math.min(...recentHighs.slice(-3)); // Last 3 highs, take lowest
      stopLoss = lastLowerHigh * 1.002; // Slightly above lower high
    } else if (majorResistance) {
      stopLoss = majorResistance * 1.005; // Above resistance
    } else if (minorResistance) {
      stopLoss = minorResistance * 1.003; // Above minor resistance
    }

    // If no structure-based SL, use ATR-based minimum
    if (!stopLoss) {
      stopLoss = currentPrice + (atr * 1.5);
    }

    // CRITICAL: SL distance must be >= ATR × 0.8
    const slDistance = stopLoss - currentPrice;
    const minSlDistance = atr * 0.8;
    if (slDistance < minSlDistance) {
      stopLoss = currentPrice + minSlDistance;
    }

    // If SL too tight, reject trade
    const finalSlDistance = stopLoss - currentPrice;
    if (finalSlDistance < minSlDistance) {
      console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - SL too tight (${(finalSlDistance / currentPrice * 100).toFixed(3)}% < ATR×0.8)`);
      return null;
    }
  }

  if (!stopLoss || stopLoss <= 0) {
    console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Could not determine valid SL`);
    return null;
  }

  // ============================================
  // 4. TAKE PROFIT (TP) — RISK-REWARD FIRST
  // ============================================
  const risk = Math.abs(currentPrice - stopLoss);
  const MIN_RR = 2.5; // Minimum Risk-Reward 1:2.5
  const PREFERRED_RR = 3.0; // Preferred Risk-Reward 1:3

  let takeProfit: number;
  let riskRewardRatio: number;

  if (signal === 'BUY') {
    // Start with preferred RR
    takeProfit = currentPrice + (risk * PREFERRED_RR);
    riskRewardRatio = PREFERRED_RR;

    // If preferred TP is too far, use minimum RR
    if (majorResistance && takeProfit > majorResistance * 0.99) {
      // TP would be inside resistance zone, use minimum RR instead
      takeProfit = currentPrice + (risk * MIN_RR);
      riskRewardRatio = MIN_RR;
    }
  } else {
    // SELL
    takeProfit = currentPrice - (risk * PREFERRED_RR);
    riskRewardRatio = PREFERRED_RR;

    // If preferred TP is too far, use minimum RR
    if (majorSupport && takeProfit < majorSupport * 1.01) {
      // TP would be inside support zone, use minimum RR instead
      takeProfit = currentPrice - (risk * MIN_RR);
      riskRewardRatio = MIN_RR;
    }
  }

  // ============================================
  // 5. RESISTANCE VALIDATION
  // ============================================
  if (signal === 'BUY') {
    // Find nearest resistance
    const nearestResistance = majorResistance || minorResistance;
    if (nearestResistance) {
      // If resistance < TP, reject trade
      if (nearestResistance < takeProfit) {
        console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Resistance (${nearestResistance.toFixed(4)}) < TP (${takeProfit.toFixed(4)})`);
        return null;
      }

      // If TP lies inside resistance zone (within 1%), reject trade
      const resistanceZone = nearestResistance * 0.99;
      if (takeProfit >= resistanceZone && takeProfit <= nearestResistance) {
        console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - TP (${takeProfit.toFixed(4)}) inside resistance zone`);
        return null;
      }
    }
  } else if (signal === 'SELL') {
    // Find nearest support
    const nearestSupport = majorSupport || minorSupport;
    if (nearestSupport) {
      // If support > TP, reject trade
      if (nearestSupport > takeProfit) {
        console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Support (${nearestSupport.toFixed(4)}) > TP (${takeProfit.toFixed(4)})`);
        return null;
      }

      // If TP lies inside support zone (within 1%), reject trade
      const supportZone = nearestSupport * 1.01;
      if (takeProfit <= supportZone && takeProfit >= nearestSupport) {
        console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - TP (${takeProfit.toFixed(4)}) inside support zone`);
        return null;
      }
    }
  }

  // Final validation: Ensure minimum RR is met
  const actualRR = Math.abs(takeProfit - currentPrice) / risk;
  if (actualRR < MIN_RR) {
    console.log(`[TRADE_PLAN_REJECTED] ${signal} ${indicators.symbol} - Actual RR (${actualRR.toFixed(2)}) < minimum (${MIN_RR})`);
    return null;
  }

  // ============================================
  // 6. BUILD TRADE PLAN
  // ============================================
  const displayPrecision = getPricePrecision(currentPrice);
  console.log(`[PROFESSIONAL_PLAN_CREATED] ${signal} ${indicators.symbol} Entry: ${currentPrice.toFixed(displayPrecision)} SL: ${stopLoss.toFixed(displayPrecision)} TP: ${takeProfit.toFixed(displayPrecision)} RR: ${actualRR.toFixed(2)} Reason: ${entryReason}`);

  const plan: any = {
    entryPrice: currentPrice,
    stopLoss: stopLoss,
    takeProfit: takeProfit,
    takeProfit1: takeProfit, // Single TP for professional trades
    riskRewardRatio: Math.round(actualRR * 100) / 100
  };

  return plan;
}
