#!/usr/bin/env node
/**
 * Historical Data Collector
 * -------------------------
 * Streams historical OHLCV, trades, orderbook snapshots, and vendor signals
 * into monthly parquet partitions under data/raw/<symbol>/YYYY-MM.parquet.
 *
 * Example:
 *   node scripts/collect_historical.js --symbol BTCUSDT --start 2024-01-01 --end 2024-01-07
 */

const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { Command } = require('commander');
const axios = require('axios').default;
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const duration = require('dayjs/plugin/duration');
const timezone = require('dayjs/plugin/timezone');
const { ParquetSchema, ParquetWriter, ParquetReader } = require('parquetjs-lite');
const crypto = require('crypto');

dayjs.extend(utc);
dayjs.extend(duration);
dayjs.extend(timezone);

const sleep = promisify(setTimeout);

require('dotenv').config({
  path: fs.existsSync(path.join(process.cwd(), '.env'))
    ? path.join(process.cwd(), '.env')
    : undefined,
});

const BINANCE_API = 'https://api.binance.com';
const BITGET_API = 'https://api.bitget.com';
const COINGLASS_API = 'https://open-api.coinglass.com/public/v2';
const CRYPTOQUANT_API = 'https://api.cryptoquant.com/v1';
const LUNARCRUSH_API = 'https://api.lunarcrush.com/v2';
const INTO_THE_BLOCK_API = 'https://api.intotheblock.com';
const NEWS_API = 'https://newsapi.org/v2';

const snapshotSchema = new ParquetSchema({
  timestamp: { type: 'INT64', logicalType: 'TIMESTAMP_MILLIS' },
  symbol: { type: 'UTF8' },
  timeframe: { type: 'UTF8' },
  exchange: { type: 'UTF8', optional: true },
  binance_open: { type: 'DOUBLE', optional: true },
  binance_high: { type: 'DOUBLE', optional: true },
  binance_low: { type: 'DOUBLE', optional: true },
  binance_close: { type: 'DOUBLE', optional: true },
  binance_volume: { type: 'DOUBLE', optional: true },
  bitget_open: { type: 'DOUBLE', optional: true },
  bitget_high: { type: 'DOUBLE', optional: true },
  bitget_low: { type: 'DOUBLE', optional: true },
  bitget_close: { type: 'DOUBLE', optional: true },
  bitget_volume: { type: 'DOUBLE', optional: true },
  orderbook_mid_price: { type: 'DOUBLE', optional: true },
  orderbook_spread: { type: 'DOUBLE', optional: true },
  orderbook_bid_volume: { type: 'DOUBLE', optional: true },
  orderbook_ask_volume: { type: 'DOUBLE', optional: true },
  orderbook_depth: { type: 'DOUBLE', optional: true },
  orderbook_snapshot_json: { type: 'UTF8', optional: true },
  taker_buy_volume: { type: 'DOUBLE', optional: true },
  taker_sell_volume: { type: 'DOUBLE', optional: true },
  taker_buy_ratio: { type: 'DOUBLE', optional: true },
  trade_count: { type: 'INT64', optional: true },
  funding_rate: { type: 'DOUBLE', optional: true },
  open_interest: { type: 'DOUBLE', optional: true },
  open_interest_change_24h: { type: 'DOUBLE', optional: true },
  liquidation_long_usd: { type: 'DOUBLE', optional: true },
  liquidation_short_usd: { type: 'DOUBLE', optional: true },
  liquidation_total_usd: { type: 'DOUBLE', optional: true },
  coin_glass_timestamp: { type: 'INT64', optional: true },
  cryptoquant_inflow: { type: 'DOUBLE', optional: true },
  cryptoquant_outflow: { type: 'DOUBLE', optional: true },
  cryptoquant_netflow: { type: 'DOUBLE', optional: true },
  lunar_sentiment: { type: 'DOUBLE', optional: true },
  lunar_social_score: { type: 'DOUBLE', optional: true },
  lunar_social_volume: { type: 'DOUBLE', optional: true },
  lunar_alt_rank: { type: 'DOUBLE', optional: true },
  news_sentiment: { type: 'DOUBLE', optional: true },
  news_mentions: { type: 'INT64', optional: true },
  news_headlines_json: { type: 'UTF8', optional: true },
  whale_large_transactions: { type: 'DOUBLE', optional: true },
  whale_exchange_inflow: { type: 'DOUBLE', optional: true },
  whale_exchange_outflow: { type: 'DOUBLE', optional: true },
  ingestion_id: { type: 'UTF8', optional: true },
  created_at: { type: 'INT64', logicalType: 'TIMESTAMP_MILLIS' },
});

