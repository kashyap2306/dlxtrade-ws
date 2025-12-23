# ACCURACY CALCULATION PIPELINE - COMPREHENSIVE AUDIT REPORT

**Date:** Generated during audit  
**Scope:** End-to-end accuracy calculation, aggregation, transformation, and execution gating

---

## EXECUTIVE SUMMARY

This audit traces the complete accuracy calculation pipeline from source data to final trade execution decision. The pipeline involves multiple accuracy sources, weighted aggregation, normalization, special rules, and execution gates.

**Key Finding:** Accuracy values of 85-95% may be visible in the UI but trades may not execute due to:
1. **Execution threshold mismatch:** Auto-trade requires ≥75% (0.75), but UI may show percentage (85-95%)
2. **Normalization issues:** Accuracy may be stored/displayed in different formats (0-1 decimal vs 0-100 percentage)
3. **Multiple accuracy values:** `accuracy` vs `snapshotAccuracy` vs `normalizedAccuracy` - different values at different stages
4. **Status gates:** Non-FINAL research results may show intermediate accuracy that is not used for execution
5. **Secondary blockers:** Even if accuracy passes, other risk guards may block execution

---

## 1. ALL ACCURACY SOURCES

### 1.1 Technical Indicators Accuracy (`indicatorScore`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:175-221`
- **Calculation Method:**
  - Starts at 50 (neutral)
  - MACD alignment: +15 if matches signal, -12 if conflicts
  - RSI scoring: +12 for oversold/overbought support, -10 for resistance
  - Price vs Moving Averages: +15 if all aligned, +8 if partial, -15 if misaligned
  - VWAP alignment: +8 if matches signal
- **Range:** 0-100 (clamped)
- **Can be NaN/undefined/zero:** No (defaults to 50)
- **Weight:** 0.35 (default strategy) to 0.40 (swing/trend-follow)
- **Override potential:** No direct override, but can be affected by missing indicators

### 1.2 Market Structure Accuracy (`marketStructureScore`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:226-267`
- **Calculation Method:**
  - Starts at 50 (neutral)
  - Trend alignment: +15 if 1h/1d trends match signal
  - VWAP regime: +20 if price in correct zone, +10 if neutral
  - Proximity penalty: -20 if near resistance (BUY) or support (SELL)
- **Range:** 0-100 (clamped)
- **Can be NaN/undefined/zero:** No (defaults to 50)
- **Weight:** 0.20 (default) to 0.25 (swing/trend-follow)
- **Override potential:** No

### 1.3 Momentum Accuracy (`momentumScore`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:272-287`
- **Calculation Method:**
  - Base: `momentum.score * 100` (0-1 → 0-100 conversion)
  - Default: 50 if momentum.score is undefined
  - ATR penalty: -8 (high), -4 (medium)
  - Pattern confidence bonus: +10 * pattern.confidence
- **Range:** 0-100 (clamped)
- **Can be NaN/undefined/zero:** No (defaults to 50)
- **Weight:** 0.10 (swing) to 0.25 (scalping)
- **Override potential:** No

### 1.4 Volume Accuracy (`volumeScore`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:292-313`
- **Calculation Method:**
  - Base: 20 (low), 50 (medium), 80 (high) based on volumeStrength
  - Direction confirmation: +10 if trend matches signal
  - Divergence penalty: -10 if trend conflicts with signal
- **Range:** 0-100 (clamped)
- **Can be NaN/undefined/zero:** No (defaults to 20-80 based on volumeStrength)
- **Weight:** 0.05 (swing) to 0.20 (breakout)
- **Override potential:** No

### 1.5 News Sentiment Accuracy (`newsScore`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:318-357`
- **Calculation Method:**
  - Default: 50 if no news or provider failed
  - Aggregate sentiment: Average of all article sentiments (-1 to +1)
  - Convert to 0-100: `50 + (avgSentiment * 50)`
  - Negative keyword penalty: -25 for high-impact negative events
- **Range:** 0-100 (clamped)
- **Can be NaN/undefined/zero:** No (defaults to 50)
- **Weight:** 0.15 (scalping/breakout) to 0.20 (default/swing/trend-follow)
- **Override potential:** No

