# Design Document

## Overview

This design addresses the comprehensive audit and fix of Bitget trade execution issues to ensure reliable futures-only trading with zero spot dependency. The system currently fails to execute trades on Bitget due to incorrect endpoint usage, symbol format conversion, and spot market fallbacks that prevent futures trading execution.

The fix involves tracing both manual and auto trade execution flows, eliminating all spot dependencies, standardizing symbol handling, implementing futures-only hard guards, and ensuring all operations use futures endpoints exclusively.

## Architecture

### Current Execution Flow Architecture

The trading system follows this execution path:

**Manual Trade Flow:**
```
Frontend UI → /api/agents/:agentId/execute-manual-trade → AgentExecutionService.executeManualTrade() → ExchangeConnectorFactory → BitgetAdapter → Bitget API
```

**Auto Trade Flow:**
```
Background Scheduler → AgentExecutionService.executeAllAgents() → AgentExecutionService.executeAgent() → TradingAgentMarketProvider → ExchangeConnector → BitgetAdapter → Bitget API
```

### Problem Areas Identified

1. **Symbol Conversion Issues**: Symbols are converted from raw format (BTCUSDT) to normalized format (BTC/USDT) at multiple points
2. **Spot Endpoint Usage**: Some code paths still attempt to use spot endpoints for Bitget
3. **Fallback Logic**: System falls back to spot operations when futures operations fail
4. **Mixed Market Types**: TradingAgentMarketProvider defaults to 'spot' market type

## Components and Interfaces

### Core Components

#### 1. AgentExecutionService
- **Location**: `dlxtrade-ws/src/services/agentExecutionService.ts`
- **Role**: Orchestrates trade execution for both manual and automated agents
- **Key Methods**:
  - `executeManualTrade()`: Handles manual trade execution
  - `executeAgent()`: Handles automated agent execution
  - `placeOrderFromTradeAtomic()`: Places orders with SL/TP

#### 2. TradingAgentMarketProvider
- **Location**: `dlxtrade-ws/src/services/tradingAgentMarketProvider.ts`
- **Role**: Provides market data and order placement interface
- **Key Methods**:
  - `getCandles()`: Fetches candle data
  - `getAccountBalance()`: Fetches account balance
  - `placeOrder()`: Places orders with SL/TP

#### 3. BitgetAdapter
- **Location**: `dlxtrade-ws/src/services/bitgetAdapter.ts`
- **Role**: Implements Bitget-specific API operations
- **Key Methods**:
  - `getTicker()`: Fetches ticker data
  - `getKlines()`: Fetches candle data
  - `getFuturesBalance()`: Fetches futures account balance
  - `placeOrder()`: Places futures orders

#### 4. ExchangeConnectorFactory
- **Location**: `dlxtrade-ws/src/services/exchangeConnector.ts`
- **Role**: Creates exchange-specific adapters
- **Key Methods**:
  - `create()`: Factory method for creating exchange connectors

### Interface Contracts

#### MarketDataProvider Interface
```typescript
interface MarketDataProvider {
  getCandles(symbol: string, timeframe: string, limit: number): Promise<CandleData[]>;
  getAccountBalance(): Promise<{ equity: number; available: number }>;
  placeOrder(order: OrderParams): Promise<string>;
}
```

#### ExchangeConnector Interface
```typescript
interface ExchangeConnector {
  getTicker(symbol?: string): Promise<any>;
  getKlines(symbol: string, interval: string, limit: number): Promise<any[]>;
  getFuturesBalance(): Promise<BalanceInfo>;
  placeOrder(params: OrderParams): Promise<any>;
  testConnection(): Promise<ConnectionResult>;
}
```

## Data Models

### Symbol Format Standards

#### Raw Symbol Format (Bitget Native)
- **Format**: `BTCUSDT`, `ETHUSDT`
- **Usage**: Direct API calls to Bitget
- **Location**: BitgetAdapter only

#### Normalized Symbol Format (Internal)
- **Format**: `BTC/USDT`, `ETH/USDT`
- **Usage**: Internal system representation
- **Location**: UI, database storage, user-facing displays

### Order Parameters
```typescript
interface OrderParams {
  symbol: string;        // Raw format for Bitget
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}
```