const SOURCE_ENV_MAP = {
  coinglass: process.env.COINGLASS_KEY || process.env.COINGLASS_API_KEY,
  cryptoquant: process.env.CRYPTOQUANT_KEY || process.env.CRYPTOQUANT_API_KEY,
  lunarcrush: process.env.LUNARCRUSH_KEY || process.env.LUNARCRUSH_API_KEY,
  intotheblock: process.env.INTO_THE_BLOCK_KEY || process.env.INTO_THE_BLOCK_API_KEY,
  newsapi: process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY,
  binanceKey: process.env.BINANCE_APIKEY || process.env.BINANCE_API_KEY,
  binanceSecret: process.env.BINANCE_APISECRET || process.env.BINANCE_API_SECRET,
  bitgetKey: process.env.BITGET_APIKEY || process.env.BITGET_API_KEY,
  bitgetSecret: process.env.BITGET_APISECRET || process.env.BITGET_API_SECRET,
};

const program = new Command();
program
  .requiredOption('--symbol <symbol>', 'Trading symbol, e.g. BTCUSDT')
  .requiredOption('--start <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end <date>', 'End date (YYYY-MM-DD)')
  .option('--timeframe <tf>', 'Timeframe (default 1m)', '1m')
  .option('--output <dir>', 'Output base directory', path.join(process.cwd(), 'data', 'raw'))
  .option('--chunk <minutes>', 'Chunk size in minutes per download', '1000')
  .option('--max-klines <count>', 'Max klines per API call (<=1000)', '1000')
  .option('--with-orderbook', 'Also capture live orderbook snapshots for the duration of the run', false)
  .option('--orderbook-duration <seconds>', 'Live orderbook capture duration (defaults to span between start/end, capped at 3600)', '0')
  .option('--verbose', 'Enable verbose logging', false)
  .parse(process.argv);

const options = program.opts();

function log(msg, meta = {}) {
  if (options.verbose) {
    console.log(`[collector] ${msg}`, meta);
  } else {
    console.log(`[collector] ${msg}`);
  }
}

async function retryable(fn, label, retries = 3, delayMs = 500) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries) {
        throw err;
      }
      const backoff = delayMs * attempt;
      log(`Retrying ${label} in ${backoff}ms (${attempt}/${retries})`);
      await sleep(backoff);
    }
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function fetchBinanceKlines(symbol, interval, startMs, endMs, limit = 1000) {
  const results = [];
  let fetchStart = startMs;
  while (fetchStart <= endMs) {
    const resp = await retryable(async () => {
      return axios.get(`${BINANCE_API}/api/v3/klines`, {
        params: {
          symbol,
          interval,
          startTime: fetchStart,
          endTime: Math.min(fetchStart + limit * 60_000, endMs),
          limit,
        },
        timeout: 10000,
      });
    }, 'binance-klines');
    const candles = resp.data || [];
    if (!candles.length) break;
    candles.forEach((candle) => {
      results.push({
        timestamp: Number(candle[0]),
        open: Number(candle[1]),
        high: Number(candle[2]),
        low: Number(candle[3]),
        close: Number(candle[4]),
        volume: Number(candle[5]),
        trades: Number(candle[8]),
      });
    });
    const last = candles[candles.length - 1];
    fetchStart = Number(last[0]) + 60_000;
    if (candles.length < limit) {
      break;
    }
    await sleep(200); // respect rate limits
  }
  return results;
}

async function fetchBitgetKlines(symbol, startMs, endMs) {
  const granularity = 60; // seconds
  const results = [];
  let cursor = Math.floor(startMs / 1000);
  while (cursor * 1000 <= endMs) {
    const resp = await retryable(async () => {
      return axios.get(`${BITGET_API}/api/v2/spot/market/candles`, {
        params: {
          symbol,
          granularity,
          limit: 500,
          startTime: cursor,
          endTime: Math.min(cursor + granularity * 500, Math.floor(endMs / 1000)),
        },
        timeout: 10000,
      });
    }, 'bitget-klines');
    const candles = resp.data?.data || [];
    if (!candles.length) break;
    candles.forEach((candle) => {
      const [ts, open, high, low, close, volume] = candle;
      results.push({
        timestamp: Number(ts) * 1000,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      });
    });
    cursor = Number(candles[candles.length - 1][0]) + granularity;
    if (candles.length < 500) {
      break;
    }
    await sleep(250);
  }
  return results;
}

