#!/bin/bash
# StockHome API deploy/rollback本体（VPS上、vps-bootstrap.shからexecで呼ばれる）。
#
# lock取得と展開先の準備はvps-bootstrap.shが担当済み（本scriptが起動した時点で
# fd 200のlockは既に保持されている）。本scriptの責務は:
#   - 切替前に現行imageへimmutable tagを確定・保全する。保全できなければ
#     build・切替のどちらも行わずここで停止する
#   - --no-build指定時はbuildをskipし、対象tagのimageが既に存在するか確認するだけ
#   - build（skip時を除く） → up -d → health matrix確認
#   - 成功: health成功後だけcleanup（古いimage tagと対応するreleaseディレクトリを
#     直近KEEP_GENERATIONS世代を残して削除。running/previousは世代数に関係なく除外）
#   - 失敗: 保全したprevious tagへ同一処理内で自動rollbackし、health matrixを再確認
#
# health matrixはinternal/public の /health(200) と /api/bridge/health(401) の4点。
#
# 通常deployと明示rollback（deploy.ps1の-RollbackTo）は同じ経路を通る。両者の違いは
# --no-buildの有無だけ（rollback時は対象commitのソースを再展開するがbuildはskipし、
# 既存imageへ切り替えるだけ）。
#
# 意図的に`set -e`は使わない。health失敗後の自動rollback処理へ確実に到達させるため、
# 各コマンドの成否は個別にifで判定する。
set -u
set -o pipefail

# 既定値はproduction。環境変数で上書きできるのは、productionと分離した環境で
# 正常deploy・health失敗からの自動復旧・明示rollback・世代保持・lock競合を
# 検証するため。production実行時はdeploy.ps1がこれらを設定しないので、
# 常に下記の既定値が使われる。
PUBLIC_URL="${SH_PUBLIC_URL:-https://stockhome.homehub-tools.dedyn.io}"
INTERNAL_URL="${SH_INTERNAL_URL:-http://127.0.0.1:4002}"
CONTAINER="${SH_CONTAINER:-stockhome-api-prod}"
IMAGE_REPO="${SH_IMAGE_REPO:-stockhome-api}"
COMPOSE_PROJECT="${SH_COMPOSE_PROJECT:-stockhome}"
# .envの実体は$HOME/stockhome直下の永続的な場所にあり、releases/<tag>（毎回作り直す
# 一時領域）には含まれない（.envはgit追跡外・tarballにも含まれない）。
# --project-directoryをreleases/<tag>にしたことで、Composeの既定の.env探索先も
# そちらに変わってしまうため、明示的に--env-fileで本来の場所を指定する
# （VPS管理レビュー指摘: Composeへproduction .envを明示指定する）
ENV_FILE="${SH_ENV_FILE:-$HOME/stockhome/.env}"

NEW_TAG=""
RELEASE_DIR=""
KEEP_GENERATIONS=3
NO_CACHE=""
NO_BUILD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) NEW_TAG="${2:-}"; shift 2 ;;
    --release-dir) RELEASE_DIR="${2:-}"; shift 2 ;;
    --keep) KEEP_GENERATIONS="${2:-3}"; shift 2 ;;
    --no-cache) NO_CACHE="1"; shift ;;
    --no-build) NO_BUILD="1"; shift ;;
    *) echo "DEPLOY_RESULT=unknown_arg:$1"; exit 2 ;;
  esac
done

if [ -z "$NEW_TAG" ] || [ -z "$RELEASE_DIR" ]; then
  echo "DEPLOY_RESULT=missing_required_arg"
  exit 2
fi
if [ ! -d "$RELEASE_DIR" ]; then
  echo "DEPLOY_RESULT=release_dir_missing"
  exit 2
fi
COMPOSE_FILE="$RELEASE_DIR/docker-compose.prod.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "DEPLOY_RESULT=compose_file_missing"
  exit 2
fi

