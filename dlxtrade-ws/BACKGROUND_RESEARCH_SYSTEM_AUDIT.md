# Complete Working Logic: Telegram Background Research & Auto Trade Mode

## System Architecture Overview

**Single Scheduler System**: `BackgroundResearchScheduler` is the ONLY scheduler that runs background deep research. It operates in two mutually exclusive modes:

1. **TELEGRAM_BACKGROUND_RESEARCH**: Alert-only mode (no trade execution)
2. **AUTO_TRADE_RESEARCH**: Auto-trade execution mode (priority, overrides Telegram)

**Key Invariant**: Only ONE scheduler interval per user exists at any time. Mode is determined by priority check in `updateUserResearchSchedule()`.

---

## A) TELEGRAM BACKGROUND RESEARCH ONLY - Complete Execution Flow

### Step 1: User Enables Telegram Background Research

**Route**: `POST /api/background-research/settings/save`

**Validation Sequence**:
1. **Zod Schema Validation** (lines 49-67 in backgroundResearch.ts):
   - Validates: `backgroundResearchEnabled: boolean`, `researchFrequencyMinutes: 1-30`, `accuracyTrigger: 60-95`
   - Returns 400 if validation fails (NOT 500)

2. **Primary API Validation** (lines 72-103):
   - Checks: `getUserIntegrationsByUid(uid)` 
   - Validates: `CryptoCompare.enabled === true && CryptoCompare.apiKey exists`
   - Validates: `NewsData.enabled === true && NewsData.apiKey exists`
   - **CRITICAL**: If either missing → returns HTTP 400 with "Primary APIs Required"
   - If both present → proceeds to save

3. **Telegram Credentials Validation** (lines 106-112):
   - Checks: `telegramBotToken` and `telegramChatId` are provided
   - Returns 400 if missing when `backgroundResearchEnabled === true`

4. **Firestore Save** (lines 116-133):
   - Saves to: `users/{uid}/settings/backgroundResearch`
   - Uses `merge: true` (creates document if missing)
   - Fields saved: `backgroundResearchEnabled: true`, `researchFrequencyMinutes`, `accuracyTrigger`, `telegramBotToken`, `telegramChatId`

5. **Scheduler Notification** (lines 138-149):
   - Calls: `backgroundResearchScheduler.onUserSettingsChanged(uid)`
   - **Non-blocking**: Uses `setImmediate()` for fire-and-forget
   - **CRITICAL**: Scheduler failure does NOT affect API response

### Step 2: Scheduler Registration (updateUserResearchSchedule)

**Location**: `backgroundResearchScheduler.ts:213-371`

**Execution Sequence**:

1. **Mode Detection** (lines 222-280):
   ```typescript
   // Check Auto Trade config FIRST (highest priority)
   const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;
   const telegramBgResearchEnabled = settings?.backgroundResearchEnabled === true;
   
   if (autoTradeEnabled) {
     // AUTO_TRADE_RESEARCH mode (skipped in this scenario)
   } else if (telegramBgResearchEnabled) {
     // TELEGRAM_BACKGROUND_RESEARCH mode ← THIS PATH
     mode = RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH;
     finalFrequency = settings?.researchFrequencyMinutes || 5;
   }
   ```

2. **API Validation** (lines 266-272):
   - Calls: `hasRequiredPrimaryAPIs(uid)`
   - Validates: CryptoCompare AND NewsData (both must be enabled with API keys)
   - If missing → calls `disableUserScheduler(uid)` and returns (no interval created)

3. **Frequency Validation** (lines 282-287):
   - Validates: `finalFrequency > 0`
   - If invalid → disables scheduler and returns

4. **Interval Creation** (lines 293-340):
   - Calculates: `intervalMs = finalFrequency * 60 * 1000`
   - Checks if existing interval exists for this user
   - If frequency unchanged → keeps existing interval
   - If frequency changed or no interval → creates new `safeSetInterval()`
   - Stores interval in: `this.userIntervals.set(uid, userInterval)`
   - Stores state in: `this.userJobStates.set(uid, { mode: 'TELEGRAM_BACKGROUND_RESEARCH', ... })`

