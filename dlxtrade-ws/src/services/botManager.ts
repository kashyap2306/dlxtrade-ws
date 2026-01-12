import { validateTrade, RiskBotInput, RiskBotOutput } from './liquidityRiskBot';
import { getAgentRiskBotConfig } from './firestoreAdapter';

/**
 * Bot Manager - Central executor for risk validation bots
 * Manages sequential execution of enabled risk bots
 */

export interface TradeProposal extends RiskBotInput {
  agentId: string;
}

export interface BotValidationResult {
  trade: "YES" | "NO";
  confidence: number;
  bots_executed: string[];
  failed_bot?: string;
  reason: string;
}

/**
 * Available risk bots - extensible for future bots
 */
const RISK_BOTS = {
  liquidityRiskBot: {
    name: 'liquidityRiskBot',
    validate: validateTrade,
  },
} as const;

/**
 * Executes risk validation bots sequentially for a trade proposal
 * Stops on first NO result for conservative risk management
 */
export async function executeRiskValidation(tradeProposal: TradeProposal): Promise<BotValidationResult> {
  const { agentId, ...tradeData } = tradeProposal;

  try {
    // Get enabled bots for this agent
    const agentConfig = await getAgentRiskBotConfig(agentId);

    // If risk bot is disabled, bypass validation
    if (!agentConfig.enabled) {
      return {
        trade: "YES",
        confidence: 100,
        bots_executed: [],
        reason: "Risk validation disabled for this agent"
      };
    }

    const enabledBots = agentConfig.bots || [];
    const executedBots: string[] = [];

    // Execute enabled bots sequentially
    for (const botName of enabledBots) {
      const bot = RISK_BOTS[botName as keyof typeof RISK_BOTS];

      if (!bot) {
        // Unknown bot - skip but continue (don't fail the trade)
        continue;
      }

      const result: RiskBotOutput = bot.validate(tradeData);
      executedBots.push(botName);

      // If any bot says NO, stop immediately and reject the trade
      if (result.trade === "NO") {
        return {
          trade: "NO",
          confidence: 0,
          bots_executed: executedBots,
          failed_bot: botName,
          reason: `Bot ${botName}: ${result.reason}`
        };
      }
    }

    // All bots passed - allow the trade
    // Use the confidence from the last bot executed
    const lastBotName = executedBots[executedBots.length - 1];
    const lastBot = RISK_BOTS[lastBotName as keyof typeof RISK_BOTS];
    const lastResult = lastBot ? lastBot.validate(tradeData) : null;

    return {
      trade: "YES",
      confidence: lastResult ? lastResult.confidence : 100,
      bots_executed: executedBots,
      reason: "All risk validation checks passed"
    };

  } catch (error) {
    // On error, default to conservative approach - reject trade
    return {
      trade: "NO",
      confidence: 0,
      bots_executed: [],
      reason: `Risk validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}