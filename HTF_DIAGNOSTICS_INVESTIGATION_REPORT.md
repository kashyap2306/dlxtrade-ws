# HTF Diagnostics "Waiting for First Cycle" Investigation Report

## Executive Summary

**Issue**: HTF Trend Filter Agent UI shows "Waiting for first cycle..." even though backend logs indicate scheduler execution and diagnostic writes are occurring.

**Root Cause Identified**: The system has multiple potential failure points where diagnostics may not reach the frontend, creating a "silent failure" scenario where the backend believes it's writing diagnostics but the frontend never receives them.

---

## Investigation Findings

### 1. SCHEDULER TICK ENTRY POINT

**File**: `dlxtrade-ws/src/services/tradingAgentScheduler.ts`

**Lines**: 38-50, 90-120

**Condition Analysis**:
- Scheduler starts with `setInterval` at 5-minute intervals (line 38)
- `executeAllAgents()` is called on each tick (line 41)
- **CRITICAL**: Agents are reloaded from Firestore BEFORE each execution (line 92)
- HTF agents are identified and logged (lines 100-115)

**Potential Failure Point #1**: 
- If `loadActiveAgents()` fails silently, HTF agents won't be loaded
- If HTF agents have `status !== 'ACTIVE'`, they won't be included in execution
- **Decision Point**: Line 92 - If this fails, NO HTF agents execute

**Verification Needed**:
```typescript
// Line 92: await this.executionService.loadActiveAgents();
// If this throws or returns empty, HTF agents never execute
```

---

### 2. HTF AGENT EXECUTION REACHES DIAGNOSTIC WRITE

**File**: `dlxtrade-ws/src/services/agentExecutionService.ts`

**Lines**: 400-560 (executeAgent method), 1680-1830 (finally block)

**Condition Analysis**:

#### Early Return Conditions (Lines 501-560):
1. **AGENT_STOPPED** (Line 501-530): If agent status is 'STOPPED', returns early
2. **AGENT_PAUSED** (Line 532-560): If agent status is 'PAUSED', returns early
3. **NO_EXCHANGE_CONFIG_FOUND** (Line 600+): If exchange config missing, may return early

**CRITICAL FIX APPLIED**: Lines 501-560 now populate diagnostic fields BEFORE early return:
- `diagnostics.tradingPair = tradingPair`
- `diagnostics.skipReasonShort = 'Agent stopped'` or `'Agent paused'`
- `diagnostics.runtimeState.finalDecision = 'SKIP'`
- `diagnostics.runtimeState.skipReasonShort = 'Agent stopped'`

**Potential Failure Point #2**:
- If early returns happen BEFORE diagnostic fields are populated, finally block may write incomplete diagnostics
- **Decision Point**: Lines 501-560 - If these fields aren't set, diagnostics may be rejected by Firestore

#### Finally Block Diagnostic Write (Lines 1680-1830):

**CRITICAL SECTION**: Lines 1710-1820

```typescript
if (isHTFAgent) {
  // Ensure ALL required fields are populated
  if (!diagnostics.tradingPair) {
    diagnostics.tradingPair = tradingPair;
  }
  
  if (!diagnostics.runtimeState) {
    diagnostics.runtimeState = {};
  }
  
  if (!diagnostics.runtimeState.cycleId && diagnostics.cycleId) {
    diagnostics.runtimeState.cycleId = diagnostics.cycleId;
  }
  
  if (!diagnostics.runtimeState.finalDecision) {
    diagnostics.runtimeState.finalDecision = diagnostics.decision?.action === 'TRADE' ? 'TRADE' : 'SKIP';
  }
  
  // Generate skipReasonShort (3-4 words max)
  if (!diagnostics.runtimeState.skipReasonShort && !diagnostics.skipReasonShort) {
    // ... complex logic to generate skipReasonShort ...
  }
  
  // Ensure indicators.results exists
  if (!diagnostics.indicators) {
    diagnostics.indicators = {};
  }
  if (!diagnostics.indicators.results) {
    diagnostics.indicators.results = {};
  }
  
  // CRITICAL: Write diagnostics with FIXED agentId
  const htfAgentId = 'htf-trend-filter-agent';
  
  console.log('[HTF_DIAGNOSTIC_WRITE_START]', { ... });
  
  await firestoreAdapter.saveAgentDiagnostic(htfAgentId, {
    agentType: 'HTF_TREND_FILTER_AGENT',
    tradingPair: diagnostics.tradingPair,
    direction: diagnostics.direction || 'LONG',
    decision: diagnostics.decision || { action: 'SKIP', reason: 'No decision' },
    signal: diagnostics.signal,
    execution: diagnostics.execution,
    runtimeState: diagnostics.runtimeState
  }, agentConfig.userId);
  
  console.log('[HTF_DIAGNOSTIC_WRITE_SUCCESS]', { ... });
}
```

