# Requirements Document

## Introduction

This specification addresses the AUTO-TRADE research execution stall issue where the diagnostic reports "STALLED" even though the scheduler interval is running. The core problem is that research execution can be blocked by early returns in the execution path, preventing `lastResearchRunAt` from being updated and history from being written, while the interval continues to tick.

## Glossary

- **Scheduler**: THE backgroundResearchScheduler service that manages research intervals
- **Research_Execution**: THE processUserResearch function that performs actual research and updates state
- **Interval_Callback**: THE setInterval callback that fires at configured frequency
- **History_Entry**: THE Firestore document recording each research cycle result
- **Last_Run_Timestamp**: THE lastResearchRunAt field tracking when research last executed
- **Diagnostic**: THE /diagnostic-check endpoint that detects stalled research
- **Early_Return**: THE code path that exits processUserResearch before updating state
- **AUTO_TRADE_RESEARCH**: THE research mode for auto-trade execution
- **TELEGRAM_BACKGROUND_RESEARCH**: THE research mode for Telegram alerts only

## Requirements

### Requirement 1: Interval Callback Execution Guarantee

**User Story:** As a system operator, I want the interval callback to always execute research, so that the diagnostic never shows STALLED when the interval is running.

#### Acceptance Criteria

1. WHEN the interval callback fires, THE Scheduler SHALL call Research_Execution
2. WHEN Research_Execution is called, THE Scheduler SHALL update Last_Run_Timestamp regardless of execution result
3. WHEN Research_Execution completes, THE Scheduler SHALL write History_Entry with status (SUCCESS/SKIPPED/REJECTED)
4. WHEN Research_Execution encounters an error, THE Scheduler SHALL write History_Entry with status SKIPPED and error reason
5. WHEN multiple early returns exist, THE Scheduler SHALL ensure state updates occur before all return statements

### Requirement 2: Provider Validation for AUTO_TRADE_RESEARCH

**User Story:** As an auto-trade user, I want research to run with market data alone, so that missing news providers don't block execution.

#### Acceptance Criteria

1. WHEN mode is AUTO_TRADE_RESEARCH, THE Research_Execution SHALL NOT require news providers
2. WHEN mode is AUTO_TRADE_RESEARCH, THE Research_Execution SHALL proceed with market data providers only
3. WHEN mode is TELEGRAM_BACKGROUND_RESEARCH, THE Research_Execution SHALL require both market and news providers
4. WHEN provider validation fails, THE Research_Execution SHALL write History_Entry with SKIPPED status
5. WHEN provider validation fails, THE Research_Execution SHALL update Last_Run_Timestamp

### Requirement 3: History Writing Guarantee

**User Story:** As a system operator, I want history to be written every cycle, so that the diagnostic can detect real execution.

#### Acceptance Criteria

1. WHEN Research_Execution runs, THE Scheduler SHALL write History_Entry before returning
2. WHEN research succeeds, THE Scheduler SHALL write History_Entry with status SUCCESS
3. WHEN research is skipped, THE Scheduler SHALL write History_Entry with status SKIPPED and reason
4. WHEN research is rejected, THE Scheduler SHALL write History_Entry with status REJECTED and reason
5. WHEN History_Entry write fails, THE Scheduler SHALL log error but continue with state update

### Requirement 9: History Data Integrity Invariants

**User Story:** As a system operator, I want executed research to always write valid history data, so that the frontend can display accurate research results.

#### Acceptance Criteria

