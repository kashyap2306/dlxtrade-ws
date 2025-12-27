/**
 * Telegram Message Formatter
 * ONLY message formatting / template generation logic
 */

export function formatTelegramMessage(
  alertType: 'research' | 'execution' | 'skipped',
  data: {
    symbol?: string;
    signal?: string;
    accuracy?: number;
    reason?: string;
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    takeProfit1?: number;
    takeProfit2?: number;
    takeProfit3?: number;
    tradePlan?: any;
    requestId?: string;
  },
  timestamp: string
): string {
  let message = '';

  if (alertType === 'research') {
    const { symbol, signal, accuracy, tradePlan } = data;
    if (signal === 'HOLD' || !tradePlan) {
      message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${symbol}
**Signal:** ${signal || 'HOLD'}
**Accuracy:** ${accuracy?.toFixed(1)}%
**Reason:** ${signal === 'HOLD' ? 'Accuracy below 60% threshold' : 'No trade plan generated'}
**Timestamp:** ${timestamp}

⚡ *Action:* Wait for higher confidence signal before trading.`;
    } else if (tradePlan && accuracy && accuracy >= 60) {
      const entryPrice = tradePlan.entryPrice;
      const stopLoss = tradePlan.stopLoss;
      const tp1 = tradePlan.takeProfit1;
      const tp2 = tradePlan.takeProfit2;
      const tp3 = tradePlan.takeProfit3;

      message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${symbol}
**Signal:** ${signal}
**Accuracy:** ${accuracy.toFixed(1)}%
**Entry Price:** $${entryPrice?.toFixed(2)}
**Stop Loss:** $${stopLoss?.toFixed(2)}
**Take Profit 1:** $${tp1?.toFixed(2)}
**Take Profit 2:** $${tp2?.toFixed(2)}${tp3 ? `\n**Take Profit 3:** $${tp3.toFixed(2)}` : ''}
**Timestamp:** ${timestamp}

⚡ *Action:* Auto-trade will execute if accuracy >= 75% and all risk checks pass.`;
    }
  } else if (alertType === 'execution') {
    const { symbol, signal, entryPrice, stopLoss, takeProfit, accuracy, requestId } = data;
    message = `✅ *DLXTRADE Auto-Trade EXECUTED*

**Coin:** ${symbol}
**Signal:** ${signal}
**Entry Price:** $${entryPrice?.toFixed(2)}
**Stop Loss:** $${stopLoss?.toFixed(2)}
**Take Profit:** $${takeProfit?.toFixed(2)}
**Accuracy:** ${accuracy?.toFixed(1)}%
**Request ID:** ${requestId}
**Timestamp:** ${timestamp}

⚡ *Status:* Trade executed successfully`;
  } else if (alertType === 'skipped') {
    const { symbol, reason, accuracy } = data;
    message = `⏭️ *DLXTRADE Auto-Trade SKIPPED*

**Coin:** ${symbol || 'N/A'}
**Reason:** ${reason}
**Accuracy:** ${accuracy?.toFixed(1) || 'N/A'}%
**Timestamp:** ${timestamp}

⚡ *Action:* Trade skipped due to ${reason}`;
  }

  return message;
}
