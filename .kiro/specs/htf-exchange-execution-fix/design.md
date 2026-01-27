# HTF Trend Filter Agent Exchange Execution Fix - Design

## Architecture Overview

This design addresses the persistent EXCHANGE_KEYS_NOT_DECRYPTED errors by implementing a comprehensive encryption secret consistency system and proper exchange corruption handling.

### Core Components

1. **KeyManager Enhancement**: Allow "exchange" context and detect encryption secret changes
2. **Exchange Config Corruption State**: Track and handle corrupted exchange configurations
3. **Agent Execution Guards**: Fail fast when keys cannot be decrypted
4. **UI Error Propagation**: Show specific error messages instead of generic failures

## Detailed Design

### 1. KeyManager Context Fix

#### Current Problem
```typescript
// keyManager.ts - Current implementation
const allowedContexts = ["user_request", "background_job"];
if (!allowedContexts.includes(context)) {
  console.warn(`decrypt() called in non-permitted context ("${context}") – skipping decryption`);
  return null;
}
```

#### Solution
```typescript
// keyManager.ts - Fixed implementation
const allowedContexts = ["user_request", "background_job", "exchange"];
if (!allowedContexts.includes(context)) {
  console.warn(`decrypt() called in non-permitted context ("${context}") – skipping decryption`);
  return null;
}
```

**Rationale**: The "exchange" context is legitimate for agent execution and exchange operations. The current skip behavior causes null keys to propagate to exchange adapters.

### 2. Encryption Secret Consistency Detection

#### Server Boot Hash Storage
```typescript
// keyManager.ts - Enhanced initialization
let SERVER_BOOT_ENCRYPTION_HASH: string | null = null;

export function initializeEncryptionKey(): void {
  // ... existing code ...
  SERVER_BOOT_ENCRYPTION_HASH = CACHED_KEY_HASH;
  
  logger.info({
    keyHash: CACHED_KEY_HASH.slice(0, 8),
    bootHash: SERVER_BOOT_ENCRYPTION_HASH.slice(0, 8)
  }, '🔐 ENCRYPTION KEY CACHED - Boot hash stored for consistency checking');
}
```

#### Exchange Config Hash Storage
```typescript
// exchange.ts - Enhanced connect endpoint
const exchangeConfig = {
  // ... existing fields ...
  encryptionKeyHash: getFullEncryptionKeyHash(), // Store current hash
  updatedAt: admin.firestore.Timestamp.now(),
};
```

#### Encryption Secret Change Detection
```typescript
// keyManager.ts - Enhanced decrypt function
export function decrypt(cipherText: string, context: string): string | null {
  // ... existing validation ...
  
  try {
    // ... existing decryption logic ...
    return decrypted;
  } catch (error) {
    const errorMessage = (error as Error).message;
    
    // Detect OpenSSL bad decrypt error indicating encryption secret change
    if (errorMessage && errorMessage.includes("bad decrypt")) {
      logger.error({
        error: errorMessage,
        context,
        encryptionKeyHash: getEncryptionKeyHash(8),
      }, "🚨 BAD_DECRYPT_ERROR - ENCRYPTION_SECRET has changed! Exchange keys are unreadable.");
      
      // Throw specific error for corruption handling
      throw new Error("ENCRYPTION_SECRET_CHANGED: Exchange keys cannot be decrypted - please reconnect your exchange");
    }
    
    // ... existing error handling ...
  }
}
```

### 3. Exchange Config Corruption State

#### Firestore Schema Extension
```typescript
// Exchange config document structure
interface ExchangeConfig {
  // ... existing fields ...
  exchangeStatus?: 'CORRUPTED';
  corruptedAt?: FirebaseFirestore.Timestamp;
  corruptedReason?: string;
  encryptionKeyHash?: string;
}
```

#### Corruption Detection and Marking
```typescript
// firestoreAdapter.ts - New function
export async function markExchangeAsCorrupted(
  uid: string, 
  reason: string
): Promise<void> {
  const docRef = db()
    .collection("users")
    .doc(uid)
    .collection("exchangeConfig")
    .doc("current");
    
  await docRef.update({
    exchangeStatus: 'CORRUPTED',
    corruptedAt: admin.firestore.Timestamp.now(),
    corruptedReason: reason
  });
  
  logger.warn({
    uid,
    reason,
    timestamp: new Date().toISOString()
  }, 'Exchange marked as corrupted due to encryption issue');
}
```

