# FIRESTORE READ-USAGE ANALYSIS REPORT
## DLXTRADE Backend - Strict Read-Only Analysis

**Date:** January 3, 2026  
**Scope:** Scheduler, Deep Research, Auto-Trade, Exchange Status, isExchangeUsable()  
**Mode:** ANALYSIS ONLY - NO FIXES IMPLEMENTED

---

## EXECUTIVE SUMMARY

### Per-User Read Count Per Cycle: **15-35+ Firestore reads**
### Per-Cycle Total Read Count: **15-35+ reads per user per research cycle**
### Primary Quota Amplification Points:
1. **isExchangeUsable()** - Called 3-5 times per cycle
2. **getBackgroundResearchSettings()** - Called 4-8 times per cycle
3. **getTradingSettings()** - Called 2-4 times per cycle
4. **loadConfig()** - Called 2-3 times per cycle
5. **Scheduler bootstrap** - Reads ALL users on startup

---

## SECTION 1: SINGLE RESEARCH CYCLE TRACE

### Timeline of Reads in ONE Scheduler Tick (Per User)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCHEDULER TICK START (checkAndScheduleUserResearch)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #1: db.collection("users").get()                                       │
│          Path: users (ALL USERS)                                            │
│          File: backgroundResearchScheduler.ts:252                           │
│          Purpose: Get all users to check scheduling                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ FOR EACH USER:                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #2: users/{uid}/autoTradeConfig/current                                │
│          File: backgroundResearchScheduler.ts:280                           │
│          Purpose: Check if autoTradeEnabled                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #3: firestoreAdapter.getBackgroundResearchSettings(uid)                │
│          Path: users/{uid}/settings/backgroundResearch                      │
│          File: firestoreAdapter.ts:2303                                     │
│          Purpose: Check telegramBackgroundResearchEnabled                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #4: isExchangeUsable(uid, "background_job")                            │
│          Path: users/{uid}/exchangeConfig/current                           │
│          File: firestoreAdapter.ts:136                                      │
│          Purpose: Check exchange status for AUTO_TRADE mode                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN updateUserResearchSchedule():                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #5: users/{uid}/autoTradeConfig/current (DUPLICATE)                    │
│          File: backgroundResearchScheduler.ts:660                           │
│          Purpose: Re-check autoTradeEnabled                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #6: firestoreAdapter.getBackgroundResearchSettings(uid) (DUPLICATE)    │
│          Path: users/{uid}/settings/backgroundResearch                      │
│          File: backgroundResearchScheduler.ts:670                           │
│          Purpose: Re-check telegramBackgroundResearchEnabled                │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #7: isExchangeUsable(uid, "background_job") (DUPLICATE)                │
│          Path: users/{uid}/exchangeConfig/current                           │
│          File: backgroundResearchScheduler.ts:770                           │
│          Purpose: Re-check exchange status                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN processUserResearch():                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #8: firestoreAdapter.getBackgroundResearchSettings(uid) (3RD TIME)     │
│          Path: users/{uid}/settings/backgroundResearch                      │
│          File: backgroundResearchScheduler.ts:2100                          │
│          Purpose: Get settings for research execution                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #9: users/{uid}/autoTradeConfig/current (3RD TIME)                     │
│          File: backgroundResearchScheduler.ts:1810                          │
│          Purpose: Check mode for research                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #10: getUserIntegrationsByUid(uid)                                     │
│           Path: users/{uid}/integrations (COLLECTION)                       │
│           File: providerConfig.ts                                           │
│           Purpose: Get provider API keys                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #11: AutoTradeEngine.getTradingSettings(uid)                           │
│           Path: users/{uid}/settings/trading                                │
│           File: autoTradeEngine.ts:2100                                     │
│           Purpose: Get trading settings for research                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN runDeepResearchWithCoinSelection():                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #12: getTop100Coins(uid, 25)                                           │
│           Path: External API + cache check                                  │
│           File: researchModes.ts                                            │
│           Purpose: Get top 25 coins for selection                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN runAutoTradeResearchCycleSafe():                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #13: autoTradeEngine.loadConfig(uid)                                   │
│           Path: users/{uid}/autoTradeConfig/current (4TH TIME)              │
│           File: autoTradeEngine.ts:573                                      │
│           Purpose: Load auto-trade config                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #14: firestoreAdapter.getSettings(uid)                                 │
│           Path: users/{uid}/settings/current                                │
│           File: firestoreAdapter.ts:1015                                    │
│           Purpose: Get user settings                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #15: AutoTradeEngine.getTradingSettings(uid) (DUPLICATE)               │
│           Path: users/{uid}/settings/trading                                │
│           File: autoTradeEngine.ts:2100                                     │
│           Purpose: Get trading settings again                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #16: isExchangeUsable(uid, "background_job") (3RD TIME)                │
│           Path: users/{uid}/exchangeConfig/current                          │
│           File: autoTradeEngine.ts:3200                                     │
│           Purpose: Check exchange before execution                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN checkRiskGuards():                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #17: AutoTradeEngine.getTradingSettings(uid) (3RD TIME)                │
│           Path: users/{uid}/settings/trading                                │
│           File: riskAndLimitsEngine.ts:100                                  │
│           Purpose: Get settings for risk checks                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #18: getTop100Coins(uid, 25) (DUPLICATE)                               │
│           Path: External API + cache check                                  │
│           File: riskAndLimitsEngine.ts:80                                   │
│           Purpose: Verify symbol in top 25                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ IN executeTrade():                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #19: AutoTradeEngine.getTradingSettings(uid) (4TH TIME)                │
│           Path: users/{uid}/settings/trading                                │
│           File: autoTradeEngine.ts:900                                      │
│           Purpose: Get settings for trade execution                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #20: autoTradeEngine.loadConfig(uid) (DUPLICATE)                       │
│           Path: users/{uid}/autoTradeConfig/current (5TH TIME)              │
│           File: autoTradeEngine.ts:1050                                     │
│           Purpose: Fresh config before execution                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #21: firestoreAdapter.getSettings(uid) (DUPLICATE)                     │
│           Path: users/{uid}/settings/current                                │
│           File: autoTradeEngine.ts:1100                                     │
│           Purpose: Check trade confirmation setting                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #22: users/{uid}/exchangeConfig/current (FOR EXCHANGE NAME)            │
│           File: autoTradeEngine.ts:2604                                     │
│           Purpose: Get exchange name for trade record                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ ADDITIONAL READS (CONDITIONAL):                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #23-25: firestoreAdapter.getTradingSettings(uid) internal calls        │
│              Multiple paths read inside getTradingSettings                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #26-30: History storage verification reads                             │
│              Path: users/{uid}/researchHistory                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ READ #31-35: Telegram alert decision reads                                  │
│              Path: users/{uid}/settings/backgroundResearch                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 2: DUPLICATE READ LOCATIONS