5. **Immediate Execution** (lines 348-366):
   - If `lastRunAt` is null or `nextRunAt <= now` → runs immediately (with random 0-2s delay)

### Step 3: Scheduled Research Execution (processUserResearch)

**Location**: `backgroundResearchScheduler.ts:442-920`

**Execution Sequence (Every `researchFrequencyMinutes`)**:

1. **Duplicate Prevention** (lines 445-449):
   - Checks: `jobState?.isRunning === true`
   - If running → logs warning and returns (prevents concurrent execution)

2. **Mode Validation** (lines 470-516):
   - Reads mode from: `jobState.mode` (stored during registration)
   - Validates mode is still valid:
     - If `mode === AUTO_TRADE_RESEARCH` but `autoTradeEnabled === false` → disables scheduler
     - If `mode === TELEGRAM_BACKGROUND_RESEARCH` but `telegramBgResearchEnabled === false` → disables scheduler
   - **CRITICAL**: Re-validates APIs based on mode:
     - Telegram mode: Requires CryptoCompare AND NewsData
     - Auto-trade mode: Requires exchange APIs AND primary APIs

3. **Research Execution** (line 541):
   ```typescript
   const deepResearchResult = await autoTradeEngine.runAutoTradeResearchCycleSafe(uid);
   ```
   - **DELEGATION**: Calls AutoTradeEngine (even in Telegram mode)
   - AutoTradeEngine runs full deep research
   - AutoTradeEngine stores history with `source: 'AUTO_TRADE'` (line 2781 in autoTradeEngine.ts)
   - Returns: `ResearchDataResult | null`

