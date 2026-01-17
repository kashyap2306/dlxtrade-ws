# Implementation Plan: Agent System Comprehensive Fix

## Overview

This implementation plan addresses all agent-related issues in the DLXTrade trading platform. The tasks are organized to build incrementally, starting with backend persistence, then diagnostics, and finally frontend updates.

## Tasks

- [x] 1. Add VWAP State Persistence to FirestoreAdapter
  - [x] 1.1 Add saveVWAPAgentState method to firestoreAdapter.ts
    - Create method that saves VWAPPersistedState to `users/{uid}/agents/vwap_strategy`
    - Include all fields: agentId, userId, status, strategyType, exchange, startedAt, lastHeartbeat, stoppedAt, stoppedReason, stoppedForDayKey, dayKey, dayStartEquity, updatedAt
    - _Requirements: 1.1, 1.4, 9.5_
  
  - [x] 1.2 Add getVWAPAgentState method to firestoreAdapter.ts
    - Create method that retrieves VWAPPersistedState from `users/{uid}/agents/vwap_strategy`
    - Return null if document doesn't exist
    - _Requirements: 1.2, 1.3_
  
  - [x] 1.3 Add getAllRunningVWAPAgents method to firestoreAdapter.ts
    - Query all users collection for agents/vwap_strategy documents where status === 'RUNNING'
    - Return array of VWAPPersistedState objects
    - _Requirements: 9.1, 9.2_

- [x] 2. Update VWAPRuntimeService for Persistence
  - [x] 2.1 Add private saveState method to vwapRuntimeService.ts
    - Call firestoreAdapter.saveVWAPAgentState with current state
    - Handle errors gracefully (log and continue)
    - _Requirements: 1.1, 1.4_
  
  - [x] 2.2 Update startAgent to persist state
    - After setting in-memory state, call saveState
    - Ensure persistence completes before returning
    - _Requirements: 1.1, 9.5_
  
  - [x] 2.3 Update stopAgent to persist state
    - After setting in-memory state, call saveState
    - _Requirements: 1.4_
  
  - [x] 2.4 Update stopAgentForDay to persist state
    - After setting in-memory state with stoppedForDayKey, call saveState
    - _Requirements: 1.6_
  
  - [x] 2.5 Add loadPersistedStates method
    - Call firestoreAdapter.getAllRunningVWAPAgents
    - For each running agent, restore to in-memory Map
    - Respect stoppedForDayKey (skip if matches today)
    - _Requirements: 1.3, 9.1, 9.2, 9.3_
  
  - [x] 2.6 Add updateHeartbeat persistence
    - Update lastHeartbeat in Firestore when updateHeartbeat is called
    - _Requirements: 1.5_
  
  - [ ]* 2.7 Write property test for VWAP state persistence round-trip
    - **Property 1: VWAP State Persistence Round-Trip**
    - **Validates: Requirements 1.1, 1.4, 9.5**

- [x] 3. Checkpoint - Verify VWAP Persistence
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add Agent Diagnostics Storage to FirestoreAdapter
  - [x] 4.1 Add saveAgentDiagnostic method to firestoreAdapter.ts
    - Save diagnostic to `agentDiagnostics/{agentId}/logs/{auto-id}`
    - Include timestamp, agentId, agentType, decision, signal, execution
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 4.2 Add getAgentDiagnostics method to firestoreAdapter.ts
    - Query `agentDiagnostics/{agentId}/logs` ordered by timestamp desc
    - Default limit to 20
    - _Requirements: 2.6, 3.1_
  
  - [x] 4.3 Add cleanupOldDiagnostics method
    - Keep only last 100 diagnostics per agent
    - Delete older entries
    - _Requirements: 2.6_
  
  - [ ]* 4.4 Write property test for diagnostic log structure
    - **Property 6: Diagnostic Log Structure**
    - **Validates: Requirements 2.4**

- [x] 5. Update Schedulers to Store Diagnostics
  - [x] 5.1 Update tradingAgentScheduler to store diagnostics
    - After each agent execution, call firestoreAdapter.saveAgentDiagnostic
    - Include decision (TRADE/SKIP/STOPPED_FOR_DAY) and reason
    - _Requirements: 2.1_
  
  - [x] 5.2 Update VWAP execution in tradingAgentScheduler to store diagnostics
    - Store diagnostic for each VWAP agent cycle
    - Include runtime state in diagnostic
    - _Requirements: 2.2_
  
  - [x] 5.3 Update crowdConsensusScheduler to store diagnostics
    - Store diagnostic for each user's execution cycle
    - Include consensus voting results and skip reasons
    - _Requirements: 2.3, 5.4_
  
  - [ ]* 5.4 Write property test for scheduler diagnostic storage
    - **Property 5: Scheduler Diagnostic Storage**
    - **Validates: Requirements 2.1, 2.2, 2.3, 5.4**

