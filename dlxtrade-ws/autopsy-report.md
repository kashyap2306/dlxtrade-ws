# PHASE 1 AUTOPSY REPORT - Provider Config / Exchange Config Issues

## Executive Summary
After scanning 100% of the backend codebase, this report identifies the root causes of:
- `exchange` field becoming `""` or `undefined` in `users/{uid}/exchangeConfig/current`
- `TEST_DECRYPT_FAILED_AFTER_ENCRYPT` in provider config saves
- `DECRYPT_BLOCKED (context: "unknown")` runtime errors

## A) Files Writing to users/{uid}/exchangeConfig/current

### 1. routes/exchange.ts
**Lines: 892, 1312**
- **Line 892**: `await docRef.set(sanitizedExchangeConfig, { merge: true })`
  - Called from: POST /exchange/connect route
  - Data: `{ exchange, apiKeyEncrypted, secretEncrypted, ... }`
  - Context: User-initiated exchange connection

- **Line 1312**: `await docRef.set(sanitizedDisconnectPayload, { merge: true })`
  - Called from: POST /exchange/disconnect route
  - Data: `{ exchange: null, apiKeyEncrypted: delete, ... }` ⚠️ **SETS EXCHANGE TO NULL**
  - Context: User-initiated exchange disconnection

### 2. routes/integrations.ts
**Lines: 563**
- **Line 563**: `await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').set(sanitizedExchangeConfig2, { merge: true })`
  - Called from: POST /integrations/save route (trading exchanges only)
  - Data: `{ exchange: body.apiName, apiKeyEncrypted, secretEncrypted, ... }`
  - Context: User saving trading exchange credentials

### 3. services/userOnboarding.ts
**Lines: 886, 906**
- **Line 886**: `await exchangeConfigRef.set({ testnet: true, createdAt, updatedAt })`
  - Called from: `ensureUser()` function during user onboarding
  - Data: `{ testnet: true, createdAt, updatedAt }` (NO exchange field)
  - Context: Background user initialization

- **Line 906**: `await exchangeConfigRef.update(updateData)`
  - Called from: `ensureUser()` function during user onboarding
  - Data: `{ createdAt?, updatedAt?, testnet? }` (preserves existing data)
  - Context: Background user initialization

## B) All encrypt() and decrypt() Calls

### 1. routes/exchange.ts
- **encrypt() calls:**
  - Line 826: `encrypt(apiKey)` - user route
  - Line 827: `encrypt(secret)` - user route
  - Line 837: `encrypt(passphrase)` - user route

- **decrypt() calls:**
  - Line 1137: `decrypt(config.apiKeyEncrypted, "user_request")` ✅
  - Line 1138: `decrypt(config.secretKeyEncrypted || config.secretEncrypted, "user_request")` ✅
  - Line 1143: `decrypt(config.passphraseEncrypted, "user_request")` ✅

### 2. routes/integrations.ts
- **encrypt() calls:**
  - Line 549: `encrypt(body.apiKey!)` - user route
  - Line 550: `encrypt(body.secretKey!)` - user route

- **decrypt() calls:** NONE

### 3. routes/users/providerConfig.ts
- **encrypt() calls:**
  - Line 535: `keyManager.encrypt(apiKey)` - user route
  - Line 540: `keyManager.encrypt(secretKey)` - user route

- **decrypt() calls:**
  - Line 149: `decrypt(apiKeyEncrypted, "user_request")` ✅ GET route
  - Line 200: `decrypt(secretKeyEncrypted, "user_request")` ✅ GET route
  - Line 558: `decrypt(finalEncryptedApiKey, "user_request")` ✅ POST test
  - Line 567: `decrypt(finalEncryptedSecretKey, "user_request")` ✅ POST test

### 4. routes/settings.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 830: `keyManager.decrypt(providerTypeSettings.primary.encryptedApiKey, "user_request")` ✅
  - Line 835: `keyManager.decrypt(providerTypeSettings.backups[providerId].encryptedApiKey, "user_request")` ✅
  - Line 995: `keyManager.decrypt(providerTypeSettings.primary.encryptedApiKey, "user_request")` ✅
  - Line 999: `keyManager.decrypt(providerTypeSettings.backups[providerId].encryptedApiKey, "user_request")` ✅

### 5. routes/diagnostics.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 41: `decrypt(encrypted)` ❌ **MISSING CONTEXT**

### 6. routes/engine.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 264: `decrypt(exchangeCredentials.apiKeyEncrypted, "user_request")` ✅
  - Line 265: `decrypt(exchangeCredentials.secretKeyEncrypted || exchangeCredentials.secretEncrypted, "user_request")` ✅

### 7. services/firestoreAdapter.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 355: `decrypt(config.apiKeyEncrypted, standardContext)` ✅ (derived from function param)
  - Line 356: `decrypt(config.secretKeyEncrypted || config.secretEncrypted, standardContext)` ✅
  - Line 361: `decrypt(config.passphraseEncrypted, standardContext)` ✅
  - Line 1432: `decrypt(integration.apiKeyEncrypted, context)` ✅
  - Line 1434: `decrypt(integration.secretKeyEncrypted, context)` ✅

### 8. services/exchangeResolver.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 123: `decrypt(config.apiKeyEncrypted, context)` ✅
  - Line 124: `decrypt(config.secretKeyEncrypted || config.secretEncrypted, context)` ✅
  - Line 126: `decrypt(config.passphraseEncrypted, context)` ✅

