# Implementation Plan: Bitget Futures Execution Fix

## Overview

This implementation plan addresses the comprehensive audit and fix of Bitget trade execution issues to ensure reliable futures-only trading with zero spot dependency. The tasks are organized to systematically eliminate spot dependencies, standardize symbol handling, implement futures-only guards, and ensure all operations use futures endpoints exclusively.

## Tasks

- [x] 1. Audit and document current execution flows
  - Trace manual trade flow from routes to BitgetAdapter
  - Trace auto trade flow from scheduler to BitgetAdapter
  - Document all symbol conversion points
  - Document all API endpoint usage patterns
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Implement spot endpoint blocking for Bitget
  - [x] 2.1 Add spot endpoint detection in BitgetAdapter.request()
    - Modify request method to check for "/spot/" in endpoints
    - Throw SPOT_ENDPOINT_FORBIDDEN_FOR_BITGET error immediately
    - Ensure no silent fallback behavior
    - _Requirements: 2.5, 2.6, 4.1, 4.2, 4.3_
  
  - [x] 2.2 Write property test for spot endpoint blocking
    - **Property 1: Spot endpoint blocking for Bitget**
    - **Validates: Requirements 2.5, 2.6, 4.1, 4.2, 4.3**

- [x] 3. Fix symbol handling standardization
  - [x] 3.1 Ensure TradingAgentMarketProvider passes raw symbols to BitgetAdapter
    - Review all symbol passing points in TradingAgentMarketProvider
    - Ensure symbols remain in raw format (BTCUSDT) when passed to BitgetAdapter
    - Remove any symbol normalization outside of BitgetAdapter
    - _Requirements: 3.1, 3.3, 3.4_
  
  - [x] 3.2 Consolidate symbol normalization in BitgetAdapter only
    - Move all symbol format conversion logic to BitgetAdapter
    - Ensure normalizeFuturesSymbol() is used consistently
    - Remove symbol conversion from other components
    - _Requirements: 3.2, 3.5_
  
  - [x] 3.3 Write property test for symbol format preservation
    - **Property 2: Symbol format preservation**
    - **Validates: Requirements 3.1, 3.3, 3.4**

- [x] 4. Enforce futures-only operations
  - [x] 4.1 Fix TradingAgentMarketProvider market type defaults
    - Change default marketType from 'spot' to 'futures' for Bitget
    - Update constructor to enforce futures mode when exchange is Bitget
    - Add validation to reject spot market type for Bitget
    - _Requirements: 4.4, 4.5_
  
  - [x] 4.2 Update all Bitget operations to use futures endpoints
    - Ensure getTicker() uses /api/v2/mix/market/tickers
    - Ensure getKlines() uses /api/v2/mix/market/candles
    - Ensure getAccountBalance() uses getFuturesBalance()
    - Ensure placeOrder() uses futures order placement
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [x] 4.3 Write property test for futures endpoint enforcement
    - **Property 3: Futures endpoint enforcement**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

- [x] 5. Fix pre-execution validation logic
  - [x] 5.1 Update testOrderExecution to use futures data only
    - Modify validation logic to use futures ticker data
    - Remove spot market availability requirements
    - Ensure validation doesn't block on spot price fetch failures
    - _Requirements: 6.1, 6.2, 6.3_
  
  - [x] 5.2 Update trading condition validation to use futures data
    - Ensure all market data validation uses futures endpoints
    - Update connectivity tests to verify futures endpoints only
    - Remove spot market status dependencies
    - _Requirements: 6.4, 6.5_
  
  - [x] 5.3 Write property test for futures-only validation
    - **Property 4: Futures-only validation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 6. Remove spot price logic dependencies
  - [x] 6.1 Remove spot price checks from order preparation
    - Identify and remove spot price validation logic
    - Remove spot ticker validation for quantity/price/notional
    - Update order value calculations to use futures data only
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 6.2 Update price validation to use futures feeds only
    - Ensure price validation uses futures price data
    - Remove spot market status checks from market conditions
    - Update all calculation logic to ignore spot market entirely
    - _Requirements: 7.4, 7.5_
  
  - [x] 6.3 Write property test for futures data usage
    - **Property 5: Futures data usage in calculations**
    - **Validates: Requirements 7.3, 7.4, 7.5**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement execution monitoring and validation
  - [x] 8.1 Add API call monitoring for Bitget operations
    - Implement request interceptor to log all API calls
    - Add validation to ensure no "/spot/" endpoints are called
    - Add symbol format tracking through execution pipeline
    - _Requirements: 8.3, 8.4_
  
  - [x] 8.2 Write property test for execution monitoring compliance
    - **Property 6: Execution monitoring compliance**
    - **Validates: Requirements 8.3, 8.4**

- [x] 9. Integration testing and validation
  - [x] 9.1 Test manual trade execution end-to-end
    - Execute manual trades through the complete flow
    - Verify futures-only operation throughout
    - Validate no spot dependencies or failures
    - _Requirements: 8.1_
  
  - [x] 9.2 Test auto trade execution end-to-end
    - Execute auto trades through the complete flow
    - Verify futures-only operation throughout
    - Validate no spot dependencies or failures
    - _Requirements: 8.2_
  
  - [x] 9.3 Write integration tests for end-to-end execution
    - Test complete manual trade flow
    - Test complete auto trade flow
    - **Validates: Requirements 8.1, 8.2, 8.5**

- [x] 10. Final validation and cleanup
  - [x] 10.1 Verify all spot dependencies are eliminated
    - Run comprehensive audit of remaining spot references
    - Ensure all Bitget operations use futures endpoints
    - Validate symbol formats throughout pipeline
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 10.2 Update error handling and logging
    - Ensure clear error messages for spot endpoint attempts
    - Add logging for futures-only operation confirmation
    - Update error codes for better debugging
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks are comprehensive from start with full testing coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Integration tests validate end-to-end functionality
- All changes should be made to existing files only - no new files or folders
- Keep changes minimal and scoped to Bitget-specific issues
- Do not modify logic for other exchanges