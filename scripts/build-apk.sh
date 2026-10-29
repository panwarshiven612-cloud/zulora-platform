#!/usr/bin/env bash
# ================================================================
# Zulora AI — Android APK Build Automation Script
# ================================================================
# Usage: bash scripts/build-apk.sh [debug|release]
# Prerequisites:
#   - Java 17+ (JAVA_HOME set)
#   - Android SDK (ANDROID_HOME set)
#   - Node.js 18+
# ================================================================

set -e

MODE="${1:-debug}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "========================================"
echo "  Zulora AI — Android APK Builder"
echo "  Mode: $MODE"
echo "========================================"

# 1. Build production web bundle
echo "[1/5] Building web bundle..."
cd "$PROJECT_ROOT"
npm run build
echo "  ✓ Web bundle built: dist/"

# 2. Ensure android platform exists
if [ ! -d "$PROJECT_ROOT/android" ]; then
  echo "[2/5] Adding Android platform..."
  npx cap add android
else
  echo "[2/5] Android platform already exists — skipping add"
fi

# 3. Sync with Capacitor
echo "[3/5] Syncing Capacitor..."
npx cap sync android
echo "  ✓ Capacitor synced"

# 4. Build APK via Gradle
echo "[4/5] Building $MODE APK..."
cd "$PROJECT_ROOT/android"

if [ "$MODE" = "release" ]; then
  ./gradlew assembleRelease --no-daemon --quiet
  APK_PATH="app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew assembleDebug --no-daemon --quiet
  APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

if [ ! -f "$APK_PATH" ]; then
  echo "  ✗ APK build failed — file not found: $APK_PATH"
  exit 1
fi
echo "  ✓ APK built: android/$APK_PATH"

# 5. Copy APK to public/ for web download
echo "[5/5] Publishing APK to public/download.apk..."
cd "$PROJECT_ROOT"
mkdir -p public
cp "android/$APK_PATH" "public/download.apk"
echo "  ✓ APK available at: public/download.apk"
echo "  ✓ Download URL: https://zulora.in/download.apk"

echo ""
echo "========================================"
echo "  ✅ Zulora AI APK Build Complete!"
echo "  Mode:   $MODE"
echo "  Output: public/download.apk"
echo "========================================"
