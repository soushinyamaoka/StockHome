<#
.SYNOPSIS
  StockHome の API を VPS（ssh エイリアス `vps`）へ再デプロイする。

.DESCRIPTION
  固定した1つの commit から artifact を作り、その commit hash を immutable tag
  （`stockhome-api:git-<40桁commit>`）として build・切替する。

  1. 対象 commit を解決し、実remote `origin/main` に存在することを確認する。
  2. `git archive` でその commit の内容だけを tar.gz にする（working tree の
     未コミット変更は原理的に混入しない。追跡外の `.env` も同様）。
  3. scp で VPS の ~/stockhome へ転送し、展開する。
  4. VPS 上で `scripts/vps-deploy-runner.sh` を実行する。runner 側が
     deploy 排他 lock・build・切替・health matrix 確認・成功時 cleanup・
     失敗時の previous image への自動 rollback までを担う。

  health matrix は internal/public の `/health`(200) と `/api/bridge/health`(401)
  の 4 点で、deploy 成功時と rollback 後の双方で確認する。

  VPS 側の `.env`（本番秘密情報）・DB・volume は送信/変更しない。
  Prisma migration がある場合はコンテナ起動時に `prisma migrate deploy` が自動適用する。

.PARAMETER Commit
  build 対象の commit（既定: 現在の HEAD）。full SHA へ解決され、`origin/main` に
  含まれることを検証する。含まれない場合はデプロイしない。

.PARAMETER DryRun
  転送・デプロイは行わず、作成した tar.gz の中身一覧だけ表示する（送信内容の確認用）。

.PARAMETER NoCache
  Docker イメージをキャッシュ無しで再ビルドする（通常は不要）。

.PARAMETER RollbackTo
  通常デプロイの代わりに、VPS 上に保持されている `stockhome-api:git-<commit>` へ
  切り替える（40桁のフル commit hash を指定）。ソースの転送・再ビルドは行わない。
  直近3世代より前の commit は削除済みの可能性がある（無ければエラーで停止）。

.EXAMPLE
  npm run deploy
  npm run deploy -- -DryRun
  npm run deploy -- -Commit 0123456789abcdef0123456789abcdef01234567
  npm run deploy -- -RollbackTo 0123456789abcdef0123456789abcdef01234567
#>
param(
  [string]$Commit,
  [switch]$DryRun,
  [switch]$NoCache,
  [string]$RollbackTo
)

$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$Remote     = 'vps'
$RemoteDir  = 'stockhome'
$Tarball    = 'deploy.tgz'
$RunnerPath = 'scripts/vps-deploy-runner.sh'
$KeepImages = 3

# runner が返す DEPLOY_RESULT を人間向けの説明にする
$ResultText = @{
  'success'                                          = 'デプロイ成功（health matrix 4点すべて期待どおり）'
  'rollback_success'                                 = 'ロールバック成功（health matrix 4点すべて期待どおり）'
  'lock_failed'                                      = '他のデプロイ/ロールバックが進行中のため中止しました（何も変更していません）'
  'build_failed'                                     = 'VPS でのビルドに失敗しました（切替前に停止、現行コンテナは無変更）'
  'up_failed_no_previous_image'                      = 'コンテナ起動に失敗し、ロールバック先も特定できませんでした'
  'rollback_target_missing'                          = '指定した commit のイメージが VPS 上に存在しません（保持は直近3世代のみ）'
  'health_failed_no_previous_image'                  = 'health 確認に失敗しましたが、ロールバック先を特定できませんでした'
  'rolled_back_to_previous'                          = 'health 確認に失敗したため、直前のイメージへ自動ロールバックしました（復旧後の health matrix は正常）'
  'rollback_up_failed'                               = 'ロールバックのコンテナ起動に失敗しました'
  'rollback_health_failed'                           = 'ロールバック後の health 確認に失敗しました'
  'rollback_health_failed_manual_intervention_required' = 'ロールバックを試みましたが復旧できませんでした。手動対応が必要です'
}

function Invoke-Runner([string[]]$RunnerArgs) {
  $argLine = $RunnerArgs -join ' '
  $cmd = "cd $RemoteDir && bash $RunnerPath $argLine"
  Write-Host "== VPS で runner を実行中 ==" -ForegroundColor Cyan
  $output = ssh $Remote $cmd 2>&1
  $sshExit = $LASTEXITCODE
  $output | ForEach-Object { Write-Host "  $_" }

  $resultLine = $output | Where-Object { $_ -match '^DEPLOY_RESULT=' } | Select-Object -Last 1
  $result = if ($resultLine) { ($resultLine -replace '^DEPLOY_RESULT=', '').Trim() } else { '' }

  if (-not $result) {
    throw "runner から DEPLOY_RESULT を取得できませんでした（ssh exit=$sshExit）。VPS 側の状態を手動で確認してください。"
  }

  $text = if ($ResultText.ContainsKey($result)) { $ResultText[$result] } else { $result }
  if ($result -eq 'success' -or $result -eq 'rollback_success') {
    Write-Host "  OK — $text" -ForegroundColor Green
  }
  else {
    throw "$text（DEPLOY_RESULT=$result, ssh exit=$sshExit）"
  }
}