### 1.6 Risk Penalty (`riskPenalty`)
- **Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:362-379`
- **Calculation Method:**
  - ATR volatility: +4 (high), +2 (medium)
  - Volume-volatility mismatch: +2 if high ATR + low volume
  - News shock: +2 if newsScore < 30
- **Range:** 0-10 (capped)
- **Applied as:** Subtraction from final accuracy
- **Can be NaN/undefined/zero:** No (defaults to 0)
- **Override potential:** No

### 1.7 Orderbook/Whale/Volume Accuracy (Legacy - `researchEngine.ts`)
- **Location:** `dlxtrade-ws/src/services/researchEngine.ts:235-375`
- **Note:** This is used for OLD research engine, NOT deep research
- **Calculation Method:**
  - Base: 0.5 (50%)
  - Orderbook imbalance: +0.15 (strong), +0.1 (moderate), +0.05 (weak)
  - Spread analysis: +0.15 (tight), +0.1 (moderate), +0.05 (wide)
  - Volume depth: +0.15 (high), +0.1 (moderate), +0.05 (low)
  - Orderbook depth: +0.1 if > 1M
- **Range:** 0-0.95 (capped, never 100%)
- **Used for:** Legacy research only, NOT deep research

### 1.8 Fallback/Default Accuracy
- **Location:** Multiple places
- **Default values:**
  - `researchAggregator.ts:257` - `accuracy = 0` if not final
  - `researchAggregator.ts:482` - `accuracy = 0` if not final (intermediate state)
  - `accuracyEngine.ts:176` - `indicatorScore = 50` (neutral start)
  - `accuracyEngine.ts:227` - `marketStructureScore = 50` (neutral start)
- **When used:** When data is missing, providers fail, or research is not final

---

## 2. AGGREGATION LOGIC

### 2.1 Weighted Combination
**Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:125-130`

```typescript
finalAccuracy = 
  (indicatorScore * profile.indicators) +
  (marketStructureScore * profile.marketStructure) +
  (momentumScore * profile.momentum) +
  (volumeScore * profile.volume) +
  (newsScore * profile.news) - riskPenalty;
```

**Strategy Profiles:**
- **default:** indicators(0.35), marketStructure(0.20), momentum(0.15), volume(0.10), news(0.20)
- **scalping:** indicators(0.30), marketStructure(0.15), momentum(0.25), volume(0.15), news(0.15)
- **swing:** indicators(0.40), marketStructure(0.25), momentum(0.10), volume(0.05), news(0.20)
- **breakout:** indicators(0.25), marketStructure(0.20), momentum(0.20), volume(0.20), news(0.15)
- **trend-follow:** indicators(0.40), marketStructure(0.25), momentum(0.10), volume(0.05), news(0.20)

**Note:** Weights sum to 1.0, riskPenalty is subtracted (not weighted)