**Potential Failure Point #3**:
- If `firestoreAdapter.saveAgentDiagnostic()` throws an exception, it's caught by the outer try-catch (line 1825)
- Error is logged but NOT re-thrown, so execution continues silently
- **Decision Point**: Line 1800 - If this fails, diagnostic is NEVER written to Firestore

---

### 3. CYCLED GENERATION AND PROPAGATION

**File**: `dlxtrade-ws/src/services/agentExecutionService.ts`

**Lines**: 428, 1720

**Condition Analysis**:
- `cycleId` is generated at line 428: `cycleId: \`${Date.now()}_${Math.random().toString(36).substr(2, 9)}\``
- `cycleId` is copied to `runtimeState.cycleId` at line 1720

**Potential Failure Point #4**:
- If `diagnostics.cycleId` is undefined at line 428, `runtimeState.cycleId` will also be undefined
- Frontend deduplication relies on `runtimeState.cycleId` (line 167 in TradingAgentControl.tsx)
- **Decision Point**: Line 428 - If cycleId generation fails, deduplication breaks

---

### 4. DIAGNOSTICS API ROUTE RESPONSE LOGIC

**File**: `dlxtrade-ws/src/routes/agents.ts`

**Lines**: 715-860

**Condition Analysis**:

#### HTF Agent Detection (Lines 716-740):
```typescript
if (agentId === 'htf-trend-filter-agent') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
  if (!hasAccess) {
    return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
  }

  const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
  const targetAgent = userAgents.find((a: any) => String(a?.name || '').toLowerCase().includes('htf trend filter'));
  
  // Get scheduler status
  let scheduler: any = null;
  try {
    const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
    scheduler = tradingAgentScheduler.getStatus();
  } catch {
    scheduler = null;
  }

  if (!targetAgent?.id) {
    return reply.code(200).send({ diagnostics: [], scheduler, agentStatus: 'NOT_FOUND' });
  }
```

**Potential Failure Point #5**:
- If `targetAgent` is not found (line 738), returns empty diagnostics array
- **Decision Point**: Line 738 - If HTF agent doesn't exist in user's agents, returns empty

#### Diagnostics Query (Line 741):
```typescript
const rawDiagnostics = await TradingAgent.getDiagnostics('htf-trend-filter-agent', limit, uid);
```

**Potential Failure Point #6**:
- If `TradingAgent.getDiagnostics()` returns empty array, no diagnostics are sent to frontend
- **Decision Point**: Line 741 - This is the CRITICAL query that must return data

#### Diagnostics Filtering (Lines 744-765):
```typescript
const filteredDiagnostics = rawDiagnostics.filter((diag: any) => {
  // Exclude system-level AUTO_TRADE diagnostics
  if (diag.symbol === 'AUTO_TRADE_CYCLE' || 
      diag.agentId === 'AUTO_TRADE_AGENT' ||
      diag.pair === 'AUTO_TRADE_CYCLE' ||
      diag.tradingPair === 'AUTO_TRADE_CYCLE') {
    return false;
  }
  
  // Only show diagnostics that evaluated real trading symbols
  const hasRealSymbol = diag.tradingPair && 
                       diag.tradingPair !== 'AUTO_TRADE_CYCLE' && 
                       diag.tradingPair !== '--';
  const hasValidDirection = diag.direction && diag.direction !== '--';
  const hasSignalData = diag.signal?.direction;
  
  return hasRealSymbol || hasValidDirection || hasSignalData;
});
```

