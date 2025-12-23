# AUTO-TRADE EXECUTION SYSTEM - COMPLETE AUDIT

**Date:** Generated from codebase analysis  
**Purpose:** Explain EXACTLY when auto-trade executes, when it skips, what checks are applied, and how SL/TP/leverage/size are decided.

---

## 1. AUTO-TRADE TRIGGER FLOW

### Entry Point
- **File:** `dlxtrade-ws/src/services/backgroundResearchScheduler.ts`
- **Function:** `runUserResearchCycle()` (line ~1200)
- **Mode:** `AUTO_TRADE_RESEARCH`

### Execution Frequency
- **Default:** Every 5 minutes (configurable via `researchFrequencyMinutes`)
- **Scheduler:** `BackgroundResearchScheduler` manages user-specific intervals
- **Trigger:** Automatic background loop (independent of frontend/UI)

### Flow Sequence
1. **BackgroundResearchScheduler** calls `autoTradeEngine.runAutoTradeResearchCycleSafe(uid)`
2. **AutoTradeEngine.runAutoTradeResearchCycle()** executes:
   - Runs deep research
   - Extracts signal, accuracy, trade plan
   - Calls `executeTrade()` if conditions met
3. **executeTrade()** performs final validation and places orders

### Manual vs Background vs Scheduler
- **Manual:** User triggers via API → `executeTrade()` with `skipConfirmationCheck=true`
- **Background:** Scheduled cycle → `runAutoTradeResearchCycle()` → `executeTrade()` with `skipConfirmationCheck=false`
- **Scheduler:** `BackgroundResearchScheduler` orchestrates background cycles

---

## 2. EXECUTION ENTRY CONDITIONS

### Mandatory Conditions (ALL must pass)

#### A. System-Level Guards (`checkSystemRisk`)
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~1251)

1. **Daily Loss Limit**
   - Check: `stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= maxDailyLossAmount`
   - Default: 5% of equity (`settings.maxDailyLossPct`)
   - Bypass: Manual approval (`isManualApproval=true`)
   - Action: Triggers circuit breaker if exceeded

2. **Max Trades Per Day**
   - Check: `stats.dailyTrades >= settings.maxTradesPerDay`
   - Default: From `TradingSettings`
   - Bypass: Manual approval
   - Action: Blocks execution

3. **Cooldown**
   - Check: `config.cooldownUntil` exists and `new Date() < cooldownEnd`
   - Trigger: 2 consecutive losses → 24h cooldown
   - Bypass: Manual approval
   - Action: Blocks execution

4. **Circuit Breaker**
   - Check: `engine.circuitBreaker === true`
   - Trigger: Daily loss limit exceeded
   - Bypass: Manual approval
   - Action: Blocks execution

5. **Manual Override**
   - Check: `config.manualOverride === true`
   - Bypass: Manual approval
   - Action: Blocks execution

6. **Auto-Trade Enabled**
   - Check: `config.autoTradeEnabled === true`
   - Source: `autoTradeConfig.current.autoTradeEnabled`
   - Bypass: Manual approval
   - Action: Blocks execution

#### B. Unified Trade Decision (`makeUnifiedTradeDecision`)
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~224)

1. **Signal Check**
   - Must be: `'BUY'` or `'SELL'` (not `'HOLD'`)
   - Action: Blocks if HOLD

2. **isFinal Check**
   - Must be: `isFinal === true`
   - Action: Blocks if not final

3. **Accuracy Threshold**
   - Auto-trade: `accuracy >= 75%` (default)
   - Manual: `accuracy >= 60%` (default)
   - Conversion: If `accuracy <= 1`, treated as decimal → converted to percentage
   - Action: Blocks if below threshold

4. **Entry Zone Validation**
   - BUY: `vwapDeviation <= 2` (not near resistance)
   - SELL: `vwapDeviation >= -2` (not near support)
   - Action: Blocks if entry zone invalid

