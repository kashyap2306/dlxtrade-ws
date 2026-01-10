# CRITICAL HOTFIX - Kill old process and restart with fresh build
# Run this script as Administrator

Write-Host "🔥 CRITICAL HOTFIX - Server Restart" -ForegroundColor Red
Write-Host ""

# Find process on port 4000
$port4000 = netstat -ano | Select-String ":4000.*LISTENING"
if ($port4000) {
    $pid = ($port4000 -split '\s+')[-1]
    Write-Host "Found process on port 4000: PID $pid" -ForegroundColor Yellow
    
    # Try to kill it
    Write-Host "Attempting to terminate process..." -ForegroundColor Yellow
    try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        Write-Host "✅ Process terminated successfully" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "❌ Failed to terminate process: $_" -ForegroundColor Red
        Write-Host "Please run this script as Administrator" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "✅ Port 4000 is free" -ForegroundColor Green
}

# Verify dist folder exists
if (Test-Path "dist") {
    Write-Host "✅ dist/ folder exists" -ForegroundColor Green
} else {
    Write-Host "❌ dist/ folder missing - run 'npm run build' first" -ForegroundColor Red
    exit 1
}

# Start server
Write-Host ""
Write-Host "Starting server with fresh build..." -ForegroundColor Cyan
npm start
