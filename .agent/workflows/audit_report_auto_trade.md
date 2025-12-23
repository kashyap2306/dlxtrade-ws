---
description: Audit Report: Research History, Background Research, and Auto-Trade
---

# Audit Report: Research History & Auto-Trade Systems

## 1. Objectives
- Fix Research History displaying only BTC.
- Verify Background Deep Research pipeline.
- Deep Audit of Auto-Trade execution flow.
- Ensure all research (Background & Auto-Trade) is visible in History.

## 2. Findings & Fixes

### A. Research History "BTC Only" Bug
- **Root Cause:** 
  1. Coin selection logic (`selectBestCoinByAccuracy`) favored BTC heavily due to low volatility in other coins and strict strict weighting.
  2. **CRITICAL:** `Auto-Trade` was running deep research but **NEVER** logging the results to `Research History`. Only `Background Scheduler` was logging to history. If Auto-Trade ran more often or on different coins, those runs were invisible to the user.
- **Fixes Applied:**
  1. Updated `researchModes.ts` to include a random tie-breaker and adjusted volatility scoring to allow high-volatility altcoins to beat BTC.
  2. Updated `autoTradeEngine.ts` to explicitly call `firestoreAdapter.storeResearchHistory` after every research cycle.
  3. Updated `backgroundResearchScheduler.ts` to log `FAILED` research attempts to history for better visibility.
  4. Updated `ResearchPanel.tsx` (frontend) to gracefully display `FAILED` entries.

### B. Background Deep Research Pipeline
- **Status:** Verified.
- **Flow:** Scheduler -> `selectBestCoinByAccuracy` -> `runFreeModeDeepResearch` -> `storeResearchHistory` -> Telegram Alert.
- **Verification:** Logic is sound. The logging of `FAILED` states improves observability.

### C. Auto-Trade Execution Logic
- **Status:** Verified.
- **Flow:** Scheduler -> `selectBestCoinByAccuracy` -> `runFreeModeDeepResearch` -> `storeResearchHistory` (New) -> Signal Eval -> Risk Checks -> Execution.
- **Trade Confirmation:** Logic confirmed. If `tradeConfirmationRequired` is enabled, it creates a `PENDING` trade and sends a notification instead of executing.
- **Visibility:** Now fully integrated with Research History.

## 3. "Why Auto-Trade May Not Be Executing?"
If Auto-Trade is enabled but not trading, possible reasons (now fully auditable):
1.  **Duplicate Execution:** Background Research and Auto-Trade might compete for coordinates/API limits.
2.  **No Signal:** Market conditions (HOLD signals).
3.  **Accuracy Threshold:** signals < 85% accuracy (or user setting).
4.  **Risk Guards:** Max daily loss, max trades limits.
5.  **Environment:** `DISABLE_AUTOTRADE` env var.

With the new logging in `Research History` (including FAILED states), the user can now exactly see *why* a coin was analyzed and what the result was, even if no trade occurred.

## 4. Next Steps for User
- Check the "Research History" UI. You should now see a variety of coins (not just BTC) and potentially "FAILED" entries if errors occur.
- Monitor "Auto-Trade" activity. It will now populate the Research History table.
- Verify "Trade Confirmation" notifications appear if enabled.

## 5. Artifacts Created/Modified
- `src/services/researchModes.ts`: Improved coin selection.
- `src/services/backgroundResearchScheduler.ts`: Added failure logging.
- `src/services/autoTradeEngine.ts`: Added Research History logging.
- `src/pages/ResearchPanel.tsx`: Updated UI for failed states.
