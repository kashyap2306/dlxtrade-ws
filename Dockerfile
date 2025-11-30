FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY backend/package.json ./backend/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY backend ./backend

# Build
WORKDIR /app/backend
RUN pnpm build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY backend/package.json ./backend/

# Install pnpm
RUN npm install -g pnpm

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files
COPY --from=builder /app/backend/dist ./backend/dist

WORKDIR /app/backend

EXPOSE 4000

CMD ["node", "dist/server.js"]