### 2.2 Normalization
**Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:142`

```typescript
finalAccuracy = Math.max(0, Math.min(100, Math.round(finalAccuracy * 10) / 10));
```

- **Clamping:** 0-100 range
- **Rounding:** To 1 decimal place (e.g., 85.5)
- **No flooring/ceiling:** Only min/max clamping

### 2.3 Special Rules Applied
**Location:** `dlxtrade-ws/src/services/accuracyEngine.ts:405-443`

1. **Metadata provider failure:** -2 (fixed deduction)
2. **Indicator conflicts:** -2 if MACD vs EMA trend conflict
3. **Resistance/support penalty:** -5 if near key levels
4. **Low volume + neutral momentum cap:** Max 88% if both conditions
5. **Minimum floor:** 15% if signal is BUY/SELL (prevents 0% for valid signals)

### 2.4 Hardcoded Caps
- **Maximum:** 100% (clamped at line 142)
- **Minimum:** 0% (clamped at line 142), but 15% floor for valid signals (line 439)
- **Low volume cap:** 88% (line 434)
- **No 85% cap found:** The system does NOT have a hardcoded 85% maximum

---

## 3. FINAL ACCURACY ASSIGNMENT

### 3.1 Where FINAL Accuracy is Defined
**Primary Location:** `dlxtrade-ws/src/services/researchAggregator.ts:659`

```typescript
const normalizedAccuracy = normalizeAccuracyBackend(accuracy);
```

**Normalization Function:** `dlxtrade-ws/src/services/researchAggregator.ts:649-656`
```typescript
const normalizeAccuracyBackend = (val: any): number => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return 0;
  let num = Number(val);
  if (num > 1) num = num / 100;  // Convert percentage to decimal
  return Math.max(0, Math.min(1, num));  // Clamp to 0-1
};
```

### 3.2 Exact Variable Names
- **`accuracy`** - Final normalized accuracy (0-1 decimal) in `FreeModeDeepResearchResult`
- **`snapshotAccuracy`** - Original accuracy from `accuracyEngine` (may be 0-100 or 0-1)
- **`normalizedAccuracy`** - Local variable after normalization (0-1)
- **`finalAccuracy`** - In `accuracyEngine`, this is 0-100 range before normalization

### 3.3 Moment it Becomes FINAL
**Location:** `dlxtrade-ws/src/services/researchAggregator.ts:970-975`

```typescript
if (isFinal) {
  Object.freeze(result);  // FREEZE prevents mutations
  if ((result as any).stages) Object.freeze((result as any).stages);
  if ((result as any).providersMetadata) Object.freeze((result as any).providersMetadata);
}
```

**Conditions Required:**
1. `isFinal === true` flag must be set
2. All provider stages complete (or failed)
3. Accuracy calculation completes successfully
4. Signal is determined (BUY/SELL/HOLD)

### 3.4 Missing Component Handling
- **Missing indicators:** Defaults injected (line 100)
- **Missing signal:** Defaults to HOLD (line 105)
- **Missing news:** Defaults to 50 (neutral) in `calculateNewsScore` (line 324)
- **Missing metadata:** -2 penalty applied (line 411)
- **All providers fail:** Returns minimal result with accuracy=0 (line 81)

---

## 4. EXECUTION GATE AUDIT

### 4.1 Where Execution Threshold is Checked
**Primary Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:947-960`

```typescript
const threshold = isManualApproval ? 60 : 75;
if (signal.accuracy < threshold) {
  return { allowed: false, reason: `ACCURACY_GATE: ${signal.accuracy}% < ${threshold}% threshold` };
}
```

### 4.2 Exact Comparison Used
- **Operator:** `<` (strict less than)
- **Threshold:** 75% for auto-trade, 60% for manual approval
- **Accuracy format:** Assumes percentage (0-100), NOT decimal (0-1)

**CRITICAL ISSUE:** If `signal.accuracy` is in decimal format (0.85), the comparison `0.85 < 75` will ALWAYS pass, causing incorrect execution!

### 4.3 Default Execution Threshold Value
- **Auto-trade:** 75% (0.75 decimal)
- **Manual approval:** 60% (0.60 decimal)
- **Configurable:** Yes, via `minAccuracyThreshold` in settings (defaults to 0.85)

### 4.4 Secondary Blockers After Accuracy Passes
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:917-1113`

1. **Open position exists:** Blocks if same symbol already has active trade
2. **Max concurrent trades:** Blocks if `activeTrades.size >= maxConcurrentTrades`
3. **Daily loss limit:** Blocks if `dailyPnL < -maxDailyLossAmount`
4. **Max trades per day:** Blocks if `dailyTrades >= maxTradesPerDay`
5. **Cooldown active:** Blocks if `cooldownUntil > now`
6. **Circuit breaker:** Blocks if `circuitBreaker === true`
7. **Manual override:** Blocks if `manualOverride === true`
8. **Auto-trade disabled:** Blocks if `autoTradeEnabled === false`
9. **Exchange unavailable:** Blocks if adapter is null
10. **Insufficient balance:** Blocks if equity is too low
11. **Risk guards:** Additional position sizing and leverage checks

---

## 5. STATUS AUDIT

### 5.1 PARTIAL / INTERMEDIATE / FINAL Research
**Definitions:**
- **PARTIAL:** `isFinal === false` AND `isProcessing === true` - Research in progress
- **INTERMEDIATE:** `isFinal === false` AND `isProcessing === false` - Research completed but not finalized
- **FINAL:** `isFinal === true` - Research completed and frozen

**Location:** `dlxtrade-ws/src/services/researchAggregator.ts:941-942`
```typescript
isFinal: isFinal,
isProcessing: !isFinal
```

### 5.2 How Status Affects Accuracy Usability
- **PARTIAL/INTERMEDIATE:** `accuracy = 0` (line 482, 574) - Accuracy is NOT computed
- **FINAL:** `accuracy = normalizedAccuracy` (line 659) - Accuracy is computed and normalized

**CRITICAL:** Non-FINAL research results have `accuracy = 0`, which means they CANNOT pass execution gates!

### 5.3 UI Showing Non-Final Accuracy as Final
**Location:** `frontend/src/pages/DeepResearchCore.tsx:120-137`

```typescript
if (isFinal) {
  rawAccuracy = result.result?.accuracy ?? result.accuracy ?? 0;
  // ... normalization ...
} else {
  rawAccuracy = result.result?.accuracy ?? result.accuracy ?? 0;
  // ... normalization with fallback to 0 ...
}
```

**Issue:** UI may display `result.accuracy` even if `isFinal === false`, but backend execution uses `isFinal === true` check.

---

## 6. SKIP / BLOCK AUDIT

### 6.1 All Skip Reasons Related to Accuracy
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:177-200`

