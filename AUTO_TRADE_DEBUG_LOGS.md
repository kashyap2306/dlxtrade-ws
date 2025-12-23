# AUTO-TRADE DEBUG LOGS - TRACING EXECUTION PATH

**Purpose:** Trace execution flow after unified trade decision allows trade to identify exact blocker.

## Debug Logs Added

### 1. After Unified Decision Allows (checkRiskGuards)
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1172

**Log:** `🔍 [DEBUG_TRACE] Unified decision ALLOWED - proceeding to position checks`

**Checks:**
- `tradePlanExists`
- `tradePlanSL` (stop loss)
- `tradePlanTP` (take profit)
- `tradePlanRR` (risk-reward ratio)
- `entryPrice`

### 2. After All Risk Guards Pass (checkRiskGuards)
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1238

**Log:** `🔍 [DEBUG_TRACE] Risk guards PASSED - executeTrade will continue`

**Indicates:** All position-level checks passed, returning to `executeTrade()`

### 3. Risk Guards Passed in executeTrade
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1514

**Log:** `🔍 [DEBUG_TRACE] Risk guards PASSED in executeTrade - proceeding to adapter/position sizing`

**Checks:**
- `hasAdapter` (adapter exists or needs initialization)

### 4. Adapter Initialization
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1518

**Logs:**
- `🔍 [DEBUG_TRACE] Adapter missing - initializing` (if adapter missing)
- `🔍 [DEBUG_TRACE] BLOCKED: Adapter initialization failed` (if init fails)
- `🔍 [DEBUG_TRACE] Adapter initialized successfully` (if init succeeds)
- `🔍 [DEBUG_TRACE] Adapter already exists` (if adapter exists)

**Checks:**
- `adapterType` (adapter class name)

### 5. Position Sizing Start
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1687

**Log:** `🔍 [DEBUG_TRACE] Starting position sizing calculation`

**Checks:**
- `equity`
- `entryPrice`
- `stopLoss`
- `takeProfit`
- `hasTradePlan`

### 6. SL/TP Validation
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1710

**Logs:**
- `🔍 [DEBUG_TRACE] BLOCKED: Stop loss missing or invalid` (if SL invalid)
- `🔍 [DEBUG_TRACE] BLOCKED: Entry price missing or invalid` (if entry invalid)

**Validates:**
- `stopLoss > 0` and not NaN
- `entryPrice > 0` and not NaN

### 7. Raw Quantity Calculated
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1740

**Log:** `🔍 [DEBUG_TRACE] Raw quantity calculated from risk`

**Shows:**
- `riskPct`
- `riskAmount`
- `slDistance`
- `rawQuantity`

### 8. Position Value Calculated
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1806

**Log:** `🔍 [DEBUG_TRACE] Position value calculated`

**Shows:**
- `positionValue`
- `quantity`
- `entryPrice`

### 9. Position Sizing Complete
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1837

**Log:** `🔍 [DEBUG_TRACE] Position sizing complete - proceeding to order placement`

**Shows:**
- `finalQuantity`
- `finalPositionValue`
- `finalPositionPercent`
- `leverage`

**Blockers:**
- `🔍 [DEBUG_TRACE] BLOCKED: Calculated quantity is zero or negative` (if quantity <= 0)

### 10. Pre-Order Placement
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1781

**Log:** `🔍 [DEBUG_TRACE] All checks passed - proceeding to order placement`

**Checks:**
- `quantity`
- `entryPrice`
- `stopLoss`
- `takeProfit`
- `leverage`
- `hasAdapter`
- `adapterType`

**Blockers:**
- `🔍 [DEBUG_TRACE] BLOCKED: shouldExecute is false` (if execution blocked)

### 11. Order Placement Start
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1837

**Log:** `🔍 [DEBUG_TRACE] Final order payload - placing order now`

**Shows:**
- Complete order payload
- `leverage`
- `stopLoss`
- `takeProfit`

### 12. Order Placed Successfully
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 1846

**Log:** `🔍 [DEBUG_TRACE] Order placed successfully - proceeding to TP/SL`

**Shows:**
- `orderId`
- `fillPrice`
- `quantity`

### 13. Before Calling executeTrade (runAutoTradeResearchCycle)
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 3995

**Log:** `🔍 [DEBUG_TRACE] About to call executeTrade - all pre-checks passed`

**Shows:**
- `signal`
- `entryPrice`
- `stopLoss`
- `takeProfit`
- `accuracy`
- `leverage`
- `hasResearchResult`

### 14. After executeTrade Returns
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts` ~line 3995

**Log:** `🔍 [DEBUG_TRACE] executeTrade returned successfully`

**Shows:**
- `executionStatus`
- `tradeId`

## How to Use These Logs

1. **Search for `[DEBUG_TRACE]` in logs** to see execution flow
2. **Find the LAST log** before execution stops
3. **Check for `BLOCKED` logs** to identify exact blocker
4. **Trace sequence:**
   - Unified decision → Risk guards → executeTrade entry → Adapter → Position sizing → Order placement

## Expected Flow

```
1. [DEBUG_TRACE] Unified decision ALLOWED
2. [DEBUG_TRACE] Risk guards PASSED - executeTrade will continue
3. [DEBUG_TRACE] Risk guards PASSED in executeTrade
4. [DEBUG_TRACE] Adapter exists/initialized
5. [DEBUG_TRACE] Starting position sizing calculation
6. [DEBUG_TRACE] Raw quantity calculated
7. [DEBUG_TRACE] Position value calculated
8. [DEBUG_TRACE] Position sizing complete
9. [DEBUG_TRACE] All checks passed - proceeding to order placement
10. [DEBUG_TRACE] Final order payload - placing order now
11. [DEBUG_TRACE] Order placed successfully
```

## Common Blockers to Check

1. **Trade plan missing:** `tradePlanExists: false`
2. **SL/TP invalid:** `stopLoss <= 0` or `entryPrice <= 0`
3. **Quantity zero:** `quantity <= 0`
4. **Adapter missing:** `hasAdapter: false` and initialization fails
5. **shouldExecute false:** `autoTradeEnabled: false` or `manualOverride: true`
6. **Risk guards block:** Check reason in `[RISK_GUARDS] BLOCKED` logs

## Next Steps

1. Run auto-trade cycle
2. Check logs for `[DEBUG_TRACE]` entries
3. Identify last log before execution stops
4. Check for `BLOCKED` logs with exact reason
5. Report root cause with exact file + function + condition

---

**Note:** These are temporary debug logs. Remove after identifying root cause.

