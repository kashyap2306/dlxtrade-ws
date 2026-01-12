import { executeRiskValidation, TradeProposal, BotValidationResult } from './botManager';
import { logger } from '../utils/logger';

/**
 * Trade Validation Controller
 * Entry point for trade validation in auto-trade flow
 * Integrates with existing systems without breaking them
 */

export interface TradeValidationRequest {
  agentId: string;
  trade: {
    pair: string;
    timeframe: string;
    session: string;
    liquidity_sweep: boolean;
    sweep_type: string;
    volume_spike: boolean;
    structure_break: boolean;
    market_condition: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    risk_percent: number;
    trades_taken_today: number;
    last_trade_result: string;
  };
}

export interface TradeValidationResponse {
  approved: boolean;
  confidence: number;
  reason: string;
  bots_executed?: string[];
  failed_bot?: string;
}

/**
 * Validates a trade proposal using the risk bot system
 * Called by auto-trade flow before executing trades
 *
 * @param request Trade validation request with agent and trade data
 * @returns Validation result with approval decision
 */
export async function validateTradeProposal(
  request: TradeValidationRequest
): Promise<TradeValidationResponse> {

  try {
    // Convert request to TradeProposal format
    const tradeProposal: TradeProposal = {
      agentId: request.agentId,
      ...request.trade
    };

    // Execute risk validation through bot manager
    const result: BotValidationResult = await executeRiskValidation(tradeProposal);

    // Log validation decision for monitoring
    logger.info({
      agentId: request.agentId,
      pair: request.trade.pair,
      approved: result.trade === "YES",
      confidence: result.confidence,
      bots_executed: result.bots_executed,
      failed_bot: result.failed_bot,
      reason: result.reason
    }, 'TRADE_VALIDATION_DECISION');

    return {
      approved: result.trade === "YES",
      confidence: result.confidence,
      reason: result.reason,
      bots_executed: result.bots_executed,
      failed_bot: result.failed_bot
    };

  } catch (error) {
    // On any error, default to conservative approach - reject trade
    const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';

    logger.error({
      agentId: request.agentId,
      error: errorMessage,
      pair: request.trade.pair
    }, 'TRADE_VALIDATION_ERROR');

    return {
      approved: false,
      confidence: 0,
      reason: `Validation system error: ${errorMessage}`
    };
  }
}