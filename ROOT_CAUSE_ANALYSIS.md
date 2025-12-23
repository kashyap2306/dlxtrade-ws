# ROOT CAUSE ANALYSIS - Research, History, Telegram, Auto-Trade System

## PHASE 1: DEEP ANALYSIS RESULTS

### A) MANUAL COIN RESEARCH FLOW - ROOT CAUSES IDENTIFIED

#### Flow Trace:
1. **Frontend** (`ResearchPanel.tsx:1038`): `researchApi.run({ mode: 'manual', symbols: [normalizedSymbol] })`
2. **Backend POST Route** (`research.ts:377-389`): Checks `hasValidApiKey(uid)` - ✅ CORRECT (uses encrypted keys)
3. **Backend Worker** (`research.ts:481-482`): Calls `getUserIntegrations(uid)` - Returns ENCRYPTED keys
4. **Backend Worker** (`research.ts:518`): Calls `runFreeModeDeepResearch(uid, targetSymbol, configs, integrations, true, ...)`
   - ❌ **ROOT CAUSE #1**: `backgroundMode` is hardcoded to `true`
   - ❌ **ROOT CAUSE #2**: `integrations` contains ENCRYPTED keys (`apiKeyEncrypted`) but engine expects DECRYPTED keys (`apiKey`)