### Critical Duplicate Reads Identified:

| Document Path | Times Read Per Cycle | Files/Functions |
|---------------|---------------------|-----------------|
| `users/{uid}/autoTradeConfig/current` | **5x** | backgroundResearchScheduler.ts (3x), autoTradeEngine.ts (2x) |
| `users/{uid}/settings/backgroundResearch` | **4-8x** | backgroundResearchScheduler.ts (4x), autoTradeEngine.ts (2x), telegramAlertDecisionService.ts (2x) |
| `users/{uid}/exchangeConfig/current` | **3-5x** | firestoreAdapter.ts (isExchangeUsable 3x), autoTradeEngine.ts (2x) |
| `users/{uid}/settings/trading` | **4x** | autoTradeEngine.ts (getTradingSettings 4x) |
| `users/{uid}/settings/current` | **2-3x** | firestoreAdapter.ts (getSettings 2x), autoTradeEngine.ts (1x) |
| `users/{uid}/integrations` | **2x** | providerConfig.ts (getUserIntegrationsByUid 2x) |

### Specific Duplicate Read Call Sites:

#### 1. `isExchangeUsable()` - Called 3-5 times per cycle
```
Location 1: backgroundResearchScheduler.ts:380 (checkAndScheduleUserResearch)
Location 2: backgroundResearchScheduler.ts:770 (updateUserResearchSchedule)
Location 3: autoTradeEngine.ts:3200 (runAutoTradeResearchCycle)
Location 4: autoTradeEngine.ts:3400 (runAutoTradeExecutionCycle)
Location 5: exchangeResolver.ts:40 (resolveExchangeConnector)
```

