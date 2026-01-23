# HTF Trend Filter Scalping Agent - EXCHANGE_ERROR Fix

## Problem Statement

The HTF Trend Filter Scalping Agent is repeatedly showing EXCHANGE_ERROR for skipped users, even when the agent execution never actually ran. This creates false error states in the UI and confuses users who see EXCHANGE_ERROR when their modes are simply disabled.

**Root Causes:**
1. HTF agent is executed by tradingAgentScheduler even when user modes (autoTradeEnabled, telegramBackgroundResearchEnabled) are disabled
2. Diagnostics are being written with EXCHANGE_ERROR even when agent execution never ran
3. EXCHANGE_ERROR is being set as a fallback/default instead of only when exchange is actually unusable
4. No single source of truth for determining when EXCHANGE_ERROR should be set

## User Stories

### 1. Mode-Based Execution Control
**As a** user with both autoTradeEnabled=false and telegramBackgroundResearchEnabled=false  
**I want** the HTF Trend Filter agent to be skipped entirely at the scheduler level  
**So that** I don't see false EXCHANGE_ERROR states when my modes are simply disabled

**Acceptance Criteria:**
- 1.1: When both autoTradeEnabled=false AND telegramBackgroundResearchEnabled=false, HTF agent execution is skipped
- 1.2: Skipped execution shows decision.action="SKIPPED" and reason="MODES_DISABLED"
- 1.3: No EXCHANGE_ERROR is set when modes are disabled
- 1.4: User can see in UI that agent was skipped due to disabled modes, not exchange issues

### 2. EXCHANGE_ERROR Truth Source
**As a** system administrator  
**I want** EXCHANGE_ERROR to be set ONLY when the exchange is actually unusable  
**So that** error states accurately reflect real exchange connectivity issues

**Acceptance Criteria:**
- 2.1: EXCHANGE_ERROR is set ONLY when isExchangeUsable().usable === false
- 2.2: All other paths that previously defaulted to EXCHANGE_ERROR are removed/blocked
- 2.3: No reuse of previous EXCHANGE_ERROR states from previous cycles
- 2.4: No inference of EXCHANGE_ERROR from decrypt warnings when exchange is usable

### 3. Safe Decision Initialization
**As a** developer  
**I want** all agent decisions to be safely initialized with non-error defaults  
**So that** we never accidentally persist error states when no error occurred

**Acceptance Criteria:**
- 3.1: Decision is initialized with action="SKIPPED" and reason="NO_SIGNAL" by default
- 3.2: EXCHANGE_ERROR is never used as a default/fallback value
- 3.3: Decision state is reset at the start of each execution cycle

### 4. Persistence Safety Guards
**As a** user viewing agent diagnostics  
**I want** skipped cycles to have clean diagnostic data  
**So that** I don't see confusing exchange-related fields when the agent was simply skipped

**Acceptance Criteria:**
- 4.1: When decision.action="SKIPPED", exchange-related fields are deleted before persistence
- 4.2: Fields deleted include: exchangeError, exchangeErrorReason, symbol, pair, direction
- 4.3: Only relevant skip reason is shown in UI

### 5. Final Assertion Guard
**As a** system reliability measure  
**I want** a last-resort guard against invalid EXCHANGE_ERROR states  
**So that** even if bugs exist elsewhere, invalid error states are corrected before persistence

**Acceptance Criteria:**
- 5.1: If decision.action="EXCHANGE_ERROR" AND exchangeUsable=true, force convert to SKIPPED
- 5.2: Converted decision shows reason="INVALID_ERROR_SUPPRESSED"
- 5.3: Original invalid state is logged for debugging

## Technical Requirements

### TR-1: Single Source of Truth for Mode Checking
- HTF agent execution must check the SAME source used by backgroundResearchScheduler
- Read autoTradeEnabled from users/{userId}/autoTradeConfig/current
- Read telegramBackgroundResearchEnabled from firestoreAdapter.getBackgroundResearchSettings()
- If BOTH are false, skip execution immediately with MODES_DISABLED reason

### TR-2: EXCHANGE_ERROR Restriction
- EXCHANGE_ERROR may be set ONLY when isExchangeUsable().usable === false
- Remove ALL other code paths that set EXCHANGE_ERROR as default/fallback
- Block reuse of previous EXCHANGE_ERROR states from previous cycles
- Block inference of EXCHANGE_ERROR from decrypt warnings when exchange is usable

### TR-3: Safe Initialization
- Initialize decision with action="SKIPPED", reason="NO_SIGNAL" at function start
- Never use EXCHANGE_ERROR as default initialization value
- Reset all execution state at start of each cycle

### TR-4: Persistence Guards
- Before calling storeDiagnostics(), check if agent execution actually ran
- If decision.action="SKIPPED", delete exchange-related fields
- Ensure clean diagnostic data for skipped cycles

### TR-5: Scheduler Safety Net
- In tradingAgentScheduler, if user is skipped due to modes disabled, never call executeAgent for HTF agent
- Never write EXCHANGE_ERROR diagnostics for mode-disabled users

### TR-6: Final Assertion Guard
- Before storeDiagnostics(), assert: if decision.action="EXCHANGE_ERROR" AND exchangeUsable=true, force convert to SKIPPED
- Log warning when this conversion occurs for debugging

## Test Requirements

### Test File: htfTrendFilter.skipModes.test.ts
The test must verify all scenarios and FAIL before fix, PASS after fix:

**Test Cases:**
1. **Both modes disabled**: autoTrade=false AND telegramResearch=false → HTF agent NOT executed → decision=SKIPPED → reason=MODES_DISABLED
2. **Exchange usable + no signal**: exchange usable + no signal → decision=SKIPPED → NO EXCHANGE_ERROR
3. **Exchange unusable**: exchange unusable → decision=EXCHANGE_ERROR (valid case)
4. **Assertion guard**: exchange usable + EXCHANGE_ERROR attempted → forced to SKIPPED

## Success Metrics

1. **Zero False EXCHANGE_ERRORs**: HTF agents with disabled modes show SKIPPED, not EXCHANGE_ERROR
2. **Accurate Error States**: EXCHANGE_ERROR appears only when exchange is actually unusable
3. **Clean UI Experience**: Users see clear skip reasons instead of confusing error states
4. **Test Coverage**: All scenarios covered by automated tests that fail before fix and pass after

## Constraints

- Modify existing code only - no new files except test file
- No folder restructuring or UI changes
- Fix applies ONLY to HTF Trend Filter Agent (strategyType='HTF_TREND_FILTER' or name contains 'HTF Trend Filter')
- Use minimal logic changes
- Maintain backward compatibility

## Dependencies

- Existing agentExecutionService.executeAgent() method
- Existing firestoreAdapter.getBackgroundResearchSettings() method
- Existing backgroundResearchScheduler mode checking logic
- Existing storeDiagnostics() method
- Existing test infrastructure

## Out of Scope

- Changes to other agent types
- UI modifications
- New diagnostic schemas
- Performance optimizations beyond the fix
- Changes to backgroundResearchScheduler itself

## Verification Steps

1. Run existing test - should FAIL before fix
2. Implement fix according to technical requirements
3. Run test again - should PASS after fix
4. Run `npm run build` - should succeed
5. Manual verification: Check HTF agent diagnostics for users with disabled modes