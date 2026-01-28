/**
 * ════════════════════════════════════════════════════════════════════════════
 * BB-RSI EMA200 SCALPER PRO (3m/5m Futures) - COMPLETE BUILD PLAN
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * ARCHITECTURE REFERENCE:
 * - Agent Registry: Firestore `agents` collection (read-only marketplace)
 * - Agent Execution: agentExecutionService → TradingAgent class
 * - Exchange: BitgetAdapter (USDT-M Futures)
 * - Approval: Admin approval system with approvedAgents array
 * - Indicators: technicalIndicators service (reuse existing)
 * - Logging: Firestore-based trade history + diagnostics
 * - Backtest: Dry-run mode using historical candles
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * INTEGRATION POINTS
 * ════════════════════════════════════════════════════════════════════════════
 */

// ────────────────────────────────────────────────────────────────────────────
// PART 1: AGENT REGISTRATION IN FIRESTORE
// ────────────────────────────────────────────────────────────────────────────
// FILE: src/utils/firestoreSeed.ts (MODIFY seedAgents function)
// 
// ADD to agents array:
export const BB_RSI_EMA200_AGENT_DEFINITION = {
  id: 'bb_rsi_ema200_scalper_pro',
  name: 'BB-RSI EMA200 Scalper Pro (3m/5m Futures)',
  price: 599,
  description: 'High-accuracy mean reversion scalper for Bitget USDT-M Futures using Bollinger Bands, RSI, and EMA200 trend filter. Designed for liquid pairs only with strict risk management.',
  features: [
    'Mean reversion entries with EMA200 trend filter',
    '3m/5m timeframe execution',
    'RSI(14) + Bollinger Bands(20, 2.0) signal confirmation',
    'Volume MA(20) filter for high-liquidity entries',
    'ADX(14) to skip strong trends',
    'Isolated margin with 5x default leverage (3x-8x range)',
    'Supports 5 liquid pairs: BTC, ETH, SOL, BNB, XRP',
    'Risk per trade: 0.75% (hard cap 1%)',
    'Multi-level TP: Middle BB (60%) + Upper/Lower BB (40%)',
    'Trailing stop activation at +0.4% profit',
    'Max 12 candle hold time with force close',
    'Post-trade drawdown limit: 5% daily / 12% equity',
    'Admin approval required before activation',
    'Dry-run & backtest support (30+ days)',
    'Telegram alerts for every trade'
  ],
  icon: '📊',
  category: 'Scalping',
  badge: 'Premium',
  strategyType: 'BB_RSI_EMA200_SCALPER',
  exchange: 'bitget',
  marketType: 'futures',
  supportedPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  timeframes: ['3m', '5m'],
  indicators: ['EMA200', 'RSI14', 'BollingerBands20', 'VolumeMA20', 'ADX14'],
  riskPerTrade: 0.0075, // 0.75%
  maxLeverage: 8,
  minLeverage: 3,
  defaultLeverage: 5,
  createdAt: admin.firestore.Timestamp.now(),
};

// ────────────────────────────────────────────────────────────────────────────
// PART 2: TRADING AGENT CONFIG SCHEMA (Firestore)
// ────────────────────────────────────────────────────────────────────────────
// COLLECTION: users/{uid}/tradingAgents/{agentId}
// 
// DOCUMENT STRUCTURE:
export interface BBRSIEMAAgentConfig {
  // Identity
  id: string; // 'bb_rsi_ema200_scalper_pro_{userId}'
  userId: string;
  name: string; // 'BB-RSI EMA200 Scalper Pro'
  strategyType: 'BB_RSI_EMA200_SCALPER';
  
  // Exchange & Market
  exchange: 'bitget';
  marketType: 'futures'; // Isolated margin
  tradingPair: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT' | 'BNBUSDT' | 'XRPUSDT';
  
  // Execution Timeframes
  executionTimeframe: '3m' | '5m'; // Primary entry timeframe
  confirmationTimeframe: '5m'; // Secondary confirmation (if 3m is primary)
  htfConfirmationTimeframe: '15m'; // HTF bias filter
  
  // Risk Management
  leverage: number; // 3-8x, default 5
  riskPerTrade: number; // 0.0075 (0.75%), max 0.01 (1%)
  maxDailyDrawdown: number; // 0.05 (5%)
  maxEquityDrawdown: number; // 0.12 (12%)
  
  // SL/TP Configuration
  slMinDistance: number; // 0.006 (0.6%)
  slMaxDistance: number; // 0.012 (1.2%)
  slOffset: number; // 0.0015 (0.15%) below/above BB bands
  tp1Percent: number; // 0.6 (60% position at Middle BB)
  tp2Percent: number; // 0.4 (40% position at opposite BB)
  tp2TargetProfit: number; // 0.008 (0.8% or opposite BB)
  trailingStopActivation: number; // 0.004 (0.4% unrealized)
  trailingStopDistance: number; // 0.0025 (0.25%)
  
  // Position Management
  maxHoldCandles: number; // 12 candles = 36-60 minutes
  reEntryCooldown: number; // 2 candles after any trade
  consecutiveLossThreshold: number; // 3 losses
  consecutiveLossPauseMinutes: number; // 30 minute pause
  
  // Filters & Signals
  minVolumeRatioMA: number; // 1.0 (volume >= VolumeMA20)
  maxADXTrend: number; // 30 (skip if trend too strong)
  enableADXFilter: boolean; // true
  spreadThresholdBps: number; // 20 basis points for spread check
  
  // Runtime State
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED' | 'ERROR';
  enabled: boolean;
  autoTradeEnabled: boolean;
  dryRunMode: boolean;
  
  // Settings & Preferences
  telegramAlertsEnabled: boolean;
  tradeLoggingEnabled: boolean; // Always true for audit trail
  
  // Diagnostics
  lastCycleTimestamp?: number;
  lastSignalDirection?: 'LONG' | 'SHORT' | 'NO_SIGNAL';
  lastErrorMessage?: string;
  errorCount?: number;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

// ────────────────────────────────────────────────────────────────────────────
// PART 3: TRADING SIGNAL & DECISION SCHEMA
// ────────────────────────────────────────────────────────────────────────────
// INTERNAL USE: Signal evaluation object
export interface BBRSISignalContext {
  // Candle Data
  timestamp: number;
  timeframe: string;
  
