import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

interface ExchangeData {
  exchange: string;
  canonicalSymbol: string;
  exchangeSymbol: string;
  price: number;
  volume24h: number;
  volumeChangePercent: number;
  longShortRatio?: number;
  openInterest?: number;
  oiChangePercent?: number;
  direction: 'long' | 'short' | 'neutral';
  timestamp: number;
}

interface ConsensusSignal {
  canonicalSymbol: string;
  direction: 'long' | 'short';
  exchangesConfirmed: string[];
  strengthScore: number; // 0-100 based on number of exchanges and confidence
  avgPrice: number;
  totalVolume: number;
  timestamp: number;
}

interface CrowdConsensusSettings {
  autoTradeEnabled: boolean;
  selectedAutoTradeExchange: string;
  riskPercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  leverage: number;
  maxDailyLossPercent: number;
}

export class CrowdConsensusService {
  public static readonly SUPPORTED_EXCHANGES = [
    'binance', 'bybit', 'bitget', 'okx', 'kucoin',
    'bingx', 'gate', 'mexc', 'phemex', 'coinex'
  ];

  private static readonly MAJOR_COINS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT',
    'DOTUSDT', 'AVAXUSDT', 'LTCUSDT', 'LINKUSDT', 'UNIUSDT'
  ];

  /**
   * Fetch market data from all supported exchanges
   */
  static async fetchAllExchangeData(): Promise<ExchangeData[]> {
    // Parallelize for performance
    const fetches: Promise<ExchangeData | null>[] = [];
    const readiness: Record<string, { status: 'ACTIVE' | 'DEGRADED'; reason?: string }> = {};
    for (const ex of this.SUPPORTED_EXCHANGES) readiness[ex] = { status: 'ACTIVE' };
    console.log(
      ' [HARD_LOG] [EXCHANGE_API_READY_CHECK]',
      JSON.stringify({
        exchanges: this.SUPPORTED_EXCHANGES,
        coins: this.MAJOR_COINS,
        ts: Date.now(),
      }),
    );
    for (const exchange of this.SUPPORTED_EXCHANGES) {
      for (const symbol of this.MAJOR_COINS) {
        fetches.push(this.fetchExchangeData(exchange, symbol).catch((error: any) => {
          logger.warn({ exchange, error: error?.message }, 'Failed to fetch exchange data');
          readiness[exchange] = { status: 'DEGRADED', reason: error?.message || 'fetch_error' };
          return null;
        }));
      }
    }
    const allResults = await Promise.all(fetches);
    const allData: ExchangeData[] = [];
    for (let i = 0; i < allResults.length; ++i) {
      const data = allResults[i];
      if (data) {
        allData.push(data);
      } else {
        // Find which exchange this was
        const idx = i % this.SUPPORTED_EXCHANGES.length;
        const exchange = this.SUPPORTED_EXCHANGES[idx];
        readiness[exchange] = readiness[exchange]?.status === 'ACTIVE'
          ? { status: 'DEGRADED', reason: readiness[exchange]?.reason || 'null_data' }
          : readiness[exchange];
      }
    }
    console.log(
      ' [HARD_LOG] [EXCHANGE_API_READY_CHECK_RESULT]',
      JSON.stringify({ readiness, ts: Date.now() }),
    );
    return allData;
  }

  /**
   * Fetch data from a specific exchange
   */
  static async fetchExchangeData(exchange: string, canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      switch (exchange) {
        case 'binance':
          return await this.fetchBinanceData(canonicalSymbol);
        case 'bybit':
          return await this.fetchBybitData(canonicalSymbol);
        case 'bitget':
          return await this.fetchBitgetData(canonicalSymbol);
        case 'okx':
          return await this.fetchOKXData(canonicalSymbol);
        case 'kucoin':
          return await this.fetchKuCoinData(canonicalSymbol);
        case 'bingx':
          return await this.fetchBingXData(canonicalSymbol);
        case 'gate':
          return await this.fetchGateData(canonicalSymbol);
        case 'mexc':
          return await this.fetchMEXCData(canonicalSymbol);
        case 'phemex':
          return await this.fetchPhemexData(canonicalSymbol);
        case 'coinex':
          return await this.fetchCoinExData(canonicalSymbol);
        default:
          console.log(
            ' [HARD_LOG] [EXCHANGE_SKIPPED]',
            JSON.stringify({ exchange, reason: 'unsupported_exchange', ts: Date.now() }),
          );
          return null;
      }
    } catch (error: any) {
      logger.warn({ exchange, error: error.message }, 'Exchange data fetch failed');
      console.log(
        ' [HARD_LOG] [EXCHANGE_API_ERROR]',
        JSON.stringify({ exchange, error: error.message, ts: Date.now() }),
      );
      return null;
    }
  }

  private static normalizeSymbol(exchange: string, canonicalSymbol: string): string {
    const base = canonicalSymbol.replace('USDT', '');
    if (exchange === 'okx' || exchange === 'kucoin' || exchange === 'bingx') {
      return `${base}-USDT`;
    }
    if (exchange === 'gate') {
      return `${base.toLowerCase()}_usdt`;
    }
    if (exchange === 'coinex') {
      return `${base}USDT`;
    }
    if (exchange === 'bitget') {
      return `${base}USDT_SPBL`;
    }
    return canonicalSymbol;
  }

  private static safeTrimRaw(raw: any, maxLen: number = 400): string {
    try {
      const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
    } catch {
      return '[unserializable]';
    }
  }

  private static async tracedFetch(
    exchange: string,
    endpoint: string,
    params: Record<string, any>,
  ): Promise<{ ok: boolean; status: number; json: any } | null> {
    const ts = Date.now();
    console.log(
      ' [HARD_LOG] [EXCHANGE_API_REQUEST]',
      JSON.stringify({ exchange, endpoint, params, ts }),
    );
    try {
      const url = endpoint;
      const response = await fetch(url);
      const status = response.status;
      let json: any = null;
      try {
        json = await response.json();
      } catch (e: any) {
        json = { __parseError: e?.message || 'json_parse_error' };
      }
      console.log(
        ' [HARD_LOG] [EXCHANGE_API_RESPONSE]',
        JSON.stringify({
          exchange,
          endpoint,
          status,
          ok: response.ok,
          raw: this.safeTrimRaw(json),
          ts: Date.now(),
        }),
      );
      return { ok: response.ok, status, json };
    } catch (error: any) {
      console.log(
        ' [HARD_LOG] [EXCHANGE_API_RESPONSE_ERROR]',
        JSON.stringify({ exchange, endpoint, error: error.message, ts: Date.now() }),
      );
      return null;
    }
  }

  /**
   * Binance API - Comprehensive market data
   */
  static async fetchBinanceData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const exchangeSymbol = this.normalizeSymbol('binance', canonicalSymbol);
      const tickerEndpoint = `https://api.binance.com/api/v3/ticker/24hr?symbol=${exchangeSymbol}`;
      const tickerRes = await this.tracedFetch('binance', tickerEndpoint, { symbol: exchangeSymbol });
      if (!tickerRes?.ok) return null;
      const ticker = tickerRes.json;

      // Get long/short ratio (if available via futures API)
      let longShortRatio: number | undefined;
      try {
        const lsrEndpoint = `https://fapi.binance.com/futures/data/globalLongShortRatio?symbol=${exchangeSymbol}&period=1h&limit=1`;
        const lsrRes = await this.tracedFetch('binance', lsrEndpoint, {
          symbol: exchangeSymbol,
          period: '1h',
          limit: 1,
        });
        if (lsrRes?.ok) {
          const lsrData = lsrRes.json;
          if (lsrData.length > 0) {
            longShortRatio = parseFloat(lsrData[0].longShortRatio);
          }
        } else {
          console.log(' [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'binance', canonicalSymbol, metric: 'longShortRatio', reason: 'non_ok', ts: Date.now() }));
        }
      } catch (error) {
        console.log(' [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'binance', canonicalSymbol, metric: 'longShortRatio', reason: 'exception', ts: Date.now() }));
      }

      // Get open interest
      let openInterest: number | undefined;
      try {
        const oiEndpoint = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${exchangeSymbol}`;
        const oiRes = await this.tracedFetch('binance', oiEndpoint, { symbol: exchangeSymbol });
        if (oiRes?.ok) {
          const oiData = oiRes.json;
          openInterest = parseFloat(oiData.openInterest);
        } else {
          console.log(' [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'binance', canonicalSymbol, metric: 'openInterest', reason: 'non_ok', ts: Date.now() }));
        }
      } catch (error) {
        console.log(' [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'binance', canonicalSymbol, metric: 'openInterest', reason: 'exception', ts: Date.now() }));
      }

      // Direction logic: only if longShortRatio available
      let direction: 'long' | 'short' | 'neutral' = 'neutral';
      if (typeof longShortRatio === 'number') {
        direction = longShortRatio > 0.5 ? 'long' : 'short';
      } else {
        console.log(' [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'binance', canonicalSymbol, metric: 'direction', reason: 'no_longShortRatio', ts: Date.now() }));
      }

      console.log(
        ' [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'binance',
          canonicalSymbol,
          exchangeSymbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume),
          volumeChangePercent: parseFloat(ticker.priceChangePercent),
          longShortRatio,
          openInterest,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'binance',
        canonicalSymbol,
        exchangeSymbol,
        price: parseFloat(ticker.lastPrice),
        volume24h: parseFloat(ticker.volume),
        volumeChangePercent: parseFloat(ticker.priceChangePercent),
        longShortRatio,
        openInterest,
        oiChangePercent: 0,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Bybit API
   */
  static async fetchBybitData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const exchangeSymbol = this.normalizeSymbol('bybit', canonicalSymbol);
      const endpoint = `https://api.bybit.com/v2/public/tickers?symbol=${exchangeSymbol}`;
      const res = await this.tracedFetch('bybit', endpoint, { symbol: exchangeSymbol });
      if (!res?.ok) return null;
      const data = res.json;
      if (!data.result || data.result.length === 0) return null;
      const ticker = data.result[0];
      // Bybit: No long/short ratio, no OI, only volume/price
      // Only direction if longShortRatio or OI+price/volume spike available (not available here)
      const direction: 'long' | 'short' | 'neutral' = 'neutral';
      console.log('🔥 [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'bybit', symbol: exchangeSymbol, metric: 'direction', reason: 'no_longShortRatio_no_OI', ts: Date.now() }));
      const volumeChangePercent = parseFloat(ticker.price_24h_pcnt) * 100;
      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'bybit',
          canonicalSymbol,
          exchangeSymbol,
          price: parseFloat(ticker.last_price),
          volume24h: parseFloat(ticker.volume_24h),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );
      return {
                exchange: 'bybit',
        canonicalSymbol,
        exchangeSymbol,
        price: parseFloat(ticker.last_price),
        volume24h: parseFloat(ticker.volume_24h),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Bitget API
   */
  static async fetchBitgetData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('bitget', canonicalSymbol);
      const endpoint = `https://api.bitget.com/api/spot/v1/market/ticker?symbol=${normalizedSymbol}`;
      const res = await this.tracedFetch('bitget', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.data) return null;

      const ticker = data.data;

      const volumeChangePercent = parseFloat(ticker.change);
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'bitget',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.close),
          volume24h: parseFloat(ticker.baseVol),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'bitget',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.close),
        volume24h: parseFloat(ticker.baseVol),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * OKX API
   */
  static async fetchOKXData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('okx', canonicalSymbol);
      const endpoint = `https://www.okx.com/api/v5/market/ticker?instId=${normalizedSymbol}`;
      const res = await this.tracedFetch('okx', endpoint, { instId: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.data || data.data.length === 0) return null;

      const ticker = data.data[0];

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]',
        JSON.stringify({ exchange: 'okx', canonicalSymbol,
        exchangeSymbol: normalizedSymbol, metric: 'volumeChangePercent', reason: 'field_not_percent', ts: Date.now() }),
      );

      const volumeChangePercent = 0;
      const direction: 'long' | 'short' | 'neutral' = 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'okx',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.last),
          volume24h: parseFloat(ticker.vol24h),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'okx',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.last),
        volume24h: parseFloat(ticker.vol24h),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * KuCoin API
   */
  static async fetchKuCoinData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('kucoin', canonicalSymbol);
      const endpoint = `https://api.kucoin.com/api/v1/market/stats?symbol=${normalizedSymbol}`;
      const res = await this.tracedFetch('kucoin', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.data) return null;

      const stats = data.data;

      const volumeChangePercent = parseFloat(stats.changeRate) * 100;
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'kucoin',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(stats.last),
          volume24h: parseFloat(stats.vol),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'kucoin',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(stats.last),
        volume24h: parseFloat(stats.vol),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * BingX API
   */
  static async fetchBingXData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('bingx', canonicalSymbol);
      const endpoint = `https://open-api.bingx.com/openApi/spot/v1/ticker/24hr?symbol=${normalizedSymbol}`;
      const res = await this.tracedFetch('bingx', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.data) return null;

      const ticker = data.data;

      const volumeChangePercent = parseFloat(ticker.priceChangePercent);
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'bingx',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'bingx',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.lastPrice),
        volume24h: parseFloat(ticker.volume),
        volumeChangePercent: parseFloat(ticker.priceChangePercent),
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Gate.io API
   */
  static async fetchGateData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('gate', canonicalSymbol);
      const endpoint = `https://api.gate.io/api2/1/ticker/${normalizedSymbol}`;
      const res = await this.tracedFetch('gate', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const ticker = res.json;

      const volumeChangePercent = parseFloat(ticker.percentChange);
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'gate',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.last),
          volume24h: parseFloat(ticker.baseVolume),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'gate',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.last),
        volume24h: parseFloat(ticker.baseVolume),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * MEXC API
   */
  static async fetchMEXCData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('mexc', canonicalSymbol);
      const endpoint = `https://api.mexc.com/api/v3/ticker/24hr?symbol=${normalizedSymbol}`;
      const res = await this.tracedFetch('mexc', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      const ticker = Array.isArray(data) ? data[0] : data;
      if (!ticker) return null;

      const volumeChangePercent = parseFloat(ticker.priceChangePercent);
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'mexc',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'mexc',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.lastPrice),
        volume24h: parseFloat(ticker.volume),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Phemex API
   */
  static async fetchPhemexData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('phemex', canonicalSymbol);
      const endpoint = `https://api.phemex.com/v1/md/ticker/24hr?symbol=${normalizedSymbol}`;
      const res = await this.tracedFetch('phemex', endpoint, { symbol: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.result) return null;

      const ticker = data.result;

      const volumeChangePercent =
        ticker.priceChangePercent !== undefined ? parseFloat(ticker.priceChangePercent) : 0;
      if (ticker.priceChangePercent === undefined) {
        console.log('🔥 [HARD_LOG] [EXCHANGE_METRIC_UNAVAILABLE]', JSON.stringify({ exchange: 'phemex', canonicalSymbol,
        exchangeSymbol: normalizedSymbol, metric: 'priceChangePercent', reason: 'missing_field', ts: Date.now() }));
      }
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'phemex',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.last),
          volume24h: parseFloat(ticker.volume),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'phemex',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.last),
        volume24h: parseFloat(ticker.volume),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * CoinEx API
   */
  static async fetchCoinExData(canonicalSymbol: string): Promise<ExchangeData | null> {
    try {
      const normalizedSymbol = this.normalizeSymbol('coinex', canonicalSymbol);
      const endpoint = `https://api.coinex.com/v1/market/ticker?market=${normalizedSymbol}`;
      const res = await this.tracedFetch('coinex', endpoint, { market: normalizedSymbol });
      if (!res?.ok) return null;
      const data = res.json;

      if (!data.data || !data.data.ticker) return null;

      const ticker = data.data.ticker;

      const volumeChangePercent = parseFloat(ticker.change);
      const direction: 'long' | 'short' | 'neutral' =
        volumeChangePercent > 0 ? 'long' : volumeChangePercent < 0 ? 'short' : 'neutral';

      console.log(
        '🔥 [HARD_LOG] [EXCHANGE_PARSED_FIELDS]',
        JSON.stringify({
          exchange: 'coinex',
          canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
          price: parseFloat(ticker.last),
          volume24h: parseFloat(ticker.vol),
          volumeChangePercent,
          direction,
          ts: Date.now(),
        }),
      );

      return {
                exchange: 'coinex',
        canonicalSymbol,
        exchangeSymbol: normalizedSymbol,
        price: parseFloat(ticker.last),
        volume24h: parseFloat(ticker.vol),
        volumeChangePercent,
        direction,
        timestamp: Date.now(),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyze consensus across all exchanges
   */
  static async analyzeConsensus(): Promise<ConsensusSignal[]> {
    const allData = await this.fetchAllExchangeData();
    const signals: ConsensusSignal[] = [];

    // Group data by canonicalSymbol
    const canonicalGroups = new Map<string, ExchangeData[]>();
    for (const data of allData) {
      if (!canonicalGroups.has(data.canonicalSymbol)) {
        canonicalGroups.set(data.canonicalSymbol, []);
      }
      canonicalGroups.get(data.canonicalSymbol)!.push(data);
    }

    // Analyze each canonical symbol for consensus
    for (const [canonicalSymbol, exchangeData] of canonicalGroups) {
      for (const snap of exchangeData) {
        console.log(
          '🔥 [HARD_LOG] [NORMALIZED_MARKET_SNAPSHOT]',
          JSON.stringify({
            exchange: snap.exchange,
            canonicalSymbol,
            price: snap.price,
            volume24h: snap.volume24h,
            volumeChangePercent: snap.volumeChangePercent,
            openInterest: snap.openInterest,
            longShortRatio: snap.longShortRatio,
            direction: snap.direction,
            ts: snap.timestamp,
          }),
        );
      }
      const consensus = this.calculateConsensus(canonicalSymbol, exchangeData);
      if (consensus) {
        signals.push(consensus);
      }
    }

    return signals;
  }

  /**
   * Calculate consensus for a symbol
   */
  static calculateConsensus(canonicalSymbol: string, exchangeData: ExchangeData[]): ConsensusSignal | null {
    if (exchangeData.length < 2) {
      console.log(
        '🔥 [HARD_LOG] [CONSENSUS_NO_SIGNAL]',
        JSON.stringify({ canonicalSymbol, reason: 'lt_2_exchanges_total', exchangesReported: exchangeData.length, ts: Date.now() }),
      );
      return null; // Need at least 2 exchanges
    }

    const longExchanges: string[] = [];
    const shortExchanges: string[] = [];
    const ignoredExchanges: Array<{ exchange: string; reason: string }> = [];

    let totalVolume = 0;
    let totalPrice = 0;
    let priceCount = 0;

    for (const data of exchangeData) {
      totalVolume += data.volume24h;
      totalPrice += data.price;
      priceCount++;

      if (data.direction === 'long') {
        longExchanges.push(data.exchange);
      } else if (data.direction === 'short') {
        shortExchanges.push(data.exchange);
      } else {
        ignoredExchanges.push({ exchange: data.exchange, reason: data.direction ? 'neutral' : 'missing_direction' });
      }
    }

    const avgPrice = totalPrice / priceCount;

    // Check for consensus (at least 2 exchanges in same direction)
    if (longExchanges.length >= 2) {
      const strengthScore = Math.min(100, (longExchanges.length / exchangeData.length) * 100);
      console.log(
        '🔥 [HARD_LOG] [CONSENSUS_DECISION]',
        JSON.stringify({
          canonicalSymbol,
          valid: true,
          direction: 'long',
          exchangesLong: longExchanges,
          exchangesShort: shortExchanges,
          exchangesIgnored: ignoredExchanges,
          strengthScore,
          reason: 'ge_2_long',
          ts: Date.now(),
        }),
      );
      return {
                canonicalSymbol,
        direction: 'long',
        exchangesConfirmed: longExchanges,
        strengthScore,
        avgPrice,
        totalVolume,
        timestamp: Date.now(),
      };
    } else if (shortExchanges.length >= 2) {
      const strengthScore = Math.min(100, (shortExchanges.length / exchangeData.length) * 100);
      console.log(
        '🔥 [HARD_LOG] [CONSENSUS_DECISION]',
        JSON.stringify({
          canonicalSymbol,
          valid: true,
          direction: 'short',
          exchangesLong: longExchanges,
          exchangesShort: shortExchanges,
          exchangesIgnored: ignoredExchanges,
          strengthScore,
          reason: 'ge_2_short',
          ts: Date.now(),
        }),
      );
      return {
                canonicalSymbol,
        direction: 'short',
        exchangesConfirmed: shortExchanges,
        strengthScore,
        avgPrice,
        totalVolume,
        timestamp: Date.now(),
      };
    }

    // HARD ASSERT: if consensus < 2 exchanges -> NO SIGNAL
    console.log(
      '🔥 [HARD_LOG] [CONSENSUS_NO_SIGNAL]',
      JSON.stringify({
        canonicalSymbol,
        reason: 'lt_2_confirming_exchanges',
        exchangesLong: longExchanges,
        exchangesShort: shortExchanges,
        exchangesIgnored: ignoredExchanges,
        ts: Date.now(),
      }),
    );
    return null; // No consensus
  }

  /**
   * Save consensus signals for a user
   */
  static async saveUserSignals(uid: string, signals: ConsensusSignal[]): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const batch = db.batch();

      console.log(
        '🔥 [HARD_LOG] [FIRESTORE_SIGNAL_WRITE_START]',
        JSON.stringify({ uid, signalCount: signals.length, ts: Date.now() }),
      );

      const writtenIds: string[] = [];

      for (const signal of signals) {
        const signalRef = db.collection('users').doc(uid).collection('crowdConsensusSignals').doc();
        writtenIds.push(signalRef.id);
        console.log(
          '🔥 [HARD_LOG] [FIRESTORE_SIGNAL_BEFORE_WRITE]',
          JSON.stringify({ uid, signalId: signalRef.id, payload: { ...signal, uid, processed: false }, ts: Date.now() }),
        );
        batch.set(signalRef, {
          ...signal,
          uid,
          processed: false,
        });
      }

      await batch.commit();
      logger.info({ uid, signalCount: signals.length }, 'Saved consensus signals for user');

      console.log(
        '🔥 [HARD_LOG] [FIRESTORE_SIGNAL_WRITE_DONE]',
        JSON.stringify({ uid, signalCount: signals.length, signalIds: writtenIds, ts: Date.now() }),
      );
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save consensus signals');
      console.log(
        '🔥 [HARD_LOG] [FIRESTORE_SIGNAL_WRITE_FAILED]',
        JSON.stringify({ uid, error: error.message, ts: Date.now() }),
      );
    }
  }

  /**
   * Get user settings
   */
  static async getUserSettings(uid: string): Promise<CrowdConsensusSettings> {
    try {
      const db = getFirebaseAdmin().firestore();
      const settingsDoc = await db.collection('users').doc(uid).collection('crowdConsensusSettings').doc('current').get();

      if (!settingsDoc.exists) {
        return this.getDefaultSettings();
      }

      return settingsDoc.data() as CrowdConsensusSettings;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user settings');
      return this.getDefaultSettings();
    }
  }

  /**
   * Save user settings
   */
  static async saveUserSettings(uid: string, settings: Partial<CrowdConsensusSettings>): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const currentSettings = await this.getUserSettings(uid);
      const updatedSettings = { ...currentSettings, ...settings };

      await db.collection('users').doc(uid).collection('crowdConsensusSettings').doc('current').set(updatedSettings);
      logger.info({ uid }, 'Updated crowd consensus settings');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save user settings');
    }
  }

  /**
   * Get default settings
   */
  static getDefaultSettings(): CrowdConsensusSettings {
    return {
              autoTradeEnabled: false,
      selectedAutoTradeExchange: '',
      riskPercent: 1,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      leverage: 1,
      maxDailyLossPercent: 5,
    };
  }

  /**
   * Get user's active signals
   */
  static async getUserSignals(uid: string, limit: number = 50): Promise<ConsensusSignal[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const signalsQuery = db.collection('users').doc(uid).collection('crowdConsensusSignals')
        .orderBy('timestamp', 'desc')
        .limit(limit);

      const snapshot = await signalsQuery.get();
      return snapshot.docs.map(doc => doc.data() as ConsensusSignal);
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get user signals');
      return [];
    }
  }

  /**
   * Mark signal as processed
   */
  static async markSignalProcessed(uid: string, signalId: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('crowdConsensusSignals').doc(signalId).update({
        processed: true,
        processedAt: new Date(),
      });
    } catch (error: any) {
      logger.error({ error: error.message, uid, signalId }, 'Failed to mark signal as processed');
    }
  }
}
