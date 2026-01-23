# Design Document

## Overview

This design addresses critical issues in the HTF (High Time Frame) Trend Filter Diagnostics system through a comprehensive end-to-end fix. The solution focuses on four main areas: data storage cleanup, UI display enhancements, execution reporting improvements, and system integration constraints.

The current system has several problems:
1. Diagnostic data is incorrectly stored in top-level Firestore collections instead of user-scoped paths
2. UI displays generic "--" values even when actual pair/direction data is available
3. Decision summaries lack detail and expandable information
4. Execution status reporting is missing or shows generic error messages
5. Trade execution logic validation is unclear to users

## Architecture

### Current System Architecture

The HTF diagnostic system follows this flow:
1. **HTF Strategy Service** (`htfTrendFilterStrategy.ts`) - Generates trading signals and diagnostic data
2. **Agent Execution Service** (`agentExecutionService.ts`) - Executes trades and collects execution status
3. **Firestore Adapter** (`firestoreAdapter.ts`) - Persists diagnostic data to Firestore
4. **Diagnostic Routes** (`autoTrade.diagnostic.ts`) - Serves diagnostic data to frontend
5. **AutoTrade UI** (`AutoTrade.tsx`) - Displays diagnostic information to users

### Target Architecture

The enhanced system will maintain the same flow but with improved data handling:
1. **Data Storage Layer** - Enforced user-scoped paths with hard guards
2. **Enhanced Diagnostic Collection** - Preserve actual pair/direction data for all cycles
3. **Improved UI Components** - Rich decision summaries with expandable details
4. **Execution Status Tracking** - Detailed error reporting and status information
5. **Trade Logic Validation** - Clear criteria display for execution decisions

## Components and Interfaces

### 1. Data Storage Components

#### FirestoreAdapter Enhancements
```typescript
interface DiagnosticEntry {
  agentId: string;
  timestamp: Date;
  cycle: {
    type: 'SKIPPED' | 'NO_TRADE' | 'SIGNAL_EVALUATION';
    pair?: string; // Actual evaluated pair (e.g., 'BTCUSDT')
    direction?: 'LONG' | 'SHORT'; // Actual evaluated direction
  };
  decision: {
    summary: string; // e.g., "EMA confirm, RSI confirm, VWAP reject"
    details: {
      ema: { status: 'CONFIRM' | 'REJECT', value?: number };
      rsi: { status: 'CONFIRM' | 'REJECT', value?: number, range?: string };
      vwap: { status: 'CONFIRM' | 'REJECT', value?: number };
      sr: { status: 'CONFIRM' | 'REJECT', level?: number };
      volume: { status: 'CONFIRM' | 'REJECT', value?: number };
    };
  };
  execution: {
    status: 'EXECUTED' | 'SKIPPED' | 'FAILED';
    reason?: string; // Specific reason for skip/failure
    exchangeError?: string; // Exact exchange error message
  };
  tradeLogic: {
    exchangeAgreement: {
      required: number; // e.g., 2
      actual: number; // e.g., 1
      exchanges: string[]; // e.g., ['binance', 'bitget']
    };
    confirmations: {
      rsi: boolean;
      ema: boolean;
      vwap: boolean;
      sr: boolean;
    };
  };
}
```

#### Path Enforcement
- **Canonical Path**: `users/{uid}/agentDiagnostics/{agentId}/entries/{doc}`
- **Hard Guard**: Prevent any writes to top-level `agentDiagnostics` collection
- **Cleanup Script**: One-time removal of old top-level data

### 2. UI Enhancement Components

#### Decision Display Component
```typescript
interface DecisionDisplayProps {
  summary: string;
  details: DiagnosticEntry['decision']['details'];
  onInfoClick: () => void;
}

interface DecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  details: DiagnosticEntry['decision']['details'];
}
```

#### Execution Status Component
```typescript
interface ExecutionStatusProps {
  status: 'EXECUTED' | 'SKIPPED' | 'FAILED';
  reason?: string;
  exchangeError?: string;
  tradeLogic: DiagnosticEntry['tradeLogic'];
}
```

### 3. Backend Service Enhancements