  // Price & Volume
  close: number;
  high: number;
  low: number;
  volume: number;
  
  // Indicators (Calculate once per cycle)
  ema200: number;
  ema50?: number; // For reference
  rsi14: number;
  bb20Upper: number;
  bb20Lower: number;
  bb20Middle: number;
  volumeMA20: number;
  adx14: number;
  
  // HTF Context (15m bias)
  htfDirection: 'LONG_ONLY' | 'SHORT_ONLY' | 'NO_TRADE';
  htfEMA50: number;
  htfEMA200: number;
}

export interface BBRSITradingSignal {
  // Signal Validity
  valid: boolean;
  direction: 'LONG' | 'SHORT' | null;
  confidence: number; // 0-1 (based on # of conditions met)
  
  // Entry Trigger
  entryPrice: number;
  entryReason: string; // e.g., "Confirmation close inside BB + RSI bounce"
  
  // Risk Levels
  stopLoss: number;
  slDistance: number; // Actual distance used
  
  // Profit Targets
  takeProfit1: number; // Middle BB (60% close)
  takeProfit2: number; // Upper/Lower BB or +0.8% (40% close)
  tp1Percent: number; // 0.6
  tp2Percent: number; // 0.4
  
  // Meta
  conditionsMet: string[];
  conditionsFailed: string[];
  diagnosics?: {
    priceVsEMA200?: 'above' | 'below';
    bbTouchStatus?: 'touched' | 'broken' | 'not_touched';
    rsiZone?: 'oversold' | 'overbought' | 'neutral';
    volumeStatus?: 'high' | 'low';
    adxStatus?: 'strong_trend_skip' | 'acceptable';
    confirmationStatus?: 'pending' | 'confirmed' | 'rejected';
  };
}

// ────────────────────────────────────────────────────────────────────────────
// PART 4: TRADE EXECUTION & HISTORY SCHEMA
// ────────────────────────────────────────────────────────────────────────────
// COLLECTION: users/{uid}/tradingAgents/{agentId}/trades/{tradeId}
export interface BBRSITrade {
  // Trade Identity
  id: string; // UUID
  agentId: string;
  userId: string;
  
  // Trade Execution
  pair: string;
  side: 'LONG' | 'SHORT';
  entryTime: admin.firestore.Timestamp;
  entryPrice: number;
  entryQuantity: number;
  entryFee: number;
  
  // Risk Levels (Set at Entry)
  stopLoss: number;
  slDistance: number; // Actual SL distance in %
  takeProfit1: number;
  takeProfit2: number;
  
  // Exit Management
  status: 'OPEN' | 'CLOSED' | 'PARTIALLY_CLOSED' | 'SL_HIT' | 'ERROR';
  exitTime?: admin.firestore.Timestamp;
  exitPrice?: number;
  closePercentage?: number; // 0.6 for TP1, 0.4 for TP2, 1.0 for SL
  exitReason: 'TP1' | 'TP2' | 'SL_HIT' | 'FORCE_CLOSE_TIMEOUT' | 'TRAILING_STOP' | 'MANUAL_CLOSE' | 'MARGIN_CALL';
  exitFee?: number;
  
  // Performance
  realizedPnL: number;
  realizedPnLPercent: number; // -0.5% to +1.8%
  unrealizedPnL?: number; // If still open
  maxFavorableExcursion?: number; // Peak profit during hold
  maxAdverseExcursion?: number; // Worst loss during hold
  
  // Position Management
  holdCandles: number;
  holdMinutes: number;
  
  // Indicator Snapshot (At Entry)
  indicatorSnapshot: {
    rsi14: number;
    ema200: number;
    ema50?: number;
    bbUpper: number;
    bbLower: number;
    bbMiddle: number;
    volumeMA20: number;
    adx14: number;
    volume: number;
  };
  
  // Exchange Data
  exchangeOrderId?: string;
  filledQuantity: number;
  
  // Logging
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  notes?: string;
  
  // Cycle Reference
  cycleId?: string; // Execution cycle ID
}

// ────────────────────────────────────────────────────────────────────────────
// PART 5: EXECUTION CYCLE DIAGNOSTICS
// ────────────────────────────────────────────────────────────────────────────
// COLLECTION: users/{uid}/agentDiagnostics/{agentId}/entries/{cycleId}
export interface BBRSIExecutionDiagnostic {
  // Cycle Identity
  cycleId: string;
  agentId: string;
  userId: string;
  pair: string;
  
  // Timing
  cycleStartTime: admin.firestore.Timestamp;
  cycleEndTime?: admin.firestore.Timestamp;
  
  // Candle Check
  candleCheck: {
    status: 'VALID' | 'INVALID' | 'ERROR';
    candleCount3m?: number;
    candleCount5m?: number;
    latestCandleTime?: number;
    reason?: string;
  };
  
  // Indicator Calculation
  indicators: {
    ema200: number;
    ema50?: number;
    rsi14: number;
    bbUpper: number;
    bbLower: number;
    bbMiddle: number;
    volumeMA20: number;
    adx14: number;
    calculationTime?: number; // ms
  };
  
  // Signal Evaluation
  signalEvaluation: {
    htfBias: 'LONG_ONLY' | 'SHORT_ONLY' | 'NO_TRADE';
    longSetupValid: boolean;
    shortSetupValid: boolean;
    selectedDirection: 'LONG' | 'SHORT' | 'NO_SIGNAL';
    conditionsMet: string[];
    conditionsFailed: string[];
  };
  
  // Risk Analysis
  riskAnalysis: {
    slDistance: number;
    riskAmount: number;
    positionSize: number;
    hasDrawdownExceeded: boolean;
    dailyPnL: number;
    consecutiveLosses: number;
    canExecute: boolean;
    reason?: string;
  };
  
  // Decision & Action
  decision: {
    action: 'ENTRY' | 'SKIP' | 'PAUSE' | 'ERROR';
    reason: string;
    tradeId?: string; // If ENTRY
    timestamp: admin.firestore.Timestamp;
  };
  
  // Performance Metrics
  performance: {
    cycleExecutionTime: number; // ms
    exchangeLatency?: number; // ms
    indicatorCalcTime?: number; // ms
  };
  
  // Error Tracking
  errors?: {
    errorMessage: string;
    errorType: string;
    timestamp: number;
    recoverable: boolean;
  }[];
  
