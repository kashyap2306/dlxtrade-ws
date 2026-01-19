# Design Document

## Overview

This design addresses the critical bug where the Liquidity Sniper Arbitrage agent's start/stop endpoints are stub implementations that return success messages without persisting state to Firestore. The fix involves implementing proper Firestore persistence using the existing `firestoreAdapter.updateAgentStatus()` method, following the same pattern as the Trading Agent.

The solution is minimal and surgical: modify only the start/stop endpoint handlers in `dlxtrade-ws/src/routes/agents.ts` to call the existing Firestore adapter methods. No new files, no scheduler changes, no new infrastructure.

## Architecture

### Current Architecture (Broken)

```
User clicks "Start" 
  → POST /api/agents/liquidity_sniper_arbitrage/start
  → Returns success message
  → ❌ NO Firestore write
  → ❌ Agent document not created/updated
  → ❌ Scheduler cannot find agent
  → ❌ Agent never executes
```

### Fixed Architecture

```
User clicks "Start"
  → POST /api/agents/liquidity_sniper_arbitrage/start
  → Access control check (AgentApprovalService)
  → Exchange connection validation
  → Get or create agent document
  → firestoreAdapter.updateAgentStatus(agentId, 'ACTIVE')
  → ✅ Agent document persisted with status='ACTIVE'
  → ✅ Scheduler loads agent on next cycle
  → ✅ Agent executes trades

User clicks "Stop"
  → POST /api/agents/liquidity_sniper_arbitrage/stop
  → Access control check (AgentApprovalService)
  → Get agent document (if exists)
  → firestoreAdapter.updateAgentStatus(agentId, 'STOPPED')
  → ✅ Agent document updated with status='STOPPED'
  → ✅ Scheduler excludes agent from execution
```

## Components and Interfaces

### Modified Component: agents.ts

**File**: `dlxtrade-ws/src/routes/agents.ts`

**Modified Endpoints**:

1. **POST /api/agents/:agentId/start** (when agentId === 'liquidity_sniper_arbitrage')
   - Current: Returns success without Firestore write
   - Fixed: Creates/updates agent document with status='ACTIVE'

2. **POST /api/agents/:agentId/stop** (when agentId === 'liquidity_sniper_arbitrage')
   - Current: Returns success without Firestore write
   - Fixed: Updates agent document with status='STOPPED'

### Existing Components (No Changes)

1. **firestoreAdapter.updateAgentStatus()**
   - Already exists and works correctly
   - Used by Trading Agent successfully
   - Signature: `async updateAgentStatus(agentId: string, status: 'ACTIVE' | 'PAUSED' | 'STOPPED'): Promise<void>`

2. **firestoreAdapter.getUserTradingAgents()**
   - Already exists and works correctly
   - Returns array of agent documents for a user
   - Signature: `async getUserTradingAgents(uid: string): Promise<any[]>`

3. **tradingAgentScheduler**
   - Already exists and works correctly
   - Loads agents with status='ACTIVE' from Firestore
   - No changes needed

4. **AgentApprovalService.userHasAgentAccess()**
   - Already exists and works correctly
   - Validates user has access to agent
   - No changes needed

## Data Models

### Agent Document Structure

**Collection**: `tradingAgents`
**Document ID**: `liquidity_sweep_${uid}_${timestamp}`

```typescript
{
  id: string;                    // Document ID
  userId: string;                // User UID
  name: string;                  // "Liquidity Sweep Agent"
  tradingPair: string;           // "BTC/USDT"
  marketType: string;            // "futures"
  strategyType: string;          // "LIQUIDITY_SWEEP"
  type: string;                  // "liquidity_sweep" (for scheduler filtering)
  status: 'ACTIVE' | 'STOPPED' | 'PAUSED';  // Agent execution status
  createdAt: Date;               // Creation timestamp
  updatedAt: Date;               // Last update timestamp
}
```

**Key Fields**:
- `status`: Controls whether scheduler executes the agent
- `type`: Set to 'liquidity_sweep' for scheduler filtering
- `userId`: Links agent to user for access control

## Implementation Details

### Start Endpoint Implementation