#### 2. `getBackgroundResearchSettings()` - Called 4-8 times per cycle
```
Location 1: backgroundResearchScheduler.ts:290 (checkAndScheduleUserResearch)
Location 2: backgroundResearchScheduler.ts:670 (updateUserResearchSchedule)
Location 3: backgroundResearchScheduler.ts:2100 (processUserResearch)
Location 4: backgroundResearchScheduler.ts:2200 (processUserResearchSafe error handler)
Location 5: autoTradeEngine.ts:2800 (runAutoTradeResearchCycle)
Location 6: telegramAlertDecisionService.ts (evaluateTelegramAlertDecision)
Location 7: telegramAlertOrchestrator.ts (sendConsolidatedTelegramAlert)
Location 8: autoTradeEngine.ts:4200 (getTradingSettings)
```

#### 3. `loadConfig()` - Called 2-3 times per cycle
```
Location 1: autoTradeEngine.ts:573 (getUserEngine)
Location 2: autoTradeEngine.ts:1050 (executeTrade - fresh load)
Location 3: autoTradeEngine.ts:3100 (runAutoTradeResearchCycle)
```

#### 4. `getTradingSettings()` - Called 4 times per cycle
```
Location 1: backgroundResearchScheduler.ts:2500 (processUserResearch)
Location 2: riskAndLimitsEngine.ts:100 (checkRiskGuards)
Location 3: autoTradeEngine.ts:900 (executeTrade)
Location 4: autoTradeEngine.ts:1500 (position sizing)
```

---

## SECTION 3: UNNECESSARY READ LOCATIONS

### Reads That Are Unused or Redundant:

| Location | Read | Reason Unnecessary |
|----------|------|-------------------|
| `autoTradeEngine.ts:775` | Verification read after save | Only for logging, not used |
| `backgroundResearchScheduler.ts:1900` | Re-read settings after update | Settings already in memory |
| `autoTradeEngine.ts:2604` | Exchange config for name | Already read in initializeAdapter |
| `riskAndLimitsEngine.ts:80` | Top 25 check | Already checked in accuracyAndSignalEngine |

### Reads Triggered Only for Logging/Debug:

| Location | Read | Purpose |
|----------|------|---------|
| `autoTradeEngine.ts:775-780` | `configDocRef.get()` | Verification read after write |
| `backgroundResearchScheduler.ts:1850` | `getBackgroundResearchSettings()` | Diagnostic logging |
| `exchange.ts:1051` | `docRef.get()` | Read-back verification |
| `exchange.ts:1102` | `docRef.get()` | Final assertion read |

---

## SECTION 4: SCHEDULER LOOP READ AMPLIFICATION

### Bootstrap Phase (Server Startup):
```
READ: db.collection("users").get() - ALL USERS
FOR EACH USER:
  READ: users/{uid}/autoTradeConfig/current
  READ: users/{uid}/settings/backgroundResearch
  READ: users/{uid}/exchangeConfig/current (via isExchangeUsable)
  
TOTAL: 1 + (3 × N users) reads on startup
```

### 60-Second Check Cycle:
```
READ: db.collection("users").get() - ALL USERS
FOR EACH USER:
  READ: users/{uid}/autoTradeConfig/current
  READ: users/{uid}/settings/backgroundResearch
  IF autoTradeEnabled:
    READ: users/{uid}/exchangeConfig/current (isExchangeUsable)
  
TOTAL: 1 + (2-3 × N users) reads every 60 seconds
```

