# HTF Trend Filter Agent Exchange Execution Fix - Tasks

## Task Overview
Fix persistent EXCHANGE_KEYS_NOT_DECRYPTED errors in HTF Trend Filter Agent by implementing proper encryption secret consistency handling and exchange corruption detection.

## Implementation Tasks

### 1. KeyManager Context Fix
- [ ] 1.1 Update allowed contexts in keyManager.decrypt()
  - [ ] 1.1.1 Add "exchange" to allowedContexts array in decrypt() function
  - [ ] 1.1.2 Add "exchange" to allowedContexts array in decryptOrThrow() function
  - [ ] 1.1.3 Update context validation error messages to include "exchange"
  - [ ] 1.1.4 Add unit tests for "exchange" context validation

### 2. Encryption Secret Consistency Detection
- [ ] 2.1 Implement server boot encryption hash storage
  - [ ] 2.1.1 Add SERVER_BOOT_ENCRYPTION_HASH variable to keyManager
  - [ ] 2.1.2 Store encryption hash in initializeEncryptionKey() function
  - [ ] 2.1.3 Add checkEncryptionSecretConsistency() function
  - [ ] 2.1.4 Add logging for encryption key consistency checks

- [ ] 2.2 Enhance decrypt() function for encryption secret change detection
  - [ ] 2.2.1 Detect OpenSSL "bad decrypt" errors in decrypt() function
  - [ ] 2.2.2 Throw ENCRYPTION_SECRET_CHANGED error for bad decrypt
  - [ ] 2.2.3 Add detailed error logging for encryption secret mismatches
  - [ ] 2.2.4 Add unit tests for encryption secret change detection

- [ ] 2.3 Add encryption key hash to exchange config
  - [ ] 2.3.1 Store encryptionKeyHash in exchange connect endpoint
  - [ ] 2.3.2 Add isEncryptionSecretChanged() validation function
  - [ ] 2.3.3 Update exchange config schema documentation
  - [ ] 2.3.4 Add migration handling for existing configs without hash

### 3. Exchange Config Corruption State
- [ ] 3.1 Implement exchange corruption tracking
  - [ ] 3.1.1 Add markExchangeAsCorrupted() function to firestoreAdapter
  - [ ] 3.1.2 Add exchangeStatus, corruptedAt, corruptedReason fields to schema
  - [ ] 3.1.3 Update isExchangeUsable() to check for corrupted status
  - [ ] 3.1.4 Add unit tests for corruption state management

- [ ] 3.2 Implement corruption cleanup on reconnect
  - [ ] 3.2.1 Clear corruption fields in exchange connect endpoint
  - [ ] 3.2.2 Delete old encrypted keys completely on reconnect
  - [ ] 3.2.3 Store new encryptionKeyHash with fresh keys
  - [ ] 3.2.4 Add integration tests for reconnect corruption cleanup

### 4. Agent Execution Guards
- [ ] 4.1 Add pre-execution key validation in agentExecutionService
  - [ ] 4.1.1 Add null checks for apiKey and secretKey before adapter init
  - [ ] 4.1.2 Handle ENCRYPTION_SECRET_CHANGED errors in agent execution
  - [ ] 4.1.3 Call markExchangeAsCorrupted() when encryption secret changed
  - [ ] 4.1.4 Update agent diagnostics to show specific corruption reasons

- [ ] 4.2 Enhance agent execution error handling
  - [ ] 4.2.1 Replace generic EXCHANGE_ERROR with specific error codes
  - [ ] 4.2.2 Add EXCHANGE_CORRUPTED skip reason for corrupted exchanges
  - [ ] 4.2.3 Update finalizeSkip() calls with proper error categories
  - [ ] 4.2.4 Add unit tests for agent execution guard rails

