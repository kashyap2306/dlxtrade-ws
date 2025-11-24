import { logger } from '../utils/logger';
import { getValidSymbols } from '../scripts/fetchValidBinanceSymbols';

/**
 * Service to fetch top 100 coins from valid Binance symbols cache
 */
export class TopCoinsService {
  /**
   * Get top 100 coins from cached valid Binance symbols
   * Returns symbols in format: ["BTCUSDT", "ETHUSDT", ...]
   */
  async getTop100Coins(): Promise<string[]> {
    try {
      // Load valid symbols from cache (with timeout to prevent blocking)
      const timeoutPromise = new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('Symbol cache timeout')), 1000)
      );

      const validSymbolsPromise = getValidSymbols();
      const validSymbols = await Promise.race([validSymbolsPromise, timeoutPromise]);

      // Filter to only USDT pairs (should all be USDT but being safe)
      const usdtSymbols = validSymbols.filter(symbol => symbol.endsWith('USDT'));

      // Return top 100 by default sorting (symbols are already sorted alphabetically)
      // For better ranking, we could fetch volume data, but cache provides valid symbols
      const top100 = usdtSymbols.slice(0, 100);

      logger.info({
        totalValidSymbols: validSymbols.length,
        usdtSymbols: usdtSymbols.length,
        returnedCount: top100.length
      }, 'Retrieved top coins from valid Binance symbols cache');

      return top100;
    } catch (error: any) {
      logger.error({ err: error.message }, 'Failed to load valid symbols cache, using minimal fallback');

      // Minimal hardcoded fallback - only the most common valid pairs
      return [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'SOLUSDT', 'DOTUSDT', 'DOGEUSDT',
        'AVAXUSDT', 'LTCUSDT', 'MATICUSDT', 'SHIBUSDT', 'UNIUSDT', 'LINKUSDT', 'ETCUSDT', 'ATOMUSDT',
        'XLMUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'VETUSDT', 'HBARUSDT', 'NEARUSDT', 'FLOWUSDT',
        'MANAUSDT', 'SANDUSDT', 'AXSUSDT', 'CHZUSDT', 'ENJUSDT', 'THETAUSDT', 'GALAUSDT', 'EGLDUSDT',
        'CAKEUSDT', 'SUSHIUSDT', '1INCHUSDT', 'COMPUSDT', 'MKRUSDT', 'AAVEUSDT', 'YFIUSDT', 'BALUSDT',
        'RENUSDT', 'KNCUSDT', 'ZRXUSDT', 'BATUSDT', 'OMGUSDT', 'LRCUSDT', 'REPUSDT', 'GNTUSDT',
        'STORJUSDT', 'ANTUSDT', 'ADXUSDT', 'ARKUSDT', 'WAVESUSDT', 'STRATUSDT', 'LSKUSDT', 'MAIDUSDT',
        'ENGUSDT', 'BQXUSDT', 'BTGUSDT', 'ZECUSDT', 'DASHUSDT', 'XMRUSDT', 'NXTUSDT', 'BTSUSDT',
        'XEMUSDT', 'QTUMUSDT', 'BTMUSDT', 'WTCUSDT', 'LRCUSDT', 'SNTUSDT', 'QSPUSDT', 'POEUSDT',
        'SUBUSDT', 'AMBUSDT', 'APPCUSDT', 'VIBEUSDT', 'ASTUSDT', 'TNTUSDT', 'WABIUSDT', 'GTOUSDT',
        'ICXUSDT', 'OSTUSDT', 'ELFUSDT', 'AIONUSDT', 'NEBLUSDT', 'BRDUSDT', 'MCOUSDT', 'WINGSUSDT',
        'INSUSDT', 'TRIGUSDT', 'APPCUSDT', 'WABIUSDT', 'GTOUSDT', 'ICXUSDT', 'OSTUSDT', 'ELFUSDT',
        'AIONUSDT', 'NEBLUSDT', 'BRDUSDT', 'MCOUSDT', 'WINGSUSDT', 'INSUSDT', 'TRIGUSDT', 'LENDUSDT'
      ].slice(0, 100);
    }
  }
}

export const topCoinsService = new TopCoinsService();

