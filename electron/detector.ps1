$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# LyricVista Unified Detector
# Three-layer detection pipeline for music playback on Windows
# Layer 1: SMTC - for apps that register with Windows (KuGou, Spotify, etc.)
# Layer 2: Window title - for Chinese music apps without SMTC (NetEase, QQMusic, etc.)
# Outputs JSON to stdout on success, empty on failure

$ErrorActionPreference = 'SilentlyContinue'

function Test-KuGouSource($source) {
    if (-not $source) { return $false }
    return ($source -match '(?i)kugou|kgmusic')
}

function Get-KuGouPosition {
    $paths = @(
        (Join-Path $env:APPDATA 'KuGou8\KuGou.ini'),
        (Join-Path $env:PROGRAMDATA 'KuGou\KuGou8\KuGou.ini')
    )

    foreach ($iniPath in $paths) {
        try {
            if (-not (Test-Path -LiteralPath $iniPath)) { continue }
            $line = Get-Content -LiteralPath $iniPath -ErrorAction Stop |
                Where-Object { $_ -match '^\s*LastPlayingSongPos=(\d+)\s*$' } |
                Select-Object -First 1

            if ($line -match '^\s*LastPlayingSongPos=(\d+)\s*$') {
                $positionMs = [int64]$Matches[1]
                if ($positionMs -lt 0) { continue }
                $file = Get-Item -LiteralPath $iniPath -ErrorAction Stop
                return [PSCustomObject]@{
                    positionSeconds = [math]::Round($positionMs / 1000, 1)
                    positionMs      = $positionMs
                    path            = $iniPath
                    updatedAt       = $file.LastWriteTimeUtc.ToString("o")
                }
            }
        } catch {}
    }

    return $null
}

function Set-PropertyValue($target, $name, $value) {
    if ($target.PSObject.Properties.Name -contains $name) {
        $target.$name = $value
    } else {
        $target | Add-Member -NotePropertyName $name -NotePropertyValue $value
    }
}

function Add-KuGouPosition($info) {
    if (-not $info) { return $info }
    if (-not (Test-KuGouSource $info.source)) { return $info }

    $kgPosition = Get-KuGouPosition
    if (-not $kgPosition) { return $info }

    $info.position = $kgPosition.positionSeconds
    Set-PropertyValue $info "positionSource" "kugou_ini"
    Set-PropertyValue $info "kugouPositionMs" $kgPosition.positionMs
    Set-PropertyValue $info "kugouPositionUpdatedAt" $kgPosition.updatedAt

    if ($info.method -notmatch 'kugou_ini') {
        $info.method = "$($info.method)+kugou_ini"
    }

    return $info
}

# ═══════════════════════════════════════════════════════════
# Layer 1: SMTC Detection
# ═══════════════════════════════════════════════════════════