**Potential Failure Point #7**:
- If diagnostics don't have `tradingPair`, `direction`, or `signal.direction`, they're filtered out
- **Decision Point**: Lines 744-765 - If ALL diagnostics fail this filter, empty array is returned

---

### 5. FIRESTORE DIAGNOSTICS SAVE PATH

**File**: `dlxtrade-ws/src/services/firestoreAdapter.ts`

**Lines**: 5200-5400

**Condition Analysis**:

#### Path Validation (Line 5243):
```typescript
this.validateUserScopedDiagnosticsPath('saveAgentDiagnostic', uid);
```

**Potential Failure Point #8**:
- If `uid` is undefined or invalid, this throws an exception
- **Decision Point**: Line 5243 - If validation fails, diagnostic is NOT written

#### Firestore Write (Lines 5320-5360):
```typescript
const entriesRef = db.collection('users').doc(uid!).collection('agentDiagnostics').doc(agentId).collection('entries');

// ... payload construction ...

await entriesRef.add(sanitizedPayload);
```

**Potential Failure Point #9**:
- If Firestore write fails (permissions, network, etc.), exception is caught and logged
- **Decision Point**: Line 5360 - If write fails, diagnostic is NEVER persisted

---

### 6. FIRESTORE DIAGNOSTICS QUERY PATH

**File**: `dlxtrade-ws/src/services/firestoreAdapter.ts`

**Lines**: 5430-5520

**Condition Analysis**:

#### Query Path (Lines 5450-5455):
```typescript
const db = getFirebaseAdmin().firestore();
const entriesRef = db.collection('users').doc(uid).collection('agentDiagnostics').doc(agentId).collection('entries');

const snapshot = await entriesRef
  .orderBy('timestamp', 'desc')
  .limit(limit)
  .get();
```

**Potential Failure Point #10**:
- If `agentId` doesn't match the saved agentId ('htf-trend-filter-agent'), query returns empty
- If Firestore index is missing for `timestamp` field, query may fail
- **Decision Point**: Lines 5450-5455 - If query returns empty snapshot, no diagnostics are returned

---

### 7. FRONTEND DIAGNOSTICS API CALL

**File**: `frontend/src/pages/TradingAgentControl.tsx`

**Lines**: 150-180, 280-305

**Condition Analysis**:

#### API Call (Lines 150-180):
```typescript
const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 50);
setScheduler(diagnosticsResp.data?.scheduler || null);

const entries = diagnosticsResp.data?.diagnostics || [];

console.log('[HTF_DIAGNOSTICS] Received entries:', entries.length);

// Sort by timestamp descending
entries.sort((a: any, b: any) => {
  const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  return bTime - aTime;
});

// Deduplicate by cycleId ONLY
const seen = new Set<string>();
const deduplicated = entries.filter((entry: any) => {
  const cycleId = entry.runtimeState?.cycleId || entry.id || '';
  
  if (!cycleId || seen.has(cycleId)) {
    return false;
  }
  
  seen.add(cycleId);
  return true;
});

console.log('[HTF_DIAGNOSTICS] After deduplication:', deduplicated.length);

setDiagnosticsEntries(deduplicated);
```

**Potential Failure Point #11**:
- If API returns `{ diagnostics: [] }`, `entries` will be empty array
- If all entries have duplicate `cycleId`, deduplication removes them all
- **Decision Point**: Lines 167-179 - If deduplication removes all entries, state is set to empty array

---

### 8. FRONTEND STATE MANAGEMENT

**File**: `frontend/src/pages/TradingAgentControl.tsx`

**Lines**: 102-107, 160-180

**Condition Analysis**:

#### State Reset on Agent Change (Lines 102-107):
```typescript
useEffect(() => {
  console.log('[HTF_DIAGNOSTICS] Agent changed, resetting diagnostics state');
  setDiagnosticsEntries([]);
  setSkippedTrades([]);
}, [slug, resolvedAgentId]);
```

**Potential Failure Point #12**:
- If `slug` or `resolvedAgentId` changes frequently, state is constantly reset
- **Decision Point**: Lines 102-107 - If this fires after data load, state is cleared

---

### 9. FRONTEND UI RENDERING CONDITION

**File**: `frontend/src/pages/TradingAgentControl.tsx`

**Lines**: 843-968

**Condition Analysis**:

