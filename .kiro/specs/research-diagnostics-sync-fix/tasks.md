# Implementation Plan: Research Diagnostics Sync Fix

## Overview

This implementation plan addresses the "Recent Cycle Results" UI bug by adding diagnostic entry creation to existing research cycle history saving functions. The approach ensures every research cycle outcome is written to both research_history (unchanged) and agentDiagnostics (new) collections.

## Tasks

- [-] 1. Create diagnostic entry creation function
  - Create `createDiagnosticFromHistory()` function in autoTradeHistory.ts
  - Implement data format conversion logic (symbol→tradingPair, signal→direction)
  - Handle all cycle outcomes (EXECUTED, SKIPPED, HOLD, FAILED)
  - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 1.1 Write property test for data format conversion
  - **Property 2: Data Format Conversion**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [ ] 2. Integrate diagnostic creation with executed/skipped cycles
  - [ ] 2.1 Modify saveAutoTradeHistoryWithExecutionStatus function
    - Add call to createDiagnosticFromHistory after research_history write
    - Map execution status and trade details to diagnostic format
    - Handle error cases gracefully (diagnostic write failures should not block history)
    - _Requirements: 1.1, 1.3, 2.1, 2.2_

  - [ ]* 2.2 Write property test for dual write consistency
    - **Property 1: Dual Write Consistency**
    - **Validates: Requirements 1.1, 1.3, 2.1, 2.2, 2.3, 2.4**

- [ ] 3. Integrate diagnostic creation with skipped cycles
  - [ ] 3.1 Modify saveAutoTradeHistorySkipped function
    - Add call to createDiagnosticFromHistory after research_history write
    - Map skip reasons to diagnostic decision.reason field
    - Handle exchange errors and system failures
    - _Requirements: 1.1, 1.3, 2.3, 2.4_

  - [ ]* 3.2 Write unit tests for skip reason mapping
    - Test exchange connection errors
    - Test API key missing scenarios
    - Test system failure cases
    - _Requirements: 2.3, 2.4_

- [ ] 4. Implement error handling and edge cases
  - [ ] 4.1 Add error handling for diagnostic write failures
    - Log diagnostic write errors without blocking research_history writes
    - Ensure research_history writes remain unchanged
    - Handle Firestore path validation
    - _Requirements: 4.1, 4.4_

  - [ ]* 4.2 Write property test for research history preservation
    - **Property 3: Research History Preservation**
    - **Validates: Requirements 4.1, 4.4**

- [ ] 5. Validate diagnostic entry structure and paths
  - [ ] 5.1 Ensure correct Firestore path format
    - Verify path: users/{uid}/agentDiagnostics/AUTO_TRADE_AGENT/entries/{autoId}
    - Use existing firestoreAdapter.saveAgentDiagnostic function
    - Include all required fields in diagnostic entries
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 5.2 Write property test for diagnostic entry completeness
    - **Property 4: Diagnostic Entry Completeness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Build and deployment validation
  - [ ] 7.1 Run TypeScript compilation
    - Execute `npm run build` to verify no compilation errors
    - Resolve any type definition issues
    - _Requirements: 6.1, 6.2_

  - [ ]* 7.2 Run existing test suite
    - Execute existing tests to ensure no regressions
    - Verify application starts without runtime errors
    - _Requirements: 6.3, 6.4_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The fix preserves all existing functionality while adding diagnostic sync
- No UI changes or new files are required beyond code modifications