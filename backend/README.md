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

