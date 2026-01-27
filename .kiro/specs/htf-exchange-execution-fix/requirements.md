# HTF Trend Filter Agent Exchange Execution Fix - Requirements

## Overview
Fix persistent EXCHANGE_KEYS_NOT_DECRYPTED errors in HTF Trend Filter Agent caused by encryption secret changes, preventing exchange execution and health check failures.

## Problem Statement
The HTF Trend Filter Agent is experiencing consistent failures in:
- Test Exchange Execution → FAILED
- Manual Test Trade → FAILED  
- Live agent execution → SKIPPED with EXCHANGE_KEYS_NOT_DECRYPTED

**Root Cause**: The `decrypt()` function is being called with context "exchange" but the keyManager is skipping decryption for this context, returning null values for apiKey and secretKey. This causes OpenSSL "bad decrypt" errors when the ENCRYPTION_SECRET has changed after keys were encrypted.

## User Stories

### US-1: Exchange Key Decryption Context Fix
**As a** system administrator  
**I want** the keyManager to properly handle "exchange" context for decryption  
**So that** HTF agents can decrypt exchange credentials for live trading  

**Acceptance Criteria:**
- AC-1.1: keyManager.decrypt() allows "exchange" context alongside "user_request" and "background_job"
- AC-1.2: Exchange execution paths use valid decrypt context that doesn't get skipped
- AC-1.3: No more "decrypt() context skipped" logs for exchange operations

### US-2: Encryption Secret Consistency Detection
**As a** system administrator  
**I want** the system to detect when ENCRYPTION_SECRET has changed  
**So that** users are prompted to reconnect their exchange instead of seeing generic errors  

**Acceptance Criteria:**
- AC-2.1: Server boot computes and stores hash of ENCRYPTION_SECRET
- AC-2.2: Exchange config stores encryptionKeyHash when keys are encrypted
- AC-2.3: Decrypt operations detect hash mismatch and mark exchange as CORRUPTED
- AC-2.4: No retry attempts when encryption secret mismatch is detected

### US-3: Exchange Config Corruption Handling
**As a** user  
**I want** clear feedback when my exchange keys are corrupted due to encryption changes  
**So that** I know to reconnect my exchange instead of troubleshooting generic errors  

**Acceptance Criteria:**
- AC-3.1: Exchange config marked as status: "CORRUPTED" when decrypt fails with "bad decrypt"
- AC-3.2: Corrupted exchanges show reason: "ENCRYPTION_SECRET_CHANGED"
- AC-3.3: UI displays explicit message: "Exchange keys are invalid due to encryption secret change. Please reconnect exchange."
- AC-3.4: Test Exchange Execution and Manual Trade are disabled for corrupted exchanges

### US-4: Exchange Reconnect Enforcement
**As a** user  
**I want** the reconnect process to clear corrupted state and use current encryption secret  
**So that** my exchange works properly after reconnecting  

**Acceptance Criteria:**
- AC-4.1: Exchange reconnect deletes old encrypted keys completely
- AC-4.2: New keys encrypted with current ENCRYPTION_SECRET
- AC-4.3: New encryptionKeyHash saved with exchange config
- AC-4.4: Corrupted status and timestamps cleared on successful reconnect

### US-5: Agent Execution Guard Rails
**As a** system administrator  
**I want** agent execution to fail fast when exchange keys cannot be decrypted  
**So that** agents don't attempt invalid operations or show misleading status  

**Acceptance Criteria:**
- AC-5.1: Before initializing exchange adapter, assert apiKey !== null and secretKey !== null
- AC-5.2: If keys are null, return HARD FAIL with error: "EXCHANGE_KEYS_NOT_DECRYPTED"
- AC-5.3: No silent failures or generic "connection failed" messages
- AC-5.4: Agent diagnostics show exact reason for execution failure

### US-6: Health Check Accuracy
**As a** user  
**I want** test-exchange-execution to use the same key loading path as live agents  
**So that** health checks accurately reflect whether live trading will work  

**Acceptance Criteria:**
- AC-6.1: test-exchange-execution uses same decrypt context as live agent execution
- AC-6.2: Health check fails fast with clear reason if decrypt fails
- AC-6.3: No false positives where health check passes but live execution fails
- AC-6.4: Health check shows GREEN only when keys successfully decrypt AND exchange responds

### US-7: Manual Trade Consistency
**As a** user  
**I want** execute-manual-trade to use the same key validation as automated trading  
**So that** manual trades work if and only if automated trading would work  

**Acceptance Criteria:**
- AC-7.1: Manual trade uses same key loading and decrypt path as agent execution
- AC-7.2: Manual trade does not bypass decrypt guards or error handling
- AC-7.3: Manual trade errors match agent execution errors for same conditions
- AC-7.4: No swallowing of decrypt errors in manual trade flow

