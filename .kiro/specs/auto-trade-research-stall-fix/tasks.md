# Implementation Plan: AUTO-TRADE Research Stall Fix

## Overview

This implementation plan addresses the AUTO-TRADE research stall issue by implementing guaranteed state updates and history writes for all execution paths. The approach uses try-finally blocks to ensure timestamps and history are always updated, regardless of success, failure, or skip outcomes.

## Tasks

- [ ] 1. Implement State Update Coordinator
  - Create helper functions for guaranteed state updates
  - Implement `captureStartTime()` to capture execution start timestamp
  - Implement `updateStateGuaranteed()` to update timestamp and write history in finally block
  - Add `ExecutionResult` interface for tracking execution outcomes
  - _Requirements: 1.2, 4.1, 4.2, 4.3_

- [ ] 1.1 Write property test for State Update Coordinator
  - **Property 1: Timestamp Update Guarantee**
  - **Validates: Requirements 1.2, 4.2, 4.3**
  - Generate random execution outcomes (success/skip/error)
  - Verify timestamp is always updated regardless of outcome
  - Use fast-check with 100 iterations minimum

- [ ] 2. Implement History Writer
  - Extract history writing logic into dedicated function `writeHistoryGuaranteed()`
  - Implement `createHistoryEntry()` to create history from execution result
  - Handle history write failures gracefully (log but don't throw)
  - Ensure history is written for all execution outcomes (SUCCESS/SKIPPED/REJECTED/ERROR)
  - _Requirements: 1.3, 1.4, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 2.1 Write property test for History Writer
  - **Property 2: History Writing Guarantee**
  - **Validates: Requirements 1.3, 1.4, 3.1, 3.3, 3.4**
  - Generate random execution outcomes
  - Verify history is written with correct status for each outcome
  - Use fast-check with 100 iterations minimum

- [x] 3. Refactor processUserResearch with try-finally pattern
  - Wrap existing execution logic in try block
  - Add finally block that calls `updateStateGuaranteed()`
  - Capture `executionStartTime` before try block
  - Track execution result in variable accessible to finally block
  - Remove all manual state update calls from try block (centralize in finally)
  - _Requirements: 1.2, 1.3, 1.5, 4.2, 4.3_

- [ ] 3.1 Write unit tests for processUserResearch refactor
  - Test timestamp update on success path
  - Test timestamp update on skip path
  - Test timestamp update on error path
  - Test history write on success path
  - Test history write on skip path
  - Test history write on error path
  - _Requirements: 1.2, 1.3, 4.2, 4.3_

- [ ] 4. Implement Provider Validator
  - Create `validateProviders()` function with mode-based validation
  - For AUTO_TRADE_RESEARCH: require market data only (news optional)
  - For TELEGRAM_BACKGROUND_RESEARCH: require both market and news
  - Return validation result (don't throw exceptions)
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 4.1 Write property test for Provider Validator
  - **Property 3: Provider Validation for AUTO_TRADE**
  - **Validates: Requirements 2.1, 2.2**
  - Generate random provider configurations
  - Verify AUTO_TRADE proceeds with market data only
  - Use fast-check with 100 iterations minimum

- [ ] 4.2 Write property test for Provider Validation Failure Handling
  - **Property 4: Provider Validation Failure Handling**
  - **Validates: Requirements 2.4, 2.5**
  - Inject provider validation failures
  - Verify both history and timestamp are updated
  - Use fast-check with 100 iterations minimum

- [ ] 5. Integrate Provider Validator into processUserResearch
  - Call `validateProviders()` at start of execution
  - If validation fails, set execution result to SKIPPED with reason
  - Allow execution to continue to finally block for state updates
  - Remove existing provider validation that throws exceptions
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement Interval Manager
  - Add `frequencyMinutes` field to `UserJobState` interface
  - Implement `needsRecreation()` to check if interval needs recreation
  - Compare stored frequency and mode with new values
  - Only recreate interval if values differ
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 7.1 Write property test for Interval Stability
  - **Property 5: Interval Stability**
  - **Validates: Requirements 7.1, 7.2**
  - Call update function multiple times with same parameters
  - Verify interval ID remains unchanged
  - Use fast-check with 100 iterations minimum

- [ ] 7.2 Write property test for Interval Recreation
  - **Property 6: Interval Recreation on Change**
  - **Validates: Requirements 7.3, 7.4**
  - Change frequency or mode
  - Verify old interval is cleared and new one created
  - Use fast-check with 100 iterations minimum

- [ ] 8. Integrate Interval Manager into updateUserResearchSchedule
  - Store frequency and mode in `userJobStates` when creating interval
  - Call `needsRecreation()` before clearing interval
  - Only clear and recreate if `needsRecreation()` returns true
  - Log interval recreation for debugging
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 8.1 Write unit tests for Interval Manager integration
  - Test interval not recreated when frequency unchanged
  - Test interval not recreated when mode unchanged
  - Test interval recreated when frequency changes
  - Test interval recreated when mode changes
  - Test scheduler heartbeat doesn't recreate intervals
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 9. Implement Event Loop Protection
  - Verify batch processing uses BATCH_SIZE = 3
  - Verify `yieldToEventLoop()` is called between batches
  - Verify `withTimeout()` wrapper uses 90s limit for research execution
  - Add exception for AUTO_TRADE_RESEARCH when background tasks paused
  - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [ ] 9.1 Write property test for Event Loop Yielding
  - **Property 7: Event Loop Yielding**
  - **Validates: Requirements 8.2**
  - Monitor event loop during batch processing
  - Verify yield occurs between batches
  - Use fast-check with 100 iterations minimum

- [ ] 9.2 Write property test for AUTO_TRADE Bypass During Pause
  - **Property 10: AUTO_TRADE Bypass During Pause**
  - **Validates: Requirements 8.5**
  - Pause background tasks
  - Verify AUTO_TRADE research continues
  - Verify TELEGRAM research is blocked
  - Use fast-check with 100 iterations minimum

- [ ] 10. Update Diagnostic Logic
  - Verify diagnostic checks `lastResearchRunAt` age against 2× frequency
  - Verify diagnostic reports PASS when timestamp is fresh
  - Verify diagnostic reports STALLED when timestamp is stale
  - Verify diagnostic checks history count for execution detection
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 10.1 Write property test for Diagnostic Stall Detection
  - **Property 8: Diagnostic Stall Detection**
  - **Validates: Requirements 5.1, 5.2**
  - Generate random timestamp ages
  - Verify diagnostic correctly identifies stalls
  - Use fast-check with 100 iterations minimum

- [ ] 10.2 Write property test for History Count Monotonicity
  - **Property 9: History Count Monotonicity**
  - **Validates: Requirements 5.4, 5.5**
  - Run multiple research cycles
  - Verify history count increases after each cycle
  - Use fast-check with 100 iterations minimum

- [ ] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Integration Testing
  - [ ] 12.1 Test end-to-end stall fix
    - Start scheduler with AUTO_TRADE enabled
    - Inject various failure scenarios
    - Verify diagnostic never reports STALLED
    - Verify history count increases every cycle
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 5.4_

  - [ ] 12.2 Test provider validation integration
    - Configure user with market data only
    - Enable AUTO_TRADE mode
    - Verify research executes successfully
    - Verify history shows SUCCESS status
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [ ] 12.3 Test interval stability integration
    - Start scheduler with user
    - Run heartbeat multiple times
    - Verify interval not recreated
    - Verify research continues at correct frequency
    - _Requirements: 7.1, 7.2, 7.5_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement History Data Integrity Invariants
  - Add `validateAndCorrectHistoryEntry()` function to history writer
  - Implement validation: IF symbol !== "NO_RESEARCH" THEN accuracy > 0
  - Implement validation: IF researchExecuted === true THEN symbol !== "NO_RESEARCH"
  - Implement auto-correction: IF accuracy <= 0 THEN accuracy = 35
  - Add critical error logging when invariants are violated
  - Call validation before every history write (last line of defense)
  - _Requirements: 9.1, 9.2, 9.3, 9.7, 9.8_

- [ ] 14.1 Write property test for History Symbol Invariant
  - **Property 11: History Symbol Invariant**
  - **Validates: Requirements 9.1, 9.5**
  - Generate random research results
  - Verify symbol is never "NO_RESEARCH" when research executed
  - Use fast-check with 100 iterations minimum

- [ ] 14.2 Write property test for History Accuracy Invariant
  - **Property 12: History Accuracy Invariant**
  - **Validates: Requirements 9.2, 9.3**
  - Generate random history entries
  - Verify accuracy > 0 for all real coins
  - Verify fallback to 35 when accuracy <= 0
  - Use fast-check with 100 iterations minimum

- [ ] 15. Implement Weak Signal Preservation
  - Ensure HOLD signals with low accuracy are written to history
  - Remove any logic that downgrades weak signals to NO_RESEARCH
  - Verify weak signals are never skipped
  - Add logging for weak signal writes
  - _Requirements: 9.9, 9.10_

- [ ] 15.1 Write property test for Weak Signal Preservation
  - **Property 13: Weak Signal Preservation**
  - **Validates: Requirements 9.9, 9.10**
  - Generate research results with weak HOLD signals
  - Verify they are written to history (not skipped)
  - Use fast-check with 100 iterations minimum

- [ ] 16. Add Invariant Guards to saveAutoTradeHistorySkipped
  - Add assertion: IF researchExecuted === true THEN block write
  - Log critical warning if misuse detected
  - Prevent NO_RESEARCH writes after execution
  - _Requirements: 9.6_

- [ ] 16.1 Write property test for History Validation Auto-Correction
  - **Property 14: History Validation Auto-Correction**
  - **Validates: Requirements 9.7, 9.8**
  - Inject invalid history entries
  - Verify they are auto-corrected before write
  - Use fast-check with 100 iterations minimum

- [ ] 17. Update Scheduler to Track Research Execution State
  - Add `researchExecuted` flag to execution context
  - Set flag to true when research produces result
  - Pass flag to history writer for validation
  - Use flag to prevent misuse of skip functions
  - _Requirements: 9.1, 9.5, 9.6_

- [ ] 18. Final checkpoint - Ensure all invariant tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (100 iterations minimum)
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end scenarios
- All modifications must be made to existing files only (no new files or folders)
- Focus on minimal changes to achieve guaranteed state updates
