// Shared mapping: enum agent key → backend slug
export function agentKeyToSlug(key: string): string {
  switch (key) {
    case 'VWAP_STRATEGY':
      return 'vwap-strategy';
    case 'COPY_TRADING_AGENT':
      return 'crowd-consensus';
    case 'BB_RSI_EMA200_SCALPER':
      return 'bb-rsi-scalper';
    case 'HTF_TREND_FILTER_AGENT':
      return 'htf-trend-filter-agent';
    default:
      return key;
  }
}