#### HTF Strategy Service Updates
```typescript
interface HTFDiagnosticData {
  evaluatedPair: string | null;
  evaluatedDirection: 'LONG' | 'SHORT' | null;
  indicatorResults: {
    ema: IndicatorResult;
    rsi: IndicatorResult;
    vwap: IndicatorResult;
    sr: IndicatorResult;
    volume: IndicatorResult;
  };
  exchangeAgreement: ExchangeAgreementResult;
  executionAttempt?: ExecutionResult;
}

interface IndicatorResult {
  status: 'CONFIRM' | 'REJECT';
  value?: number;
  metadata?: Record<string, any>;
}
```

## Data Models

### Enhanced Diagnostic Entry Model
```typescript
interface EnhancedDiagnosticEntry {
  // Core identification
  id: string;
  agentId: string;
  userId: string;
  timestamp: Date;
  
  // Cycle information
  cycleType: 'SKIPPED' | 'NO_TRADE' | 'SIGNAL_EVALUATION';
  evaluatedPair: string | null; // Preserve actual evaluated pair
  evaluatedDirection: 'LONG' | 'SHORT' | null; // Preserve actual direction
  
  // Decision breakdown
  decisionSummary: string;
  indicatorDetails: {
    ema: {
      status: 'CONFIRM' | 'REJECT';
      value?: number;
      trend?: string;
    };
    rsi: {
      status: 'CONFIRM' | 'REJECT';
      value?: number;
      range?: string; // e.g., "oversold", "neutral", "overbought"
    };
    vwap: {
      status: 'CONFIRM' | 'REJECT';
      value?: number;
      position?: string; // e.g., "above", "below"
    };
    sr: {
      status: 'CONFIRM' | 'REJECT';
      level?: number;
      type?: string; // e.g., "support", "resistance"
    };
    volume: {
      status: 'CONFIRM' | 'REJECT';
      value?: number;
      threshold?: number;
    };
  };
  
  // Execution information
  executionStatus: 'EXECUTED' | 'SKIPPED' | 'FAILED';
  executionReason?: string;
  exchangeError?: string; // Exact error from exchange
  
  // Trade logic validation
  exchangeAgreementRequired: number;
  exchangeAgreementActual: number;
  participatingExchanges: string[];
  confirmationsPassed: {
    rsi: boolean;
    ema: boolean;
    vwap: boolean;
    sr: boolean;
  };
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### UI Display Models
```typescript
interface DiagnosticDisplayRow {
  timestamp: string;
  pair: string; // Show actual pair or "--" for true skips
  direction: string; // Show actual direction or "--" for true skips
  decisionSummary: string; // Short summary
  executionStatus: 'EXECUTED' | 'SKIPPED' | 'FAILED';
  hasDetails: boolean; // Whether info icon should be shown
}

