# Requirements Document

## Introduction

The BB-RSI EMA200 Scalper Pro is a mean reversion scalping trading agent designed for high-frequency futures trading on Bitget USDT-M Perpetual contracts. The agent combines Bollinger Bands mean reversion signals with RSI oversold/overbought conditions and EMA200 trend filtering to execute precise scalping trades on 3-minute and 5-minute timeframes with strict risk management.

## Glossary

- **BB_RSI_EMA200_Scalper_Pro**: The trading agent system that executes mean reversion scalping strategies
- **Bitget_USDT_M_Futures**: Bitget's USDT-margined perpetual futures contracts with isolated margin
- **Mean_Reversion_Signal**: Trading signal based on price touching Bollinger Bands with RSI confirmation
- **EMA200_Trend_Filter**: 200-period Exponential Moving Average used to filter trade direction
- **Bollinger_Bands**: Technical indicator with 20-period SMA and 2.0 standard deviation bands
- **RSI_Oscillator**: 14-period Relative Strength Index momentum oscillator
- **Volume_MA**: 20-period moving average of trading volume for confirmation
- **ADX_Filter**: 14-period Average Directional Index to avoid strong trending markets
- **Swing_Structure**: Price swing highs and lows used for stop loss placement
- **Isolated_Margin**: Margin mode where each position has dedicated margin allocation
- **Trailing_Stop**: Dynamic stop loss that follows profitable price movement
- **Daily_Drawdown_Limit**: Maximum allowed loss percentage per trading day
- **Equity_Drawdown_Limit**: Maximum allowed loss percentage from peak equity

## Requirements

### Requirement 1: Agent Registration and Configuration

**User Story:** As a trader, I want to register and configure the BB-RSI EMA200 Scalper Pro agent, so that I can customize its trading parameters according to my risk tolerance.

#### Acceptance Criteria

1. WHEN a user requests agent registration, THE BB_RSI_EMA200_Scalper_Pro SHALL create a new agent instance with default configuration
2. THE BB_RSI_EMA200_Scalper_Pro SHALL support agent_type "mean_reversion_scalper" in the system registry
3. THE BB_RSI_EMA200_Scalper_Pro SHALL restrict trading to BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT pairs only
4. THE BB_RSI_EMA200_Scalper_Pro SHALL set default leverage to 5x with configurable range of 3x-8x
5. THE BB_RSI_EMA200_Scalper_Pro SHALL set default risk per trade to 0.75% with hard cap at 1%
6. THE BB_RSI_EMA200_Scalper_Pro SHALL require admin approval before activation
7. THE BB_RSI_EMA200_Scalper_Pro SHALL integrate with existing AgentExecutionService scheduling system

### Requirement 2: Market Data and Technical Analysis

**User Story:** As a trading agent, I want to analyze market data using multiple technical indicators, so that I can identify high-probability mean reversion opportunities.

#### Acceptance Criteria

1. WHEN analyzing market conditions, THE BB_RSI_EMA200_Scalper_Pro SHALL fetch 3-minute candles as primary timeframe
2. WHEN confirming signals, THE BB_RSI_EMA200_Scalper_Pro SHALL fetch 5-minute candles for secondary confirmation
3. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate EMA200 on the execution timeframe for trend filtering
4. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate Bollinger Bands with 20-period and 2.0 standard deviation
5. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate RSI with 14-period for momentum analysis
6. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate Volume MA with 20-period for volume confirmation
7. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate ADX with 14-period as trend strength filter
8. WHEN ADX exceeds 30, THE BB_RSI_EMA200_Scalper_Pro SHALL skip trading to avoid strong trends

### Requirement 3: Long Entry Signal Generation

**User Story:** As a trading agent, I want to identify long entry opportunities during mean reversion setups, so that I can profit from price bounces off oversold levels.

#### Acceptance Criteria

