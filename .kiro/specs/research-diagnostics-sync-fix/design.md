# Design Document

## Overview

The "Recent Cycle Results" UI bug occurs because research cycles write only to `users/{uid}/research_history` while the UI reads only from `users/{uid}/agentDiagnostics/{agentId}/entries`. This design implements a synchronization mechanism that ensures every research cycle outcome is also written to the diagnostics collection, making all cycle results visible in the UI.

The solution involves adding diagnostic entry creation calls to existing history saving functions without modifying the UI or changing the research_history collection structure.

## Architecture

### Current Data Flow
```
Research Cycle → research_history collection
Recent Cycle Results UI → agentDiagnostics collection (empty)
```

### Fixed Data Flow
```
Research Cycle → research_history collection (unchanged)
              → agentDiagnostics collection (new)
Recent Cycle Results UI → agentDiagnostics collection (populated)
```

### Integration Points

The fix integrates at the history saving layer:
- `saveAutoTradeHistoryWithExecutionStatus()` - for executed/skipped cycles with research results
- `saveAutoTradeHistorySkipped()` - for cycles skipped before research execution

## Components and Interfaces

### Modified Components

#### 1. AutoTradeHistory Service (`autoTradeHistory.ts`)
**Purpose**: Centralized history management for auto-trade cycles
**Modifications**: Add diagnostic entry creation to existing history functions

**New Function**: `createDiagnosticFromHistory()`
```typescript
async function createDiagnosticFromHistory(
  uid: string,
  historyEntry: any,
  executionStatus: 'EXECUTED' | 'SKIPPED' | 'FAILED',
  cycleId?: string
): Promise<void>
```

#### 2. Firestore Adapter (`firestoreAdapter.ts`)
**Purpose**: Database abstraction layer
**Modifications**: None - uses existing `saveAgentDiagnostic()` function

### Data Transformation Logic

#### Symbol Format Conversion
```typescript
// Convert BTCUSDT → BTC/USDT
function convertSymbolToTradingPair(symbol: string): string {
  if (!symbol || symbol === 'AUTO_TRADE_CYCLE' || symbol === 'UNKNOWN') {
    return 'AUTO_TRADE_CYCLE';
  }
  
  // Handle USDT pairs: BTCUSDT → BTC/USDT
  if (symbol.endsWith('USDT')) {
    const base = symbol.slice(0, -4);
    return `${base}/USDT`;
  }
  
  // Handle other pairs or return as-is
  return symbol;
}
```

#### Signal to Direction Mapping
```typescript
function mapSignalToDirection(signal: string): 'LONG' | 'SHORT' | undefined {
  switch (signal?.toUpperCase()) {
    case 'BUY': return 'LONG';
    case 'SELL': return 'SHORT';
    case 'HOLD':
    default: return undefined;
  }
}
```

#### Execution Status Mapping
```typescript
function mapExecutionStatus(
  decisionStatus: string,
  executionStatus: string | null,
  skipReason?: string
): 'EXECUTED' | 'SKIPPED' | 'FAILED' {
  if (decisionStatus === 'EXECUTED') return 'EXECUTED';
  if (skipReason?.includes('EXCHANGE') || skipReason?.includes('ERROR')) return 'FAILED';
  return 'SKIPPED';
}
```

## Data Models

### Diagnostic Entry Structure
```typescript
interface DiagnosticEntry {
  agentType: 'TRADING_AGENT';
  tradingPair: string;           // Converted from symbol
  direction?: 'LONG' | 'SHORT';  // Mapped from signal
  decision: {
    action: 'EXECUTED' | 'SKIPPED' | 'FAILED';
    reason: string;              // From skipReason or execution details
  };
  execution?: {
    status: 'EXECUTED' | 'SKIPPED' | 'FAILED';
    success: boolean;
    exchangeErrorReason?: string;
  };
  signal?: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rrRatio: number;
  };
}
```

### Firestore Path Structure
```
users/{uid}/agentDiagnostics/AUTO_TRADE_AGENT/entries/{autoId}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, here are the consolidated correctness properties:

**Property 1: Dual Write Consistency**
*For any* research cycle completion, the system should write the outcome to both research_history and agentDiagnostics collections with consistent data
**Validates: Requirements 1.1, 1.3, 2.1, 2.2, 2.3, 2.4**

**Property 2: Data Format Conversion**
*For any* research data being converted to diagnostics format, all field mappings should be applied correctly (symbol→tradingPair, signal→direction, skipReason→decision.reason, executionStatus mapping, exchangeError→exchangeErrorReason)
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

**Property 3: Research History Preservation**
*For any* research cycle, the research_history collection writes should remain completely unchanged from the original behavior
**Validates: Requirements 4.1, 4.4**

**Property 4: Diagnostic Entry Completeness**
*For any* diagnostic entry created, it should use the correct Firestore path format and include all required fields (uid, agentId, tradingPair, direction, decision, executionStatus, cycleId, timestamp)
**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

<function_calls>
<invoke name="prework">
<parameter name="featureName">research-diagnostics-sync-fix

## Error Handling

### Exchange Connection Errors
- **Not Connected**: Create diagnostic entry with FAILED status and "Exchange not connected" reason
- **Disconnected**: Create diagnostic entry with FAILED status and "Exchange disconnected by user" reason
- **Invalid Credentials**: Create diagnostic entry with FAILED status and specific credential error details

### Research Execution Errors
- **API Key Missing**: Create diagnostic entry with SKIPPED status and "No research API keys configured" reason
- **Research Timeout**: Create diagnostic entry with FAILED status and "Research execution timeout" reason
- **Deep Research Failure**: Create diagnostic entry with FAILED status and specific error details

### Data Validation Errors
- **Missing Symbol**: Use fallback "AUTO_TRADE_CYCLE" and create diagnostic entry with available data
- **Invalid Accuracy**: Set accuracy to 0 and create diagnostic entry with SKIPPED status
- **Missing Signal**: Use "HOLD" as fallback and create diagnostic entry

### Firestore Write Errors
- **Diagnostic Write Failure**: Log error but do not block research_history write (diagnostics are non-critical)
- **Research History Write Failure**: Propagate error as this is critical for system operation

## Testing Strategy

### Dual Testing Approach
The testing strategy combines unit tests for specific scenarios with property-based tests for comprehensive coverage:

**Unit Tests**:
- Test specific data transformation examples (BTCUSDT → BTC/USDT)
- Test error handling scenarios (exchange disconnection, API failures)
- Test edge cases (missing data, invalid formats)
- Test integration points between history and diagnostics functions

**Property-Based Tests**:
- Test dual write consistency across all possible cycle outcomes
- Test data format conversion for all valid symbol/signal combinations
- Test diagnostic entry completeness for all field combinations
- Test research_history preservation across all scenarios

**Property Test Configuration**:
- Use Jest with fast-check library for property-based testing
- Configure minimum 100 iterations per property test
- Tag each test with feature and property reference:
  ```typescript
  // Feature: research-diagnostics-sync-fix, Property 1: Dual Write Consistency
  ```

**Test Coverage Requirements**:
- All history saving functions must have corresponding diagnostic creation tests
- All data transformation functions must have property tests
- All error scenarios must have unit tests
- Integration tests must verify end-to-end flow from research completion to UI display

### Test Implementation Notes
- Mock Firestore operations to avoid external dependencies
- Use test data generators for property-based tests
- Verify both positive and negative test cases
- Test concurrent execution scenarios to ensure no race conditions