5. **Risk-Reward Gate**
   - Check: `riskRewardRatio >= 1.2`
   - Action: Blocks if RR < 1.2

6. **Volatility Guard**
   - Check: `atrPercentile < 95` (not EXTREME)
   - States: `'OK'` (allowed), `'HIGH'` (allowed), `'EXTREME'` (blocked)
   - Action: Blocks if EXTREME volatility

#### C. Position-Level Guards (`checkRiskGuards`)
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~1092)

1. **Open Position Check**
   - Check: `engine.activeTrades.has(signal.symbol) === false`
   - Action: Blocks if position already exists

2. **Max Concurrent Trades**
   - Check: `engine.activeTrades.size < config.maxConcurrentTrades`
   - Default: From config
   - Bypass: Manual approval
   - Action: Blocks if limit reached

3. **Existing Position in Symbol**
   - Check: No active trade with `status === 'FILLED'` for same symbol
   - Bypass: Manual approval
   - Action: Blocks if position exists

#### D. Exchange & Balance Checks

1. **Exchange Adapter**
   - Check: `engine.adapter` exists and initialized
   - Action: Initializes if missing, throws if fails

2. **Futures Balance**
   - Check: `equity > 0` (fetched from USDT-M Futures)
   - Fallback: Uses `equitySnapshot` or default 1000
   - Action: Uses snapshot if fetch fails

3. **Orderbook Liquidity**
   - Check: `bestBid > 0 && bestAsk > 0`
   - Action: Throws if insufficient liquidity

4. **Minimum Notional**
   - Check: `quantity * entryPrice >= 10 USDT`
   - Action: Adjusts quantity to meet minimum if equity >= 10 USDT

5. **Scalping Spread Check** (if scalping mode)
   - Check: `spreadPct <= 0.5%`
   - Action: Throws if spread too wide

---

## 3. SKIP REASONS (COMPLETE LIST)

### Research Cycle Skip Reasons
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~3191)

1. **DISABLE_AUTOTRADE env flag**
   - Condition: `process.env.DISABLE_AUTOTRADE === 'true'`
   - Log: `'Research skipped - DISABLE_AUTOTRADE env flag set'`

2. **Background tasks paused**
   - Condition: `!shouldRunBackgroundTasks()`
   - Log: `'Research skipped - background tasks paused'`

3. **Duplicate cycle execution**
   - Condition: Cycle already running in same 1-second window
   - Log: `'⏭️ [CYCLE_GUARD] BLOCKED: Duplicate auto-trade cycle execution prevented'`

4. **No research API keys**
   - Condition: No marketData or metadata keys configured
   - Reason: `AUTO_TRADE_REASONS.NO_RESEARCH_KEYS`
   - Log: `'⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for no-research-keys'`

5. **Exchange key decryption failed**
   - Condition: Exchange API key decryption fails
   - Reason: `AUTO_TRADE_REASONS.SKIPPED_EXCHANGE_UNAVAILABLE`
   - Log: `'⏭️ [AUTO_TRADE] Auto-trade research skipped due to exchange key decryption failure'`
   - Action: Disables scheduler for 30 minutes

6. **Research execution failed**
   - Condition: `runDeepResearchWithCoinSelection()` throws error
   - Log: `'❌ [AUTO_TRADE] Research execution failed'`

7. **No signal generated**
   - Condition: `researchData.results.length === 0`
   - Reason: `AUTO_TRADE_REASONS.NO_SIGNAL`
   - Log: `'⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for no-signal cycle'`

8. **FINAL guard cached result**
   - Condition: `isFinal === true && accuracy === 0 && signal === 'HOLD'`
   - Log: `'⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for FINAL guard cached result'`

### Execution Skip Reasons (`checkRiskGuards`)

1. **Unified decision blocked**
   - Reason: From `makeUnifiedTradeDecision()` (see section 2.B)
   - Log: `'[TRADE_DECISION] ... → BLOCKED (reason)'`

2. **Open position exists**
   - Reason: `OPEN_POSITION_EXISTS: ${symbol} already has an active trade`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Open position already exists'`

