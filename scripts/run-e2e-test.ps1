# PowerShell script to run E2E test for Research Engine
# This script starts the server, waits for it, makes a test request, and analyzes results

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Research Engine E2E Test" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if server is already running
Write-Host "[STEP 1] Checking if server is running..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/api/research/run" -Method POST -ContentType "application/json" -Body '{"symbol":"BTCUSDT","timeframe":"5m"}' -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    Write-Host "[STEP 1] Server is already running!" -ForegroundColor Green
    $serverRunning = $true
} catch {
    Write-Host "[STEP 1] Server is not running. Please start it manually with: npm run dev" -ForegroundColor Red
    Write-Host "[STEP 1] Then run this script again, or provide a Firebase token to test with authentication." -ForegroundColor Yellow
    $serverRunning = $false
}

if (-not $serverRunning) {
    Write-Host ""
    Write-Host "To start the server:" -ForegroundColor Yellow
    Write-Host "  1. Open a new terminal" -ForegroundColor White
    Write-Host "  2. Run: cd c:\Users\yash\dlxtrade\dlxtrade-ws" -ForegroundColor White
    Write-Host "  3. Run: npm run dev" -ForegroundColor White
    Write-Host "  4. Wait for server to start" -ForegroundColor White
    Write-Host "  5. Run this script again" -ForegroundColor White
    exit 1
}

# Step 2: Get Firebase token (optional)
$token = $args[0]
if (-not $token) {
    Write-Host ""
    Write-Host "[STEP 2] No Firebase token provided. Request will likely fail with 401." -ForegroundColor Yellow
    Write-Host "[STEP 2] To get a token:" -ForegroundColor Yellow
    Write-Host "  1. Open frontend app (http://localhost:5173)" -ForegroundColor White
    Write-Host "  2. Login" -ForegroundColor White
    Write-Host "  3. Open browser console (F12)" -ForegroundColor White
    Write-Host "  4. Run: localStorage.getItem('firebaseToken')" -ForegroundColor White
    Write-Host "  5. Copy the token and run: .\scripts\run-e2e-test.ps1 YOUR_TOKEN" -ForegroundColor White
    Write-Host ""
}

# Step 3: Make test request
Write-Host "[STEP 3] Making research request (BTCUSDT 5m)..." -ForegroundColor Yellow
Write-Host ""

$headers = @{
    "Content-Type" = "application/json"
}

if ($token) {
    $headers["Authorization"] = "Bearer $token"
}

$body = @{
    symbol = "BTCUSDT"
    timeframe = "5m"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/api/research/run" -Method POST -Headers $headers -Body $body -UseBasicParsing
    $statusCode = $response.StatusCode
    $responseData = $response.Content | ConvertFrom-Json
    
    Write-Host "[STEP 3] Request completed!" -ForegroundColor Green
    Write-Host "[STEP 3] HTTP Status: $statusCode" -ForegroundColor Green
    Write-Host ""
    
    # Step 4: Analyze response
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "[STEP 4] Analyzing Response" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""
    
    if ($responseData.success -and $responseData.result) {
        $result = $responseData.result
        $indicators = $result.indicators
        
        Write-Host "INDICATORS:" -ForegroundColor Yellow
        Write-Host "  RSI: $($indicators.rsi)" -ForegroundColor $(if ($indicators.rsi -eq 50) { "Red" } else { "Green" })
        Write-Host "  MACD: $($indicators.macd | ConvertTo-Json -Compress)" -ForegroundColor $(if ($indicators.macd -and $indicators.macd.signal -eq 0 -and $indicators.macd.histogram -eq 0) { "Red" } else { "Green" })
        Write-Host "  Volume: $($indicators.volume)" -ForegroundColor $(if ($indicators.volume -eq "Stable") { "Red" } else { "Green" })
        Write-Host "  TrendStrength: $($indicators.trendStrength | ConvertTo-Json -Compress)" -ForegroundColor Green
        Write-Host "  Volatility: $($indicators.volatility)" -ForegroundColor Green
        Write-Host "  Orderbook: $($indicators.orderbook)" -ForegroundColor Green
        Write-Host ""
        Write-Host "ACCURACY: $([math]::Round($result.accuracy * 100, 1))%" -ForegroundColor Yellow
        Write-Host "ENTRY SIGNAL: $($result.entrySignal)" -ForegroundColor Yellow
        Write-Host "APIS USED: $($result.apisUsed -join ', ')" -ForegroundColor Yellow
        Write-Host ""
        
        # Check for fallback values
        $issues = @()
        if ($indicators.rsi -eq 50) { $issues += "RSI = 50 (fallback value)" }
        if ($indicators.macd -and $indicators.macd.signal -eq 0 -and $indicators.macd.histogram -eq 0) { $issues += "MACD = 0/0 (fallback value)" }
        if ($indicators.volume -eq "Stable") { $issues += "Volume = 'Stable' (fallback value)" }
        if ($result.accuracy -eq 0.5) { $issues += "Accuracy = 50% (fallback value)" }
        
        if ($issues.Count -gt 0) {
            Write-Host "================================================" -ForegroundColor Red
            Write-Host "[RESULT] TEST FAILED - Fallback values detected!" -ForegroundColor Red
            Write-Host "================================================" -ForegroundColor Red
            foreach ($issue in $issues) {
                Write-Host "  ❌ $issue" -ForegroundColor Red
            }
            Write-Host ""
            Write-Host "Check server console logs for detailed debug information." -ForegroundColor Yellow
            exit 1
        } else {
            Write-Host "================================================" -ForegroundColor Green
            Write-Host "[RESULT] TEST PASSED - No fallback values detected!" -ForegroundColor Green
            Write-Host "================================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "✅ All indicators show real values or null (no fallback values)" -ForegroundColor Green
            Write-Host "✅ Accuracy is dynamic: $([math]::Round($result.accuracy * 100, 1))%" -ForegroundColor Green
            Write-Host "✅ APIs used: $($result.apisUsed.Count) APIs" -ForegroundColor Green
        }
    } else {
        Write-Host "[STEP 4] Response received but no result data" -ForegroundColor Yellow
        Write-Host "Response: $($responseData | ConvertTo-Json -Depth 3)" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "[STEP 3] Request failed!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Yellow
    }
    
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host ""
        Write-Host "Authentication required. Please provide a Firebase token:" -ForegroundColor Yellow
        Write-Host "  .\scripts\run-e2e-test.ps1 YOUR_FIREBASE_TOKEN" -ForegroundColor White
    }
    
    exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "1. Check server console for detailed debug logs:" -ForegroundColor White
Write-Host "   - STEP 1: REQUEST RECEIVED" -ForegroundColor Gray
Write-Host "   - STEP 2: ADAPTER getKlines() logs" -ForegroundColor Gray
Write-Host "   - STEP 3: FEATURE ENGINE START" -ForegroundColor Gray
Write-Host "   - STEP 4-6: INDICATOR CALCULATIONS" -ForegroundColor Gray
Write-Host "   - FINAL: INDICATOR VALUES SUMMARY" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Verify all debug logs appear correctly" -ForegroundColor White
Write-Host "3. If any fallback values appear, check logs to identify root cause" -ForegroundColor White
Write-Host ""