interface DecisionDetailsModal {
  indicators: {
    name: string;
    status: 'CONFIRM' | 'REJECT';
    value?: string;
    description: string;
  }[];
  tradeLogic: {
    exchangeAgreement: string; // e.g., "1/2 exchanges agreed"
    confirmations: string; // e.g., "3/4 confirmations passed"
    failureReason?: string;
  };
  executionDetails: {
    status: string;
    reason?: string;
    exchangeError?: string;
  };
}
```

Now I need to use the prework tool to analyze the acceptance criteria before writing the correctness properties:

<function_calls>
<invoke name="prework">
<parameter name="featureName">htf-trend-filter-diagnostics-fix

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties can be consolidated:

**Consolidation Areas:**
- Properties 1.1, 1.4, and 1.5 all relate to preventing top-level agentDiagnostics access and can be combined into a comprehensive guard property
- Properties 2.1, 2.2, 2.3, and 2.4 all relate to pair/direction display logic and can be combined into a single display accuracy property
- Properties 3.1, 3.3, 3.4, 3.5, and 3.6 all relate to decision display functionality and can be combined into a comprehensive decision display property
- Properties 4.2, 4.3, 4.4, 4.5, and 4.6 all relate to execution status reporting and can be combined into a comprehensive status reporting property
- Properties 5.1, 5.2, 5.3, 5.4, and 5.5 all relate to trade execution logic and can be combined into a comprehensive execution validation property

**Final Consolidated Properties:**

### Property 1: Firestore Path Security Guard
*For any* attempt to write diagnostic data, the system should enforce user-scoped paths and block any access to the top-level agentDiagnostics collection, logging security violations when blocked
**Validates: Requirements 1.1, 1.4, 1.5**

### Property 2: User-Scoped Diagnostic Persistence
*For any* diagnostic entry, the data should be written exclusively to the users/{uid}/agentDiagnostics/{agentId}/entries/{doc} path format
**Validates: Requirements 1.2**

### Property 3: Pair and Direction Display Accuracy
*For any* diagnostic entry, the UI should display actual evaluated pair and direction when available, and only show "--" placeholders for true SKIPPED/NO_TRADE cycles where no evaluation occurred
**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 4: Decision Display Completeness
*For any* diagnostic entry with indicator data, the UI should display a concise summary with an expandable info icon that reveals complete indicator details including EMA, RSI, VWAP, SR, and Volume status using only real diagnostic data
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 5: Execution Status Reporting Accuracy
*For any* execution attempt, the system should report specific status (EXECUTED/SKIPPED/FAILED) with exact error messages from exchanges rather than generic error text
**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 6: Trade Execution Logic Validation
*For any* trade decision, the system should execute only when both exchange agreement (≥2 exchanges) and all indicator confirmations (RSI, EMA, VWAP, SR) pass, and document specific failure reasons when criteria are not met
**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 7: Build System Validation
*For any* completed implementation, the npm build process should complete successfully without errors
**Validates: Requirements 6.6**

## Error Handling

### Data Storage Error Handling

1. **Top-Level Collection Access Attempts**
   - Block all writes to `agentDiagnostics` collection
   - Log security violations with full context
   - Throw descriptive errors to prevent silent failures

2. **Invalid Path Formats**
   - Validate user ID presence before any diagnostic write
   - Ensure agent ID is valid and belongs to user
   - Handle malformed document IDs gracefully

3. **Firestore Write Failures**
   - Retry transient failures with exponential backoff
   - Log persistent failures for monitoring
   - Maintain diagnostic data in memory for retry attempts

### UI Error Handling

1. **Missing Diagnostic Data**
   - Show loading states while data is being fetched
   - Display appropriate messages for empty states
   - Handle partial data gracefully with fallbacks

2. **Malformed Diagnostic Entries**
   - Validate data structure before rendering
   - Show error indicators for corrupted entries
   - Provide fallback displays for missing fields

3. **Modal and Interaction Errors**
   - Handle click events on missing or invalid data
   - Provide error boundaries for modal components
   - Ensure modals can always be closed

### Exchange Integration Error Handling

1. **Exchange Communication Failures**
   - Capture exact error messages from exchange APIs
   - Distinguish between network errors and business logic errors
   - Store error context for debugging

2. **Execution Failures**
   - Document specific failure reasons (balance, limits, etc.)
   - Preserve error messages without modification
   - Provide actionable error information to users

## Testing Strategy

### Dual Testing Approach

This system requires both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests** focus on:
- Specific error conditions and edge cases
- UI component rendering with various data states
- Integration points between services
- One-time operations like cleanup scripts

**Property Tests** focus on:
- Universal properties that hold across all inputs
- Data validation and transformation correctness
- Security guard effectiveness across all scenarios
- UI display accuracy with randomized diagnostic data

### Property-Based Testing Configuration

- **Library**: Use fast-check for TypeScript/JavaScript property testing
- **Iterations**: Minimum 100 iterations per property test
- **Test Tags**: Each property test must reference its design document property
- **Tag Format**: `Feature: htf-trend-filter-diagnostics-fix, Property {number}: {property_text}`

### Unit Testing Balance

Unit tests complement property tests by covering:
- Specific examples that demonstrate correct behavior
- Edge cases like empty data sets or malformed inputs
- Error conditions that are difficult to generate randomly
- Integration scenarios between frontend and backend components

Property tests handle comprehensive input coverage through randomization, while unit tests ensure specific critical scenarios work correctly.

### Test Categories

1. **Data Storage Tests**
   - Property tests for path enforcement across all diagnostic writes
   - Unit tests for cleanup script execution
   - Integration tests for Firestore adapter security guards

2. **UI Display Tests**
   - Property tests for display accuracy with randomized diagnostic data
   - Unit tests for specific modal interactions
   - Visual regression tests for UI component rendering

3. **Execution Logic Tests**
   - Property tests for trade execution criteria validation
   - Unit tests for specific exchange error scenarios
   - Integration tests for end-to-end diagnostic flow

4. **Error Handling Tests**
   - Property tests for error message preservation
   - Unit tests for specific error conditions
   - Integration tests for error propagation through the system