async function fetchAggTrades(symbol, startMs, endMs) {
  const resp = await retryable(async () => {
    return axios.get(`${BINANCE_API}/api/v3/aggTrades`, {
      params: {
        symbol,
        startTime: startMs,
        endTime: endMs,
        limit: 1000,
      },
      timeout: 10000,
    });
  }, 'binance-aggTrades');
  const trades = resp.data || [];
  let takerBuyVolume = 0;
  let takerSellVolume = 0;
  trades.forEach((trade) => {
    const qty = Number(trade.q);
    if (trade.m) {
      // buyer is maker -> seller initiated
      takerSellVolume += qty;
    } else {
      takerBuyVolume += qty;
    }
  });
  return {
    takerBuyVolume,
    takerSellVolume,
    tradeCount: trades.length,
  };
}

async function fetchOrderbookSnapshot(symbol) {
  const resp = await retryable(async () => {
    return axios.get(`${BINANCE_API}/api/v3/depth`, {
      params: { symbol, limit: 10 },
      timeout: 7500,
    });
  }, 'binance-depth');
  const bids = resp.data?.bids || [];
  const asks = resp.data?.asks || [];
  const bestBid = bids.length ? Number(bids[0][0]) : 0;
  const bestAsk = asks.length ? Number(asks[0][0]) : 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const bidVol = bids.reduce((sum, [_, qty]) => sum + Number(qty), 0);
  const askVol = asks.reduce((sum, [_, qty]) => sum + Number(qty), 0);
  const depth = Math.min(bidVol, askVol);
  return {
    midPrice: bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0,
    spread,
    bidVolume: bidVol,
    askVolume: askVol,
    depth,
    snapshot: JSON.stringify({ bids, asks }),
  };
}

async function fetchCoinGlass(symbol) {
  if (!SOURCE_ENV_MAP.coinglass) return {};
  const headers = { coinglassSecret: SOURCE_ENV_MAP.coinglass };
  const baseSymbol = symbol.replace(/USDT|USD/gi, '');
  const [fundingResp, liquidationResp, oiResp] = await Promise.allSettled([
    axios.get(`${COINGLASS_API}/funding-rate`, {
      params: { symbol: baseSymbol, type: 'futures' },
      headers,
      timeout: 10000,
    }),
    axios.get(`${COINGLASS_API}/liquidation`, {
      params: { symbol: baseSymbol, timeType: '24h' },
      headers,
      timeout: 10000,
    }),
    axios.get(`${COINGLASS_API}/open-interest`, {
      params: { symbol: baseSymbol },
      headers,
      timeout: 10000,
    }),
  ]);
  const fundingData = fundingResp.status === 'fulfilled' ? fundingResp.value.data?.data?.[0] : null;
  const liquidationData = liquidationResp.status === 'fulfilled' ? liquidationResp.value.data?.data : null;
  const oiData = oiResp.status === 'fulfilled' ? oiResp.value.data?.data?.[0] : null;
  return {
    funding_rate: fundingData?.fundingRate ? Number(fundingData.fundingRate) : null,
    open_interest: fundingData?.openInterest ? Number(fundingData.openInterest) : oiData?.openInterest,
    open_interest_change_24h: fundingData?.openInterestChange24h
      ? Number(fundingData.openInterestChange24h)
      : oiData?.change24h
      ? Number(oiData.change24h)
      : null,
    liquidation_long: liquidationData?.longLiquidation ? Number(liquidationData.longLiquidation) : null,
    liquidation_short: liquidationData?.shortLiquidation ? Number(liquidationData.shortLiquidation) : null,
    liquidation_total: liquidationData?.totalLiquidation ? Number(liquidationData.totalLiquidation) : null,
    timestamp: Date.now(),
  };
}