Push-Location $Root
try {
  # --- ロールバック専用パス -------------------------------------------------
  if ($RollbackTo) {
    if ($RollbackTo -notmatch '^[0-9a-f]{40}$') {
      throw 'RollbackTo には 40桁のフル commit hash を指定してください（git log --format=%H 等で確認）。'
    }
    Write-Host "== ロールバック: stockhome-api:git-$RollbackTo へ切り替え ==" -ForegroundColor Cyan
    Invoke-Runner @('--rollback-only', '--tag', "git-$RollbackTo")
    return
  }

  # --- 1. 対象 commit の解決と origin/main 上での存在確認 --------------------
  Write-Host '== [1/4] 対象 commit を確認中 ==' -ForegroundColor Cyan
  $target = if ($Commit) { $Commit } else { 'HEAD' }
  $CommitHash = (git rev-parse --verify "$target^{commit}" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $CommitHash) { throw "commit を解決できませんでした: $target" }
  $CommitHash = $CommitHash.Trim()
  if ($CommitHash -notmatch '^[0-9a-f]{40}$') { throw "commit hash の形式が不正です: $CommitHash" }

  # 実remote の最新を取得してから、対象 commit が origin/main に含まれるか検証する。
  # （ローカルにだけ存在する commit や、push 前の commit をデプロイしないため）
  git fetch origin main --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main に失敗しました。' }
  git merge-base --is-ancestor $CommitHash origin/main
  if ($LASTEXITCODE -ne 0) {
    throw "commit $CommitHash は origin/main に含まれていません。push してから再実行してください（未 push の変更はデプロイできません）。"
  }
  $ImageTag = "git-$CommitHash"
  Write-Host "  対象 commit: $CommitHash" -ForegroundColor Green
  Write-Host "  image tag  : stockhome-api:$ImageTag" -ForegroundColor Green

  # --- 2. artifact 作成（固定 commit の内容のみ） ---------------------------
  # git archive は commit に含まれる追跡ファイルだけを出力するため、working tree の
  # 未コミット変更・未追跡ファイル・gitignore 済みの .env は原理的に混入しない。
  Write-Host '== [2/4] artifact を作成中（git archive）==' -ForegroundColor Cyan
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }

  # Docker ビルドコンテキストが必要とするファイル群 + VPS 実行用 runner
  $paths = @(
    'package.json',
    'package-lock.json',
    'packages/shared',
    'apps/api',
    'apps/mobile/package.json',
    'docker-compose.prod.yml',
    '.dockerignore',
    $RunnerPath,
    ':(exclude)apps/api/.env.example'
  )

  git archive --format=tar.gz -o $Tarball $CommitHash -- @paths
  if ($LASTEXITCODE -ne 0) { throw 'git archive に失敗しました。' }
  Write-Host ('  {0} を作成 ({1:N0} bytes)' -f $Tarball, (Get-Item $Tarball).Length) -ForegroundColor Green

  # runner が artifact に含まれていること（= 対象 commit にコミット済みであること）を確認する
  $entries = tar --force-local -tzf $Tarball
  if ($entries -notcontains $RunnerPath) {
    throw "$RunnerPath が commit $CommitHash に含まれていません。runner を commit してから再実行してください。"
  }
  $leaked = $entries | Where-Object { $_ -match '(^|/)\.env($|\.)' -or $_ -match 'node_modules' }
  if ($leaked) { throw "artifact に含めてはいけないファイルが含まれています: $($leaked -join ', ')" }

  if ($DryRun) {
    Write-Host '== DryRun: 送信内容 ==' -ForegroundColor Yellow
    $entries | ForEach-Object { Write-Host "  $_" }
    return
  }

  # --- 3. 転送 --------------------------------------------------------------
  Write-Host '== [3/4] VPS へ転送中 ==' -ForegroundColor Cyan
  scp $Tarball ("{0}:{1}/{2}" -f $Remote, $RemoteDir, $Tarball)
  if ($LASTEXITCODE -ne 0) { throw 'scp 転送に失敗しました。' }

  ssh $Remote "set -e; cd $RemoteDir; tar -xzf $Tarball; rm -f $Tarball"
  if ($LASTEXITCODE -ne 0) { throw 'VPS 上での展開に失敗しました。' }

  # --- 4. runner 実行（lock・build・切替・health・cleanup/自動rollback）-----
  Write-Host '== [4/4] build・切替・health 確認 ==' -ForegroundColor Cyan
  $runnerArgs = @('--tag', $ImageTag, '--keep', "$KeepImages")
  if ($NoCache) { $runnerArgs += '--no-cache' }
  Invoke-Runner $runnerArgs
}
finally {
  if (Test-Path $Tarball) { Remove-Item $Tarball -Force }
  Pop-Location
}