  createdAt: admin.firestore.Timestamp;
}

// ────────────────────────────────────────────────────────────────────────────
// PART 6: BACKTEST & DRY-RUN RESULT SCHEMA
// ────────────────────────────────────────────────────────────────────────────
// COLLECTION: users/{uid}/backtests/{agentId}_{timestamp}
export interface BBRSIBacktestResult {
  // Test Identity
  id: string;
  agentId: string;
  userId: string;
  pair: string;
  
  // Test Parameters
  startDate: admin.firestore.Timestamp;
  endDate: admin.firestore.Timestamp;
  timeframe: '3m' | '5m';
  historicalDays: number; // 30, 60, 90
  dryRunMode: boolean;
  
  // Configuration Used
  leverage: number;
  riskPerTrade: number;
  startingBalance: number;
  
  // Results Summary
  totalTrades: number;
  winnningTrades: number;
  losingTrades: number;
  winRate: number; // 0-1
  profitFactor: number; // total_wins / total_losses
  
  // P&L Analysis
  totalGrossProfit: number;
  totalGrossLoss: number;
  netPnL: number;
  netPnLPercent: number;
  avgWinAmount: number;
  avgLossAmount: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number; // (Win% * Avg Win) - (Loss% * Avg Loss)
  
  // Risk Analysis
  maxDrawdown: number; // Lowest balance vs peak balance
  maxDrawdownPercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  
  // Trade Duration
  avgHoldMinutes: number;
  avgHoldCandles: number;
  minHoldMinutes: number;
  maxHoldMinutes: number;
  
  // Entry/Exit Quality
  avgRSIAtEntry: number;
  avgStopLossDistancePercent: number;
  avgProfitTargetPercent: number;
  
  // Detailed Trade Log
  trades: {
    tradeNumber: number;
    pair: string;
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    holdMinutes: number;
    exitReason: string;
  }[];
  
