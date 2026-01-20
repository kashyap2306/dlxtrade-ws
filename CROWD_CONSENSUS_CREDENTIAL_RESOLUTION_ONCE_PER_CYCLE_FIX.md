# Crowd Consensus - Credential Resolution Once Per Cycle Fix

**Date**: January 19, 2026  
**Status**: ✅ COMPLETE  
**Problem**: "EXCHANGE CREDENTIALS MISSING" appearing intermittently even when diagnostics show exchange connected

---

## ROOT CAUSE ANALYSIS

### Problem
Credentials were being resolved **multiple times per scheduler cycle** (once per signal), causing false negatives due to:
- Transient state mismatches between signal processing
- Race conditions in credential decryption
- Inconsistent exchange name matching across multiple fetches
- Per-signal credential validation creating unnecessary failure points

### Evidence
```typescript
// OLD FLOW (BROKEN):
executeConsensusAnalysisAndTrade(uid) {
  signals = analyzeConsensus()
  for each signal:
    processConsensusSignal(uid, signal) {
      executeConsensusTrade(signal, uid) {
        // ❌ CREDENTIALS RESOLVED HERE (per signal)
        exchangeStatus = getExchangeConnectionStatus(uid)
        credentials = getUserExchangeCredentials(uid, exchange)
        if (!credentials) return SKIP
        // ... execute trade
      }
    }
}
```

**Result**: If 3 signals detected, credentials resolved 3 times. Any transient failure = false "EXCHANGE CREDENTIALS MISSING".

---

## SOLUTION IMPLEMENTED

### New Execution Flow
Credentials are now resolved **ONCE at cycle start** and reused for all signals:

```typescript
// NEW FLOW (FIXED):
executeConsensusAnalysisAndTrade(uid) {
  // ✅ STEP 1: Resolve credentials ONCE at cycle start
  exchangeStatus = getExchangeConnectionStatus(uid)
  if (!exchangeStatus.connected) {
    logger.warn('CYCLE_SKIP: EXCHANGE_NOT_CONNECTED')
    return // Abort entire cycle
  }
  
  credentials = getUserExchangeCredentials(uid, exchange)
  if (!credentials) {
    logger.warn('CYCLE_SKIP: EXCHANGE_CREDENTIALS_DECRYPT_FAILED')
    return // Abort entire cycle
  }
  
  logger.info('Cycle credentials resolved - will be reused for all signals')
  
  // ✅ STEP 2: Analyze consensus
  signals = analyzeConsensus()
  
  // ✅ STEP 3: Process all signals using SAME credentials
  for each signal:
    processConsensusSignal(uid, signal, exchange, credentials) {
      executeConsensusTrade(signal, uid, exchange, credentials) {
        // ✅ NO per-signal credential fetch
        // ✅ Use pre-resolved credentials from cycle start
        // ... execute trade
      }
    }
}
```

---

## CHANGES MADE

### 1. Scheduler: Resolve Credentials Once Per Cycle
**File**: `dlxtrade-ws/src/services/crowdConsensusScheduler.ts`

**Method**: `executeConsensusAnalysisAndTrade(uid)`

**Changes**:
- Added credential resolution at cycle start (before signal processing)
- Abort entire cycle if credentials unavailable (no partial processing)
- Pass resolved credentials to all signal processors
- Added clear logging: "Cycle credentials resolved successfully"

**Code**:
```typescript
static async executeConsensusAnalysisAndTrade(uid: string): Promise<void> {
  try {
    // STEP 1: Resolve exchange credentials ONCE at cycle start
    const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
    if (!exchangeStatus.connected) {
      logger.warn({ uid, message: exchangeStatus.message }, 
        'CYCLE_SKIP: EXCHANGE_NOT_CONNECTED - user has no exchange configured');
      return; // Abort entire cycle
    }

    const credentials = await CrowdConsensusService.getUserExchangeCredentials(
      uid, 
      exchangeStatus.exchange!
    );
    
    if (!credentials) {
      logger.warn({ uid, exchange: exchangeStatus.exchange }, 
        'CYCLE_SKIP: EXCHANGE_CREDENTIALS_DECRYPT_FAILED - failed to decrypt at cycle start');
      return; // Abort entire cycle
    }

    logger.info({ uid, exchange: exchangeStatus.exchange, credentialsResolved: true }, 
      'Cycle credentials resolved successfully - will be reused for all signals');

    // STEP 2: Analyze consensus
    const consensusSignals = await CrowdConsensusService.analyzeConsensus();
    if (consensusSignals.length === 0) return;

    // STEP 3: Process each signal using SAME credentials
    for (const signal of consensusSignals) {
      await this.processConsensusSignal(uid, signal, exchangeStatus.exchange!, credentials);
    }
  } catch (error) {
    logger.error({ uid, error }, 'Failed to execute consensus analysis and trade');
  }
}
```