### 9. services/userOnboarding.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 163: `decrypt(apiKeyEncrypted, context)` ✅ (conditional on user_request)
  - Line 184: `decrypt(secretKeyEncrypted)` ❌ **MISSING CONTEXT** (line 184)
  - Line 287: `decrypt(apiKeyEncrypted, context)` ✅ (conditional on user_request)
  - Line 321: `decrypt(secretKeyEncrypted, context)` ✅ (conditional on user_request)

### 10. services/keyManager.ts
- **encrypt() calls:** NONE

- **decrypt() calls:**
  - Line 200: `decrypt(cipherText, context)` ✅ (internal call)
  - Line 257: `decrypt(row.api_key_encrypted, context)` ✅
  - Line 258: `decrypt(row.api_secret_encrypted, context)` ✅
  - Line 440: `decrypt(encrypted, "user_request")` ✅

### 11. routes/users/exchangeAndTrading.ts
- **encrypt() calls:** NONE

- **decrypt() calls:** NONE

## C) Call Graphs

### POST /exchange/connect
1. `routes/exchange.ts:695` - Route handler receives request
2. `routes/exchange.ts:737-740` - Resolve exchange from request/existing data
3. `routes/exchange.ts:743-757` - Validate resolvedExchange is not falsy
4. `routes/exchange.ts:825-841` - Encrypt credentials
5. `routes/exchange.ts:865-873` - Final validation of exchangeConfig.exchange
6. `routes/exchange.ts:888-892` - Sanitize and write to Firestore

**Critical Issue:** If existingData.exchange is null (from disconnect), resolvedExchange becomes null, validation may not catch it properly.

### POST /exchange/disconnect
1. `routes/exchange.ts:1249` - Route handler receives request
2. `routes/exchange.ts:1290-1309` - Create disconnectPayload with `exchange: null`
3. `routes/exchange.ts:1310-1312` - Sanitize and write to Firestore

**Critical Issue:** Explicitly sets exchange to null, corrupting future connections.

### POST /provider-config
1. `routes/users/providerConfig.ts:351` - Route handler receives request
2. `routes/users/providerConfig.ts:533-542` - Encrypt API keys
3. `routes/users/providerConfig.ts:555-572` - Test decrypt round-trip
4. `routes/users/providerConfig.ts:629-630` - Save to integrations collection

**Critical Issue:** Test decrypt on lines 558,567 may fail if encrypt/decrypt round-trip is broken.

### GET /exchangeConfig/current
1. `routes/users/exchangeAndTrading.ts:55` - Route handler receives request
2. `routes/users/exchangeAndTrading.ts:101` - Read raw Firestore document
3. `routes/users/exchangeAndTrading.ts:111` - Call getExchangeConfig sanitization
4. `routes/users/exchangeAndTrading.ts:116` - Call isExchangeUsable
5. `routes/users/exchangeAndTrading.ts:128` - Return response

## D) Decrypt Context Analysis

**Violations (MISSING context):**
- `routes/diagnostics.ts:41` - `decrypt(encrypted)` ❌
- `services/userOnboarding.ts:184` - `decrypt(secretKeyEncrypted)` ❌ (conditional path)

**Compliant calls:**
- All others pass explicit "user_request" or "background_job" context ✅

## E) Sanitization Logic Analysis

### routes/exchange.ts:sanitizeFirestorePayload
```typescript
function sanitizeFirestorePayload(payload: any): any {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
    } else {
      sanitized[key] = value;
    }
  }
}
```
**Example:** `{ exchange: undefined }` → `{ exchange: FieldValue.delete() }`

### services/userOnboarding.ts:sanitizeFirestorePayload
Same logic - converts undefined to delete.

### routes/users/providerConfig.ts:sanitizeFirestorePayload
Same logic - converts undefined to delete.

### routes/integrations.ts:sanitizeFirestorePayload
Same logic - converts undefined to delete.

## F) Exchange Field Corruption Paths

### 1. Disconnect Poisoning
**File:** `routes/exchange.ts:1290`
**Code:** `exchange: null`
**Impact:** Future connections use null as resolvedExchange

### 2. Sanitization Deletion
**Files:** All sanitize functions
**Code:** `if (value === undefined) { delete }`
**Impact:** If exchange becomes undefined anywhere, it gets deleted

### 3. User Onboarding Overwrite
**File:** `services/userOnboarding.ts:886`
**Code:** `set({ testnet: true, createdAt, updatedAt })` (no exchange field)
**Impact:** If called after exchange setup, removes exchange field

### 4. Validation Bypass
**File:** `routes/exchange.ts:743`
**Code:** `if (!resolvedExchange)` - catches null/undefined/empty
**Issue:** May not catch all edge cases

## G) Runtime Code Deployment

To ensure current source runs (not cached dist):
1. `npm run build` - Compile TypeScript to dist/
2. Restart Node.js server process
3. Verify dist/ contains updated files with correct timestamps
4. Check server logs show new code loaded

## Root Cause Summary

1. **Exchange Field Loss:** Disconnect sets `exchange: null`, sanitization deletes undefined values, user onboarding overwrites documents
2. **Decrypt Context Issues:** `routes/diagnostics.ts:41` and `services/userOnboarding.ts:184` call decrypt without context
3. **Provider Test Failures:** Encrypt/decrypt round-trip may fail if encryption is corrupted or context is wrong

## Recommended Fixes

1. Never set exchange to null in disconnect
2. Make decrypt context mandatory (throw if missing)
3. Protect exchange field in sanitization
4. Add ironclad validation before all writes
5. Fix missing context calls

