# Agent Start 400 Error - Root Cause Analysis and Fix

## Executive Summary

**Problem**: Users experience 400 Bad Request errors when starting Trading Agent and Liquidity Sweep Agent, even after admin approval.

**Root Cause**: Admin approval only updates `users/{uid}.approvedAgents` array but does NOT create the `tradingAgents/{agentId}` document that the `/start` endpoint expects.

**Solution**: Enhance admin approval flow to atomically create agent documents when approving Trading Agent or Liquidity Sweep Agent.

## Root Cause Evidence

### 1. Admin Approval Flow (Frontend)
**File**: `frontend/src/pages/AdminUnlockRequests.tsx:123-126`

```typescript
await updateDoc(userRef, {
  hasAgentAccess: true,
  approvedAgents: arrayUnion(request.agentType)  // ✅ Updates approval flag
});
// ❌ MISSING: No agent document creation
```

**Result**: Only updates `users/{uid}.approvedAgents` array, never creates `tradingAgents` document.

### 2. Sidebar Agent Display (Frontend)
**File**: `frontend/src/components/Sidebar.tsx:120-125`

```typescript
const approvedAgents = data?.approvedAgents || [];  // ✅ Reads approval flag
const agents = Array.isArray(approvedAgents)
  ? approvedAgents.map((agentId: string) => ({
      id: agentId,
      path: `/agents/${agentId}`,
    }))
```

**Result**: Sidebar shows agent because approval flag exists.

### 3. Start Button Validation (Frontend)
**File**: `frontend/src/pages/TradingAgentControl.tsx:46-50`

```typescript
const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes(approvalKey);
setHasAgentAccess(hasAccess);  // ✅ Enables start button
```

**Result**: Start button enabled because approval flag exists.

### 4. Backend Start Endpoint
**File**: `dlxtrade-ws/src/routes/agents.ts:1235-1246`

```typescript
const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);  // ❌ Expects tradingAgents document
const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
const targetAgent = activeAgent || userAgents[0];

if (!targetAgent?.id) {
  return reply.code(400).send({  // ❌ Returns 400 because document doesn't exist
    error: 'No Trading Agent configured. Please request agent approval from admin first.',
    code: 'AGENT_NOT_CONFIGURED'
  });
}
```

**Result**: Returns 400 because `getUserTradingAgents` returns empty array (no document exists).

### 5. Liquidity Sweep Agent Auto-Creation (Backend)
**File**: `dlxtrade-ws/src/routes/agents.ts:1260-1278`

```typescript
// Auto-create default agent if none exists
if (userAgents.length === 0) {
  logger.info({ uid: user.uid }, 'No liquidity sweep agents found, creating default agent');
  const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
  const defaultAgent = {
    id: `liquidity_sweep_${user.uid}_${Date.now()}`,
    userId: user.uid,
    name: 'Liquidity Sweep Agent',
    // ... rest of fields
  };
  await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
  userAgents = [defaultAgent];
}
```

**Result**: Liquidity Sweep Agent has hidden auto-creation logic that violates design constraints. Trading Agent does NOT have this, causing 400 errors.

## The Broken Chain

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin Approval                                                  │
│ ✅ Updates: users/{uid}.approvedAgents[]                        │
│ ❌ Missing: tradingAgents/{agentId} document creation           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Sidebar Display                                                 │
│ ✅ Reads: users/{uid}.approvedAgents[]                          │
│ ✅ Shows: Agent in sidebar                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Start Button                                                    │
│ ✅ Checks: users/{uid}.approvedAgents[]                         │
│ ✅ Enabled: Button is clickable                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Backend /start Endpoint                                         │
│ ❌ Reads: tradingAgents collection (expects document)           │
│ ❌ Finds: Empty array (document doesn't exist)                  │
│ ❌ Returns: 400 Bad Request                                     │
└─────────────────────────────────────────────────────────────────┘
```

## The Fix

### 1. Enhance Admin Approval Flow
**File**: `frontend/src/pages/AdminUnlockRequests.tsx`

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

### 2. Remove Auto-Creation Logic
**File**: `dlxtrade-ws/src/routes/agents.ts`

```typescript
// Remove auto-creation block (lines 1260-1278)
// Replace with proper validation:

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

### 3. Enhance Error Messages
**File**: `dlxtrade-ws/src/routes/agents.ts`

```typescript
if (!targetAgent?.id) {
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

### 4. Enhance Frontend Validation
**File**: `frontend/src/pages/TradingAgentControl.tsx`

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

## The Fixed Chain

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin Approval                                                  │
│ ✅ Updates: users/{uid}.approvedAgents[]                        │
│ ✅ Creates: tradingAgents/{agentId} document                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Sidebar Display                                                 │
│ ✅ Reads: users/{uid}.approvedAgents[]                          │
│ ✅ Shows: Agent in sidebar                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Start Button                                                    │
│ ✅ Checks: users/{uid}.approvedAgents[]                         │
│ ✅ Checks: resolvedAgentId (from slug)                          │
│ ✅ Checks: exchangeConnected                                    │
│ ✅ Enabled: Only when ALL checks pass                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Backend /start Endpoint                                         │
│ ✅ Reads: tradingAgents collection                              │
│ ✅ Finds: Agent document exists                                 │
│ ✅ Returns: 200 Success                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Files Modified

### Frontend
1. `frontend/src/pages/AdminUnlockRequests.tsx` - Add agent document creation
2. `frontend/src/pages/TradingAgentControl.tsx` - Enhance button validation and error handling

### Backend
1. `dlxtrade-ws/src/routes/agents.ts` - Remove auto-creation, enhance validation and error messages

## Testing Checklist

- [ ] Trading Agent: Approve → Verify document created → Start → Verify 200
- [ ] Liquidity Sweep Agent: Approve → Verify document created → Start → Verify 200
- [ ] VWAP Strategy: Approve → Verify NO document created → Start → Verify 200
- [ ] Crowd Consensus: Approve → Verify NO document created → Start → Verify 200
- [ ] No approval → Start button disabled → Verify 403 if API called
- [ ] Approval but no document → Verify 400 with clear error message
- [ ] No exchange connection → Verify 400 with clear error message
- [ ] ZERO 400 errors for valid scenarios
- [ ] ZERO TypeScript errors after implementation

## Success Criteria

✅ Admin approval creates agent documents for Trading Agent and Liquidity Sweep Agent  
✅ VWAP Strategy and Crowd Consensus do NOT get agent documents (not needed)  
✅ Backend /start endpoint validates both approval and document existence  
✅ Frontend Start button disabled when prerequisites not met  
✅ Clear, actionable error messages for all failure scenarios  
✅ ZERO 400 errors for approved agents with connected exchanges  
✅ No auto-creation logic in /start endpoint  
✅ No breaking changes to existing functionality  

## Spec Location

Full requirements, design, and tasks available at:
- `.kiro/specs/agent-start-400-fix/requirements.md`
- `.kiro/specs/agent-start-400-fix/design.md`
- `.kiro/specs/agent-start-400-fix/tasks.md`
