# VWAP Strategy Auto-Stop Fix - Complete

## Problem Statement

The VWAP Strategy agent was automatically STOPPING when:
- Outside London / New York trading sessions
- Exchange not connected
- Market conditions not met (offline / inactive state)

This was INCORRECT behavior. The agent must remain RUNNING and only SKIP trades.

---

## Root Cause Analysis

### Location
`dlxtrade-ws/src/services/agentExecutionService.ts` - `executeVWAPStrategy()` method (line ~1035)

### Issue
When exchange credentials were missing or not connected, the code was:
```typescript
runtimeState.status = 'STOPPED';
runtimeState.stoppedReason = 'EXCHANGE_NOT_CONNECTED';
```

This caused the agent to transition from `RUNNING` → `STOPPED`, which is incorrect.

### Why This Was Wrong
1. **Lifecycle violation**: Agent status should only stop on user action or fatal errors
2. **Session handling**: Missing credentials is a SKIP condition, not a STOP condition
3. **Scheduler behavior**: Stopping the agent prevents future scan cycles
4. **Error vs Skip confusion**: Exchange not connected is NOT an error - it's a skip condition

---

## Fix Applied

### Changed Code
**File**: `dlxtrade-ws/src/services/agentExecutionService.ts`
**Method**: `executeVWAPStrategy()`
**Lines**: ~1035-1050

### Before (INCORRECT)
```typescript
if (!runtimeState.exchange || !runtimeState.credentials?.apiKey || !runtimeState.credentials?.secret) {
  runtimeState.status = 'STOPPED';  // ❌ WRONG - stops agent
  runtimeState.stoppedReason = 'EXCHANGE_NOT_CONNECTED';
  await storeVWAPDiagnostics({
    // ... diagnostics ...
    decision: { action: 'SKIP', reason: 'EXCHANGE_NOT_CONNECTED' },
  });
  return;
}
```

### After (CORRECT)
```typescript
if (!runtimeState.exchange || !runtimeState.credentials?.apiKey || !runtimeState.credentials?.secret) {
  // FIX: Do NOT stop agent - only SKIP this cycle
  // Agent must remain RUNNING and continue scanning
  await storeVWAPDiagnostics({
    // ... diagnostics ...
    decision: { action: 'SKIP', reason: 'EXCHANGE_NOT_CONNECTED' },
  });
  
  logger.warn({
    agentId: `vwap_${userId}`,
    userId,
    reason: 'EXCHANGE_NOT_CONNECTED'
  }, 'SKIP: VWAP execution - exchange not connected (agent remains RUNNING)');
  
  // Update heartbeat to keep agent alive
  await vwapRuntimeService.updateHeartbeat(userId);  // ✅ ADDED - keeps agent alive
  return;
}
```

---

## Key Changes

### 1. Removed Status Change
❌ **REMOVED**: `runtimeState.status = 'STOPPED';`
❌ **REMOVED**: `runtimeState.stoppedReason = 'EXCHANGE_NOT_CONNECTED';`

**Reason**: Agent status must remain `RUNNING` even when skipping trades.

### 2. Added Heartbeat Update
✅ **ADDED**: `await vwapRuntimeService.updateHeartbeat(userId);`

**Reason**: Keeps agent alive and updates `lastHeartbeat` timestamp to show agent is active.

### 3. Enhanced Logging
✅ **ADDED**: Clear log message indicating agent remains RUNNING

**Reason**: Makes it explicit that this is a SKIP, not a STOP.

---

## Verification of Other Skip Conditions

### Session Check (vwapStrategy.ts)
✅ **CORRECT** - Already returns diagnostics with `action: 'SKIP'`
```typescript
if (!sessionCheck.isValidSession) {
  diagnostics.decision = { action: 'SKIP', reason: sessionCheck.reason || 'Outside trading hours' };
  return diagnostics;  // ✅ Returns diagnostics, does NOT stop agent
}
```

### Market Data Check (vwapStrategy.ts)
✅ **CORRECT** - Already returns diagnostics with `action: 'SKIP'`
```typescript
if (!candles || candles.length < 20) {
  diagnostics.decision = { action: 'SKIP', reason: 'Insufficient market data' };
  return diagnostics;  // ✅ Returns diagnostics, does NOT stop agent
}
```