- [x] 6. Update Diagnostics API Endpoints
  - [x] 6.1 Update GET /api/agents/:agentId/diagnostics for trading-agent
    - Include scheduler status from tradingAgentScheduler.getStatus()
    - Return diagnostics from firestoreAdapter.getAgentDiagnostics
    - _Requirements: 3.1, 3.4_
  
  - [x] 6.2 Update GET /api/agents/:agentId/diagnostics for liquidity_sniper_arbitrage
    - Include scheduler status from tradingAgentScheduler.getStatus()
    - Return diagnostics from firestoreAdapter.getAgentDiagnostics
    - _Requirements: 3.1, 3.4_
  
  - [x] 6.3 Update GET /api/agents/:agentId/diagnostics for vwap-strategy
    - Include scheduler status from tradingAgentScheduler.getStatus()
    - Include runtime state from vwapRuntimeService.getAgentState
    - Return diagnostics from firestoreAdapter.getAgentDiagnostics
    - _Requirements: 3.1, 3.2_
  
  - [x] 6.4 Verify GET /api/agents/crowd-consensus/diagnostics response
    - Ensure scheduler status is included
    - Ensure gate status is included
    - Ensure skip reasons are included
    - _Requirements: 3.3, 5.1, 5.2, 5.3_
  
  - [ ]* 6.5 Write property test for diagnostics API response structure
    - **Property 8: Diagnostics API Response Structure**
    - **Validates: Requirements 3.1**

- [x] 7. Checkpoint - Verify Backend Diagnostics
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Initialize VWAP State on Server Startup
  - [x] 8.1 Call loadPersistedStates in server.ts or app.ts
    - Import vwapRuntimeService
    - Call loadPersistedStates() after Firebase initialization
    - Log number of restored agents
    - _Requirements: 9.1, 9.2, 9.3_
  
  - [ ]* 8.2 Write property test for VWAP state restoration
    - **Property 2: VWAP State Restoration on Startup**
    - **Validates: Requirements 1.3, 9.1, 9.2**

- [x] 9. Update Frontend VWAPStrategy Page
  - [x] 9.1 Verify diagnostics section displays correctly
    - Ensure scheduler status shows RUNNING/NOT RUNNING
    - Ensure last scan time and next scan time display
    - Ensure recent cycle results table renders
    - _Requirements: 8.1, 8.4, 8.5_
  
  - [x] 9.2 Verify status reflects persisted state
    - On page load, status should match Firestore state
    - After refresh, status should persist
    - _Requirements: 1.2_

- [x] 10. Update Frontend TradingAgentControl Page
  - [x] 10.1 Verify diagnostics section displays for Trading Agent
    - Ensure scheduler status shows
    - Ensure recent cycle results table renders
    - _Requirements: 8.2, 8.4, 8.5_
  
  - [x] 10.2 Verify diagnostics section displays for Liquidity Sweep Agent
    - Ensure page title shows "Liquidity Sweep Agent" for liquidity_sniper_arbitrage route
    - Ensure diagnostics section renders
    - _Requirements: 4.1, 4.4, 8.2_
  
  - [x] 10.3 Verify Start/Stop buttons work for Liquidity Sweep Agent
    - Start button calls POST /api/agents/liquidity_sniper_arbitrage/start
    - Stop button calls POST /api/agents/liquidity_sniper_arbitrage/stop
    - _Requirements: 4.2, 4.3_
  
  - [x] 10.4 Handle no agent configured case
    - If no agent in Firestore, show appropriate message
    - Don't show blank page
    - _Requirements: 4.6_

- [x] 11. Update Frontend CrowdConsensus Page
  - [x] 11.1 Verify diagnostics section displays correctly
    - Ensure scheduler status shows
    - Ensure skip reasons display with correct styling
    - _Requirements: 8.3, 8.4, 8.5_
  
  - [x] 11.2 Verify consensus voting results display
    - Ensure voting results are shown in diagnostics
    - _Requirements: 5.1_

- [x] 12. Remove Deprecated Endpoint Calls
  - [x] 12.1 Audit frontend for deprecated endpoint usage
    - Search for /api/agents/unlock, /api/agents/unlocks, /api/agents/unlocked
    - Remove or replace with correct endpoints
    - _Requirements: 6.5_
  
  - [x] 12.2 Verify no 410 errors on page load
    - Test each agent page
    - Ensure no 410 responses in network tab
    - _Requirements: 6.1_

- [x] 13. Checkpoint - Verify Frontend Updates
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Build Verification
  - [x] 14.1 Run npm run build in dlxtrade-ws
    - Fix any TypeScript errors
    - Ensure build completes successfully
    - _Requirements: 7.1_
  
  - [x] 14.2 Run npm run build in frontend
    - Fix any TypeScript errors
    - Ensure build completes successfully
    - _Requirements: 7.2_

- [ ] 15. Final Integration Testing
  - [ ]* 15.1 Write integration test for VWAP end-to-end flow
    - Start agent, verify Firestore, simulate restart, verify restoration
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 9.1, 9.2_
  
  - [ ]* 15.2 Write integration test for diagnostics API
    - Call each agent's diagnostics endpoint
    - Verify response structure
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [ ]* 15.3 Write property test for API error-free responses
    - **Property 9: API Error-Free Responses**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 16. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