4. **Result Processing** (lines 549-826):

   **If `deepResearchResult === null`** (no signal):
   - Logs: "Research cycle completed - no signal generated"
   - Stores history with `source: 'TELEGRAM_BACKGROUND'` (lines 553-568):
     ```typescript
     {
       symbol: 'UNKNOWN',
       signal: 'HOLD',
       accuracy: 0,
       source: 'TELEGRAM_BACKGROUND',
       skipReason: 'No signal generated'
     }
     ```
   - Updates: `jobState.lastRunAt = now`, `jobState.isRunning = false`
   - **CRITICAL**: Research cycle completed successfully (accuracy doesn't matter)

   **If `deepResearchResult !== null`** (signal generated):
   - Extracts: `finalAccuracy`, `signal`, `tradePlan` from result
   - **Accuracy Trigger Evaluation** (lines 619-631):
     - Calculates: `isInRange = (finalAccuracy >= minTrigger && finalAccuracy <= maxTrigger)`
     - **CRITICAL**: This is POST-RESEARCH evaluation (accuracy is output, not gate)
     - Research already ran regardless of accuracy

5. **Telegram Alert Logic** (lines 637-785):
   - **Only executes if**: `mode === TELEGRAM_BACKGROUND_RESEARCH && isInRange === true`
   - **Spam Prevention** (lines 646-651):
     - Calls: `shouldSendTelegramAlert(lastAlert, currentAccuracy, now)`
     - Rule: Re-alert ONLY if `currentAccuracy > lastAlert.accuracy` (improvement required)
     - Cooldown is time-based but secondary to accuracy improvement
   - **Telegram Guards** (lines 654-657):
     - Checks: `telegramEnabled !== false`, `hasBotToken`, `hasChatId`
   - **Message Format** (lines 672-725):
     - If `signal === 'HOLD'`: Shows HOLD message with no prices
     - If `signal === 'BUY'/'SELL'`: Shows full trade plan (Entry, SL, TP1, TP2, TP3)
   - **History Storage** (lines 801-825):
     - **CRITICAL**: Stores history AGAIN with `source: 'TELEGRAM_BACKGROUND'`
     - This OVERWRITES the `source: 'AUTO_TRADE'` entry from AutoTradeEngine
     - Reason: AutoTradeEngine always stores with `source: 'AUTO_TRADE'`, but we need correct source for Telegram mode

6. **State Update** (lines 828-863):
   - Calculates: `nextRunAt = now + (frequencyMinutes * 60 * 1000)`
   - Updates Firestore: `lastRunAt`, `nextRunAt`, `lastAccuracy`
   - Updates in-memory: `jobState.lastRunAt`, `jobState.nextRunAt`, `jobState.isRunning = false`

### Step 4: What Happens with Low Accuracy or HOLD Signal

**Low Accuracy (< accuracyTrigger)**:
- Research **STILL RUNS** (accuracy is output, not prerequisite)
- History is stored with actual accuracy value
- Telegram alert is **NOT sent** (lines 637: only if `isInRange === true`)
- `lastRunAt` is **STILL UPDATED** (research cycle completed)
- Next research runs at scheduled interval (accuracy doesn't affect scheduling)

**HOLD Signal**:
- Research **STILL RUNS**
- History stored with `signal: 'HOLD'`
- If accuracy >= trigger → Telegram sends HOLD message (lines 672-682)
- If accuracy < trigger → No Telegram alert
- `lastRunAt` **STILL UPDATED**

**Key Guarantee**: Research cycle **NEVER** stops due to accuracy or signal. Scheduler continues at configured interval.

### Step 5: Parts NOT Used in Telegram Mode

- **AutoTradeEngine.executeTrade()**: Never called (only research runs)
- **AutoTradeEngine trade execution gates**: Not evaluated
- **Exchange APIs**: Not required (only primary APIs needed)
- **Trade history/logs**: No trade execution logs
- **Auto-trade activity logs**: Only research logs, no trade execution logs

---

## B) USER ENABLES AUTO TRADE WHILE TELEGRAM IS ON - Transition Flow

### Step 1: User Enables Auto Trade

**Route**: `POST /api/trading/autotrade/toggle` or `POST /api/auto-trade/start`

**Execution**: `autoTradeEngine.startAutoTradeLoop(uid, researchFrequencyMinutes?)` (line 2467)

**Sequence**:

1. **Frequency Resolution** (lines 2474-2476):
   ```typescript
   const existingBgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
   const finalFrequency = researchFrequencyMinutes || existingBgSettings?.researchFrequencyMinutes || 5;
   ```
   - Uses provided frequency OR existing Telegram frequency OR defaults to 5

2. **Firestore Updates** (lines 2478-2490):
   - **autoTradeConfig** (line 2479):
     ```typescript
     {
       autoTradeEnabled: true,
       updatedAt: Timestamp.now()
     }
     ```
   - **backgroundResearchSettings** (line 2486):
     ```typescript
     {
       backgroundResearchEnabled: true,  // Still true (scheduler needs this)
       researchFrequencyMinutes: finalFrequency,
       updatedAt: Timestamp.now()
     }
     ```
   - **CRITICAL**: Both flags are set to `true` (scheduler uses mode detection, not flags)

3. **Scheduler Notification** (line 2494):
   ```typescript
   await backgroundResearchScheduler.onUserSettingsChanged(uid);
   ```
   - Triggers: `updateUserResearchSchedule(uid)`

### Step 2: Scheduler Mode Transition (updateUserResearchSchedule)

**Location**: `backgroundResearchScheduler.ts:213-371`

**Execution Sequence**:

1. **Mode Detection** (lines 222-280):
   ```typescript
   const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;  // NOW TRUE
   const telegramBgResearchEnabled = settings?.backgroundResearchEnabled === true;  // STILL TRUE
   
   if (autoTradeEnabled) {  // ← THIS PATH NOW EXECUTES
     mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;  // Mode changes
     finalFrequency = settings?.researchFrequencyMinutes || 5;
   }
   // Telegram path is SKIPPED (autoTradeEnabled check is first)
   ```

2. **API Validation** (lines 243-257):
   - **NEW REQUIREMENTS**: 
     - `hasUsableExchangeAPIs(uid)` → Must have exchange (Binance/Bitget/BingX/WEEX)
     - `hasUsableMarketDataProviders(uid)` → Must have primary APIs
   - If missing → disables scheduler and returns

3. **Interval Replacement** (lines 295-312):
   - **CRITICAL**: Checks if existing interval exists
   - If exists → `clearInterval(existingInterval)` (cancels Telegram mode interval)
   - Deletes: `this.userIntervals.delete(uid)`
   - Creates NEW interval with same frequency but different mode
   - **State Update** (lines 324-325):
     ```typescript
     (existingState as any).mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;  // Mode changed
     ```

### Step 3: What Gets Disabled/Overridden

**Telegram Background Research Logic**:
- **Telegram alert code** (lines 637-785): **SKIPPED** (mode check fails)
- **Telegram history storage** (lines 801-825): **SKIPPED** (mode check fails)
- **Telegram-specific validation**: Still runs but mode is AUTO_TRADE_RESEARCH

**What Continues**:
- **Same scheduler interval**: Uses existing frequency (no interruption)
- **Same research execution**: Still calls `autoTradeEngine.runAutoTradeResearchCycleSafe()`
- **Same deep research**: Full research still runs

**What Changes**:
- **Mode stored in state**: `jobState.mode = 'AUTO_TRADE_RESEARCH'`
- **History source**: Now `source: 'AUTO_TRADE'` (from AutoTradeEngine, not overwritten)
- **Trade execution**: Now evaluated and executed if conditions met
- **Notifications**: Now from AutoTradeEngine (trade execution logs)

### Step 4: Research Execution in Auto Trade Mode

**Location**: `backgroundResearchScheduler.ts:442` → `autoTradeEngine.ts:2639`

**Execution Flow**:

1. **Scheduler Calls** (line 541):
   ```typescript
   const deepResearchResult = await autoTradeEngine.runAutoTradeResearchCycleSafe(uid);
   ```

2. **AutoTradeEngine Research Cycle** (autoTradeEngine.ts:2639-2936):

   **a) Research Execution** (lines 2684-2708):
   - Runs: `runDeepResearchWithCoinSelection(uid, settings, undefined, integrations)`
   - If no results → stores history with `source: 'AUTO_TRADE'`, returns null
   - If results → extracts signal, accuracy, tradePlan

   **b) History Storage** (lines 2760-2804):
   - **ALWAYS stores** (even if no trade executed):
     ```typescript
     {
       symbol: researchResult.symbol,
       signal: finalSignal,
       accuracy: storedAccuracy,
       price: historyPrice,
       tradePlan: finalTradePlan,
       source: 'AUTO_TRADE'  // ← Correct source
     }
     ```
   - **CRITICAL**: History stored BEFORE trade evaluation

   **c) Trade Execution Gates** (lines 2806-2913):
   - **Gate 1**: `accuracy >= 75%` (line 2810) → If fails, returns researchResult (no trade)
   - **Gate 2**: `signal !== 'HOLD'` (line 2817) → If fails, returns researchResult (no trade)
   - **Gate 3**: Dynamic params check (line 2833) → If `params.skip`, returns researchResult
   - **Gate 4**: Final accuracy check (line 2892) → Double-check before execution
   - **If all pass**: Calls `executeTrade(uid, tradeSignal)` (line 2915)

   **d) Activity Logging**:
   - If trade skipped: `logActivity('TRADE_SKIPPED', { reason, accuracy })`
   - If trade executed: `logActivity('TRADE_EXECUTED', ...)`
   - If trade failed: `logActivity('TRADE_FAILED', { error })`