3. **Max concurrent trades**
   - Reason: `MAX_CONCURRENT_TRADES: ${count} >= ${limit} limit`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Max concurrent trades reached'`

4. **Daily loss limit**
   - Reason: `DAILY_LOSS_LIMIT: ${loss} >= ${maxLoss} (${pct}% of ${equity})`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Daily loss limit exceeded'`

5. **Max trades per day**
   - Reason: `MAX_TRADES_PER_DAY: ${count} >= ${limit} limit`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Max trades per day reached'`

6. **Cooldown active**
   - Reason: `COOLDOWN_ACTIVE: Trading paused until ${date} due to consecutive losses`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Cooldown active'`

7. **Circuit breaker active**
   - Reason: `CIRCUIT_BREAKER_ACTIVE: Daily loss limit exceeded`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Circuit breaker active'`

8. **Manual override active**
   - Reason: `MANUAL_OVERRIDE_ACTIVE: Trading paused by user`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Manual override active'`

9. **Auto-trade not enabled**
   - Reason: `AUTO_TRADE_DISABLED: Auto-trade is not enabled in config`
   - Log: `'⛔ [RISK_GUARDS] BLOCKED: Auto-trade is not enabled in config'`

### Position Sizing Skip Reasons (`calculateDynamicParams`)

1. **Extreme volatility**
   - Reason: `AUTO_TRADE_REASONS.EXTREME_VOLATILITY`
   - Condition: `volatilityClassification === 'extreme'`
   - Log: `'⏭️ [ACCURACY_RISK_CONFIG] Accuracy below minimum threshold (75%) - skipping trade'`

2. **Extremely negative sentiment**
   - Reason: `'EXTREMELY_NEGATIVE_SENTIMENT'`
   - Condition: `newsScore < 15`
   - Log: `'Extremely negative news detected: Skipping trade'`

3. **Accuracy below minimum**
   - Reason: `'ACCURACY_BELOW_MINIMUM'`
   - Condition: `accuracy < 75%` and no matching range in config
   - Log: `'⏭️ [ACCURACY_RISK_CONFIG] Accuracy below minimum threshold (75%) - skipping trade'`

4. **Zero or negative quantity**
   - Reason: `AUTO_TRADE_REASONS.MIN_NOTIONAL`
   - Condition: `quantity <= 0`
   - Log: `'Calculated position size is zero or negative'`

### Execution Failure Reasons

1. **TP/SL placement failed**
   - Action: Emergency close (MARKET order to close position)
   - Log: `'CRITICAL: TP/SL placement failed. Executing EMERGENCY CLOSE'`

2. **Emergency close failed**
   - Action: Position left unprotected
   - Log: `'FATAL: EMERGENCY CLOSE FAILED. Position is UNPROTECTED.'`

3. **Order placement failed**
   - Action: Trade marked as `'REJECTED'`
   - Log: `'Trade execution failed'`

---

## 4. SL / TP CALCULATION

### Calculation Function
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~729)  
**Function:** `calculateSLTP()`

### Scalping Mode (isScalping === true)

#### BUY Side
- **SL Calculation:**
  - Uses ATR if available: `atrDistance = atr / price`
  - Clamped: `0.3% - 0.8%` range, default `0.5%`
  - Hard cap: NEVER exceed `1%`
  - Formula: `stopLoss = price * (1 - slDistance)`
  - Final check: If `price - stopLoss > price * 0.01`, clamp to `1%`

- **TP Levels:**
  - TP1: `price * 1.008` (0.8%)
  - TP2: `price * 1.015` (1.5%)
  - TP3: `price * 1.022` (2.2%)

#### SELL Side
- **SL Calculation:**
  - Uses ATR if available: `atrDistance = atr / price`
  - Clamped: `0.3% - 0.8%` range, default `0.5%`
  - Hard cap: NEVER exceed `1%`
  - Formula: `stopLoss = price * (1 + slDistance)`
  - Final check: If `stopLoss - price > price * 0.01`, clamp to `1%`

