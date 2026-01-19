# Implementation Plan: Liquidity Sniper Start/Stop Fix

## Overview

This implementation plan fixes the critical bug where the Liquidity Sniper Arbitrage agent's start/stop endpoints are stub implementations. The fix involves modifying only the start and stop endpoint handlers in `dlxtrade-ws/src/routes/agents.ts` to persist agent state to Firestore using the existing `firestoreAdapter.updateAgentStatus()` method, following the exact pattern used by the Trading Agent.

## Tasks

- [x] 1. Implement start endpoint Firestore persistence
  - Modify the `POST /api/agents/:agentId/start` endpoint handler for `liquidity_sniper_arbitrage`
  - Add logic to get or create agent document using `getUserTradingAgents()` and `selectLiquiditySweepAgent()`
  - Add auto-creation of default agent document if none exists (same pattern as Trading Agent)
  - Add call to `updateAgentStatus(targetAgent.id, 'ACTIVE')` to persist state
  - Ensure agent document includes `type: 'liquidity_sweep'` field for scheduler filtering
  - Maintain existing access control and exchange validation logic
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ]* 1.1 Write property test for start endpoint agent creation
  - **Property 1: Start endpoint creates agent document with correct fields**
  - **Validates: Requirements 1.1, 1.2, 1.3**

- [ ]* 1.2 Write property test for start endpoint scheduler queryability
  - **Property 2: Start endpoint makes agent immediately queryable by scheduler**
  - **Validates: Requirements 1.4**

- [ ]* 1.3 Write property test for start endpoint idempotency
  - **Property 3: Start endpoint is idempotent**
  - **Validates: Requirements 1.5**

- [ ]* 1.4 Write unit tests for start endpoint edge cases
  - Test access control rejection (403 response)
  - Test exchange not connected rejection (400 response)
  - Test Firestore write failure (500 response)
  - Test agent creation when no agent exists
  - Test agent update when agent already exists
  - _Requirements: 5.1, 6.1_

- [x] 2. Implement stop endpoint Firestore persistence
  - Modify the `POST /api/agents/:agentId/stop` endpoint handler for `liquidity_sniper_arbitrage`
  - Add access control check using `AgentApprovalService.userHasAgentAccess()`
  - Add logic to get agent document using `getUserTradingAgents()` and `selectLiquiditySweepAgent()`
  - Add idempotent handling for missing agent (return success without error)
  - Add call to `updateAgentStatus(targetAgent.id, 'STOPPED')` to persist state
  - _Requirements: 2.1, 2.3, 2.4_

- [ ]* 2.1 Write property test for stop endpoint status update
  - **Property 4: Stop endpoint updates agent status to STOPPED**
  - **Validates: Requirements 2.1, 2.4**

- [ ]* 2.2 Write property test for state persistence across restarts
  - **Property 5: Agent state persists across backend restarts**
  - **Validates: Requirements 4.3**

- [ ]* 2.3 Write unit tests for stop endpoint edge cases
  - Test access control rejection (403 response)
  - Test idempotent behavior when no agent exists (200 response)
  - Test Firestore update failure (500 response)
  - Test status update when agent exists
  - _Requirements: 5.2, 6.1_

- [x] 3. Checkpoint - Verify implementation matches Trading Agent pattern
  - Compare start endpoint implementation with Trading Agent start endpoint (line ~1260-1280)
  - Compare stop endpoint implementation with Trading Agent stop endpoint (line ~1395-1410)
  - Verify both endpoints use the same Firestore adapter methods
  - Verify error handling matches Trading Agent pattern
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integration testing and verification
  - Manually test start endpoint from UI
  - Verify agent document created in Firestore with correct fields
  - Verify scheduler loads and executes agent
  - Manually test stop endpoint from UI
  - Verify agent document updated with status='STOPPED'
  - Verify scheduler stops executing agent
  - Test backend restart to verify state persistence
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation follows the exact pattern used by the Trading Agent
- Only one file is modified: `dlxtrade-ws/src/routes/agents.ts`
- No new files are created
- No scheduler logic is modified
- All existing helper functions and Firestore adapter methods are reused