  // Metadata
  createdAt: admin.firestore.Timestamp;
  completedAt?: admin.firestore.Timestamp;
  notes?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// PART 7: N8N WORKFLOW NODES
// ════════════════════════════════════════════════════════════════════════════
/*
N8N WORKFLOW: "BB-RSI EMA200 Scalper - Main Loop"
Execution: Every 3 minutes (or 5 minutes based on config)

NODES REQUIRED:

1. SCHEDULE TRIGGER
   Type: Schedule node
   Cron: "*/3 * * * *" (every 3 minutes) OR "*/5 * * * *" (every 5 minutes)
   Purpose: Tick the scalper execution cycle

2. GET ACTIVE AGENTS (Webhook → Backend API)
   Type: HTTP Request
   Method: GET
   URL: http://backend/api/agents/bb-rsi-ema200/active-configs
   Query Params: { agentType: 'BB_RSI_EMA200_SCALPER', status: 'ACTIVE' }
   Headers: { Authorization: Bearer {backend_token} }
   Purpose: Fetch all active agent configs for this strategy

3. FOR EACH ACTIVE AGENT
   Type: Loop Over Items
   Items: Response from Node 2
   Purpose: Execute each agent's trading logic separately

4. GET CANDLE DATA (3m OR 5m)
   Type: HTTP Request
   Method: POST
   URL: http://backend/api/market/candles
   Body: { symbol: $json.pair, timeframe: $json.executionTimeframe, limit: 250 }
   Purpose: Get 250 candles for indicator calculation

5. CALCULATE INDICATORS
   Type: Function Node (JavaScript)
   Purpose: Call technicalIndicators.ts methods:
     - calculateEMA(closes, 200) → ema200
     - calculateRSI(closes, 14) → rsi14
     - calculateBollingerBands(closes, 20, 2) → bb
     - calculateVolumeMA(volumes, 20) → volumeMA20
     - calculateADX(candles, 14) → adx14
   Returns: { ema200, rsi14, bbUpper, bbLower, bbMiddle, volumeMA20, adx14 }

6. GET HTF CANDLES (15m)
   Type: HTTP Request
   URL: http://backend/api/market/candles
   Body: { symbol: $json.pair, timeframe: '15m', limit: 250 }
   Purpose: Get 15m candles for HTF trend bias

7. ANALYZE HTF TREND
   Type: Function Node
   Purpose: Determine: LONG_ONLY, SHORT_ONLY, or NO_TRADE using EMA 50/200 crossover
   Returns: { htfDirection: string, ema50: number, ema200: number }

8. EVALUATE LONG SETUP
   Type: Function Node
   Purpose: Check ALL long conditions:
     - close > ema200
     - low touched/broke lower BB
     - rsi14 <= 30
     - Volume >= VolumeMA20
     - ADX <= 30 (skip if trend strong)
     - HTF bias allows LONG
     - Not in re-entry cooldown
   Returns: { isValid: boolean, entryPrice: number, sl: number, tp1: number, tp2: number, reason: string }

9. EVALUATE SHORT SETUP
   Type: Function Node
   Similar to Node 8 but for SHORT conditions

10. SELECT SIGNAL (IF/CONDITIONAL LOGIC)
    Type: Conditional Node
    If: (Node 8 valid AND htfDirection=LONG_ONLY) → use LONG signal
    Elif: (Node 9 valid AND htfDirection=SHORT_ONLY) → use SHORT signal
    Else: → NO_SIGNAL
    Returns: selected signal object or NO_SIGNAL

11. CHECK RISK LIMITS
    Type: Function Node
    Purpose: Validate against:
      - Daily drawdown limit (5%)
      - Max equity drawdown (12%)
      - Consecutive loss threshold (3) → trigger pause
      - Exchange API health
    Returns: { canExecute: boolean, reason?: string }

12. PLACE ENTRY ORDER (IF SIGNAL + RISK OK)
    Type: HTTP Request (If Node 10 has signal AND Node 11 allows)
    Method: POST
    URL: http://backend/api/orders/place
    Body: {
      pair: $json.pair,
      side: $json.signal.direction,
      type: 'MARKET',
      quantity: $json.positionSize,
      leverage: $json.leverage,
      stopLoss: $json.signal.stopLoss,
      takeProfit1: $json.signal.takeProfit1,
      takeProfit2: $json.signal.takeProfit2
    }
    Purpose: Execute entry order via Bitget adapter

13. LOG EXECUTION CYCLE
    Type: HTTP Request
    Method: POST
    URL: http://backend/api/diagnostics/log-cycle
    Body: {
      cycleId: $json.cycleId,
      agentId: $json.agentId,
      pair: $json.pair,
      decision: Node 10 result,
      indicators: Node 5 result,
      htfBias: Node 7 result,
      tradeId: Node 12 result (if order placed),
      executionTime: timestamp,
      errors?: any_error_messages
    }
    Purpose: Store diagnostics for audit trail

14. SEND TELEGRAM ALERT (IF TRADE EXECUTED)
    Type: Telegram Send Message
    Condition: If Node 12 successful
    Message: "[BB-RSI Scalper] ENTRY: {Side} {Pair} @ {EntryPrice}\nSL: {SL}\nTP1: {TP1}\nTP2: {TP2}"

15. ERROR HANDLER
    Type: Error Handling node
    Catches: Any errors from Nodes 4-14
    Purpose: Log error, disable agent if repeated (3+ errors), send alert

WORKFLOW LOOP:
Repeat every 3 minutes for each active pair/agent combination.
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 8: BACKEND API ENDPOINTS (REQUIRED)
// ════════────────────────────────────────────────────────────────────────────
/*
ENDPOINTS TO ADD/MODIFY IN routes/agents.ts:

1. GET /api/agents/bb-rsi-ema200/active-configs
   Purpose: Return all active BB-RSI EMA200 agent configs for user's account
   Auth: fastify.authenticate + agentAccessMiddleware
   Response: { agents: BBRSIEMAAgentConfig[] }

2. GET /api/agents/bb-rsi-ema200/dashboard/:agentId
   Purpose: Get agent status, recent trades, diagnostics, PnL
   Response: {
     config: BBRSIEMAAgentConfig,
     status: { enabled, running, lastCycleTime, lastTrade },
     stats: { totalTrades, winRate, totalPnL, maxDrawdown },
     recentTrades: BBRSITrade[],
     diagnostics: BBRSIExecutionDiagnostic[]
   }

3. POST /api/agents/bb-rsi-ema200/start/:agentId
   Purpose: Activate agent (requires admin approval via approvedAgents)
   Body: { pair: string, leverage: number, riskPerTrade: number }
   Response: { success: boolean, agentId: string }

4. POST /api/agents/bb-rsi-ema200/stop/:agentId
   Purpose: Deactivate agent
   Response: { success: boolean }

5. PUT /api/agents/bb-rsi-ema200/settings/:agentId
   Purpose: Update agent config
   Body: Partial BBRSIEMAAgentConfig (leverage, riskPerTrade, timeframe, etc.)
   Response: { success: boolean, updatedConfig: BBRSIEMAAgentConfig }

6. GET /api/agents/bb-rsi-ema200/trades/:agentId
   Purpose: Get recent trades with pagination
   Query: { limit: 50, offset: 0 }
   Response: { trades: BBRSITrade[], totalCount: number }

7. POST /api/agents/bb-rsi-ema200/backtest
   Purpose: Run backtest simulation on historical data
   Body: {
     pair: string,
     timeframe: '3m' | '5m',
     historicalDays: 30 | 60 | 90,
     leverage: number,
     riskPerTrade: number
   }
   Response: { backtestId: string, status: 'RUNNING', completedAt?: timestamp }

8. GET /api/agents/bb-rsi-ema200/backtest/:backtestId
   Purpose: Get backtest results
   Response: BBRSIBacktestResult

9. POST /api/market/candles
   Purpose: Fetch candles from exchange
   Body: { symbol: string, timeframe: string, limit: number }
   Response: { candles: CandleData[] }

10. POST /api/orders/place
    Purpose: Place entry order with SL/TP
    Body: {
      pair: string,
      side: 'LONG' | 'SHORT',
      type: 'MARKET',
      quantity: number,
      leverage: number,
      stopLoss: number,
      takeProfit1: number,
      takeProfit2: number,
      dryRun?: boolean
    }
    Response: { orderId: string, status: string, ... }

11. POST /api/diagnostics/log-cycle
    Purpose: Store execution cycle diagnostics
    Body: BBRSIExecutionDiagnostic
    Response: { cycleId: string, logged: true }
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 9: CORE INDICATOR CALCULATIONS
// ════════════════════════════════════════════════════════════════════════════
/*
REUSE EXISTING: src/services/technicalIndicators.ts

Methods to call:
- TechnicalIndicators.calculateEMA(closes: number[], 200): number
- TechnicalIndicators.calculateRSI(closes: number[], 14): number
- TechnicalIndicators.calculateBollingerBands(closes: number[], 20, 2): { upper, middle, lower }
- TechnicalIndicators.calculateATR(candles: CandleData[], 14): number

ADDITIONAL CALCULATIONS NEEDED (create utility):

volumeMA(volumes: number[], period: number): number {
  return volumes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
}

adx(candles: CandleData[], period: number): number {
  // Average Directional Index - measure trend strength
  // Returns 0-100 (>30 = strong trend, <20 = weak trend)
  // Implementation: Calculate +DI, -DI, DX, then smooth ADX
}

swingHigh(candles: CandleData[], lookback: number = 5): number {
  return Math.max(...candles.slice(0, lookback).map(c => c.high));
}

swingLow(candles: CandleData[], lookback: number = 5): number {
  return Math.min(...candles.slice(0, lookback).map(c => c.low));
}
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 10: ENTRY SIGNAL LOGIC (PSEUDO-CODE)
// ════════════════════════════════════════════════════════════════════════════
/*
FUNCTION: evaluateLongEntry(context: BBRSISignalContext, config: BBRSIEMAAgentConfig): BBRSITradingSignal

Input: Latest candles (3m), indicators, HTF direction
Output: Trading signal with entry price, SL, TP1, TP2

ALGORITHM:

1. HTF Filter Check
   IF htfDirection !== 'LONG_ONLY':
     RETURN { valid: false, direction: null, reason: "HTF bias is SHORT_ONLY or NO_TRADE" }

2. Price vs EMA200 Check
   IF close <= ema200:
     RETURN { valid: false, direction: null, reason: "Price not above EMA200" }

3. Bollinger Band Touch Check
   IF low NOT touch/break lower BB (low >= bbLower - 0.0005):
     RETURN { valid: false, direction: null, reason: "Low did not touch lower BB" }

4. RSI Check
   IF rsi14 > 30:
     RETURN { valid: false, direction: null, reason: "RSI not in oversold zone (<= 30)" }

5. Volume Check
   IF volume <= volumeMA20:
     RETURN { valid: false, direction: null, reason: "Volume insufficient" }

6. ADX Trend Strength Check
   IF adx14 > 30:
     RETURN { valid: false, direction: null, reason: "Trend too strong (ADX > 30), skip mean reversion" }

7. Confirmation Candle Check
   IF NEXT_CANDLE.close <= bbLower OR NEXT_CANDLE.close >= bbUpper:
     RETURN { valid: false, direction: null, reason: "Confirmation candle not inside BB" }

8. Calculate Stop Loss
   swingLow5 = min(low of last 5 candles)
   slCandidate = min(swingLow5, bbLower - 0.0015)
   slDistance = (close - slCandidate) / close
   
   IF slDistance < 0.006:
     slCandidate = close - (close * 0.006)
   ELIF slDistance > 0.012:
     RETURN { valid: false, reason: "SL distance > 1.2% max" }
   
9. Calculate Position Size
   riskAmount = accountBalance * config.riskPerTrade
   positionSize = riskAmount / (close - slCandidate)
   
   // Verify leverage doesn't exceed max
   requiredMargin = (positionSize * close) / config.leverage
   IF requiredMargin > accountBalance * 0.5:
     // Reduce position size or skip
     positionSize = (accountBalance * 0.5 * config.leverage) / close

10. Calculate Take Profits
    tp1Price = bbMiddle
    tp2Price = bbUpper OR close + (close * 0.008) [whichever is higher]

11. Return Valid Signal
    RETURN {
      valid: true,
      direction: 'LONG',
      entryPrice: close,
      stopLoss: slCandidate,
      takeProfit1: tp1Price,
      takeProfit2: tp2Price,
      conditionsMet: ["HTF_LONG_OK", "PRICE_ABOVE_EMA200", "BB_TOUCH", "RSI_OVERSOLD", "VOLUME_OK", "ADX_OK"],
      conditionsFailed: [],
      confidence: 1.0
    }

SHORT ENTRY: Mirror logic with inverted conditions
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 11: TRADE EXECUTION & MANAGEMENT FLOW
// ════════════════════════════────────────────────────────────────────────────
/*
FUNCTION: executeTrade(signal: BBRSITradingSignal, config: BBRSIEMAAgentConfig): { orderId: string, tradeId: string }

1. Validate Signal
   - Check signal.valid === true
   - Check signal.direction !== null
   - Verify config.autoTradeEnabled === true
   - Verify agent status === 'ACTIVE'

2. Risk Pre-Check
   - Get current account balance & available balance
   - Calculate position size from signal
   - Verify leverage within range [config.minLeverage, config.maxLeverage]
   - Check daily drawdown not exceeded (5% limit)
   - Check equity drawdown not exceeded (12% limit)
   - Check consecutive loss threshold not exceeded (3 losses → 30 min pause)

3. Place Entry Order (Bitget Futures)
   Via BitgetAdapter:
   - placeOrder({
       symbol: config.pair,
       side: signal.direction,
       type: 'MARKET',
       quantity: positionSize,
       leverage: config.leverage,
       positionMode: 'isolated',
       orderData: {
         stopLoss: signal.stopLoss,
         takeProfit1: signal.takeProfit1,
         takeProfit2: signal.takeProfit2
       }
     })

4. Order Response Handling
   IF order fails:
     - Log error with reason
     - Increment error count
     - IF error_count >= 3: disable agent
     - RETURN { success: false, error: message }

   IF order succeeds:
     - Get exchangeOrderId from response

5. Create Trade Document in Firestore
   BBRSITrade {
     id: UUID,
     agentId: config.id,
     userId: config.userId,
     pair: config.pair,
     side: signal.direction,
     entryTime: now(),
     entryPrice: signal.entryPrice,
     entryQuantity: positionSize,
     stopLoss: signal.stopLoss,
     takeProfit1: signal.takeProfit1,
     takeProfit2: signal.takeProfit2,
     status: 'OPEN',
     indicatorSnapshot: { rsi14, ema200, bbUpper, bbLower, ... },
     exchangeOrderId: exchangeOrderId,
     createdAt: now()
   }

6. Store Trade & Return IDs
   RETURN { orderId: exchangeOrderId, tradeId: tradeFirestoreId }

MANAGEMENT LOOP (Every 1-5 minutes):

7. Monitor Open Trades
   FOR each trade WHERE status === 'OPEN':

     A. Fetch current position price
     B. Calculate unrealizedPnL
     C. Calculate MFE (max favorable) & MAE (max adverse)

     D. Check TP1 Hit (Middle Bollinger Band)
        IF price reached TP1:
          - Close 60% position at market
          - Move SL to breakeven
          - Update trade: status = 'PARTIALLY_CLOSED', closePercentage = 0.6

     E. Check TP2 Hit (Upper/Lower BB or +0.8%)
        IF price reached TP2:
          - Close remaining 40% position
          - Update trade: status = 'CLOSED', exitPrice, exitTime, exitReason = 'TP2'
          - Calculate realizedPnL

     F. Check SL Hit
        IF price touched SL:
          - Close entire position at market
          - Update trade: status = 'CLOSED', exitPrice, exitTime, exitReason = 'SL_HIT'
          - Increment consecutive loss counter

     G. Trailing Stop Check (IF unrealized >= +0.4%)
        IF activated && price moved against trailing distance:
          - Close remaining position
          - Update trade: exitReason = 'TRAILING_STOP'

     H. Max Hold Time Check (12 candles = 36-60 minutes)
        IF holdTime >= maxHoldTime:
          - Force close at market
          - Update trade: exitReason = 'FORCE_CLOSE_TIMEOUT'

8. Update Trade Counters
   - Update consecutive loss count
   - IF 3 consecutive losses: trigger 30-minute pause
   - Update daily PnL & trade count

9. Update Agent Runtime State
   - Update lastCycleTimestamp
   - Update lastSignalDirection
   - If any error: set status = 'ERROR', log error message
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 12: SAFETY RULES & CIRCUIT BREAKERS
// ════════════════════════════════════════════════════════════════────────────
/*
1. DAILY DRAWDOWN LIMIT (5%)
   Logic:
     - Track startingBalance at 00:00 UTC each day
     - Calculate current equity
     - IF (startingBalance - currentEquity) / startingBalance > 0.05:
       DISABLE agent for rest of day
       Set status = 'PAUSED'
       Log: "Daily drawdown exceeded 5%, agent paused until next trading day"

2. MAX EQUITY DRAWDOWN (12%)
   Logic:
     - Track peak equity since agent activation
     - Calculate drawdown = (peakEquity - currentEquity) / peakEquity
     - IF drawdown > 0.12:
       DISABLE agent permanently
       Set status = 'ERROR'
       Alert: "Max equity drawdown exceeded 12%, agent disabled"

3. CONSECUTIVE LOSS THRESHOLD (3 losses)
   Logic:
     - Track consecutive closed trades with negative PnL
     - IF 3 consecutive losses:
       Set status = 'PAUSED'
       Pause duration: 30 minutes
       After 30 min: Auto-resume if enabled
       Log: "3 consecutive losses, pausing 30 minutes"

4. RE-ENTRY COOLDOWN (2 candles after trade)
   Logic:
     - After any trade close (TP, SL, timeout):
       Set cooldownEndTime = now() + (2 * candle_interval)
       Skip entry signals until cooldownEndTime
       Reason: Avoid over-trading same pair

5. EXCHANGE API HEALTH CHECK
   Logic:
     - Before each cycle: test Bitget API connectivity
     - IF test fails OR response latency > 5s:
       Skip this cycle
       Log warning
       IF fails 3 consecutive cycles:
         Set status = 'ERROR', disable agent

6. SPREAD CHECK (For liquid entry)
   Logic:
     - Fetch bid-ask spread for pair
     - Calculate spread BPS = (ask - bid) / mid * 10000
     - IF spreadBps > 20:
       Skip trade, reason "Spread too wide"

7. ORDER EXECUTION GUARD
   Logic:
     - NEVER place same order twice (prevent double fills)
     - Use idempotency keys: {tradeId}_{timestamp}
     - IF order already placed with same key in last 5 sec: skip
     - Log: "Order skipped due to duplicate detection"

8. MARGIN CALL PROTECTION
   Logic:
     - Monitor margin ratio
     - IF margin ratio < 1.5:
       Force close 50% position to reduce leverage
       Log: "Margin ratio critical, reduced position size"
     - IF margin ratio < 1.0:
       Force close all positions
       Set status = 'ERROR'
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 13: LOGGING & AUDIT TRAIL
// ════════════════════════════════════════════════════════════════════════════
/*
EVERY TRADE MUST LOG:

1. Trade Entry Log
   {
     timestamp: ISO8601,
     event: 'TRADE_ENTRY',
     pair: 'BTCUSDT',
     side: 'LONG',
     entryPrice: 67234.50,
     quantity: 0.045,
     leverage: 5,
     stopLoss: 67050.00,
     slDistance: 0.0027,
     takeProfit1: 67450.00,
     takeProfit2: 67600.00,
     reason: 'RSI oversold + BB touch + Volume confirmed',
     rsi: 28,
     ema200: 66900,
     bbUpper: 67500,
     bbLower: 67100,
     volumeMA20: 4500,
     adx: 18,
     htfBias: 'LONG_ONLY',
     executionLatency: 145, // ms
     exchangeOrderId: '12345678'
   }

2. Trade Exit Log
   {
     timestamp: ISO8601,
     event: 'TRADE_EXIT',
     tradeId: 'uuid-xxx',
     pair: 'BTCUSDT',
     exitReason: 'TP1' | 'TP2' | 'SL_HIT' | 'TRAILING_STOP' | 'FORCE_CLOSE_TIMEOUT',
     exitPrice: 67450.00,
     quantity: 0.027 (60% of entry),
     realizedPnL: 1250.50,
     realizedPnLPercent: 0.0186,
     holdMinutes: 34,
     mfe: 0.0032,
     mae: -0.0008,
     fee: 12.50
   }

3. Execution Cycle Log (Every 3-5 minutes)
   {
     timestamp: ISO8601,
     cycleId: 'cycle-xxx',
     pair: 'BTCUSDT',
     decision: 'ENTRY' | 'SKIP' | 'ERROR',
     reason: string,
     indicators: { rsi, ema200, bb, volume, adx },
     htfBias: 'LONG_ONLY' | 'SHORT_ONLY' | 'NO_TRADE',
     tradePlaced: boolean,
     tradeId?: string,
     executionTime: number // ms
   }

4. Risk Event Log (Safety violations)
   {
     timestamp: ISO8601,
     event: 'RISK_VIOLATION',
     type: 'DAILY_DRAWDOWN' | 'EQUITY_DRAWDOWN' | 'CONSECUTIVE_LOSSES' | 'MARGIN_CALL',
     message: string,
     currentDrawdown: 0.056,
     limit: 0.05,
     action: 'PAUSE' | 'DISABLE'
   }

STORAGE:
- Primary: Firestore users/{uid}/tradingAgents/{agentId}/trades/{tradeId}
- Audit: Firestore users/{uid}/agentDiagnostics/{agentId}/entries/{cycleId}
- Real-time: Console logs (structured JSON)
- Long-term: Cloud Logging for compliance
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 14: DRY-RUN & BACKTEST ENGINE
// ════════════════════════════════════════════════════════════════════════════
/*
MODE: dryRun: boolean in BBRSIEMAAgentConfig

IF dryRunMode === true:
  - Fetch historical candles (30, 60, 90 days)
  - Replay all candles sequentially
  - Evaluate signals on each candle (NO real orders placed)
  - Simulate entry/exit prices using NEXT candle open
  - Calculate PnL, drawdown, win rate
  - Return summary report (BBRSIBacktestResult)

BACKTEST ALGORITHM:

1. Fetch Historical Candles
   GET /api/market/candles?symbol=BTCUSDT&timeframe=3m&limit=14400 (30 days)

2. Initialize Tracking
   balance = startingBalance
   trades = []
   maxBalance = balance
   maxDrawdown = 0
   consecutiveLosses = 0

3. Iterate Through Candles
   FOR each candle IN candles (chronological order):
     
     A. Accumulate candles into a window (need 250 for indicators)
     B. IF window size < 250: continue (warm-up period)
     
     C. Calculate indicators on window
     D. Evaluate long/short signals
     E. IF signal valid:
          - Use NEXT candle.open as entry price
          - Calculate SL & TP based on current bar
          - Simulate trade execution
        
     F. For open trades: check if TP/SL hit
        - Use candle high/low to determine if levels hit
        - Calculate exit price (first hit wins)
        - Update PnL: (exitPrice - entryPrice) * quantity - fees
        - Update balance = balance + pnl
        
     G. Track metrics:
        - IF pnl > 0: update max balance if needed
        - IF pnl < 0: increment consecutive losses
        - Calculate drawdown = (maxBalance - balance) / maxBalance

4. Generate Results
   totalTrades = trades.length
   winningTrades = trades.filter(t => t.pnl > 0).length
   winRate = winningTrades / totalTrades
   profitFactor = sum(wins) / abs(sum(losses))
   
   netPnL = balance - startingBalance
   netPnLPercent = netPnL / startingBalance
   
   avgHoldMinutes = avg(trades.map(t => t.holdMinutes))
   avgRSIAtEntry = avg(trades.map(t => t.indicatorSnapshot.rsi))
   
   expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss)

5. Store Results in Firestore
   users/{uid}/backtests/{agentId}_{timestamp}

6. Return to Frontend
   Display: Win rate, profit factor, max drawdown, expectancy
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 15: ADMIN APPROVAL WORKFLOW
// ════════════════════════════════════════────────────────────────────────────
/*
REQUIRED PERMISSIONS:
- Agent code review ✓
- Risk validation ✓
- Exchange API testing ✓
- User identity verification ✓

APPROVAL STEPS:

1. User Requests "BB-RSI EMA200 Scalper Pro"
   POST /api/agents/submit-unlock-request
   Body: { agentType: 'BB_RSI_EMA200_SCALPER' }
   
   Stored in Firestore:
   users/{uid}/agentApprovals/requests/{requestId}
   {
     agentType: 'BB_RSI_EMA200_SCALPER',
     status: 'PENDING_APPROVAL',
     requestedAt: timestamp,
     userId: uid,
     userEmail: user.email,
     userKYC: verified | not_verified
   }

2. Admin Reviews Request
   GET /api/admin/agent-requests?agentType=BB_RSI_EMA200_SCALPER
   
   Review criteria:
   - User has completed KYC
   - User has minimum balance ($100+)
   - User agrees to terms & risk disclosure
   - No prior violations or abuse

3. Admin Approves / Rejects
   POST /api/admin/agents/approve
   Body: {
     agentType: 'BB_RSI_EMA200_SCALPER',
     userId: uid,
     approved: true | false,
     rejectionReason?: string
   }
   
   If approved:
     - Add 'BB_RSI_EMA200_SCALPER' to users/{uid}/approvedAgents array
     - Set agent enabled = true
     - Create initial config document

4. User Activates Agent
   POST /api/agents/bb-rsi-ema200/start/{agentId}
   Body: {
     pair: 'BTCUSDT',
     leverage: 5,
     riskPerTrade: 0.0075,
     timeframe: '3m',
     autoTradeEnabled: true
   }
   
   Validation:
   - Check 'BB_RSI_EMA200_SCALPER' in approvedAgents
   - Verify exchange credentials present
   - Validate configuration parameters
   
   If valid:
     - Create trading agent config document
     - Set status = 'ACTIVE'
     - Start execution loop

5. Agent Execution Begins
   N8N picks up active agents every 3 minutes
   Starts trading cycle
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 16: WIRING INTO EXISTING SYSTEM
// ════════════════════════════════════════════════════════────────────────────
/*
1. AGENT REGISTRY (firestoreSeed.ts)
   ✓ Add BB_RSI_EMA200_AGENT_DEFINITION to agents collection

2. EXECUTION SERVICE (agentExecutionService.ts)
   Modify: loadActiveAgents()
     - Already loops through getActiveTradingAgents()
     - Will automatically pick up BB-RSI agents once registered

3. APPROVAL SERVICE (agentApprovalService.ts)
   Modify: Extend to support 'BB_RSI_EMA200_SCALPER' agent type
     - Already has userHasAgentAccess(uid, agentId)
     - No changes needed if we use agentId as key

4. TRADING AGENT CLASS (tradingAgent.ts)
   Check: Does it support arbitrary strategyType values?
   If yes: No changes needed
   If no: Extend to accept strategyType = 'BB_RSI_EMA200_SCALPER'

5. BITGET ADAPTER (bitgetAdapter.ts)
   Reuse: Already supports:
     - placeOrder() with SL/TP
     - getCandles()
     - getFuturesKlines()
   ✓ No changes needed

6. TECHNICAL INDICATORS (technicalIndicators.ts)
   Reuse: Already has:
     - calculateEMA()
     - calculateRSI()
     - calculateBollingerBands()
     - calculateATR()
   Add: volumeMA(), adx() utility functions

7. FIRESTORE SCHEMA
   New collections:
     - users/{uid}/tradingAgents/{agentId} (config + status)
     - users/{uid}/tradingAgents/{agentId}/trades/{tradeId} (trade history)
     - users/{uid}/agentDiagnostics/{agentId}/entries/{cycleId} (execution logs)
     - users/{uid}/backtests/{backtestId} (backtest results)

8. API ROUTES (routes/agents.ts)
   Add routes:
     - GET /api/agents/bb-rsi-ema200/active-configs
     - GET /api/agents/bb-rsi-ema200/dashboard/:agentId
     - POST /api/agents/bb-rsi-ema200/start/:agentId
     - POST /api/agents/bb-rsi-ema200/stop/:agentId
     - PUT /api/agents/bb-rsi-ema200/settings/:agentId
     - GET /api/agents/bb-rsi-ema200/trades/:agentId
     - POST /api/agents/bb-rsi-ema200/backtest
     - GET /api/agents/bb-rsi-ema200/backtest/:backtestId
   
   Or use generic routes:
     - GET /api/agents/:agentSlug/active-configs
     - POST /api/agents/:agentSlug/start

9. N8N WORKFLOW
   Create new workflow: "BB-RSI EMA200 Scalper Main Loop"
   Trigger: Every 3 minutes
   Nodes: As per PART 7

10. FRONTEND SIDEBAR
    Auto-generated from agents collection:
      - NOT hardcoded
      - Sidebar reads from user's approvedAgents
      - Displays only approved agents
*/

// ════════════════════════════════════════════════════════════════════════════
// PART 17: JSON SCHEMAS FOR DATA VALIDATION
// ════════════════════════════════════════════════────────────────────────────

export const BBRSIConfigSchema = {
  type: 'object',
  required: [
    'userId', 'strategyType', 'exchange', 'tradingPair',
    'executionTimeframe', 'leverage', 'riskPerTrade',
    'enabled', 'autoTradeEnabled'
  ],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string', description: 'Firebase user ID' },
    strategyType: { type: 'string', enum: ['BB_RSI_EMA200_SCALPER'] },
    exchange: { type: 'string', enum: ['bitget'] },
    marketType: { type: 'string', enum: ['futures'] },
    tradingPair: { type: 'string', enum: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] },
    executionTimeframe: { type: 'string', enum: ['3m', '5m'] },
    confirmationTimeframe: { type: 'string', enum: ['5m'] },
    htfConfirmationTimeframe: { type: 'string', enum: ['15m'] },
    leverage: { type: 'number', minimum: 3, maximum: 8, default: 5 },
    riskPerTrade: { type: 'number', minimum: 0.005, maximum: 0.01, default: 0.0075 },
    maxDailyDrawdown: { type: 'number', minimum: 0.01, maximum: 0.20, default: 0.05 },
    maxEquityDrawdown: { type: 'number', minimum: 0.05, maximum: 0.50, default: 0.12 },
    enabled: { type: 'boolean', default: true },
    autoTradeEnabled: { type: 'boolean', default: true },
    dryRunMode: { type: 'boolean', default: false },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PAUSED', 'ERROR'] }
  }
};

