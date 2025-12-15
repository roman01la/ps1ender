#!/bin/bash
# Build script for WASM rasterizer
# Requires: clang with wasm target support (brew install llvm or use wasi-sdk)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Try to find clang with WASM support
CLANG=""
if command -v /opt/homebrew/opt/llvm/bin/clang++ &> /dev/null; then
    CLANG="/opt/homebrew/opt/llvm/bin/clang++"
elif command -v /usr/local/opt/llvm/bin/clang++ &> /dev/null; then
    CLANG="/usr/local/opt/llvm/bin/clang++"
elif command -v clang++ &> /dev/null; then
    CLANG="clang++"
else
    echo "Error: clang++ not found. Install with: brew install llvm"
    exit 1
fi

echo "Using clang: $CLANG"
echo "Building WASM rasterizer..."

# Compile to WASM with SIMD support
$CLANG \
    -O3 \
    -flto \
    --target=wasm32 \
    -msimd128 \
    -nostdlib \
    -fno-exceptions \
    -fno-rtti \
    -Wl,--no-entry \
    -Wl,--export-all \
    -Wl,--allow-undefined \
    -Wl,--initial-memory=67108864 \
    -Wl,--max-memory=268435456 \
    -o rasterizer.wasm \
    rasterizer.cpp

# Check output size
SIZE=$(wc -c < rasterizer.wasm)
echo "Built rasterizer.wasm ($SIZE bytes)"

# Copy to public folder for serving (if it exists)
if [ -d "../public" ]; then
    cp rasterizer.wasm ../public/
    echo "Copied to public/"
fi

echo "Done!"