### Signal Generation (vwapStrategy.ts)
✅ **CORRECT** - Already returns diagnostics with `action: 'SKIP'`
```typescript
if (!signal.meetsConditions) {
  diagnostics.decision = { action: 'SKIP', reason: signal.reason || 'Conditions not met' };
  return diagnostics;  // ✅ Returns diagnostics, does NOT stop agent
}
```

### Risk Validation (vwapStrategy.ts)
✅ **CORRECT** - Already returns diagnostics with `action: 'SKIP'`
```typescript
if (!isFinite(rrRatio) || rrRatio < 1.3) {
  diagnostics.decision = { action: 'SKIP', reason: `RR_TOO_LOW_${rrRatio.toFixed(2)}` };
  return diagnostics;  // ✅ Returns diagnostics, does NOT stop agent
}
```

---

## Agent Lifecycle States

### Correct State Transitions
```
User Action: START
  ↓
RUNNING (scanning every 5 minutes)
  ↓
  ├─→ SKIP (session outside hours) → RUNNING (continues scanning)
  ├─→ SKIP (exchange not connected) → RUNNING (continues scanning)
  ├─→ SKIP (no signal) → RUNNING (continues scanning)
  ├─→ SKIP (RR too low) → RUNNING (continues scanning)
  ├─→ TRADE (conditions met) → RUNNING (continues scanning)
  ↓
User Action: STOP
  ↓
STOPPED (no longer scanning)
```

### Incorrect State Transitions (FIXED)
```
❌ RUNNING → STOPPED (due to session outside hours)
❌ RUNNING → STOPPED (due to exchange not connected)
❌ RUNNING → STOPPED (due to no signal)
```

---

## Status Update Logic

### Agent Status Transitions
✅ **CORRECT**: `STARTED` → `RUNNING` → `RUNNING` (even when skipping)
✅ **CORRECT**: `RUNNING` → `STOPPED` (only on user action or fatal error)
❌ **PREVENTED**: `RUNNING` → `STOPPED` (due to skip conditions)

### When Agent Should Stop
1. **User manually stops** via `/agents/vwap-strategy/stop` endpoint
2. **Fatal error** (uncaught exception, crash)
3. **Daily safety limits** (max trades, max loss, consecutive losses)

### When Agent Should Skip (NOT Stop)
1. Outside London / NY trading sessions
2. Exchange not connected
3. Insufficient market data
4. No valid signal generated
5. RR ratio too low
6. Insufficient margin
7. Invalid position size

---

## Scheduler Behavior

### Before Fix
```
Scan Cycle 1: RUNNING → Exchange not connected → STOPPED
Scan Cycle 2: (no scan - agent stopped)
Scan Cycle 3: (no scan - agent stopped)
```

### After Fix
```
Scan Cycle 1: RUNNING → Exchange not connected → SKIP → RUNNING
Scan Cycle 2: RUNNING → Outside session → SKIP → RUNNING
Scan Cycle 3: RUNNING → Signal generated → TRADE → RUNNING
Scan Cycle 4: RUNNING → No signal → SKIP → RUNNING
```

---

## Error vs Skip Separation

### Errors (Stop Agent)
- Uncaught exception
- Fatal configuration error
- Server crash
- Daily safety limits exceeded (max trades, max loss, consecutive losses)

### Skips (Keep Agent Running)
- Outside trading sessions
- Exchange not connected
- Insufficient market data
- No valid signal
- RR ratio too low
- Insufficient margin
- Invalid position size
- EMA 200 filter fail
- VWAP deviation too small
- Not a bullish rejection candle

---

## Verification Steps

### 1. Start VWAP Agent
```bash
POST /agents/vwap-strategy/start
```

**Expected**: Agent status = `RUNNING`

### 2. Wait Outside Trading Session
**Time**: Outside 08:00-16:59 UTC (London) and 14:30-21:29 UTC (NY)

**Expected**:
- Agent status remains `RUNNING`
- Diagnostics show `action: 'SKIP'`, `reason: 'Outside trading hours'`
- Scheduler continues firing every 5 minutes
- Heartbeat updates every cycle

### 3. Disconnect Exchange
**Action**: Remove exchange credentials

