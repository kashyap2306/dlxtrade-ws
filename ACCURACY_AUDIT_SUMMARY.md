# ACCURACY PIPELINE AUDIT - EXECUTIVE SUMMARY

## Why 85-95% Accuracy Visible But Trade Does NOT Execute

### Root Causes (Verified from Code)

1. **Accuracy Format Mismatch**
   - Backend stores accuracy as **decimal (0.85)** in `researchAggregator.ts`
   - Execution gate expects **percentage (85)** in `autoTradeEngine.ts`
   - Comparison: `0.85 < 75` passes (wrong), `85 < 75` fails (correct)
   - **Fix needed:** Convert to percentage before comparison

2. **User Threshold Configuration**
   - Default threshold: **75%** for auto-trade
   - User configurable: `minAccuracyThreshold` (defaults to **0.85 = 85%**)
   - If user sets threshold to **90%**, 85% accuracy will be blocked
   - **Check:** User's `minAccuracyThreshold` setting

3. **Non-FINAL Research Results**
   - UI may display accuracy from **intermediate** research
   - Execution **only uses FINAL** results (`isFinal === true`)
   - Non-FINAL results have `accuracy = 0` (line 482 in `researchAggregator.ts`)
   - **Impact:** UI shows cached accuracy, execution sees 0%

4. **Secondary Blockers (Accuracy Passes But Other Guards Block)**
   - Daily loss limit exceeded
   - Max trades per day reached
   - Cooldown active
   - Circuit breaker triggered
   - Manual override enabled
   - Auto-trade disabled
   - Exchange unavailable
   - Insufficient balance

5. **Multiple Accuracy Values**
   - `accuracyEngine` returns: **0-100 range**
   - `researchAggregator` normalizes to: **0-1 decimal**
   - `autoTradeEngine` expects: **0-100 percentage**
   - UI displays: **0-100 percentage**
   - **Issue:** Conversion errors between stages

---

## What Accuracy Actually Matters for Execution

**The accuracy that matters:** `signal.accuracy` in `autoTradeEngine.ts:951`

**Format expected:** Percentage (0-100), NOT decimal (0-1)

**Comparison:** `signal.accuracy < threshold` where `threshold = 75` (auto) or `60` (manual)

**Source:** This comes from `FreeModeDeepResearchResult.accuracy` which should be normalized to 0-1 decimal, but execution gate expects 0-100 percentage.

---

## Accuracy Calculation Pipeline

### Sources (6 components):
1. **Indicator Score** (35% weight) - MACD, RSI, Moving Averages, VWAP
2. **Market Structure** (20% weight) - Trend alignment, VWAP regime
3. **Momentum** (15% weight) - Momentum score, ATR, patterns
4. **Volume** (10% weight) - Volume trend, strength
5. **News Sentiment** (20% weight) - News articles sentiment
6. **Risk Penalty** (subtracted) - Volatility, conflicts, news shocks

### Aggregation:
```
finalAccuracy = 
  (indicatorScore * 0.35) +
  (marketStructureScore * 0.20) +
  (momentumScore * 0.15) +
  (volumeScore * 0.10) +
  (newsScore * 0.20) - riskPenalty
```

### Normalization:
- Clamped to 0-100 range
- Rounded to 1 decimal place
- Then normalized to 0-1 decimal for storage

---

## Logging Added

All accuracy calculations, aggregations, and execution gate decisions now log:
- Source accuracies before aggregation
- Aggregated accuracy after weights
- Accuracy after special rules
- FINAL accuracy assignment
- Execution gate check (accuracy vs threshold)
- Execution decision (ALLOWED/BLOCKED)

**Log tags:** `[ACCURACY_AUDIT]` for easy filtering

---

## Recommendations

1. **Fix format consistency:** Always use 0-1 decimal internally, convert to percentage only for display/comparison
2. **Add format validation:** Check accuracy format before execution gate comparison
3. **Enforce FINAL status:** Only allow execution if `isFinal === true`
4. **Improve UI:** Show "INTERMEDIATE" badge for non-FINAL accuracy
5. **Comprehensive logging:** Log all guard checks, not just accuracy

---

**Full detailed report:** See `ACCURACY_PIPELINE_AUDIT_REPORT.md`

