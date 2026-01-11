# Design Document: AUTO-TRADE Research Stall Fix

## Overview

This design addresses the AUTO-TRADE research execution stall issue where the diagnostic reports "STALLED" even though the scheduler interval is running. The root cause is that `processUserResearch()` contains multiple early return paths that exit before updating `lastResearchRunAt` and writing history entries. This causes the diagnostic to incorrectly report the research as stalled, even though the interval callback continues to fire.

The fix implements a guaranteed state update pattern where all execution paths (success, skip, error) must update timestamps and write history before returning.

## Architecture

### Current Architecture Issues

1. **Early Returns Without State Updates**: Multiple `return` statements in `processUserResearch()` exit before updating `lastResearchRunAt`
2. **Conditional History Writes**: History writing is conditional on execution success, causing gaps in history
3. **Provider Validation Blocking**: News providers are required for AUTO_TRADE mode, but should be optional
4. **Interval Recreation**: Scheduler heartbeat may unnecessarily recreate intervals, disrupting timing

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Interval Callback (fires every N minutes)                   │
│                                                              │
│  1. Capture timestamp (executionStartTime)                  │
│  2. Call processUserResearchSafe(uid)                       │
│     │                                                        │
│     ├─> 3. Call processUserResearch(uid)                    │
│     │      │                                                 │
│     │      ├─> 4. Execute research (may succeed/fail/skip)  │
│     │      │                                                 │
│     │      └─> 5. ALWAYS execute finally block:             │
│     │             - Write history (SUCCESS/SKIPPED/REJECTED) │
│     │             - Update lastResearchRunAt                 │
│     │             - Update jobState                          │
│     │                                                         │
│     └─> 6. Handle timeout/error (write SKIPPED history)     │
│                                                              │
│  7. Update nextRunAt for next cycle                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Principles

1. **Guaranteed State Updates**: Use try-finally pattern to ensure state updates occur regardless of execution path
2. **Comprehensive History**: Write history for ALL execution outcomes (success, skip, error)
3. **Timestamp Capture**: Capture timestamp at start of execution, write in finally block
4. **Provider Flexibility**: Make news providers optional for AUTO_TRADE mode
5. **Interval Stability**: Only recreate intervals when frequency or mode actually changes

## Components and Interfaces

### 1. State Update Coordinator

**Purpose**: Ensures state updates occur for all execution paths

**Interface**:
```typescript
interface StateUpdateCoordinator {
  // Capture execution start time
  captureStartTime(): Timestamp;
  
  // Update state in finally block (guaranteed execution)
  updateStateGuaranteed(
    uid: string,
    startTime: Timestamp,
    result: ExecutionResult
  ): Promise<void>;
}

interface ExecutionResult {
  status: 'SUCCESS' | 'SKIPPED' | 'REJECTED' | 'ERROR';
  reason?: string;
  symbol?: string;
  accuracy?: number;
  signal?: 'BUY' | 'SELL' | 'HOLD';
}
```

**Implementation Strategy**:
- Wrap `processUserResearch()` body in try-finally
- Capture `executionStartTime` before try block
- In finally block, always call `updateStateGuaranteed()`
- `updateStateGuaranteed()` writes history and updates timestamp

### 2. History Writer

**Purpose**: Writes history entries for all execution outcomes

**Interface**:
```typescript
interface HistoryWriter {
  // Write history with guaranteed execution
  writeHistoryGuaranteed(
    uid: string,
    entry: HistoryEntry
  ): Promise<void>;
  
  // Create history entry from execution result
  createHistoryEntry(
    result: ExecutionResult,
    mode: ResearchMode
  ): HistoryEntry;
}

interface HistoryEntry {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  price: number;
  tradePlan: TradePlan | null;
  isDeepResearch: boolean;
  source: 'AUTO_TRADE' | 'TELEGRAM_BACKGROUND';
  status: 'SUCCESS' | 'SKIPPED' | 'REJECTED';
  skipReason?: string;
  timestamp: Timestamp;
}
```

