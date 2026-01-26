# Implementation Plan: HTF Trend Filter Per-Symbol Diagnostics

## Overview

This implementation modifies the existing HTF Trend Filter Agent execution logic to evaluate all allowed trading symbols and save separate diagnostic entries for each symbol. The fix involves extracting the current single-symbol evaluation logic into a multi-symbol loop while preserving the existing execution flow for the agent's configured trading pair.

## Tasks

- [x] 1. Extract and refactor HTF agent symbol evaluation logic
  - Identify the current HTF agent execution block in `agentExecutionService.ts` (lines 614-770)
  - Extract symbol evaluation logic into a reusable function
  - Modify the execution flow to iterate over all allowed symbols
  - _Requirements: 1.1, 1.2, 1.3_

- [ ]* 1.1 Write property test for multi-symbol evaluation coverage
  - **Property 1: Multi-Symbol Evaluation Coverage**
  - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 2. Implement per-symbol diagnostic persistence
  - [x] 2.1 Modify symbol evaluation loop to save diagnostics for each symbol
    - Call `firestoreAdapter.saveAgentDiagnostic()` for each evaluated symbol
    - Include symbol-specific data (tradingPair, direction, decision.reason)
    - Set appropriate status (SKIPPED or EXECUTED) and agentId
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property test for per-symbol diagnostic persistence
    - **Property 3: Per-Symbol Diagnostic Persistence**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

  - [x] 2.3 Ensure diagnostic entry uniqueness
    - Verify each symbol gets exactly one diagnostic entry per cycle
    - Prevent merging multiple symbols into single entries
    - Avoid storing diagnostics under AUTO_TRADE_CYCLE
    - _Requirements: 2.7, 2.8_

- [x] 3. Implement symbol-specific analysis results
  - [x] 3.1 Generate direction and decision reasons per symbol
    - Ensure each symbol gets its own direction determination (LONG/SHORT/NO_TRADE)
    - Create symbol-specific decision reasons based on individual analysis
    - Use existing HTFTrendFilterStrategy methods for analysis
    - _Requirements: 1.4, 1.5_

  - [ ]* 3.2 Write property test for symbol-specific analysis results
    - **Property 2: Symbol-Specific Analysis Results**
    - **Validates: Requirements 1.4, 1.5**

- [ ] 4. Checkpoint - Verify multi-symbol diagnostic saving
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement data validation and error handling
  - [ ] 5.1 Add data integrity validation
    - Validate all required fields are present before saving
    - Ensure symbol names are properly formatted (e.g., BTCUSDT)
    - Verify direction values are valid (LONG/SHORT/NO_TRADE)
    - Ensure decision reasons are meaningful and non-empty
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 5.2 Write property test for data integrity validation
    - **Property 5: Data Integrity Validation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ] 5.3 Implement error resilience
    - Handle symbol evaluation errors gracefully
    - Log errors and continue processing other symbols
    - Save appropriate diagnostic entries for both failed and successful evaluations
    - _Requirements: 5.5_

  - [ ]* 5.4 Write property test for error resilience
    - **Property 6: Error Resilience**
    - **Validates: Requirements 5.5**

- [ ] 6. Ensure frontend data compatibility
  - [ ] 6.1 Verify diagnostic data format matches frontend expectations
    - Ensure saved data allows frontend to display symbol-specific information
    - Verify direction and pair fields are populated for valid symbols
    - Test that frontend won't show "--" for valid symbol data
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 6.2 Write property test for frontend data compatibility
    - **Property 4: Frontend Data Compatibility**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [ ] 7. Integration and testing
  - [ ] 7.1 Test the complete HTF agent execution flow
    - Verify agent evaluates all allowed symbols (BTCUSDT, ETHUSDT)
    - Confirm separate diagnostic entries are saved for each symbol
    - Test that execution logic continues normally for configured pair
    - _Requirements: 1.1, 2.1, 2.7_

  - [ ]* 7.2 Write integration tests for complete flow
    - Test end-to-end symbol evaluation and diagnostic persistence
    - Verify interaction between symbol evaluation and execution logic
    - _Requirements: 1.1, 2.1, 2.7_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The fix modifies only existing files in `dlxtrade-ws/src/services/`
- No new files, folders, or Firestore collections are created
- Frontend remains unchanged and should work with the new diagnostic format