1. **`ACCURACY_TOO_LOW`** - Accuracy below threshold (75% auto, 60% manual)
2. **`AUTO_TRADE_SKIPPED_LOW_ACCURACY`** - Explicit low accuracy skip

### 6.2 Cooldown Interactions
- **Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:1067-1079`
- **Effect:** Blocks ALL trades regardless of accuracy
- **Bypass:** Manual approval can bypass

### 6.3 Risk Engine Overrides
- **Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:387-500`
- **Effect:** `calculateDynamicParams` may return `skip: 'ACCURACY_BELOW_MINIMUM'` if accuracy < 75%
- **Note:** This is a SECOND accuracy check beyond the execution gate!

### 6.4 Manual / Auto-Trade Flags
- **`manualOverride`:** Blocks auto-trade (line 1092)
- **`autoTradeEnabled`:** Must be true for auto-trade (line 1102)
- **`skipConfirmationCheck`:** Bypasses some guards for manual approval

### 6.5 Exchange / Balance / Pair Guards
- **Exchange unavailable:** Blocks if adapter is null
- **Insufficient balance:** Blocks if equity < minimum
- **Invalid pair:** Blocks if symbol doesn't match pattern (e.g., must end in USDT)

---

## 7. UI vs BACKEND MISMATCH

### 7.1 What Accuracy UI Displays
**Location:** `frontend/src/pages/DeepResearchCore.tsx:186-191`

```typescript
displayAccuracyPercent = typeof normalizedAccuracy === 'number'
  ? Math.max(0, Math.min(100, Math.round(normalizedAccuracy * 100)))
  : 0;
```

**Display Logic:**
- Takes `result.result?.accuracy` or `result.accuracy`
- Normalizes: If > 1, divide by 100; else use as-is
- Converts to percentage: Multiply by 100
- Rounds to integer
- Displays as "85%", "90%", etc.

