// Symbol to CoinGecko ID mapping utility
// This provides fallback mappings when the API lookup fails

import * as fs from 'fs';
import * as path from 'path';

let COINGECKO_SYMBOL_MAPPINGS: Record<string, string> = {};

// Load mappings from config file
function loadCoinMappings(): void {
  try {
    const configPath = path.join(__dirname, '../config/coinMappings.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      COINGECKO_SYMBOL_MAPPINGS = JSON.parse(configData);
    } else {
      // Fallback to minimal hardcoded mappings if config file doesn't exist
      COINGECKO_SYMBOL_MAPPINGS = {
        'XRPUSDT': 'ripple',
        'XRP': 'ripple',
        'BTCUSDT': 'bitcoin',
        'BTC': 'bitcoin',
        'ETHUSDT': 'ethereum',
        'ETH': 'ethereum'
      };
    }
  } catch (error) {
    console.warn('Failed to load coin mappings, using minimal fallback');
    COINGECKO_SYMBOL_MAPPINGS = {
      'XRPUSDT': 'ripple',
      'XRP': 'ripple',
      'BTCUSDT': 'bitcoin',
      'BTC': 'bitcoin',
      'ETHUSDT': 'ethereum',
      'ETH': 'ethereum'
    };
  }
}

// Initialize mappings on module load
loadCoinMappings();

// Legacy hardcoded mappings (kept for backward compatibility)
const LEGACY_MAPPINGS: Record<string, string> = {
  // Major cryptocurrencies
  'BTC': 'bitcoin',
  'BTCUSDT': 'bitcoin',
  'ETH': 'ethereum',
  'ETHUSDT': 'ethereum',
  'BNB': 'binancecoin',
  'BNBUSDT': 'binancecoin',
  'XRP': 'ripple',
  'XRPUSDT': 'ripple',
  'ADA': 'cardano',
  'ADAUSDT': 'cardano',
  'SOL': 'solana',
  'SOLUSDT': 'solana',
  'DOT': 'polkadot',
  'DOTUSDT': 'polkadot',
  'DOGE': 'dogecoin',
  'DOGEUSDT': 'dogecoin',
  'AVAX': 'avalanche-2',
  'AVAXUSDT': 'avalanche-2',
  'LTC': 'litecoin',
  'LTCUSDT': 'litecoin',
  'LINK': 'chainlink',
  'LINKUSDT': 'chainlink',
  'UNI': 'uniswap',
  'UNIUSDT': 'uniswap',
  'ALGO': 'algorand',
  'ALGOUSDT': 'algorand',
  'VET': 'vechain',
  'VETUSDT': 'vechain',
  'ICP': 'internet-computer',
  'ICPUSDT': 'internet-computer',
  'FIL': 'filecoin',
  'FILUSDT': 'filecoin',
  'TRX': 'tron',
  'TRXUSDT': 'tron',
  'ETC': 'ethereum-classic',
  'ETCUSDT': 'ethereum-classic',
  'XLM': 'stellar',
  'XLMUSDT': 'stellar',
  'THETA': 'theta-token',
  'THETAUSDT': 'theta-token',
  'FTT': 'ftx-token',
  'FTTUSDT': 'ftx-token',
  'HBAR': 'hedera-hashgraph',
  'HBARUSDT': 'hedera-hashgraph',
  'NEAR': 'near',
  'NEARUSDT': 'near',
  'FLOW': 'flow',
  'FLOWUSDT': 'flow',
  'MANA': 'decentraland',
  'MANAUSDT': 'decentraland',
  'SAND': 'the-sandbox',
  'SANDUSDT': 'the-sandbox',
  'AXS': 'axie-infinity',
  'AXSUSDT': 'axie-infinity',
  'CHZ': 'chiliz',
  'CHZUSDT': 'chiliz',
  'ENJ': 'enjincoin',
  'ENJUSDT': 'enjincoin',
  'BAT': 'basic-attention-token',
  'BATUSDT': 'basic-attention-token',
  'ZRX': '0x',
  'ZRXUSDT': '0x',
  'OMG': 'omisego',
  'OMGUSDT': 'omisego',
  'REP': 'augur',
  'REPUSDT': 'augur',
  'GNT': 'golem',
  'GNTUSDT': 'golem',
  'STORJ': 'storj',
  'STORJUSDT': 'storj',
  'ANT': 'aragon',
  'ANTUSDT': 'aragon',
  'MKR': 'maker',
  'MKRUSDT': 'maker',
  'KNC': 'kyber-network',
  'KNCUSDT': 'kyber-network',
  'RLC': 'iexec-rlc',
  'RLCUSDT': 'iexec-rlc',
  'MTL': 'metal',
  'MTLUSDT': 'metal',
  'POWR': 'power-ledger',
  'POWRUSDT': 'power-ledger',
  'FUN': 'funfair',
  'FUNUSDT': 'funfair',
  'WAVES': 'waves',
  'WAVESUSDT': 'waves',
  'LSK': 'lisk',
  'STRAT': 'stratis',
  'STRATUSDT': 'stratis',
  'ARK': 'ark',
  'ARKUSDT': 'ark',
  'XEM': 'nem',
  'XEMUSDT': 'nem',
  'QTUM': 'qtum',
  'QTUMUSDT': 'qtum',
  'BTG': 'bitcoin-gold',
  'BTGUSDT': 'bitcoin-gold',
  'ZEC': 'zcash',
  'ZECUSDT': 'zcash',
  'DASH': 'dash',
  'DASHUSDT': 'dash',
  'XMR': 'monero',
  'XMRUSDT': 'monero',
  'LSKUSDT': 'lisk'
};

export function getCoinGeckoId(symbol: string): string | null {
  // Try direct mapping first
  if (COINGECKO_SYMBOL_MAPPINGS[symbol]) {
    return COINGECKO_SYMBOL_MAPPINGS[symbol];
  }

  // Try stripping common suffixes
  const baseSymbol = symbol.replace(/USDT$|USD$|BTC$|ETH$|BNB$/i, '');

  if (COINGECKO_SYMBOL_MAPPINGS[baseSymbol]) {
    return COINGECKO_SYMBOL_MAPPINGS[baseSymbol];
  }

  // Try uppercase version
  const upperSymbol = baseSymbol.toUpperCase();
  if (COINGECKO_SYMBOL_MAPPINGS[upperSymbol]) {
    return COINGECKO_SYMBOL_MAPPINGS[upperSymbol];
  }

  return null;
}

export function addCoinGeckoMapping(symbol: string, coingeckoId: string): void {
  COINGECKO_SYMBOL_MAPPINGS[symbol] = coingeckoId;
}

// Common currency pairs for Google Finance
export const GOOGLE_FINANCE_RATES = {
  'USD': 1.0,
  'EUR': 0.85,
  'GBP': 0.73,
  'JPY': 110.0,
  'CAD': 1.25,
  'AUD': 1.35,
  'CHF': 0.92,
  'CNY': 6.45,
  'INR': 74.5,
  'KRW': 1180.0
};