- **TP Levels:**
  - TP1: `price * 0.992` (0.8% below)
  - TP2: `price * 0.985` (1.5% below)
  - TP3: `price * 0.978` (2.2% below)

### Non-Scalping Mode (Swing/Position Trading)

#### Target RR Based on Accuracy
- `accuracy >= 85%`: `targetRR = 3.0`
- `accuracy >= 80%`: `targetRR = 2.5`
- Default: `targetRR = 2.0` (min RR 1:2)

#### BUY Side
1. **SL Priority:**
   - **Priority 1:** Support level (if `supportLevel < price && supportLevel > price * 0.90`)
   - **Priority 2:** ATR-based: `price - (2.5 * atr)` (if `atr > 0`)
   - **Priority 3:** Fixed: `price * 0.985` (1.5% below)

2. **TP Calculation:**
   - `riskAmount = price - stopLoss`
   - `takeProfit = price + (riskAmount * targetRR)`

#### SELL Side
1. **SL Priority:**
   - **Priority 1:** Resistance level (if `resistanceLevel > price && resistanceLevel < price * 1.10`)
   - **Priority 2:** ATR-based: `price + (2.5 * atr)` (if `atr > 0`)
   - **Priority 3:** Fixed: `price * 1.015` (1.5% above)

2. **TP Calculation:**
   - `riskAmount = stopLoss - price`
   - `takeProfit = price - (riskAmount * targetRR)`

### Where SL/TP Comes From
- **Source:** `researchResult.result.tradePlan` (from `researchAggregator`)
- **Fields:** `entryPrice`, `stopLoss`, `takeProfit`, `takeProfit1`, `takeProfit2`, `takeProfit3`, `riskRewardRatio`
- **Fallback:** If not in trade plan, uses `calculateSLTP()` function

---

## 5. POSITION SIZE & LEVERAGE

### Position Size Calculation
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~1619)

#### Step 1: Risk-Based Sizing (Volatility-Based)
- **Risk %:** `Math.min(1.0, config.perTradeRiskPct || 1.0)` (hard cap at 1%)
- **Risk Amount:** `equity * (riskPct / 100)`
- **SL Distance:** `Math.abs(entryPrice - stopLoss)`
- **Raw Quantity:** `quantity = riskAmount / slDistance`

#### Step 2: Model-Based Sizing (`calculateDynamicParams`)
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~562)

- **Inputs:**
  - `accuracy` (0-100%)
  - `volatilityClassification` ('low' | 'high' | 'extreme')
  - `newsScore` (0-100)

- **Config Source:** `settings.accuracyRiskConfig` (user config) or system defaults

- **Matching Logic:**
  - Finds matching accuracy range: `minAccuracy <= accuracy <= maxAccuracy`
  - Returns: `sizePct` (percentage of wallet balance) and `leverage`

- **Volatility Adjustments:**
  - **HIGH:** `leverage = max(1, leverage - 2)`, `sizePct = sizePct * 0.75`
  - **EXTREME:** Skip trade (returns `sizePct = 0`)

- **News Adjustments:**
  - **newsScore < 15:** Skip trade
  - **newsScore < 30:** `sizePct = sizePct * 0.5` (reduce by 50%)

- **Model Max Quantity:** `modelMaxQuantity = (equity * (sizePct / 100)) / entryPrice`

#### Step 3: Apply Model Cap
- If `quantity > modelMaxQuantity`: `quantity = modelMaxQuantity`

#### Step 4: Apply Hard Cap (Max Position %)
- **Max Position Value:** `equity * (tradingSettings.maxPositionPct / 100)`
- **Max Quantity:** `maxPositionValue / entryPrice`
- If `quantity > maxQuantity`: `quantity = maxQuantity`

#### Step 5: Minimum Notional Check
- **Min Notional:** 10 USDT
- If `positionValue < 10 && equity >= 10`: Adjust quantity to meet minimum

