import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!pool) {
    // Check if database credentials are available
    const hasCredentials = config.database.url ||
      (config.database.host && config.database.user && config.database.password && config.database.database);

    if (!hasCredentials) {
      logger.warn('Postgres credentials missing (PGHOST, PGUSER, PGPASSWORD, PGDATABASE) — database operations unavailable');
      return null;
    }

    // Use individual PostgreSQL env vars for Render (preferred)
    // or fallback to DATABASE_URL for other providers
    const poolConfig = config.database.url ? {
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    } : {
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle client');
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const pool = getPool();
  if (!pool) {
    logger.warn({ query: text.substring(0, 100) }, 'Postgres unavailable — returning empty results');
    return [];
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(text, params);
      return result.rows;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (error.code === '28000') {
      logger.warn({ query: text.substring(0, 100), code: error.code }, 'Postgres unavailable (28000) — using default values');
      return [];
    }
    throw error;
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  if (!pool) {
    logger.warn('Postgres unavailable — transaction skipped');
    // For transactions, we can't really provide a default, so we throw
    throw new Error('Database unavailable');
  }

  try {
    const client = await pool.connect();
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
  } catch (error: any) {
    if (error.code === '28000') {
      logger.warn({ code: error.code }, 'Postgres unavailable (28000) — transaction failed');
      throw new Error('Database unavailable');
    }
    throw error;
  }
}

export async function initDb(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    logger.warn('Postgres unavailable — database initialization skipped');
    return;
  }

  try {
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

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
    CREATE INDEX IF NOT EXISTS idx_fills_timestamp ON fills(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pnl_user_id ON pnl(user_id);
  `);

    logger.info('Database initialized');
  } catch (error: any) {
    if (error.code === '28000') {
      logger.warn({ code: error.code }, 'Postgres unavailable (28000) — database initialization failed');
      return;
    }
    throw error;
  }
}