3. **Scheduler Post-Processing** (backgroundResearchScheduler.ts:786-797):
   - **Mode Check** (line 786):
     ```typescript
     if (mode === RESEARCH_MODE.AUTO_TRADE_RESEARCH) {
       // Trade execution already handled by AutoTradeEngine
       // History already stored with source='AUTO_TRADE'
       // Just log completion
     }
     ```
   - **CRITICAL**: Telegram alert code is SKIPPED (mode check fails)
   - **CRITICAL**: Telegram history storage is SKIPPED (mode check fails)

### Step 5: Frequency Decision

**Source**: `backgroundResearchSettings.researchFrequencyMinutes`

**Priority**:
1. Frequency provided to `startAutoTradeLoop(frequency)` → used
2. Existing `backgroundResearchSettings.researchFrequencyMinutes` → used
3. Default: 5 minutes

**Persistence**: Stored in `backgroundResearchSettings` (line 2488), read by scheduler (line 240)

**Scheduler Behavior**: 
- If frequency unchanged → keeps existing interval (no restart)
- If frequency changed → cancels old interval, creates new one

---

## C) AUTO TRADE MODE ONLY (Telegram Background OFF) - Complete Flow

### Step 1: Scheduler Registration

**Mode Detection** (backgroundResearchScheduler.ts:237-259):
```typescript
if (autoTradeEnabled) {  // TRUE
  mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;
  // Validates exchange APIs + primary APIs
  // Creates interval with researchFrequencyMinutes
}
// Telegram path skipped (telegramBgResearchEnabled is false)
```

