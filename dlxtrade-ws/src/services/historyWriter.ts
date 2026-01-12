/**
 * Centralized Auto-Trade History Management
 *
 * This file contains ALL auto-trade, background research, and manual research history logic.
 * No other files should write research history directly.
 *
 * MOVED FROM: historyWriter.ts (functions moved to autoTradeHistory.ts)
 */

// Re-export all history functions from the centralized autoTradeHistory.ts
export {
  logAutoTradeSkip,
  saveAutoTradeHistorySkipped,
  saveAutoTradeHistoryWithExecutionStatus,
} from './autoTradeHistory';
