#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "[error] usage: ./scripts/release-publish.sh 0.1.1"
  exit 1
fi

INPUT_VERSION="${1#v}"
TAG="v${INPUT_VERSION}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Current branch: ${CURRENT_BRANCH}"
echo "Target version: ${INPUT_VERSION}"
echo

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[error] working tree is dirty. Commit or stash changes before publishing."
  git status --short
  exit 1
fi

echo "[1/6] Updating package version"
npm version "${INPUT_VERSION}" --no-git-tag-version

echo "[2/6] Refreshing package-lock.json"
npm install --package-lock-only --registry=https://registry.npmjs.org/

echo "[3/6] Running tests"
npm test

echo "[4/6] Committing release files"
git add package.json package-lock.json electron-builder.yml
git commit -m "chore: release ${TAG}"

echo "[5/6] Pushing branch"
git push origin "${CURRENT_BRANCH}"

echo "[6/6] Tagging and pushing ${TAG}"
git tag "${TAG}"
git push origin "${TAG}"

echo
echo "Release workflow triggered:"
echo "https://github.com/yangbuyiya/desktop-pet/actions"