**Location**: `dlxtrade-ws/src/routes/agents.ts`, line ~1280-1295

**Current Code**:
```typescript
if (agentId === 'liquidity_sniper_arbitrage') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
  if (!hasAccess) {
    return reply.code(403).send({ 
      error: 'Liquidity Sweep Agent access not granted yet. Please request approval from admin first.',
      code: 'AGENT_NOT_APPROVED'
    });
  }

  const { firestoreAdapter } = await import('../services/firestoreAdapter');
  const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
  if (!exchangeConfig?.exchange) {
    return reply.code(400).send({ 
      error: 'Exchange not connected. Please connect an exchange in Settings first.',
      code: 'EXCHANGE_NOT_CONNECTED'
    });
  }

  logger.info({ uid: user.uid, mode: 'manual' }, 'Liquidity Sweep Agent started in manual mode - ARMED and waiting for signals');
  return { success: true, message: 'Liquidity Sweep Agent started successfully', mode: 'manual', status: 'ARMED' };
}
```

**Fixed Code**:
```typescript
if (agentId === 'liquidity_sniper_arbitrage') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
  if (!hasAccess) {
    return reply.code(403).send({ 
      error: 'Liquidity Sweep Agent access not granted yet. Please request approval from admin first.',
      code: 'AGENT_NOT_APPROVED'
    });
  }

  const { firestoreAdapter } = await import('../services/firestoreAdapter');
  const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
  if (!exchangeConfig?.exchange) {
    return reply.code(400).send({ 
      error: 'Exchange not connected. Please connect an exchange in Settings first.',
      code: 'EXCHANGE_NOT_CONNECTED'
    });
  }

  // Get or create agent document
  let userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
  let targetAgent = selectLiquiditySweepAgent(userAgents);
  
  // Auto-create default agent if none exists
  if (!targetAgent) {
    logger.info({ uid: user.uid }, 'No liquidity sweep agent found, creating default agent');
    const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
    const defaultAgent = {
      id: `liquidity_sweep_${user.uid}_${Date.now()}`,
      userId: user.uid,
      name: 'Liquidity Sweep Agent',
      tradingPair: 'BTC/USDT',
      marketType: 'futures',
      strategyType: 'LIQUIDITY_SWEEP',
      type: 'liquidity_sweep',
      status: 'STOPPED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
    targetAgent = defaultAgent;
  }

  // Update agent status to ACTIVE
  await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
  
  logger.info({ uid: user.uid, agentId: targetAgent.id, mode: 'manual' }, 'Liquidity Sweep Agent started in manual mode - ARMED and waiting for signals');
  return { success: true, message: 'Liquidity Sweep Agent started successfully', mode: 'manual', status: 'ARMED' };
}
```

**Key Changes**:
1. Get existing agent documents using `getUserTradingAgents()`
2. Use `selectLiquiditySweepAgent()` helper to find the right agent
3. Auto-create agent document if none exists (same pattern as Trading Agent)
4. Call `updateAgentStatus(targetAgent.id, 'ACTIVE')` to persist state
5. Include `type: 'liquidity_sweep'` field for scheduler filtering

### Stop Endpoint Implementation

**Location**: `dlxtrade-ws/src/routes/agents.ts`, line ~1408-1413

**Current Code**:
```typescript
if (agentId === 'liquidity_sniper_arbitrage') {
  // SYSTEM AGENT: Always return success (idempotent)
  logger.info({ uid: user.uid, agentId }, 'Liquidity Sweep Agent stopped successfully');
  return { success: true, message: 'Liquidity Sweep Agent stopped successfully' };
}
```

**Fixed Code**:
```typescript
if (agentId === 'liquidity_sniper_arbitrage') {
  const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
  if (!hasAccess) {
    return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
  }

  const { firestoreAdapter } = await import('../services/firestoreAdapter');
  const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
  const targetAgent = selectLiquiditySweepAgent(userAgents);
  
  // IDEMPOTENT: If no agent found, treat as already stopped
  if (!targetAgent?.id) {
    logger.info({ uid: user.uid, agentId }, 'Liquidity Sweep Agent stop called but no agent found - treating as already stopped');
    return { success: true, message: 'Liquidity Sweep Agent stopped successfully' };
  }

  await firestoreAdapter.updateAgentStatus(targetAgent.id, 'STOPPED');
  logger.info({ uid: user.uid, agentId: targetAgent.id }, 'Liquidity Sweep Agent stopped successfully');
  return { success: true, message: 'Liquidity Sweep Agent stopped successfully' };
}
```