### 7.2 What Accuracy Backend Uses
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts:951`

```typescript
if (signal.accuracy < threshold) {  // threshold = 75
```

**Backend Logic:**
- Expects `signal.accuracy` in percentage format (0-100)
- Compares directly: `85 < 75` = false (passes), `74 < 75` = true (blocks)

### 7.3 Whether UI Shows Intermediate Accuracy as Final
**YES - Potential Issue:**
- UI checks `isFinal` flag but may still display accuracy from `result.accuracy`
- If `result.accuracy` exists but `isFinal === false`, UI shows it but backend won't use it
- **Location:** `frontend/src/pages/DeepResearchCore.tsx:120-137` - UI normalizes regardless of `isFinal`

---

## 8. ROOT CAUSE ANALYSIS: Why 85-95% Visible But Trade Does NOT Execute

### 8.1 Accuracy Format Mismatch
**Problem:** Backend may store accuracy as decimal (0.85) but execution gate expects percentage (85)

**Evidence:**
- `researchAggregator.ts:659` normalizes to 0-1 decimal: `normalizedAccuracy = normalizeAccuracyBackend(accuracy)`
- `autoTradeEngine.ts:951` compares as percentage: `signal.accuracy < 75`

**Impact:** If `signal.accuracy = 0.85` (decimal), comparison `0.85 < 75` passes, but if it's `85` (percentage), `85 < 75` fails.

### 8.2 Execution Threshold Higher Than Displayed
**Problem:** UI may show 85% but execution requires 75% (which should pass), OR user's `minAccuracyThreshold` is set to 85%+

**Evidence:**
- Default threshold: 75% (line 950)
- User configurable: `settings.minAccuracyThreshold` (defaults to 0.85 = 85%)
- UI shows: `displayAccuracyPercent` (line 190)

**Impact:** If user sets threshold to 90%, 85% accuracy will be blocked.

### 8.3 Non-FINAL Research Results
**Problem:** UI may display accuracy from intermediate research, but execution only uses FINAL results

**Evidence:**
- `researchAggregator.ts:482` sets `accuracy = 0` if not final
- `autoTradeEngine.ts` receives research result, but if `isFinal === false`, accuracy may be 0

**Impact:** UI shows cached/intermediate accuracy, but execution gate sees 0%.

### 8.4 Secondary Blockers
**Problem:** Accuracy passes, but other guards block execution

**Common Blockers:**
1. Daily loss limit exceeded
2. Max trades per day reached
3. Cooldown active
4. Circuit breaker triggered
5. Manual override enabled
6. Auto-trade disabled
7. Exchange unavailable
8. Insufficient balance

### 8.5 Multiple Accuracy Values
**Problem:** Different accuracy values at different stages:
- `accuracyEngine` returns 0-100 range
- `researchAggregator` normalizes to 0-1 decimal
- `autoTradeEngine` expects 0-100 percentage
- UI displays 0-100 percentage

**Impact:** Conversion errors may cause mismatches.

---

## 9. LOGGING ADDED

### 9.1 Accuracy Calculation Logs
**Location:** `dlxtrade-ws/src/services/accuracyEngine.ts`

- **Source accuracies:** Logs all 6 source scores before aggregation
- **Aggregated accuracy:** Logs weighted sum before special rules
- **After special rules:** Logs accuracy after adjustments
- **FINAL accuracy:** Logs final clamped/rounded value

### 9.2 Aggregation Point Logs
**Location:** `dlxtrade-ws/src/services/researchAggregator.ts`

- **Accuracy from engine:** Logs raw accuracy from `accuracyEngine`
- **After normalization:** Logs normalized accuracy (0-1)
- **FINAL normalized:** Logs final value ready for return

### 9.3 Execution Gate Decision Logs
**Location:** `dlxtrade-ws/src/services/autoTradeEngine.ts`

- **Gate check:** Logs accuracy vs threshold comparison
- **Pass/fail:** Logs whether gate passed or failed
- **Execution decision:** Logs final ALLOWED/BLOCKED decision

---

## 10. RECOMMENDATIONS

### 10.1 Fix Accuracy Format Consistency
- **Standardize:** Always use 0-1 decimal internally, convert to 0-100 percentage only for display
- **Execution gate:** Convert to percentage before comparison: `(signal.accuracy * 100) < threshold`

### 10.2 Add Format Validation
- **Check format:** Validate accuracy is in expected format before comparison
- **Log format:** Log accuracy format (decimal vs percentage) in execution gate

### 10.3 Enforce FINAL Status for Execution
- **Strict check:** Only allow execution if `isFinal === true`
- **Log status:** Log `isFinal` flag in execution gate check

### 10.4 Improve UI Accuracy Display
- **Show status:** Display "INTERMEDIATE" or "FINAL" badge next to accuracy
- **Warn if non-final:** Show warning if accuracy is from non-FINAL research

### 10.5 Add Comprehensive Execution Logging
- **Log all guards:** Log every guard check (not just accuracy)
- **Log final decision:** Log why trade was allowed/blocked with all guard results

---

## 11. CONCLUSION

The accuracy pipeline is complex with multiple sources, weighted aggregation, normalization steps, and execution gates. The primary issues causing "85-95% visible but no execution" are:

1. **Format mismatch:** Decimal (0.85) vs percentage (85) confusion
2. **Threshold configuration:** User may have set threshold higher than displayed accuracy
3. **Non-FINAL results:** UI may show intermediate accuracy that execution doesn't use
4. **Secondary blockers:** Accuracy passes but other guards block execution

**The logging added will help diagnose these issues in production.**

---

**End of Audit Report**