1. WHEN price is above EMA200, THE BB_RSI_EMA200_Scalper_Pro SHALL consider long signals only
2. WHEN candle low touches or breaks lower Bollinger Band, THE BB_RSI_EMA200_Scalper_Pro SHALL mark potential reversal point
3. WHEN RSI is at or below 30, THE BB_RSI_EMA200_Scalper_Pro SHALL confirm oversold condition
4. WHEN confirmation candle closes back inside Bollinger Bands, THE BB_RSI_EMA200_Scalper_Pro SHALL validate mean reversion
5. WHEN current volume exceeds Volume MA, THE BB_RSI_EMA200_Scalper_Pro SHALL confirm signal strength
6. WHEN all long conditions are met, THE BB_RSI_EMA200_Scalper_Pro SHALL generate long entry signal

### Requirement 4: Short Entry Signal Generation

**User Story:** As a trading agent, I want to identify short entry opportunities during mean reversion setups, so that I can profit from price rejections at overbought levels.

#### Acceptance Criteria

1. WHEN price is below EMA200, THE BB_RSI_EMA200_Scalper_Pro SHALL consider short signals only
2. WHEN candle high touches or breaks upper Bollinger Band, THE BB_RSI_EMA200_Scalper_Pro SHALL mark potential reversal point
3. WHEN RSI is at or above 70, THE BB_RSI_EMA200_Scalper_Pro SHALL confirm overbought condition
4. WHEN confirmation candle closes back inside Bollinger Bands, THE BB_RSI_EMA200_Scalper_Pro SHALL validate mean reversion
5. WHEN current volume exceeds Volume MA, THE BB_RSI_EMA200_Scalper_Pro SHALL confirm signal strength
6. WHEN all short conditions are met, THE BB_RSI_EMA200_Scalper_Pro SHALL generate short entry signal

### Requirement 5: Risk Management and Position Sizing

**User Story:** As a trading agent, I want to manage risk through proper position sizing and stop loss placement, so that I can preserve capital during adverse market conditions.

#### Acceptance Criteria

1. THE BB_RSI_EMA200_Scalper_Pro SHALL calculate position size based on 0.75% account risk per trade
2. WHEN calculating stop loss for long positions, THE BB_RSI_EMA200_Scalper_Pro SHALL use minimum of swing low from last 5 candles or Lower Band minus 0.15%
3. WHEN calculating stop loss for short positions, THE BB_RSI_EMA200_Scalper_Pro SHALL use maximum of swing high from last 5 candles or Upper Band plus 0.15%
4. THE BB_RSI_EMA200_Scalper_Pro SHALL set first take profit at Middle Bollinger Band and close 60% of position
5. THE BB_RSI_EMA200_Scalper_Pro SHALL set second take profit at 0.8% profit level or opposite Bollinger Band and close remaining 40%
6. WHEN position reaches 0.4% profit, THE BB_RSI_EMA200_Scalper_Pro SHALL activate trailing stop with 0.25% distance
7. THE BB_RSI_EMA200_Scalper_Pro SHALL enforce maximum hold time of 12 candles per position

### Requirement 6: Safety Rules and Circuit Breakers

**User Story:** As a trading agent, I want comprehensive safety mechanisms to protect against excessive losses, so that I can operate safely in volatile market conditions.

#### Acceptance Criteria

1. WHEN daily drawdown reaches 5%, THE BB_RSI_EMA200_Scalper_Pro SHALL halt all trading for the remainder of the day
2. WHEN equity drawdown reaches 12%, THE BB_RSI_EMA200_Scalper_Pro SHALL halt all trading until manual reset
3. WHEN 3 consecutive losses occur, THE BB_RSI_EMA200_Scalper_Pro SHALL pause trading for 30 minutes
4. THE BB_RSI_EMA200_Scalper_Pro SHALL enforce 2-candle re-entry cooldown on the same trading pair
5. WHEN spread is too high or liquidity is low, THE BB_RSI_EMA200_Scalper_Pro SHALL skip trading
6. WHEN ADX exceeds 30 indicating strong trend, THE BB_RSI_EMA200_Scalper_Pro SHALL skip trading

