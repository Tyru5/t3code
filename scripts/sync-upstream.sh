#!/usr/bin/env bash
set -euo pipefail

origin_remote="${ORIGIN_REMOTE:-origin}"
upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_url="${UPSTREAM_URL:-git@github.com:pingdotgg/t3code.git}"
main_branch="${MAIN_BRANCH:-main}"
rebase_current=false

usage() {
  cat <<'EOF'
Usage: bun run sync:upstream [--rebase-current]

Safely updates the local main branch from upstream/main, then pushes it to origin.

Options:
  --rebase-current  Rebase the branch you started on onto the updated main branch.
  --help            Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebase-current)
      rebase_current=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This command must be run inside a Git repository." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Worktree is dirty. Commit or stash changes before syncing upstream." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"

if [[ -z "${current_branch}" ]]; then
  echo "Detached HEAD is not supported. Check out a branch before syncing." >&2
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${main_branch}"; then
  echo "Local branch '${main_branch}' does not exist." >&2
  exit 1
fi

if ! git remote get-url "${origin_remote}" >/dev/null 2>&1; then
  echo "Remote '${origin_remote}' does not exist." >&2
  exit 1
fi

if git remote get-url "${upstream_remote}" >/dev/null 2>&1; then
  existing_upstream_url="$(git remote get-url "${upstream_remote}")"
  if [[ "${existing_upstream_url}" != "${upstream_url}" ]]; then
    echo "Using existing '${upstream_remote}' remote: ${existing_upstream_url}"
  fi
else
  echo "Adding '${upstream_remote}' remote -> ${upstream_url}"
  git remote add "${upstream_remote}" "${upstream_url}"
fi

echo "Fetching '${upstream_remote}'..."
git fetch "${upstream_remote}"

echo "Switching to '${main_branch}'..."
git switch "${main_branch}"

echo "Fast-forwarding '${main_branch}' from '${upstream_remote}/${main_branch}'..."
git merge --ff-only "${upstream_remote}/${main_branch}"

echo "Pushing '${main_branch}' to '${origin_remote}'..."
git push "${origin_remote}" "${main_branch}"

if [[ "${current_branch}" != "${main_branch}" ]]; then
  echo "Switching back to '${current_branch}'..."
  git switch "${current_branch}"

  if [[ "${rebase_current}" == "true" ]]; then
    echo "Rebasing '${current_branch}' onto '${main_branch}'..."
    git rebase "${main_branch}"
  else
    echo "Synced '${main_branch}'. Rebase your branch when ready:"
    echo "  git rebase ${main_branch}"
  fi
fi

echo "Upstream sync complete."