**Interval Created**: `safeSetInterval(() => processUserResearchSafe(uid), intervalMs)`

### Step 2: Scheduled Research Execution (Every `researchFrequencyMinutes`)

**Complete Pipeline**:

1. **Scheduler Entry** (backgroundResearchScheduler.ts:442):
   - Checks: `jobState.isRunning` (prevents duplicates)
   - Validates: Mode is still `AUTO_TRADE_RESEARCH`
   - Validates: Exchange APIs + primary APIs still available
   - Sets: `jobState.isRunning = true`

2. **Research Delegation** (line 541):
   ```typescript
   const deepResearchResult = await autoTradeEngine.runAutoTradeResearchCycleSafe(uid);
   ```

3. **AutoTradeEngine Research Cycle** (autoTradeEngine.ts:2639):

   **a) Initial Guards** (lines 2656-2658):
   - Checks: `DISABLE_AUTOTRADE !== 'true'`
   - Checks: `shouldRunBackgroundTasks() === true`
   - If either fails → returns null (research skipped)

   **b) Research Execution** (line 2684):
   - Runs: Full deep research with coin selection
   - Uses: Research APIs only (CryptoCompare, NewsData, CoinMarketCap)
   - **NO exchange APIs used for research** (research is API-agnostic)

   **c) History Storage** (lines 2760-2804):
   - **ALWAYS stores** (even if no signal, low accuracy, or trade skipped):
     ```typescript
     {
       symbol: researchResult.symbol,
       signal: finalSignal,  // HOLD if accuracy < 60%
       accuracy: storedAccuracy,  // 0-100, always stored
       price: historyPrice,
       tradePlan: finalTradePlan,  // null if HOLD or accuracy < 60%
       source: 'AUTO_TRADE'  // ← Always this source
     }
     ```
   - **CRITICAL**: History stored BEFORE any trade evaluation

   **d) Trade Execution Evaluation** (lines 2806-2913):
   - **Gate 1**: `accuracy >= 75%` (line 2810)
     - If fails → logs `TRADE_SKIPPED`, returns researchResult (history already stored)
   - **Gate 2**: `signal !== 'HOLD'` (line 2817)
     - If fails → logs `TRADE_SKIPPED`, returns researchResult
   - **Gate 3**: Dynamic params (line 2833)
     - Calculates: leverage, size, volatility checks
     - If `params.skip` → logs `TRADE_SKIPPED`, returns researchResult
   - **Gate 4**: Final accuracy check (line 2892)
     - Double-check: `accuracy >= 75%`
     - If fails → logs `TRADE_SKIPPED`, returns researchResult
   - **If all pass**: Executes trade (line 2915)
     ```typescript
     const execution = await this.executeTrade(uid, tradeSignal);
     ```

   **e) Return Value**:
   - Returns: `ResearchDataResult` (contains symbol, signal, accuracy, result)
   - **CRITICAL**: Returns even if trade skipped (research completed successfully)