### 5. Exchange Route Enhancements
- [ ] 5.1 Fix test-exchange-execution endpoint
  - [ ] 5.1.1 Use "exchange" context in decryptOrThrow() calls
  - [ ] 5.1.2 Handle ENCRYPTION_SECRET_CHANGED errors specifically
  - [ ] 5.1.3 Mark exchange as corrupted when encryption secret changed
  - [ ] 5.1.4 Return specific error messages instead of generic failures

- [ ] 5.2 Fix execute-manual-trade endpoint
  - [ ] 5.2.1 Use "exchange" context in decryptOrThrow() calls
  - [ ] 5.2.2 Handle ENCRYPTION_SECRET_CHANGED errors specifically
  - [ ] 5.2.3 Mark exchange as corrupted when encryption secret changed
  - [ ] 5.2.4 Return specific error messages instead of generic failures

- [ ] 5.3 Fix exchange balance endpoint
  - [ ] 5.3.1 Use "exchange" context in decrypt() calls
  - [ ] 5.3.2 Handle corruption detection in balance fetch
  - [ ] 5.3.3 Return specific error codes for different failure types
  - [ ] 5.3.4 Add integration tests for balance endpoint error handling

### 6. UI Error Message Enhancement
- [ ] 6.1 Update ExchangeHealthCheck component
  - [ ] 6.1.1 Add getErrorMessage() function for specific error mapping
  - [ ] 6.1.2 Display "reconnect exchange" message for corruption errors
  - [ ] 6.1.3 Show specific error instead of generic "connection failed"
  - [ ] 6.1.4 Add visual indicators for corrupted exchange state

- [ ] 6.2 Update SettingsExchangeSection component
  - [ ] 6.2.1 Add corruption state detection and display
  - [ ] 6.2.2 Disable test buttons when exchange is corrupted
  - [ ] 6.2.3 Show reconnect required message for corrupted exchanges
  - [ ] 6.2.4 Add alert component for corruption notifications

- [ ] 6.3 Update TradingAgentControl component
  - [ ] 6.3.1 Display specific agent execution failure reasons
  - [ ] 6.3.2 Show exchange corruption status in agent diagnostics
  - [ ] 6.3.3 Add reconnect guidance for agents with corrupted exchanges
  - [ ] 6.3.4 Update agent status indicators for corruption states

### 7. Testing and Validation
- [ ] 7.1 Unit tests for keyManager changes
  - [ ] 7.1.1 Test "exchange" context validation
  - [ ] 7.1.2 Test encryption secret change detection
  - [ ] 7.1.3 Test ENCRYPTION_SECRET_CHANGED error throwing
  - [ ] 7.1.4 Test encryptionKeyHash generation and validation

- [ ] 7.2 Integration tests for exchange corruption
  - [ ] 7.2.1 Test agent execution with corrupted exchange
  - [ ] 7.2.2 Test exchange reconnect corruption cleanup
  - [ ] 7.2.3 Test UI error message display for corruption
  - [ ] 7.2.4 Test health check accuracy with corrupted exchanges

- [ ] 7.3 End-to-end testing
  - [ ] 7.3.1 Simulate encryption secret change scenario
  - [ ] 7.3.2 Verify agent execution fails gracefully
  - [ ] 7.3.3 Test exchange reconnect resolves corruption
  - [ ] 7.3.4 Confirm UI shows specific error messages

### 8. Documentation and Monitoring
- [ ] 8.1 Update API documentation
  - [ ] 8.1.1 Document new error codes and responses
  - [ ] 8.1.2 Document exchange corruption state fields
  - [ ] 8.1.3 Document encryption secret consistency requirements
  - [ ] 8.1.4 Add troubleshooting guide for encryption issues

- [ ] 8.2 Add monitoring and alerting
  - [ ] 8.2.1 Add metrics for exchange corruption rate
  - [ ] 8.2.2 Add alerts for high encryption secret change frequency
  - [ ] 8.2.3 Add logging for encryption consistency checks
  - [ ] 8.2.4 Add dashboard for exchange health monitoring

