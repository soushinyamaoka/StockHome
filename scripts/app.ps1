<#
.SYNOPSIS
  StockHome のローカル開発環境（PostgreSQL / API / Expo）を一括で起動・停止・再起動する。

.DESCRIPTION
  start [vps|local] : アプリ（Expo）を起動する。
                      vps   (既定): VPS の API/DB に接続。Docker もローカル API も起動しない。
                      local       : PostgreSQL(Docker) と ローカル API を起動し、Expo をローカル API に接続する。
  stop              : API と Expo のウィンドウを終了し、（起動していれば）PostgreSQL を停止する。
  restart [vps|local]: stop してから start する。
  status            : 各サービスの稼働状況を表示する。

.EXAMPLE
  npm run app:start          # vps モード（既定）
  npm run app:start:local    # local モード（Docker + ローカル API）
  npm run app:stop
  npm run app:restart
  npm run app:status
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Command = 'start',

  [Parameter(Position = 1)]
  [ValidateSet('vps', 'local')]
  [string]$Target = 'vps'
)

$ErrorActionPreference = 'Stop'

# scripts/ の親 = プロジェクトルート
$Root = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $Root '.run'
$ApiPidFile = Join-Path $RunDir 'api.pid'
$ExpoPidFile = Join-Path $RunDir 'expo.pid'

function Ensure-RunDir {
  if (-not (Test-Path $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir | Out-Null
  }
}

# 指定した npm script を新しい PowerShell ウィンドウで起動し、その PID を記録する。
# $EnvVars を渡すと、そのウィンドウ内で環境変数を設定してから npm script を実行する。
function Start-ServiceWindow {
  param(
    [string]$Title,
    [string]$NpmScript,
    [string]$PidFile,
    [hashtable]$EnvVars
  )
  $envPrefix = ''
  if ($EnvVars) {
    foreach ($key in $EnvVars.Keys) {
      $envPrefix += "`$env:$key = '$($EnvVars[$key])'; "
    }
  }
  $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Root'; ${envPrefix}npm run $NpmScript"
  $proc = Start-Process powershell -PassThru -ArgumentList @('-NoExit', '-Command', $inner)
  $proc.Id | Out-File -FilePath $PidFile -Encoding ascii
  Write-Host ("  {0} を起動しました (PID {1})" -f $Title, $proc.Id) -ForegroundColor Green
}

# Docker デーモンに接続できるか（Docker Desktop が起動しているか）を判定する
function Test-DockerRunning {
  try {
    & docker info *> $null
    return ($LASTEXITCODE -eq 0)
  }
  catch {
    return $false
  }
}

# Docker Desktop の実行ファイルを既知のインストール先から探す
function Get-DockerDesktopPath {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path $path)) {
      return $path
    }
  }
  return $null
}

# Docker デーモンが未応答なら Docker Desktop を起動し、応答するまで待機する
function Ensure-DockerRunning {
  param([int]$TimeoutSec = 180)

  if (Test-DockerRunning) {
    Write-Host 'Docker デーモンは応答しています。' -ForegroundColor DarkGray
    return
  }

  if (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue) {
    Write-Host 'Docker Desktop は起動処理中です。デーモンの応答を待ちます...' -ForegroundColor Cyan
  }
  else {
    $exe = Get-DockerDesktopPath
    if (-not $exe) {
      throw 'Docker Desktop の実行ファイルが見つかりませんでした。手動で起動してから再実行してください。'
    }
    Write-Host 'Docker Desktop を起動しています...' -ForegroundColor Cyan
    Start-Process -FilePath $exe | Out-Null
  }

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    Start-Sleep -Seconds 3
    if (Test-DockerRunning) {
      Write-Host ('Docker デーモンが応答しました（約 {0:N0} 秒）。' -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
      return
    }
    Write-Host '  Docker の起動を待機中...' -ForegroundColor DarkGray
  }
  throw ('Docker の起動がタイムアウトしました（{0} 秒）。Docker Desktop の状態を確認してください。' -f $TimeoutSec)
}

# PID ファイルに記録されたプロセスを子プロセスごと終了する
function Stop-ByPidFile {
  param(
    [string]$PidFile,
    [string]$Name
  )
  if (-not (Test-Path $PidFile)) {
    Write-Host ("  {0}: 起動記録がありません（スキップ）" -f $Name) -ForegroundColor DarkGray
    return
  }
  $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
  if ($procId) {
    # /T で子プロセスツリーごと、/F で強制終了。既に閉じている場合のエラーは無視。
    & taskkill /PID $procId /T /F 2>$null | Out-Null
    Write-Host ("  {0} を停止しました (PID {1})" -f $Name, $procId) -ForegroundColor Yellow
  }
  Remove-Item $PidFile -Force
}