#### Step 6: Manual Approval Override
- If `skipConfirmationCheck === true` and `quantity <= 0 || positionPercent <= 0.5`:
  - Force minimum: `positionPercent = min(1.0, maxPositionPct)`
  - Recalculate quantity

### Leverage Calculation
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~1644)

1. **Source:** `signal.leverage` (from research) OR `modelParams.leverage` (from `calculateDynamicParams`)
2. **Default:** `1` (no leverage)
3. **Hard Cap:** `Math.min(10, leverage)` (max 10x)
4. **Hard Floor:** `Math.max(1, leverage)` (min 1x)
5. **Volatility Reduction:** If `volatilityClassification === 'high'`: `leverage = max(1, leverage - 2)`

### Position Size Formula (Final)
```
equity = futuresBalance || equitySnapshot || 1000
riskAmount = equity * (riskPct / 100)
rawQuantity = riskAmount / slDistance
modelMaxQuantity = (equity * (sizePct / 100)) / entryPrice
quantity = min(rawQuantity, modelMaxQuantity, maxQuantity)
positionValue = quantity * entryPrice
```

---

## 6. FINAL EXECUTION STEP

### Order Placement Sequence
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~1781)

#### Step 1: Pre-Execution Setup
1. **Set Leverage:** `engine.adapter.setLeverage(symbol, leverage)`
2. **Set Margin Type:** `engine.adapter.setMarginType(symbol, 'ISOLATED')`
3. **Validate Orderbook:** Check liquidity and spread

#### Step 2: Place Entry Order
- **Type:** `MARKET`
- **Side:** `signal.signal` ('BUY' or 'SELL')
- **Quantity:** Calculated quantity
- **Result:** `orderResult` with `exchangeOrderId`, `avgPrice`, `quantity`

#### Step 3: Place TP/SL Orders

**Scalping Mode:**
- **TP1:** 50% of position at `takeProfit1` (LIMIT order)
- **TP2:** 20% of position at `takeProfit2` (LIMIT order)
- **TP3:** 30% of position at `takeProfit3` (LIMIT order, if exists)
- **SL:** Full remaining quantity at `stopLoss` (LIMIT order)

**Non-Scalping Mode:**
- **TP:** Full quantity at `takeProfit` (LIMIT order)
- **SL:** Full quantity at `stopLoss` (LIMIT order)

#### Step 4: Error Handling
- **If TP/SL placement fails:**
  - Execute EMERGENCY CLOSE (MARKET order to close position)
  - Mark trade as `'CANCELLED'`
  - Log critical error

- **If emergency close fails:**
  - Position left unprotected
  - Log fatal error
  - Throw exception

#### Step 5: Save Trade Record
- Save to `trades` collection in Firestore
- Store: `symbol`, `side`, `qty`, `entryPrice`, `orderId`, `exchange`, `status: 'open'`

#### Step 6: Update State
- Add to `engine.activeTrades` Map
- Update stats: `updateStats(uid, trade)`

#### Step 7: Notifications
- **Auto-trade alert:** If `autoTradeEnabled && notifications.autoTradeAlerts`
- **Telegram execution alert:** If Telegram configured

---

## 7. POST-EXECUTION

