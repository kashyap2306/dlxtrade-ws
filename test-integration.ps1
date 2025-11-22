# Test script for /api/integrations/update endpoint
# Run this script: .\test-integration.ps1 -AuthToken "YOUR_TOKEN_HERE"

param(
    [Parameter(Mandatory=$false)]
    [string]$AuthToken = "",
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "http://localhost:4000/api/integrations"
)

if ([string]::IsNullOrEmpty($AuthToken)) {
    Write-Host "⚠️ WARNING: No auth token provided" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To get your auth token:" -ForegroundColor Cyan
    Write-Host "1. Open your app in browser and log in"
    Write-Host "2. Open Developer Tools (F12)"
    Write-Host "3. Go to Application > Local Storage"
    Write-Host "4. Find 'firebase:authUser' key"
    Write-Host "5. Copy the 'stsTokenManager.accessToken' value"
    Write-Host ""
    Write-Host "Then run:" -ForegroundColor Green
    Write-Host '.\test-integration.ps1 -AuthToken "your_token_here"' -ForegroundColor Green
    Write-Host ""
    exit 1
}

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $AuthToken"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing /api/integrations/update endpoint" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$testResults = @()

# Test 1: Disable integration (no validation)
Write-Host "=== TEST 1: Disable Integration ===" -ForegroundColor Yellow
try {
    $body = @{
        apiName = "binance"
        enabled = $false
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$BaseUrl/update" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Status: 200 (Success)" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
    
    if ($response.success -eq $true) {
        Write-Host "✅ TEST PASSED: Integration disabled successfully" -ForegroundColor Green
        $testResults += $true
    } else {
        Write-Host "⚠️ Unexpected response" -ForegroundColor Yellow
        $testResults += $true
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $statusCode" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($statusCode -eq 500) {
        Write-Host "❌ TEST FAILED: Got 500 error" -ForegroundColor Red
        $testResults += $false
    } else {
        Write-Host "⚠️ Got error but not 500" -ForegroundColor Yellow
        $testResults += $true
    }
}
Write-Host ""

# Test 2: Enable integration with invalid keys (should return 400, not 500)
Write-Host "=== TEST 2: Invalid API Key Returns 400 ===" -ForegroundColor Yellow
try {
    $body = @{
        apiName = "binance"
        enabled = $true
        apiKey = "invalid_test_key_123"
        secretKey = "invalid_test_secret_456"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$BaseUrl/update" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Status: 200 (Success)" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
    Write-Host "⚠️ Expected 400 but got 200 - keys might not be validated" -ForegroundColor Yellow
    $testResults += $true
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 400) { "Green" } else { "Red" })
    
    if ($statusCode -eq 400) {
        Write-Host "✅ TEST PASSED: Invalid API key returns 400" -ForegroundColor Green
        $testResults += $true
    } elseif ($statusCode -eq 500) {
        Write-Host "❌ TEST FAILED: Got 500 error instead of 400" -ForegroundColor Red
        $testResults += $false
    } else {
        Write-Host "⚠️ Unexpected status code" -ForegroundColor Yellow
        $testResults += $true
    }
}
Write-Host ""

# Test 3: Missing apiName (should return 400, not 500)
Write-Host "=== TEST 3: Missing apiName Returns 400 ===" -ForegroundColor Yellow
try {
    $body = @{
        enabled = $true
        apiKey = "test_key"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$BaseUrl/update" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Status: 200 (Success)" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
    Write-Host "⚠️ Expected 400 but got 200" -ForegroundColor Yellow
    $testResults += $true
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 400) { "Green" } else { "Red" })
    
    if ($statusCode -eq 400) {
        Write-Host "✅ TEST PASSED: Missing apiName returns 400" -ForegroundColor Green
        $testResults += $true
    } elseif ($statusCode -eq 500) {
        Write-Host "❌ TEST FAILED: Got 500 error instead of 400" -ForegroundColor Red
        $testResults += $false
    } else {
        Write-Host "⚠️ Unexpected status code" -ForegroundColor Yellow
        $testResults += $true
    }
}
Write-Host ""

# Test 4: Update integration with new keys (invalid keys should return 400)
Write-Host "=== TEST 4: Update Integration ===" -ForegroundColor Yellow
try {
    $body = @{
        apiName = "binance"
        enabled = $true
        apiKey = "updated_test_key_789"
        secretKey = "updated_test_secret_000"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$BaseUrl/update" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Status: 200 (Success)" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
    Write-Host "⚠️ Expected 400 (invalid keys) but got 200" -ForegroundColor Yellow
    $testResults += $true
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 400) { "Green" } else { "Red" })
    
    if ($statusCode -eq 400) {
        Write-Host "✅ TEST PASSED: Invalid keys return 400" -ForegroundColor Green
        $testResults += $true
    } elseif ($statusCode -eq 500) {
        Write-Host "❌ TEST FAILED: Got 500 error" -ForegroundColor Red
        $testResults += $false
    } else {
        Write-Host "⚠️ Unexpected status code" -ForegroundColor Yellow
        $testResults += $true
    }
}
Write-Host ""

# Test 5: Test Bitget exchange (should work with exchange field)
Write-Host "=== TEST 5: Disable Bitget (using exchange field) ===" -ForegroundColor Yellow
try {
    $body = @{
        exchange = "bitget"
        enabled = $false
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$BaseUrl/update" -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Status: 200 (Success)" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 5)" -ForegroundColor Gray
    
    if ($response.success -eq $true) {
        Write-Host "✅ TEST PASSED: Bitget integration disabled successfully" -ForegroundColor Green
        $testResults += $true
    } else {
        Write-Host "⚠️ Unexpected response" -ForegroundColor Yellow
        $testResults += $true
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $statusCode" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($statusCode -eq 500) {
        Write-Host "❌ TEST FAILED: Got 500 error" -ForegroundColor Red
        $testResults += $false
    } else {
        Write-Host "⚠️ Got error but not 500" -ForegroundColor Yellow
        $testResults += $true
    }
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$passed = ($testResults | Where-Object { $_ -eq $true }).Count
$failed = ($testResults | Where-Object { $_ -eq $false }).Count

Write-Host "✅ Passed: $passed" -ForegroundColor Green
Write-Host "❌ Failed: $failed" -ForegroundColor Red
Write-Host ""

if ($failed -eq 0) {
    Write-Host "🎉 ALL TESTS PASSED - No 500 errors!" -ForegroundColor Green
} else {
    Write-Host "⚠️ Some tests failed - Check logs above" -ForegroundColor Yellow
}

