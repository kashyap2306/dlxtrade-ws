#!/usr/bin/env node
/**
 * Label Dataset Script
 * --------------------
 * Transforms raw parquet snapshots into supervised training samples with BUY/SELL/HOLD labels.
 *
 * Usage:
 *  node scripts/label_dataset.js --symbol BTCUSDT --timeframe 5m --horizon 15m
 */

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const { ParquetReader, ParquetWriter, ParquetSchema } = require('parquetjs-lite');

dayjs.extend(utc);

const program = new Command();
program
  .requiredOption('--symbol <symbol>', 'Symbol to label (e.g., BTCUSDT)')
  .option('--timeframe <tf>', 'Source timeframe (default 1m)', '1m')
  .option('--horizon <tf>', 'Prediction horizon (default 15m)', '15m')
  .option('--sl <percent>', 'Stop loss percent (e.g., 0.02 for 2%)', '0.02')
  .option('--tp <percent>', 'Take profit percent (e.g., 0.03 for 3%)', '0.03')
  .option('--input <dir>', 'Raw data directory', path.join(process.cwd(), 'data', 'raw'))
  .option('--output <dir>', 'Labeled output directory', path.join(process.cwd(), 'data', 'labeled'))
  .option('--limit <rows>', 'Limit number of rows (debug only)', '0')
  .parse(process.argv);

const options = program.opts();

const labeledSchema = new ParquetSchema({
  timestamp: { type: 'INT64', logicalType: 'TIMESTAMP_MILLIS' },
  symbol: { type: 'UTF8' },
  timeframe: { type: 'UTF8' },
  horizon_minutes: { type: 'INT64' },
  binance_close: { type: 'DOUBLE', optional: true },
  binance_volume: { type: 'DOUBLE', optional: true },
  bitget_close: { type: 'DOUBLE', optional: true },
  taker_buy_volume: { type: 'DOUBLE', optional: true },
  taker_sell_volume: { type: 'DOUBLE', optional: true },
  orderbook_mid_price: { type: 'DOUBLE', optional: true },
  orderbook_spread: { type: 'DOUBLE', optional: true },
  funding_rate: { type: 'DOUBLE', optional: true },
  open_interest: { type: 'DOUBLE', optional: true },
  lunar_sentiment: { type: 'DOUBLE', optional: true },
  news_sentiment: { type: 'DOUBLE', optional: true },
  whale_large_transactions: { type: 'DOUBLE', optional: true },
  label: { type: 'UTF8' },
  max_future_return: { type: 'DOUBLE' },
  min_future_return: { type: 'DOUBLE' },
  hit_tp_flag: { type: 'BOOLEAN' },
  hit_sl_flag: { type: 'BOOLEAN' },
  ingestion_id: { type: 'UTF8', optional: true },
});

const TIMEFRAME_TO_MINUTES = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '1d': 1440,
};

function parseMinutes(value) {
  if (!value) return 0;
  const lower = value.toLowerCase().trim();
  if (TIMEFRAME_TO_MINUTES[lower]) {
    return TIMEFRAME_TO_MINUTES[lower];
  }
  const match = lower.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Unable to parse timeframe: ${value}`);
  }
  const qty = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return qty;
  if (unit === 'h') return qty * 60;
  if (unit === 'd') return qty * 1440;
  return qty;
}

async function loadRawRows(symbol, timeframe, rawDir, limit) {
  const dir = path.join(rawDir, symbol);
  if (!fs.existsSync(dir)) {
    throw new Error(`Raw data directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.parquet'))
    .sort();
  const rows = [];
  for (const file of files) {
    const reader = await ParquetReader.openFile(path.join(dir, file));
    const cursor = reader.getCursor();
    let record = null;
    while ((record = await cursor.next())) {
      if (record.timeframe?.toLowerCase() === timeframe.toLowerCase()) {
        rows.push(record);
      }
      if (limit > 0 && rows.length >= limit) {
        break;
      }
    }
    await reader.close();
    if (limit > 0 && rows.length >= limit) {
      break;
    }
  }
  rows.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return rows;
}

