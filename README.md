<<<<<<< HEAD
<<<<<<< HEAD
# DLXTRADE Backend

Fastify-based backend API for the HFT trading agent.

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Environment Variables

See root `.env.example` for all required variables.

## Database

Postgres is used for persistent storage:
- Orders and fills
- PnL history
- Audit logs
- API keys (encrypted)

## Redis

Redis is used for:
- Transient order state
- Rate limiting
- WebSocket connection state

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with credentials
- `POST /api/auth/refresh` - Refresh JWT token

### Admin
- `GET /api/admin/keys` - List API keys (masked)
- `POST /api/admin/keys` - Add new API key
- `PUT /api/admin/keys/:id` - Update API key
- `DELETE /api/admin/keys/:id` - Delete API key
- `POST /api/admin/toggle-testnet` - Switch testnet/live mode

### Orders
- `GET /api/orders` - List orders with filters
- `POST /api/orders` - Place manual order
- `DELETE /api/orders/:id` - Cancel order
- `GET /api/orders/:id` - Get order status

### Engine
- `POST /api/engine/start` - Start quoting engine
- `POST /api/engine/stop` - Stop quoting engine
- `GET /api/engine/status` - Get engine status
- `PUT /api/engine/config` - Update engine config

### Metrics
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

## WebSocket

Connect to `/ws` for real-time updates:
- Order updates
- Fill notifications
- Market data
- Engine status changes
=======
# DLXTRADE - Market-Making HFT Trading Agent

A full-stack high-frequency trading (HFT) market-making agent built with React + TypeScript (frontend) and Node.js + Fastify (backend). Supports Binance Testnet initially, with extensible architecture for additional exchanges.

## Features

- **Real-time Market Data**: WebSocket connections for L2 orderbook, trades, and user data streams
- **Market Making Engine**: Automated quoting with adverse selection protection and inventory control
- **Order Management**: Full lifecycle tracking with Postgres persistence
- **Risk Management**: Circuit breakers, PnL guards, drawdown limits, and manual controls
- **Backtesting**: Support for historical data ingestion (CoinAPI/Kaiko format)
- **Admin Dashboard**: Secure web interface for monitoring and control
- **Docker Support**: Complete containerization for easy deployment

## Prerequisites

- Node.js v20+
- pnpm (or npm)
- Docker & Docker Compose
- Postgres 14+
- Redis 6+

## Quick Start

### 1. Clone and Install

```bash
# Install dependencies
pnpm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# At minimum, set:
# - JWT_SECRET (use a strong random string)
# - DATABASE_URL
# - REDIS_URL
# - BINANCE_API_KEY (for testnet)
# - BINANCE_API_SECRET (for testnet)
```

### 3. Database Setup

```bash
# Start Postgres and Redis via Docker Compose
docker compose -f infra/docker-compose.yml up -d postgres redis

# Run migrations (when available)
# pnpm --filter backend migrate
```

### 4. Run Locally

**Option A: Docker Compose (Recommended)**
```bash
docker compose -f infra/docker-compose.yml up --build
```

**Option B: Development Mode**
```bash
# Terminal 1: Backend
pnpm --filter backend dev

# Terminal 2: Frontend
pnpm --filter frontend dev
```

### 5. Access

- Frontend: http://localhost:5173
- Backend API: http://localhost:4000
- Health Check: http://localhost:4000/health
- Metrics: http://localhost:4000/metrics

## Project Structure

```
DLXTRADE/
├── backend/          # Node.js + Fastify backend
│   ├── src/
│   │   ├── server.ts
│   │   ├── app.ts
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db/
│   │   ├── workers/
│   │   ├── utils/
│   │   ├── config/
│   │   └── types/
│   ├── Dockerfile
│   └── package.json
├── frontend/         # React + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   └── styles/
│   ├── Dockerfile
│   └── package.json
├── infra/            # Infrastructure configs
│   ├── docker-compose.yml
│   └── prometheus.yml
├── scripts/          # Utility scripts
└── README.md
```

## Configuration

### Trading Parameters

- `ADVERSE_PCT`: Maximum price movement before canceling quotes (default: 0.0002 = 0.02%)
- `CANCEL_MS`: Time window for adverse selection check (default: 40ms)
- `MAX_POS`: Maximum position size (default: 0.01 BTC)

