# UNIFIED TRADE DECISION LOGIC - IMPLEMENTATION SUMMARY

## Overview

Trade decision logic has been unified across ALL flows:
- ✅ Auto-Trade Execution
- ✅ Telegram Alerts (Auto-Trade mode)
- ✅ Telegram Alerts (Background Research mode)
- ✅ Research UI (Actionable Signal Display)

**Result:** The SAME validation rules apply everywhere. No mismatch. No confusion. No false confidence.

---

## Unified Function: `makeUnifiedTradeDecision`

**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:224`

**Validations Applied (in order):**

1. **Accuracy Format Fix (GLOBAL)**
   - Converts decimal (0-1) to percentage (0-100) if needed
   - Ensures consistent comparison across all flows

2. **FINAL Research Enforcement**
   - If `isFinal !== true` → BLOCK
   - Applies to: Auto-trade, Telegram alerts
   - UI may show confidence but marks it NON-FINAL

3. **HOLD Signal Check**
   - If `signal === 'HOLD'` → BLOCK

4. **Accuracy Threshold Check**
   - If `accuracy < threshold` → BLOCK
   - Default: 75% (auto-trade), 60% (manual approval)

5. **Entry Zone Validation (GLOBAL)**
   - BUY near resistance (vwapDeviation > 2% OR within 2% of majorResistance) → BLOCK
   - SELL near support (vwapDeviation < -2% OR within 2% of majorSupport) → BLOCK
   - Applies to: Auto-trade, Telegram alerts, Research UI

6. **Risk-Reward Gate (GLOBAL)**
   - If `RR < 1.2` → BLOCK
   - Applies to: Auto-trade, Telegram alerts, Research UI
   - UI shows "Skipped: Low RR" message

7. **Volatility (ATR) Guard (GLOBAL)**
   - If ATR percentile >= 95% → BLOCK (EXTREME)
   - If ATR percentile >= 85% → WARN (HIGH, but allows trade)
   - Applies to: Auto-trade, Telegram alerts, Research UI

---

## Integration Points

### 1. Auto-Trade Execution
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:1122-1165`

- Called in `checkRiskGuards()` before trade execution
- Extracts indicators and trade plan from `TradeSignal` or attached `researchResult`
- Logs unified decision with `[TRADE_DECISION]` tag
- Blocks execution if unified decision returns `allowed: false`

### 2. Telegram Alerts (Auto-Trade Mode)
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:3644-3675`

- Called before sending Telegram alert
- Uses FINAL research result indicators and trade plan
- Blocks alert if unified decision returns `allowed: false`
- Logs unified decision with `[TRADE_DECISION] Telegram:` tag

### 3. Telegram Alerts (Background Research Mode)
**Location:** `dlxtrade-ws/src/services/backgroundResearchScheduler.ts:1533-1565`

- Called before sending Telegram background research alert
- Uses FINAL research result indicators and trade plan
- Blocks alert if unified decision returns `allowed: false`
- Logs unified decision with `[TRADE_DECISION] Telegram BG:` tag

### 4. Research UI (Frontend)
**Location:** `frontend/src/pages/DeepResearchCore.tsx:725-830` and `1088-1150`

- Implements same validation logic inline (frontend cannot import backend function)
- Shows "Trade Blocked" message with specific reason
- Updates "Final Trade Decision" section to use unified logic
- Displays actionable status based on unified decision

---

## Unified Decision Output Structure

```typescript
interface UnifiedTradeDecision {
  allowed: boolean;
  reason?: string;
  accuracyUsed: number;      // Percentage (0-100)
  rr: number;                // Risk-Reward ratio
  volatilityState: 'OK' | 'HIGH' | 'EXTREME';
  entryZoneValid: boolean;
  isFinal: boolean;
}
```

---

## Unified Logging Format

**Format:**
```
[TRADE_DECISION] FINAL=true acc=85.0 rr=1.40 atr=OK entryZone=OK → ALLOWED
[TRADE_DECISION] FINAL=true acc=92.0 rr=0.90 atr=OK → BLOCKED (LOW_RR)
[TRADE_DECISION] FINAL=false acc=88.0 → BLOCKED (NOT_FINAL)
```

**Tags:**
- `[TRADE_DECISION]` - Auto-trade execution
- `[TRADE_DECISION] Telegram:` - Telegram alerts (auto-trade mode)
- `[TRADE_DECISION] Telegram BG:` - Telegram alerts (background research mode)

---

## Validation Rules Summary

| Rule | Threshold | Applies To |
|------|-----------|------------|
| FINAL Status | `isFinal === true` | All flows |
| Accuracy | ≥75% (auto) / ≥60% (manual) | All flows |
| Entry Zone | VWAP deviation ≤2% AND not within 2% of S/R | All flows |
| Risk-Reward | ≥1.2 | All flows |
| Volatility | ATR percentile <95% | All flows |

---

## Block Reasons

1. `NOT_FINAL` - Research result is not final
2. `HOLD_SIGNAL` - Signal is HOLD
3. `ACCURACY_TOO_LOW` - Accuracy below threshold
4. `ENTRY_ZONE_INVALID` - BUY near resistance or SELL near support
5. `LOW_RR` - Risk-Reward ratio < 1.2
6. `EXTREME_VOLATILITY` - ATR percentile >= 95%

---

## UI Enhancements

### Trade Plan Section
- Shows "Trade Blocked" message with specific reason when blocked
- Displays potential R:R even when blocked
- Only shows trade plan when ALL unified checks pass

### Final Trade Decision Section
- Uses unified decision logic for "Trade Allowed" / "Avoid Trade" determination
- Shows specific blocking reasons
- Matches backend decision exactly

---

## Testing Validation

**To verify unification:**
1. Check logs for `[TRADE_DECISION]` entries
2. Verify same decision appears in:
   - Auto-trade execution logs
   - Telegram alert logs (if sent)
   - Research UI display
3. Ensure no scenario where:
   - Telegram alerts but auto-trade skips
   - UI shows "strong signal" but execution blocks silently

---

## Files Modified

1. `dlxtrade-ws/src/services/autoTradeEngine.ts`
   - Added `makeUnifiedTradeDecision()` function
   - Integrated into `checkRiskGuards()`
   - Integrated into Telegram alert logic (auto-trade mode)
   - Attached `researchResult` to `TradeSignal`

2. `dlxtrade-ws/src/services/backgroundResearchScheduler.ts`
   - Integrated unified decision into Telegram background research alerts

3. `frontend/src/pages/DeepResearchCore.tsx`
   - Added inline unified decision logic for Trade Plan section
   - Updated Final Trade Decision section to use unified logic
   - Added "Trade Blocked" UI with specific reasons

---

## Backward Compatibility

- ✅ All existing code continues to work
- ✅ No breaking changes to interfaces
- ✅ `researchResult` attached to `TradeSignal` via `(signal as any)` (non-breaking)
- ✅ Frontend uses inline logic (no new dependencies)

---

**Implementation Complete** ✅