## Property-Based Testing Tasks

### 9. Correctness Properties
- [ ] 9.1 Write property test for encryption consistency
  - **Validates: Requirements AC-2.2, AC-2.3**
  - Property: For any valid exchange config with encryptionKeyHash, decrypt should succeed if and only if current encryption secret matches stored hash
  - Test strategy: Generate exchange configs with various encryption key hashes and verify decrypt behavior

- [ ] 9.2 Write property test for corruption state transitions
  - **Validates: Requirements AC-3.1, AC-4.3**
  - Property: Exchange corruption state transitions are monotonic - once corrupted, only reconnect can clear corruption
  - Test strategy: Generate sequences of operations (decrypt failures, reconnects) and verify state transitions

- [ ] 9.3 Write property test for agent execution guards
  - **Validates: Requirements AC-5.1, AC-5.2**
  - Property: Agent execution with null keys always fails with EXCHANGE_KEYS_NOT_DECRYPTED, never proceeds to exchange operations
  - Test strategy: Generate various combinations of null/valid keys and verify execution behavior

- [ ] 9.4 Write property test for error message consistency
  - **Validates: Requirements AC-8.1, AC-8.2, AC-8.3**
  - Property: Same underlying error condition always produces same error message across all endpoints
  - Test strategy: Generate error conditions and verify consistent error messages across test-exchange, manual-trade, and agent execution

## Task Dependencies

### Critical Path
1. **KeyManager Context Fix (1.1)** → **Agent Execution Guards (4.1)** → **Exchange Route Enhancements (5.1, 5.2)**
2. **Encryption Secret Detection (2.2)** → **Exchange Corruption State (3.1)** → **UI Error Enhancement (6.1, 6.2)**
3. **All Core Changes** → **Testing and Validation (7.1, 7.2, 7.3)**

### Parallel Work Streams
- **Stream A**: KeyManager and encryption secret detection (Tasks 1, 2)
- **Stream B**: Exchange corruption state and agent guards (Tasks 3, 4)  
- **Stream C**: UI enhancements and error messages (Task 6)
- **Stream D**: Testing and validation (Task 7)

### Prerequisites
- All tasks require understanding of current encryption system
- UI tasks require backend error handling to be complete
- Testing tasks require all implementation tasks to be complete
- Property-based testing requires core functionality to be implemented

## Success Criteria Validation

### Functional Validation
- [ ] Balance fetch operations continue working without regression
- [ ] Test Exchange Execution shows GREEN when keys decrypt successfully
- [ ] Manual Test Trade reaches exchange endpoint when keys are valid
- [ ] No "decrypt() context skipped" logs for exchange operations
- [ ] No "key argument must be of type string… Received null" errors

### Error Handling Validation  
- [ ] Users see "Exchange keys are invalid due to encryption secret change. Please reconnect exchange." for corrupted exchanges
- [ ] Test buttons are disabled for corrupted exchanges
- [ ] Agent execution shows specific failure reasons instead of generic errors
- [ ] System doesn't retry operations with corrupted keys

### System Integrity Validation
- [ ] Encryption secret changes don't affect other users' exchanges
- [ ] Exchange reconnect always clears corruption state
- [ ] New keys are always encrypted with current encryption secret
- [ ] Audit trail shows when and why exchanges become corrupted

## Risk Mitigation

### High Risk Items
1. **Breaking existing decrypt operations**: Mitigated by careful context validation testing
2. **Data corruption during migration**: Mitigated by non-destructive corruption marking
3. **Performance impact of encryption checks**: Mitigated by minimal overhead design
4. **User confusion about reconnect requirement**: Mitigated by clear error messages

### Rollback Plan
- All changes are additive and backward compatible
- Corruption state fields are optional and don't break existing functionality
- KeyManager context changes are safe additions to allowed contexts
- UI changes gracefully degrade to existing error handling