#### Enhanced isExchangeUsable Function
```typescript
// firestoreAdapter.ts - Enhanced function
export async function isExchangeUsable(
  uid: string,
  context: "background_job" | "user_request"
): Promise<{ usable: boolean; reason: string; exchange?: string }> {
  // ... existing code ...
  
  // Check if exchange is marked as corrupted
  if (config.exchangeStatus === 'CORRUPTED') {
    return {
      usable: false,
      reason: "corrupted",
      exchange: config.exchange,
    };
  }
  
  // ... rest of existing logic ...
}
```

### 4. Agent Execution Guards

#### Pre-Execution Key Validation
```typescript
// agentExecutionService.ts - Enhanced execution
private async executeAgent(agent: TradingAgent): Promise<void> {
  // ... existing setup code ...
  
  let apiKey: string | null = null;
  let secret: string | null = null;
  let passphrase: string | undefined = undefined;

  try {
    apiKey = encryptedApiKey ? decrypt(encryptedApiKey, 'exchange') : null;
    secret = encryptedSecret ? decrypt(encryptedSecret, 'exchange') : null;
    passphrase = encryptedPassphrase ? decrypt(encryptedPassphrase, 'exchange') : undefined;
  } catch (decryptError: any) {
    // Handle ENCRYPTION_SECRET_CHANGED error specifically
    if (decryptError.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
      skippedReason = 'EXCHANGE_CORRUPTED';
      finalizeSkip('EXCHANGE_CORRUPTED', 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.', 'EXCHANGE');
      
      // Mark exchange config as corrupted
      try {
        await firestoreAdapter.markExchangeAsCorrupted(agentConfig.userId, 'ENCRYPTION_SECRET_CHANGED');
      } catch (markError) {
        logger.error({ agentId, uid: agentConfig.userId, error: markError }, 'Failed to mark exchange as corrupted');
      }
      
      return;
    }
    
    // Handle other decryption errors
    skippedReason = 'EXCHANGE_KEYS_NOT_DECRYPTED';
    finalizeSkip('EXCHANGE_KEYS_NOT_DECRYPTED', 'Failed to decrypt exchange keys', 'EXCHANGE');
    return;
  }

  // CRITICAL: Assert keys are not null before proceeding
  if (apiKey === null || secret === null) {
    skippedReason = 'EXCHANGE_KEYS_NOT_DECRYPTED';
    finalizeSkip('EXCHANGE_KEYS_NOT_DECRYPTED', 'Exchange keys could not be decrypted', 'EXCHANGE');
    
    logger.error({
      agentId,
      uid: agentConfig.userId,
      apiKeyNull: apiKey === null,
      secretNull: secret === null
    }, 'HARD FAIL: Exchange keys are null after decryption attempt');
    
    return;
  }
  
  // ... continue with exchange adapter initialization ...
}
```

### 5. Exchange Route Enhancements

#### Test Exchange Execution Fix
```typescript
// exchange.ts - Enhanced test endpoint
fastify.post("/exchange/test", async (request, reply) => {
  // ... existing setup ...
  
  try {
    // CRITICAL: Use same decrypt context as agent execution
    const credentials = {
      apiKey: decryptOrThrow(config.apiKeyEncrypted, "API key", "exchange"),
      secret: decryptOrThrow(
        config.secretKeyEncrypted || config.secretEncrypted,
        "secret key", 
        "exchange"
      ),
      passphrase: config.passphraseEncrypted
        ? decryptOrThrow(config.passphraseEncrypted, "passphrase", "exchange")
        : undefined,
      testnet: config.testnet ?? false,
    };
    
    // ... rest of test logic ...
  } catch (decryptErr: any) {
    if (decryptErr.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
      // Mark exchange as corrupted
      await markExchangeAsCorrupted(user.uid, 'ENCRYPTION_SECRET_CHANGED');
      
      return reply.code(400).send({
        success: false,
        message: { 
          error: "Exchange keys are invalid due to encryption secret change. Please reconnect exchange." 
        },
      });
    }
    
    return reply.code(400).send({
      success: false,
      message: { 
        error: decryptErr.message || "Failed to decrypt exchange credentials" 
      },
    });
  }
});
```

