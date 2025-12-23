# Auto-Trade Execution Flow Analysis

## Executive Summary

This document provides a comprehensive analysis of why Auto-Trade may not be executing trades even when Auto-Trade mode is ON.

## Execution Flow

### 1. UI → Backend → Firestore

**Path:**
- UI: User toggles Auto-Trade ON
- Frontend: `POST /api/auto-trade/config` with `{ autoTradeEnabled: true }`
- Backend: `autoTradeRoutes.post('/config')` → `autoTradeEngine.saveConfig(uid, body)`
- Firestore: `users/{uid}/autoTradeConfig/current` document updated

**Critical Checkpoints:**
- ✅ Config is saved to Firestore with `autoTradeEnabled: true`
- ✅ Config is loaded via `loadConfig(uid)` which reads from Firestore
- ⚠️ **POTENTIAL ISSUE**: In-memory config may be stale if not refreshed after save

### 2. Scheduler → Research Cycle

**Path:**
- `BackgroundResearchScheduler.updateUserResearchSchedule(uid)` checks:
  - `autoTradeConfig.autoTradeEnabled === true` → Sets mode to `AUTO_TRADE_RESEARCH`
  - If mode is `AUTO_TRADE_RESEARCH`, scheduler runs `processUserResearch(uid)`
  - `processUserResearch` calls `autoTradeEngine.runAutoTradeResearchCycleSafe(uid)`

**Critical Checkpoints:**
- ✅ Scheduler checks Firestore config directly (not in-memory)
- ✅ Mode must be `AUTO_TRADE_RESEARCH` for auto-trade execution
- ⚠️ **POTENTIAL ISSUE**: If exchange APIs missing, scheduler may switch to `TELEGRAM_ONLY` mode

### 3. Research Cycle → Signal Generation

**Path:**
- `runAutoTradeResearchCycle(uid)` runs deep research
- Research generates signal (BUY/SELL/HOLD) and accuracy (0-100%)
- Signal is validated: `accuracy >= 75%` AND `signal !== 'HOLD'`

**Critical Checkpoints:**
- ✅ Accuracy must be >= 75% (hard rule)
- ✅ Signal must be BUY or SELL (not HOLD)
- ✅ Trade plan must exist with entryPrice, stopLoss, takeProfit

### 4. Risk Guards → Execution Decision

**Path:**
- `checkRiskGuards(uid, signal, isManualApproval=false)` checks:
  1. **Accuracy Gate**: `accuracy >= 75%` (already checked, but double-checked)
  2. **Open Position**: No existing position in same symbol
  3. **Daily Loss Limit**: `dailyPnL` not exceeding `maxDailyLossPct`
  4. **Max Trades Per Day**: `dailyTrades < maxTradesPerDay`
  5. **Position Sizing**: Position size > 0% (based on accuracy)
  6. **Cooldown**: No active cooldown period
  7. **High-Impact News**: No high-impact news detected
  8. **Circuit Breaker**: Circuit breaker not active
  9. **Manual Override**: `manualOverride !== true`
  10. **Auto-Trade Enabled**: `config.autoTradeEnabled === true` ⚠️ **CRITICAL**
  11. **Max Concurrent Trades**: `activeTrades.size < maxConcurrentTrades`
  12. **Existing Position**: No FILLED trade in same symbol

**Critical Checkpoints:**
- ⚠️ **BLOCKING CONDITION #1**: `config.autoTradeEnabled === false`
- ⚠️ **BLOCKING CONDITION #2**: `config.manualOverride === true`
- ⚠️ **BLOCKING CONDITION #3**: `engine.circuitBreaker === true`
- ⚠️ **BLOCKING CONDITION #4**: `accuracy < 75%`
- ⚠️ **BLOCKING CONDITION #5**: `positionSizing.positionPercent <= 0`

### 5. Execute Trade → Order Placement