### US-8: UI Error Message Improvement
**As a** user  
**I want** specific error messages instead of generic "Exchange connection failed"  
**So that** I know exactly what action to take to fix the problem  

**Acceptance Criteria:**
- AC-8.1: Replace generic "Exchange connection failed" with specific backend error
- AC-8.2: Show "EXCHANGE_KEYS_NOT_DECRYPTED" when decryption fails
- AC-8.3: Show "ENCRYPTION_SECRET_CHANGED" when encryption secret mismatch detected
- AC-8.4: Show "EXCHANGE_CORRUPTED" when exchange marked as corrupted
- AC-8.5: Show "SYMBOL_NOT_TRADABLE" when trading pair is invalid

## Technical Requirements

### TR-1: KeyManager Context Validation
- Allow "exchange" as valid context in decrypt() function
- Update context validation to include ["user_request", "background_job", "exchange"]
- Remove skip logic for "exchange" context

### TR-2: Encryption Secret Consistency
- Store SERVER_BOOT_ENCRYPTION_HASH on server startup
- Add encryptionKeyHash field to exchange config documents
- Implement isEncryptionSecretChanged() function
- Detect OpenSSL "bad decrypt" errors and map to ENCRYPTION_SECRET_CHANGED

### TR-3: Exchange Config Corruption State
- Add exchangeStatus: "CORRUPTED" field to exchange config
- Add corruptedAt: timestamp field
- Add corruptedReason: string field (e.g., "ENCRYPTION_SECRET_CHANGED")
- Update isExchangeUsable() to check for corrupted status

### TR-4: Agent Execution Guards
- Add null checks for apiKey and secretKey before exchange adapter initialization
- Throw specific errors instead of allowing null values to propagate
- Update agent execution service to handle EXCHANGE_KEYS_NOT_DECRYPTED errors

### TR-5: UI Error Propagation
- Update exchange routes to return specific error codes
- Update frontend components to display specific error messages
- Remove generic error message fallbacks that hide root cause

## Success Criteria

### Functional Success
1. **Balance Fetch Continues Working**: Existing balance fetch operations remain unaffected
2. **Test Exchange Execution Shows GREEN**: When keys decrypt successfully, health check passes
3. **Manual Test Trade Reaches Exchange**: Manual trades successfully reach Bitget/exchange order endpoint
4. **No Decrypt Skipped Logs**: No more "decrypt() context skipped" logs for exchange operations
5. **No Crypto Key Errors**: No more "key argument must be of type string… Received null" errors

### Error Handling Success
1. **Clear Error Messages**: Users see specific error messages instead of generic failures
2. **Reconnect Guidance**: Users are explicitly told to reconnect exchange when keys are corrupted
3. **No Retry Loops**: System doesn't repeatedly attempt to decrypt corrupted keys
4. **Fast Failure**: Operations fail immediately when keys cannot be decrypted

### System Integrity Success
1. **No Data Corruption**: Encryption secret changes don't corrupt other user data
2. **Secure Key Handling**: New encryption maintains same security properties
3. **Backward Compatibility**: Existing valid keys continue to work
4. **Audit Trail**: Clear logs of when and why exchanges become corrupted

## Non-Functional Requirements

### Performance
- Encryption secret validation adds <10ms to server startup
- Key decryption performance unchanged for valid keys
- Corruption detection adds <5ms to exchange operations

### Security
- Corrupted keys are never exposed in logs or error messages
- Encryption secret hash is stored securely and not exposed
- Key decryption failures don't leak information about encryption secret

### Reliability
- System gracefully handles encryption secret rotation scenarios
- No cascading failures when one user's exchange becomes corrupted
- Recovery process (reconnect) is reliable and always works

### Maintainability
- Clear separation between encryption issues and network issues
- Comprehensive logging for troubleshooting encryption problems
- Error codes are consistent across all exchange operations

## Out of Scope

### Explicitly Not Included
1. **Automatic Key Migration**: System will not attempt to migrate keys encrypted with old secrets
2. **Multiple Encryption Secrets**: System will not support multiple encryption secrets simultaneously
3. **Key Recovery**: System will not provide any mechanism to recover corrupted keys
4. **Encryption Secret Rotation**: System will not provide automated encryption secret rotation
5. **Legacy Key Support**: System will not maintain backward compatibility with old encryption formats

### Future Considerations
1. **Encryption Secret Management**: Future work may include proper secret rotation procedures
2. **Key Backup/Restore**: Future work may include secure key backup mechanisms
3. **Multi-Environment Support**: Future work may include different encryption secrets per environment
4. **Audit Logging**: Future work may include comprehensive audit logs for all encryption operations