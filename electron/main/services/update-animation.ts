/**
 * The animation that plays while Windows replaces Juno.
 *
 * The installer cannot run while Juno does, so for the stretch between the
 * application closing and the new version opening there is no Juno left to draw
 * anything. The installer's own wizard fills that gap but looks like an
 * installer. This is a small separate window instead, run by PowerShell, which
 * is on every Windows machine and lives outside the install folder, so nothing
 * of it is replaced or locked by the update.
 *
 * It starts while Juno is still open but stays invisible until Juno's process
 * has gone, so the update window Juno shows and this one take over from each
 * other in the same place. It closes when the new Juno is up, or gives up
 * after a few minutes so it can never stay on screen.
 *
 * Windows only. The other platforms swap the application without an installer
 * to wait for.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOM = String.fromCharCode(0xfeff);

export const ANIMATION_SCRIPT = String.raw`param(
  [int]$WaitForPid = 0,
  [int]$Relaunch = 1,
  [int]$GiveUpInstaller = 90,
  [string]$Version = ''
)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$light = $true
try {
  $key = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  if ($key.AppsUseLightTheme -eq 0) { $light = $false }
} catch {}

if ($light) {
  $paper = '#f6f6fa'; $ink = '#16161d'; $muted = '#8b8b9c'; $accent = '#4a3fa0'; $line = '#e3e2ec'
} else {
  $paper = '#111117'; $ink = '#eeeef5'; $muted = '#757589'; $accent = '#a79df0'; $line = '#2a2a35'
}

$xamlText = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="380" Height="260" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ResizeMode="NoResize" WindowStartupLocation="CenterScreen" Topmost="True" ShowInTaskbar="False">
  <Border CornerRadius="14" BorderThickness="1" BorderBrush="@LINE@" Background="@PAPER@">
    <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center">
      <Viewbox Width="46" Height="46" HorizontalAlignment="Center" Margin="0,0,0,14">
        <Canvas Width="32" Height="32" Name="Mark">
          <Path Data="M22.4,6.2 A9.2,9.2 0 1 0 25.8,22 A10.8,10.8 0 0 1 22.4,6.2 Z" Stroke="@ACCENT@"
                StrokeThickness="3" StrokeLineJoin="Round"/>
          <Path Data="M5.5,27.2 L26.5,27.2" Stroke="@ACCENT@" StrokeThickness="3" StrokeStartLineCap="Round"
                StrokeEndLineCap="Round"/>
          <Canvas.Triggers>
            <EventTrigger RoutedEvent="Canvas.Loaded">
              <BeginStoryboard>
                <Storyboard RepeatBehavior="Forever" AutoReverse="True">
                  <DoubleAnimation Storyboard.TargetName="Mark" Storyboard.TargetProperty="Opacity"
                                   From="1" To="0.45" Duration="0:0:1.1"/>
                </Storyboard>
              </BeginStoryboard>
            </EventTrigger>
          </Canvas.Triggers>
        </Canvas>
      </Viewbox>
      <TextBlock Text="Updating Juno" FontFamily="Segoe UI Variable Display, Segoe UI" FontSize="20"
                 FontWeight="SemiBold" Foreground="@INK@" HorizontalAlignment="Center"/>
      <TextBlock Name="Versions" Text="" FontFamily="Segoe UI" FontSize="12" Foreground="@MUTED@"
                 HorizontalAlignment="Center" Margin="0,4,0,16"/>
      <Border Width="220" Height="3" CornerRadius="2" Background="@LINE@" ClipToBounds="True">
        <Border Width="90" Height="3" CornerRadius="2" Background="@ACCENT@" HorizontalAlignment="Left">
          <Border.RenderTransform>
            <TranslateTransform x:Name="Sweep" X="-100"/>
          </Border.RenderTransform>
          <Border.Triggers>
            <EventTrigger RoutedEvent="Border.Loaded">
              <BeginStoryboard>
                <Storyboard RepeatBehavior="Forever">
                  <DoubleAnimation Storyboard.TargetName="Sweep" Storyboard.TargetProperty="X"
                                   From="-100" To="230" Duration="0:0:1.5">
                    <DoubleAnimation.EasingFunction>
                      <SineEase EasingMode="EaseInOut"/>
                    </DoubleAnimation.EasingFunction>
                  </DoubleAnimation>
                </Storyboard>
              </BeginStoryboard>
            </EventTrigger>
          </Border.Triggers>
        </Border>
      </Border>
      <TextBlock Name="Step" Text="Closing Juno" FontFamily="Segoe UI" FontSize="13" Foreground="@INK@"
                 HorizontalAlignment="Center" Margin="0,16,0,0"/>
      <TextBlock Text="Juno opens again on its own when this is done." FontFamily="Segoe UI" FontSize="12"
                 Foreground="@MUTED@" HorizontalAlignment="Center" Margin="0,6,0,0" Name="Note"/>
    </StackPanel>
  </Border>
</Window>
'@
$xamlText = $xamlText.Replace('@PAPER@', $paper).Replace('@INK@', $ink).Replace('@MUTED@', $muted).Replace('@ACCENT@', $accent).Replace('@LINE@', $line)
$window = [Windows.Markup.XamlReader]::Parse($xamlText)
$step = $window.FindName('Step')
$note = $window.FindName('Note')
$versions = $window.FindName('Versions')
$versions.Text = $Version
if ($Relaunch -eq 0) { $note.Text = 'Juno was closed, so it stays closed.' }

# Invisible until Juno itself has gone, so the window Juno showed hands over to
# this one in the same place and the two are never on screen together.
$begin = Get-Date
if ($WaitForPid -gt 0) {
  while ((Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue) -and (((Get-Date) - $begin).TotalSeconds -lt 60)) {
    Start-Sleep -Milliseconds 100
  }
  if (Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue) { exit 0 }
}

$shown = Get-Date
$installerSeen = $false
$installerGone = $null
$window.Add_Loaded({ $window.Opacity = 1 })

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(400)
$timer.Add_Tick({
  $now = Get-Date
  $running = Get-Process -Name 'Juno-Setup*' -ErrorAction SilentlyContinue
  if ($running) {
    $script:installerSeen = $true
    $script:installerGone = $null
    $step.Text = 'Installing the update'
  } elseif ($script:installerSeen) {
    if (-not $script:installerGone) { $script:installerGone = $now }
    $step.Text = 'Starting Juno'
  }
  $fresh = $null
  if ($script:installerSeen -and $script:installerGone) {
    $fresh = Get-Process -Name 'Juno' -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt $shown }
  }
  $done = $false
  if ($script:installerSeen -and $script:installerGone) {
    if ($Relaunch -eq 1 -and $fresh) { $done = $true }
    if ($Relaunch -eq 0 -and (($now - $script:installerGone).TotalSeconds -gt 1)) { $done = $true }
    if (($now - $script:installerGone).TotalSeconds -gt 25) { $done = $true }
  }
  if (-not $script:installerSeen -and (($now - $shown).TotalSeconds -gt $GiveUpInstaller)) { $done = $true }
  if (($now - $shown).TotalMinutes -gt 10) { $done = $true }
  if ($done) { $timer.Stop(); $window.Close() }
})
$timer.Start()
[void]$window.ShowDialog()
`;

/**
 * Starts the animation, if this platform needs one. Called before the
 * application hands over to the installer, with the process that is about to
 * exit, so the window can appear the moment it is gone.
 */
export function startInstallAnimation(options: { relaunch: boolean; version: string | null }): void {
	if (process.platform !== "win32") return;
	try {
		const file = join(tmpdir(), "juno-update-animation.ps1");
		// A byte order mark, because Windows PowerShell 5.1 reads a script
		// without one in the legacy code page.
		writeFileSync(file, BOM + ANIMATION_SCRIPT, "utf8");
		const child = spawn(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-STA",
				"-WindowStyle",
				"Hidden",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				file,
				"-WaitForPid",
				String(process.pid),
				"-Relaunch",
				options.relaunch ? "1" : "0",
				"-Version",
				options.version ?? "",
			],
			{ detached: true, stdio: "ignore", windowsHide: true },
		);
		child.unref();
	} catch {
		// Without it the update still installs, just with nothing on screen.
	}
}