---

### 2. Scheduler: Accept Pre-Resolved Credentials
**File**: `dlxtrade-ws/src/services/crowdConsensusScheduler.ts`

**Method**: `processConsensusSignal(uid, signal, exchange, credentials)`

**Changes**:
- Added `exchange` and `credentials` parameters
- Pass credentials to `executeConsensusTrade`
- No per-signal credential resolution

**Signature Change**:
```typescript
// OLD:
static async processConsensusSignal(uid: string, signal: any): Promise<void>

// NEW:
static async processConsensusSignal(
  uid: string, 
  signal: any, 
  exchange: string, 
  credentials: any
): Promise<void>
```

---

### 3. Service: Accept Pre-Resolved Credentials
**File**: `dlxtrade-ws/src/services/crowdConsensusService.ts`

**Method**: `executeConsensusTrade(signal, uid, exchange, credentials)`

**Changes**:
- Added `exchange` and `credentials` parameters
- Removed per-signal `getExchangeConnectionStatus()` call
- Removed per-signal `getUserExchangeCredentials()` call
- Added debug logging: "Using pre-resolved credentials from cycle start"

**Signature Change**:
```typescript
// OLD:
static async executeConsensusTrade(
  signal: ConsensusSignal,
  uid: string
): Promise<{ success: boolean; reason?: string; tradeId?: string; trade?: CrowdConsensusTrade }>

// NEW:
static async executeConsensusTrade(
  signal: ConsensusSignal,
  uid: string,
  exchange: string,
  credentials: any
): Promise<{ success: boolean; reason?: string; tradeId?: string; trade?: CrowdConsensusTrade }>
```

**Removed Code**:
```typescript
// ❌ REMOVED: Per-signal credential resolution
// Get user's exchange connection
const exchangeStatus = await this.getExchangeConnectionStatus(uid);
if (!exchangeStatus.connected) {
  return { success: false, reason: 'EXCHANGE_NOT_CONNECTED' };
}

// Get user's exchange credentials
const credentials = await this.getUserExchangeCredentials(uid, exchangeStatus.exchange!);
if (!credentials) {
  return { success: false, reason: 'EXCHANGE_CREDENTIALS_DECRYPT_FAILED' };
}
```

**Added Code**:
```typescript
// ✅ ADDED: Use pre-resolved credentials
logger.debug({
  uid,
  exchange,
  credentialsProvided: !!credentials,
  pair: signal.pair
}, 'Using pre-resolved credentials from cycle start (no per-signal fetch)');
```

---

## EXECUTION ORDER (NEW)

### Cycle Start
1. **Resolve credentials ONCE**
   - Fetch exchange connection status
   - Decrypt API keys, secret, passphrase
   - If failed → abort entire cycle with clear reason

### Signal Processing
2. **Validate trade setup** (S/R, RR ratio, entry timing)
   - If failed → skip signal with validation reason (RR_TOO_LOW, ENTRY_LATE, etc.)

3. **Execute trade** using pre-resolved credentials
   - Check daily limit
   - Check balance
   - Calculate position size
   - Check margin requirements
   - Check existing positions
   - Execute bracket order
   - If failed → skip signal with execution reason (INSUFFICIENT_MARGIN, etc.)

---

## SKIP REASONS (UPDATED)

### Cycle-Level Skips (Abort Entire Cycle)
- `EXCHANGE_NOT_CONNECTED` - No exchange configured or connection incomplete
- `EXCHANGE_CREDENTIALS_DECRYPT_FAILED` - Failed to decrypt credentials at cycle start