#### Manual Trade Execution Fix
```typescript
// exchange.ts - Enhanced test-trade endpoint
fastify.post("/exchange/test-trade", async (request, reply) => {
  // ... existing setup ...
  
  try {
    // CRITICAL: Use same decrypt context as agent execution
    const connector = ExchangeConnectorFactory.create(exchange, {
      apiKey: decryptOrThrow(config.apiKeyEncrypted, "API key", "exchange"),
      secret: decryptOrThrow(
        config.secretKeyEncrypted || config.secretEncrypted,
        "secret key",
        "exchange"
      ),
      passphrase: config.passphraseEncrypted
        ? decryptOrThrow(config.passphraseEncrypted, "passphrase", "exchange")
        : undefined,
      testnet: config.testnet ?? false,
    });
    
    // ... rest of trade logic ...
  } catch (decryptErr: any) {
    if (decryptErr.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
      await markExchangeAsCorrupted(user.uid, 'ENCRYPTION_SECRET_CHANGED');
      
      return reply.code(400).send({
        success: false,
        message: {
          error: "Exchange keys are invalid due to encryption secret change. Please reconnect exchange."
        },
      });
    }
    
    return reply.code(400).send({
      success: false,
      message: {
        error: decryptErr.message || "Failed to decrypt exchange credentials"
      },
    });
  }
});
```

### 6. Exchange Reconnect Enhancement

#### Corruption State Cleanup
```typescript
// exchange.ts - Enhanced connect endpoint
fastify.post("/exchange/connect", async (request, reply) => {
  // ... existing validation ...
  
  const exchangeConfig = {
    exchange: resolvedExchange,
    apiKeyEncrypted: encrypt(apiKey),
    secretEncrypted: encrypt(secret),
    testnet: false,
    disconnected: false,
    
    // CRITICAL: Clear corruption state on reconnect
    exchangeStatus: admin.firestore.FieldValue.delete(),
    corruptedAt: admin.firestore.FieldValue.delete(),
    corruptedReason: admin.firestore.FieldValue.delete(),
    
    // Store current encryption key hash
    encryptionKeyHash: getFullEncryptionKeyHash(),
    updatedAt: admin.firestore.Timestamp.now(),
  };
  
  // ... rest of connect logic ...
});
```

### 7. UI Error Message Enhancement

#### Frontend Component Updates
```typescript
// ExchangeHealthCheck.tsx - Enhanced error display
const getErrorMessage = (error: string): string => {
  if (error.includes('EXCHANGE_KEYS_NOT_DECRYPTED')) {
    return 'Exchange keys could not be decrypted. Please reconnect your exchange.';
  }
  
  if (error.includes('ENCRYPTION_SECRET_CHANGED')) {
    return 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.';
  }
  
  if (error.includes('EXCHANGE_CORRUPTED')) {
    return 'Exchange configuration is corrupted. Please reconnect your exchange.';
  }
  
  if (error.includes('SYMBOL_NOT_TRADABLE')) {
    return 'Trading pair is not available on this exchange.';
  }
  
  // Return specific error instead of generic message
  return error;
};
```

#### Settings UI Enhancement
```typescript
// SettingsExchangeSection.tsx - Enhanced corruption handling
const ExchangeSection = () => {
  // ... existing code ...
  
  const isExchangeCorrupted = exchangeStatus === 'CORRUPTED';
  
  return (
    <div>
      {isExchangeCorrupted && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Exchange Keys Invalid</AlertTitle>
          <AlertDescription>
            Your exchange keys are invalid due to an encryption secret change. 
            Please reconnect your exchange to continue trading.
          </AlertDescription>
        </Alert>
      )}
      
      {/* Disable test buttons for corrupted exchanges */}
      <Button 
        disabled={isExchangeCorrupted || isTestingConnection}
        onClick={testConnection}
      >
        {isExchangeCorrupted ? 'Reconnect Required' : 'Test Connection'}
      </Button>
      
      <Button 
        disabled={isExchangeCorrupted || isTestingTrade}
        onClick={testTrade}
      >
        {isExchangeCorrupted ? 'Reconnect Required' : 'Test Trade'}
      </Button>
    </div>
  );
};
```

## Data Flow

