import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  // Force port to 4000 - ensure it's always correct
  port: parseInt(process.env.PORT || '4000', 10) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'change_me',
  jwtExpiry: '7d',
  
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/dlxagent',
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.BINANCE_TESTNET === 'true',
    baseUrl: process.env.BINANCE_TESTNET === 'true'
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com',
    wsUrl: process.env.BINANCE_TESTNET === 'true'
      ? 'wss://testnet.binance.vision'
      : 'wss://stream.binance.com:9443',
  },
  
  trading: {
    adversePct: parseFloat(process.env.ADVERSE_PCT || '0.0002'),
    cancelMs: parseInt(process.env.CANCEL_MS || '40', 10),
    maxPos: parseFloat(process.env.MAX_POS || '0.01'),
    binanceTestnet: process.env.BINANCE_TESTNET === 'true',
    enableLiveTrades: process.env.ENABLE_LIVE_TRADES === 'true',
    defaultAccuracyThreshold: parseFloat(process.env.DEFAULT_ACCURACY_THRESHOLD || '0.85'),
    maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '5', 10),
    riskPauseMinutes: parseInt(process.env.RISK_PAUSE_MINUTES || '30', 10),
    tradeLogRetentionDays: parseInt(process.env.TRADE_LOG_RETENTION_DAYS || '90', 10),
  },
  
  encryption: {
    algorithm: 'aes-256-gcm',
    key: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'change_me_encryption_key_32_chars!!',
  },
  
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    timeWindow: process.env.RATE_LIMIT_WINDOW || '1 minute',
  },
  
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || 'dlx-trading',
    serviceAccountKey: process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
  },

  features: {
    // All APIs are user-provided - no system APIs
  },
};