# project名を明示固定する（重要）: releases/<tag>という毎回異なるdirectoryから
# buildするため、docker composeの既定project名（directory名由来）に任せると
# deployのたびにproject/networkが変わってしまい、同一compose fileで定義されている
# postgres serviceとの内部DNS解決（サービス名postgres）が壊れる。既存運用の
# project名（~/stockhome由来の"stockhome"）と一致させることで、build元の
# directoryが変わってもnetwork/連携は不変に保つ
dc() {
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --project-directory "$RELEASE_DIR" --env-file "$ENV_FILE" "$@"
}

wait_health_matrix() {
  local tries=0
  local max_tries=30
  local ih=000
  while [ $tries -lt $max_tries ]; do
    ih=$(curl -s -o /dev/null -w '%{http_code}' "$INTERNAL_URL/health" 2>/dev/null || echo 000)
    if [ "$ih" = "200" ]; then break; fi
    tries=$((tries + 1))
    sleep 2
  done
  local ib ph pb
  ib=$(curl -s -o /dev/null -w '%{http_code}' "$INTERNAL_URL/api/bridge/health" 2>/dev/null || echo 000)
  ph=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/health" 2>/dev/null || echo 000)
  pb=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/bridge/health" 2>/dev/null || echo 000)
  echo "HEALTH_MATRIX=internal_health=$ih internal_bridge=$ib public_health=$ph public_bridge=$pb"
  [ "$ih" = "200" ] && [ "$ib" = "401" ] && [ "$ph" = "200" ] && [ "$pb" = "401" ]
}

# --- 切替前に、現行imageのimmutable tagを確定・保全する ----------------------
# **現行containerが存在しない場合は、build・切替のどちらも行わずここで停止する**
# （VPS管理レビュー指摘: 現行container不在時はbuild前に停止する）。本scriptは
# 「productionには常に稼働中のcontainerがある」ことを前提とし、不在は異常な
# 状態（誤ったdirectory・compose project名の不一致・手動操作の影響等）として
# 扱う。まったくの初回セットアップ（productionにcontainerが一度も存在しない
# 状態）は本scriptの対象外とし、別途手動でのbootstrapが必要。
PREVIOUS_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || echo "")
PREVIOUS_IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo "")

if [ -z "$PREVIOUS_IMAGE" ]; then
  echo "DEPLOY_RESULT=no_previous_container"
  exit 14
fi

# 現行方式のimage（repo:tag形式）ならそのtagをそのまま使う。旧方式（Compose
# 自動命名でrepo:tag形式でない）imageの場合はimage IDから一度だけ
# pre-v2-<timestamp>というimmutable tagを付与して保全する（可変tagをrollback
# 根拠にしない、という方針に沿う）。
#
# **保全できなかった場合も、build・切替のどちらも行わずここで停止する**
# （previous imageを保全できない場合はbuild・切替前に停止する）。
ROLLBACK_TAG=""
case "$PREVIOUS_IMAGE" in
  "$IMAGE_REPO":*)
    ROLLBACK_TAG="${PREVIOUS_IMAGE#$IMAGE_REPO:}"
    ;;
  *)
    if [ -n "$PREVIOUS_IMAGE_ID" ]; then
      CANDIDATE="pre-v2-$(date +%Y%m%d%H%M%S)"
      if docker tag "$PREVIOUS_IMAGE_ID" "$IMAGE_REPO:$CANDIDATE"; then
        ROLLBACK_TAG="$CANDIDATE"
        echo "PRESERVED_PREVIOUS_AS=$IMAGE_REPO:$ROLLBACK_TAG"
      fi
    fi
    ;;
esac
# tag付け自体が成功していても、実際にimageとして引けるかを最終確認する
if [ -n "$ROLLBACK_TAG" ] && ! docker image inspect "$IMAGE_REPO:$ROLLBACK_TAG" >/dev/null 2>&1; then
  ROLLBACK_TAG=""
fi
if [ -z "$ROLLBACK_TAG" ]; then
  echo "DEPLOY_RESULT=previous_image_preserve_failed"
  exit 12
fi
echo "PREVIOUS_IMAGE=$PREVIOUS_IMAGE"
echo "ROLLBACK_TAG=$ROLLBACK_TAG"
echo "NEW_TAG=$NEW_TAG"

