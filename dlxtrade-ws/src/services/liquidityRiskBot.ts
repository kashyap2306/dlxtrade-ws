/**
 * Liquidity Risk Bot - Pure Rule-Based Validator
 * NO database access, NO API calls
 * Conservative capital protection focused
 */

export interface RiskBotInput {
  pair: string;
  timeframe: string;
  session: string;
  liquidity_sweep: boolean;
  sweep_type: string;
  volume_spike: boolean;
  structure_break: boolean;
  market_condition: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  risk_percent: number;
  trades_taken_today: number;
  last_trade_result: string;
}

export interface RiskBotOutput {
  trade: "YES" | "NO";
  confidence: number;
  rr_valid: boolean;
  risk_ok: boolean;
  reason: string;
}

/**
 * Validates all required input fields are present and properly typed
 */
function validateInput(input: any): input is RiskBotInput {
  const requiredFields = [
    'pair', 'timeframe', 'session', 'liquidity_sweep', 'sweep_type',
    'volume_spike', 'structure_break', 'market_condition', 'entry_price',
    'stop_loss', 'take_profit', 'risk_percent', 'trades_taken_today', 'last_trade_result'
  ];

  for (const field of requiredFields) {
    if (!(field in input)) {
      return false;
    }
  }

  // Type validation
  if (typeof input.liquidity_sweep !== 'boolean') return false;
  if (typeof input.volume_spike !== 'boolean') return false;
  if (typeof input.structure_break !== 'boolean') return false;
  if (typeof input.entry_price !== 'number' || isNaN(input.entry_price)) return false;
  if (typeof input.stop_loss !== 'number' || isNaN(input.stop_loss)) return false;
  if (typeof input.take_profit !== 'number' || isNaN(input.take_profit)) return false;
  if (typeof input.risk_percent !== 'number' || isNaN(input.risk_percent)) return false;
  if (typeof input.trades_taken_today !== 'number' || isNaN(input.trades_taken_today)) return false;

  return true;
}

/**
 * Calculates Risk-Reward ratio
 */
function calculateRR(entryPrice: number, stopLoss: number, takeProfit: number): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);

  if (risk === 0) return 0;
  return reward / risk;
}

/**
 * Main risk validation logic - conservative approach
 */
export function validateTrade(input: any): RiskBotOutput {
  // Input validation
  if (!validateInput(input)) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Invalid or missing input fields"
    };
  }

  const trade = input as RiskBotInput;

  // HARD RULES - Any failure = NO trade
  if (trade.session !== 'London' && trade.session !== 'NewYork') {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Invalid session - only London or NewYork allowed"
    };
  }

  if (!trade.liquidity_sweep) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Liquidity sweep required"
    };
  }

  if (!trade.volume_spike) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Volume spike required"
    };
  }

  if (trade.market_condition === 'choppy') {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Choppy market condition not allowed"
    };
  }

  if (trade.trades_taken_today >= 5) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Maximum daily trades (5) exceeded"
    };
  }

  if (trade.last_trade_result === 'loss') {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Last trade was a loss - no consecutive losses allowed"
    };
  }

  if (trade.risk_percent > 3) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: false,
      reason: "Risk percent exceeds 3% limit"
    };
  }

  // RISK-REWARD VALIDATION
  const rr = calculateRR(trade.entry_price, trade.stop_loss, trade.take_profit);
  const rrValid = rr >= 1.3; // 1:3 minimum RR

  if (!rrValid) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: false,
      risk_ok: true,
      reason: `Risk-Reward ratio ${rr.toFixed(2)}:1 below minimum 1.3:1`
    };
  }

  // ADDITIONAL CONSERVATIVE CHECKS
  if (trade.risk_percent > 2) {
    return {
      trade: "NO",
      confidence: 0,
      rr_valid: true,
      risk_ok: false,
      reason: "Risk percent above conservative 2% threshold"
    };
  }

  // ALL CHECKS PASSED - calculate confidence
  let confidence = 60; // Base confidence

  // Boost confidence for better conditions
  if (trade.session === 'London') confidence += 10;
  if (trade.structure_break) confidence += 10;
  if (trade.trades_taken_today === 0) confidence += 10;
  if (rr >= 2) confidence += 10; // Extra points for better RR

  return {
    trade: "YES",
    confidence: Math.min(confidence, 100),
    rr_valid: true,
    risk_ok: true,
    reason: "All risk checks passed"
  };
}