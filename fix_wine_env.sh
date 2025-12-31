#!/bin/bash

# Fix Wine Build Issues

echo "Cleaning up Wine environment..."

# Kill any stuck wine processes
wineserver -k || true

# Backup existing wine prefix if it exists
if [ -d "$HOME/.wine" ]; then
    echo "Found existing .wine directory. Backing up to .wine.bak..."
    rm -rf "$HOME/.wine.bak"
    mv "$HOME/.wine" "$HOME/.wine.bak"
fi

echo "Initializing new Wine prefix..."
# This will create a fresh .wine directory
wineboot --init

echo "Waiting for Wine configuration to complete..."
# Wait a bit to ensure wineserver settles
sleep 5

echo "Verifying Wine environment..."
wine cmd /c echo "Wine is ready"

if [ $? -eq 0 ]; then
    echo "Wine setup successful! You can now run the build."
else
    echo "Wine setup failed. Please check install_build_deps.sh results."
    exit 1
fi
