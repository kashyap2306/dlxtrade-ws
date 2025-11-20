#!/usr/bin/env node
/**
 * Integration harness that executes the Python backtester and asserts model precision.
 *
 * Usage:
 *   npm run test:replay -- --symbol BTCUSDT --days 7
 */

const path = require('path');
const { spawn } = require('child_process');
const { Command } = require('commander');

const program = new Command();
program
  .option('--symbol <symbol>', 'Symbol to backtest', 'BTCUSDT')
  .option('--timeframe <tf>', 'Dataset timeframe', '5m')
  .option('--horizon <tf>', 'Prediction horizon', '15m')
  .option('--days <number>', 'Number of trailing days', '7')
  .option('--assert-precision <float>', 'Precision threshold', '0.8')
  .option('--model-path <path>', 'Model bundle path', path.join('ml-service', 'models', 'latest', 'model_bundle.joblib'))
  .option('--data-path <path>', 'Labeled dataset path', path.join('..', 'data', 'labeled'))
  .option('--synthetic', 'Force synthetic dataset', false)
  .allowExcessArguments(false)
  .parse(process.argv);

const opts = program.opts();
const repoRoot = path.resolve(__dirname, '..');

const args = [
  path.join('ml-service', 'backtest.py'),
  '--symbol', opts.symbol,
  '--timeframe', opts.timeframe,
  '--horizon', opts.horizon,
  '--days', String(opts.days),
  '--model-path', opts.modelPath,
  '--data-path', opts.dataPath,
  '--assert-precision', String(opts.assertPrecision),
];

if (opts.synthetic) {
  args.push('--synthetic');
}

const subprocess = spawn('python', args, {
  cwd: repoRoot,
  stdio: 'inherit',
});

subprocess.on('close', (code) => {
  if (code !== 0) {
    process.exit(code);
  }
});

