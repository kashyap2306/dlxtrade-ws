/**
 * Auto-Trade History
 * ONLY all auto-trade history saving logic
 * SKIPPED / BLOCKED / SUCCESS status writes
 * Firestore history helpers
 * No execution decisions allowed here
 * 
 * NOTE: Core history functions are implemented in historyWriter.ts
 * This file serves as a consolidated export for auto-trade history operations
 */

// Re-export all history functions from historyWriter for consolidated access
export {
  logAutoTradeSkip,
  saveAutoTradeHistorySkipped,
  saveAutoTradeHistoryWithExecutionStatus
} from './historyWriter';

