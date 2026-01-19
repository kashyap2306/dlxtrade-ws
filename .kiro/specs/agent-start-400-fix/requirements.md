# Agent Start 400 Error Fix - Requirements

## Problem Statement

Users experience repeated 400 Bad Request errors when attempting to start agents (Trading Agent, Liquidity Sweep Agent) even after admin approval. The root cause is a broken chain between approval and agent document creation.

### Current Broken Flow

1. **Admin Approval**: Updates `users/{uid}.approvedAgents` array in Firestore ✅
2. **Sidebar Display**: Reads `users/{uid}.approvedAgents` to show agent count ✅
3. **Start Button**: Enabled when `approvedAgents` contains agent key ✅
4. **Backend /start**: Calls `getUserTradingAgents(uid)` expecting `tradingAgents` collection document ❌
5. **Result**: 400 error because `tradingAgents` document doesn't exist ❌

### Evidence from Code

**Backend `/start` endpoint** (`dlxtrade-ws/src/routes/agents.ts:1221-1250`):
```typescript
const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
const targetAgent = activeAgent || userAgents[0];

if (!targetAgent?.id) {
  return reply.code(400).send({ 
    error: 'No Trading Agent configured. Please request agent approval from admin first.',
    code: 'AGENT_NOT_CONFIGURED'
  });
}
```

**Frontend Sidebar** (`frontend/src/components/Sidebar.tsx:120-125`):
```typescript
const approvedAgents = data?.approvedAgents || [];
const agents = Array.isArray(approvedAgents)
  ? approvedAgents.map((agentId: string) => ({
      id: agentId,
      path: `/agents/${agentId}`,
    }))
```

**Frontend Start Button** (`frontend/src/pages/TradingAgentControl.tsx:46-50`):
```typescript
const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes(approvalKey);
setHasAgentAccess(hasAccess);
```

### The Mismatch

- **Sidebar & Start Button**: Check `users/{uid}.approvedAgents` (approval flag)
- **Backend /start**: Checks `tradingAgents` collection (agent document)
- **Admin Approval**: Only updates `users/{uid}.approvedAgents`, never creates `tradingAgents` document

## User Stories

### 1. Admin Approval Creates Agent Document
**As an** admin  
**I want** agent approval to automatically create the required agent document  
**So that** users can immediately start their approved agents without 400 errors

**Acceptance Criteria:**
1.1. When admin approves Trading Agent, system creates `tradingAgents/{agentId}` document with:
   - `id`: Unique agent ID (e.g., `trading_agent_{uid}_{timestamp}`)
   - `userId`: User's UID
   - `name`: "Trading Agent"
   - `tradingPair`: "BTC/USDT"
   - `marketType`: "futures"
   - `strategyType`: "RSI_BOLLINGER"
   - `status`: "INACTIVE"
   - `createdAt`: Current timestamp
   - `updatedAt`: Current timestamp

1.2. When admin approves Liquidity Sweep Agent, system creates `tradingAgents/{agentId}` document with:
   - `id`: Unique agent ID (e.g., `liquidity_sweep_{uid}_{timestamp}`)
   - `userId`: User's UID
   - `name`: "Liquidity Sweep Agent"
   - `tradingPair`: "BTC/USDT"
   - `marketType`: "futures"
   - `strategyType`: "LIQUIDITY_SWEEP"
   - `status`: "INACTIVE"
   - `createdAt`: Current timestamp
   - `updatedAt`: Current timestamp

1.3. VWAP Strategy and Crowd Consensus do NOT require `tradingAgents` documents (they use runtime state)

1.4. Agent document creation happens atomically with approval flag update

1.5. If agent document already exists, approval only updates the approval flag

### 2. Backend Start Validation
**As a** backend service  
**I want** to validate agent existence before allowing start  
**So that** I return clear, actionable error messages

**Acceptance Criteria:**
2.1. `/start` endpoint checks both:
   - User has approval flag in `users/{uid}.approvedAgents`
   - Agent document exists in `tradingAgents` collection (for Trading Agent & Liquidity Sweep only)

2.2. If approval exists but agent document missing:
   - Return 400 with message: "Agent not configured. Please contact admin."
   - Include error code: `AGENT_DOCUMENT_MISSING`

2.3. If no approval:
   - Return 403 with message: "Agent access not granted yet"

2.4. If exchange not connected:
   - Return 400 with message: "Exchange not connected. Please connect an exchange in Settings first."

### 3. Frontend Start Button Validation
**As a** user  
**I want** the Start button to be disabled when prerequisites aren't met  
**So that** I don't encounter confusing 400 errors

**Acceptance Criteria:**
3.1. Start button disabled when:
   - Agent not approved (`approvedAgents` doesn't contain agent key)
   - Exchange not connected
   - Agent is already running

3.2. Start button shows tooltip explaining why it's disabled:
   - "Request approval from admin first"
   - "Connect exchange in Settings first"
   - "Agent is already running"

3.3. Start button enabled only when ALL prerequisites met:
   - Agent approved
   - Exchange connected
   - Agent not running

### 4. Consistent Agent Identification
**As a** system  
**I want** to use consistent agent identifiers across all components  
**So that** there are no mismatches between frontend and backend

**Acceptance Criteria:**
4.1. Agent key mapping is consistent:
   - Frontend: `TRADING_AGENT` → Backend: `trading-agent`
   - Frontend: `LIQUIDITY_SWEEP_AGENT` → Backend: `liquidity_sniper_arbitrage`
   - Frontend: `VWAP_STRATEGY` → Backend: `vwap-strategy`
   - Frontend: `COPY_TRADING_AGENT` → Backend: `crowd-consensus`

4.2. All components use the same mapping function (`agentKeyToSlug`)

4.3. Backend normalizes incoming agent IDs to approval keys for validation

## Non-Functional Requirements

### Performance
- Agent document creation must complete within 2 seconds
- Start endpoint must respond within 3 seconds

### Reliability
- Agent document creation must be atomic with approval
- If document creation fails, approval must be rolled back
- System must handle concurrent approval requests safely

### Security
- Only admins can approve agents
- Users can only start their own approved agents
- Agent documents must be scoped to user UID

## Constraints

### MUST NOT
- ❌ Auto-create agents inside `/start` or `/control` endpoints
- ❌ Bypass admin approval flow
- ❌ Add default agents or hidden logic
- ❌ Create new routes or files
- ❌ Modify folder structure
- ❌ Change system design

### MUST
- ✅ Fix approval → agent creation → start chain properly
- ✅ Modify existing code only
- ✅ Use same agentId everywhere (sidebar, control, start)
- ✅ Ensure ZERO 400 errors during valid start
- ✅ Maintain mobile + desktop compatibility

## Success Criteria

1. **Trading Agent**: No agent → Start disabled; Approved agent → Start returns 200
2. **Liquidity Sweep Agent**: Same behavior as Trading Agent
3. **Crowd Consensus**: Start button always clickable when allowed; API request fires correctly
4. **Sidebar**: Updates only after approval
5. **ZERO 400 errors** during valid start attempts
6. **No TypeScript errors** after implementation
