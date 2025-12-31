#!/bin/bash

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "This script is intended for Linux systems."
    exit 1
fi

echo "Checking for Wine installation..."

if ! command -v wine &> /dev/null; then
    echo "Wine is not installed. Wine is required to build Windows applications on Linux."
    echo "Attempting to install Wine..."
    
    # Check for package manager
    if command -v apt-get &> /dev/null; then
        echo "Detected apt-get. Installing Wine..."
        sudo dpkg --add-architecture i386
        sudo apt-get update
        sudo apt-get install -y wine64 wine32
    elif command -v dnf &> /dev/null; then
        echo "Detected dnf. Installing Wine..."
        sudo dnf install -y wine
    elif command -v pacman &> /dev/null; then
        echo "Detected pacman. Installing Wine..."
        sudo pacman -S --noconfirm wine
    else
        echo "Could not detect package manager. Please install Wine manually."
        exit 1
    fi
else
    echo "Wine is already installed."
fi

echo "Wine installation check complete. You should be able to build for Windows now."