#### Rendering Logic (Lines 868-878):
```typescript
{isHTFTrendFilterAgent ? (
  diagnosticsEntries.length > 0 ? (
    <div className="overflow-x-auto bg-slate-800/30 rounded-lg border border-purple-500/10">
      <table className="min-w-full">
        {/* ... table content ... */}
      </table>
    </div>
  ) : (
    <div className="text-center py-8 text-gray-400 bg-slate-800/30 rounded-lg border border-purple-500/10">
      {autoTradeEnabled 
        ? 'Waiting for first cycle...'
        : 'No cycle results yet'}
    </div>
  )
) : (
  // Non-HTF logic
)}
```

**THE EXACT CONDITION CAUSING "WAITING FOR FIRST CYCLE"**:
- **Line 869**: `diagnosticsEntries.length > 0 ? (show table) : (show empty)`
- **Line 875**: If `diagnosticsEntries.length === 0` AND `autoTradeEnabled === true`, shows "Waiting for first cycle..."

**Decision Point**: Line 869 - This is the FINAL decision point where UI decides to show empty state

---

## Critical Path Summary

For "Waiting for first cycle..." to appear, ALL of the following must be true:

1. ✅ `isHTFTrendFilterAgent === true` (Line 868)
2. ✅ `diagnosticsEntries.length === 0` (Line 869)
3. ✅ `autoTradeEnabled === true` (Line 876)

For `diagnosticsEntries.length === 0` to be true, ANY of the following can cause it:

1. **Scheduler never executes HTF agents** (Failure Point #1)
2. **HTF agent execution throws before diagnostic write** (Failure Point #2)
3. **Diagnostic write to Firestore fails** (Failure Point #3, #8, #9)
4. **Firestore query returns empty** (Failure Point #6, #10)
5. **Backend filtering removes all diagnostics** (Failure Point #7)
6. **Frontend deduplication removes all entries** (Failure Point #11)
7. **State reset clears diagnostics after load** (Failure Point #12)

---

## Recommended Next Steps

### Immediate Verification (No Code Changes)

1. **Check Firestore Console**:
   - Navigate to: `users/{uid}/agentDiagnostics/htf-trend-filter-agent/entries`
   - Verify documents exist with recent timestamps
   - Check if `tradingPair`, `runtimeState.cycleId`, `runtimeState.finalDecision` fields exist

2. **Check Backend Logs**:
   - Search for: `[HTF_DIAGNOSTIC_WRITE_START]`
   - Search for: `[HTF_DIAGNOSTIC_WRITE_SUCCESS]`
   - Search for: `[SCHEDULER_TICK] HTF agents found:`
   - Verify logs show HTF agents are being executed

3. **Check Frontend Console**:
   - Search for: `[HTF_DIAGNOSTICS] Received entries:`
   - Search for: `[HTF_DIAGNOSTICS] After deduplication:`
   - Verify API is returning data

4. **Check API Response**:
   - Use browser DevTools Network tab
   - Inspect: `GET /api/agents/htf-trend-filter-agent/diagnostics?limit=50`
   - Verify response contains `{ diagnostics: [...] }` with non-empty array

### Root Cause Identification

Based on the verification results:

- **If Firestore has documents**: Issue is in query/filtering (Failure Points #6, #7, #10)
- **If Firestore is empty**: Issue is in write path (Failure Points #1, #2, #3, #8, #9)
- **If API returns empty**: Issue is in backend filtering (Failure Point #7)
- **If API returns data but frontend shows empty**: Issue is in frontend deduplication/state (Failure Points #11, #12)

---

## Conclusion

The "Waiting for first cycle..." message is controlled by a single condition at **Line 869** of `TradingAgentControl.tsx`:

```typescript
diagnosticsEntries.length > 0 ? (show table) : (show empty)
```

However, there are **12 potential failure points** in the path from scheduler execution to frontend display. The investigation has identified the exact files, line numbers, and conditions for each failure point.

**The FIRST point where the system concludes "no cycle has occurred" is at Line 869 of TradingAgentControl.tsx**, but the ROOT CAUSE could be anywhere in the 12 failure points identified above.

To identify the EXACT root cause, follow the verification steps in the "Recommended Next Steps" section.