4. **Scheduler Post-Processing** (backgroundResearchScheduler.ts:786-797):
   - **Mode Check**: `mode === AUTO_TRADE_RESEARCH`
   - **Action**: Logs completion, updates state
   - **Telegram Logic**: SKIPPED (mode check fails)

5. **State Update** (lines 828-863):
   - Updates: `lastRunAt = now`, `nextRunAt = now + frequencyMinutes`
   - Updates Firestore: `lastRunAt`, `nextRunAt`, `lastAccuracy`
   - Sets: `jobState.isRunning = false`

### Step 3: What Always Runs (Even If No Trade Executed)

**Guaranteed Execution**:
1. ✅ **Deep Research**: Always runs (full analysis)
2. ✅ **History Storage**: Always stores (with source='AUTO_TRADE')
3. ✅ **State Update**: Always updates `lastRunAt`, `nextRunAt`
4. ✅ **Next Schedule**: Always schedules next run at `frequencyMinutes` interval

**Conditional Execution**:
- ❌ **Trade Execution**: Only if accuracy >= 75% AND signal !== 'HOLD' AND params pass
- ❌ **Activity Logs**: Only if trade executed/skipped (but history always stored)

### Step 4: Research History Contents

**Every Entry Contains**:
```typescript
{
  symbol: string,           // Coin analyzed
  signal: 'BUY' | 'SELL' | 'HOLD',  // Final signal
  accuracy: number,        // 0-100, always stored
  price: number,           // Market price at research time
  tradePlan: object | null, // Full trade plan (null if HOLD or accuracy < 60%)
  indicators: object | null, // Analysis data
  isDeepResearch: true,
  source: 'AUTO_TRADE',    // ← Always this in auto-trade mode
  timestamp: Firestore.Timestamp  // Server timestamp
}
```

**History Stored Even When**:
- Accuracy = 0%
- Signal = HOLD
- No trade plan generated
- Trade execution skipped
- Research returned null

### Step 5: Notifications & Activity Logs

**Activity Logs** (from AutoTradeEngine):
- `TRADE_SKIPPED`: When accuracy < 75% or signal = HOLD
- `TRADE_EXECUTED`: When trade successfully executed
- `TRADE_FAILED`: When trade execution fails
- `TRADE_CONFIRMATION_REQUIRED`: When manual approval needed

**Research History**:
- Always stored (separate from activity logs)
- Shows in Research History page with `source: 'AUTO_TRADE'`
- Includes all research results (even if no trade)

**Telegram Alerts**:
- **NOT sent** in auto-trade mode (Telegram alert code is skipped)

---

## D) CONFLICT RESOLUTION RULES

### Rule 1: Priority Check Order

**Location**: `backgroundResearchScheduler.ts:222-280`

**Exact Logic**:
```typescript
// Check Auto Trade FIRST (highest priority)
const autoTradeEnabled = autoTradeConfig?.autoTradeEnabled === true;

if (autoTradeEnabled) {
  // AUTO_TRADE_RESEARCH mode ← WINS
  mode = RESEARCH_MODE.AUTO_TRADE_RESEARCH;
  // Telegram path is NEVER checked
} else if (telegramBgResearchEnabled) {
  // TELEGRAM_BACKGROUND_RESEARCH mode
  mode = RESEARCH_MODE.TELEGRAM_BACKGROUND_RESEARCH;
}
```

**Why Both Can Never Run Together**:
- **Single Interval**: Only ONE `safeSetInterval()` exists per user (stored in `this.userIntervals`)
- **Mode Storage**: Only ONE mode stored in `jobState.mode`
- **Priority Check**: Auto-trade check happens FIRST, if true, Telegram check is SKIPPED
- **Interval Replacement**: When mode changes, old interval is `clearInterval()`'d and new one created

### Rule 2: Mode Transition Logic

**When User Toggles Auto Trade ON** (while Telegram is ON):
1. `startAutoTradeLoop()` sets `autoTradeEnabled = true`
2. `onUserSettingsChanged()` triggers `updateUserResearchSchedule()`
3. Priority check: `autoTradeEnabled === true` → sets `mode = AUTO_TRADE_RESEARCH`
4. **Old interval cancelled**: `clearInterval(existingInterval)` (line 310)
5. **New interval created**: With same frequency but different mode
6. **State updated**: `jobState.mode = 'AUTO_TRADE_RESEARCH'`
7. **Result**: Telegram mode interval stops, auto-trade mode interval starts