async function fetchCryptoQuant(symbol) {
  if (!SOURCE_ENV_MAP.cryptoquant) return {};
  const resp = await retryable(async () => {
    return axios.get(`${CRYPTOQUANT_API}/exchange-flows/coin/${symbol}`, {
      headers: { Authorization: `Bearer ${SOURCE_ENV_MAP.cryptoquant}` },
      timeout: 10000,
    });
  }, 'cryptoquant');
  const data = resp.data?.result || {};
  return {
    inflow: data.inflow || null,
    outflow: data.outflow || null,
    netflow: data.netflow || null,
  };
}

async function fetchLunarCrush(symbol) {
  if (!SOURCE_ENV_MAP.lunarcrush) return {};
  const coin = symbol.replace(/USDT|USD/gi, '');
  const resp = await retryable(async () => {
    return axios.get(`${LUNARCRUSH_API}/assets/coin`, {
      params: { key: SOURCE_ENV_MAP.lunarcrush, symbol: coin, data_points: 1 },
      timeout: 10000,
    });
  }, 'lunarcrush');
  const data = resp.data?.data?.[0] || {};
  return {
    sentiment: data.sentiment || 0,
    social_score: data.social_score || 0,
    social_volume: data.social_volume || 0,
    alt_rank: data.alt_rank || 0,
  };
}

async function fetchIntoTheBlock(symbol) {
  if (!SOURCE_ENV_MAP.intotheblock) return {};
  const coin = symbol.replace(/USDT|USD/gi, '').toLowerCase();
  const headers = { 'X-API-Key': SOURCE_ENV_MAP.intotheblock };
  const [transactionsResp, flowsResp] = await Promise.allSettled([
    axios.get(`${INTO_THE_BLOCK_API}/coins/${coin}/transactions/large`, {
      params: { timeFrame: '24h' },
      headers,
      timeout: 10000,
    }),
    axios.get(`${INTO_THE_BLOCK_API}/coins/${coin}/flows/exchange`, {
      params: { timeFrame: '24h' },
      headers,
      timeout: 10000,
    }),
  ]);
  const txData = transactionsResp.status === 'fulfilled' ? transactionsResp.value.data?.data : null;
  const flowData = flowsResp.status === 'fulfilled' ? flowsResp.value.data?.data : null;
  return {
    largeTransactions: txData?.count || null,
    exchangeInflow: flowData?.inflow ? Number(flowData.inflow) : null,
    exchangeOutflow: flowData?.outflow ? Number(flowData.outflow) : null,
  };
}

async function fetchNewsSentiment(symbol) {
  if (!SOURCE_ENV_MAP.newsapi) return {};
  const base = symbol.replace(/USDT|USD/gi, '');
  const resp = await retryable(async () => {
    return axios.get(`${NEWS_API}/everything`, {
      params: {
        q: `${base} OR bitcoin OR crypto`,
        apiKey: SOURCE_ENV_MAP.newsapi,
        sortBy: 'publishedAt',
        language: 'en',
        pageSize: 20,
      },
      timeout: 10000,
    });
  }, 'newsapi');
  const articles = resp.data?.articles || [];
  const sentiment = computeSentiment(articles);
  return {
    sentiment,
    mentionCount: articles.length,
    headlinesJson: JSON.stringify(
      articles.map((a) => ({
        title: a.title,
        description: a.description,
        source: a.source?.name || 'unknown',
        url: a.url,
        publishedAt: a.publishedAt,
      }))
    ),
  };
}

const POSITIVE_WORDS = ['bullish', 'surge', 'rally', 'gain', 'uptrend', 'pump', 'moon', 'breakout'];
const NEGATIVE_WORDS = ['bearish', 'crash', 'dump', 'selloff', 'sell-off', 'plunge', 'drop', 'collapse'];

