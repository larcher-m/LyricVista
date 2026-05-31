# SMTC Query Script for LyricVista
# Queries Windows SystemMediaTransportControls for current playback info
# Outputs JSON to stdout, or empty string if nothing is playing

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($asyncOp, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $task = $asTask.Invoke($null, @($asyncOp))
    $task.GetAwaiter().GetResult()
}

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $session = $manager.GetCurrentSession()
    if (-not $session) {
        exit 0
    }

    $mediaProps = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $playbackInfo = $session.GetPlaybackInfo()
    $timeline = $session.GetTimelineProperties()

    $status = switch ($playbackInfo.PlaybackStatus) {
        Playing { "Playing" }
        Paused  { "Paused" }
        Stopped { "Stopped" }
        Closed  { "Stopped" }
        default { "Unknown" }
    }

    $pos = 0
    $tStart = 0
    $tEnd = 0
    try {
        $tStart = if ($timeline.StartTime) { $timeline.StartTime.TotalSeconds } else { 0 }
        $tEnd = if ($timeline.EndTime) { $timeline.EndTime.TotalSeconds } else { 0 }
        $pos = if ($timeline.Position) { $timeline.Position.TotalSeconds } else { 0 }
    } catch {}

    $source = ""
    try {
        $source = $session.SourceAppUserModelId
    } catch {}

    $result = [PSCustomObject]@{
        title         = if ($mediaProps.Title) { $mediaProps.Title } else { "" }
        artist        = if ($mediaProps.Artist) { $mediaProps.Artist } else { "" }
        status        = $status
        position      = [math]::Round($pos, 1)
        timelineStart = [math]::Round($tStart, 1)
        timelineEnd   = [math]::Round($tEnd, 1)
        source        = $source
    }

    Write-Output ($result | ConvertTo-Json -Compress)
} catch {
    exit 0
}
