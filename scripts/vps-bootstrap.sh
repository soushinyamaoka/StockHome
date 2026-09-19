#!/bin/bash
# StockHome deploy bootstrap（VPS上、$HOME/stockhome直下に固定pathで配置して実行する）。
#
# 責務はlock取得とtarball展開のみ。build/切替/health/cleanupは、展開先
# （releases/<tag>）に含まれるそのcommit時点のvps-deploy-runner.shへ委譲する。
#
# 呼び出し例（tarballはstdin経由で渡す。deploy.ps1が `cmd /c "ssh ... < tarball"` で呼ぶ）:
#   bash vps-bootstrap.sh --tag git-<40桁commit> --keep 3 [--no-cache] [--no-build] < deploy.tgz
#
# lock取得前にはtarballの展開を一切開始しない（VPS管理レビュー指摘: 転送・展開も
# lock対象にする）。展開先は毎回 `rm -rf` してから使うため、削除済みのはずの
# fileが前回の展開分として残り続けることもない。
#
# このscript自体は毎回deploy.ps1から対象commitの内容で上書き転送される
# （固定pathへの上書きは冪等なので、これ自体はlock不要。中身は対象commitの
# scripts/vps-bootstrap.shそのもの）。
set -eu
set -o pipefail

cd "$HOME/stockhome" || { echo "DEPLOY_RESULT=chdir_failed"; exit 3; }
mkdir -p releases

NEW_TAG=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--tag" ]; then NEW_TAG="$arg"; fi
  prev="$arg"
done
if [ -z "$NEW_TAG" ]; then
  echo "DEPLOY_RESULT=missing_tag"
  exit 2
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "DEPLOY_RESULT=flock_unavailable"
  exit 11
fi

LOCKFILE="$HOME/stockhome/.deploy.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  echo "DEPLOY_RESULT=lock_failed"
  exit 10
fi

# --- ここから先はlock保持中。並行deployはここへ到達できず即座に安全停止する ---

RELDIR="releases/$NEW_TAG"
# 展開先を必ず空にしてから使う。以前の展開・削除済みfile・中断した展開の
# 残骸を残さない（VPS管理レビュー指摘: 空の一時領域からbuildする）
rm -rf "$RELDIR"
mkdir -p "$RELDIR"
tar -xzf - -C "$RELDIR"

if [ ! -f "$RELDIR/scripts/vps-deploy-runner.sh" ]; then
  echo "DEPLOY_RESULT=runner_missing_in_release"
  exit 13
fi

# execでrunnerへ置き換える。fd 200（lock）はexec後も開いたままなので、
# runner側で改めてlockを取り直す必要はない（execはプロセスイメージを
# 置き換えるだけで、close-on-exec指定の無いfdは引き継がれる）
exec bash "$RELDIR/scripts/vps-deploy-runner.sh" --release-dir "$RELDIR" "$@"
