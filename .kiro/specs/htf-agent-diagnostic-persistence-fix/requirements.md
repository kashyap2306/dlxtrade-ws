# HTF Trend Filter Agent - Diagnostic Persistence Fix

## Problem Statement

The HTF Trend Filter agent's "Recent Cycle Results" UI does not update after scheduler runs, even after 5+ minutes. The root cause is that diagnostics are NOT being persisted for EVERY scheduler execution cycle - only when certain code paths are hit (trades executed, specific skip conditions).

## User Stories

### 1. Complete Diagnostic History
**As a** trader monitoring the HTF Trend Filter agent  
**I want** to see a new diagnostic entry after EVERY 5-minute scheduler cycle  
**So that** I can verify the agent is running and understand why trades were skipped

**Acceptance Criteria:**
- 1.1: After every scheduler execution (5-minute interval), exactly ONE diagnostic record is persisted
- 1.2: Diagnostic records are created even when:
  - Agent is STOPPED
  - Insufficient candle data
  - HTF trend not aligned
  - Session blocked
  - RR too low
  - Cooldown active
  - Daily limit reached
  - Position limit reached
  - Any other skip condition
- 1.3: Each diagnostic includes: cycleTimestamp, decisionType (TRADE/SKIPPED/BLOCKED/NO_TRADE), reason(s), agentId, symbol

### 2. UI Auto-Update
**As a** trader viewing the agent control page  
**I want** the "Recent Cycle Results" to automatically show new entries  
**So that** I don't need to refresh the page to see the latest agent activity

**Acceptance Criteria:**
- 2.1: UI polling mechanism fetches and displays new diagnostic entries
- 2.2: New entries appear within 10 seconds of scheduler execution
- 2.3: No page refresh required to see updates

### 3. Historical Integrity
**As a** system administrator  
**I want** all diagnostic records to be appended (not overwritten)  
**So that** we maintain a complete audit trail of agent decisions

**Acceptance Criteria:**
- 3.1: Diagnostics are appended as history (cycle-based)
- 3.2: Previous diagnostics are never overwritten
- 3.3: Diagnostic collection maintains chronological order

## Technical Requirements

### TR-1: Mandatory Diagnostic Persistence
- Every execution of `executeAgent()` MUST call `agent.storeDiagnostics(diagnostics)` before returning
- This applies to ALL code paths, including early returns

### TR-2: Diagnostic Data Structure
- Must include all relevant decision factors:
  - Timestamp of cycle execution
  - Decision type: TRADE | SKIPPED | BLOCKED | NO_TRADE
  - Reason(s) for decision (array or string)
  - Agent ID
  - Trading pair/symbol
  - Session check results
  - HTF trend analysis (for HTF agents)
  - LTF signal analysis (for HTF agents)
  - Risk analysis
  - Position limits status

### TR-3: No Schema Changes
- Use existing `storeDiagnostics()` method
- Use existing Firestore collections
- No new collections or schemas required

### TR-4: Minimal Code Changes
- Modify only `agentExecutionService.ts`
- Add diagnostic persistence to early return paths
- Do NOT change frontend logic unless necessary

## Out of Scope

- Creating new diagnostic collections
- Modifying folder structure
- Adding new files
- Changing diagnostic data schema
- Performance optimization beyond the fix

## Success Metrics

1. **100% Diagnostic Coverage**: Every scheduler cycle produces exactly one diagnostic record
2. **UI Responsiveness**: New entries appear within 10 seconds of cycle completion
3. **Zero Data Loss**: No diagnostic records are skipped or overwritten
4. **Backward Compatibility**: Existing diagnostic queries continue to work

## Dependencies

- Existing `storeDiagnostics()` method in TradingAgent class
- Existing `firestoreAdapter.saveAgentDiagnostic()` method
- Existing UI polling mechanism in frontend

## Constraints

- Must not impact agent execution performance
- Must not change existing diagnostic format
- Must maintain backward compatibility with existing UI code
