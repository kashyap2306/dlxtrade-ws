# API Config Creation Flow Fix Summary

## Overview
Fixed the API config creation flow to ensure that NO empty documents are created at signup time. Documents are created ONLY when users submit API keys.

## Changes Made

### 1. Removed Empty Document Creation at Signup

**File:** `src/services/userOnboarding.ts`

**Changes:**
- Removed code that created empty `users/{uid}/integrations/{apiName}` documents at signup (lines 422-462)
- Removed code that created empty `users/{uid}/exchangeConfig/current` document at signup (lines 464-510)

**Result:** At signup, only `users/{uid}` document is created. No API config documents exist.

### 2. Enhanced Integration Creation with Required Fields

**File:** `src/services/firestoreAdapter.ts`

**Changes:**
- Updated `saveIntegration()` to ensure `apiType` is always set for CoinAPI integrations (extracted from docName if not provided)
- Added post-save verification to ensure all required fields are present:
  - `enabled` (required)
  - `createdAt` (required, set when document is new)
  - `updatedAt` (required)
  - `apiType` (required for CoinAPI integrations)
  - `apiKey` (encrypted, set when provided)
  - `secretKey` (encrypted, set when provided for Binance)

**Required Fields for Integrations:**
- `enabled` ✅
- `apiKey` ✅ (encrypted)
- `secretKey` ✅ (encrypted, for Binance)
- `apiType` ✅ (for CoinAPI: 'market', 'flatfile', or 'exchangerate')
- `createdAt` ✅
- `updatedAt` ✅

### 3. Enhanced Exchange Config Creation with Required Fields

**File:** `src/services/firestoreAdapter.ts`

**Changes:**
- Added post-save verification to ensure all required fields are present in `saveExchangeConfig()`:
  - `exchange` ✅
  - `apiKeyEncrypted` ✅
  - `secretEncrypted` ✅
  - `passphraseEncrypted` ✅ (always set, even if empty string)
  - `testnet` ✅
  - `enabled` ✅
  - `createdAt` ✅ (set when document is new)
  - `updatedAt` ✅

**Required Fields for Exchange Config:**
- `exchange` ✅
- `apiKeyEncrypted` ✅
- `secretEncrypted` ✅
- `passphraseEncrypted` ✅
- `testnet` ✅
- `enabled` ✅
- `createdAt` ✅
- `updatedAt` ✅

### 4. Added `/update` Endpoint for Integrations

**File:** `src/routes/integrations.ts`

**Changes:**
- Added `POST /api/integrations/update` endpoint (alias for `/save`) for frontend compatibility
- Uses the same logic as `/save` endpoint with full field validation and post-verification

## Correct Behavior Flow

### 1. User Signup
```
POST /api/auth/afterSignIn
  ↓
ensureUser() creates:
  ✅ users/{uid} (with all required user fields)
  ❌ NO users/{uid}/exchangeConfig/current
  ❌ NO users/{uid}/integrations/{apiName}
```

### 2. User Submits Exchange API Keys
```
POST /api/exchange-config/update
  {
    exchange: "binance",
    apiKey: "...",
    secret: "...",
    testnet: true
  }
  ↓
saveExchangeConfig() creates:
  ✅ users/{uid}/exchangeConfig/current
    - exchange: "binance"
    - apiKeyEncrypted: "<encrypted>"
    - secretEncrypted: "<encrypted>"
    - passphraseEncrypted: ""
    - testnet: true
    - enabled: true
    - createdAt: <timestamp>
    - updatedAt: <timestamp>
```

### 3. User Submits Research API Keys
```
POST /api/integrations/update
  {
    apiName: "cryptoquant",
    enabled: true,
    apiKey: "..."
  }
  ↓
saveIntegration() creates:
  ✅ users/{uid}/integrations/cryptoquant
    - enabled: true
    - apiKey: "<encrypted>"
    - createdAt: <timestamp>
    - updatedAt: <timestamp>
```

### 4. User Submits CoinAPI Keys
```
POST /api/integrations/update
  {
    apiName: "coinapi",
    apiType: "market",
    enabled: true,
    apiKey: "..."
  }
  ↓
saveIntegration() creates:
  ✅ users/{uid}/integrations/coinapi_market
    - enabled: true
    - apiKey: "<encrypted>"
    - apiType: "market"
    - createdAt: <timestamp>
    - updatedAt: <timestamp>
```

## Verification

All endpoints now include post-save verification that:
1. Reads the document back immediately after write
2. Verifies all required fields are present
3. Throws an error if any required field is missing
4. Logs detailed verification results

## Testing Checklist

To verify the fix:

1. ✅ Create a brand new test user
2. ✅ After signup, check Firestore:
   - `users/{uid}` exists
   - `users/{uid}/exchangeConfig` collection does NOT exist
   - `users/{uid}/integrations` collection does NOT exist
3. ✅ Submit exchange API keys from frontend
4. ✅ Verify `users/{uid}/exchangeConfig/current` is created with ALL required fields
5. ✅ Submit research API keys from frontend
6. ✅ Verify `users/{uid}/integrations/{apiName}` is created with ALL required fields
7. ✅ Verify CoinAPI integrations include `apiType` field

## Files Modified

1. `src/services/userOnboarding.ts` - Removed empty document creation at signup
2. `src/services/firestoreAdapter.ts` - Enhanced save methods with field verification
3. `src/routes/integrations.ts` - Added `/update` endpoint

## Notes

- All important fields are preserved (no fields removed)
- Encryption is still applied to all API keys
- Post-verification ensures data integrity
- Backward compatibility maintained with existing endpoints