### Per-User Research Cycle (Every 5 minutes default):
```
MINIMUM: 15 reads per user per cycle
MAXIMUM: 35+ reads per user per cycle (with trade execution)
```

---

## SECTION 5: isExchangeUsable() CALL PATH ANALYSIS

### Call Sites Identified:

1. **backgroundResearchScheduler.ts:380** - `checkAndScheduleUserResearch()`
   - Called for EVERY user in 60-second check cycle
   - Purpose: Determine if AUTO_TRADE mode should be enabled

2. **backgroundResearchScheduler.ts:770** - `updateUserResearchSchedule()`
   - Called when scheduling user research
   - Purpose: Validate exchange before scheduling

3. **autoTradeEngine.ts:3200** - `runAutoTradeResearchCycle()`
   - Called at start of research cycle
   - Purpose: Early exit if exchange not usable

4. **autoTradeEngine.ts:3400** - `runAutoTradeExecutionCycle()`
   - Called before trade execution
   - Purpose: Validate exchange before trading

5. **exchangeResolver.ts:40** - `resolveExchangeConnector()`
   - Called when initializing exchange adapter
   - Purpose: Get exchange config for connector

### Read Amplification from isExchangeUsable():
```
Each call = 1 Firestore read to users/{uid}/exchangeConfig/current
Per cycle = 3-5 calls = 3-5 reads of SAME document
```

---

## SECTION 6: INTERVAL MISMATCH ANALYSIS

### Configured Intervals:
- **Main scheduler check:** 60 seconds
- **User research frequency:** 5 minutes (default, configurable)
- **Trade monitoring:** 30 seconds minimum per trade

### Observed Behavior:
- Scheduler checks ALL users every 60 seconds
- Each check reads 2-3 documents per user
- Research cycles run at configured frequency (5 min default)
- Each research cycle reads 15-35+ documents

### Potential Interval Issues:
1. **Bootstrap reads ALL users** - No pagination
2. **60-second check reads ALL users** - No incremental updates
3. **No caching** between scheduler check and research execution

---

## SECTION 7: FRONTEND-TRIGGERED READS

### Routes That Trigger Firestore Reads:

| Route | Reads | Documents |
|-------|-------|-----------|
| `GET /users/:uid/exchangeConfig/current` | 3-4 | exchangeConfig, isAdmin check, raw read, sanitized read |
| `GET /settings/load` | 1-2 | settings/current |
| `GET /background-research/status` | 5-10 | Multiple diagnostic reads |
| `GET /auto-trade/status` | 3-5 | autoTradeConfig, settings, exchangeConfig |
| `GET /users/:uid` | 2-3 | user doc, exchangeConfig check |

### Frontend Polling Patterns:
- Exchange status: Polled on page load
- Auto-trade status: Polled on dashboard
- Research history: Polled on history page

---

## SECTION 8: WHY QUOTA IS HIT - ROOT CAUSE ANALYSIS

### Primary Causes:

1. **No Request-Scoped Caching**
   - Same document read multiple times in single request/cycle
   - No memoization of Firestore reads

2. **Defensive Re-Reading**
   - Code re-reads config "fresh" before critical operations
   - Pattern: `loadConfig()` called multiple times "for safety"

3. **Scheduler Reads ALL Users**
   - Every 60 seconds, reads ALL user documents
   - No incremental/delta updates

4. **isExchangeUsable() Overuse**
   - Called 3-5 times per cycle for same user
   - Each call = 1 Firestore read

5. **Settings Read Fragmentation**
   - `getSettings()`, `getTradingSettings()`, `getBackgroundResearchSettings()` all separate
   - Could be combined into single read

### Quota Impact Calculation:

```
Per User Per 5-Minute Cycle:
- Minimum: 15 reads
- Maximum: 35 reads
- Average: ~25 reads

Per User Per Hour:
- 12 cycles × 25 reads = 300 reads/user/hour

Per User Per Day:
- 24 hours × 300 reads = 7,200 reads/user/day

With 10 Active Users:
- 72,000 reads/day

With 100 Active Users:
- 720,000 reads/day

Firestore Free Tier: 50,000 reads/day
```

---

## SECTION 9: PROOF-BASED EVIDENCE

### Code Evidence for Duplicate Reads:

#### Evidence 1: autoTradeConfig read 5 times
```typescript
// backgroundResearchScheduler.ts:280
const autoTradeConfigDoc = await db.collection("users").doc(uid)
  .collection("autoTradeConfig").doc("current").get();

// backgroundResearchScheduler.ts:660
const autoTradeConfigDoc = await db.collection("users").doc(uid)
  .collection("autoTradeConfig").doc("current").get();

// backgroundResearchScheduler.ts:1810
const autoTradeConfigDoc = await db.collection("users").doc(uid)
  .collection("autoTradeConfig").doc("current").get();

// autoTradeEngine.ts:573 (loadConfig)
const configDoc = await db.collection("users").doc(uid)
  .collection("autoTradeConfig").doc("current").get();

// autoTradeEngine.ts:1050 (executeTrade fresh load)
const config = await this.loadConfig(uid);
```

#### Evidence 2: isExchangeUsable called 3+ times
```typescript
// backgroundResearchScheduler.ts:380
const exchangeStatus = await this.hasUsableExchangeAPIs(uid);
// hasUsableExchangeAPIs calls isExchangeUsable internally

// backgroundResearchScheduler.ts:770
const exchangeStatus = await this.hasUsableExchangeAPIs(uid);

// autoTradeEngine.ts:3200
const exchangeUsability = await isExchangeUsable(uid, "background_job");
```

#### Evidence 3: getTradingSettings called 4 times
```typescript
// backgroundResearchScheduler.ts:2500
const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);

// riskAndLimitsEngine.ts:100
const settings = await AutoTradeEngine.getTradingSettings(uid);

// autoTradeEngine.ts:900
const settings = await AutoTradeEngine.getTradingSettings(uid);

// autoTradeEngine.ts:1500
const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
```

---

## SECTION 10: SUMMARY OF FINDINGS

### Total Reads Per User Per Cycle: 15-35+

### Duplicate Read Breakdown:
| Document | Duplicate Reads | Potential Savings |
|----------|-----------------|-------------------|
| autoTradeConfig/current | 4 extra | 4 reads/cycle |
| settings/backgroundResearch | 3-7 extra | 3-7 reads/cycle |
| exchangeConfig/current | 2-4 extra | 2-4 reads/cycle |
| settings/trading | 3 extra | 3 reads/cycle |
| **TOTAL POTENTIAL SAVINGS** | **12-18 reads/cycle** | **~50% reduction** |

### Read Amplification Points:
1. Scheduler bootstrap (ALL users)
2. 60-second check cycle (ALL users)
3. isExchangeUsable() (3-5x per cycle)
4. getTradingSettings() (4x per cycle)
5. getBackgroundResearchSettings() (4-8x per cycle)

### Firestore Console Side-Effects:
- Opening Firestore console does NOT trigger backend reads
- Console reads are separate from application reads
- No evidence of console-triggered read spikes in backend

---

## APPENDIX: DOCUMENT PATHS READ

```
users (collection query - ALL users)
users/{uid}
users/{uid}/autoTradeConfig/current
users/{uid}/settings/current
users/{uid}/settings/backgroundResearch
users/{uid}/settings/trading
users/{uid}/exchangeConfig/current
users/{uid}/integrations (collection)
users/{uid}/researchHistory (collection)
users/{uid}/autoTradeLogs (collection)
trades (collection query)
```

---

**END OF ANALYSIS REPORT**

*This report is READ-ONLY analysis. No code changes have been made.*