**Path:**
- `executeTrade(uid, signal, skipConfirmationCheck=false)` is called
- Checks: `shouldExecute = (config.autoTradeEnabled && !config.manualOverride) || skipConfirmationCheck`
- If `shouldExecute === true`:
  - Initialize exchange adapter
  - Fetch futures balance
  - Calculate position size
  - Set leverage
  - Place order on exchange

**Critical Checkpoints:**
- ⚠️ **BLOCKING CONDITION #6**: `config.autoTradeEnabled === false` (checked again)
- ⚠️ **BLOCKING CONDITION #7**: `config.manualOverride === true` (checked again)
- ⚠️ **BLOCKING CONDITION #8**: Exchange adapter not initialized
- ⚠️ **BLOCKING CONDITION #9**: Futures balance fetch fails
- ⚠️ **BLOCKING CONDITION #10**: Position size calculation fails

## Root Cause Analysis

### Most Likely Blocking Conditions

1. **Config Sync Issue** (HIGH PROBABILITY)
   - In-memory config may be stale after UI save
   - `loadConfig()` reads from Firestore, but engine may use cached config
   - **Fix**: Always load fresh config in `executeTrade()` (already implemented)

2. **Auto-Trade Not Enabled in Config** (HIGH PROBABILITY)
   - Config may be saved as `false` due to UI state sync issue
   - Firestore document may not exist (defaults to `false`)
   - **Fix**: Verify Firestore document exists and `autoTradeEnabled === true`

3. **Manual Override Active** (MEDIUM PROBABILITY)
   - User may have manually paused trading
   - `manualOverride` flag may be set to `true`
   - **Fix**: Check `config.manualOverride` in diagnostics

4. **Accuracy Below Threshold** (MEDIUM PROBABILITY)
   - Research may generate signals with accuracy < 75%
   - **Fix**: Check research results and accuracy calculation

5. **Position Sizing Returns 0%** (LOW PROBABILITY)
   - Accuracy may be in range but position sizing map returns 0%
   - **Fix**: Check `positionSizingMap` configuration

## Diagnostic Logging Added

All blocking conditions now log with prefix:
- `🔍 [RISK_GUARDS]` - Risk guard checks
- `⛔ [RISK_GUARDS] BLOCKED:` - Trade blocked by guard
- `✅ [RISK_GUARDS]` - All guards passed
- `🔍 [EXECUTE_TRADE]` - Execute trade entry
- `⛔ [EXECUTE_TRADE]` - Trade execution blocked
- `✅ [EXECUTE_TRADE]` - Trade execution proceeding
- `🎯 [RESEARCH_CYCLE]` - Research cycle accuracy gate
- `⛔ [RESEARCH_CYCLE] BLOCKED:` - Research cycle blocked

## Next Steps

1. **Check Logs**: Review server logs for `[RISK_GUARDS]` and `[EXECUTE_TRADE]` entries
2. **Verify Firestore**: Check `users/{uid}/autoTradeConfig/current` document
3. **Check Scheduler Mode**: Verify scheduler is in `AUTO_TRADE_RESEARCH` mode
4. **Verify Research Results**: Check if research is generating signals with accuracy >= 75%
5. **Check Exchange APIs**: Verify exchange adapter is initialized and working

## Fixes Applied

1. ✅ Added comprehensive logging at all guard points
2. ✅ Added config sync check (in-memory vs Firestore)
3. ✅ Added fresh config load before execution
4. ✅ Added diagnostic logging for execution decision
5. ✅ Added logging for all blocking conditions

## Testing Checklist

- [ ] Verify `autoTradeEnabled` is saved to Firestore when toggled ON
- [ ] Verify scheduler mode is `AUTO_TRADE_RESEARCH` when auto-trade is enabled
- [ ] Verify research cycle runs and generates signals
- [ ] Verify accuracy >= 75% for generated signals
- [ ] Verify all risk guards pass
- [ ] Verify `executeTrade` is called with `shouldExecute === true`
- [ ] Verify exchange adapter is initialized
- [ ] Verify order is placed on exchange

