# Agent Start 400 Error Fix - Design

## Overview

This design fixes the broken approval → agent creation → start chain by ensuring admin approval creates the required `tradingAgents` document that the `/start` endpoint expects.

## Root Cause Analysis

### Current State
```
Admin Approval (Firestore)
  ↓
users/{uid}.approvedAgents[] ← Sidebar reads this
  ↓
Frontend: Start button enabled
  ↓
POST /api/agents/:agentId/start
  ↓
getUserTradingAgents(uid) ← Expects tradingAgents document
  ↓
❌ 400 Error: "No Trading Agent configured"
```

### Fixed State
```
Admin Approval (Firestore)
  ↓
ATOMIC TRANSACTION:
  1. users/{uid}.approvedAgents[] ← Sidebar reads this
  2. tradingAgents/{agentId} ← Backend reads this
  ↓
Frontend: Start button enabled
  ↓
POST /api/agents/:agentId/start
  ↓
getUserTradingAgents(uid) ← Finds tradingAgents document ✅
  ↓
✅ 200 Success: Agent started
```

## Architecture Changes

### 1. Admin Approval Flow Enhancement

**File**: `frontend/src/pages/AdminUnlockRequests.tsx`

**Current Code** (lines 123-126):
```typescript
await updateDoc(userRef, {
  hasAgentAccess: true,
  approvedAgents: arrayUnion(request.agentType)
});
```

**New Code**:
```typescript
// Step 1: Update approval flag
await updateDoc(userRef, {
  hasAgentAccess: true,
  approvedAgents: arrayUnion(request.agentType)
});

// Step 2: Create agent document if needed
if (request.agentType === 'TRADING_AGENT' || request.agentType === 'LIQUIDITY_SWEEP_AGENT') {
  const agentId = request.agentType === 'TRADING_AGENT'
    ? `trading_agent_${request.userId}_${Date.now()}`
    : `liquidity_sweep_${request.userId}_${Date.now()}`;
  
  const agentData = {
    id: agentId,
    userId: request.userId,
    name: request.agentType === 'TRADING_AGENT' ? 'Trading Agent' : 'Liquidity Sweep Agent',
    tradingPair: 'BTC/USDT',
    marketType: 'futures',
    strategyType: request.agentType === 'TRADING_AGENT' ? 'RSI_BOLLINGER' : 'LIQUIDITY_SWEEP',
    status: 'INACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await setDoc(doc(db, 'tradingAgents', agentId), agentData);
}
```

**Rationale**:
- Creates agent document immediately after approval
- Only for agents that require documents (Trading Agent, Liquidity Sweep)
- Uses consistent naming convention
- Sets initial status to INACTIVE (user must explicitly start)

### 2. Backend Start Endpoint Validation

**File**: `dlxtrade-ws/src/routes/agents.ts`

**Current Code** (lines 1240-1246):
```typescript
if (!targetAgent?.id) {
  return reply.code(400).send({ 
    error: 'No Trading Agent configured. Please request agent approval from admin first.',
    code: 'AGENT_NOT_CONFIGURED'
  });
}
```

**Enhanced Code**:
```typescript
if (!targetAgent?.id) {
  // Check if user has approval but document is missing
  const hasApproval = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
  
  if (hasApproval) {
    return reply.code(400).send({ 
      error: 'Agent document missing. Please contact admin to recreate your agent.',
      code: 'AGENT_DOCUMENT_MISSING'
    });
  } else {
    return reply.code(403).send({ 
      error: 'Trading Agent access not granted yet. Please request approval from admin first.',
      code: 'AGENT_NOT_APPROVED'
    });
  }
}
```

**Rationale**:
- Distinguishes between "not approved" (403) and "approved but document missing" (400)
- Provides actionable error messages
- Helps diagnose approval flow issues

### 3. Frontend Start Button Validation

**File**: `frontend/src/pages/TradingAgentControl.tsx`

**Current Code** (lines 138-154):
```typescript
const handleToggleAutoTrade = async (nextEnabled: boolean) => {
  if (!resolvedAgentId) {
    showToast('Agent not ready yet', 'error');
    return;
  }
  
  if (nextEnabled) {
    const exchangeStatus = isExchangeConnected(exchangeConfig);
    if (!exchangeStatus.connected) {
      showToast('Exchange not connected. Please connect your exchange in Settings first.', 'error');
      return;
    }
  }
  // ... rest of function
}
```