1. WHEN research executes AND produces a result, THE History_Writer SHALL write symbol as a real coin (never "NO_RESEARCH")
2. WHEN research executes AND produces a result, THE History_Writer SHALL write accuracy greater than zero
3. WHEN accuracy is zero or negative, THE History_Writer SHALL apply fallback accuracy of 35
4. WHEN research executes AND produces a result, THE History_Writer SHALL write signal as BUY, SELL, or HOLD
5. IF symbol equals "NO_RESEARCH", THEN research SHALL NOT have executed (system-level failure only)
6. WHEN saveAutoTradeHistorySkipped is called AND research executed, THE System SHALL log critical warning and block the write
7. WHEN writing History_Entry, THE History_Writer SHALL validate symbol is not "NO_RESEARCH" if accuracy is greater than zero
8. WHEN validation fails, THE History_Writer SHALL auto-correct data and log critical error
9. WHEN research produces HOLD signal with low accuracy, THE History_Writer SHALL write the entry (not skip it)
10. WHEN research produces weak signal, THE History_Writer SHALL write the entry with actual accuracy (not downgrade to NO_RESEARCH)

### Requirement 4: State Update Guarantee

**User Story:** As a system operator, I want lastResearchRunAt to update every cycle, so that the diagnostic accurately reflects execution timing.

#### Acceptance Criteria

1. WHEN Research_Execution starts, THE Scheduler SHALL capture current timestamp
2. WHEN Research_Execution completes, THE Scheduler SHALL update Last_Run_Timestamp with captured timestamp
3. WHEN Research_Execution encounters early return, THE Scheduler SHALL update Last_Run_Timestamp before returning
4. WHEN state update fails, THE Scheduler SHALL log error but not throw exception
5. WHEN interval fires, THE Scheduler SHALL update Last_Run_Timestamp within 5 seconds

### Requirement 5: Diagnostic Detection Accuracy

**User Story:** As a system operator, I want the diagnostic to accurately detect stalled research, so that I can identify real issues.

#### Acceptance Criteria

1. WHEN interval is running AND Last_Run_Timestamp updates, THE Diagnostic SHALL report status PASS
2. WHEN interval is running AND Last_Run_Timestamp is stale (> 2× frequency), THE Diagnostic SHALL report status STALLED
3. WHEN interval is not running, THE Diagnostic SHALL report status FAIL with reason "scheduler not running"
4. WHEN History_Entry count increases, THE Diagnostic SHALL report research is executing
5. WHEN History_Entry count is static, THE Diagnostic SHALL report research may be stalled

### Requirement 6: Early Return Elimination

**User Story:** As a developer, I want to eliminate early returns that prevent state updates, so that execution always completes the full cycle.

#### Acceptance Criteria

1. WHEN decryption failure occurs, THE Research_Execution SHALL write History_Entry before returning
2. WHEN background tasks are paused, THE Research_Execution SHALL write History_Entry before returning
3. WHEN no research is generated, THE Research_Execution SHALL write History_Entry before returning
4. WHEN execution error occurs, THE Research_Execution SHALL write History_Entry before returning
5. WHEN system UID is detected, THE Research_Execution SHALL write History_Entry before returning

### Requirement 7: Interval Stability

**User Story:** As a system operator, I want intervals to never be recreated unnecessarily, so that research runs at consistent frequency.

#### Acceptance Criteria

1. WHEN updateUserResearchSchedule is called, THE Scheduler SHALL NOT recreate interval if frequency unchanged
2. WHEN updateUserResearchSchedule is called, THE Scheduler SHALL NOT recreate interval if mode unchanged
3. WHEN frequency changes, THE Scheduler SHALL clear old interval and create new interval
4. WHEN mode changes, THE Scheduler SHALL clear old interval and create new interval
5. WHEN scheduler heartbeat runs, THE Scheduler SHALL NOT interfere with running intervals

### Requirement 8: Event Loop Protection

**User Story:** As a system operator, I want the scheduler to never block the event loop, so that API endpoints remain responsive.

#### Acceptance Criteria

1. WHEN checkAndScheduleUserResearch runs, THE Scheduler SHALL process users in batches of 3
2. WHEN processing user batch, THE Scheduler SHALL yield to event loop between batches
3. WHEN Research_Execution runs, THE Scheduler SHALL use withTimeout wrapper with 90s limit
4. WHEN event loop lag is detected, THE Scheduler SHALL pause background tasks
5. WHEN background tasks are paused, THE Scheduler SHALL NOT pause AUTO_TRADE_RESEARCH mode