### Requirement 7: Exchange Integration and Order Management

**User Story:** As a trading agent, I want to execute trades on Bitget USDT-M Futures with proper order management, so that I can achieve reliable trade execution.

#### Acceptance Criteria

1. THE BB_RSI_EMA200_Scalper_Pro SHALL integrate with existing BitgetAdapter for USDT-M futures
2. THE BB_RSI_EMA200_Scalper_Pro SHALL use isolated margin mode for all positions
3. THE BB_RSI_EMA200_Scalper_Pro SHALL place market orders for entry execution
4. THE BB_RSI_EMA200_Scalper_Pro SHALL place stop loss orders immediately after entry
5. THE BB_RSI_EMA200_Scalper_Pro SHALL place take profit orders for partial position closing
6. THE BB_RSI_EMA200_Scalper_Pro SHALL handle order failures gracefully with proper error logging
7. THE BB_RSI_EMA200_Scalper_Pro SHALL support dry-run mode for testing without real execution

### Requirement 8: System Integration and User Interface

**User Story:** As a user, I want to monitor and control the BB-RSI EMA200 Scalper Pro agent through the existing platform interface, so that I can manage my automated trading effectively.

#### Acceptance Criteria

1. THE BB_RSI_EMA200_Scalper_Pro SHALL appear in the agents sidebar with proper routing
2. THE BB_RSI_EMA200_Scalper_Pro SHALL provide real-time diagnostics through existing diagnostic system
3. THE BB_RSI_EMA200_Scalper_Pro SHALL support start/stop/pause controls through existing agent control interface
4. THE BB_RSI_EMA200_Scalper_Pro SHALL store trade history in existing trade storage system
5. THE BB_RSI_EMA200_Scalper_Pro SHALL provide performance metrics through existing performance tracking
6. THE BB_RSI_EMA200_Scalper_Pro SHALL follow existing admin approval workflow
7. THE BB_RSI_EMA200_Scalper_Pro SHALL integrate with existing notification system for alerts

### Requirement 9: Logging and Diagnostics

**User Story:** As a system administrator, I want comprehensive logging and diagnostic information, so that I can monitor agent performance and troubleshoot issues.

#### Acceptance Criteria

1. THE BB_RSI_EMA200_Scalper_Pro SHALL log all signal generation decisions with indicator values
2. THE BB_RSI_EMA200_Scalper_Pro SHALL log all risk management calculations and position sizing
3. THE BB_RSI_EMA200_Scalper_Pro SHALL log all order placement attempts and results
4. THE BB_RSI_EMA200_Scalper_Pro SHALL log all safety rule activations and circuit breaker triggers
5. THE BB_RSI_EMA200_Scalper_Pro SHALL store diagnostic data in existing format for UI display
6. THE BB_RSI_EMA200_Scalper_Pro SHALL provide detailed error messages for troubleshooting
7. THE BB_RSI_EMA200_Scalper_Pro SHALL track performance metrics for optimization analysis

### Requirement 10: Configuration and Customization

**User Story:** As a trader, I want to customize agent parameters within safe limits, so that I can adapt the strategy to my trading preferences.

#### Acceptance Criteria

1. THE BB_RSI_EMA200_Scalper_Pro SHALL allow leverage adjustment between 3x and 8x
2. THE BB_RSI_EMA200_Scalper_Pro SHALL allow risk per trade adjustment up to 1% maximum
3. THE BB_RSI_EMA200_Scalper_Pro SHALL allow trading pair selection from approved list only
4. THE BB_RSI_EMA200_Scalper_Pro SHALL allow timeframe preference between 3m and 5m primary
5. THE BB_RSI_EMA200_Scalper_Pro SHALL prevent modification of core safety parameters
6. THE BB_RSI_EMA200_Scalper_Pro SHALL validate all configuration changes before applying
7. THE BB_RSI_EMA200_Scalper_Pro SHALL persist configuration changes in existing agent storage system