# Requirements Document

## Introduction

This document specifies the requirements for fixing all agent-related issues in the DLXTrade trading platform. The system has four trading agents (TRADING_AGENT, VWAP_STRATEGY, LIQUIDITY_SWEEP_AGENT, COPY_TRADING_AGENT) that need to work end-to-end with proper state persistence, diagnostics, and error-free operation.

## Glossary

- **Agent**: An automated trading bot that executes trades based on specific strategies
- **VWAP_Runtime_Service**: The in-memory service managing VWAP Strategy agent state
- **Firestore_Adapter**: The data access layer for persisting agent state to Firebase Firestore
- **Scheduler**: A 5-minute interval service that executes agent trading logic
- **Diagnostics**: Logs capturing scheduler cycles, decisions, and execution results
- **Agent_Slug**: The URL-friendly identifier for an agent (e.g., 'vwap-strategy', 'trading-agent')
- **Agent_Key**: The Firestore approval key for an agent (e.g., 'VWAP_STRATEGY', 'TRADING_AGENT')

## Requirements

### Requirement 1: VWAP State Persistence

**User Story:** As a user, I want my VWAP Strategy auto-trade state to persist across page refreshes and server restarts, so that I don't have to manually restart it.

#### Acceptance Criteria

1. WHEN a user starts VWAP Strategy, THE VWAP_Runtime_Service SHALL save the running state to Firestore at `users/{uid}/agents/vwap_strategy`
2. WHEN a user refreshes the page, THE Frontend SHALL display status RUNNING if the persisted state shows RUNNING
3. WHEN the server restarts, THE VWAP_Runtime_Service SHALL load persisted state from Firestore and resume running agents
4. WHEN a user stops VWAP Strategy, THE VWAP_Runtime_Service SHALL save the stopped state to Firestore
5. WHEN the VWAP scheduler executes a cycle, THE System SHALL update the lastHeartbeat timestamp in Firestore
6. IF the persisted state has stoppedForDayKey matching today's date, THEN THE System SHALL keep the agent stopped until the next day

### Requirement 2: Agent Diagnostics Storage

**User Story:** As a user, I want to see diagnostics for all four agents showing scheduler status, last scan time, next scan time, and cycle results.

#### Acceptance Criteria

1. WHEN the Trading_Agent_Scheduler executes a cycle, THE System SHALL store a diagnostic log entry in Firestore
2. WHEN the VWAP_Scheduler executes a cycle, THE System SHALL store a diagnostic log entry in Firestore
3. WHEN the Crowd_Consensus_Scheduler executes a cycle, THE System SHALL store a diagnostic log entry in Firestore
4. THE Diagnostic_Log SHALL include: timestamp, agentId, decision (EXECUTED/SKIPPED/STOPPED_FOR_DAY), reason, and signal details
5. THE Diagnostic_Reasons SHALL include: NO_SIGNAL, RR_TOO_LOW, RISK_LIMIT, SESSION_FILTER, EXCHANGE_ERROR, DAILY_LIMIT_REACHED
6. WHEN diagnostics are requested, THE System SHALL return the most recent 20 entries by default

### Requirement 3: Diagnostics API Response

**User Story:** As a user, I want all agent diagnostics endpoints to return consistent scheduler status information.

#### Acceptance Criteria

1. WHEN GET /api/agents/:agentId/diagnostics is called, THE Response SHALL include scheduler status (isRunning, lastExecutionAt, nextExecutionAt)
2. WHEN GET /api/agents/:agentId/diagnostics is called for vwap-strategy, THE Response SHALL include runtime state (status, stoppedReason, stoppedForDayKey)
3. WHEN GET /api/agents/:agentId/diagnostics is called for crowd-consensus, THE Response SHALL include gate status (READY, AUTO_TRADE_DISABLED, EXCHANGE_NOT_CONNECTED, DAILY_LIMIT_REACHED)
4. WHEN GET /api/agents/:agentId/diagnostics is called for trading-agent or liquidity_sniper_arbitrage, THE Response SHALL include scheduler status from tradingAgentScheduler

### Requirement 4: Liquidity Sweep Agent Page

**User Story:** As a user with LIQUIDITY_SWEEP_AGENT access, I want the /agents/liquidity_sniper_arbitrage page to render properly with working controls.