5. **DeepResearchEngine** (`deepResearchEngine.ts:85`): Determines context as `'background_job'` (wrong for manual)
6. **DeepResearchEngine** (`deepResearchEngine.ts:88-96`): If integrations provided, uses them (but they're encrypted!)
7. **DeepResearchEngine** (`deepResearchEngine.ts:100-103`): Validates `apiKey` (decrypted) but integrations has `apiKeyEncrypted` (encrypted)
   - ❌ **ROOT CAUSE #3**: Validation fails because encrypted keys are checked as if they were decrypted

#### Root Cause #1: POST Route Hardcodes backgroundMode=true
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 518
- **Issue**: `runFreeModeDeepResearch(..., true, ...)` hardcodes `backgroundMode: true`
- **Impact**: Manual research uses `'background_job'` context instead of `'user_request'`
- **Evidence**: Line 518 shows `true` hardcoded, line 85 in deepResearchEngine uses this to set context

#### Root Cause #2: Encrypted vs Decrypted Key Mismatch
- **File**: `dlxtrade-ws/src/routes/research.ts` → `dlxtrade-ws/src/services/deepResearchEngine.ts`
- **Lines**: research.ts:481-482 (gets encrypted) → deepResearchEngine.ts:100-103 (expects decrypted)
- **Issue**: Worker passes `integrations` from `getUserIntegrations()` which returns `apiKeyEncrypted`, but engine checks for `apiKey`
- **Impact**: Validation fails even when keys exist, because engine looks for wrong field name
- **Evidence**: 
  - `getUserIntegrations` returns `apiKeyEncrypted` (integrations.ts:77)
  - Engine checks `p?.apiKey` (deepResearchEngine.ts:101)

#### Root Cause #3: Frontend Still Shows API Gate Modal
- **File**: `frontend/src/pages/ResearchPanel.tsx`
- **Line**: 953-954
- **Issue**: Code still exists that sets `setShowApiGateModal(true)` and `setMissingApis(missing)`
- **Impact**: Even though we removed the check, the modal UI code still exists and may be triggered elsewhere
- **Evidence**: Lines 65-66 define state, lines 1631-1668 show modal UI, line 953 sets modal to show

---

### B) MANUAL BEST-COIN RESEARCH FLOW - ROOT CAUSES IDENTIFIED

#### Flow Trace:
1. **Frontend** (`ResearchPanel.tsx:771`): `researchApi.run({ type: 'global', source: 'auto_select', mode: 'global' })`
2. **Backend POST Route** (`research.ts:392`): `isGlobal = true`, skips manual validation
3. **Backend Worker** (`research.ts:481-482`): Gets encrypted integrations
4. **Backend Worker** (`research.ts:518`): Calls `runFreeModeDeepResearch(..., true, ...)` - ❌ Same issues as manual coin
5. **History Write** (`research.ts:612`): Only writes if `isDeepResearch` is true
   - ❌ **ROOT CAUSE #4**: Global research sets `isDeepResearch = false` (line 508), so history is NEVER written
6. **Telegram Alert** (`research.ts:638`): Only sends if `isDeepResearch` is true
   - ❌ **ROOT CAUSE #5**: Global research never sends Telegram alerts because `isDeepResearch = false`

#### Root Cause #4: Global Research Never Writes History
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 508, 612
- **Issue**: `isDeepResearch = body.mode === 'manual' || body.type === 'manual' || !isGlobal`
  - For global research: `isGlobal = true`, so `isDeepResearch = false`
  - History write is gated by `if (isDeepResearch)` (line 612)
- **Impact**: Best-coin research never writes to history
- **Evidence**: Line 508 sets `isDeepResearch = false` for global, line 612 only writes if true

#### Root Cause #5: Global Research Never Sends Telegram Alerts
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 612, 638
- **Issue**: Telegram alert is inside `if (isDeepResearch)` block
- **Impact**: Best-coin research never sends Telegram alerts
- **Evidence**: Line 638 is inside the `if (isDeepResearch)` block starting at line 612

---

### C) RESEARCH HISTORY PIPELINE - ROOT CAUSES IDENTIFIED

#### Root Cause #6: History Write Depends on isDeepResearch Flag
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 612
- **Issue**: History write is gated by `if (isDeepResearch)` which excludes global research
- **Impact**: Global/best-coin research never writes history
- **Evidence**: Line 612 condition excludes global research

#### Root Cause #7: History Write May Fail Silently
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 613-636
- **Issue**: History write is in try-catch but errors are only logged, not surfaced
- **Impact**: If history write fails, user sees no indication
- **Evidence**: Line 636 logs success, but catch block (not shown) may swallow errors

#### Root Cause #8: GET Route History Write May Not Execute
- **File**: `dlxtrade-ws/src/routes/research.ts`
- **Line**: 1367-1434
- **Issue**: History write is inside `if (res)` block, but if research fails, `res` is null
- **Impact**: Failed GET route research never writes failure history
- **Evidence**: Line 1344 checks `if (res)`, but error path (line 1290-1341) doesn't write history

---

### D) AUTO-TRADE PIPELINE - ROOT CAUSES IDENTIFIED

#### Root Cause #9: Auto-Trade Research May Use Wrong Context
- **File**: `dlxtrade-ws/src/services/autoTradeEngine.ts`
- **Line**: 2859 (calls `runDeepResearchWithCoinSelection`)
- **Issue**: Need to verify if auto-trade passes correct context
- **Impact**: May have same decryption issues as manual research

#### Root Cause #10: Auto-Trade History Write Depends on skipHistoryStorage Flag
- **File**: `dlxtrade-ws/src/services/autoTradeEngine.ts`
- **Line**: 2949
- **Issue**: History write is gated by `if (!skipHistoryStorage)`
- **Impact**: If flag is set, history is never written
- **Evidence**: Line 2949 condition may skip history

---

### E) API KEY SYSTEM - ROOT CAUSES IDENTIFIED

#### Root Cause #11: Two Different Functions Return Different Key Formats
- **Files**: 
  - `dlxtrade-ws/src/routes/integrations.ts:40` - Returns ENCRYPTED (`apiKeyEncrypted`)
  - `dlxtrade-ws/src/routes/users/providerConfig.ts:318` - Returns DECRYPTED (`apiKey`)
- **Issue**: `getUserIntegrations` returns encrypted, `getUserIntegrationsByUid` returns decrypted
- **Impact**: Code that expects one format gets the other, causing validation failures
- **Evidence**: 
  - integrations.ts:77 returns `apiKeyEncrypted`
  - providerConfig.ts:432 returns `apiKey` (decrypted)

#### Root Cause #12: Validation Checks Wrong Field Name
- **File**: `dlxtrade-ws/src/services/deepResearchEngine.ts`
- **Line**: 100-103
- **Issue**: Checks for `p?.apiKey` (decrypted) but receives `p?.apiKeyEncrypted` (encrypted)
- **Impact**: Validation always fails when encrypted keys are passed
- **Evidence**: Line 101 checks `apiKey`, but integrations from `getUserIntegrations` has `apiKeyEncrypted`

---

## PHASE 2: ROOT CAUSE SUMMARY

### Confirmed Root Causes (with file/line references):

1. **POST Route Hardcodes backgroundMode=true** (`research.ts:518`)
   - Manual research uses wrong context, causing decryption to fail

2. **Encrypted vs Decrypted Key Mismatch** (`research.ts:481-482` → `deepResearchEngine.ts:100-103`)
   - Worker passes encrypted keys, engine expects decrypted keys

3. **Frontend API Gate Modal Still Exists** (`ResearchPanel.tsx:953-954, 1631-1668`)
   - Modal code still present, may be triggered

4. **Global Research Never Writes History** (`research.ts:508, 612`)
   - `isDeepResearch = false` for global, history write gated by this flag

5. **Global Research Never Sends Telegram Alerts** (`research.ts:612, 638`)
   - Telegram alert inside `isDeepResearch` block

6. **History Write Depends on isDeepResearch** (`research.ts:612`)
   - Excludes global research from history

7. **History Write May Fail Silently** (`research.ts:613-636`)
   - Errors logged but not surfaced

8. **GET Route Failure History Not Written** (`research.ts:1344`)
   - Error path doesn't write history (but we added it, need to verify)

9. **Auto-Trade Context Verification Needed** (`autoTradeEngine.ts:2859`)
   - Need to verify context usage

10. **Auto-Trade History Gated by Flag** (`autoTradeEngine.ts:2949`)
    - May skip history if flag set

11. **Two Functions Return Different Formats** (`integrations.ts:40` vs `providerConfig.ts:318`)
    - Inconsistent key format causes validation failures

12. **Validation Checks Wrong Field** (`deepResearchEngine.ts:100-103`)
    - Checks `apiKey` but receives `apiKeyEncrypted`

13. **GET Route Also Hardcodes backgroundMode=true** (`deepResearchEngine.ts:716` → `researchModes.ts:265`)
    - `deepResearchEngine.getCoinResearch` passes callback with `backgroundMode: true` hardcoded
    - `researchModes.getCoinResearch` also hardcodes `backgroundMode: true` in the call
    - Both override the logic in `deepResearchEngine.getCoinResearch` that tries to set it correctly
    - Impact: GET route manual research also uses wrong context

---

## PHASE 3: FIX PLAN

### Critical Fixes Required:

1. **Fix POST Route backgroundMode**: Change hardcoded `true` to `!isGlobal` (manual = false, global = true)
2. **Fix Encrypted Key Mismatch**: Either:
   - Option A: Don't pass integrations to engine, let it call `getUserIntegrationsByUid` with correct context
   - Option B: Decrypt keys in worker before passing to engine
3. **Remove Frontend API Gate Modal**: Remove all code related to `showApiGateModal`
4. **Fix Global Research History**: Write history for global research too
5. **Fix Global Research Telegram**: Send Telegram alerts for global research
6. **Fix Validation Logic**: Check for both `apiKey` and `apiKeyEncrypted` OR normalize before checking
7. **Ensure All Failures Write History**: Both POST and GET routes must write failure history
8. **Verify Auto-Trade Context**: Ensure auto-trade uses correct context

---

## PHASE 4: VERIFICATION PLAN

After fixes, verify:
1. Manual coin research runs with user_request context
2. History is written for both manual and global research
3. Telegram alerts are sent for both manual and global research
4. API key validation works with any valid key
5. Auto-trade writes history correctly
6. All failures write failure history