export const BBRSITradeSchema = {
  type: 'object',
  required: ['pair', 'side', 'entryPrice', 'entryQuantity', 'stopLoss', 'takeProfit1', 'takeProfit2'],
  properties: {
    id: { type: 'string' },
    pair: { type: 'string' },
    side: { type: 'string', enum: ['LONG', 'SHORT'] },
    entryTime: { type: 'string', format: 'date-time' },
    entryPrice: { type: 'number', minimum: 0 },
    entryQuantity: { type: 'number', minimum: 0.001 },
    stopLoss: { type: 'number', minimum: 0 },
    takeProfit1: { type: 'number', minimum: 0 },
    takeProfit2: { type: 'number', minimum: 0 },
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'PARTIALLY_CLOSED', 'SL_HIT', 'ERROR'] },
    exitReason: { type: 'string', enum: ['TP1', 'TP2', 'SL_HIT', 'FORCE_CLOSE_TIMEOUT', 'TRAILING_STOP', 'MANUAL_CLOSE', 'MARGIN_CALL'] },
    realizedPnL: { type: 'number' },
    realizedPnLPercent: { type: 'number' }
  }
};

export const BBRSIBacktestSchema = {
  type: 'object',
  required: ['pair', 'timeframe', 'historicalDays'],
  properties: {
    pair: { type: 'string', enum: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] },
    timeframe: { type: 'string', enum: ['3m', '5m'] },
    historicalDays: { type: 'integer', enum: [30, 60, 90] },
    leverage: { type: 'number', minimum: 3, maximum: 8 },
    riskPerTrade: { type: 'number', minimum: 0.005, maximum: 0.01 },
    dryRunMode: { type: 'boolean', default: true }
  }
};