### Balance Information
```typescript
interface BalanceInfo {
  exchange: string;
  availableBalance: number;
  totalBalance: number;
  currency: string;
  marketType: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Now I need to use the prework tool to analyze the acceptance criteria before writing the correctness properties:

<function_calls>
<invoke name="prework">
<parameter name="featureName">bitget-futures-execution-fix

### Property Reflection

After analyzing the acceptance criteria, I identified several properties that can be consolidated:

**Redundancy Analysis:**
- Properties 2.5, 2.6, 4.1, 4.2 all test spot endpoint blocking - can be combined into one comprehensive property
- Properties 3.3, 3.4 both test symbol format preservation - can be combined
- Properties 5.1, 5.2, 5.3, 5.4, 5.5 all test futures endpoint usage - can be combined into one comprehensive property
- Properties 6.1, 6.4, 6.5 all test validation using futures data - can be combined
- Properties 7.3, 7.4 both test futures data usage - can be combined
- Properties 8.3, 8.4 both test execution monitoring - can be combined

### Testable Properties

Based on the prework analysis, here are the consolidated correctness properties:

**Property 1: Spot endpoint blocking for Bitget**
*For any* API call when exchange is Bitget, if the endpoint contains "/spot/", then the system should throw an error immediately without silent fallback
**Validates: Requirements 2.5, 2.6, 4.1, 4.2, 4.3**

**Property 2: Symbol format preservation**
*For any* futures symbol processed through the Bitget pipeline, the symbol should never be converted to spot format (e.g., "BTC/USDT") and should maintain its raw format throughout
**Validates: Requirements 3.1, 3.3, 3.4**

**Property 3: Futures endpoint enforcement**
*For any* Bitget operation (ticker, balance, leverage, orders, market data), the system should use futures/mix endpoints exclusively and never call spot endpoints
**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

**Property 4: Futures-only validation**
*For any* validation operation for Bitget (order execution tests, trading conditions, connectivity tests), the system should use futures data exclusively and not require spot market availability
**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

**Property 5: Futures data usage in calculations**
*For any* calculation or validation operation for Bitget (order values, price validation, market conditions), the system should use futures market data exclusively and ignore spot market status
**Validates: Requirements 7.3, 7.4, 7.5**

**Property 6: Execution monitoring compliance**
*For any* trade execution on Bitget (manual or auto), monitoring the execution should show zero "/spot/" endpoint calls and no spot-format symbols generated anywhere in the pipeline
**Validates: Requirements 8.3, 8.4**

## Error Handling

### Spot Endpoint Detection
- **Error Type**: `SPOT_ENDPOINT_FORBIDDEN_FOR_BITGET`
- **Trigger**: Any attempt to call endpoints containing "/spot/" when exchange is Bitget
- **Response**: Immediate error throw, no fallback behavior
- **Location**: BitgetAdapter.request() method

### Symbol Format Validation
- **Error Type**: `INVALID_SYMBOL_FORMAT`
- **Trigger**: Spot-format symbols detected in Bitget futures operations
- **Response**: Reject operation with clear error message
- **Location**: Symbol normalization points

### Futures Endpoint Failures
- **Error Type**: `FUTURES_ENDPOINT_UNAVAILABLE`
- **Trigger**: Futures endpoints return errors
- **Response**: Fail operation, do not fallback to spot
- **Location**: BitgetAdapter API methods

### Market Type Mismatches
- **Error Type**: `MARKET_TYPE_MISMATCH`
- **Trigger**: Spot market type specified for Bitget operations
- **Response**: Force futures market type or reject operation
- **Location**: TradingAgentMarketProvider constructor

## Testing Strategy

### Dual Testing Approach

**Unit Tests:**
- Test specific error conditions (spot endpoint blocking, symbol format validation)
- Test edge cases (empty symbols, invalid market types)
- Test integration points between components
- Focus on concrete examples of correct and incorrect behavior

**Property-Based Tests:**
- Test universal properties across all inputs using randomized data
- Generate random symbols, API endpoints, and operation types
- Verify properties hold for all valid combinations
- Run minimum 100 iterations per property test

### Property Test Configuration

Each property test will:
- Run minimum 100 iterations due to randomization
- Reference its corresponding design document property
- Use tag format: **Feature: bitget-futures-execution-fix, Property {number}: {property_text}**
- Generate diverse test inputs (symbols, endpoints, operation types)

### Test Coverage Areas

**Manual Trade Flow Testing:**
- Route handling (`/api/agents/:agentId/execute-manual-trade`)
- AgentExecutionService.executeManualTrade()
- ExchangeConnectorFactory.create()
- BitgetAdapter operations

**Auto Trade Flow Testing:**
- AgentExecutionService.executeAllAgents()
- TradingAgentMarketProvider operations
- BitgetAdapter futures operations
- Error propagation through the stack

**Integration Testing:**
- End-to-end manual trade execution
- End-to-end auto trade execution
- API call monitoring and validation
- Symbol format tracing through pipeline

### Testing Tools and Libraries

**Property-Based Testing Library:** 
- Use fast-check for TypeScript property-based testing
- Generate random test data for comprehensive coverage
- Configure for minimum 100 iterations per test

**API Monitoring:**
- Intercept HTTP requests to monitor endpoint usage
- Validate no "/spot/" endpoints are called for Bitget
- Track symbol formats through the execution pipeline

**Mock and Stub Strategy:**
- Mock Bitget API responses for consistent testing
- Stub external dependencies for isolated testing
- Use dependency injection for testable components