**Key Changes**:
1. Add access control check (same as start endpoint)
2. Get existing agent documents using `getUserTradingAgents()`
3. Use `selectLiquiditySweepAgent()` helper to find the right agent
4. Handle missing agent gracefully (idempotent - already stopped)
5. Call `updateAgentStatus(targetAgent.id, 'STOPPED')` to persist state

### Helper Function (Already Exists)

**Function**: `selectLiquiditySweepAgent()`
**Location**: `dlxtrade-ws/src/routes/agents.ts`, line ~30-36

```typescript
const selectLiquiditySweepAgent = (userAgents: any[]) => {
  const agents = Array.isArray(userAgents) ? userAgents : [];
  const primary = agents.find((a: any) => String(a?.name || '').toLowerCase().includes('liquidity sweep'));
  if (primary) return primary;
  const fallback = agents.find((a: any) => String(a?.name || '').toLowerCase().includes('liquidity'));
  return fallback || null;
};
```

This helper already exists and correctly identifies liquidity sweep agents by name matching.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Start endpoint creates agent document with correct fields

*For any* user with liquidity sniper access and a connected exchange, when the start endpoint is called, the system should create or update an agent document in the tradingAgents collection with status='ACTIVE', type='liquidity_sweep', and all required fields (userId, name, tradingPair, marketType, strategyType).

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Start endpoint makes agent immediately queryable by scheduler

*For any* user with liquidity sniper access, after calling the start endpoint successfully, querying the tradingAgents collection with filters status='ACTIVE' and type='liquidity_sweep' should return the agent document.

**Validates: Requirements 1.4**

### Property 3: Start endpoint is idempotent

*For any* user with liquidity sniper access, calling the start endpoint multiple times should result in exactly one agent document in the tradingAgents collection (no duplicates created).

**Validates: Requirements 1.5**

### Property 4: Stop endpoint updates agent status to STOPPED

*For any* user with an active liquidity sniper agent, when the stop endpoint is called, the agent document status field should be updated to 'STOPPED' and be immediately queryable with that status.

**Validates: Requirements 2.1, 2.4**

### Property 5: Agent state persists across backend restarts

*For any* user with an active liquidity sniper agent, after starting the agent and simulating a backend restart (re-querying Firestore), the agent document should still exist with status='ACTIVE'.

**Validates: Requirements 4.3**

## Error Handling

### Start Endpoint Error Handling

1. **Access Control Failure**
   - Condition: User does not have liquidity_sniper_arbitrage access
   - Response: 403 Forbidden with error message
   - Message: "Liquidity Sweep Agent access not granted yet. Please request approval from admin first."

2. **Exchange Not Connected**
   - Condition: User has not connected an exchange
   - Response: 400 Bad Request with error message
   - Message: "Exchange not connected. Please connect an exchange in Settings first."

3. **Firestore Write Failure**
   - Condition: updateAgentStatus() throws an error
   - Response: 500 Internal Server Error
   - Logging: Error logged with uid, agentId, and error message
   - Message: "Error starting agent"

### Stop Endpoint Error Handling

1. **Access Control Failure**
   - Condition: User does not have liquidity_sniper_arbitrage access
   - Response: 403 Forbidden with error message
   - Message: "Liquidity Sweep Agent access not granted yet"

2. **Agent Not Found (Idempotent)**
   - Condition: No agent document exists for user
   - Response: 200 OK with success message
   - Behavior: Treat as already stopped (idempotent)
   - Logging: Info log indicating agent not found but treating as success

3. **Firestore Update Failure**
   - Condition: updateAgentStatus() throws an error
   - Response: 500 Internal Server Error
   - Logging: Error logged with uid, agentId, and error message
   - Message: "Error stopping agent"

