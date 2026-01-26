# Implementation Plan: HTF Trend Filter Diagnostics Aggregation

## Overview

This implementation adds client-side aggregation logic to group HTF diagnostic entries by research cycle and display only one row per cycle in the frontend UI. The fix involves modifying the existing diagnostic display components to aggregate multiple diagnostic entries into single rows with detailed information accessible through an expandable interface.

## Tasks

- [ ] 1. Implement diagnostic cycle identification and grouping
  - [ ] 1.1 Create cycle identification logic
    - Implement grouping by cycleId (primary method)
    - Add fallback grouping by researchId
    - Add timestamp window + symbol grouping as final fallback
    - Handle cases where diagnostic entries have different identification patterns
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 1.2 Write property test for cycle identification completeness
    - **Property 2: Cycle Identification Completeness**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [ ] 1.3 Implement diagnostic aggregation by cycle
    - Group all diagnostic entries by identified research cycle
    - Ensure all entries from the same cycle are properly grouped
    - Handle edge cases like missing identifiers or orphaned entries
    - _Requirements: 1.4, 2.4, 2.5_

  - [ ]* 1.4 Write property test for single row per cycle guarantee
    - **Property 1: Single Row Per Cycle Guarantee**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [ ] 2. Implement primary diagnostic selection logic
  - [ ] 2.1 Create priority-based selection algorithm
    - Prioritize EXECUTED status over SKIPPED status
    - Use latest timestamp as tiebreaker for same priority entries
    - Select diagnostic with most complete data when priorities are equal
    - Ensure deterministic selection behavior
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 Write property test for primary diagnostic selection consistency
    - **Property 3: Primary Diagnostic Selection Consistency**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

  - [ ] 2.3 Extract primary diagnostic data for table display
    - Use primary diagnostic's pair and direction for table row
    - Ensure pair and direction fields are never "--" for valid cycles
    - Extract decision reason from primary diagnostic
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 3. Implement details aggregation and storage
  - [ ] 3.1 Create details array from non-primary diagnostics
    - Merge all non-primary diagnostics into details array
    - Preserve all diagnostic information for troubleshooting
    - Organize details by type (indicator analysis, lifecycle, errors)
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [ ]* 3.2 Write property test for details preservation completeness
    - **Property 4: Details Preservation Completeness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

  - [ ] 3.3 Filter internal lifecycle entries from main display
    - Hide EXECUTION_STARTED from standalone rows
    - Hide FORCE_CREATE_DIAGNOSTIC from standalone rows
    - Hide CREDENTIALS_DECRYPT_FAILED from standalone rows
    - Include lifecycle entries only in details view
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 3.4 Write property test for internal entry filtering
    - **Property 6: Internal Entry Filtering**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [ ] 4. Checkpoint - Verify aggregation logic
  - Ensure all aggregation tests pass, ask the user if questions arise.

- [ ] 5. Implement enhanced UI with details access
  - [ ] 5.1 Modify table rendering for aggregated rows
    - Update diagnostic table to display aggregated data
    - Show one row per research cycle per symbol
    - Ensure professional appearance with clean, non-duplicated rows
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ] 5.2 Add details icon to Decision column
    - Add small info icon (ⓘ) for cycles with details
    - Make icon clickable and intuitive
    - Position icon appropriately within Decision column
    - _Requirements: 5.1, 5.6_

  - [ ] 5.3 Implement details modal or expandable section
    - Create modal or expandable interface for detailed breakdown
    - Display all indicator analysis results (EMA, RSI, Volume, SR)
    - Show rejection/confirmation status for each indicator
    - Include credential issues if any exist
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [ ] 5.4 Ensure UI data integrity
    - Verify pair and direction are populated from primary diagnostic
    - Ensure no "--" values for valid trading cycles
    - Maintain professional and consistent display quality
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [ ]* 5.5 Write property test for UI data integrity
    - **Property 5: UI Data Integrity**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [ ] 6. Integration and error handling
  - [ ] 6.1 Implement error handling for aggregation failures
    - Handle missing cycle identifiers gracefully
    - Manage malformed diagnostic entries
    - Provide fallbacks for primary selection failures
    - Log errors appropriately without breaking UI
    - _Requirements: 2.5, 3.5, 4.5_

  - [ ] 6.2 Add performance optimizations
    - Optimize aggregation for large diagnostic datasets
    - Implement efficient grouping algorithms
    - Consider lazy loading for very large detail arrays
    - _Performance considerations_

  - [ ] 6.3 Test complete integration flow
    - Verify end-to-end flow from API fetch to UI display
    - Test user interactions with details modal/expandable
    - Ensure data consistency between aggregated and original diagnostics
    - _Requirements: 1.1, 5.1, 5.2, 7.4_

- [ ] 7. Final validation and testing
  - [ ] 7.1 Validate all requirements are met
    - Confirm exactly one row per research cycle per symbol
    - Verify details are accessible through intuitive interface
    - Ensure professional appearance and data integrity
    - Test that internal lifecycle entries are properly filtered
    - _All requirements validation_

  - [ ] 7.2 Run comprehensive test suite
    - Execute all unit tests for aggregation logic
    - Run property tests for universal correctness
    - Perform integration tests for complete user experience
    - _Testing validation_

  - [ ] 7.3 Performance and usability testing
    - Test with realistic diagnostic data volumes
    - Verify UI responsiveness and interaction quality
    - Ensure details modal/expandable works smoothly
    - _User experience validation_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation and user feedback
- The fix modifies only existing frontend code, no backend changes required
- No new APIs, folders, or schema changes are needed
- Focus on minimal, targeted changes to existing diagnostic display logic
- Property tests validate universal correctness across all possible diagnostic combinations
- Integration tests ensure complete user experience works correctly