#### Acceptance Criteria

1. WHEN a user with LIQUIDITY_SWEEP_AGENT access visits /agents/liquidity_sniper_arbitrage, THE Page SHALL render with title "Liquidity Sweep Agent"
2. WHEN the Start Trading button is clicked, THE System SHALL call POST /api/agents/liquidity_sniper_arbitrage/start
3. WHEN the Stop Trading button is clicked, THE System SHALL call POST /api/agents/liquidity_sniper_arbitrage/stop
4. THE Page SHALL display a Diagnostics section showing recent cycle results
5. THE Page SHALL display a Today Trades section showing trades for this agent
6. IF no agent is configured in Firestore, THEN THE Page SHALL display an appropriate message instead of blank content

### Requirement 5: Crowd Consensus Diagnostics

**User Story:** As a user, I want to see detailed diagnostics for Crowd Consensus showing voting/execution/skip reasons.

#### Acceptance Criteria

1. WHEN GET /api/agents/crowd-consensus/diagnostics is called, THE Response SHALL include consensus voting results
2. WHEN GET /api/agents/crowd-consensus/diagnostics is called, THE Response SHALL include execution status
3. WHEN GET /api/agents/crowd-consensus/diagnostics is called, THE Response SHALL include skip reasons (NO_CONSENSUS, RR_TOO_LOW, ENTRY_LATE, SR_BLOCKED, DAILY_LIMIT_REACHED, EXCHANGE_ERROR)
4. THE Crowd_Consensus_Scheduler SHALL store skipped trade entries with reason and signal details

### Requirement 6: Zero Console/Network Errors

**User Story:** As a user, I want all agent pages to load without console errors or network errors (410, 400, 403).

#### Acceptance Criteria

1. WHEN any agent page loads, THE System SHALL NOT return 410 errors for any agent endpoint
2. WHEN any agent page loads, THE System SHALL NOT return 400 errors unless user input is invalid
3. WHEN a user with proper agent access loads an agent page, THE System SHALL NOT return 403 errors
4. IF an API call fails, THEN THE Frontend SHALL display an appropriate error message to the user
5. THE Frontend SHALL NOT make API calls to deprecated endpoints (e.g., /api/agents/unlock, /api/agents/unlocks)

### Requirement 7: Build Success

**User Story:** As a developer, I want the build to pass with zero errors.

#### Acceptance Criteria

1. WHEN `npm run build` is executed in dlxtrade-ws, THE Build SHALL complete successfully with zero TypeScript errors
2. WHEN `npm run build` is executed in frontend, THE Build SHALL complete successfully with zero TypeScript errors
3. THE System SHALL NOT have any runtime console errors during normal operation
4. THE System SHALL NOT have any unhandled promise rejections

### Requirement 8: Frontend Diagnostics Display

**User Story:** As a user, I want each agent page to display a Diagnostics section below Today Trades.

#### Acceptance Criteria

1. THE VWAPStrategy Page SHALL display a Diagnostics section with scheduler status and recent cycle results
2. THE TradingAgentControl Page SHALL display a Diagnostics section with scheduler status and recent cycle results
3. THE CrowdConsensus Page SHALL display a Diagnostics section with scheduler status and recent cycle results
4. THE Diagnostics Section SHALL show: Scheduler status (RUNNING/STOPPED), Last scan time, Next scan time
5. THE Diagnostics Section SHALL show recent cycle results with: timestamp, result (EXECUTED/SKIPPED/STOPPED_FOR_DAY), reason

### Requirement 9: VWAP Scheduler Integration

**User Story:** As a system operator, I want the VWAP scheduler to properly integrate with persisted state on server startup.

#### Acceptance Criteria

1. WHEN the server starts, THE VWAP_Runtime_Service SHALL load all persisted VWAP agent states from Firestore
2. WHEN loading persisted state, THE System SHALL resume agents that were RUNNING before server restart
3. WHEN loading persisted state, THE System SHALL respect stoppedForDayKey and keep agents stopped if the key matches today
4. THE VWAP_Scheduler SHALL only execute agents that are in RUNNING state in the runtime service
5. WHEN a VWAP agent is started via API, THE System SHALL immediately persist the state to Firestore before returning success
