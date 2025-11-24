"use strict";
/**
 * Sanitize analysis response for frontend
 * Removes debug fields and signals arrays
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeAnalysis = sanitizeAnalysis;
function sanitizeAnalysis(result) {
    return {
        symbol: result.symbol || '',
        side: result.side || 'NEUTRAL',
        confidence: Math.round(result.confidence || (result.accuracy || 0.5) * 100),
        entry: result.entry ? Number(result.entry) : null,
        stopLoss: result.stopLoss ? Number(result.stopLoss) : null,
        takeProfit: result.takeProfit ? Number(result.takeProfit) : null,
        exits: (result.exits || []).slice(0, 3).map((x) => Number(x)),
        summaryText: result.summary || result.liveAnalysis?.summary || result.recommendedAction || '',
        timestamp: result.timestamp || new Date().toISOString(),
    };
}
