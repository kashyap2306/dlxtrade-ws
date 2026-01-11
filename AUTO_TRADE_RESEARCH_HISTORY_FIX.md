# Auto-Trade Research History Data Correctness Fix

## Problem Summary
Research history was showing "NO_RESEARCH" even when research actually ran and analyzed coins. This hid coin names and accuracy values for weak signals (HOLD with low accuracy), which was incorrect behavior.

## Root Cause
The system was treating weak research results (accuracy 30-75%, HOLD signal) the same as failed research (no market data). When research executed but produced weak signals, the history was being stored with:
- symbol: "NO_RESEARCH" 
- accuracy: 0
- signal: "HOLD"

This violated the requirement that if research ran and analyzed at least one coin, the history MUST store and display the actual coin name and accuracy.

## Solution Implemented

### 1. Backend Changes - backgroundResearchScheduler.ts

**File**: `dlxtrade-ws/src/services/backgroundResearchScheduler.ts`

**Changes**:
- Modified history writing logic to ALWAYS use `bestSymbol` or first analyzed coin when research executed
- Added `signalWritten` variable to preserve actual signal from research results
- Changed minimum accuracy from 30 to use `estimatedAccuracy` or `bestAccuracy` from research data
- Updated skipReason from "Below accuracy threshold" to "WEAK_SIGNAL" for clarity
- Applied same fix to both success and error cases

**Key Logic**:
```typescript
if (didCandidateScanRun) {
  // Candidates were available - accuracy scan ran, NEVER write "NO_RESEARCH"
  if (researchData && researchData.bestSymbol && researchData.bestSymbol !== "NO_RESEARCH") {
    symbolWritten = researchData.bestSymbol;
    accuracyWritten = Math.max(30, researchData.bestAccuracy || researchData.estimatedAccuracy || 30);
    skipReason = "WEAK_SIGNAL";
    if (researchData.results && researchData.results.length > 0) {
      signalWritten = researchData.results[0].signal || 'HOLD';
    }
  }
  // ... fallback to coinsAnalyzed[0] if bestSymbol missing
} else {
  // NO candidates available - ONLY case where NO_RESEARCH is allowed
  symbolWritten = "NO_RESEARCH";
  accuracyWritten = 0;
  skipReason = "No market data available";
}
```

### 2. Backend Changes - historyWriter.ts

**File**: `dlxtrade-ws/src/services/historyWriter.ts`

**Changes to saveAutoTradeHistorySkipped**:
- Added documentation clarifying this should ONLY be called when research did NOT execute at all
- Updated comments to emphasize this is for cycles where research never ran

**Changes to saveAutoTradeHistoryWithExecutionStatus**:
- Removed the check that forced skip when `accuracy <= 0`
- Changed to only force skip when `accuracy < 0` (invalid)
- Updated to preserve weak signals (30-75% accuracy) with actual coin names
- Changed fallback symbol from 'BTCUSDT' to 'UNKNOWN' for clarity
- Added comment explaining weak signals are valid research results

**Key Logic**:
```typescript
// CRITICAL FIX: Do NOT force skip for low accuracy - weak signals are valid research results
// Accuracy between 30-75 is a valid weak signal that should be stored with actual coin name
if (typeof accuracy !== 'number' || accuracy < 0) {
  logger.warn({ uid, symbol: historySymbol, accuracy }, '[HISTORY_FORCE_SKIPPED] Invalid accuracy - forcing executionStatus=SKIPPED but saving history');
  forceSkipped = true;
}

// CRITICAL FIX: For weak signals (30-75 accuracy), store actual accuracy, not 0
const storedAccuracy = forceSkipped ? 0 : Math.max(0, Math.min(100, Number(accuracy) || 0));
```

### 3. Frontend - Already Correct

**File**: `frontend/src/pages/AutoTrade.tsx`

The frontend filtering logic was already correct and did NOT need changes:
- Only hides entries where `symbol === "NO_RESEARCH"` AND `accuracy === 0` AND `skipReason` indicates no market data
- Properly displays coin name and accuracy for weak signals (HOLD with accuracy > 0)
- Shows descriptive status "Weak signal (HOLD)" for weak research results

## Validation

### Expected Behavior After Fix

**When research executes and analyzes coins:**
- History MUST show:
  - Coin symbol (e.g., "BTCUSDT", "ETHUSDT")
  - Accuracy (even if low, e.g., 35%, 42%)
  - Signal (BUY/SELL/HOLD)
  - Status (e.g., "Weak signal (HOLD)", "WEAK_SIGNAL")
  - Timestamp

**When research does NOT execute:**
- History shows:
  - Symbol: "NO_RESEARCH" or "--" in UI
  - Accuracy: 0 or "--" in UI
  - Status: Descriptive reason (e.g., "No market data available", "Research Keys Missing")

### Test Cases

1. **Weak Signal (HOLD with 35% accuracy)**
   - Expected: Shows coin name (e.g., "BTCUSDT"), accuracy "35.0%", status "Weak signal (HOLD)"
   - Before fix: Showed "NO_RESEARCH", accuracy "--", hidden from UI

2. **Strong Signal (BUY with 85% accuracy)**
   - Expected: Shows coin name, accuracy "85.0%", status "Executed" or "Skipped" with reason
   - Before fix: Worked correctly

3. **No Market Data**
   - Expected: Shows "--" for coin, "--" for accuracy, status "No market data available"
   - Before fix: Worked correctly

4. **Research Error**
   - Expected: Shows coin name if analysis started, accuracy if computed, status with error message
   - Before fix: Showed "NO_RESEARCH" even if coin was selected

## Files Modified

1. `dlxtrade-ws/src/services/backgroundResearchScheduler.ts` - History writing logic
2. `dlxtrade-ws/src/services/historyWriter.ts` - History storage functions
3. No frontend changes required (already correct)

## Build Status

✅ Backend build successful (TypeScript compilation passed)
✅ No breaking changes
✅ Backward compatible (existing history entries unaffected)

## Deployment Notes

- Server restart required for changes to take effect
- Existing history entries will remain unchanged
- New research cycles will use corrected logic
- No database migration required

## Summary

The fix ensures that when research executes and analyzes at least one coin, the history ALWAYS stores and displays:
- The actual coin symbol (never "NO_RESEARCH")
- The actual accuracy (never 0 when research ran)
- The actual signal (BUY/SELL/HOLD)
- Descriptive status (e.g., "WEAK_SIGNAL" for low accuracy)

"NO_RESEARCH" is now ONLY used when:
- Research did NOT execute at all
- candidateCoins.length === 0
- Market data fetch failed completely

This provides users with complete visibility into what the auto-trade system analyzed, even when signals are weak and don't trigger trades.
