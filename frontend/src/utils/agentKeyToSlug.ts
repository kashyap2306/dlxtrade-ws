// Shared mapping: enum agent key → backend slug
export function agentKeyToSlug(key: string): string {
  switch (key) {
    case 'TRADING_AGENT':
      return 'trading-agent';
    case 'VWAP_STRATEGY':
      return 'vwap-strategy';
    case 'COPY_TRADING_AGENT':
      return 'crowd-consensus';
    case 'LIQUIDITY_SWEEP_AGENT':
      return 'liquidity_sniper_arbitrage';
    default:
      return key;
  }
}
