# AI Worker - Dependency Setup Script (Windows)
# This script installs Node.js, Python, uv, and Playwright browsers

Write-Host "🚀 AI Worker - Setting up dependencies for Windows..." -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    $null = Get-Command $command -ErrorAction SilentlyContinue
    return $?
}

# Function to check if running as Administrator
function Test-Administrator {
    $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to check available browsers on Windows
function Get-AvailableBrowsers {
    $browsers = @()
    
    # Check for Chrome
    $chromePaths = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    foreach ($path in $chromePaths) {
        if (Test-Path $path) {
            $browsers += "chrome"
            Write-Host "  ✅ Google Chrome found" -ForegroundColor Green
            break
        }
    }
    
    # Check for Edge
    $edgePaths = @(
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($path in $edgePaths) {
        if (Test-Path $path) {
            $browsers += "msedge"
            Write-Host "  ✅ Microsoft Edge found" -ForegroundColor Green
            break
        }
    }
    
    # Check for Firefox
    $firefoxPaths = @(
        "${env:ProgramFiles}\Mozilla Firefox\firefox.exe",
        "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe"
    )
    foreach ($path in $firefoxPaths) {
        if (Test-Path $path) {
            $browsers += "firefox"
            Write-Host "  ✅ Mozilla Firefox found" -ForegroundColor Green
            break
        }
    }
    
    # Chromium is always available as bundled
    $browsers += "chromium"
    Write-Host "  ✅ Chromium (bundled) available" -ForegroundColor Green
    
    return $browsers
}

# Function to install Playwright browser
function Install-PlaywrightBrowser {
    param($browser)
    
    Write-Host "📦 Installing Playwright browser: $browser" -ForegroundColor Yellow
    
    switch ($browser) {
        "chrome"  { npx playwright install chrome }
        "msedge"  { npx playwright install msedge }
        "firefox" { npx playwright install firefox }
        "chromium" { npx playwright install chromium }
        default {
            Write-Host "❌ Unknown browser: $browser" -ForegroundColor Red
            return $false
        }
    }
    
    Write-Host "✅ $browser installed successfully" -ForegroundColor Green
    return $true
}

# Function to save selected browser to electron-store
function Save-SelectedBrowser {
    param($browser)
    
    $configDir = "$env:APPDATA\ai-worker"
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    $storeFile = Join-Path $configDir "ai-worker-store.json"
    
    if (Test-Path $storeFile) {
        $data = Get-Content $storeFile -Raw | ConvertFrom-Json
        if (-not $data.mcpPlaywright) {
            $data | Add-Member -NotePropertyName "mcpPlaywright" -NotePropertyValue @{}
        }
        $data.mcpPlaywright.browser = $browser
        $data | ConvertTo-Json -Depth 10 | Set-Content $storeFile
    } else {
        @{
            mcpPlaywright = @{ browser = $browser }
        } | ConvertTo-Json -Depth 10 | Set-Content $storeFile
    }
    
    Write-Host "💾 Saved browser preference: $browser" -ForegroundColor Green
}

# Function to prompt browser selection
function Invoke-BrowserSelection {
    Write-Host ""
    Write-Host "🌐 Select a browser for AI Worker web automation:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1) Google Chrome       - Fast and widely supported"
    Write-Host "  2) Mozilla Firefox    - Privacy-focused, open source"
    Write-Host "  3) Chromium (Bundled) - Lightweight, no system install needed"
    Write-Host "  4) Microsoft Edge     - Built-in on Windows"
    Write-Host "  5) All of the above  - Install all browsers"
    Write-Host ""
    
    Write-Host "Checking available system browsers..." -ForegroundColor Gray
    $available = Get-AvailableBrowsers
    
    Write-Host ""
    Write-Host "Enter your choice (1-5) or press Enter for Chrome: " -ForegroundColor Cyan -NoNewline
    $choice = Read-Host
    
    $selectedBrowser = ""
    
    switch ($choice) {
        "1" { 
            Install-PlaywrightBrowser "chrome"
            $selectedBrowser = "chrome"
        }
        "2" { 
            Install-PlaywrightBrowser "firefox"
            $selectedBrowser = "firefox"
        }
        "3" { 
            Install-PlaywrightBrowser "chromium"
            $selectedBrowser = "chromium"
        }
        "4" { 
            Install-PlaywrightBrowser "msedge"
            $selectedBrowser = "msedge"
        }
        "5" {
            Write-Host "Installing all browsers..." -ForegroundColor Yellow
            Install-PlaywrightBrowser "chromium"
            Install-PlaywrightBrowser "firefox"
            Write-Host "✅ All browsers installed" -ForegroundColor Green
            $selectedBrowser = "chromium"
        }
        "" {
            Write-Host "Installing Chromium (recommended)..." -ForegroundColor Yellow
            Install-PlaywrightBrowser "chromium"
            $selectedBrowser = "chromium"
        }
        default {
            Write-Host "Invalid choice. Installing Chromium (recommended)..." -ForegroundColor Yellow
            Install-PlaywrightBrowser "chromium"
            $selectedBrowser = "chromium"
        }
    }
    
    # Save selection to electron-store
    if ($selectedBrowser) {
        Save-SelectedBrowser $selectedBrowser
    }
}

# Check for admin privileges
if (-not (Test-Administrator)) {
    Write-Host "⚠️  This script requires Administrator privileges." -ForegroundColor Yellow
    Write-Host "Please right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Check for Chocolatey (package manager for Windows)
$hasChoco = Test-CommandExists choco

if (-not $hasChoco) {
    Write-Host "📦 Installing Chocolatey (Windows package manager)..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    
    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "✅ Chocolatey already installed" -ForegroundColor Green
}

# Install Node.js
if (-not (Test-CommandExists node)) {
    Write-Host "📦 Installing Node.js..." -ForegroundColor Yellow
    choco install nodejs -y
} else {
    $nodeVersion = node --version
    Write-Host "✅ Node.js already installed ($nodeVersion)" -ForegroundColor Green
}

# Install Python
if (-not (Test-CommandExists python)) {
    Write-Host "📦 Installing Python 3..." -ForegroundColor Yellow
    choco install python -y
} else {
    $pythonVersion = python --version
    Write-Host "✅ Python already installed ($pythonVersion)" -ForegroundColor Green
}

# Install uv
if (-not (Test-CommandExists uv)) {
    Write-Host "📦 Installing uv (Python package runner)..." -ForegroundColor Yellow
    powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
} else {
    $uvVersion = uv --version
    Write-Host "✅ uv already installed ($uvVersion)" -ForegroundColor Green
}

# Refresh environment variables
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host ""
Write-Host "🎉 Base dependencies installed!" -ForegroundColor Green
Write-Host ""

# Check if npx is available for Playwright
if (Test-CommandExists npx) {
    # Check if running in interactive mode
    if ([Environment]::GetEnvironmentVariable("CI") -ne "true") {
        Invoke-BrowserSelection
    } else {
        # CI mode: install chromium by default
        Write-Host "🔧 Running in CI mode. Installing Chromium (bundled)..." -ForegroundColor Yellow
        Install-PlaywrightBrowser "chromium"
    }
} else {
    Write-Host "⚠️  Node.js not found. Skipping Playwright browser installation." -ForegroundColor Yellow
    Write-Host "   Run this script again after installing Node.js to install browsers." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "✅ All dependencies installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Close and reopen PowerShell/Terminal"
Write-Host "  2. Restart the AI Worker app"
Write-Host "  3. Enable MarkItDown in Settings → MCP Servers"
Write-Host ""
Write-Host "🎉 You're all set!" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to exit"
