# Agent Start 400 Error Fix - Tasks

## Task 1: Enhance Admin Approval Flow to Create Agent Documents

**File**: `frontend/src/pages/AdminUnlockRequests.tsx`

### Subtasks

- [ ] 1.1 Add agent document creation logic after approval flag update
  - Import `setDoc` from Firebase
  - Create agent document for TRADING_AGENT and LIQUIDITY_SWEEP_AGENT only
  - Use consistent naming: `trading_agent_{uid}_{timestamp}` or `liquidity_sweep_{uid}_{timestamp}`
  - Set initial status to INACTIVE
  - Include all required fields: id, userId, name, tradingPair, marketType, strategyType, status, createdAt, updatedAt

- [ ] 1.2 Add error handling for agent document creation
  - Wrap document creation in try-catch
  - Log errors but don't fail approval if document creation fails
  - Show warning toast if document creation fails

- [ ] 1.3 Skip agent document creation for VWAP_STRATEGY and COPY_TRADING_AGENT
  - Add conditional check for agent type
  - Only create documents for agents that need them

## Task 2: Remove Auto-Creation Logic from Backend Start Endpoint

**File**: `dlxtrade-ws/src/routes/agents.ts`

### Subtasks

- [ ] 2.1 Remove auto-creation logic for Liquidity Sweep Agent (lines 1260-1278)
  - Delete the entire auto-creation block
  - Replace with proper validation that returns 400/403 errors

- [ ] 2.2 Add validation to distinguish between "not approved" and "document missing"
  - Check `userHasAgentAccess` when `userAgents.length === 0`
  - Return 403 if not approved
  - Return 400 if approved but document missing

- [ ] 2.3 Apply same validation to Trading Agent start endpoint
  - Enhance existing validation at line 1240-1246
  - Add approval check before returning error
  - Return appropriate error code

## Task 3: Enhance Backend Error Messages and Codes

**File**: `dlxtrade-ws/src/routes/agents.ts`

### Subtasks

- [ ] 3.1 Add error codes to all start endpoint responses
  - `AGENT_NOT_APPROVED` for 403 responses
  - `AGENT_DOCUMENT_MISSING` for 400 responses when approval exists
  - `EXCHANGE_NOT_CONNECTED` for exchange validation failures
  - `AGENT_ALREADY_RUNNING` for duplicate start attempts

- [ ] 3.2 Improve error messages to be more actionable
  - "Agent access not granted yet. Please request approval from admin first."
  - "Agent document missing. Please contact admin to recreate your agent."
  - "Exchange not connected. Please connect an exchange in Settings first."

- [ ] 3.3 Apply consistent error handling to both Trading Agent and Liquidity Sweep Agent endpoints

## Task 4: Enhance Frontend Start Button Validation

**File**: `frontend/src/pages/TradingAgentControl.tsx`

### Subtasks

- [ ] 4.1 Add approval check to `handleToggleAutoTrade` function
  - Check `hasAgentAccess` before making API call
  - Show error toast if not approved

- [ ] 4.2 Add agent document check to `handleToggleAutoTrade` function
  - Check `resolvedAgentId` before making API call
  - Show error toast if document missing

- [ ] 4.3 Enhance button disabled state
  - Disable when `!hasAgentAccess`
  - Disable when `!resolvedAgentId`
  - Disable when `!isExchangeConnected(exchangeConfig).connected`
  - Disable when `togglingAutoTrade`

- [ ] 4.4 Add tooltips to explain why button is disabled
  - "Request approval from admin first" when not approved
  - "Agent not configured" when document missing
  - "Connect exchange in Settings first" when exchange not connected
  - "Agent is already running" when already active

## Task 5: Enhance Frontend Error Handling

**File**: `frontend/src/pages/TradingAgentControl.tsx`

### Subtasks

- [ ] 5.1 Add error code handling in catch block
  - Parse `err.response?.data?.code`
  - Show specific error messages based on error code

- [ ] 5.2 Map error codes to user-friendly messages
  - `AGENT_NOT_APPROVED` → "Please request agent approval from admin first."
  - `AGENT_DOCUMENT_MISSING` → "Agent configuration missing. Please contact admin."
  - `EXCHANGE_NOT_CONNECTED` → "Please connect your exchange in Settings first."

- [ ] 5.3 Apply same error handling to Liquidity Sweep Agent page
  - Ensure consistent error messages across all agent pages

## Task 6: Test Trading Agent Flow

