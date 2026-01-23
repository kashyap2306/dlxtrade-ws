# Requirements Document

## Introduction

This specification addresses critical issues in the HTF (High Time Frame) Trend Filter Diagnostics system, focusing on data persistence cleanup, UI display improvements, and execution reporting enhancements. The system currently suffers from incorrect Firestore data storage locations, unclear UI feedback for trading decisions, and missing execution status information that prevents users from understanding why trades were or were not executed.

## Glossary

- **HTF_System**: The High Time Frame Trend Filter trading system
- **Diagnostic_Engine**: The component responsible for collecting and storing diagnostic data
- **UI_Display**: The frontend interface showing diagnostic information
- **Execution_Engine**: The component responsible for trade execution decisions
- **Firestore_Adapter**: The service managing Firestore database operations
- **Exchange_Interface**: The component handling exchange communications

## Requirements

### Requirement 1: Data Storage Cleanup

**User Story:** As a system administrator, I want to ensure diagnostic data is stored in the correct Firestore location, so that data is properly organized and accessible per user.

#### Acceptance Criteria

1. THE HTF_System SHALL permanently stop writing to the top-level agentDiagnostics collection
2. THE Diagnostic_Engine SHALL write data exclusively to users/{uid}/agentDiagnostics/{agentId}/entries/{doc} path
3. WHEN the cleanup script runs, THE HTF_System SHALL delete all existing top-level agentDiagnostics collection data
4. THE Firestore_Adapter SHALL implement a hard guard preventing creation of top-level agentDiagnostics documents
5. WHEN any component attempts to write to top-level agentDiagnostics, THE Firestore_Adapter SHALL reject the operation and log an error

### Requirement 2: Pair and Direction Display Enhancement

**User Story:** As a trader, I want to see accurate pair and direction information in diagnostics, so that I can understand what the system evaluated even for skipped trades.

#### Acceptance Criteria

1. WHEN a trading cycle is SKIPPED or NO_TRADE, THE UI_Display SHALL show "--" for both Pair and Direction
2. WHEN a real signal evaluation occurs (even if ultimately skipped), THE UI_Display SHALL show the evaluated pair (e.g., BTCUSDT)
3. WHEN a real signal evaluation occurs (even if ultimately skipped), THE UI_Display SHALL show the evaluated direction (LONG or SHORT)
4. THE UI_Display SHALL NOT default to "--" when symbol or direction information is actually available
5. THE Diagnostic_Engine SHALL preserve evaluated pair and direction data regardless of final execution decision

### Requirement 3: Decision Summary Interface

**User Story:** As a trader, I want to see a concise decision summary with detailed breakdown capability, so that I can quickly understand trading decisions and drill down when needed.

#### Acceptance Criteria

1. THE UI_Display SHALL show a short text summary in the Decision column (e.g., "EMA confirm, RSI confirm, VWAP reject")
2. THE UI_Display SHALL display a small ⓘ info icon next to each Decision entry
3. WHEN the info icon is clicked, THE UI_Display SHALL show a detailed breakdown popup
4. THE detailed breakdown SHALL include EMA status, RSI value with range check, VWAP status, SR status, and Volume status
5. THE UI_Display SHALL use existing diagnostic data without generating fake or placeholder text
6. THE decision summary SHALL accurately reflect the actual indicator confirmations and rejections

### Requirement 4: Execution Status Reporting

**User Story:** As a trader, I want to see detailed execution status information, so that I understand exactly why trades were executed, skipped, or failed.

#### Acceptance Criteria

1. THE UI_Display SHALL include an Execution Status column or expandable section
2. THE Execution_Engine SHALL report status as EXECUTED, SKIPPED, or FAILED
3. WHEN status is FAILED or SKIPPED due to exchange issues, THE UI_Display SHALL show the exact exchange error message
4. THE UI_Display SHALL display specific error messages like "Insufficient balance", "Minimum order size not met", "Position already open", "Exchange disconnected"
5. THE UI_Display SHALL NOT show generic "EXCHANGE ERROR" messages
6. THE Execution_Engine SHALL capture and preserve exact error messages from exchange responses

### Requirement 5: Trade Execution Logic Validation

**User Story:** As a trader, I want trades to execute only when proper conditions are met, so that I can trust the system's decision-making process.

#### Acceptance Criteria

1. THE Execution_Engine SHALL execute trades only when at least 2 exchanges agree on direction
2. THE Execution_Engine SHALL execute trades only when RSI, EMA, VWAP, and SR confirmations all pass
3. WHEN a trade is not executed, THE Diagnostic_Engine SHALL clearly document the specific reason
4. THE UI_Display SHALL show the exact criteria that failed when trades are not executed
5. THE Execution_Engine SHALL validate all conditions before attempting trade execution

### Requirement 6: System Integration Constraints

**User Story:** As a developer, I want to enhance the existing system without breaking current functionality, so that improvements are delivered safely and efficiently.

#### Acceptance Criteria

1. THE HTF_System SHALL modify only existing code files and components
2. THE HTF_System SHALL NOT create any new folders or directory structures
3. THE HTF_System SHALL NOT create any new .md documentation files
4. THE UI_Display SHALL enhance existing interface elements without complete redesign
5. THE Diagnostic_Engine SHALL use existing diagnostic data structures and sources
6. WHEN all changes are complete, THE build process SHALL complete successfully with "npm run build"