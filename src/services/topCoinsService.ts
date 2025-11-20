import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Service to fetch top 100 coins from CoinGecko or Binance public API
 */
export class TopCoinsService {
  /**
   * Fetch top 100 coins from CoinGecko
   * Returns symbols in format: ["BTCUSDT", "ETHUSDT", ...]
   */
  async getTop100FromCoinGecko(): Promise<string[]> {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 100,
          page: 1,
          sparkline: false,
        },
        timeout: 10000,
      });

      const symbols: string[] = [];
      for (const coin of response.data) {
        // Convert CoinGecko symbol to exchange format (e.g., "btc" -> "BTCUSDT")
        const symbol = coin.symbol.toUpperCase();
        // Skip if already added (some coins might have duplicates)
        if (!symbols.includes(`${symbol}USDT`)) {
          symbols.push(`${symbol}USDT`);
        }
      }

      logger.info({ count: symbols.length }, 'Fetched top coins from CoinGecko');
      return symbols.slice(0, 100); // Ensure exactly 100
    } catch (error: any) {
      logger.warn({ err: error.message }, 'Failed to fetch from CoinGecko, trying Binance fallback');
      return this.getTop100FromBinance();
    }
  }

  /**
   * Fetch top 100 coins from Binance public API
   * Returns symbols in format: ["BTCUSDT", "ETHUSDT", ...]
   */
  async getTop100FromBinance(): Promise<string[]> {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
        timeout: 10000,
      });

      // Filter USDT pairs and sort by 24h volume
      const usdtPairs = response.data
        .filter((ticker: any) => ticker.symbol.endsWith('USDT'))
        .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 100)
        .map((ticker: any) => ticker.symbol);

      logger.info({ count: usdtPairs.length }, 'Fetched top coins from Binance');
      return usdtPairs;
    } catch (error: any) {
      logger.error({ err: error.message }, 'Failed to fetch from Binance, using hardcoded list');
      return this.getHardcodedTop100();
    }
  }

  /**
   * Get hardcoded list of top 100 coins as fallback
   */
  private getHardcodedTop100(): string[] {
    return [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'DOGEUSDT',
      'AVAXUSDT', 'SHIBUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'LINKUSDT', 'ATOMUSDT', 'ETCUSDT',
      'XLMUSDT', 'NEARUSDT', 'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'EOSUSDT',
      'AAVEUSDT', 'AXSUSDT', 'THETAUSDT', 'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'CHZUSDT', 'ENJUSDT',
      'HBARUSDT', 'EGLDUSDT', 'FLOWUSDT', 'XTZUSDT', 'ZECUSDT', 'DASHUSDT', 'WAVESUSDT', 'ZILUSDT',
      'IOTAUSDT', 'ONTUSDT', 'QTUMUSDT', 'ZRXUSDT', 'BATUSDT', 'OMGUSDT', 'SNXUSDT', 'MKRUSDT',
      'COMPUSDT', 'YFIUSDT', 'SUSHIUSDT', 'CRVUSDT', '1INCHUSDT', 'ALPHAUSDT', 'RENUSDT', 'KSMUSDT',
      'GRTUSDT', 'BANDUSDT', 'OCEANUSDT', 'NMRUSDT', 'COTIUSDT', 'ANKRUSDT', 'BALUSDT', 'STORJUSDT',
      'KNCUSDT', 'LRCUSDT', 'CVCUSDT', 'FTMUSDT', 'ZENUSDT', 'SKLUSDT', 'LUNAUSDT', 'RUNEUSDT',
      'CAKEUSDT', 'BAKEUSDT', 'BURGERUSDT', 'SXPUSDT', 'XVSUSDT', 'ALPACAUSDT', 'AUTOUSDT', 'REEFUSDT',
      'DODOUSDT', 'LINAUSDT', 'PERPUSDT', 'RIFUSDT', 'OMUSDT', 'PONDUSDT', 'DEGOUSDT', 'ALICEUSDT',
      'LITUSDT', 'SFPUSDT', 'DYDXUSDT', 'CELRUSDT', 'KLAYUSDT', 'ARPAUSDT', 'CTSIUSDT',
      'LTOUSDT', 'FEARUSDT', 'ADXUSDT', 'AUCTIONUSDT', 'DARUSDT', 'BNXUSDT', 'RGTUSDT', 'MOVRUSDT',
      'CITYUSDT', 'ENSUSDT', 'KP3RUSDT', 'QIUSDT', 'PORTOUSDT', 'POWRUSDT', 'VGXUSDT', 'JASMYUSDT',
      'AMPUSDT', 'PLAUSDT', 'PYTHUSDT', 'PENDLEUSDT', 'PIXELUSDT', 'ACEUSDT', 'NFPUSDT', 'AIUSDT',
    ].slice(0, 100);
  }

  /**
   * Get top 100 coins (tries CoinGecko first, then Binance, then hardcoded)
   */
  async getTop100Coins(): Promise<string[]> {
    try {
      return await this.getTop100FromCoinGecko();
    } catch (error: any) {
      logger.warn({ err: error.message }, 'CoinGecko failed, trying Binance');
      try {
        return await this.getTop100FromBinance();
      } catch (binanceError: any) {
        logger.warn({ err: binanceError.message }, 'Binance failed, using hardcoded list');
        return this.getHardcodedTop100();
      }
    }
  }
}

export const topCoinsService = new TopCoinsService();

