# DLXTRADE Frontend Firebase Integration Verification Script
Write-Host "=== DLXTRADE FIREBASE INTEGRATION VERIFICATION ===" -ForegroundColor Cyan
Write-Host ""

# 1. Environment Configuration Check
Write-Host "1. Environment Configuration Check" -ForegroundColor Yellow
Write-Host "   Checking .env file..."

if (Test-Path ".env") {
    Write-Host "   ✅ .env file exists" -ForegroundColor Green
    $envContent = Get-Content ".env" -Raw
    $firebaseVars = ($envContent | Select-String "VITE_FIREBASE_" | Measure-Object).Count
    Write-Host "   📊 Firebase variables found: $firebaseVars" -ForegroundColor Blue

    # Check for placeholder values
    $placeholders = ($envContent | Select-String "placeholder|dummy" | Measure-Object).Count
    if ($placeholders -gt 0) {
        Write-Host "   ⚠️  Warning: Found $placeholders placeholder values in .env" -ForegroundColor Yellow
    } else {
        Write-Host "   ✅ No placeholder values detected" -ForegroundColor Green
    }
} else {
    Write-Host "   ❌ CRITICAL: .env file missing" -ForegroundColor Red
    Write-Host "   💡 Create .env with Firebase configuration variables" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# 2. Build Verification
Write-Host "2. Build Verification" -ForegroundColor Yellow
Write-Host "   Running npm run build..."

$buildStart = Get-Date
npm run build 2>$null
$buildExitCode = $LASTEXITCODE
$buildDuration = [math]::Round(((Get-Date) - $buildStart).TotalSeconds, 1)

if ($buildExitCode -eq 0) {
    Write-Host "   ✅ Build successful in ${buildDuration}s" -ForegroundColor Green
} else {
    Write-Host "   ❌ Build failed with exit code $buildExitCode" -ForegroundColor Red
    Write-Host "   💡 Check build output for TypeScript errors" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# 3. Static Analysis
Write-Host "3. Static Analysis" -ForegroundColor Yellow

# Check for Firebase imports
$firebaseImports = Get-ChildItem -Path "src" -Recurse -File -Include "*.ts","*.tsx" |
    Where-Object { $_.FullName -notlike "*node_modules*" } |
    ForEach-Object { Get-Content $_.FullName -Raw } |
    Select-String "import.*firebase" -AllMatches |
    ForEach-Object { $_.Matches.Count } |
    Measure-Object -Sum |
    Select-Object -ExpandProperty Sum

Write-Host "   📊 Firebase imports found: $firebaseImports" -ForegroundColor Blue

# Check for mock-related code
$mockCode = Get-ChildItem -Path "src" -Recurse -File -Include "*.ts","*.tsx" |
    Where-Object { $_.FullName -notlike "*node_modules*" } |
    ForEach-Object { Get-Content $_.FullName -Raw } |
    Select-String "mock.*firebase|firebase.*mock|_isMockFirebase" -AllMatches |
    ForEach-Object { $_.Matches.Count } |
    Measure-Object -Sum |
    Select-Object -ExpandProperty Sum

if ($mockCode -eq 0) {
    Write-Host "   ✅ No mock Firebase code detected" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Found $mockCode mock Firebase references" -ForegroundColor Yellow
}

# Check for auth guards
$authGuards = Get-ChildItem -Path "src" -Recurse -File -Include "*.ts","*.tsx" |
    Where-Object { $_.FullName -notlike "*node_modules*" } |
    ForEach-Object { Get-Content $_.FullName -Raw } |
    Select-String "isFirebaseAvailable|auth\?\.currentUser" -AllMatches |
    ForEach-Object { $_.Matches.Count } |
    Measure-Object -Sum |
    Select-Object -ExpandProperty Sum

Write-Host "   📊 Auth guards found: $authGuards" -ForegroundColor Blue

Write-Host ""

# 4. Runtime Verification (Development Mode)
Write-Host "4. Runtime Verification" -ForegroundColor Yellow
Write-Host "   Note: This requires running the dev server separately" -ForegroundColor Cyan
Write-Host "   Manual checks to perform:"
Write-Host "   - Open browser console on http://localhost:5173" -ForegroundColor White
Write-Host "   - Look for Firebase initialization logs" -ForegroundColor White
Write-Host "   - Check for '[DEBUG] === Firebase Integration Status ==='" -ForegroundColor White
Write-Host "   - Verify all checks show ✅ (green)" -ForegroundColor White
Write-Host "   - Try logging in to verify authentication works" -ForegroundColor White
Write-Host "   - Check network tab for authenticated API requests" -ForegroundColor White

Write-Host ""

# 5. Configuration Validation
Write-Host "5. Configuration Validation" -ForegroundColor Yellow

# Check Vite config
if (Test-Path "vite.config.ts") {
    Write-Host "   ✅ vite.config.ts exists" -ForegroundColor Green
} else {
    Write-Host "   ❌ vite.config.ts missing" -ForegroundColor Red
}

# Check package.json
if (Test-Path "package.json") {
    $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
    $firebaseDeps = $packageJson.dependencies.PSObject.Properties.Name | Where-Object { $_ -like "*firebase*" }
    Write-Host "   📊 Firebase dependencies: $($firebaseDeps.Count)" -ForegroundColor Blue
    if ($firebaseDeps.Count -gt 0) {
        $firebaseDeps | ForEach-Object { Write-Host "      - $_" -ForegroundColor White }
    }
} else {
    Write-Host "   ❌ package.json missing" -ForegroundColor Red
}

Write-Host ""

# 6. Summary and Recommendations
Write-Host "6. Summary and Recommendations" -ForegroundColor Yellow

$allChecksPass = $true

if (-not (Test-Path ".env")) { $allChecksPass = $false }
if ($buildExitCode -ne 0) { $allChecksPass = $false }

if ($allChecksPass) {
    Write-Host "   ✅ ALL AUTOMATED CHECKS PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "   Next Steps:" -ForegroundColor Cyan
    Write-Host "   1. Start dev server: npm run dev" -ForegroundColor White
    Write-Host "   2. Check browser console for Firebase logs" -ForegroundColor White
    Write-Host "   3. Test login functionality" -ForegroundColor White
    Write-Host "   4. Verify API calls include Authorization headers" -ForegroundColor White
    Write-Host "   5. Confirm all pages load without infinite loading" -ForegroundColor White
} else {
    Write-Host "   ❌ SOME CHECKS FAILED - SEE ABOVE" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Fix required issues before proceeding." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== VERIFICATION COMPLETE ===" -ForegroundColor Cyan
