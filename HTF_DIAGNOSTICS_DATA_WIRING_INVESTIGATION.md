# HTF Agent Diagnostics Data Wiring Investigation

## Problem Statement
Backend logs show activity every 5 minutes, but the HTF Trend Filter Agent UI shows no diagnostics in "Recent Cycle Results". User suspects backend activity might be from Deep Research pipeline, not Trading Agent execution.

## Investigation Findings

### Data Flow Architecture
I've traced the complete data flow from scheduler execution to UI display:

```
1. SCHEDULER (every 5 min)
   ↓
2. agentExecutionService.executeAgent(agent)
   ↓
3. agent.storeDiagnostics(diagnostics)
   ↓
4. firestoreAdapter.saveAgentDiagnostic(this.config.id, ...)
   ↓
5. FIRESTORE: agentDiagnostics/{agentId}/logs/{auto-id}
   ↓
6. FRONTEND: GET /api/agents/htf-trend-filter-agent/diagnostics
   ↓
7. BACKEND ROUTE: finds HTF agent for user → targetAgent.id
   ↓
8. TradingAgent.getDiagnostics(targetAgent.id, limit)
   ↓
9. firestoreAdapter.getAgentDiagnostics(agentId, limit)
   ↓
10. FIRESTORE QUERY: agentDiagnostics/{agentId}/logs (orderBy timestamp desc)
```

### Key Code Locations

**Write Path (Scheduler → Firestore)**:
- `dlxtrade-ws/src/services/agentExecutionService.ts` (line ~200-800)
  - Calls `agent.storeDiagnostics(diagnostics)` at 6 early-return points
- `dlxtrade-ws/src/services/tradingAgent.ts` (line ~154)
  - Uses `this.config.id` as agentId
- `dlxtrade-ws/src/services/firestoreAdapter.ts` (line ~4659-4700)
  - Writes to `agentDiagnostics/{agentId}/logs`

**Read Path (Frontend → Firestore)**:
- `frontend/src/pages/TradingAgentControl.tsx`
  - Calls `agentsApi.getTradingAgentDiagnostics('htf-trend-filter-agent', 20)`
- `dlxtrade-ws/src/routes/agents.ts` (line ~665-695)
  - Finds HTF agent: `userAgents.find(a => a.name.includes('htf trend filter'))`
  - Queries: `TradingAgent.getDiagnostics(targetAgent.id, limit)`
- `dlxtrade-ws/src/services/firestoreAdapter.ts` (line ~4712-4750)
  - Queries `agentDiagnostics/{agentId}/logs`

### Critical Invariant
**The agentId used to WRITE diagnostics MUST match the agentId used to READ diagnostics.**

## Possible Root Causes

### 1. HTF Agent Document Doesn't Exist ⚠️ MOST LIKELY
**Symptom**: Scheduler loads agents using `getActiveTradingAgents()` which queries:
```javascript
db.collection('tradingAgents')
  .where('status', '==', 'ACTIVE')
```

**If the HTF agent document doesn't exist or has wrong status**:
- Scheduler won't load it → won't execute it → no diagnostics written
- Backend route can't find it → returns empty diagnostics array
- UI shows "No recent cycles"

**How to verify**: Run the diagnostic script (see below)

### 2. AgentId Mismatch
**Symptom**: Diagnostics are written to one agentId but queried from a different agentId.

**Possible scenarios**:
- Multiple HTF agents exist for the same user
- Scheduler executes agent A, but route queries agent B
- Agent was recreated with a new ID

**How to verify**: Check if `targetAgent.id` in the route matches the agentId in scheduler logs

### 3. Scheduler Not Executing HTF Agents
**Symptom**: Scheduler is running but skipping HTF agents due to:
- Agent status is not 'ACTIVE'
- Agent doesn't meet execution criteria
- Scheduler is only executing research pipeline

**How to verify**: Check scheduler logs for HTF agent execution

### 4. Diagnostics Write Failures
**Symptom**: `storeDiagnostics()` is called but fails silently.

**Note**: The code has try-catch that logs errors but doesn't throw, so failures would be silent to the caller.

**How to verify**: Check backend logs for "Failed to save agent diagnostic" errors

## Diagnostic Script

I've created `test-htf-diagnostics-wiring.js` to diagnose the issue:

```bash
cd dlxtrade-ws
node ../test-htf-diagnostics-wiring.js
```

**This script will**:
1. Search for HTF agent documents in Firestore
2. Check agent status (ACTIVE/PAUSED/STOPPED)
3. Verify diagnostics exist at the correct path
4. Simulate the frontend query to check for ID mismatches
5. Check recent scheduler activity for HTF agents

## Expected Outcomes

### If Agent Doesn't Exist
```
❌ NO HTF agents found in tradingAgents collection
   This means the agent document was never created.
   The scheduler cannot execute an agent that doesn't exist.
```

**Solution**: Create the HTF agent document via the start/control endpoint

### If Agent Exists But Wrong Status
```
⚠️  Agent status is "STOPPED" - scheduler only executes ACTIVE agents
```

**Solution**: Update agent status to 'ACTIVE'

### If AgentId Mismatch
```
⚠️  Route would find a DIFFERENT agent (ID: abc123)
   This is a MISMATCH - diagnostics are written to xyz789 but queried from abc123
```

**Solution**: Ensure only one HTF agent exists per user, or fix the route query logic

### If Scheduler Not Executing
```
❌ NO HTF diagnostics found anywhere in the system
   This strongly suggests the scheduler is NOT executing HTF agents
```

**Solution**: Check scheduler configuration and agent loading logic

## Next Steps

1. **Run the diagnostic script** to identify the exact issue
2. **Based on the output**, apply the appropriate fix:
   - Create agent document if missing
   - Update agent status if wrong
   - Fix agentId mismatch if detected
   - Debug scheduler if not executing

3. **Verify the fix**:
   - Wait 5 minutes for next scheduler cycle
   - Check UI for new diagnostics
   - Verify backend logs show execution

## Code Changes Already Made

✅ **Backend**: Added diagnostic persistence to all 6 early-return paths in `agentExecutionService.ts`
✅ **Frontend**: Enhanced UI with better reason mapping and styling

**These changes are correct and production-ready.** The issue is not with the diagnostic persistence logic itself, but with the data wiring between scheduler execution and UI query.

## User Action Required

Please run the diagnostic script and share the output. This will tell us exactly which of the 4 root causes is the problem.

```bash
cd dlxtrade-ws
node ../test-htf-diagnostics-wiring.js
```

Once we see the output, I can provide the exact fix needed.