// ════════════════════════════════════════════════════════════════════════════
// IMPLEMENTATION CHECKLIST
// ════════════════════════════════════════════════════════════════════════════

/*
PHASE 1: AGENT REGISTRATION & SCHEMA (1-2 days)
[ ] Add agent definition to firestoreSeed.ts
[ ] Create BB-RSI config interface in types/index.ts
[ ] Create trade & diagnostic interfaces in types/index.ts
[ ] Update Firestore security rules to allow user-scoped collections
[ ] Test Firestore collections are accessible

PHASE 2: SIGNAL EVALUATION ENGINE (2-3 days)
[ ] Implement signal evaluator function
  [ ] HTF trend analysis (EMA 50/200)
  [ ] Long entry conditions check
  [ ] Short entry conditions check
  [ ] SL/TP calculation logic
  [ ] Risk validation logic
[ ] Add helper functions to technicalIndicators.ts (volumeMA, adx, swingHigh, swingLow)
[ ] Test signal evaluation with historical candles

PHASE 3: TRADE EXECUTION (2-3 days)
[ ] Integrate with BitgetAdapter (already exists)
[ ] Implement trade execution function
[ ] Implement trade monitoring loop
[ ] Implement TP/SL/trailing stop logic
[ ] Implement force close timeout logic
[ ] Test order placement on testnet (if available)

PHASE 4: SAFETY & RISK MANAGEMENT (1-2 days)
[ ] Implement daily drawdown check
[ ] Implement equity drawdown check
[ ] Implement consecutive loss counter
[ ] Implement re-entry cooldown
[ ] Implement exchange health check
[ ] Implement order duplicate guard

PHASE 5: LOGGING & DIAGNOSTICS (1 day)
[ ] Set up trade logging to Firestore
[ ] Set up cycle diagnostics logging
[ ] Implement audit trail generation
[ ] Test log retrieval via API

PHASE 6: N8N WORKFLOW (1-2 days)
[ ] Create N8N workflow with all nodes
[ ] Connect to backend APIs
[ ] Test workflow execution
[ ] Add error handling & retry logic
[ ] Deploy to production N8N

PHASE 7: BACKTEST ENGINE (1-2 days)
[ ] Implement backtest replay engine
[ ] Implement results calculation
[ ] Store results in Firestore
[ ] Create backtest API endpoint
[ ] Test with 30/60/90 day datasets

PHASE 8: API ENDPOINTS (1 day)
[ ] Add all routes to routes/agents.ts
[ ] Add validation schemas
[ ] Implement rate limiting
[ ] Add proper error handling

PHASE 9: ADMIN APPROVAL (1 day)
[ ] Extend AgentApprovalService
[ ] Create approval request workflow
[ ] Test approval flow end-to-end

PHASE 10: TESTING & DEPLOYMENT (2-3 days)
[ ] Unit tests for signal evaluation
[ ] Integration tests for order execution
[ ] End-to-end test: agent activation to first trade
[ ] Load test: multiple agents running simultaneously
[ ] Deploy to production with monitoring

TOTAL ESTIMATE: 12-18 days of development
*/
