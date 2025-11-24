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

