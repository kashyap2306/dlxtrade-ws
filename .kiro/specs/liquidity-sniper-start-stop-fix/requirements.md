# Requirements Document

## Introduction

This specification addresses the critical bug in the Liquidity Sniper Arbitrage agent where the start/stop endpoints are stub implementations that do not persist agent state to Firestore. This prevents the agent from executing even when users attempt to start it, as the scheduler cannot find the agent document.

## Glossary

- **Liquidity_Sniper_Agent**: The arbitrage trading agent that monitors liquidity sweeps
- **Firestore**: Cloud-based NoSQL database storing agent state and configuration
- **Trading_Agent_Scheduler**: Background service that loads and executes active agents
- **Agent_Document**: Firestore document in tradingAgents collection containing agent configuration and status
- **Agent_Status**: Enumeration of agent states (ACTIVE, STOPPED, ERROR)
- **Firestore_Adapter**: Service layer providing database operations for agent management
- **Start_Endpoint**: HTTP POST endpoint at `/api/agents/liquidity_sniper_arbitrage/start`
- **Stop_Endpoint**: HTTP POST endpoint at `/api/agents/liquidity_sniper_arbitrage/stop`

## Requirements

### Requirement 1: Start Endpoint Persistence

**User Story:** As a trader, I want the Liquidity Sniper agent to persist its active state when I click "Start", so that the agent executes trades even after backend restarts.

#### Acceptance Criteria

1. WHEN a user calls the Start_Endpoint, THE Start_Endpoint SHALL create or update an Agent_Document in the tradingAgents collection
2. WHEN the Start_Endpoint creates or updates an Agent_Document, THE Start_Endpoint SHALL set the status field to 'ACTIVE'
3. WHEN the Start_Endpoint creates an Agent_Document, THE Start_Endpoint SHALL set the type field to 'liquidity_sweep'
4. WHEN the Start_Endpoint completes successfully, THE Agent_Document SHALL be immediately queryable by the Trading_Agent_Scheduler
5. WHEN the Start_Endpoint is called multiple times, THE Start_Endpoint SHALL update the existing Agent_Document without creating duplicates

### Requirement 2: Stop Endpoint Persistence

**User Story:** As a trader, I want the Liquidity Sniper agent to persist its stopped state when I click "Stop", so that the agent does not execute trades until I start it again.

#### Acceptance Criteria

1. WHEN a user calls the Stop_Endpoint, THE Stop_Endpoint SHALL update the Agent_Document status to 'STOPPED'
2. WHEN the Stop_Endpoint updates the status, THE Trading_Agent_Scheduler SHALL exclude the agent from execution
3. WHEN the Stop_Endpoint is called on a non-existent agent, THE Stop_Endpoint SHALL handle the condition gracefully without errors
4. WHEN the Stop_Endpoint completes successfully, THE Agent_Document SHALL reflect status='STOPPED' immediately

### Requirement 3: Scheduler Integration

**User Story:** As a system operator, I want the Trading Agent Scheduler to load and execute the Liquidity Sniper agent when its status is ACTIVE, so that the agent operates automatically.

#### Acceptance Criteria

1. WHEN the Trading_Agent_Scheduler queries for active agents, THE Firestore_Adapter SHALL return Agent_Documents with status='ACTIVE'
2. WHEN an Agent_Document has status='ACTIVE' and type='liquidity_sweep', THE Trading_Agent_Scheduler SHALL load and execute the Liquidity_Sniper_Agent
3. WHEN an Agent_Document has status='STOPPED', THE Trading_Agent_Scheduler SHALL exclude it from execution
4. WHEN the backend restarts, THE Trading_Agent_Scheduler SHALL reload all Agent_Documents with status='ACTIVE'

### Requirement 4: State Consistency

**User Story:** As a trader, I want the frontend to display the correct agent status based on Firestore state, so that I know whether my agent is running or stopped.

#### Acceptance Criteria

1. WHEN the frontend queries agent status, THE system SHALL return the status from the Agent_Document in Firestore
2. WHEN the Agent_Document status changes, THE frontend SHALL reflect the updated status within the polling interval
3. WHEN the backend restarts, THE agent status SHALL remain consistent with the last persisted state
4. WHEN multiple users view the same agent, THE system SHALL display consistent status across all sessions

### Requirement 5: Error Handling

**User Story:** As a developer, I want proper error handling for start/stop operations, so that failures are logged and communicated to users.

#### Acceptance Criteria

1. WHEN the Start_Endpoint fails to write to Firestore, THE Start_Endpoint SHALL return an error response with status code 500
2. WHEN the Stop_Endpoint fails to update Firestore, THE Stop_Endpoint SHALL return an error response with status code 500
3. WHEN Firestore operations fail, THE system SHALL log the error with sufficient context for debugging
4. WHEN the Firestore_Adapter is unavailable, THE endpoints SHALL return descriptive error messages

### Requirement 6: Implementation Constraints

**User Story:** As a developer, I want to modify only the existing code following established patterns, so that the fix is minimal and maintainable.

#### Acceptance Criteria

1. THE implementation SHALL modify only the file `dlxtrade-ws/src/routes/agents.ts`
2. THE implementation SHALL use the existing Firestore_Adapter methods (updateAgentStatus or equivalent)
3. THE implementation SHALL follow the same pattern as the Trading Agent start/stop implementation
4. THE implementation SHALL NOT create new files or modify scheduler logic
5. THE implementation SHALL NOT add logging unless specifically required for error handling
