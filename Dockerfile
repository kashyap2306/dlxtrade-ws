FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY dlxtrade-ws/package.json ./dlxtrade-ws/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY dlxtrade-ws ./dlxtrade-ws

# Build
WORKDIR /app/dlxtrade-ws
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY dlxtrade-ws/package.json ./dlxtrade-ws/

# Install pnpm
RUN npm install -g pnpm

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files
COPY --from=builder /app/dlxtrade-ws/dist ./dlxtrade-ws/dist

WORKDIR /app/dlxtrade-ws

EXPOSE 4000

CMD ["node", "dist/server.js"]

