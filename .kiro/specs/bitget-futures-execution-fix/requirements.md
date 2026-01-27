# Requirements Document

## Introduction

This specification addresses comprehensive audit and fix of ALL Bitget trade execution issues to ensure reliable futures-only trading with zero spot dependency. The system currently fails to execute trades on Bitget due to incorrect endpoint usage, symbol format conversion, and spot market fallbacks that prevent futures trading execution.

## Glossary

- **Bitget_Adapter**: The exchange-specific adapter that handles Bitget API communication
- **Exchange_Connector**: The service layer that coordinates between agents and exchange adapters
- **Agent_Execution_Service**: The core service that processes trade execution requests from agents
- **Futures_Symbol**: Raw symbol format used by Bitget futures (e.g., "BTCUSDT")
- **Spot_Symbol**: Normalized symbol format that should NOT be used for Bitget (e.g., "BTC/USDT")
- **Manual_Trade_Flow**: User-initiated trade execution through UI routes
- **Auto_Trade_Flow**: Agent-initiated trade execution through automated systems
- **Spot_Endpoint**: Any API endpoint containing "/spot/" that must be blocked for Bitget
- **Futures_Endpoint**: Bitget futures/mix API endpoints that must be used exclusively

## Requirements

### Requirement 1: Complete Execution Flow Tracing

**User Story:** As a developer, I want to trace both manual and auto trade execution flows end-to-end, so that I can identify where spot dependencies and symbol conversion issues occur.

#### Acceptance Criteria

1. WHEN tracing manual trade flow, THE System SHALL document the complete path from routes through AgentExecutionService to ExchangeConnector to BitgetAdapter
2. WHEN tracing auto trade flow, THE System SHALL document the complete path from routes through AgentExecutionService to ExchangeConnector to BitgetAdapter
3. WHEN analyzing execution flows, THE System SHALL identify every point where spot endpoints are called
4. WHEN analyzing execution flows, THE System SHALL identify every point where symbol format conversion occurs
5. WHEN documenting flows, THE System SHALL capture all error conditions and fallback behaviors

### Requirement 2: Spot Dependency Elimination

**User Story:** As a system administrator, I want to eliminate all spot market dependencies for Bitget, so that futures trading can execute without spot market interference.

#### Acceptance Criteria

1. WHEN auditing the codebase, THE System SHALL identify every location where spot endpoints are used
2. WHEN auditing the codebase, THE System SHALL identify every location where spot-style symbols are created
3. WHEN auditing the codebase, THE System SHALL identify any fallback logic that assumes spot markets
4. WHEN auditing the codebase, THE System SHALL identify any ticker or price checks that run before futures order execution
5. WHEN Bitget is the selected exchange, THE System SHALL block ALL spot endpoint calls immediately
6. IF a spot endpoint is detected for Bitget, THEN THE System SHALL throw an error immediately without silent fallback

### Requirement 3: Symbol Handling Standardization

**User Story:** As a trading system, I want standardized symbol handling for Bitget futures, so that symbols are correctly formatted throughout the execution pipeline.

#### Acceptance Criteria

1. WHEN receiving symbols from call-sites, THE System SHALL accept raw symbols in Bitget format (e.g., "BTCUSDT")
2. WHEN processing symbols, THE Bitget_Adapter SHALL be the ONLY component that normalizes symbols
3. WHEN handling futures symbols, THE System SHALL never convert them to spot format (e.g., "BTC/USDT")
4. WHEN validating symbols, THE System SHALL ensure futures symbols maintain their raw format throughout the pipeline
5. WHEN symbol conversion is needed, THE System SHALL perform it only within BitgetAdapter boundaries

### Requirement 4: Futures-Only Hard Guards

**User Story:** As a system security measure, I want hard guards that prevent any spot operations when Bitget is selected, so that futures-only trading is enforced.

#### Acceptance Criteria

1. WHEN the exchange is Bitget, THE System SHALL block ALL spot endpoints with immediate error
2. WHEN detecting "/spot/" in any API call for Bitget, THE System SHALL throw an error immediately
3. WHEN spot operations are attempted, THE System SHALL NOT silently fallback to alternative behavior
4. WHEN validating exchange operations, THE System SHALL enforce futures-only mode for Bitget
5. WHEN initializing Bitget operations, THE System SHALL verify futures-only configuration

### Requirement 5: Futures Operations Enforcement

**User Story:** As a futures trader, I want all Bitget operations to use futures endpoints exclusively, so that ticker data, balances, leverage, and orders work correctly.

#### Acceptance Criteria

1. WHEN fetching ticker data for Bitget, THE System SHALL use futures/mix endpoints exclusively
2. WHEN fetching balance data for Bitget, THE System SHALL use futures account endpoints exclusively
3. WHEN setting leverage for Bitget, THE System SHALL use futures leverage endpoints exclusively
4. WHEN placing orders for Bitget, THE System SHALL use futures order endpoints with LONG/SHORT support
5. WHEN validating market data, THE System SHALL ensure all data comes from futures endpoints

### Requirement 6: Pre-check Logic Fixes

**User Story:** As a trade execution system, I want pre-execution checks to validate using futures data only, so that trades are not blocked by spot market requirements.

#### Acceptance Criteria

1. WHEN running testOrderExecution for Bitget, THE System SHALL validate using futures ticker data only
2. WHEN performing pre-execution validation, THE System SHALL NOT require spot market availability
3. WHEN checking order prerequisites, THE System SHALL NOT block execution due to spot price fetch failures
4. WHEN validating trading conditions, THE System SHALL use futures market data exclusively
5. WHEN performing connectivity tests, THE System SHALL verify futures endpoint accessibility only

### Requirement 7: Spot Price Logic Removal

**User Story:** As a futures trading system, I want to remove all spot price dependencies, so that futures orders can execute without spot market validation.

#### Acceptance Criteria

1. WHEN preparing order execution, THE System SHALL remove any logic that checks spot price before futures orders
2. WHEN validating order parameters, THE System SHALL remove spot ticker validation for quantity, price, or minimum notional
3. WHEN calculating order values, THE System SHALL use futures market data exclusively
4. WHEN performing price validation, THE System SHALL use futures price feeds only
5. WHEN checking market conditions, THE System SHALL ignore spot market status entirely

### Requirement 8: Final Validation and Testing

**User Story:** As a quality assurance measure, I want comprehensive validation that Bitget trades execute reliably on futures only, so that the system works as intended.

#### Acceptance Criteria

1. WHEN executing manual trades on Bitget, THE System SHALL complete execution on futures markets successfully
2. WHEN executing auto trades on Bitget, THE System SHALL complete execution on futures markets successfully
3. WHEN monitoring API calls during execution, THE System SHALL never call any "/spot/" endpoint
4. WHEN analyzing symbol usage during execution, THE System SHALL never generate symbols like "BTC/USDT" anywhere in the pipeline
5. WHEN testing end-to-end execution, THE System SHALL demonstrate zero spot dependency and no execution-time skips or soft failures