# --- build（--no-build時はskipし、対象imageが既に存在するかだけ確認する） -----
if [ -n "$NO_BUILD" ]; then
  if ! docker image inspect "$IMAGE_REPO:$NEW_TAG" >/dev/null 2>&1; then
    echo "DEPLOY_RESULT=rollback_target_missing"
    exit 22
  fi
else
  export API_IMAGE_TAG="$NEW_TAG"
  BUILD_ARGS=""
  if [ -n "$NO_CACHE" ]; then BUILD_ARGS="--no-cache"; fi
  if ! dc build $BUILD_ARGS api; then
    echo "DEPLOY_RESULT=build_failed"
    exit 20
  fi
fi

# --- 切替 --------------------------------------------------------------------
export API_IMAGE_TAG="$NEW_TAG"
if ! dc up -d --no-build api; then
  echo "DEPLOY_RESULT=up_failed_attempting_rollback"
  if [ -n "$ROLLBACK_TAG" ]; then
    export API_IMAGE_TAG="$ROLLBACK_TAG"
    if dc up -d --no-build api && wait_health_matrix; then
      echo "DEPLOY_RESULT=rolled_back_to_previous"
      exit 32
    fi
    echo "DEPLOY_RESULT=rollback_health_failed_manual_intervention_required"
    exit 33
  fi
  echo "DEPLOY_RESULT=up_failed_no_previous_image"
  exit 21
fi

if wait_health_matrix; then
  echo "DEPLOY_RESULT=success"
  # --- cleanup: health成功後だけ実行する ------------------------------------
  # 直近KEEP_GENERATIONS世代を保持し、それより古いgit-*を削除する（対応する
  # releases/<tag>ディレクトリも一緒に削除する）。running（=NEW_TAG）とprevious
  # （=ROLLBACK_TAG）は世代数に関係なく必ず除外する。
  # LastTagTimeでソートする理由: docker images --format '{{.CreatedAt}}'は
  # スペース区切りの複合値で、単純sortだと同日中の複数世代を誤順序付けする。
  # BuildKitでbuildしたimageはdocker inspectの.Createdが空になるため使わない。
  BASE_DIR=$(dirname "$RELEASE_DIR")
  old=$(
    for t in $(docker images "$IMAGE_REPO" --format '{{.Tag}}' | grep '^git-'); do
      lt=$(docker inspect -f '{{.Metadata.LastTagTime}}' "$IMAGE_REPO:$t" 2>/dev/null || echo "")
      [ -n "$lt" ] && echo "$lt|$t"
    done | sort -r | tail -n +$((KEEP_GENERATIONS + 1)) | cut -d'|' -f2
  )
  for tag in $old; do
    if [ "$tag" = "$NEW_TAG" ] || [ "$tag" = "$ROLLBACK_TAG" ]; then
      echo "keeping stockhome-api:$tag (running or previous)"
      continue
    fi
    echo "removing $IMAGE_REPO:$tag"
    docker rmi "$IMAGE_REPO:$tag" || echo "  (skip: in use or already removed)"
    if [ -d "$BASE_DIR/$tag" ]; then
      rm -rf "$BASE_DIR/$tag"
      echo "removed release dir $BASE_DIR/$tag"
    fi
  done
  exit 0
fi

# --- health失敗: 保全しておいたprevious tagへ自動rollback --------------------
echo "DEPLOY_RESULT=health_failed_attempting_rollback"
if [ -z "$ROLLBACK_TAG" ]; then
  echo "DEPLOY_RESULT=health_failed_no_previous_image"
  exit 30
fi

export API_IMAGE_TAG="$ROLLBACK_TAG"
if ! dc up -d --no-build api; then
  echo "DEPLOY_RESULT=rollback_up_failed"
  exit 31
fi

if wait_health_matrix; then
  echo "DEPLOY_RESULT=rolled_back_to_previous"
  # 失敗した新imageは調査のため残す（cleanupしない）
  exit 32
fi

echo "DEPLOY_RESULT=rollback_health_failed_manual_intervention_required"
exit 33
