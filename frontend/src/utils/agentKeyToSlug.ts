// Shared mapping: enum agent key → backend slug
export function agentKeyToSlug(key: string): string {
  switch (key) {
    case 'VWAP_STRATEGY':
      return 'vwap-strategy';
    case 'COPY_TRADING_AGENT':
      return 'crowd-consensus';
    case 'LIQUIDITY_SWEEP_AGENT':
      return 'liquidity_sniper_arbitrage';
    case 'HTF_TREND_FILTER_AGENT':
      return 'htf-trend-filter-agent';
    default:
      return key;
  }
}
