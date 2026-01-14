import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle client');
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  let client;
  try {
    client = await getPool().connect();
    const result = await client.query(text, params);
    return result.rows;
  } catch (error) {
    console.error('[DB] Query error:', { text, params, error });
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDb(): Promise<void> {
  const pool = getPool();
  
  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      exchange VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      api_secret_encrypted TEXT NOT NULL,
      testnet BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      side VARCHAR(10) NOT NULL,
      type VARCHAR(10) NOT NULL,
      quantity DECIMAL(20, 8) NOT NULL,
      price DECIMAL(20, 8),
      status VARCHAR(20) NOT NULL,
      client_order_id VARCHAR(100) NOT NULL,
      exchange_order_id VARCHAR(100),
      filled_qty DECIMAL(20, 8) DEFAULT 0,
      avg_price DECIMAL(20, 8) DEFAULT 0,
      strategy VARCHAR(50),
      pnl DECIMAL(20, 8) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, client_order_id)
    );
  `);

  // Add strategy and pnl columns if they don't exist (for existing databases)
  await pool.query(`
    DO $$ 
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='orders' AND column_name='strategy') THEN
        ALTER TABLE orders ADD COLUMN strategy VARCHAR(50);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name='orders' AND column_name='pnl') THEN
        ALTER TABLE orders ADD COLUMN pnl DECIMAL(20, 8) DEFAULT 0;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fills (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id),
      symbol VARCHAR(20) NOT NULL,
      side VARCHAR(10) NOT NULL,
      quantity DECIMAL(20, 8) NOT NULL,
      price DECIMAL(20, 8) NOT NULL,
      fee DECIMAL(20, 8) DEFAULT 0,
      fee_asset VARCHAR(10) DEFAULT 'USDT',
      timestamp TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pnl (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      realized DECIMAL(20, 8) DEFAULT 0,
      unrealized DECIMAL(20, 8) DEFAULT 0,
      total DECIMAL(20, 8) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, date)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action VARCHAR(50) NOT NULL,
      resource VARCHAR(50),
      resource_id INTEGER,
      details JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Users table for agent approval system
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      firebase_uid VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255),
      name VARCHAR(255),
      phone VARCHAR(50),
      role VARCHAR(50) DEFAULT 'user',
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Agent approval system tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      agent_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(50),
      price DECIMAL(10, 2),
      features JSONB,
      icon VARCHAR(10),
      badge VARCHAR(50),
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_requests (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      agent_id VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
      requested_at TIMESTAMP DEFAULT NOW(),
      approved_at TIMESTAMP,
      approved_by VARCHAR(255),
      rejected_at TIMESTAMP,
      rejected_by VARCHAR(255),
      rejection_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, agent_id),
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_agents (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      agent_id VARCHAR(50) NOT NULL,
      granted_at TIMESTAMP DEFAULT NOW(),
      granted_by VARCHAR(255),
      is_active BOOLEAN DEFAULT true,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, agent_id),
      FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
    CREATE INDEX IF NOT EXISTS idx_fills_timestamp ON fills(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pnl_user_id ON pnl(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_agent_requests_user_id ON agent_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_requests_status ON agent_requests(status);
    CREATE INDEX IF NOT EXISTS idx_agent_requests_agent_id ON agent_requests(agent_id);
    CREATE INDEX IF NOT EXISTS idx_user_agents_user_id ON user_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_agents_agent_id ON user_agents(agent_id);
    CREATE INDEX IF NOT EXISTS idx_user_agents_active ON user_agents(is_active);
  `);

  // Seed agent data
  await pool.query(`
    INSERT INTO agents (agent_id, name, description, category, price, features, icon, badge)
    VALUES
      ('TRADING_AGENT',
       'Rule-Based Trading Agent',
       'Fully automated trading agent with RSI/Bollinger Bands strategy. Executes deterministic trades 24/7 with SL/TP protection.',
       'Trading Bot',
       500.00,
       '["RSI + Bollinger Bands signals", "Stop Loss & Take Profit", "BTC/USDT & ETH/USDT pairs", "Spot & Futures markets", "Daily safety limits", "Admin approval required"]',
       '📊',
       'Premium'),
      ('COPY_TRADING_AGENT',
       'Crowd Consensus Copy Trade Agent',
       'Follows crowd consensus across 10+ exchanges, trades when multiple exchanges agree on direction',
       'Copy Trading',
       600.00,
       '["Monitors 10+ exchanges for consensus signals", "Detects crowd LONG/SHORT direction", "Auto-trades on one exchange when consensus is strong", "Risk management with SL/TP", "No individual trader data accessed"]',
       '👥',
       'Advanced'),
      ('VWAP_STRATEGY',
       'VWAP Strategy',
       'Institutional-grade VWAP mean reversion scalping strategy with session filters and volatility-based risk management.',
       'Scalping Strategy',
       750.00,
       '["VWAP Mean Reversion signals", "EMA 200 Trend Filter", "ATR Volatility Stops", "BTC/USDT & ETH/USDT pairs", "London/NY Session Trading", "Admin approval required"]',
       '📈',
       'Institutional')
    ON CONFLICT (agent_id) DO NOTHING;
  `);

  logger.info('Database initialized with agent approval system');
}