### Error Propagation

All Firestore errors are propagated from `firestoreAdapter.updateAgentStatus()`:
- The method already includes try-catch with error logging
- Errors are re-thrown to the caller
- Endpoint handlers catch errors and return 500 responses

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

**Unit Tests** (specific examples and edge cases):
- Test start endpoint with no existing agent (creates new agent)
- Test start endpoint with existing agent (updates existing agent)
- Test stop endpoint with existing agent (updates status)
- Test stop endpoint with no agent (idempotent success)
- Test access control rejection (403 responses)
- Test exchange not connected rejection (400 responses)
- Test Firestore write failures (500 responses)

**Property Tests** (universal properties across all inputs):
- Property 1: Start creates agent with correct fields (all users)
- Property 2: Start makes agent queryable by scheduler (all users)
- Property 3: Start is idempotent (all users, multiple calls)
- Property 4: Stop updates status to STOPPED (all users)
- Property 5: State persists across restarts (all users)

### Property-Based Testing Configuration

**Library**: Use existing test framework (likely Jest with custom property test helpers)

**Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: **Feature: liquidity-sniper-start-stop-fix, Property {number}: {property_text}**

**Test Data Generation**:
- Generate random user UIDs
- Generate random agent IDs
- Generate random timestamps
- Mock Firestore responses for deterministic testing

### Integration Testing

**Manual Testing Steps**:
1. Start liquidity sniper agent from UI
2. Verify agent document created in Firestore with status='ACTIVE'
3. Verify scheduler loads and executes agent
4. Stop liquidity sniper agent from UI
5. Verify agent document updated with status='STOPPED'
6. Verify scheduler stops executing agent
7. Restart backend
8. Verify agent state persists (still STOPPED)
9. Start agent again
10. Verify agent resumes execution

**Firestore Verification Queries**:
```javascript
// Verify agent document exists with correct status
db.collection('tradingAgents')
  .where('userId', '==', uid)
  .where('type', '==', 'liquidity_sweep')
  .where('status', '==', 'ACTIVE')
  .get()

// Verify no duplicate agents
db.collection('tradingAgents')
  .where('userId', '==', uid)
  .where('type', '==', 'liquidity_sweep')
  .get()
  .then(snapshot => snapshot.size === 1)
```

## Implementation Constraints

1. **File Modification**: Only modify `dlxtrade-ws/src/routes/agents.ts`
2. **No New Files**: Do not create any new files
3. **No Scheduler Changes**: Do not modify `tradingAgentScheduler` or related scheduler code
4. **Use Existing Methods**: Use `firestoreAdapter.updateAgentStatus()` and `firestoreAdapter.getUserTradingAgents()`
5. **Follow Existing Pattern**: Match the Trading Agent start/stop implementation exactly
6. **Minimal Logging**: Only add logging for error cases (success logging already exists)
7. **Idempotency**: Stop endpoint must be idempotent (safe to call multiple times)

## Rollout Plan

1. **Code Review**: Review changes against Trading Agent implementation
2. **Unit Tests**: Run unit tests to verify basic functionality
3. **Property Tests**: Run property tests to verify universal correctness
4. **Manual Testing**: Test start/stop from UI with Firestore verification
5. **Scheduler Verification**: Verify scheduler loads and executes agent
6. **Backend Restart Test**: Verify state persists across restarts
7. **Deploy**: Deploy to production
8. **Monitor**: Monitor logs for any errors or unexpected behavior

## Success Criteria

1. ✅ Start endpoint creates/updates agent document in Firestore
2. ✅ Start endpoint sets status='ACTIVE' and type='liquidity_sweep'
3. ✅ Stop endpoint updates agent document status='STOPPED'
4. ✅ Scheduler loads and executes agent when status='ACTIVE'
5. ✅ Scheduler stops executing agent when status='STOPPED'
6. ✅ State persists across backend restarts
7. ✅ Frontend shows correct status based on Firestore state
8. ✅ No duplicate agent documents created
9. ✅ Stop endpoint is idempotent (safe to call multiple times)
10. ✅ All error cases handled gracefully with appropriate status codes
