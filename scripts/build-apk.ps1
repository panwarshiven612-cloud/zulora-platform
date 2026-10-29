# Zulora AI — Android APK Build Automation (PowerShell)
# ================================================================
# Usage: .\scripts\build-apk.ps1 [-Mode debug|release]
# Prerequisites:
#   - Java 17+ (JAVA_HOME set in System Environment Variables)
#   - Android SDK (ANDROID_HOME set)
#   - Node.js 18+
# ================================================================
param(
    [string]$Mode = "debug"
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Zulora AI — Android APK Builder"       -ForegroundColor Cyan
Write-Host "  Mode: $Mode"                            -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location $ROOT

# 1. Build production web bundle
Write-Host "`n[1/5] Building web bundle..." -ForegroundColor Yellow
npm run build
Write-Host "  ✓ Web bundle built: dist/" -ForegroundColor Green

# 2. Ensure android platform exists
if (-not (Test-Path "$ROOT\android")) {
    Write-Host "`n[2/5] Adding Android platform..." -ForegroundColor Yellow
    npx cap add android
} else {
    Write-Host "`n[2/5] Android platform already exists — skipping add" -ForegroundColor Gray
}

# 3. Sync with Capacitor
Write-Host "`n[3/5] Syncing Capacitor..." -ForegroundColor Yellow
npx cap sync android
Write-Host "  ✓ Capacitor synced" -ForegroundColor Green

# 4. Build APK via Gradle
Write-Host "`n[4/5] Building $Mode APK..." -ForegroundColor Yellow
Set-Location "$ROOT\android"

if ($Mode -eq "release") {
    .\gradlew.bat assembleRelease --no-daemon --quiet
    $ApkPath = "app\build\outputs\apk\release\app-release.apk"
} else {
    .\gradlew.bat assembleDebug --no-daemon --quiet
    $ApkPath = "app\build\outputs\apk\debug\app-debug.apk"
}

if (-not (Test-Path $ApkPath)) {
    Write-Error "  ✗ APK build failed — file not found: $ApkPath"
    exit 1
}
Write-Host "  ✓ APK built: android\$ApkPath" -ForegroundColor Green

# 5. Copy APK to public/ for web download
Write-Host "`n[5/5] Publishing APK to public\download.apk..." -ForegroundColor Yellow
Set-Location $ROOT
New-Item -ItemType Directory -Path "public" -Force | Out-Null
Copy-Item "android\$ApkPath" "public\download.apk" -Force
Write-Host "  ✓ APK available at: public\download.apk" -ForegroundColor Green
Write-Host "  ✓ Download URL: https://zulora.in/download.apk" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  ✅ Zulora AI APK Build Complete!" -ForegroundColor Green
Write-Host "  Mode:   $Mode"
Write-Host "  Output: public\download.apk"
Write-Host "========================================" -ForegroundColor Cyan