### Subtasks

- [ ] 6.1 Test approval creates agent document
  - Approve Trading Agent in admin panel
  - Verify `tradingAgents/{agentId}` document created in Firestore
  - Verify document has correct fields and values

- [ ] 6.2 Test start endpoint with valid agent
  - Navigate to Trading Agent page
  - Verify Start button is enabled
  - Click Start button
  - Verify 200 response
  - Verify agent status updated to ACTIVE

- [ ] 6.3 Test start endpoint without approval
  - Remove approval flag from `users/{uid}.approvedAgents`
  - Navigate to Trading Agent page
  - Verify Start button is disabled
  - Verify tooltip shows "Request approval from admin first"

- [ ] 6.4 Test start endpoint without agent document
  - Keep approval flag but delete `tradingAgents/{agentId}` document
  - Navigate to Trading Agent page
  - Click Start button
  - Verify 400 response with code `AGENT_DOCUMENT_MISSING`
  - Verify error message is clear

- [ ] 6.5 Test start endpoint without exchange connection
  - Have approval and agent document
  - Remove exchange config
  - Click Start button
  - Verify 400 response with code `EXCHANGE_NOT_CONNECTED`
  - Verify error message is clear

## Task 7: Test Liquidity Sweep Agent Flow

### Subtasks

- [ ] 7.1 Test approval creates agent document
  - Approve Liquidity Sweep Agent in admin panel
  - Verify `tradingAgents/{agentId}` document created in Firestore
  - Verify document has correct fields and values

- [ ] 7.2 Test start endpoint with valid agent
  - Navigate to Liquidity Sweep Agent page
  - Verify Start button is enabled
  - Click Start button
  - Verify 200 response
  - Verify agent status updated to ACTIVE

- [ ] 7.3 Test start endpoint without approval
  - Remove approval flag
  - Verify Start button is disabled
  - Verify 403 error if API called directly

- [ ] 7.4 Test start endpoint without agent document
  - Keep approval flag but delete document
  - Verify 400 response with code `AGENT_DOCUMENT_MISSING`

## Task 8: Test VWAP Strategy and Crowd Consensus (No Document Required)

### Subtasks

- [ ] 8.1 Test VWAP Strategy approval does NOT create agent document
  - Approve VWAP Strategy in admin panel
  - Verify NO `tradingAgents/{agentId}` document created
  - Verify approval flag added to `users/{uid}.approvedAgents`

- [ ] 8.2 Test VWAP Strategy start endpoint works without document
  - Navigate to VWAP Strategy page
  - Click Start button
  - Verify 200 response
  - Verify agent starts successfully

- [ ] 8.3 Test Crowd Consensus approval does NOT create agent document
  - Approve Crowd Consensus in admin panel
  - Verify NO `tradingAgents/{agentId}` document created
  - Verify approval flag added to `users/{uid}.approvedAgents`

- [ ] 8.4 Test Crowd Consensus start endpoint works without document
  - Navigate to Crowd Consensus page
  - Click Start button
  - Verify 200 response
  - Verify agent starts successfully

## Task 9: Verify Sidebar Consistency

### Subtasks

- [ ] 9.1 Test sidebar shows agents immediately after approval
  - Approve any agent
  - Verify sidebar updates without page refresh
  - Verify agent count is correct

- [ ] 9.2 Test sidebar agent links work correctly
  - Click on agent in sidebar
  - Verify navigates to correct agent page
  - Verify page loads without errors

## Task 10: Final Verification

### Subtasks

- [ ] 10.1 Run TypeScript compiler
  - Execute `npm run build` in both frontend and backend
  - Verify ZERO TypeScript errors

- [ ] 10.2 Test all agent types end-to-end
  - Trading Agent: Approve → Start → Verify 200
  - Liquidity Sweep Agent: Approve → Start → Verify 200
  - VWAP Strategy: Approve → Start → Verify 200
  - Crowd Consensus: Approve → Start → Verify 200

- [ ] 10.3 Verify ZERO 400 errors for valid scenarios
  - All approved agents with connected exchanges should start successfully
  - No unexpected 400 errors in console or network tab

- [ ] 10.4 Verify error messages are clear and actionable
  - Test all error scenarios
  - Verify error messages guide users to fix the issue

- [ ] 10.5 Test on mobile and desktop
  - Verify button states work correctly on both platforms
  - Verify tooltips display correctly
  - Verify error messages are readable
