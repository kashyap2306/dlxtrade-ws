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

      // Minimal hardcoded fallback - current valid pairs from Binance cache
      return [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'SOLUSDT', 'DOTUSDT', 'DOGEUSDT',
        'AVAXUSDT', 'LTCUSDT', 'MATICUSDT', 'SHIBUSDT', 'UNIUSDT', 'LINKUSDT', 'ETCUSDT', 'ATOMUSDT',
        'XLMUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'VETUSDT', 'HBARUSDT', 'NEARUSDT', 'FLOWUSDT',
        'MANAUSDT', 'SANDUSDT', 'AXSUSDT', 'CHZUSDT', 'ENJUSDT', 'THETAUSDT', 'GALAUSDT', 'EGLDUSDT',
        'CAKEUSDT', 'SUSHIUSDT', '1INCHUSDT', 'COMPUSDT', 'MKRUSDT', 'AAVEUSDT', 'YFIUSDT', 'BALUSDT',
        'BCHUSDT', 'APEUSDT', 'LDOUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'FTMUSDT',
        'SUIUSDT', 'TIAUSDT', 'SEIUSDT', 'RUNEUSDT', 'BONKUSDT', 'BOMEUSDT', 'WIFUSDT', 'PYTHUSDT',
        'JTOUSDT', 'JUPUSDT', 'TURBOUSDT', 'WLDUSDT', 'ARKMUSDT', 'BEAMUSDT', 'DYMUSDT', 'ZKSYNCUSDT',
        'ONDOUSDT', 'ALTUSDT', 'PIXELUSDT', 'MYROUSDT', 'MEWUSDT', 'SLERFUSDT', 'BRETTAUSDT', 'RATSUSDT',
        'HMSTRUSDT', 'GOATUSDT', 'CORGIAIUSDT', 'PENGUUSDT', 'LOCKINUSDT', 'APUUSDT', 'CUMMIESUSDT', 'FOXYUSDT',
        'SUNDOGUSDT', 'DUCKUSDT', 'PUNKAIUSDT', 'COOKUSDT', 'GRASSUSDT', 'GIGAUSDT', 'BOBAUSDT', 'BADUSDT',
        'DEGENUSDT', 'CLOUDUSDT', 'PUFFERUSDT', 'ZEREBROUSDT', 'TROVEUSDT', 'AEROUSDT', 'SAFEUSDT', 'MAJORUSDT',
        'MOTHERUSDT', 'QUARKUSDT', 'SSVUSDT', 'LQTYUSDT', 'FXSUSDT', 'SYNTHUSDT', 'CPOOLUSDT', 'CETUSUSDT',
        'COWUSDT', 'DIAUSDT', 'ELONUSDT', 'FLOKIUSDT', 'GRTUSDT', 'HIFIUSDT', 'IDUSDT', 'IMXUSDT'
      ].slice(0, 100);
    }
  }
}

export const topCoinsService = new TopCoinsService();