function computeSentiment(articles) {
  const text = articles.map((a) => `${a.title || ''} ${a.description || ''}`).join(' ').toLowerCase();
  const pos = POSITIVE_WORDS.reduce((acc, word) => acc + (text.match(new RegExp(word, 'g')) || []).length, 0);
  const neg = NEGATIVE_WORDS.reduce((acc, word) => acc + (text.match(new RegExp(word, 'g')) || []).length, 0);
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

function normalizeSeries(series) {
  const map = new Map();
  series.forEach((row) => {
    map.set(row.timestamp, row);
  });
  return map;
}

function mergeSnapshots(binance, bitget, tradeMetrics, metadata) {
  const result = [];
  const binanceMap = normalizeSeries(binance);
  const bitgetMap = normalizeSeries(bitget);
  const timestamps = Array.from(new Set([...binanceMap.keys(), ...bitgetMap.keys()])).sort((a, b) => a - b);
  timestamps.forEach((ts) => {
    const candle = binanceMap.get(ts) || {};
    const bitgetCandle = bitgetMap.get(ts) || {};
    const trades = tradeMetrics.get(ts) || {};
    result.push({
      timestamp: ts,
      symbol: metadata.symbol,
      timeframe: metadata.timeframe,
      exchange: 'binance',
      binance_open: candle.open || null,
      binance_high: candle.high || null,
      binance_low: candle.low || null,
      binance_close: candle.close || null,
      binance_volume: candle.volume || null,
      bitget_open: bitgetCandle.open || null,
      bitget_high: bitgetCandle.high || null,
      bitget_low: bitgetCandle.low || null,
      bitget_close: bitgetCandle.close || null,
      bitget_volume: bitgetCandle.volume || null,
      taker_buy_volume: trades.takerBuyVolume || null,
      taker_sell_volume: trades.takerSellVolume || null,
      taker_buy_ratio:
        trades.takerBuyVolume || trades.takerSellVolume
          ? (trades.takerBuyVolume || 0) / Math.max(1, (trades.takerBuyVolume || 0) + (trades.takerSellVolume || 0))
          : null,
      trade_count: trades.tradeCount || null,
    });
  });
  return result;
}

async function enrichSnapshots(rows) {
  const [orderbook, coinGlass, cryptoQuant, lunar, whale, news] = await Promise.all([
    fetchOrderbookSnapshot(options.symbol).catch(() => ({})),
    fetchCoinGlass(options.symbol).catch(() => ({})),
    fetchCryptoQuant(options.symbol).catch(() => ({})),
    fetchLunarCrush(options.symbol).catch(() => ({})),
    fetchIntoTheBlock(options.symbol).catch(() => ({})),
    fetchNewsSentiment(options.symbol).catch(() => ({})),
  ]);
  const ingestionId = crypto.randomUUID();
  const enriched = rows.map((row) => ({
    ...row,
    orderbook_mid_price: orderbook.midPrice || null,
    orderbook_spread: orderbook.spread || null,
    orderbook_bid_volume: orderbook.bidVolume || null,
    orderbook_ask_volume: orderbook.askVolume || null,
    orderbook_depth: orderbook.depth || null,
    orderbook_snapshot_json: orderbook.snapshot || null,
    funding_rate: coinGlass.funding_rate ?? null,
    open_interest: coinGlass.open_interest ?? null,
    open_interest_change_24h: coinGlass.open_interest_change_24h ?? null,
    liquidation_long_usd: coinGlass.liquidation_long ?? null,
    liquidation_short_usd: coinGlass.liquidation_short ?? null,
    liquidation_total_usd: coinGlass.liquidation_total ?? null,
    coin_glass_timestamp: coinGlass.timestamp ?? null,
    cryptoquant_inflow: cryptoQuant.inflow ?? null,
    cryptoquant_outflow: cryptoQuant.outflow ?? null,
    cryptoquant_netflow: cryptoQuant.netflow ?? null,
    lunar_sentiment: lunar.sentiment ?? null,
    lunar_social_score: lunar.social_score ?? null,
    lunar_social_volume: lunar.social_volume ?? null,
    lunar_alt_rank: lunar.alt_rank ?? null,
    news_sentiment: news.sentiment ?? null,
    news_mentions: news.mentionCount ?? null,
    news_headlines_json: news.headlinesJson ?? null,
    whale_large_transactions: whale.largeTransactions ?? null,
    whale_exchange_inflow: whale.exchangeInflow ?? null,
    whale_exchange_outflow: whale.exchangeOutflow ?? null,
    ingestion_id: ingestionId,
    created_at: Date.now(),
  }));
  return enriched;
}

function groupByMonth(rows) {
  return rows.reduce((acc, row) => {
    const month = dayjs(row.timestamp).utc().format('YYYY-MM');
    if (!acc.has(month)) {
      acc.set(month, []);
    }
    acc.get(month).push(row);
    return acc;
  }, new Map());
}

async function readExistingParquet(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const reader = await ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const rows = [];
  let record = null;
  while ((record = await cursor.next())) {
    rows.push(record);
  }
  await reader.close();
  return rows;
}

async function writePartition(symbol, month, rows, baseDir) {
  const dir = path.join(baseDir, symbol);
  ensureDir(dir);
  const filePath = path.join(dir, `${month}.parquet`);
  const existing = await readExistingParquet(filePath);
  const allRows = [...existing];
  rows.forEach((row) => {
    const idx = allRows.findIndex((existingRow) => existingRow.timestamp === row.timestamp);
    if (idx >= 0) {
      allRows[idx] = row;
    } else {
      allRows.push(row);
    }
  });
  allRows.sort((a, b) => a.timestamp - b.timestamp);
  const writer = await ParquetWriter.openFile(snapshotSchema, filePath);
  for (const row of allRows) {
    await writer.appendRow(row);
  }
  await writer.close();
  return filePath;
}

async function main() {
  const symbol = options.symbol.toUpperCase();
  const start = dayjs.utc(options.start, 'YYYY-MM-DD');
  const end = dayjs.utc(options.end, 'YYYY-MM-DD').endOf('day');
  if (!start.isValid() || !end.isValid()) {
    throw new Error('Invalid start or end date. Use YYYY-MM-DD.');
  }
  if (end.isBefore(start)) {
    throw new Error('End date must be after start date');
  }
  const startMs = start.valueOf();
  const endMs = end.valueOf();
  log(`Collecting ${symbol} data from ${start.format()} to ${end.format()}`);

  const binanceKlines = await fetchBinanceKlines(symbol, options.timeframe, startMs, endMs, Number(options.maxKlines || 1000));
  log(`Fetched ${binanceKlines.length} Binance candles`);
  const bitgetKlines = await fetchBitgetKlines(symbol, startMs, endMs);
  log(`Fetched ${bitgetKlines.length} Bitget candles`);

  const tradeMetrics = new Map();
  for (const candle of binanceKlines) {
    const trades = await fetchAggTrades(symbol, candle.timestamp, candle.timestamp + 60_000);
    tradeMetrics.set(candle.timestamp, trades);
    await sleep(100);
  }

  const merged = mergeSnapshots(binanceKlines, bitgetKlines, tradeMetrics, { symbol, timeframe: options.timeframe });
  const enriched = await enrichSnapshots(merged);
  const grouped = groupByMonth(enriched);
  const writtenFiles = [];
  for (const [month, rows] of grouped.entries()) {
    const file = await writePartition(symbol, month, rows, options.output);
    writtenFiles.push(file);
    log(`Wrote ${rows.length} rows to ${file}`);
  }

  // Optional live orderbook capture
  let liveSummary = null;
  if (options.withOrderbook) {
    const durationSeconds =
      Number(options.orderbookDuration) > 0
        ? Number(options.orderbookDuration)
        : Math.min(3600, Math.max(60, Math.floor((endMs - startMs) / 1000)));
    liveSummary = await captureLiveOrderbook(symbol, durationSeconds);
    log(`Captured ${liveSummary.snapshots} live orderbook frames over ${durationSeconds}s`);
  }

  console.log(
    JSON.stringify(
      {
        symbol,
        timeframe: options.timeframe,
        rows: enriched.length,
        partitions: writtenFiles,
        liveOrderbook: liveSummary,
      },
      null,
      2
    )
  );
}

async function captureLiveOrderbook(symbol, durationSeconds) {
  const snapshots = [];
  const start = Date.now();
  while (Date.now() - start < durationSeconds * 1000) {
    const snapshot = await fetchOrderbookSnapshot(symbol).catch(() => null);
    if (snapshot) {
      snapshots.push({
        timestamp: Date.now(),
        ...snapshot,
      });
    }
    await sleep(5000);
  }
  const month = dayjs().utc().format('YYYY-MM');
  const symbolDir = path.join(options.output, symbol);
  ensureDir(symbolDir);
  const liveFile = path.join(symbolDir, `${month}-orderbook-live.jsonl`);
  const stream = fs.createWriteStream(liveFile, { flags: 'a' });
  snapshots.forEach((snap) => {
    stream.write(`${JSON.stringify(snap)}\n`);
  });
  stream.end();
  return { snapshots: snapshots.length, file: liveFile };
}

main().catch((err) => {
  console.error('[collector] Failed to collect historical data', err.message);
  process.exit(1);
});