**When User Toggles Auto Trade OFF** (while Telegram is ON):
1. `stopAutoTradeLoop()` sets `autoTradeEnabled = false`
2. `onUserSettingsChanged()` triggers `updateUserResearchSchedule()`
3. Priority check: `autoTradeEnabled === false` → checks Telegram
4. If `telegramBgResearchEnabled === true` → sets `mode = TELEGRAM_BACKGROUND_RESEARCH`
5. **Old interval cancelled**: `clearInterval(existingInterval)`
6. **New interval created**: With Telegram mode
7. **Result**: Auto-trade mode interval stops, Telegram mode interval starts

**When User Toggles Telegram OFF** (while Auto Trade is ON):
1. `backgroundResearchSettings.backgroundResearchEnabled = false`
2. `onUserSettingsChanged()` triggers `updateUserResearchSchedule()`
3. Priority check: `autoTradeEnabled === true` → sets `mode = AUTO_TRADE_RESEARCH`
4. **Interval continues**: Same interval, same mode (no change)
5. **Result**: Auto-trade continues (Telegram flag doesn't affect it)

**When User Toggles Telegram ON** (while Auto Trade is ON):
1. `backgroundResearchSettings.backgroundResearchEnabled = true`
2. `onUserSettingsChanged()` triggers `updateUserResearchSchedule()`
3. Priority check: `autoTradeEnabled === true` → sets `mode = AUTO_TRADE_RESEARCH`
4. **Telegram flag ignored**: Telegram path is never checked
5. **Result**: Auto-trade continues (Telegram flag doesn't affect it)

### Rule 3: Internal State Consistency

**Mode Storage**:
- Stored in: `jobState.mode` (in-memory)
- Validated on: Every `processUserResearch()` call (lines 484-496)
- Updated on: Every `updateUserResearchSchedule()` call (line 325)

**Interval Management**:
- Stored in: `this.userIntervals.get(uid)` (Map<string, NodeJS.Timeout>)
- Only ONE interval per user (Map key is uid)
- Replaced on: Frequency change or mode change

**Firestore State**:
- `backgroundResearchSettings.backgroundResearchEnabled`: Can be true even in auto-trade mode (scheduler needs it)
- `autoTradeConfig.autoTradeEnabled`: Single source of truth for auto-trade
- Scheduler reads BOTH to determine mode (priority: auto-trade first)

---

## E) SAFETY & GUARANTEES

### Guarantee 1: Research Never Stops (Once Auto Trade is ON)

**Mechanism**:
1. **Scheduler Interval** (line 334):
   ```typescript
   const userInterval = safeSetInterval(
     async () => { await this.processUserResearchSafe(uid); },
     intervalMs,
     `user-research-${uid}`
   );
   ```
   - Uses `safeSetInterval()` (event loop protected)
   - Runs at EXACT `researchFrequencyMinutes` interval
   - **Never stops** unless: scheduler disabled, user disabled, or APIs missing

2. **Accuracy Never Blocks** (line 289):
   ```typescript
   // CRITICAL: Accuracy trigger is NOT validated here - it's an output, not a prerequisite
   // Research will ALWAYS run at the configured interval
   ```
   - Accuracy validation happens AFTER research (line 619)
   - Research runs regardless of previous accuracy values

3. **State Always Updated** (lines 849-863):
   - `lastRunAt` updated even if research returns null
   - `lastRunAt` updated even on errors (lines 879-910)
   - Next run always scheduled: `nextRunAt = now + frequencyMinutes`

### Guarantee 2: Accuracy Never Blocks Research Execution

**Evidence**:

1. **Scheduler Registration** (line 289):
   - No accuracy check during registration
   - Frequency validation only (line 283)

2. **Research Execution** (line 541):
   - Calls `runAutoTradeResearchCycleSafe()` regardless of previous accuracy
   - No accuracy gate before research

3. **History Storage** (autoTradeEngine.ts:2760):
   - History stored BEFORE accuracy gates (line 2790)
   - History stored even if accuracy = 0% (line 2769: `Math.max(0, ...)`)

4. **Accuracy Gates** (autoTradeEngine.ts:2810, 2892):
   - Only affect TRADE EXECUTION, not research execution
   - Research completes, history stored, then gates evaluated

### Guarantee 3: No "Stalled Research" States

**Mechanisms**:

1. **State Tracking** (lines 849-863):
   - `lastRunAt` updated after EVERY cycle (success or error)
   - `nextRunAt` always calculated: `now + frequencyMinutes`
   - Firestore updated: `lastRunAt`, `nextRunAt` persisted

2. **Error Recovery** (lines 872-910):
   - Errors caught and logged
   - State still updated: `lastRunAt = now`, `nextRunAt = now + frequencyMinutes`
   - Scheduler continues: Next interval still fires

3. **Diagnostic Check** (autoTrade.ts:649-677):
   - **PASS if**: `schedulerRunning === true && userJobScheduled === true`
   - **STALLED only if**: 
     - `schedulerRunning === false`, OR
     - `researchAgeMinutes > (configuredFrequencyMinutes * 2)`
   - **Accuracy NOT checked**: Diagnostic doesn't care about accuracy

4. **Bootstrap Recovery** (lines 104-156):
   - On server restart: Scans all users
   - Re-registers: Users with `autoTradeEnabled === true` OR `backgroundResearchEnabled === true`
   - Restores: All intervals from Firestore state

### Guarantee 4: lastRunAt and Scheduler State Consistency

**Update Points**:

1. **After Successful Research** (lines 852-854):
   ```typescript
   state.lastRunAt = now.toDate();
   state.nextRunAt = nextRunAt.toDate();
   state.isRunning = false;
   ```

2. **After Error** (lines 879-910):
   ```typescript
   state.lastRunAt = now.toDate();  // Still updated
   state.nextRunAt = nextRunAt.toDate();  // Still calculated
   state.isRunning = false;
   ```

3. **Firestore Sync** (lines 833-847):
   - Always updates Firestore: `lastRunAt`, `nextRunAt`, `lastAccuracy`
   - Uses `merge: true` (preserves other fields)

4. **State Initialization** (lines 856-862):
   - If state missing → creates new state with current timestamp
   - Ensures state always exists

**Consistency Guarantees**:
- In-memory state (`jobState`) and Firestore state (`backgroundResearchSettings`) updated together
- `lastRunAt` always reflects last research attempt (success or failure)
- `nextRunAt` always reflects next scheduled run
- State persists across server restarts (Firestore is source of truth)

---

## Summary: Complete Execution Matrix

| Scenario | Scheduler Mode | Research Runs | History Source | Trade Execution | Telegram Alerts |
|----------|---------------|---------------|----------------|-----------------|-----------------|
| Telegram Only | TELEGRAM_BACKGROUND_RESEARCH | Every `frequencyMinutes` | TELEGRAM_BACKGROUND | ❌ Never | ✅ If accuracy >= trigger |
| Auto Trade Only | AUTO_TRADE_RESEARCH | Every `frequencyMinutes` | AUTO_TRADE | ✅ If accuracy >= 75% | ❌ Never |
| Both Enabled | AUTO_TRADE_RESEARCH | Every `frequencyMinutes` | AUTO_TRADE | ✅ If accuracy >= 75% | ❌ Never (overridden) |

**Key Invariants**:
1. Only ONE scheduler interval per user (mode determines behavior)
2. Research ALWAYS runs at configured interval (accuracy is output, not gate)
3. History ALWAYS stored (even if no signal, low accuracy, or trade skipped)
4. Auto-trade mode ALWAYS overrides Telegram mode (priority check)
5. State ALWAYS updated (lastRunAt, nextRunAt) after every cycle

