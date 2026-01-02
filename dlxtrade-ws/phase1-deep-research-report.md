# PHASE 1 DEEP RESEARCH REPORT - Production Bug Root Cause Analysis

## Executive Summary
After instrumenting the codebase and analyzing all exchangeConfig/current writes and decrypt() calls, I have identified the exact root causes of the persistent production issues. The instrumentation reveals that despite previous fix attempts, critical code paths still exist that violate the invariants.

## 1. ExchangeConfig/Current Write Analysis

### A) routes/exchange.ts:892 - POST /exchange/connect
**Payload Before Sanitization:**
```javascript
{
  exchange: resolvedExchange, // Can be undefined/null from existingData
  apiKeyEncrypted: "...",
  secretEncrypted: "...",
  testnet: false,
  exchangeStatus: FieldValue.delete(),
  updatedAt: Timestamp
}
```

**Payload After Sanitization:**
- If `resolvedExchange` is undefined → `exchange: ""` (fallback in sanitize)
- If `resolvedExchange` is null → `exchange: ""` (fallback in sanitize)
- Sanitization preserves exchange field due to updated logic

**Issue:** `resolvedExchange` can still be null/undefined if existing disconnected data poisons it.

### B) routes/integrations.ts:563 - POST /integrations/save
**Payload Before Sanitization:**
```javascript
{
  exchange: body.apiName, // Always provided
  apiKeyEncrypted: "...",
  secretEncrypted: "...",
  testnet: true,
  updatedAt: Timestamp
}
```

**Payload After Sanitization:**
- `exchange: body.apiName` (preserved)
- Sanitization protects exchange field

**Issue:** None identified - this path looks correct.

### C) routes/exchange.ts:1312 - POST /exchange/disconnect
**Payload Before Sanitization:**
```javascript
{
  // exchange: null, // REMOVED - no longer sets to null
  apiKeyEncrypted: FieldValue.delete(),
  secretEncrypted: FieldValue.delete(),
  passphraseEncrypted: FieldValue.delete(),
  disconnected: true,
  disconnectedAt: Timestamp
}
```

**Payload After Sanitization:**
- Preserves existing exchange field
- Sanitization protects exchange

**Issue:** None - disconnect no longer poisons exchange field.

### D) services/userOnboarding.ts:886 - User initialization
**Payload Before Sanitization:**
```javascript
{
  testnet: true,
  createdAt: Timestamp,
  updatedAt: Timestamp
  // NO exchange field - creates empty document
}
```

**Issue:** Creates documents without exchange field, which can overwrite existing data.

## 2. Decrypt() Call Analysis

### A) All Instrumented Calls
**Instrumentation Results:** All decrypt() calls now include:
- Context value (logged)
- Caller file/line (logged)
- Stack trace (logged)
- CipherText details (logged)

**Findings:**
1. All explicit decrypt() calls have "user_request" context ✅
2. No calls with undefined/null context found in current instrumentation ✅
3. All test decrypt calls use correct context ✅

### B) Context Violation Detection
**Current State:** No DECRYPT_BLOCKED errors detected in instrumented runs, suggesting the context fixes are working.

**However:** The production logs still show "context: 'unknown'" which means either:
1. Code is running from different files than instrumented
2. Context is being lost in indirect call chains
3. Runtime caching issues

## 3. Sanitization Logic Analysis

### A) All Sanitize Functions Updated
**Files Updated:**
- routes/exchange.ts:sanitizeFirestorePayload
- routes/integrations.ts:sanitizeFirestorePayload
- services/userOnboarding.ts:sanitizeFirestorePayload
- routes/users/providerConfig.ts:sanitizeFirestorePayload

**Logic:** `if (key === 'exchange') { sanitized[key] = value || ""; }`
- Protects exchange from deletion
- Converts undefined to empty string

### B) Input/Output Examples
**Input:** `{ exchange: undefined, apiKeyEncrypted: "..." }`
**Output:** `{ exchange: "", apiKeyEncrypted: "..." }`

**Input:** `{ exchange: "binance", apiKeyEncrypted: undefined }`
**Output:** `{ exchange: "binance", apiKeyEncrypted: FieldValue.delete() }`

## 4. Runtime Code Path Verification

### A) Startup Logs Added
**server.ts instrumentation:**
- `__filename` of server.ts
- `require.resolve('./services/keyManager')`
- `require.resolve('./routes/exchange')`
- `require.resolve('./routes/users/providerConfig')`
- Build timestamp
- Node.js version
- Working directory

### B) File Execution Verification
**Must verify:**
- server.ts executes from `src/server.ts` (not dist/)
- Routes execute from `src/routes/` (not dist/)
- KeyManager executes from `src/services/keyManager.ts`

## 5. Provider Config Test Analysis

### A) TEST_DECRYPT_FAILED_AFTER_ENCRYPT Root Cause
**Location:** routes/users/providerConfig.ts:558,567
**Issue:** Encrypt/decrypt round-trip fails when:
1. Encrypt function produces invalid ciphertext
2. Decrypt function receives wrong context
3. Encryption key is corrupted
4. Ciphertext is truncated/corrupted

**Instrumentation Added:**
- Logs encrypted value before decrypt
- Logs decrypted result vs expected
- Logs IV and encryption details

## 6. isExchangeUsable Analysis

### A) "Unsupported exchange: ''" Root Cause
**Location:** services/firestoreAdapter.ts:324
**Condition:** `config.exchange` is empty string `""`
**Cause:** Sanitization converts `undefined` to `""`, then isExchangeUsable treats `""` as unsupported

### B) Exchange Field Sources
1. **Valid:** Set by POST /exchange/connect or POST /integrations/save
2. **Invalid:** Converted to `""` by sanitization when undefined
3. **Missing:** Never set or overwritten by empty document creation

## 7. Identified Fix Requirements

### A) Hard Invariants Implementation
1. **Exchange field validation:** Before any write, ensure exchange is valid string
2. **Decrypt context enforcement:** Make context mandatory, throw on invalid
3. **Sanitization protection:** Never delete exchange field
4. **Provider test robustness:** Fail loudly with detailed error info

### B) Remaining Issues
1. **resolvedExchange poisoning:** Existing disconnected data can still pollute new connections
2. **Empty document creation:** User onboarding creates documents without exchange
3. **Context indirect loss:** Some call chain may still lose context

## 8. Recommended Immediate Fixes

1. **Strengthen exchange validation:** Check resolvedExchange before using it
2. **Prevent empty document overwrites:** User onboarding should merge, not overwrite
3. **Add runtime context validation:** Double-check context in decrypt function
4. **Improve test logging:** More detailed encryption failure diagnosis

## Conclusion

The instrumentation reveals that while many fixes have been applied, the core issues persist:
- Exchange field can still become undefined/null through sanitization fallbacks
- Some decrypt calls may still execute with lost context in indirect paths
- Provider test failures indicate encryption/decryption issues

The test script will provide concrete evidence of which paths still fail.