### Normal Operation Flow
1. Agent execution starts
2. Exchange config loaded from Firestore
3. Keys decrypted using "exchange" context
4. Exchange adapter initialized with valid credentials
5. Trading operations proceed normally

### Corruption Detection Flow
1. Agent execution starts
2. Exchange config loaded from Firestore
3. Decrypt attempt fails with "bad decrypt" error
4. Error mapped to ENCRYPTION_SECRET_CHANGED
5. Exchange config marked as CORRUPTED in Firestore
6. Agent execution skipped with clear reason
7. UI shows specific reconnect message

### Recovery Flow
1. User clicks reconnect in UI
2. User enters fresh API credentials
3. Old encrypted keys deleted from Firestore
4. New keys encrypted with current ENCRYPTION_SECRET
5. Corruption state cleared from exchange config
6. Current encryption key hash stored
7. Agent execution resumes normally

## Error Handling Strategy

### Error Classification
1. **ENCRYPTION_SECRET_CHANGED**: Encryption secret rotated, keys unreadable
2. **EXCHANGE_KEYS_NOT_DECRYPTED**: Generic decryption failure
3. **EXCHANGE_CORRUPTED**: Exchange marked as corrupted in database
4. **NO_EXCHANGE_CONFIG**: No exchange configuration found
5. **EXCHANGE_DISCONNECTED**: User manually disconnected exchange

### Error Response Strategy
1. **Fail Fast**: Don't attempt operations with null keys
2. **Specific Messages**: Show exact error instead of generic failures
3. **Clear Actions**: Tell user exactly what to do (reconnect exchange)
4. **No Retries**: Don't repeatedly attempt to decrypt corrupted keys
5. **State Tracking**: Mark corrupted exchanges to prevent repeated failures

## Security Considerations

### Key Security
- Corrupted keys are never logged or exposed
- Encryption secret hash is stored securely
- Key decryption failures don't leak encryption information
- New keys always use current encryption secret

### Attack Mitigation
- No timing attacks possible through error messages
- Corruption state prevents brute force decryption attempts
- Clear audit trail of when exchanges become corrupted
- Secure cleanup of old encrypted data on reconnect

## Performance Impact

### Minimal Overhead
- Encryption secret validation: <10ms on server startup
- Corruption detection: <5ms per exchange operation
- Key decryption performance unchanged for valid keys
- No impact on non-exchange operations

### Optimization Opportunities
- Cache corruption status to avoid repeated Firestore reads
- Batch corruption marking for multiple users if needed
- Lazy load encryption secret hash validation

## Testing Strategy

### Unit Tests
- KeyManager context validation
- Encryption secret change detection
- Exchange corruption marking
- Error message generation

### Integration Tests
- End-to-end agent execution with corrupted keys
- Exchange reconnect flow with corruption cleanup
- UI error message display for various error types
- Health check accuracy with corrupted exchanges

### Manual Testing
- Simulate encryption secret change
- Verify agent execution fails gracefully
- Test exchange reconnect clears corruption
- Confirm UI shows specific error messages

## Rollback Plan

### Safe Rollback
1. Revert keyManager context changes
2. Remove corruption state fields from exchange configs
3. Restore original error handling in agent execution
4. Revert UI error message changes

### Data Cleanup
- Corrupted exchange configs will continue to work after rollback
- No data migration needed for rollback
- Users may need to reconnect exchanges if rollback occurs during corruption

## Monitoring and Alerting

### Key Metrics
- Number of exchanges marked as corrupted per day
- Frequency of ENCRYPTION_SECRET_CHANGED errors
- Agent execution success rate after fixes
- User reconnect rate following corruption detection

### Alerts
- High rate of exchange corruption (indicates widespread encryption issue)
- Repeated decryption failures for same user (indicates persistent issue)
- Server startup encryption key initialization failures

## Future Enhancements

### Potential Improvements
1. **Proactive Corruption Detection**: Check encryption key hash on server startup
2. **Bulk Corruption Handling**: Handle multiple corrupted exchanges efficiently
3. **Encryption Secret Rotation**: Proper procedures for rotating encryption secrets
4. **Key Migration Tools**: Tools to migrate keys between encryption secrets
5. **Enhanced Audit Logging**: Comprehensive logs for all encryption operations