### Trade Monitoring
**File:** `dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~2750)  
**Function:** `monitorActiveTrades()`

- **Frequency:** Called every cycle (every 5 minutes)
- **Checks:**
  1. TP order status (FILLED = close trade)
  2. SL order status (FILLED = close trade)
  3. Orphan protection (if both TP/SL inactive, log warning)

### Trade Closure
- **Trigger:** TP or SL order FILLED
- **Actions:**
  1. Remove from `engine.activeTrades`
  2. Update stats (PnL calculation)
  3. **Loss Streak Tracking:**
     - If SL hit: `consecutiveLosses++`
     - If `consecutiveLosses >= 2`: Enter 24h cooldown
     - If TP hit: Reset `consecutiveLosses = 0`
  4. Send Telegram closed alert
  5. Log `TRADE_CLOSED` event

### Cooldown Management
- **Trigger:** 2 consecutive losses
- **Duration:** 24 hours
- **Storage:** `config.cooldownUntil` (Date)
- **Bypass:** Manual approval

### Stats Update
- **Daily PnL:** Updated on trade close
- **Daily Trades:** Incremented on execution
- **Total PnL:** Cumulative tracking
- **Winning/Losing Trades:** Counted on close

---

## 8. EDGE CASES

### Price Movement Before Order
- **Entry Order:** Uses MARKET order → fills at current price
- **TP/SL Orders:** Uses LIMIT orders → may not fill if price moves away
- **Monitoring:** `monitorActiveTrades()` checks order status periodically

### SL/TP Placement Failure
- **Action:** Emergency close (MARKET order to close position immediately)
- **Log:** `'CRITICAL: TP/SL placement failed. Executing EMERGENCY CLOSE'`
- **Trade Status:** Marked as `'CANCELLED'`

### Exchange Rejects Order
- **Action:** Trade marked as `'REJECTED'`
- **Log:** `'Trade execution failed'`
- **Event:** `TRADE_FAILED` logged

### Balance Changes Mid-Cycle
- **Equity Fetch:** Happens at execution time (not cycle start)
- **Source:** USDT-M Futures balance (real-time)
- **Fallback:** Uses `equitySnapshot` if fetch fails

### Duplicate Cycle Execution
- **Protection:** 1-second window lock (`cycleId = uid_timestamp`)
- **Action:** Returns `null` if cycle already running
- **Log:** `'⏭️ [CYCLE_GUARD] BLOCKED: Duplicate auto-trade cycle execution prevented'`

### Exchange Key Decryption Failure
- **Action:** Disables scheduler for 30 minutes
- **Log:** `'❌ [DECRYPTION_FAILURE] Exchange key decryption failed - disabling scheduler'`
- **User Action Required:** Re-enter exchange API keys

### Zero Quantity Calculation
- **Check:** `quantity <= 0`
- **Action:** Throws error: `'Calculated position size is zero or negative'`
- **Manual Override:** Forces minimum 1% if `skipConfirmationCheck === true`

---

## 9. FINAL OUTPUT - SIMPLE FLOW

### Auto-trade WILL execute when:
✅ **System Checks:**
- `autoTradeEnabled === true`
- `manualOverride === false`
- `circuitBreaker === false`
- `cooldownUntil` not active (or manual approval)
- `dailyPnL` not exceeded (or manual approval)
- `dailyTrades < maxTradesPerDay` (or manual approval)

✅ **Unified Decision:**
- Signal is `'BUY'` or `'SELL'` (not `'HOLD'`)
- `isFinal === true`
- `accuracy >= 75%` (auto-trade) or `>= 60%` (manual)
- Entry zone valid (BUY: `vwapDeviation <= 2`, SELL: `vwapDeviation >= -2`)
- `riskRewardRatio >= 1.2`
- Volatility not EXTREME (`atrPercentile < 95`)

✅ **Position Checks:**
- No open position in same symbol
- `activeTrades.size < maxConcurrentTrades` (or manual approval)

✅ **Exchange & Balance:**
- Exchange adapter initialized
- Futures balance > 0 (or snapshot available)
- Orderbook has liquidity
- Minimum notional met (10 USDT)

✅ **Execution:**
- `shouldExecute === true` (auto-trade enabled OR manual approval)
- Quantity > 0
- Order placement succeeds
- TP/SL orders placed successfully

### Auto-trade WILL NOT execute when:
❌ **Research Cycle Blocked:**
- `DISABLE_AUTOTRADE === 'true'` (env flag)
- Background tasks paused
- Duplicate cycle detected
- No research API keys
- Exchange key decryption failed
- Research execution failed
- No signal generated

❌ **Unified Decision Blocked:**
- Signal is `'HOLD'`
- `isFinal !== true`
- `accuracy < 75%` (auto-trade) or `< 60%` (manual)
- Entry zone invalid (BUY near resistance, SELL near support)
- `riskRewardRatio < 1.2`
- Volatility EXTREME (`atrPercentile >= 95`)

❌ **System Guards Blocked:**
- `autoTradeEnabled === false`
- `manualOverride === true`
- `circuitBreaker === true`
- Cooldown active (2 consecutive losses → 24h)
- Daily loss limit exceeded
- Max trades per day reached

❌ **Position Guards Blocked:**
- Open position exists in same symbol
- Max concurrent trades reached (and not manual approval)

❌ **Position Sizing Blocked:**
- Extreme volatility (`volatilityClassification === 'extreme'`)
- Extremely negative sentiment (`newsScore < 15`)
- Accuracy below minimum (`accuracy < 75%` and no config match)
- Quantity <= 0

❌ **Execution Blocked:**
- Exchange adapter not initialized
- Futures balance = 0 (and no snapshot)
- Orderbook insufficient liquidity
- Minimum notional not met
- Spread too wide (scalping mode: `> 0.5%`)
- Order placement failed
- TP/SL placement failed (emergency close executed)

---

## 10. USER-FRIENDLY EXPLANATION

**"User ke liye trade kab lagega aur kab nahi"**

### Trade LAGEGA (Will Execute) Jab:
1. **Research Complete:** Deep research successfully completed with FINAL result
2. **Signal Strong:** BUY ya SELL signal (HOLD nahi)
3. **Accuracy High:** 75% ya usse zyada accuracy (auto-trade ke liye)
4. **Entry Zone Safe:** BUY resistance ke paas nahi, SELL support ke paas nahi
5. **Risk-Reward Good:** RR 1.2 ya usse zyada
6. **Volatility Normal:** Extreme volatility nahi hai
7. **No Open Position:** Same coin mein pehle se position nahi hai
8. **System Healthy:** Daily loss limit, cooldown, circuit breaker sab OK
9. **Exchange Ready:** API keys sahi, balance available, liquidity hai

### Trade NAHI LAGEGA (Will NOT Execute) Jab:
1. **Research Failed:** Research complete nahi hui ya error aaya
2. **Signal Weak:** HOLD signal ya accuracy kam hai
3. **Entry Zone Bad:** BUY resistance ke paas hai ya SELL support ke paas hai
4. **Risk-Reward Low:** RR 1.2 se kam hai
5. **Volatility Extreme:** Market bahut volatile hai (ATR percentile >= 95)
6. **Position Exists:** Same coin mein pehle se position hai
7. **System Limits:** Daily loss limit hit, cooldown active, ya max trades reached
8. **Exchange Issues:** API keys decrypt nahi ho rahe, balance zero, ya liquidity nahi hai
9. **Auto-Trade Off:** User ne auto-trade disable kar diya hai

---

## 11. KEY FILES & FUNCTIONS

### Core Files
- **`dlxtrade-ws/src/services/autoTradeEngine.ts`**
  - `runAutoTradeResearchCycle()` - Main cycle entry
  - `executeTrade()` - Trade execution
  - `checkRiskGuards()` - Risk validation
  - `checkSystemRisk()` - System-level checks
  - `calculateDynamicParams()` - Position size & leverage
  - `calculateSLTP()` - SL/TP calculation
  - `monitorActiveTrades()` - Post-execution monitoring

- **`dlxtrade-ws/src/services/backgroundResearchScheduler.ts`**
  - `runUserResearchCycle()` - Scheduler entry point
  - Orchestrates research cycles

- **`dlxtrade-ws/src/services/autoTradeEngine.ts` (line ~224)**
  - `makeUnifiedTradeDecision()` - Unified validation logic

### Key Constants
- **`AUTO_TRADE_REASONS`** - All skip reason codes
- **`DEFAULT_CONFIG`** - Default auto-trade configuration
- **`RESEARCH_MODE`** - Research execution modes

---

**END OF AUDIT**