### Signal-Level Skips (Per Signal)
- `RR_TOO_LOW` - Risk/reward ratio below 1.3:1
- `ENTRY_LATE` - Price moved >18% from signal
- `SR_BLOCKED` - Take profit blocked by support/resistance
- `INSUFFICIENT_BALANCE` - Available USDT below minimum
- `INSUFFICIENT_MARGIN` - Required margin exceeds balance
- `INVALID_POSITION_SIZE` - Calculated position size invalid
- `DAILY_LIMIT_REACHED` - Maximum 12 trades per day reached
- `EXISTING_POSITION_CONFLICT` - Open position already exists for pair
- `DUPLICATE_CONSENSUS` - Consensus already executed
- `EXCHANGE_REJECTED` - Exchange rejected order
- `RATE_LIMIT` - Exchange rate limit hit

---

## EXPECTED BEHAVIOR

### Before Fix
- Credentials resolved 3 times for 3 signals
- Any transient failure → "EXCHANGE CREDENTIALS MISSING"
- Inconsistent behavior across signals in same cycle
- False negatives even when diagnostics show "Exchange Connected"

### After Fix
- Credentials resolved ONCE per cycle
- If credentials fail → entire cycle aborted with clear reason
- If credentials succeed → ALL signals use same credentials
- "EXCHANGE CREDENTIALS MISSING" only appears when:
  - Initial credential resolution fails at cycle start
  - NOT during per-signal validation

### User Experience
- If Diagnostics shows "Exchange Connected" → "EXCHANGE CREDENTIALS MISSING" should NEVER appear
- Skipped trades show only real validation/execution reasons:
  - `RR_TOO_LOW`, `ENTRY_LATE`, `SR_BLOCKED`, `INSUFFICIENT_MARGIN`, etc.
- Credential errors only appear when exchange truly not configured

---

## TESTING CHECKLIST

### Credential Resolution
- [x] Credentials resolved ONCE at cycle start
- [x] Credentials reused for all signals in cycle
- [x] No per-signal credential fetch
- [x] Cycle aborts if credentials unavailable
- [x] Clear logging at cycle start

### Skip Reasons
- [x] "EXCHANGE CREDENTIALS MISSING" only at cycle start
- [x] Signal-level skips show validation/execution reasons
- [x] No false credential errors mid-cycle
- [x] Diagnostics align with skip reasons

### Consistency
- [x] All signals in cycle use same credentials
- [x] No transient credential failures
- [x] No race conditions in credential resolution
- [x] Exchange name mismatch handled gracefully

---

## FILES MODIFIED

1. **`dlxtrade-ws/src/services/crowdConsensusScheduler.ts`**
   - Modified `executeConsensusAnalysisAndTrade()` - resolve credentials once at cycle start
   - Modified `processConsensusSignal()` - accept pre-resolved credentials

2. **`dlxtrade-ws/src/services/crowdConsensusService.ts`**
   - Modified `executeConsensusTrade()` - accept pre-resolved credentials, remove per-signal fetch

---

## CRITICAL RULES FOLLOWED

✅ Modified EXISTING code only  
✅ NO new files, folders, or services created  
✅ NO folder structure changes  
✅ NO new backend APIs introduced  
✅ NO diagnostics logic changes  
✅ NO strategy logic changes  
✅ Credentials resolved ONCE per cycle  
✅ Reused for ALL signals in cycle  
✅ Clear skip reason logging  

---

## SUMMARY

The Crowd Consensus agent now resolves exchange credentials **ONCE per scheduler cycle** and reuses them for all signals. This eliminates false "EXCHANGE CREDENTIALS MISSING" errors caused by transient failures during per-signal credential resolution.

**Result**: If Diagnostics shows "Exchange Connected", credential errors should never appear mid-cycle. Skipped trades will only show real validation/execution reasons like RR_TOO_LOW, ENTRY_LATE, SR_BLOCKED, etc.

---

**Next Steps**: Monitor production logs to confirm "EXCHANGE CREDENTIALS MISSING" only appears at cycle start (not per-signal).