# PID ファイルのプロセスが生きているか判定して表示
function Show-PidStatus {
  param(
    [string]$PidFile,
    [string]$Name
  )
  if (-not (Test-Path $PidFile)) {
    Write-Host ("  {0,-6}: 停止" -f $Name) -ForegroundColor DarkGray
    return
  }
  $procId = (Get-Content $PidFile | Select-Object -First 1).Trim()
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host ("  {0,-6}: 稼働中 (PID {1})" -f $Name, $procId) -ForegroundColor Green
  }
  else {
    Write-Host ("  {0,-6}: 停止（プロセス無し・記録のみ残存）" -f $Name) -ForegroundColor DarkYellow
  }
}

function Do-Start {
  param(
    [ValidateSet('vps', 'local')]
    [string]$Target = 'vps'
  )
  Ensure-RunDir
  Set-Location $Root

  if ($Target -eq 'local') {
    Ensure-DockerRunning

    Write-Host 'PostgreSQL (Docker) を起動中... [local モード]' -ForegroundColor Cyan
    & docker compose up -d
    if ($LASTEXITCODE -ne 0) {
      throw 'docker compose の起動に失敗しました。Docker のログを確認してください。'
    }

    Write-Host 'ローカル API / Expo を別ウィンドウで起動中...' -ForegroundColor Cyan
    Start-ServiceWindow -Title 'StockHome API'          -NpmScript 'api:dev'      -PidFile $ApiPidFile
    Start-ServiceWindow -Title 'StockHome Expo (local)' -NpmScript 'mobile:start' -PidFile $ExpoPidFile -EnvVars @{ EXPO_PUBLIC_API_TARGET = 'local' }

    Write-Host ''
    Write-Host '起動しました。[local モード] アプリはローカル API（PCのLAN IP:4002）を参照します。' -ForegroundColor Green
    Write-Host '  - API ヘルスチェック: http://localhost:4002/health'
    Write-Host '  - 実機接続にはスマホとPCを同一 Wi-Fi に接続してください'
    Write-Host '  - Expo: 別ウィンドウの QR コードを Expo Go で読み取ってください'
  }
  else {
    Write-Host 'Expo を別ウィンドウで起動中... [vps モード / Docker・ローカル API は起動しません]' -ForegroundColor Cyan
    Start-ServiceWindow -Title 'StockHome Expo (vps)' -NpmScript 'mobile:start' -PidFile $ExpoPidFile -EnvVars @{ EXPO_PUBLIC_API_TARGET = 'vps' }

    Write-Host ''
    Write-Host '起動しました。[vps モード] アプリは VPS の API を参照します。' -ForegroundColor Green
    Write-Host '  - Expo: 別ウィンドウの QR コードを Expo Go で読み取ってください'
  }
}

function Do-Stop {
  Write-Host 'API / Expo を停止中...' -ForegroundColor Cyan
  Stop-ByPidFile -PidFile $ExpoPidFile -Name 'Expo'
  Stop-ByPidFile -PidFile $ApiPidFile  -Name 'API'

  if (Test-DockerRunning) {
    Write-Host 'PostgreSQL (Docker) を停止中...' -ForegroundColor Cyan
    Set-Location $Root
    & docker compose down
  }
  else {
    Write-Host 'PostgreSQL (Docker): 未起動のためスキップ' -ForegroundColor DarkGray
  }

  Write-Host ''
  Write-Host '停止しました。' -ForegroundColor Green
}

function Do-Status {
  Write-Host '=== StockHome サービス状況 ===' -ForegroundColor Cyan
  Show-PidStatus -PidFile $ApiPidFile  -Name 'API'
  Show-PidStatus -PidFile $ExpoPidFile -Name 'Expo'
  if (Test-DockerRunning) {
    Write-Host '  PostgreSQL (Docker):'
    Set-Location $Root
    & docker compose ps
  }
  else {
    Write-Host '  PostgreSQL (Docker): 停止（Docker 未起動）' -ForegroundColor DarkGray
  }
}

switch ($Command) {
  'start' { Do-Start -Target $Target }
  'stop' { Do-Stop }
  'restart' {
    Do-Stop
    Write-Host ''
    Do-Start -Target $Target
  }
  'status' { Do-Status }
}