### API Keys

API keys are encrypted at rest. Use the frontend dashboard to:
- Add new API keys (encrypted automatically)
- View masked keys (e.g., `pk_****abcd`)
- Rotate/update keys
- Delete keys

**Security Note**: Never expose raw API keys. The backend handles all encryption/decryption.

## Testing

### Unit Tests
```bash
pnpm --filter backend test
pnpm --filter frontend test
```

### Integration Tests
```bash
# Start services
docker compose -f infra/docker-compose.yml up -d

# Run tests
pnpm test
```

## Backtesting

1. Place L2 snapshot files in `./data/` directory (CoinAPI/Kaiko format)
2. Use the Backtest Runner UI in the frontend
3. Upload a snapshot file to simulate historical trading

## Switching to Live Trading

⚠️ **WARNING**: Live trading uses real money. Always test thoroughly on testnet first.

1. Set `BINANCE_TESTNET=false` in `.env`
2. Update API keys to production keys via dashboard
3. Confirm the switch in the UI (requires confirmation modal)
4. Start the engine with caution

## Development

### Backend Development
```bash
cd backend
pnpm dev  # Runs with ts-node-dev (hot reload)
```

### Frontend Development
```bash
cd frontend
pnpm dev  # Runs Vite dev server
```

### Code Quality
```bash
# Lint
pnpm lint

# Type check
pnpm typecheck

# Format
pnpm format
```

## Monitoring

- **Health**: `/health` endpoint
- **Metrics**: `/metrics` (Prometheus format)
- **Logs**: Structured JSON logs to stdout

## Security

- API keys encrypted at rest using AES-256
- JWT authentication for admin API
- Rate limiting on exchange REST endpoints
- Circuit breakers for risk management
- Input validation with Zod schemas

## License

MIT

## Support

For issues and questions, please open an issue on the repository.
>>>>>>> b4476dcf22ec0e83dc111e48f579663038997936
=======
# DLXTRADE Backend (dlxtrade-ws)

Fastify-based backend API and WebSocket server for DLXTRADE trading platform.

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20
- PostgreSQL database
- Firebase project with service account

### Installation

```bash
npm install
```

### Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your environment variables in `.env`

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Production

```bash
npm start
```

## 📦 Deployment to Render

### Build Command:
```bash
npm install && npm run build
```

### Start Command:
```bash
npm start
```

### Required Environment Variables on Render:
- `FIREBASE_SERVICE_ACCOUNT` - Full JSON service account (single line)
- `FIREBASE_PROJECT_ID` - Firebase project ID (e.g., `dlx-trading`)
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Automatically set by Render (don't set manually)
- `NODE_ENV` - Set to `production`

### Optional Environment Variables:
- `JWT_SECRET` - Secret key for JWT tokens
- `ENCRYPTION_KEY` - Encryption key (32+ characters)
- `BINANCE_API_KEY` - Binance API key (if using live trading)
- `BINANCE_API_SECRET` - Binance API secret
- `BINANCE_TESTNET` - Set to `true` for testnet
- `ENABLE_LIVE_TRADES` - Set to `true` to enable live trading

## 📁 Project Structure

```
dlxtrade-ws/
├── src/
│   ├── config/          # Configuration
│   ├── db/              # Database setup
│   ├── middleware/       # Auth middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── strategies/       # Trading strategies
│   ├── utils/            # Utilities
│   ├── workers/          # Background workers
│   ├── types/            # TypeScript types
│   ├── scripts/          # Utility scripts
│   ├── app.ts            # Fastify app setup
│   └── server.ts         # Server entry point
├── dist/                 # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env.example
```

## 🔌 API Endpoints

- `GET /health` - Health check
- `GET /api/test` - Test endpoint
- `GET /api/metrics` - Prometheus metrics
- `WS /ws` - WebSocket endpoint
- `WS /ws/admin` - Admin WebSocket endpoint

All other routes are under `/api/*` and require authentication.

## 🔐 Authentication

The backend uses Firebase Authentication. Include the Firebase ID token in the `Authorization` header:

```
Authorization: Bearer <firebase-id-token>
```

## 📝 License

ISC
>>>>>>> 9636cc16c78c77b9f0c35101a040dc5c414846c5