function Invoke-SMTC {
    if (-not $script:AsTaskGeneric) {
        $script:AsTaskGeneric = $null
    }

    try {
        if (-not $script:AsTaskGeneric) {
            Add-Type -AssemblyName System.Runtime.WindowsRuntime
            $methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
            foreach ($m in $methods) {
                try {
                    if ($m.Name -eq 'AsTask' -and $m.GetParameters().Count -eq 1) {
                        $p = $m.GetParameters()[0]
                        if ($p.ParameterType.Name -eq 'IAsyncOperation`1') {
                            $script:AsTaskGeneric = $m
                            break
                        }
                    }
                } catch {}
            }
        }
    } catch {}

    if (-not $script:AsTaskGeneric) { return $null }

    function AwaitInternal($asyncOp, $resultType) {
        $asTask = $script:AsTaskGeneric.MakeGenericMethod($resultType)
        $task = $asTask.Invoke($null, @($asyncOp))
        $task.GetAwaiter().GetResult()
    }

    function Get-SMTCSession($session) {
        try {
            $mediaProps = AwaitInternal ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $playbackInfo = $session.GetPlaybackInfo()
            $timeline = $session.GetTimelineProperties()

            $title = if ($mediaProps.Title) { $mediaProps.Title } else { "" }
            $artist = if ($mediaProps.Artist) { $mediaProps.Artist } else { "" }
            if (-not $title -and -not $artist) { return $null }

            $statusText = switch ($playbackInfo.PlaybackStatus) {
                Playing { "Playing" }
                Paused  { "Paused" }
                Stopped { "Stopped" }
                Closed  { "Stopped" }
                default { "Unknown" }
            }
            if ($statusText -eq "Stopped" -or $statusText -eq "Closed") { return $null }

            $pos = 0; $tStart = 0; $tEnd = 0
            try {
                $tStart = if ($timeline.StartTime) { $timeline.StartTime.TotalSeconds } else { 0 }
                $tEnd   = if ($timeline.EndTime)   { $timeline.EndTime.TotalSeconds }   else { 0 }
                $pos    = if ($timeline.Position)   { $timeline.Position.TotalSeconds }   else { 0 }
            } catch {}

            $appSource = ""
            try { $appSource = $session.SourceAppUserModelId } catch {}

            return [PSCustomObject]@{
                title         = $title
                artist        = $artist
                status        = $statusText
                position      = [math]::Round($pos, 1)
                timelineStart = [math]::Round($tStart, 1)
                timelineEnd   = [math]::Round($tEnd, 1)
                source        = $appSource
                method        = "smtc"
            }
        } catch { return $null }
    }

    try {
        [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
        $manager = AwaitInternal ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

        $sessions = $manager.GetSessions()
        foreach ($s in $sessions) {
            $info = Get-SMTCSession $s
            if ($info) { return $info }
        }

        $current = $manager.GetCurrentSession()
        if ($current) {
            $info = Get-SMTCSession $current
            if ($info) { return $info }
        }
    } catch {}

    return $null
}

$smtcResult = Invoke-SMTC
if ($smtcResult) {
    $smtcResult = Add-KuGouPosition $smtcResult
    Write-Output ($smtcResult | ConvertTo-Json -Compress)
    return
}

# ═══════════════════════════════════════════════════════════
# Layer 2: Window Title Scanner
# ═══════════════════════════════════════════════════════════

$csCode = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class WinHelper {
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWinProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint procId);

    private delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);

    public static string GetTitle(IntPtr hWnd) {
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, 512);
        return sb.ToString();
    }

    public static uint GetProcId(IntPtr hWnd) {
        uint p;
        GetWindowThreadProcessId(hWnd, out p);
        return p;
    }

    public static List<IntPtr> GetVisibleWindows() {
        var list = new List<IntPtr>();
        EnumWindows((h, _) => { if (IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }
}
'@

try {
    if (-not ('WinHelper' -as [type])) {
        Add-Type -TypeDefinition $csCode -Language CSharp
    }
} catch {
    return
}

# Known music player process names
$PLAYERS = @{
    "cloudmusic" = $true
    "QQMusic"    = $true
    "kwmusic"    = $true
    "kugou"      = $true
    "foobar2000" = $true
    "Spotify"    = $true
    "Deezer"     = $true
    "TIDAL"      = $true
    "wmplayer"   = $true
    "Music"      = $true
}

function Parse-WindowTitle($raw) {
    # Remove known trailing app suffixes: " - cloudmusic", " - QQMusic", etc.
    $t = $raw -replace '\s*[-–—]\s*(cloudmusic|QQMusic|kwmusic|kugou|foobar2000|Spotify|Deezer|TIDAL|wmplayer|Music)\s*$', ''
    # Also remove any remaining trailing dash-only residue
    $t = $t -replace '\s*[-–—]\s*$', ''
    $t = $t.Trim()
    if (-not $t) { return $null }

    # Split on " - " (space-dash-space) - most common format
    $idx = $t.IndexOf(' - ')
    if ($idx -gt 0) {
        $song = $t.Substring(0, $idx).Trim()
        $artist = $t.Substring($idx + 3).Trim()
        if ($song -and $artist) {
            return @{ Title = $song; Artist = $artist }
        }
    }

    # Try other dash variants: en-dash, em-dash
    foreach ($d in @(' – ', ' — ', ' | ', ' · ', ' ~ ')) {
        $di = $t.IndexOf($d)
        if ($di -gt 0) {
            $song = $t.Substring(0, $di).Trim()
            $artist = $t.Substring($di + $d.Length).Trim()
            if ($song -and $artist) {
                return @{ Title = $song; Artist = $artist }
            }
        }
    }

    # Single piece with no dash: treat as song title if reasonably long
    # Short titles (< 4 chars) are likely just the app name itself
    if ($t.Length -ge 4) {
        return @{ Title = $t; Artist = "" }
    }
    return $null
}

# Scan all visible windows
try {
    $windows = [WinHelper]::GetVisibleWindows()
    foreach ($w in $windows) {
        $wProcId = [WinHelper]::GetProcId($w)
        $title = [WinHelper]::GetTitle($w)
        if (-not $title) { continue }

        try {
            $proc = Get-Process -Id $wProcId -ErrorAction Stop
        } catch { continue }

        $procName = $proc.ProcessName
        if (-not $PLAYERS.ContainsKey($procName)) { continue }

        $parsed = Parse-WindowTitle $title
        if (-not $parsed -or $parsed.Title.Length -eq 0) { continue }

        $windowResult = [PSCustomObject]@{
            title         = $parsed.Title
            artist        = $parsed.Artist
            status        = "Playing"
            position      = 0
            timelineStart = 0
            timelineEnd   = 0
            source        = $procName
            method        = "window"
        }
        $windowResult = Add-KuGouPosition $windowResult

        Write-Output ($windowResult | ConvertTo-Json -Compress)
        return
    }
} catch {}

return
