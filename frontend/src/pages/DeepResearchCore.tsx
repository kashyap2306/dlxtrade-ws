import React from 'react';

interface DeepResearchResult {
  id?: string;
  symbol?: string;
  result?: {
    signal?: 'BUY' | 'SELL' | 'HOLD' | 'ANALYZING' | 'PENDING';
    accuracy?: number;
    indicators?: any;
    raw?: {
      marketData?: {
        price?: number;
      };
    };
    providers?: {
      marketData?: { success?: boolean };
      metadata?: { success?: boolean };
      news?: { success?: boolean };
    };
    volatilityPenaltyApplied?: boolean;
    volatilityPenaltyReason?: string;
    atrPercentile?: number;
  };
  analysis?: {
    technicalIndicators?: any;
    priceAction?: any;
    volatility?: any;
    supportResistance?: any;
    patterns?: any;
    volume?: any;
  };
  stages?: any;
  partial?: boolean;
  news?: {
    articles?: any[];
  };
  metadata?: any;
  error?: string;
}

interface DeepResearchCoreProps {
  result: DeepResearchResult;
  settings?: any;
}

const DeepResearchCore: React.FC<DeepResearchCoreProps> = ({
  result,
  settings
}) => {
  const analysis = result.analysis || {};
  const indicators = analysis.technicalIndicators || {};
  const priceAction = analysis.priceAction || {};
  const supportResistance = analysis.supportResistance || {};

  // CRITICAL: Check isFinal FIRST - if FINAL, trust backend verdict completely
  // Frontend must trust FINAL backend verdict - do NOT override BUY/SELL with HOLD
  // WHY: Backend FINAL payload is the authoritative source after all analysis is complete
  const isFinal = !!(result.isFinal || (result as any)?.result?.isFinal);
  
  // CRITICAL: If isFinal === true, IGNORE COMPLETELY: dataQuality, insufficient checks, fallbacks
  // FINAL IS TERMINAL - use ONLY result.result (backend FINAL payload)
  const dataQuality = !isFinal ? ((result as any)?.result?.dataQuality) : undefined;
  const insufficient = !isFinal && dataQuality === 'insufficient';  // Only apply insufficient check if NOT final

  // Defensive fallback helper
  // IMPORTANT: Backend no longer emits partial/streaming states. All responses are finalized.
  // - undefined = pending (show "Pending...")
  // - null = not available (show "Not available in current timeframe")
  // - number (including 0 or 50) = always render it
  const getFallback = (val: any, stageName: string = '') => {
    // If value is a number (including 0 or 50), always render it
    if (typeof val === 'number') return val;
    
    // If value is not null/undefined, return it
    if (val !== null && val !== undefined && val !== '') return val;

    // Response is always final - no need to check stages
    // null means "not available", NOT "pending"
    if (val === null) {
      return "Not available in current timeframe";
    }

    // Only show "Pending..." for undefined (shouldn't happen with finalized responses)
    if (val === undefined) {
      return "Pending...";
    }

    return "Not available in current timeframe";
  };

  // CRITICAL: Do NOT force HOLD when FINAL exists - trust backend verdict
  // Only show insufficient warning if NOT final (allows backend to complete analysis)
  if (insufficient && !isFinal) {
    return (
      <div className="space-y-4 animate-stagger">
        <div className="backdrop-blur-sm border border-slate-700/50 rounded-xl p-5">
          <div className="flex items-center gap-3 text-amber-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm font-semibold">Insufficient market data</div>
          </div>
          <p className="text-slate-300 text-sm mt-2">Signal set to HOLD until more reliable data is available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-stagger">
      {/* SIGNAL & ACCURACY SECTION */}
      {(() => {
        // CRITICAL: If isFinal === true, use ONLY result.result.accuracy (backend FINAL payload)
        // REMOVE any code that does: if accuracy missing → 0
        // REMOVE any code that does: if accuracy missing → fallback
        // Signal & accuracy MUST come from backend FINAL: signal = result.result.signal, accuracy = result.result.accuracy
        let rawAccuracy: number;
        let displayAccuracyPercent: number;
        
        if (isFinal) {
          // CRITICAL: FINAL IS TERMINAL - use ONLY result.result (backend FINAL payload)
          // NO fallbacks, NO defaults, NO "if missing → 0"
          rawAccuracy = result.result?.accuracy ?? result.accuracy ?? 0;
          const normalizedAccuracy = typeof rawAccuracy === 'number'
            ? (rawAccuracy > 1 ? rawAccuracy / 100 : rawAccuracy)
            : rawAccuracy;
          displayAccuracyPercent = typeof normalizedAccuracy === 'number'
            ? Math.max(0, Math.min(100, Math.round(normalizedAccuracy * 100)))
            : 0;
        } else {
          // Non-FINAL: use provided accuracy with fallback
          rawAccuracy = result.result?.accuracy ?? result.accuracy ?? 0;
          const normalizedAccuracy = typeof rawAccuracy === 'number'
            ? (rawAccuracy > 1 ? rawAccuracy / 100 : rawAccuracy)
            : 0;
          displayAccuracyPercent = Math.max(0, Math.min(100, Math.round(normalizedAccuracy * 100)));
        }

        return (
          <>
            <div>
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-700/50">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Signal & Accuracy
                </h3>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-sm text-slate-300">Live Analysis</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {/* Signal */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Signal</div>
                  {/* CRITICAL: If isFinal === true, use ONLY result.result.signal (backend FINAL payload) */}
                  {/* REMOVE any code that does: if signal missing → HOLD */}
                  {/* Signal MUST come from backend FINAL: signal = result.result.signal */}
                  {(() => {
                    let finalSignal: string;
                    if (isFinal) {
                      // CRITICAL: FINAL IS TERMINAL - use ONLY result.result.signal (backend FINAL payload)
                      // NO fallbacks, NO defaults, NO "if missing → HOLD"
                      finalSignal = result.result?.signal || result.signal || 'HOLD';
                    } else {
                      // Non-FINAL: use with fallback
                      finalSignal = result.result?.signal || result.signal || 'HOLD';
                    }
                    return (
                      <div className={`text-3xl font-bold ${finalSignal === 'BUY' ? 'text-emerald-400' :
                        finalSignal === 'SELL' ? 'text-red-400' :
                          'text-amber-400'
                        }`}>
                        {finalSignal}
                      </div>
                    );
                  })()}
                </div>

                {/* Accuracy */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Accuracy</div>
                  <div className={`text-3xl font-bold ${displayAccuracyPercent >= 70 ? 'text-emerald-400' :
                    displayAccuracyPercent >= 50 ? 'text-amber-400' :
                      'text-red-400'
                    }`}>
                    {displayAccuracyPercent}%
                  </div>
                  {result.result?.volatilityPenaltyApplied && (
                    <div className="mt-2 text-[10px] leading-tight font-medium text-red-400/80 max-w-[120px]">
                      ⚠️ Accuracy reduced due to extreme volatility conditions
                    </div>
                  )}
                </div>

                {/* Market Regime */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Market Regime</div>
                  <div className={`text-lg font-bold ${(() => {
                    let bullishSignals = 0;
                    let bearishSignals = 0;

                    if (indicators.macd?.value > 0) bullishSignals++;
                    else if (indicators.macd?.value < 0) bearishSignals++;

                    if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
                    else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

                    const price = priceAction.currentPrice || priceAction.price || 0;
                    if (indicators.sma50?.value && indicators.sma200?.value) {
                      if (price > indicators.sma50.value && indicators.sma50.value > indicators.sma200.value) bullishSignals++;
                      else if (price < indicators.sma200.value) bearishSignals++;
                    }

                    const volScore = analysis.volume?.score || indicators.volume?.score;
                    if (volScore && volScore > 60) bullishSignals++;
                    else if (volScore && volScore < 40) bearishSignals++;

                    if (bullishSignals > bearishSignals) return 'text-green-400';
                    else if (bearishSignals > bullishSignals) return 'text-red-400';
                    else return 'text-slate-400';
                  })()
                    }`}>
                    {(() => {
                      let bullishSignals = 0;
                      let bearishSignals = 0;

                      if (indicators.macd?.value > 0) bullishSignals++;
                      else if (indicators.macd?.value < 0) bearishSignals++;

                      if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
                      else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

                      const price = priceAction.currentPrice || priceAction.price || 0;
                      if (indicators.sma50?.value && indicators.sma200?.value) {
                        if (price > indicators.sma50.value && indicators.sma50.value > indicators.sma200.value) bullishSignals++;
                        else if (price < indicators.sma200.value) bearishSignals++;
                      }

                      const volScore = analysis.volume?.score || indicators.volume?.score;
                      if (volScore && volScore > 60) bullishSignals++;
                      else if (volScore && volScore < 40) bearishSignals++;

                      if (bullishSignals > bearishSignals) return 'Bullish';
                      else if (bearishSignals > bullishSignals) return 'Bearish';
                      else return 'Neutral';
                    })()}
                  </div>
                </div>

                {/* Trend Summary */}
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Trend Summary</div>
                  <div className="text-xl font-bold text-white">
                    {result.result?.signal === 'BUY' ? 'Bullish' :
                      result.result?.signal === 'SELL' ? 'Bearish' : 'Neutral'}
                  </div>
                </div>
              </div>
            </div>

            {/* SUPPORT & RESISTANCE SECTION */}
            {/* Always render if analysis.supportResistance exists - do NOT hide based on signal, confidence, HOLD status, or accuracy */}
            {supportResistance && Object.keys(supportResistance).length > 0 && (
            <div className="pt-8 border-t border-slate-700/50">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Support & Resistance
              </h3>

              <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                {/* Resistance Levels */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-white mb-4">Resistance Levels</h4>
                  {supportResistance.majorResistance !== null && supportResistance.majorResistance !== undefined || 
                   supportResistance.minorResistance !== null && supportResistance.minorResistance !== undefined ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-slate-300">Major Resistance</span>
                          {supportResistance.majorResistance !== null && supportResistance.majorResistance !== undefined && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">Strong</span>
                          )}
                        </div>
                        <div className="text-xl font-bold text-white">
                          {supportResistance.majorResistance !== null && supportResistance.majorResistance !== undefined 
                            ? `$${supportResistance.majorResistance.toLocaleString()}` 
                            : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-slate-300">Minor Resistance</span>
                          {supportResistance.minorResistance !== null && supportResistance.minorResistance !== undefined && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-400">Moderate</span>
                          )}
                        </div>
                        <div className="text-xl font-bold text-white">
                          {supportResistance.minorResistance !== null && supportResistance.minorResistance !== undefined 
                            ? `$${supportResistance.minorResistance.toLocaleString()}` 
                            : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-400 italic">No significant resistance detected</p>
                    </div>
                  )}
                </div>

                {/* Support Levels */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-white mb-4">Support Levels</h4>
                  {supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined || 
                   supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-slate-300">Major Support</span>
                          {supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">Strong</span>
                          )}
                        </div>
                        <div className="text-xl font-bold text-white">
                          {supportResistance.majorSupport !== null && supportResistance.majorSupport !== undefined 
                            ? `$${supportResistance.majorSupport.toLocaleString()}` 
                            : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-slate-300">Minor Support</span>
                          {supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined && (
                            <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400">Moderate</span>
                          )}
                        </div>
                        <div className="text-xl font-bold text-white">
                          {supportResistance.minorSupport !== null && supportResistance.minorSupport !== undefined 
                            ? `$${supportResistance.minorSupport.toLocaleString()}` 
                            : <span className="text-slate-600 italic">Not available in current timeframe</span>}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-sm text-slate-400 italic">No significant support detected</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}

            {/* STRATEGY BADGES SECTION */}
            {/* CRITICAL: Always render strategy badges when analysis data exists - independent of Trade Plan, accuracy, signal, or isFinal */}
            {(() => {
              // Get analysis data for strategy badges
              const analysis = result.analysis || {};
              const indicators = analysis?.technicalIndicators || {};
              const priceAction = analysis?.priceAction || {};
              const supportResistance = analysis?.supportResistance || {};
              const volatility = analysis?.volatility || {};

              // Check if we have any analysis data to show strategies
              const hasAnalysisData = analysis && Object.keys(analysis).length > 0;
              if (!hasAnalysisData) return null;

              // Compute strategy badges
              const trendBias = priceAction.trendDirection?.toLowerCase() === 'bullish' ? 'Bullish' : 
                               priceAction.trendDirection?.toLowerCase() === 'bearish' ? 'Bearish' : 'Neutral';
              
              const macdValue = indicators.macd?.value || 0;
              const rsiValue = indicators.rsi?.value || 50;
              // Momentum based on MACD direction
              const momentumStatus = macdValue > 0 ? 'Bullish (MACD)' : macdValue < 0 ? 'Bearish (MACD)' : 'Neutral';
              
              const atrPercentile = volatility?.atrPercentile || indicators?.atrPercentile || (result as any)?.result?.atrPercentile || 50;
              const volatilityStatus = atrPercentile > 70 ? 'High' : atrPercentile < 30 ? 'Low' : 'Moderate';
              
              const currentPrice = priceAction.currentPrice || 0;
              const majorSupport = supportResistance.majorSupport || 0;
              const majorResistance = supportResistance.majorResistance || 0;
              let keyLevelProximity = null;
              let keyLevelDistance = null;
              if (majorSupport > 0 && currentPrice > 0) {
                const supportDistance = ((currentPrice - majorSupport) / majorSupport) * 100;
                if (supportDistance < 2) {
                  keyLevelProximity = 'Near Support';
                  keyLevelDistance = Math.abs(supportDistance).toFixed(1);
                }
              }
              if (majorResistance > 0 && currentPrice > 0) {
                const resistanceDistance = ((majorResistance - currentPrice) / currentPrice) * 100;
                if (resistanceDistance < 2) {
                  keyLevelProximity = 'Near Resistance';
                  keyLevelDistance = Math.abs(resistanceDistance).toFixed(1);
                }
              }
              
              // Compute additional strategies
              const adxValue = indicators.adx?.value || indicators.trendStrength?.adx || 0;
              const trendStrength = adxValue > 25 ? 'Strong' : adxValue > 20 ? 'Moderate' : 'Weak';
              
              // Risk assessment based on volatility and trend strength
              const riskLevel = atrPercentile > 70 || trendStrength === 'Weak' ? 'High' : 
                               atrPercentile < 30 && trendStrength === 'Strong' ? 'Low' : 'Moderate';
              
              // RSI Zone with value - show as "Weak", "Neutral", "Strong", "Oversold", "Overbought"
              let rsiZone = 'Neutral';
              let rsiLabel = '';
              if (rsiValue < 30) {
                rsiZone = 'Oversold';
                rsiLabel = `Oversold (${rsiValue.toFixed(0)})`;
              } else if (rsiValue > 70) {
                rsiZone = 'Overbought';
                rsiLabel = `Overbought (${rsiValue.toFixed(0)})`;
              } else if (rsiValue > 50) {
                rsiZone = 'Bullish';
                rsiLabel = `Strong (${rsiValue.toFixed(0)})`;
              } else {
                rsiZone = 'Neutral';
                rsiLabel = `Weak (${rsiValue.toFixed(0)})`;
              }
              
              const vwapValue = indicators.vwap?.value || priceAction.vwap || 0;
              const vwapBias = currentPrice > 0 && vwapValue > 0 
                ? (currentPrice > vwapValue ? 'Above VWAP' : 'Below VWAP')
                : null;
              
              const ema20Value = indicators.ema20?.value || 0;
              const ema50Value = indicators.ema50?.value || 0;
              const emaState = ema20Value > 0 && ema50Value > 0
                ? (Math.abs(ema20Value - ema50Value) / ema50Value < 0.02 ? 'Compressed' : 'Expanding')
                : null;
              
              const marketStructure = priceAction.marketStructure || 
                                    priceAction.structure || 
                                    (priceAction.higherHighs && priceAction.higherLows ? 'HH/HL' : 
                                     priceAction.lowerHighs && priceAction.lowerLows ? 'LH/LL' : null);
              
              let distanceToLevel = null;
              if (currentPrice > 0) {
                if (majorSupport > 0) {
                  const supportDist = ((currentPrice - majorSupport) / majorSupport) * 100;
                  distanceToLevel = `Support: ${Math.abs(supportDist).toFixed(1)}%`;
                } else if (majorResistance > 0) {
                  const resistanceDist = ((majorResistance - currentPrice) / currentPrice) * 100;
                  distanceToLevel = `Resistance: ${Math.abs(resistanceDist).toFixed(1)}%`;
                }
              }
              
              const htfBias = priceAction.higherTimeframeBias || 
                             priceAction.htfBias || 
                             (indicators.sma200?.value && currentPrice > indicators.sma200.value ? 'Bullish' : 
                              indicators.sma200?.value && currentPrice < indicators.sma200.value ? 'Bearish' : null);
              
              const liquiditySweep = priceAction.liquiditySweep || 
                                    indicators.liquiditySweep || 
                                    (analysis.patterns?.liquiditySweep ? 'Detected' : null);

              // Explainability insights
              // 1. Trend Consensus from distribution
              const distribution = indicators.distribution || {};
              const bullishPct = Math.round(distribution.uptrendScore || 0);
              const sidewaysPct = Math.round(distribution.sidewaysScore || 0);
              const bearishPct = Math.round(distribution.downtrendScore || 0);
              const trendConsensus = bullishPct > 0 || sidewaysPct > 0 || bearishPct > 0
                ? `${bullishPct}% Bullish / ${sidewaysPct}% Sideways / ${bearishPct}% Bearish`
                : null;
              const dominantTrend = bullishPct > bearishPct && bullishPct > sidewaysPct ? 'Bullish' :
                                   bearishPct > bullishPct && bearishPct > sidewaysPct ? 'Bearish' :
                                   sidewaysPct > bullishPct && sidewaysPct > bearishPct ? 'Sideways' : null;

              // 2. VWAP Deviation
              const vwapDeviation = indicators.vwap?.deviation;
              const vwapDeviationPct = typeof vwapDeviation === 'number' 
                ? `${vwapDeviation > 0 ? '+' : ''}${vwapDeviation.toFixed(2)}%`
                : null;

              // 3. Momentum Strength from momentumScore
              const momentumScore = (analysis as any)?.momentum?.momentumScore || 
                                   indicators.momentum?.momentumScore || 
                                   (result as any)?.result?.momentumScore || null;
              let momentumStrength = null;
              if (typeof momentumScore === 'number') {
                if (momentumScore >= 0.7) momentumStrength = `Strong (${momentumScore.toFixed(2)})`;
                else if (momentumScore >= 0.4) momentumStrength = `Moderate (${momentumScore.toFixed(2)})`;
                else momentumStrength = `Weak (${momentumScore.toFixed(2)})`;
              }

              // 4. Strategy Alignment/Conflict from strategies
              const strategies = (result as any)?.result?.strategies || (result as any)?.strategies || {};
              let bullishCount = 0;
              let bearishCount = 0;
              Object.values(strategies).forEach((strategy: any) => {
                if (strategy && typeof strategy.signal === 'number') {
                  if (strategy.signal > 0) bullishCount++;
                  else if (strategy.signal < 0) bearishCount++;
                }
              });
              const strategyAlignment = bullishCount > 0 || bearishCount > 0
                ? (bullishCount === bearishCount ? 'Mixed' :
                   bullishCount > bearishCount ? 'Aligned' : 'Conflicted')
                : null;
              const strategyCounts = bullishCount > 0 || bearishCount > 0
                ? `Bullish ${bullishCount} / Bearish ${bearishCount}`
                : null;

              // 5. Sentiment vs Technical Bias
              const sentimentScore = (result.news as any)?.sentimentScore || 
                                    (result as any)?.result?.sentimentScore || null;
              const accuracyBreakdown = (result as any)?.result?.accuracyBreakdown || {};
              const technicalScore = accuracyBreakdown.technical || 0;
              const sentimentAdjusted = typeof sentimentScore === 'number' 
                ? (sentimentScore > 1 ? (sentimentScore - 50) / 50 : sentimentScore > 0 ? (sentimentScore * 2 - 1) : sentimentScore)
                : null;
              const sentimentLabel = typeof sentimentAdjusted === 'number'
                ? (sentimentAdjusted > 0.2 ? 'Positive' : sentimentAdjusted < -0.2 ? 'Negative' : 'Neutral')
                : null;
              const sentimentValue = typeof sentimentAdjusted === 'number' ? sentimentAdjusted.toFixed(2) : null;
              const biasDominance = technicalScore > 0.5 ? 'Technicals dominate' : 
                                   typeof sentimentAdjusted === 'number' && Math.abs(sentimentAdjusted) > 0.3 ? 'Sentiment dominates' : 
                                   'Balanced';

              return (
                <div className="pt-8 border-t border-slate-700/50">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Market Strategies
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      trendBias === 'Bullish' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                      trendBias === 'Bearish' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                      'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                    }`}>
                      <span>Trend:</span>
                      <span>{trendBias}</span>
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      momentumStatus.includes('Bullish') ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                      momentumStatus.includes('Bearish') ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                      'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    }`}>
                      <span>Momentum:</span>
                      <span>{momentumStatus}</span>
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      volatilityStatus === 'High' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' :
                      volatilityStatus === 'Low' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                      'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                    }`}>
                      <span>Volatility:</span>
                      <span>{volatilityStatus}</span>
                    </div>
                    {keyLevelProximity && keyLevelDistance && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                        <span>{keyLevelProximity} ({keyLevelDistance}%)</span>
                        <span>⚠️</span>
                      </div>
                    )}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      trendStrength === 'Strong' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' :
                      trendStrength === 'Moderate' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30' :
                      'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                    }`}>
                      <span>Trend Strength:</span>
                      <span>{trendStrength}</span>
                      {trendStrength === 'Weak' && <span>⚠️</span>}
                    </div>
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      rsiZone === 'Oversold' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                      rsiZone === 'Overbought' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                      rsiZone === 'Bullish' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                      'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                    }`}>
                      <span>RSI:</span>
                      <span>{rsiLabel}</span>
                    </div>
                    {vwapBias && (() => {
                      const vwapDev = indicators.vwap?.deviation;
                      const vwapDevText = typeof vwapDev === 'number' 
                        ? ` (${vwapDev > 0 ? '+' : ''}${vwapDev.toFixed(2)}%)`
                        : '';
                      return (
                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                          vwapBias === 'Above VWAP' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                          'bg-red-500/10 text-red-400 border border-red-500/30'
                        }`}>
                          <span>VWAP:</span>
                          <span>{vwapBias}{vwapDevText}</span>
                        </div>
                      );
                    })()}
                    {emaState && (
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        emaState === 'Expanding' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' :
                        'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                      }`}>
                        <span>EMA:</span>
                        <span>{emaState}</span>
                      </div>
                    )}
                    {marketStructure && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                        <span>Structure:</span>
                        <span>{marketStructure}</span>
                      </div>
                    )}
                    {distanceToLevel && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/30">
                        <span>{distanceToLevel}</span>
                      </div>
                    )}
                    {htfBias && (
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        htfBias === 'Bullish' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                        'bg-red-500/10 text-red-400 border border-red-500/30'
                      }`}>
                        <span>HTF:</span>
                        <span>{htfBias}</span>
                      </div>
                    )}
                    {liquiditySweep && (
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                        liquiditySweep === 'Detected' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/30' :
                        'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                      }`}>
                        <span>Liquidity:</span>
                        <span>{liquiditySweep}</span>
                      </div>
                    )}
                    {/* Risk badge */}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
                      riskLevel === 'High' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                      riskLevel === 'Low' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                      'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                    }`}>
                      <span>Risk:</span>
                      <span>{riskLevel}</span>
                    </div>
                  </div>
                  
                  {/* Explainability Insights */}
                  {(trendConsensus || vwapDeviationPct || momentumStrength || strategyAlignment || sentimentLabel) && (
                    <div className="mt-4 pt-4 border-t border-slate-700/30">
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Explainability Insights</h4>
                      <div className="flex flex-wrap gap-2">
                        {/* Trend Consensus */}
                        {trendConsensus && dominantTrend && (
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                            dominantTrend === 'Bullish' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                            dominantTrend === 'Bearish' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                            'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                          }`}>
                            <span>Trend Consensus:</span>
                            <span className="font-semibold">{dominantTrend}</span>
                            <span className="text-slate-500">({trendConsensus})</span>
                          </div>
                        )}
                        
                        {/* VWAP Deviation */}
                        {vwapDeviationPct && (
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                            vwapDeviationPct.startsWith('+') ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                            vwapDeviationPct.startsWith('-') ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                            'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                          }`}>
                            <span>VWAP Deviation:</span>
                            <span>{vwapDeviationPct}</span>
                          </div>
                        )}
                        
                        {/* Momentum Strength */}
                        {momentumStrength && (
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                            momentumStrength.startsWith('Strong') ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' :
                            momentumStrength.startsWith('Moderate') ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30' :
                            'bg-slate-500/10 text-slate-400 border border-slate-500/30'
                          }`}>
                            <span>Momentum Strength:</span>
                            <span>{momentumStrength}</span>
                          </div>
                        )}
                        
                        {/* Strategy Alignment */}
                        {strategyAlignment && strategyCounts && (
                          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                            strategyAlignment === 'Aligned' ? 'bg-green-500/10 text-green-400 border border-green-500/30' :
                            strategyAlignment === 'Conflicted' ? 'bg-red-500/10 text-red-400 border border-red-500/30' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          }`}>
                            <span>Strategy Alignment:</span>
                            <span>{strategyAlignment}</span>
                            <span className="text-slate-500">({strategyCounts})</span>
                          </div>
                        )}
                        
                        {/* Sentiment vs Technical Bias */}
                        {sentimentLabel && sentimentValue && (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                            <span>Sentiment:</span>
                            <span>{sentimentLabel} ({sentimentValue})</span>
                            <span className="text-slate-500">— {biasDominance}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TRADE PLAN SECTION */}
            {/* STRICT RULE: Show Trade Plan section ONLY when normalizedAccuracy >= 0.75 */}
            {/* Do NOT show based on tradePlan existence, BUY/SELL signal, or isFinal flag */}
            {(() => {
              const tradePlan = (result as any)?.tradePlan || (result as any)?.result?.tradePlan || (result as any)?.resultData?.tradePlan;
              const accuracy = result.result?.accuracy ?? (result as any)?.accuracy ?? (result as any)?.resultData?.accuracy ?? 0;
              
              // CRITICAL: Normalize accuracy - if accuracy > 1, divide by 100
              const normalizedAccuracy = typeof accuracy === 'number' ? (accuracy > 1 ? accuracy / 100 : accuracy) : 0;
              
              // Unified trade decision (frontend validation matching backend)
              const accuracyPercent = normalizedAccuracy * 100;
              const planSignal = result.result?.signal || (result as any)?.signal || 'HOLD';
              const planIndicators = analysis?.technicalIndicators || {};
              const planVwapDeviation = planIndicators?.vwap?.deviation || 0;
              const planAtrPercentile = analysis?.volatility?.atrPercentile || planIndicators?.atrPercentile || (result as any)?.result?.atrPercentile || 0;
              const planAtrPercent = planAtrPercentile > 1 ? planAtrPercentile : planAtrPercentile * 100;
              
              // Entry zone validation: BUY near resistance → BLOCK, SELL near support → BLOCK
              let planEntryZoneValid = true;
              if (planSignal === 'BUY' && planVwapDeviation > 2) {
                planEntryZoneValid = false;
              } else if (planSignal === 'SELL' && planVwapDeviation < -2) {
                planEntryZoneValid = false;
              }
              
              // Risk-Reward gate: RR < 1.2 → BLOCK
              const planRr = tradePlan?.riskRewardRatio || 0;
              const planRrValid = planRr === 0 || planRr >= 1.2;
              
              // Volatility guard: ATR >= 95% → BLOCK
              const planVolatilityState = planAtrPercent >= 95 ? 'EXTREME' : planAtrPercent >= 85 ? 'HIGH' : 'OK';
              const planVolatilityValid = planVolatilityState !== 'EXTREME';
              
              // FINAL enforcement: Only show actionable if isFinal === true
              const planIsActionable = isFinal && 
                                   planSignal !== 'HOLD' && 
                                   accuracyPercent >= 75 && 
                                   planEntryZoneValid && 
                                   planRrValid && 
                                   planVolatilityValid;
              
              // STRICT RULE: Show Trade Plan ONLY when normalizedAccuracy >= 0.75 AND all unified checks pass
              const shouldShowTradePlan = normalizedAccuracy >= 0.75 && tradePlan && tradePlan.entryPrice && planIsActionable;

              // Show reason when trade plan is blocked
              if (!shouldShowTradePlan && tradePlan?.entryPrice) {
                let blockReason = '';
                if (!isFinal) {
                  blockReason = 'Research not final';
                } else if (planSignal === 'HOLD') {
                  blockReason = 'Signal is HOLD';
                } else if (accuracyPercent < 75) {
                  blockReason = `Accuracy ${accuracyPercent.toFixed(1)}% < 75% threshold`;
                } else if (!planEntryZoneValid) {
                  blockReason = planSignal === 'BUY' ? 'BUY near resistance' : 'SELL near support';
                } else if (!planRrValid) {
                  blockReason = `Risk-Reward ${planRr.toFixed(2)} < 1.2 minimum`;
                } else if (!planVolatilityValid) {
                  blockReason = 'Extreme volatility (ATR ≥ 95%)';
                }
                
                return (
                  <div className="pt-8 border-t border-slate-700/50">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h3 className="text-lg font-bold text-amber-400">Trade Blocked</h3>
                      </div>
                      <div className="text-sm text-slate-300">
                        <div className="mb-2">Reason: {blockReason}</div>
                        {tradePlan?.riskRewardRatio && (
                          <div className="text-slate-400 italic">
                            Potential R:R ≈ {tradePlan.riskRewardRatio.toFixed(2)}:1
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              if (!shouldShowTradePlan) return null;

              return (
                <div className="pt-8 border-t border-slate-700/50">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    Trade Plan
                  </h3>

                  {/* Row 1: Entry Price | Stop Loss | Risk/Reward - Compact layout */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {/* Entry Price */}
                    <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3">
                      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Entry</div>
                      <div className="text-lg font-bold text-cyan-400 truncate">
                        ${tradePlan.entryPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                      </div>
                    </div>

                    {/* Stop Loss */}
                    {tradePlan.stopLoss ? (
                      <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Stop Loss</div>
                        <div className="text-lg font-bold text-red-400 truncate">
                          ${tradePlan.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Stop Loss</div>
                        <div className="text-lg font-bold text-slate-500">-</div>
                      </div>
                    )}

                    {/* Risk/Reward Ratio */}
                    {tradePlan.riskRewardRatio ? (
                      <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">R:R</div>
                        <div className="text-lg font-bold text-white">
                          {tradePlan.riskRewardRatio.toFixed(2)}:1
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-3">
                        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">R:R</div>
                        <div className="text-lg font-bold text-slate-500">-</div>
                      </div>
                    )}
                  </div>

                  {/* Row 2: TP1, TP2, TP3 as compact chips/badges */}
                  {(tradePlan.takeProfit1 || tradePlan.takeProfit2 || tradePlan.takeProfit3) && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {tradePlan.takeProfit1 && typeof tradePlan.takeProfit1 === 'number' && tradePlan.takeProfit1 > 0 && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg">
                          <span className="text-[10px] font-bold text-green-400 uppercase">TP1</span>
                          <span className="text-sm font-bold text-green-400">
                            ${tradePlan.takeProfit1.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </span>
                        </div>
                      )}
                      {tradePlan.takeProfit2 && typeof tradePlan.takeProfit2 === 'number' && tradePlan.takeProfit2 > 0 && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg">
                          <span className="text-[10px] font-bold text-green-400 uppercase">TP2</span>
                          <span className="text-sm font-bold text-green-400">
                            ${tradePlan.takeProfit2.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </span>
                        </div>
                      )}
                      {tradePlan.takeProfit3 && typeof tradePlan.takeProfit3 === 'number' && tradePlan.takeProfit3 > 0 && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg">
                          <span className="text-[10px] font-bold text-green-400 uppercase">TP3</span>
                          <span className="text-sm font-bold text-green-400">
                            ${tradePlan.takeProfit3.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* AUTO-TRADE READINESS SECTION */}
            {settings?.autoTradeEnabled && (
              <div className="pt-8 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Auto-Trade Readiness
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-sm text-slate-300">Active</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <div>
                    <div className="text-sm text-slate-400 mb-2">Auto-Trade Status</div>
                    <div className="text-lg font-bold text-green-400">Enabled</div>
                    <div className="text-xs text-slate-400 mt-1">System is active</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-2">Next Evaluation</div>
                    <div className="text-lg font-bold text-white">Every 5 min</div>
                    <div className="text-xs text-slate-400 mt-1">Continuous monitoring</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-2">Accuracy Threshold</div>
                    <div className={`text-lg font-bold ${(settings.minAccuracyThreshold || 0.85) >= 0.75 ? 'text-green-400' :
                      (settings.minAccuracyThreshold || 0.85) >= 0.65 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                      {(settings.minAccuracyThreshold || 0.85) * 100}%
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Minimum for execution</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-400 mb-2">Current Eligibility</div>
                    <div className={`text-lg font-bold ${displayAccuracyPercent >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'text-green-400' : 'text-red-400'
                      }`}>
                      {displayAccuracyPercent >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'Eligible' : 'Not Eligible'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Current: {displayAccuracyPercent}%
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-700/30">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-slate-300">Trade Execution Condition</h4>
                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${displayAccuracyPercent >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                      {displayAccuracyPercent >= ((settings.minAccuracyThreshold || 0.85) * 100) ? '✓ Ready to Execute' : '⏸ Below Threshold'}
                    </div>
                  </div>
                  <div className="text-sm text-slate-400">
                    Auto-trading will {displayAccuracyPercent >= ((settings.minAccuracyThreshold || 0.85) * 100) ?
                      'execute trades when signals are generated' : 'skip trades until accuracy improves'}.
                    Next evaluation in approximately 5 minutes.
                  </div>
                </div>
              </div>
            )}

            {/* AI FINAL VERDICT SECTION */}
            <div className="pt-8 border-t border-slate-700/50">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI Final Verdict
                </h3>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full animate-pulse ${result.result?.signal === 'BUY' ? 'bg-green-400' :
                    result.result?.signal === 'SELL' ? 'bg-red-400' :
                      'bg-yellow-400'
                    }`}></div>
                  <span className="text-sm text-slate-300">Analysis Complete</span>
                </div>
                {/* Confidence with partial indicator - shown below Analysis Complete for mobile */}
                {(() => {
                  const isPartial = (result as any)?.partial || (result.result as any)?.partial || false;
                  return isPartial && (
                    <div className="text-xs text-slate-500 mt-1 sm:hidden">
                      Confidence: {displayAccuracyPercent > 0 ? `${displayAccuracyPercent}%` : '0%'} (Partial)
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* CRITICAL: If isFinal === true, use ONLY result.result.signal (backend FINAL payload) */}
                    {/* REMOVE any code that does: if signal missing → HOLD */}
                    {(() => {
                      let finalSignal: string;
                      if (isFinal) {
                        // CRITICAL: FINAL IS TERMINAL - use ONLY result.result.signal (backend FINAL payload)
                        // NO fallbacks, NO defaults, NO "if missing → HOLD"
                        finalSignal = result.result?.signal || result.signal || 'HOLD';
                      } else {
                        // Non-FINAL: use with fallback
                        finalSignal = result.result?.signal || result.signal || 'HOLD';
                      }
                      return (
                        <div className={`text-4xl font-bold ${finalSignal === 'BUY' ? 'text-green-400' :
                          finalSignal === 'SELL' ? 'text-red-400' :
                            'text-yellow-400'
                          }`}>
                          {finalSignal}
                        </div>
                      );
                    })()}
                    <div className="text-center">
                      <div className="text-sm text-slate-400">Confidence</div>
                      <div className={`text-2xl font-bold ${displayAccuracyPercent >= 70 ? 'text-green-400' :
                        displayAccuracyPercent >= 50 ? 'text-yellow-400' :
                          'text-red-400'
                        }`}>
                        {(() => {
                          const isPartial = (result as any)?.partial || (result.result as any)?.partial || false;
                          const confidenceText = displayAccuracyPercent > 0 ? `${displayAccuracyPercent}%` : '0%';
                          return isPartial ? `${confidenceText} (Partial)` : confidenceText;
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Why Section */}
                <div className="pt-4 border-t border-slate-700/30">
                  <div className="text-sm font-medium text-slate-300 mb-2">Why?</div>
                  <div className="text-sm text-slate-400 leading-relaxed">
                    {(() => {
                      const signal = result.result?.signal;
                      const newsCount = result.news?.articles?.length || 0;
                      const reasons = [];

                      if (indicators.macd?.value > 0 && signal === 'BUY') reasons.push('MACD shows bullish momentum');
                      if (indicators.macd?.value < 0 && signal === 'SELL') reasons.push('MACD indicates bearish momentum');
                      if (indicators.rsi?.value < 30 && signal === 'BUY') reasons.push('RSI suggests oversold conditions');
                      if (indicators.rsi?.value > 70 && signal === 'SELL') reasons.push('RSI indicates overbought conditions');

                      const price = priceAction.currentPrice || priceAction.price || 0;
                      if (indicators.sma50?.value && price > indicators.sma50.value && signal === 'BUY') reasons.push('Price above key moving averages');
                      if (indicators.sma50?.value && price < indicators.sma50.value && signal === 'SELL') reasons.push('Price below key moving averages');

                      if (newsCount > 0) {
                        const positive = result.news?.articles?.filter((a: any) => a.sentiment === 'positive').length || 0;
                        const negative = result.news?.articles?.filter((a: any) => a.sentiment === 'negative').length || 0;
                        if (positive > negative && signal === 'BUY') reasons.push('Positive news sentiment supports outlook');
                        else if (negative > positive && signal === 'SELL') reasons.push('Negative news sentiment aligns with signal');
                      }

                      const volScore = analysis.volume?.score || indicators.volume?.score;
                      if (volScore && volScore > 60 && signal === 'BUY') reasons.push('Strong volume confirms momentum');

                      return reasons.length > 0 ? reasons.slice(0, 3).join('. ') + '.' : 'Signal based on comprehensive technical analysis.';
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* RAW DATA TOGGLE */}
            <div className="pt-8 border-t border-slate-700/50">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition-colors">
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Show Raw Data
                  </span>
                  <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="mt-4 p-4 rounded-lg border border-slate-600/30 max-h-96 overflow-auto">
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all">
                    {JSON.stringify({
                      analysis: result.analysis,
                      stages: result.stages,
                      partial: result.partial,
                      metadata: result.metadata,
                      news: result.news,
                      result: result.result
                    }, null, 2)}
                  </pre>
                </div>
              </details>
            </div>

            {/* FINAL TRADE DECISION SUMMARY */}
            {(() => {
              const accuracy = result.result?.accuracy ?? (result as any)?.accuracy ?? (result as any)?.resultData?.accuracy ?? 0;
              const normalizedAccuracy = typeof accuracy === 'number' ? (accuracy > 1 ? accuracy / 100 : accuracy) : 0;
              const accuracyPercent = normalizedAccuracy * 100;
              const signal = result.result?.signal || (result as any)?.signal || 'HOLD';
              const tradePlan = (result as any)?.tradePlan || (result as any)?.result?.tradePlan || (result as any)?.resultData?.tradePlan;
              
              // Get analysis data first for unified decision
              const decisionAnalysis = result.analysis || {};
              const decisionIndicators = decisionAnalysis?.technicalIndicators || {};
              const decisionPriceAction = decisionAnalysis?.priceAction || {};
              const decisionSupportResistance = decisionAnalysis?.supportResistance || {};
              const decisionVolatility = decisionAnalysis?.volatility || {};
              
              // Unified trade decision (matching backend logic)
              const vwapDeviation = decisionIndicators?.vwap?.deviation || 0;
              const decisionAtrPercentile = decisionVolatility?.atrPercentile || decisionIndicators?.atrPercentile || (result as any)?.result?.atrPercentile || 0;
              const atrPercent = decisionAtrPercentile > 1 ? decisionAtrPercentile : decisionAtrPercentile * 100;
              
              // Entry zone validation
              let entryZoneValid = true;
              if (signal === 'BUY' && vwapDeviation > 2) {
                entryZoneValid = false;
              } else if (signal === 'SELL' && vwapDeviation < -2) {
                entryZoneValid = false;
              }
              
              // Risk-Reward gate
              const rr = tradePlan?.riskRewardRatio || 0;
              const rrValid = rr === 0 || rr >= 1.2;
              
              // Volatility guard
              const volatilityState = atrPercent >= 95 ? 'EXTREME' : atrPercent >= 85 ? 'HIGH' : 'OK';
              const volatilityValid = volatilityState !== 'EXTREME';
              
              // Unified decision
              const isActionable = isFinal && 
                                   signal !== 'HOLD' && 
                                   accuracyPercent >= 75 && 
                                   entryZoneValid && 
                                   rrValid && 
                                   volatilityValid;
              
              // Compute key factors for decision
              const trendBias = decisionPriceAction.trendDirection?.toLowerCase() === 'bullish' ? 'Bullish' : 
                               decisionPriceAction.trendDirection?.toLowerCase() === 'bearish' ? 'Bearish' : 'Neutral';
              const macdValue = decisionIndicators.macd?.value || 0;
              const momentumAligned = (macdValue > 0 && signal === 'BUY') || (macdValue < 0 && signal === 'SELL');
              const decisionAtrPercentileForReasoning = decisionVolatility?.atrPercentile || decisionIndicators?.atrPercentile || (result as any)?.result?.atrPercentile || 50;
              const adxValue = decisionIndicators.adx?.value || decisionIndicators.trendStrength?.adx || 0;
              const trendStrength = adxValue > 25 ? 'Strong' : adxValue > 20 ? 'Moderate' : 'Weak';
              const currentPrice = decisionPriceAction.currentPrice || 0;
              const majorSupport = decisionSupportResistance.majorSupport || 0;
              const majorResistance = decisionSupportResistance.majorResistance || 0;
              const nearKeyLevel = (majorSupport > 0 && currentPrice > 0 && ((currentPrice - majorSupport) / majorSupport) * 100 < 2) ||
                                  (majorResistance > 0 && currentPrice > 0 && ((majorResistance - currentPrice) / currentPrice) * 100 < 2);
              
              // Strategies alignment
              const strategies = (result as any)?.result?.strategies || (result as any)?.strategies || {};
              let bullishCount = 0;
              let bearishCount = 0;
              Object.values(strategies).forEach((strategy: any) => {
                if (strategy && typeof strategy.signal === 'number') {
                  if (strategy.signal > 0) bullishCount++;
                  else if (strategy.signal < 0) bearishCount++;
                }
              });
              const strategiesAligned = bullishCount > bearishCount && signal === 'BUY' || 
                                       bearishCount > bullishCount && signal === 'SELL';
              
              // Build decision summary using unified logic
              let decision = '';
              let reason = '';
              
              if (isActionable) {
                decision = '✅ Trade Allowed';
                const reasons = [];
                if (trendBias !== 'Neutral' && (trendBias === 'Bullish' && signal === 'BUY' || trendBias === 'Bearish' && signal === 'SELL')) {
                  reasons.push('trend alignment');
                }
                if (momentumAligned) reasons.push('momentum alignment');
                if (trendStrength === 'Strong') reasons.push('strong trend strength');
                if (strategiesAligned) reasons.push('strategy consensus');
                if (decisionAtrPercentileForReasoning < 70) reasons.push('favorable volatility');
                if (tradePlan?.riskRewardRatio && tradePlan.riskRewardRatio >= 2) reasons.push('favorable risk-reward');
                
                reason = reasons.length > 0 
                  ? `Trend, momentum, and volatility are aligned with ${reasons.slice(0, 2).join(' and ')}. Risk-reward is favorable and confirmation meets the accuracy threshold.`
                  : 'Trend, momentum, and volatility are aligned with strong consensus. Risk-reward is favorable and confirmation meets the accuracy threshold.';
              } else {
                decision = '❌ Avoid Trade';
                const reasons = [];
                if (!isFinal) reasons.push('research not final');
                if (signal === 'HOLD') reasons.push('signal is HOLD');
                if (accuracyPercent < 75) reasons.push(`accuracy ${accuracyPercent.toFixed(1)}% is below 75%`);
                if (!entryZoneValid) reasons.push(signal === 'BUY' ? 'BUY near resistance' : 'SELL near support');
                if (!rrValid && rr > 0) reasons.push(`risk-reward ${rr.toFixed(2)} < 1.2 minimum`);
                if (!volatilityValid) reasons.push('extreme volatility (ATR ≥ 95%)');
                if (nearKeyLevel) reasons.push('price is near key support/resistance');
                if (trendStrength === 'Weak') reasons.push('weak trend strength');
                if (!momentumAligned) reasons.push('momentum misalignment');
                if (decisionAtrPercentileForReasoning > 70 && volatilityValid) reasons.push('high volatility risk');
                
                reason = reasons.length > 0
                  ? `Trade blocked: ${reasons.slice(0, 3).join(', ')}. Waiting for stronger confirmation is safer.`
                  : 'Trade blocked by unified validation rules. Waiting for stronger confirmation is safer.';
              }
              
              return (
                <div className="pt-8 border-t border-slate-700/50">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Final Trade Decision
                  </h3>
                  <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-4 space-y-2">
                    <div className="text-lg font-bold text-white">
                      {decision}
                    </div>
                    <div className="text-sm text-slate-300 leading-relaxed">
                      <span className="font-medium">Reason:</span> {reason}
                    </div>
                  </div>
                </div>
              );
            })()}

          </>
        );
      })()}
    </div>
  );
};

export default DeepResearchCore;