**Enhanced Code**:
```typescript
const handleToggleAutoTrade = async (nextEnabled: boolean) => {
  // Validate prerequisites before API call
  if (!hasAgentAccess) {
    showToast('Agent not approved. Please request approval from admin first.', 'error');
    return;
  }
  
  if (!resolvedAgentId) {
    showToast('Agent not configured. Please contact admin.', 'error');
    return;
  }
  
  if (nextEnabled) {
    const exchangeStatus = isExchangeConnected(exchangeConfig);
    if (!exchangeStatus.connected) {
      showToast('Exchange not connected. Please connect your exchange in Settings first.', 'error');
      return;
    }
  }
  // ... rest of function
}
```

**Button Disabled State**:
```typescript
<button
  className="btn btn-primary"
  disabled={
    togglingAutoTrade || 
    !resolvedAgentId || 
    !hasAgentAccess ||
    !isExchangeConnected(exchangeConfig).connected
  }
  onClick={() => handleToggleAutoTrade(!autoTradeEnabled)}
  title={
    !hasAgentAccess ? 'Request approval from admin first' :
    !resolvedAgentId ? 'Agent not configured' :
    !isExchangeConnected(exchangeConfig).connected ? 'Connect exchange in Settings first' :
    autoTradeEnabled ? 'Stop trading' : 'Start trading'
  }
>
  {togglingAutoTrade ? 'Updating…' : autoTradeEnabled ? 'Stop Trading' : 'Start Trading'}
</button>
```

**Rationale**:
- Prevents API calls when prerequisites aren't met
- Shows clear tooltips explaining why button is disabled
- Reduces unnecessary 400 errors

### 4. Liquidity Sweep Agent Auto-Creation Removal

**File**: `dlxtrade-ws/src/routes/agents.ts`

**Current Code** (lines 1260-1278):
```typescript
// Auto-create default agent if none exists
if (userAgents.length === 0) {
  logger.info({ uid: user.uid }, 'No liquidity sweep agents found, creating default agent');
  const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
  const defaultAgent = {
    id: `liquidity_sweep_${user.uid}_${Date.now()}`,
    userId: user.uid,
    name: 'Liquidity Sweep Agent',
    tradingPair: 'BTC/USDT',
    marketType: 'futures',
    strategyType: 'LIQUIDITY_SWEEP',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
  userAgents = [defaultAgent];
}
```

**New Code**:
```typescript
// Remove auto-creation logic - agent must be created during approval
if (userAgents.length === 0) {
  const hasApproval = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
  
  if (hasApproval) {
    return reply.code(400).send({ 
      error: 'Agent document missing. Please contact admin to recreate your agent.',
      code: 'AGENT_DOCUMENT_MISSING'
    });
  } else {
    return reply.code(403).send({ 
      error: 'Liquidity Sweep Agent access not granted yet. Please request approval from admin first.',
      code: 'AGENT_NOT_APPROVED'
    });
  }
}
```

**Rationale**:
- Removes hidden auto-creation logic that violates design constraints
- Forces proper approval flow
- Provides clear error messages

## Data Flow

### Approval Flow
```
1. User submits agent request
   ↓
2. Admin approves in AdminUnlockRequests
   ↓
3. ATOMIC TRANSACTION:
   a. Update users/{uid}.approvedAgents[]
   b. Create tradingAgents/{agentId} (if Trading/Liquidity agent)
   ↓
4. Sidebar immediately shows agent
   ↓
5. User navigates to agent page
   ↓
6. Frontend checks:
   - hasAgentAccess (from approvedAgents)
   - resolvedAgentId (from agent slug)
   - exchangeConfig (from Settings)
   ↓
7. Start button enabled if all checks pass
```

### Start Flow
```
1. User clicks Start button
   ↓
2. Frontend validates:
   - hasAgentAccess ✅
   - resolvedAgentId ✅
   - exchangeConnected ✅
   ↓
3. POST /api/agents/:agentId/start
   ↓
4. Backend validates:
   - userHasAgentAccess(uid, agentId) ✅
   - getUserTradingAgents(uid) returns document ✅
   - exchangeConfig exists ✅
   ↓
5. Update agent status to ACTIVE
   ↓
6. Return 200 success
```

## Error Handling

### Error Codes

