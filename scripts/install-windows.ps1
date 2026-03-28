# AI-Worker Windows Installer
# Downloads the latest build from Cloudflare R2 and runs the NSIS installer.
# Bypasses Windows SmartScreen "Mark of the Web" by downloading via PowerShell (Invoke-WebRequest)
# rather than a browser, preventing the Zone.Identifier alternate data stream from being attached.
#
# How to run: Right-click this file -> "Run with PowerShell"

$ErrorActionPreference = "Stop"

# Set encoding to UTF8 to ensure emojis and characters display correctly in Windows terminals
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$R2Base = "https://downloads.ai-worker.tech"
$TempDir = [System.IO.Path]::GetTempPath()
# Using a fixed but fresh manifest URL to fetch the latest info
$ManifestUrl = "$R2Base/latest.yml?v=$([DateTime]::UtcNow.Ticks)"

Write-Host "🚀 AI-Worker Installer" -ForegroundColor Cyan
Write-Host "Fetching latest version info..."

# Robust manifest fetch: Force TLS 1.2+ and use Invoke-WebRequest with explicit decoding
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    
    # Try reaching the manifest with a fresh query param to bypass CDN cache
    $RawResponse = Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing -TimeoutSec 30 -Headers @{ "Cache-Control" = "no-cache" }
    
    if ($RawResponse.Content -is [System.String]) {
        $ManifestContent = $RawResponse.Content
    } else {
        $ManifestContent = [System.Text.Encoding]::UTF8.GetString($RawResponse.Content)
    }
} catch {
    Write-Host "❌ Could not fetch version info. Please check your internet connection." -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    pause
    exit 1
}

# Robust parsing: Line-by-line check to handle CRLF and indentation safely
$ExeFile = $null
$ExpectedSha = $null
$ExpectedSize = 0

foreach ($line in ($ManifestContent -split "\r?\n")) {
    $cleanLine = $line.Trim()
    
    # Prioritize top-level 'path'
    if ($line -match '^path:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    # Fallback to 'url' inside files list
    elseif (-not $ExeFile -and $line -match '^\s*-\s*url:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    
    # Extract sha512 (first one wins)
    if (-not $ExpectedSha -and $line -match 'sha512:\s*["'']?([A-Za-z0-9+/=]+)["'']?') {
        $ExpectedSha = $Matches[1].Trim()
    }
    
    # Extract size (first one wins)
    if ($ExpectedSize -eq 0 -and $line -match 'size:\s*(\d+)') {
        $ExpectedSize = [int64]$Matches[1]
    }
}

if (-not $ExeFile) {
    Write-Host "❌ Failed to identify latest installer file in manifest." -ForegroundColor Red
    pause
    exit 1
}

$DownloadUrl = "$R2Base/$ExeFile"
$DownloadUrlFallback = "$R2Base/$ExeFile?v=$([DateTime]::UtcNow.Ticks)"
$DestPath = Join-Path $TempDir $ExeFile

function Get-FileSha512Base64 {
    param([string]$Path)
    $sha = [System.Security.Cryptography.SHA512]::Create()
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $hashBytes = $sha.ComputeHash($stream)
        } finally {
            $stream.Dispose()
        }
    } finally {
        $sha.Dispose()
    }
    return [Convert]::ToBase64String($hashBytes)
}

function Validate-DownloadedFile {
    param(
        [string]$Path,
        [string]$ExpectedSha512
    )

    if (-not (Test-Path $Path)) { return $false }

    # Rely primarily on SHA512 SHA check (as size matches can be misleading due to CDN compression)
    if ($ExpectedSha512) {
        $actualSha = Get-FileSha512Base64 -Path $Path
        if ($actualSha -ne $ExpectedSha512) { 
            return $false 
        }
    }

    return $true
}

function Download-File {
    param(
        [string]$Url,
        [string]$Destination
    )

    $OriginalProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'

    try {
        # Try curl.exe first if available (native in Windows 10+/11, avoids BITS service overhead)
        $curl = (Get-Command "curl.exe" -ErrorAction SilentlyContinue)
        if ($curl) {
            $curlArgs = @("-fL", "--progress-bar", $Url, "-o", $Destination, "-H", "Cache-Control: no-cache")
            & $curl.Source @curlArgs
            if ($LASTEXITCODE -eq 0 -and (Test-Path $Destination)) { return }
        }

        # Fallback to Invoke-WebRequest with explicit cache-busting headers
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 600 -Headers @{ "Cache-Control" = "no-cache" }
    } finally {
        $ProgressPreference = $OriginalProgressPreference
    }
}

Write-Host "📦 Downloading $ExeFile..."

# Download and Validate
try {
    if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
    Download-File -Url $DownloadUrl -Destination $DestPath
} catch {
    Write-Host "   (Retrying with refresh URL...)" -ForegroundColor Yellow
    try {
        if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
        Download-File -Url $DownloadUrlFallback -Destination $DestPath
    } catch {
        Write-Host "❌ Download failed." -ForegroundColor Red
        pause
        exit 1
    }
}

# Validation Pass
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha)) {
    Write-Host "   (Validation failed, performing critical refresh...)" -ForegroundColor Yellow
    try {
        if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
        Download-File -Url $DownloadUrlFallback -Destination $DestPath
    } catch {
        Write-Host "❌ Refresh download failed." -ForegroundColor Red
        pause
        exit 1
    }
}

# Final Check
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha)) {
    Write-Host "❌ Downloaded installer checksum does not match latest manifest." -ForegroundColor Red
    pause
    exit 1
}

# Unblock file
try {
    if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
        Unblock-File -Path $DestPath
    }
} catch {}

Write-Host "🔧 Starting the installer..."
Write-Host "   (Please follow the setup instructions on your screen)"
Start-Process -FilePath $DestPath -Wait

Write-Host ""
Write-Host "✅ AI-Worker has been installed successfully!" -ForegroundColor Green
Write-Host "   You can find it in your Start Menu or Desktop."
pause