function labelRows(rows, options) {
  const timeframeMinutes = parseMinutes(options.timeframe);
  const horizonMinutes = parseMinutes(options.horizon);
  const steps = Math.max(1, Math.round(horizonMinutes / timeframeMinutes));
  const sl = Number(options.sl);
  const tp = Number(options.tp);
  const labeled = [];

  for (let i = 0; i < rows.length - steps; i += 1) {
    const row = rows[i];
    const entryPrice = Number(row.binance_close || row.bitget_close);
    if (!entryPrice || entryPrice <= 0) continue;
    const future = rows.slice(i + 1, i + 1 + steps);
    if (!future.length) continue;
    const futureHigh = Math.max(...future.map((f) => Number(f.binance_close || f.bitget_close || entryPrice)));
    const futureLow = Math.min(...future.map((f) => Number(f.binance_close || f.bitget_close || entryPrice)));
    const maxReturn = (futureHigh - entryPrice) / entryPrice;
    const minReturn = (futureLow - entryPrice) / entryPrice;
    const hitTP = maxReturn >= tp;
    const hitSL = minReturn <= -sl;
    let label = 'HOLD';
    if (hitTP && !hitSL) {
      label = 'BUY';
    } else if (hitSL && !hitTP) {
      label = 'SELL';
    } else if (hitTP && hitSL) {
      label = maxReturn > Math.abs(minReturn) ? 'BUY' : 'SELL';
    }
    labeled.push({
      timestamp: row.timestamp,
      symbol: row.symbol,
      timeframe: row.timeframe,
      horizon_minutes: horizonMinutes,
      binance_close: row.binance_close ?? null,
      binance_volume: row.binance_volume ?? null,
      bitget_close: row.bitget_close ?? null,
      taker_buy_volume: row.taker_buy_volume ?? null,
      taker_sell_volume: row.taker_sell_volume ?? null,
      orderbook_mid_price: row.orderbook_mid_price ?? null,
      orderbook_spread: row.orderbook_spread ?? null,
      funding_rate: row.funding_rate ?? null,
      open_interest: row.open_interest ?? null,
      lunar_sentiment: row.lunar_sentiment ?? null,
      news_sentiment: row.news_sentiment ?? null,
      whale_large_transactions: row.whale_large_transactions ?? null,
      label,
      max_future_return: maxReturn,
      min_future_return: minReturn,
      hit_tp_flag: hitTP,
      hit_sl_flag: hitSL,
      ingestion_id: row.ingestion_id ?? null,
    });
  }
  return labeled;
}

async function writeLabeledRows(symbol, timeframe, horizon, rows, outDir) {
  const symbolDir = path.join(outDir, symbol);
  if (!fs.existsSync(symbolDir)) {
    fs.mkdirSync(symbolDir, { recursive: true });
  }
  const fileName = `${symbol}_${timeframe}_${horizon}.parquet`;
  const filePath = path.join(symbolDir, fileName);
  const writer = await ParquetWriter.openFile(labeledSchema, filePath);
  for (const row of rows) {
    await writer.appendRow(row);
  }
  await writer.close();
  return filePath;
}

async function main() {
  const symbol = options.symbol.toUpperCase();
  const limit = Number(options.limit) || 0;
  const rawRows = await loadRawRows(symbol, options.timeframe, options.input, limit);
  if (!rawRows.length) {
    throw new Error(`No raw rows found for ${symbol} @ ${options.timeframe}`);
  }
  const labeledRows = labelRows(rawRows, options);
  if (!labeledRows.length) {
    throw new Error('Unable to generate labeled samples. Check horizon/timeframe/window settings.');
  }
  const file = await writeLabeledRows(symbol, options.timeframe, options.horizon, labeledRows, options.output);
  console.log(
    JSON.stringify(
      {
        symbol,
        timeframe: options.timeframe,
        horizon: options.horizon,
        samples: labeledRows.length,
        output: file,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('[labeler] Failed to label dataset', err.message);
  process.exit(1);
});


