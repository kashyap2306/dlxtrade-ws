# Script to extract specific logs from Research Engine test
# This script makes a request and shows only the requested log sections

param(
    [string]$Token = ""
)

$ErrorActionPreference = "Continue"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Research Engine Test - Log Extraction" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $Token) {
    Write-Host "⚠️  No token provided. Request will fail with 401." -ForegroundColor Yellow
    Write-Host "Usage: .\scripts\extract-research-logs.ps1 -Token YOUR_FIREBASE_TOKEN" -ForegroundColor Yellow
    Write-Host ""
}

# Make the request
$headers = @{
    "Content-Type" = "application/json"
}

if ($Token) {
    $headers["Authorization"] = "Bearer $Token"
}

$body = @{
    symbol = "BTCUSDT"
    timeframe = "5m"
} | ConvertTo-Json

Write-Host "Making research request (BTCUSDT 5m)..." -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/api/research/run" -Method POST -Headers $headers -Body $body -UseBasicParsing
    $responseData = $response.Content | ConvertFrom-Json
    
    if ($responseData.success -and $responseData.result) {
        $result = $responseData.result
        $indicators = $result.indicators
        
        Write-Host "================================================" -ForegroundColor Green
        Write-Host "FINAL INDICATORS" -ForegroundColor Green
        Write-Host "================================================" -ForegroundColor Green
        Write-Host ""
        
        # Check for fallback values
        $hasFallback = $false
        
        Write-Host "RSI:" -ForegroundColor Yellow -NoNewline
        if ($indicators.rsi -eq 50) {
            Write-Host " $($indicators.rsi) ❌ FALLBACK VALUE DETECTED!" -ForegroundColor Red
            $hasFallback = $true
        } elseif ($null -eq $indicators.rsi) {
            Write-Host " null (no data)" -ForegroundColor Gray
        } else {
            Write-Host " $($indicators.rsi) ✅" -ForegroundColor Green
        }
        
        Write-Host "MACD:" -ForegroundColor Yellow -NoNewline
        if ($indicators.macd) {
            if ($indicators.macd.signal -eq 0 -and $indicators.macd.histogram -eq 0) {
                Write-Host " signal=0, histogram=0 ❌ FALLBACK VALUE DETECTED!" -ForegroundColor Red
                $hasFallback = $true
            } else {
                Write-Host " signal=$($indicators.macd.signal), histogram=$($indicators.macd.histogram), trend=$($indicators.macd.trend) ✅" -ForegroundColor Green
            }
        } else {
            Write-Host " null (no data)" -ForegroundColor Gray
        }
        
        Write-Host "Volume:" -ForegroundColor Yellow -NoNewline
        if ($indicators.volume -eq "Stable") {
            Write-Host " Stable ❌ FALLBACK VALUE DETECTED!" -ForegroundColor Red
            $hasFallback = $true
        } elseif ($null -eq $indicators.volume) {
            Write-Host " null (no data)" -ForegroundColor Gray
        } else {
            Write-Host " $($indicators.volume) ✅" -ForegroundColor Green
        }
        
        Write-Host "Trend Strength:" -ForegroundColor Yellow -NoNewline
        if ($indicators.trendStrength) {
            if ($indicators.trendStrength.trend -eq "Weak" -and -not $indicators.trendStrength.ema20 -and -not $indicators.trendStrength.ema12) {
                Write-Host " Weak ❌ FALLBACK VALUE DETECTED!" -ForegroundColor Red
                $hasFallback = $true
            } else {
                Write-Host " $($indicators.trendStrength | ConvertTo-Json -Compress) ✅" -ForegroundColor Green
            }
        } else {
            Write-Host " null (no data)" -ForegroundColor Gray
        }
        
        Write-Host "Volatility:" -ForegroundColor Yellow -NoNewline
        if ($indicators.volatility -eq "Low") {
            Write-Host " Low ❌ FALLBACK VALUE DETECTED!" -ForegroundColor Red
            $hasFallback = $true
        } elseif ($null -eq $indicators.volatility) {
            Write-Host " null (no data)" -ForegroundColor Gray
        } else {
            Write-Host " $($indicators.volatility) ✅" -ForegroundColor Green
        }
        
        Write-Host "Orderbook:" -ForegroundColor Yellow -NoNewline
        if ($indicators.orderbook -eq 0) {
            Write-Host " 0% ⚠️  (might be real, verify)" -ForegroundColor Yellow
        } elseif ($null -eq $indicators.orderbook) {
            Write-Host " null (no data)" -ForegroundColor Gray
        } else {
            Write-Host " $($indicators.orderbook)% ✅" -ForegroundColor Green
        }
        
        Write-Host ""
        Write-Host "Accuracy: $([math]::Round($result.accuracy * 100, 1))%" -ForegroundColor Cyan
        
        Write-Host ""
        Write-Host "================================================" -ForegroundColor $(if ($hasFallback) { "Red" } else { "Green" })
        if ($hasFallback) {
            Write-Host "❌ TEST FAILED - Fallback values detected!" -ForegroundColor Red
            Write-Host "Check server console logs for detailed information." -ForegroundColor Yellow
            exit 1
        } else {
            Write-Host "✅ TEST PASSED - No fallback values detected!" -ForegroundColor Green
            Write-Host "All indicators show real values or null." -ForegroundColor Green
        }
        Write-Host "================================================" -ForegroundColor $(if ($hasFallback) { "Red" } else { "Green" })
        
    } else {
        Write-Host "Response received but no result data" -ForegroundColor Yellow
        Write-Host ($responseData | ConvertTo-Json -Depth 3) -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "Request failed!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host ""
        Write-Host "Authentication required. Please provide a Firebase token:" -ForegroundColor Yellow
        Write-Host "  .\scripts\extract-research-logs.ps1 -Token YOUR_FIREBASE_TOKEN" -ForegroundColor White
    }
    
    exit 1
}

Write-Host ""
Write-Host "NOTE: For detailed logs (candle counts, parsed arrays, etc.)," -ForegroundColor Yellow
Write-Host "check the server console where 'npm run dev' is running." -ForegroundColor Yellow
Write-Host "Look for logs starting with:" -ForegroundColor Yellow
Write-Host "  - 🔍 [DEBUG] [STEP 1] REQUEST RECEIVED" -ForegroundColor Gray
Write-Host "  - 🔍 [DEBUG] [ADAPTER] getKlines()" -ForegroundColor Gray
Write-Host "  - 🔍 [DEBUG] [STEP 3] FEATURE ENGINE START" -ForegroundColor Gray
Write-Host "  - 🔍 [DEBUG] [STEP 4-6] Indicator calculations" -ForegroundColor Gray
Write-Host "  - 🔍 [DEBUG] [INDICATORS] FINAL INDICATOR VALUES" -ForegroundColor Gray

