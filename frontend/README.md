# DLXTRADE Frontend

React + Vite + TypeScript frontend for the HFT trading agent.

## Setup

```bash
pnpm install
```

### Environment Variables

Create a `.env` file in the root directory with the following:

```env
# Production URLs are hardcoded - no environment variables needed
```

## Development

```bash
pnpm dev
```

Runs on http://localhost:5173

## Build

```bash
pnpm build
```

## Features

- Real-time orderbook and trades visualization
- Order management and fills tracking
- PnL charts and metrics
- Engine control panel
- API key management
- Backtest runner UI

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- React Router
- Axios

## Manual verification

- Submit a provider API key in Settings → API Provider Configuration; after success the input hides and shows a masked row with a Change API button.
- Submit an exchange API key in Settings; the connected state should update immediately and Auto-Trade should detect the submission without refreshing.
- Use the Test controls (provider or exchange) to validate connectivity; Change API should reopen the edit flow.

