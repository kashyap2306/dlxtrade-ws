# Requirements Document

## Introduction

The HTF Trend Filter Agent currently evaluates only one configured trading pair and saves diagnostics as cycle-level summaries. This creates a mismatch with the frontend, which expects coin-level diagnostics for each symbol (BTCUSDT, ETHUSDT, etc.). The system needs to be modified to evaluate all allowed trading symbols and save separate diagnostic entries for each symbol.

## Glossary

- **HTF_Agent**: HTF Trend Filter Agent that performs trend analysis
- **Trading_Symbol**: A specific cryptocurrency trading pair (e.g., BTCUSDT, ETHUSDT)
- **Diagnostic_Entry**: A record containing analysis results for a specific symbol
- **Firestore_Adapter**: Service responsible for saving diagnostic data to Firestore
- **Frontend_UI**: React-based user interface that displays diagnostic information
- **Agent_Config**: Configuration object containing trading parameters
- **Decision_Reason**: Explanation for why a trading decision was made (e.g., "EMA rejected", "RSI rejected")

## Requirements

### Requirement 1: Multi-Symbol Evaluation

**User Story:** As a trading system operator, I want the HTF Trend Filter Agent to evaluate all allowed trading symbols, so that I can see diagnostic information for each individual cryptocurrency pair.

#### Acceptance Criteria

1. WHEN the HTF Agent executes, THE HTF_Agent SHALL iterate over all allowed trading symbols
2. WHEN evaluating symbols, THE HTF_Agent SHALL NOT rely only on agentConfig.tradingPair
3. WHEN processing multiple symbols, THE HTF_Agent SHALL perform trend analysis for each symbol independently
4. WHEN a symbol evaluation completes, THE HTF_Agent SHALL determine direction (LONG/SHORT/NO_TRADE) for that specific symbol
5. WHEN generating decisions, THE HTF_Agent SHALL create decision reasons specific to each symbol's analysis

### Requirement 2: Per-Symbol Diagnostic Persistence

**User Story:** As a system administrator, I want each trading symbol to have its own diagnostic entry, so that the frontend can display detailed information for each cryptocurrency pair.

#### Acceptance Criteria

1. WHEN saving diagnostics, THE HTF_Agent SHALL call firestoreAdapter.saveAgentDiagnostic() for each evaluated symbol
2. WHEN creating diagnostic entries, THE HTF_Agent SHALL include symbol or tradingPair field with coin-level data
3. WHEN storing diagnostic data, THE HTF_Agent SHALL include direction field (LONG/SHORT/NO_TRADE)
4. WHEN persisting results, THE HTF_Agent SHALL include decision.reason field with analysis explanation
5. WHEN saving entries, THE HTF_Agent SHALL include status field (SKIPPED or EXECUTED)
6. WHEN creating diagnostics, THE HTF_Agent SHALL set agentId to HTF_TREND_FILTER_AGENT
7. THE HTF_Agent SHALL NOT merge multiple symbols into a single diagnostic entry
8. THE HTF_Agent SHALL NOT store diagnostics under AUTO_TRADE_CYCLE

### Requirement 3: Existing Infrastructure Preservation

**User Story:** As a system maintainer, I want the diagnostic fix to use existing storage mechanisms, so that no new infrastructure needs to be created or maintained.

#### Acceptance Criteria

1. WHEN implementing the fix, THE System SHALL use existing diagnostic storage logic only
2. THE System SHALL NOT create new Firestore collections
3. THE System SHALL NOT create new files or folders
4. WHEN modifying code, THE System SHALL modify existing files only
5. THE System SHALL NOT duplicate existing diagnostic logic

### Requirement 4: Frontend Compatibility

**User Story:** As a user viewing the diagnostics UI, I want to see detailed information for each cryptocurrency pair, so that I can understand the trading decisions for individual symbols.

#### Acceptance Criteria

1. WHEN displaying diagnostics, THE Frontend_UI SHALL show symbol-specific entries (BTCUSDT, ETHUSDT, etc.)
2. WHEN rendering diagnostic data, THE Frontend_UI SHALL display direction information (LONG/SHORT/NO_TRADE)
3. WHEN showing analysis results, THE Frontend_UI SHALL display decision reasons (EMA rejected, RSI rejected, etc.)
4. WHEN diagnostic data exists for symbols, THE Frontend_UI SHALL NOT show "--" for Pair and Direction fields
5. THE Frontend_UI SHALL remain unchanged during this implementation

### Requirement 5: Data Validation and Integrity

**User Story:** As a system operator, I want diagnostic data to be complete and accurate, so that I can trust the information displayed in the UI.

#### Acceptance Criteria

1. WHEN creating diagnostic entries, THE HTF_Agent SHALL validate that all required fields are present
2. WHEN saving symbol data, THE HTF_Agent SHALL ensure symbol names are properly formatted
3. WHEN storing direction data, THE HTF_Agent SHALL use only valid direction values (LONG/SHORT/NO_TRADE)
4. WHEN persisting decision reasons, THE HTF_Agent SHALL provide meaningful explanations
5. WHEN handling errors during symbol evaluation, THE HTF_Agent SHALL log errors and continue processing other symbols