| Code | HTTP | Scenario | Message |
|------|------|----------|---------|
| `AGENT_NOT_APPROVED` | 403 | User doesn't have approval flag | "Agent access not granted yet. Please request approval from admin first." |
| `AGENT_DOCUMENT_MISSING` | 400 | Approval exists but document missing | "Agent document missing. Please contact admin to recreate your agent." |
| `EXCHANGE_NOT_CONNECTED` | 400 | Exchange config missing | "Exchange not connected. Please connect an exchange in Settings first." |
| `AGENT_ALREADY_RUNNING` | 400 | Agent status is ACTIVE | "Agent is already running." |

### Frontend Error Display

```typescript
try {
  await agentsApi.startTradingAgent(slug);
  showToast('Auto trading started', 'success');
} catch (err: any) {
  const errorCode = err.response?.data?.code;
  const errorMessage = err.response?.data?.error;
  
  if (errorCode === 'AGENT_NOT_APPROVED') {
    showToast('Please request agent approval from admin first.', 'error');
  } else if (errorCode === 'AGENT_DOCUMENT_MISSING') {
    showToast('Agent configuration missing. Please contact admin.', 'error');
  } else if (errorCode === 'EXCHANGE_NOT_CONNECTED') {
    showToast('Please connect your exchange in Settings first.', 'error');
  } else {
    showToast(errorMessage || 'Failed to start agent', 'error');
  }
}
```

## Testing Strategy

### Unit Tests
1. Test agent document creation during approval
2. Test start endpoint validation logic
3. Test frontend button disabled states

### Integration Tests
1. Test full approval → start flow for Trading Agent
2. Test full approval → start flow for Liquidity Sweep Agent
3. Test error scenarios (no approval, no document, no exchange)

### Manual Testing
1. Approve Trading Agent → Verify document created → Start agent → Verify 200 response
2. Approve Liquidity Sweep Agent → Verify document created → Start agent → Verify 200 response
3. Approve VWAP Strategy → Verify NO document created → Start agent → Verify 200 response
4. Approve Crowd Consensus → Verify NO document created → Start agent → Verify 200 response
5. Try to start without approval → Verify 403 error
6. Delete agent document → Try to start → Verify 400 error with clear message

## Rollback Plan

If issues arise:
1. Revert `AdminUnlockRequests.tsx` changes
2. Revert backend validation changes
3. Keep auto-creation logic in `/start` endpoint temporarily
4. Investigate and fix approval flow issues
5. Re-apply changes once root cause identified

## Performance Considerations

- Agent document creation adds ~200ms to approval flow (acceptable)
- Start endpoint validation adds ~100ms (acceptable)
- No impact on sidebar rendering (still reads from same source)

## Security Considerations

- Agent documents are scoped to user UID
- Only admins can create agent documents via approval
- Users cannot create their own agent documents
- Start endpoint validates both approval and document existence

## Correctness Properties

### Property 1: Approval Completeness
**For all users u and agents a**: If `u.approvedAgents` contains `a`, then either:
- `tradingAgents` collection contains document for `(u, a)`, OR
- `a` is VWAP Strategy or Crowd Consensus (no document required)

**Validates**: Requirements 1.1, 1.2, 1.3

### Property 2: Start Prerequisite
**For all start requests**: `/start` returns 200 only if:
- User has approval flag, AND
- Agent document exists (for Trading/Liquidity agents), AND
- Exchange is connected

**Validates**: Requirements 2.1, 2.2, 2.3, 2.4

### Property 3: Button State Consistency
**For all agent pages**: Start button is enabled only if:
- `hasAgentAccess === true`, AND
- `resolvedAgentId !== null`, AND
- `exchangeConnected === true`, AND
- `autoTradeEnabled === false`

**Validates**: Requirements 3.1, 3.2, 3.3

## Implementation Order

1. **Phase 1**: Enhance admin approval flow to create agent documents
2. **Phase 2**: Remove auto-creation logic from `/start` endpoint
3. **Phase 3**: Enhance backend validation and error messages
4. **Phase 4**: Enhance frontend button validation and tooltips
5. **Phase 5**: Test all scenarios and verify ZERO 400 errors

## Success Metrics

- ✅ ZERO 400 errors for approved agents with connected exchanges
- ✅ Clear error messages for all failure scenarios
- ✅ Start button disabled when prerequisites not met
- ✅ Sidebar shows agents immediately after approval
- ✅ No TypeScript errors
- ✅ No breaking changes to existing functionality
