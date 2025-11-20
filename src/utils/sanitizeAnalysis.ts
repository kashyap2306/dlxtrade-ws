/**
 * Sanitize analysis response for frontend
 * Removes debug fields and signals arrays
 */

export interface SanitizedAnalysis {
  symbol: string;
  side: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  exits: number[];
  summaryText: string;
  timestamp: string;
}

export function sanitizeAnalysis(result: any): SanitizedAnalysis {
  return {
    symbol: result.symbol || '',
    side: result.side || 'NEUTRAL',
    confidence: Math.round(result.confidence || (result.accuracy || 0.5) * 100),
    entry: result.entry ? Number(result.entry) : null,
    stopLoss: result.stopLoss ? Number(result.stopLoss) : null,
    takeProfit: result.takeProfit ? Number(result.takeProfit) : null,
    exits: (result.exits || []).slice(0, 3).map((x: any) => Number(x)),
    summaryText: result.summary || result.liveAnalysis?.summary || result.recommendedAction || '',
    timestamp: result.timestamp || new Date().toISOString(),
  };
}

