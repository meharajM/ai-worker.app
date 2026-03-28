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
$ManifestUrl = "$R2Base/latest.yml"

Write-Host "🚀 AI-Worker Installer" -ForegroundColor Cyan
Write-Host "Fetching latest version info..."

# Robust fetch: Set SecurityProtocol and use Invoke-WebRequest with explicit decoding if needed
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    
    # Use Invoke-RestMethod for auto-decoding text, fallback if it returns unexpected types
    $Response = Invoke-RestMethod -Uri $ManifestUrl -UseBasicParsing -TimeoutSec 30
    
    if ($Response -is [string]) {
        $ManifestContent = $Response
    } else {
        # If PS returns an object (dictionary) or bytes, try to get raw content
        $RawResponse = Invoke-WebRequest -Uri $ManifestUrl -UseBasicParsing -TimeoutSec 30
        if ($RawResponse.Content -is [System.String]) {
            $ManifestContent = $RawResponse.Content
        } else {
            $ManifestContent = [System.Text.Encoding]::UTF8.GetString($RawResponse.Content)
        }
    }
} catch {
    Write-Host "❌ Could not fetch version info. Please check your internet connection." -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    pause
    exit 1
}

# Robust parsing: Look for fields anywhere in the file but prioritize top-level matches
$ExeFile = $null
$ExpectedSha = $null
$ExpectedSize = 0

# Extract fields using line-by-line check to handle CRLF and indentation safely
foreach ($line in ($ManifestContent -split "\r?\n")) {
    $cleanLine = $line.Trim()
    
    # Try to find 'path' (top-level preference)
    if ($line -match '^path:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    # Fallback to 'url' inside files list if path isn't found yet
    elseif (-not $ExeFile -and $line -match '^\s*-\s*url:\s*["'']?([^"''\r\n]+\.exe)["'']?') {
        $ExeFile = $Matches[1].Trim()
    }
    
    # Extract sha512 (takes first one found)
    if (-not $ExpectedSha -and $line -match 'sha512:\s*["'']?([A-Za-z0-9+/=]+)["'']?') {
        $ExpectedSha = $Matches[1].Trim()
    }
    
    # Extract size (takes first one found)
    if ($ExpectedSize -eq 0 -and $line -match 'size:\s*(\d+)') {
        $ExpectedSize = [int64]$Matches[1]
    }
}

if (-not $ExeFile) {
    Write-Host "❌ Could not determine the latest build filename from manifest." -ForegroundColor Red
    # Debug info for the user if it fails
    Write-Host "--- Manifest Content Preview ---" -ForegroundColor Gray
    Write-Host ($ManifestContent.SubString(0, [Math]::Min(200, $ManifestContent.Length))) -ForegroundColor Gray
    pause
    exit 1
}

$DownloadUrl = "$R2Base/$ExeFile"
# Use Ticks for cache busting
$CacheBust = (Get-Date).Ticks
$DownloadUrlFallback = "$R2Base/$ExeFile?v=$CacheBust"
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
        [string]$ExpectedSha512,
        [Int64]$ExpectedBytes
    )

    if (-not (Test-Path $Path)) { return $false }

    # Validate size first (fast)
    if ($ExpectedBytes -gt 0) {
        $actualBytes = (Get-Item $Path).Length
        if ($actualBytes -ne $ExpectedBytes) { 
            Write-Host "   (Size mismatch: expected $ExpectedBytes, got $actualBytes)" -ForegroundColor Gray
            return $false 
        }
    }

    # Validate checksum (slow but certain)
    if ($ExpectedSha512) {
        $actualSha = Get-FileSha512Base64 -Path $Path
        if ($actualSha -ne $ExpectedSha512) { 
            Write-Host "   (Checksum mismatch)" -ForegroundColor Gray
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

    # Disable PowerShell's progress bar (which notably slows down large file downloads by 10x)
    $OriginalProgressPreference = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'

    try {
        # Try BITS first - it utilizes multiple connections natively and is generally more efficient
        try {
            Start-BitsTransfer -Source $Url -Destination $Destination -ErrorAction Stop
            return
        } catch {
            # BITS failed, fallback to Invoke-WebRequest
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 300
        }
    } finally {
        $ProgressPreference = $OriginalProgressPreference
    }
}

Write-Host "📦 Downloading $ExeFile..."

# Primary download attempt
try {
    if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
    Download-File -Url $DownloadUrl -Destination $DestPath
} catch {
    Write-Host "   (Primary download failed, retrying with cache-busting...)" -ForegroundColor Yellow
    try {
        if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
        Download-File -Url $DownloadUrlFallback -Destination $DestPath
    } catch {
        Write-Host "❌ Failed to download installer from all available sources." -ForegroundColor Red
        pause
        exit 1
    }
}

# If the file exists but doesn't match checksum (possibly CDN cache issue), retry once with cache-busting
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha -ExpectedBytes $ExpectedSize)) {
    Write-Host "   (Verification failed, retrying download with refresh...)" -ForegroundColor Yellow
    try {
        if (Test-Path $DestPath) { Remove-Item $DestPath -Force }
        Download-File -Url $DownloadUrlFallback -Destination $DestPath
    } catch {
        Write-Host "❌ Retry download failed." -ForegroundColor Red
        pause
        exit 1
    }
}

# Final validation pass
if (-not (Validate-DownloadedFile -Path $DestPath -ExpectedSha512 $ExpectedSha -ExpectedBytes $ExpectedSize)) {
    Write-Host "❌ Downloaded installer is corrupt or does not match manifest information." -ForegroundColor Red
    pause
    exit 1
}

# Remove the Zone.Identifier alternate data stream (Mark of the Web) to prevent security prompts
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