**Expected**:
- Agent status remains `RUNNING`
- Diagnostics show `action: 'SKIP'`, `reason: 'EXCHANGE_NOT_CONNECTED'`
- Scheduler continues firing every 5 minutes
- Heartbeat updates every cycle

### 4. Reconnect Exchange During Session
**Action**: Add exchange credentials back
**Time**: During London or NY session

**Expected**:
- Agent status remains `RUNNING`
- Agent resumes trading automatically
- Diagnostics show `action: 'TRADE'` when conditions met

### 5. Keep Running for Several Hours
**Duration**: 3-6 hours across session boundaries

**Expected**:
- Agent status stays `RUNNING` throughout
- Skips trades outside sessions
- Executes trades during sessions (when conditions met)
- Never transitions to `STOPPED` unless user stops it

---

## Build Requirement

### Is Build Required?
**NO** - Build is NOT strictly required for this fix.

### Reasoning
1. **Single file change**: Only modified `agentExecutionService.ts`
2. **Runtime logic fix**: Changed execution flow, not types or interfaces
3. **No new dependencies**: No npm packages added
4. **No structural changes**: No new files, folders, or imports

### When to Build
Build is recommended if:
- Deploying to production
- Running TypeScript compilation checks
- Verifying no syntax errors

### Quick Verification Without Build
```bash
# Check TypeScript syntax (no compilation)
npx tsc --noEmit dlxtrade-ws/src/services/agentExecutionService.ts

# Restart server to apply changes
cd dlxtrade-ws
npm run dev
```

---

## Testing Checklist

### Pre-Test Setup
- [ ] Start VWAP agent via `/agents/vwap-strategy/start`
- [ ] Verify agent status = `RUNNING`
- [ ] Note current UTC time

### Test 1: Outside Session Behavior
- [ ] Wait until outside London/NY sessions
- [ ] Check agent status (should be `RUNNING`)
- [ ] Check diagnostics (should show `SKIP` with session reason)
- [ ] Verify scheduler continues firing (check logs every 5 min)

### Test 2: Exchange Disconnect
- [ ] Remove exchange credentials
- [ ] Check agent status (should be `RUNNING`)
- [ ] Check diagnostics (should show `SKIP` with exchange reason)
- [ ] Verify heartbeat updates (check `lastHeartbeat` timestamp)

### Test 3: Auto-Resume
- [ ] Reconnect exchange during trading session
- [ ] Verify agent automatically resumes trading
- [ ] Check diagnostics (should show `TRADE` when conditions met)

### Test 4: Long-Running Stability
- [ ] Keep agent running for 6+ hours
- [ ] Cross multiple session boundaries
- [ ] Verify status stays `RUNNING` throughout
- [ ] Verify no unexpected `STOPPED` transitions

---

## Summary

### What Was Fixed
✅ Removed incorrect `runtimeState.status = 'STOPPED'` on exchange disconnect
✅ Added heartbeat update to keep agent alive during skips
✅ Enhanced logging to clarify skip vs stop behavior

### What Was NOT Changed
✅ Strategy rules (EMA 200, VWAP deviation, etc.)
✅ Risk filters (RR ratio, position sizing, etc.)
✅ Session windows (London 08:00-16:59, NY 14:30-21:29)
✅ Daily safety limits (max trades, max loss, consecutive losses)

### Expected Behavior After Fix
✅ Agent remains `RUNNING` even when skipping trades
✅ Scheduler continues scanning at fixed intervals
✅ Agent auto-resumes trading when conditions improve
✅ Only user action or fatal errors stop the agent

---

## Status

**FIX COMPLETE** ✅

**Files Modified**: 1
- `dlxtrade-ws/src/services/agentExecutionService.ts`

**Lines Changed**: ~15 lines

**Build Required**: NO (optional for production deployment)

**Testing Required**: YES (follow verification steps above)

**Deployment**: Ready for production after testing

---

## Next Steps

1. **Test in development**: Follow verification steps above
2. **Monitor logs**: Check for `SKIP` messages with proper reasons
3. **Verify status**: Confirm agent stays `RUNNING` across sessions
4. **Deploy to production**: After successful testing
5. **Monitor production**: Watch for any unexpected `STOPPED` transitions

**Status**: ✅ **READY FOR TESTING**
