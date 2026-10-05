#!/usr/bin/env bash

set -euo pipefail

# 1. 定位公开仓库和私有素材目录
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ASSET_ROOT="${1:-${REPO_ROOT}/../ToneCraftPrivateAssets}"
RELEASE_ROOT="${2:-${REPO_ROOT}/../ToneCraftMiniProgramRelease}"

# 2. 校验私有素材和输出目录，避免覆盖已有发布目录
if [[ ! -d "${PRIVATE_ASSET_ROOT}/icons" || ! -d "${PRIVATE_ASSET_ROOT}/images" ]]; then
  echo "找不到私有小程序素材目录：${PRIVATE_ASSET_ROOT}" >&2
  echo "请准备 icons/ 和 images/ 两个子目录后再执行。" >&2
  exit 1
fi

if [[ -e "${RELEASE_ROOT}" ]]; then
  echo "输出目录已存在，为避免覆盖文件而停止：${RELEASE_ROOT}" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "需要 rsync 才能生成不包含 node_modules 的发布目录。" >&2
  exit 1
fi

# 3. 复制公开源码，再覆盖为私有发布素材
mkdir -p "${RELEASE_ROOT}"
rsync -a --exclude='node_modules/' "${REPO_ROOT}/wechat-miniprogram/" "${RELEASE_ROOT}/"
cp -R "${PRIVATE_ASSET_ROOT}/icons/." "${RELEASE_ROOT}/miniprogram/assets/icons/"
cp -R "${PRIVATE_ASSET_ROOT}/images/." "${RELEASE_ROOT}/miniprogram/assets/images/"

# 4. 删除仅针对公开版本的素材说明，避免发布目录产生误导
rm -f "${RELEASE_ROOT}/miniprogram/assets/README.md"

echo "已生成小程序私有发布目录：${RELEASE_ROOT}"
echo "请在微信开发者工具中导入该目录，不要将其中的私有素材提交回公开仓库。"
