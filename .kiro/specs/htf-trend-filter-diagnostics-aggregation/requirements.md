# Requirements Document

## Introduction

The HTF Trend Filter Agent diagnostics currently display multiple rows per single research cycle in the frontend UI. Each research cycle generates multiple diagnostic entries (EXECUTION_STARTED, FORCE_CREATE_DIAGNOSTIC, indicator rejections, etc.) which are all displayed as separate rows. This creates a cluttered and unprofessional user experience. The system needs to aggregate these diagnostics per cycle and show only one row per research cycle per symbol, with detailed information accessible through an expandable interface.

## Glossary

- **Research_Cycle**: A single execution cycle of the HTF Trend Filter Agent for analysis
- **Diagnostic_Entry**: Individual diagnostic records saved during agent execution
- **History_Table**: Frontend UI component displaying diagnostic information
- **Primary_Diagnostic**: The main diagnostic entry representing the final decision for a cycle
- **Details_Array**: Collection of all diagnostic entries belonging to the same research cycle
- **Cycle_Aggregation**: Process of grouping diagnostics by research cycle identifier
- **Decision_Column**: UI column showing the final trading decision with details icon

## Requirements

### Requirement 1: Single Row Per Research Cycle

**User Story:** As a user viewing the HTF diagnostics, I want to see exactly one row per research cycle per symbol, so that the history table is clean and readable.

#### Acceptance Criteria

1. WHEN displaying HTF diagnostics, THE History_Table SHALL show exactly one row per research cycle per symbol
2. WHEN multiple diagnostic entries exist for the same cycle, THE System SHALL aggregate them into a single display row
3. WHEN rendering the history table, THE System SHALL NOT display multiple rows for the same research cycle
4. WHEN a research cycle completes, THE System SHALL identify all diagnostics belonging to that cycle
5. THE History_Table SHALL maintain professional appearance with clean, non-duplicated rows

### Requirement 2: Diagnostic Cycle Identification

**User Story:** As a system developer, I want diagnostics to be properly grouped by research cycle, so that related diagnostic entries can be aggregated correctly.

#### Acceptance Criteria

1. WHEN identifying cycle relationships, THE System SHALL use cycleId as the primary grouping mechanism
2. WHEN cycleId is not available, THE System SHALL use timestamp window + symbol for grouping
3. WHEN explicit researchId exists, THE System SHALL use it as an alternative grouping mechanism
4. WHEN grouping diagnostics, THE System SHALL ensure all entries from the same research cycle are identified
5. THE System SHALL handle cases where diagnostic entries have different identification patterns

### Requirement 3: Primary Diagnostic Selection

**User Story:** As a user viewing diagnostics, I want to see the most important information for each research cycle, so that I can quickly understand the trading decisions.

#### Acceptance Criteria

1. WHEN selecting primary diagnostic, THE System SHALL prioritize EXECUTED status over SKIPPED status
2. WHEN multiple diagnostics have the same priority, THE System SHALL choose the final decision entry
3. WHEN displaying the primary row, THE System SHALL use data from the selected primary diagnostic
4. WHEN no EXECUTED diagnostic exists, THE System SHALL use the most relevant SKIPPED diagnostic
5. THE Primary_Diagnostic SHALL represent the final trading decision for that cycle

### Requirement 4: Details Aggregation and Storage

**User Story:** As a user wanting detailed information, I want to access all diagnostic details for a research cycle, so that I can understand the complete analysis process.

#### Acceptance Criteria

1. WHEN aggregating diagnostics, THE System SHALL merge all non-primary diagnostics into a details array
2. WHEN storing details, THE System SHALL preserve all diagnostic information from the cycle
3. WHEN creating the details array, THE System SHALL NOT display internal lifecycle entries as separate rows
4. WHEN organizing details, THE System SHALL include indicator rejections and analysis results
5. THE Details_Array SHALL contain complete diagnostic information for troubleshooting

### Requirement 5: Enhanced UI with Details Access

**User Story:** As a user viewing the diagnostics table, I want to access detailed information through an intuitive interface, so that I can investigate specific research cycles when needed.

#### Acceptance Criteria

1. WHEN displaying the Decision column, THE System SHALL add a small info icon (ⓘ) for cycles with details
2. WHEN the info icon is clicked, THE System SHALL show a modal or expandable section
3. WHEN displaying detailed breakdown, THE System SHALL show all indicator analysis results
4. WHEN showing details, THE System SHALL include EMA, RSI, Volume, SR rejection/confirmation status
5. WHEN credential issues exist, THE System SHALL display them in the detailed view
6. THE Details_Interface SHALL be intuitive and non-intrusive to the main table view

### Requirement 6: Internal Lifecycle Entry Filtering

**User Story:** As a user viewing diagnostics, I want to see only meaningful trading decisions, so that internal system operations don't clutter the interface.

#### Acceptance Criteria

1. WHEN filtering diagnostics, THE System SHALL NOT display EXECUTION_STARTED as standalone history rows
2. WHEN processing entries, THE System SHALL NOT display FORCE_CREATE_DIAGNOSTIC as standalone rows
3. WHEN handling credentials, THE System SHALL NOT display CREDENTIALS_DECRYPT_FAILED as standalone rows
4. WHEN showing lifecycle entries, THE System SHALL include them only in the details view
5. THE History_Table SHALL show only meaningful trading decision entries as primary rows

### Requirement 7: Data Integrity and Display Quality

**User Story:** As a user viewing diagnostics, I want to see complete and accurate information, so that I can trust the displayed trading decisions.

#### Acceptance Criteria

1. WHEN displaying pair information, THE System SHALL take Pair from the primary diagnostic
2. WHEN showing direction, THE System SHALL take Direction from the primary diagnostic
3. WHEN displaying trading data, THE Pair and Direction fields SHALL NEVER show "--" for valid cycles
4. WHEN aggregating data, THE System SHALL preserve all original diagnostic information
5. THE Display_Quality SHALL be professional and consistent across all diagnostic entries

### Requirement 8: Implementation Constraints

**User Story:** As a system maintainer, I want the diagnostics fix to use existing infrastructure, so that no new systems need to be created or maintained.

#### Acceptance Criteria

1. WHEN implementing the fix, THE System SHALL modify existing code only
2. THE System SHALL NOT create new folders or directory structures
3. THE System SHALL NOT create new APIs or backend endpoints
4. THE System SHALL NOT change the backend database schema
5. WHEN making changes, THE System SHALL use minimal commands and modifications only