# Requirements Document

## Introduction

The "Recent Cycle Results" UI displays no data even when auto-trade and research cycles are actively running. This occurs because research cycles write only to `users/{uid}/research_history` while the UI reads only from `users/{uid}/agentDiagnostics/{agentId}/entries`. This specification addresses the data synchronization gap by ensuring every research cycle outcome is also written to the diagnostics collection.

## Glossary

- **Research_Cycle**: An automated trading analysis cycle that produces BUY/SELL/HOLD signals
- **Diagnostics_Entry**: A record in the agentDiagnostics collection that the UI reads for display
- **Cycle_Outcome**: The final result of a research cycle (EXECUTED/SKIPPED/HOLD/FAILED)
- **Trading_Pair**: Symbol format used in diagnostics (e.g., BTC/USDT)
- **Symbol**: Symbol format used in research (e.g., BTCUSDT)
- **Agent_Diagnostic_Service**: The saveAgentDiagnostic() function that writes to diagnostics collection

## Requirements

### Requirement 1

**User Story:** As a trader, I want to see recent cycle results in the UI, so that I can monitor my automated trading activity.

#### Acceptance Criteria

1. WHEN a research cycle completes with any outcome, THE System SHALL create a corresponding diagnostics entry
2. WHEN the "Recent Cycle Results" UI loads, THE System SHALL display all recent cycle outcomes including HOLD and SKIPPED
3. WHEN a cycle is EXECUTED, SKIPPED, HOLD, or FAILED, THE System SHALL write the outcome to both research_history and agentDiagnostics
4. WHEN a user views the Recent Cycle Results, THE System SHALL show real-time updates without requiring page refresh

### Requirement 2

**User Story:** As a system administrator, I want all cycle outcomes to be consistently recorded, so that no trading activity goes untracked.

#### Acceptance Criteria

1. WHEN a research cycle produces a HOLD signal, THE System SHALL create a diagnostics entry with HOLD status
2. WHEN a research cycle is skipped due to accuracy threshold, THE System SHALL create a diagnostics entry with SKIPPED status
3. WHEN a research cycle fails due to exchange connectivity, THE System SHALL create a diagnostics entry with FAILED status and error details
4. WHEN exchange credentials are missing or invalid, THE System SHALL create a diagnostics entry with appropriate error reason

### Requirement 3

**User Story:** As a developer, I want data format consistency between research and diagnostics, so that the UI can properly display cycle information.

#### Acceptance Criteria

1. WHEN converting research data to diagnostics format, THE System SHALL map symbol (BTCUSDT) to tradingPair (BTC/USDT)
2. WHEN converting research signals, THE System SHALL map signal (BUY/SELL/HOLD) to direction field
3. WHEN recording skip reasons, THE System SHALL map skipReason/rejectReason to decision.reason field
4. WHEN recording execution status, THE System SHALL map SKIPPED/EXECUTED to executionStatus field
5. WHEN recording exchange errors, THE System SHALL map exchange failures to exchangeErrorReason field

### Requirement 4

**User Story:** As a system integrator, I want to preserve existing functionality, so that current research tracking continues to work.

#### Acceptance Criteria

1. THE System SHALL continue writing to research_history collection unchanged
2. THE System SHALL not modify existing UI components that read from agentDiagnostics
3. THE System SHALL not create new files or folders beyond necessary code modifications
4. THE System SHALL maintain backward compatibility with existing diagnostic data structure

### Requirement 5

**User Story:** As a developer, I want precise Firestore path targeting, so that diagnostics entries appear in the correct UI location.

#### Acceptance Criteria

1. WHEN writing diagnostics entries, THE System SHALL use exact path format: users/{uid}/agentDiagnostics/{agentId}/entries/{autoId}
2. WHEN generating entry IDs, THE System SHALL use consistent auto-generated document IDs
3. WHEN storing diagnostic data, THE System SHALL include all required fields: uid, agentId, tradingPair, direction, decision, executionStatus, cycleId, timestamp
4. WHEN handling exchange errors, THE System SHALL populate exchangeErrorReason field with specific error details

### Requirement 6

**User Story:** As a quality assurance engineer, I want the system to build successfully, so that the fix can be deployed without breaking existing functionality.

#### Acceptance Criteria

1. WHEN the fix is implemented, THE System SHALL pass npm run build without errors
2. WHEN TypeScript compilation occurs, THE System SHALL resolve all type definitions correctly
3. WHEN existing tests run, THE System SHALL maintain all current test passing status
4. WHEN the application starts, THE System SHALL initialize without runtime errors