**Implementation Strategy**:
- Extract history writing logic into dedicated function
- Call from finally block with execution result
- Handle write failures gracefully (log but don't throw)
- Always write history, even for errors

### 3. Provider Validator

**Purpose**: Validates provider requirements based on research mode

**Interface**:
```typescript
interface ProviderValidator {
  // Validate providers for given mode
  validateProviders(
    uid: string,
    mode: ResearchMode
  ): Promise<ProviderValidationResult>;
}

interface ProviderValidationResult {
  valid: boolean;
  reason?: string;
  hasMarketData: boolean;
  hasNews: boolean;
}

type ResearchMode = 'AUTO_TRADE_RESEARCH' | 'TELEGRAM_BACKGROUND_RESEARCH';
```

**Validation Rules**:
- **AUTO_TRADE_RESEARCH**: Requires market data only (news optional)
- **TELEGRAM_BACKGROUND_RESEARCH**: Requires both market data and news

**Implementation Strategy**:
- Check provider configuration at start of execution
- For AUTO_TRADE mode, proceed if market data exists
- For TELEGRAM mode, require both market and news
- If validation fails, return SKIPPED result (don't throw)

### 4. Interval Manager

**Purpose**: Manages research intervals with stability guarantees

**Interface**:
```typescript
interface IntervalManager {
  // Create or update interval (only if needed)
  ensureInterval(
    uid: string,
    frequency: number,
    mode: ResearchMode
  ): IntervalUpdateResult;
  
  // Check if interval needs recreation
  needsRecreation(
    uid: string,
    newFrequency: number,
    newMode: ResearchMode
  ): boolean;
}

interface IntervalUpdateResult {
  created: boolean;
  reason: string;
}
```

**Stability Rules**:
- Only recreate interval if frequency changes
- Only recreate interval if mode changes
- Scheduler heartbeat must NOT recreate intervals
- Store frequency and mode in jobState for comparison

**Implementation Strategy**:
- Store current frequency and mode in `userJobStates`
- Compare new values with stored values
- Only clear and recreate if values differ
- Log interval recreation for debugging

## Data Models

### JobState (Enhanced)

```typescript
interface UserJobState {
  isRunning: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  mode: 'TELEGRAM_BACKGROUND_RESEARCH' | 'AUTO_TRADE_RESEARCH';
  frequencyMinutes: number; // Store for comparison
  lastExecutionResult?: ExecutionResult; // Track last result
}
```

### ExecutionContext

```typescript
interface ExecutionContext {
  uid: string;
  mode: ResearchMode;
  startTime: Timestamp;
  frequencyMinutes: number;
  settings: BackgroundResearchSettings;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Timestamp Update Guarantee

*For any* research execution (regardless of success, failure, or skip), the `lastResearchRunAt` timestamp must be updated before the function returns.

**Validates: Requirements 1.2, 4.2, 4.3**

**Test Strategy**: Generate random execution scenarios (success, various skip reasons, various errors) and verify timestamp is always updated.

### Property 2: History Writing Guarantee

*For any* research execution, a history entry must be written with appropriate status (SUCCESS/SKIPPED/REJECTED) before the function returns.

**Validates: Requirements 1.3, 1.4, 3.1, 3.3, 3.4**

**Test Strategy**: Generate random execution scenarios and verify history is written with correct status for each outcome.

### Property 3: Provider Validation for AUTO_TRADE

*For any* AUTO_TRADE_RESEARCH execution with market data providers but no news providers, research must proceed (not be blocked).

**Validates: Requirements 2.1, 2.2**

**Test Strategy**: Create scenarios with only market data providers in AUTO_TRADE mode and verify research executes.

### Property 4: Provider Validation Failure Handling

*For any* provider validation failure, both history entry (with SKIPPED status) and timestamp must be updated before returning.

**Validates: Requirements 2.4, 2.5**

**Test Strategy**: Inject provider validation failures and verify both history and timestamp are updated.

### Property 5: Interval Stability

*For any* call to `updateUserResearchSchedule` with unchanged frequency and mode, the existing interval must not be cleared or recreated.

**Validates: Requirements 7.1, 7.2**

**Test Strategy**: Call update function multiple times with same parameters and verify interval ID remains unchanged.

### Property 6: Interval Recreation on Change

*For any* call to `updateUserResearchSchedule` with changed frequency or mode, the old interval must be cleared and a new interval created.

**Validates: Requirements 7.3, 7.4**

**Test Strategy**: Change frequency or mode and verify old interval is cleared and new one is created.

### Property 7: Event Loop Yielding

*For any* batch of users processed in `checkAndScheduleUserResearch`, the scheduler must yield to the event loop between batches.

**Validates: Requirements 8.2**

**Test Strategy**: Monitor event loop during batch processing and verify yield occurs between batches.

### Property 8: Diagnostic Stall Detection

*For any* research execution where `lastResearchRunAt` is updated within 2× the configured frequency, the diagnostic must report status PASS (not STALLED).

**Validates: Requirements 5.1, 5.2**

**Test Strategy**: Create scenarios with various timestamp ages and verify diagnostic correctly identifies stalled vs active research.

### Property 9: History Count Monotonicity

*For any* sequence of research executions, the history entry count must increase monotonically (never decrease or stay static across multiple cycles).

**Validates: Requirements 5.4, 5.5**

**Test Strategy**: Run multiple research cycles and verify history count increases after each cycle.

### Property 10: AUTO_TRADE Bypass During Pause

*For any* AUTO_TRADE_RESEARCH execution when background tasks are paused, research must proceed (not be blocked by pause).

**Validates: Requirements 8.5**

**Test Strategy**: Pause background tasks and verify AUTO_TRADE research continues while TELEGRAM research is blocked.

## Error Handling

### Error Categories

1. **Provider Validation Errors**: Return SKIPPED result, write history, update timestamp
2. **Research Generation Errors**: Return SKIPPED result, write history, update timestamp
3. **Execution Errors**: Return ERROR result, write history, update timestamp
4. **History Write Errors**: Log error, continue with timestamp update
5. **State Update Errors**: Log error, don't throw (prevent blocking next cycle)

### Error Handling Pattern

```typescript
async function processUserResearch(uid: string) {
  const startTime = Timestamp.now();
  let executionResult: ExecutionResult = {
    status: 'ERROR',
    reason: 'Unknown error'
  };
  
  try {
    // Execution logic here
    // Set executionResult based on outcome
  } catch (error) {
    executionResult = {
      status: 'ERROR',
      reason: error.message
    };
  } finally {
    // GUARANTEED: Always execute regardless of try/catch outcome
    await updateStateGuaranteed(uid, startTime, executionResult);
  }
}
```

### Graceful Degradation

- History write failures: Log error, continue with timestamp update
- Timestamp update failures: Log error, don't throw exception
- Provider validation failures: Return SKIPPED, don't block execution
- Research generation failures: Return SKIPPED, don't block state updates

## Testing Strategy

### Unit Tests

1. **State Update Tests**
   - Test timestamp update on success
   - Test timestamp update on skip
   - Test timestamp update on error
   - Test history write on success
   - Test history write on skip
   - Test history write on error

2. **Provider Validation Tests**
   - Test AUTO_TRADE with market data only (should pass)
   - Test AUTO_TRADE with no providers (should skip)
   - Test TELEGRAM with market data only (should skip)
   - Test TELEGRAM with both providers (should pass)

3. **Interval Management Tests**
   - Test interval not recreated when frequency unchanged
   - Test interval not recreated when mode unchanged
   - Test interval recreated when frequency changes
   - Test interval recreated when mode changes

4. **Error Handling Tests**
   - Test history write failure doesn't block timestamp update
   - Test timestamp update failure doesn't throw exception
   - Test provider validation failure writes history
   - Test research generation failure writes history

### Property-Based Tests

Each property test should run minimum 100 iterations with randomized inputs.

1. **Property 1: Timestamp Update Guarantee**
   - Generate random execution outcomes
   - Verify timestamp always updated
   - Tag: `Feature: auto-trade-research-stall-fix, Property 1: Timestamp Update Guarantee`

2. **Property 2: History Writing Guarantee**
   - Generate random execution outcomes
   - Verify history always written
   - Tag: `Feature: auto-trade-research-stall-fix, Property 2: History Writing Guarantee`

3. **Property 3: Provider Validation for AUTO_TRADE**
   - Generate random provider configurations
   - Verify AUTO_TRADE proceeds with market data only
   - Tag: `Feature: auto-trade-research-stall-fix, Property 3: Provider Validation for AUTO_TRADE`

4. **Property 4: Provider Validation Failure Handling**
   - Generate random validation failures
   - Verify both history and timestamp updated
   - Tag: `Feature: auto-trade-research-stall-fix, Property 4: Provider Validation Failure Handling`

5. **Property 5: Interval Stability**
   - Generate random update calls with same parameters
   - Verify interval not recreated
   - Tag: `Feature: auto-trade-research-stall-fix, Property 5: Interval Stability`

6. **Property 6: Interval Recreation on Change**
   - Generate random parameter changes
   - Verify interval recreated
   - Tag: `Feature: auto-trade-research-stall-fix, Property 6: Interval Recreation on Change`

7. **Property 7: Event Loop Yielding**
   - Generate random user batches
   - Verify yield occurs between batches
   - Tag: `Feature: auto-trade-research-stall-fix, Property 7: Event Loop Yielding`

8. **Property 8: Diagnostic Stall Detection**
   - Generate random timestamp ages
   - Verify diagnostic correctly identifies stalls
   - Tag: `Feature: auto-trade-research-stall-fix, Property 8: Diagnostic Stall Detection`

9. **Property 9: History Count Monotonicity**
   - Generate random execution sequences
   - Verify history count increases
   - Tag: `Feature: auto-trade-research-stall-fix, Property 9: History Count Monotonicity`

10. **Property 10: AUTO_TRADE Bypass During Pause**
    - Generate random pause scenarios
    - Verify AUTO_TRADE continues
    - Tag: `Feature: auto-trade-research-stall-fix, Property 10: AUTO_TRADE Bypass During Pause`

### Integration Tests

1. **End-to-End Stall Fix Test**
   - Start scheduler with AUTO_TRADE enabled
   - Inject various failure scenarios
   - Verify diagnostic never reports STALLED
   - Verify history count increases every cycle

2. **Provider Validation Integration Test**
   - Configure user with market data only
   - Enable AUTO_TRADE mode
   - Verify research executes successfully
   - Verify history shows SUCCESS status

3. **Interval Stability Integration Test**
   - Start scheduler with user
   - Run heartbeat multiple times
   - Verify interval not recreated
   - Verify research continues at correct frequency

### Testing Framework

- **Unit Tests**: Jest with TypeScript
- **Property Tests**: fast-check library for TypeScript
- **Integration Tests**: Jest with real Firestore emulator
- **Minimum Iterations**: 100 per property test

### Test Configuration

```typescript
// fast-check configuration
fc.configureGlobal({
  numRuns: 100, // Minimum iterations per property
  verbose: true,
  seed: Date.now() // Reproducible with seed
});
```
