#!/bin/bash

# Local development runner script

echo "Starting DLXTRADE local development environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker and try again."
    exit 1
fi

# Start infrastructure services
echo "Starting infrastructure services (Postgres, Redis)..."
docker compose -f infra/docker-compose.yml up -d postgres redis

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 5

# Check if services are healthy
if ! docker ps | grep -q dlxtrade-postgres; then
    echo "Error: Postgres container failed to start"
    exit 1
fi

if ! docker ps | grep -q dlxtrade-redis; then
    echo "Error: Redis container failed to start"
    exit 1
fi

echo "Infrastructure services are ready!"
echo ""
echo "To start the backend:"
echo "  cd backend && pnpm dev"
echo ""
echo "To start the frontend:"
echo "  cd frontend && pnpm dev"
echo ""
echo "Or run everything with Docker Compose:"
echo "  docker compose -f infra/docker-compose.yml up --build"

