#!/usr/bin/env bash
set -euo pipefail

directory=${1:?Provide the signed release directory}
version=${ROOMKIT_VERSION:?Provide ROOMKIT_VERSION}
repo=${GITHUB_REPOSITORY:?Provide GITHUB_REPOSITORY}
commit=${GITHUB_SHA:?Provide GITHUB_SHA}

if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ || ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Provide a three-part release version and a full Git commit SHA.' >&2
  exit 1
fi

tag="v$version"
dmg_name="Roomkit-$version-arm64.dmg"
dmg="$directory/$dmg_name"
checksum="$dmg.sha256"

hash_file() {
  shasum -a 256 < "$1" | cut -d ' ' -f 1
}

if [[ "$(< "$checksum")" != "$(hash_file "$dmg")  $dmg_name" ]]; then
  echo 'The release DMG does not match its SHA-256 checksum.' >&2
  exit 1
fi

if ! tag_object=$(gh api "repos/$repo/git/ref/tags/$tag" --jq .object 2>/dev/null); then
  tag_object=$(gh api "repos/$repo/git/refs" -f "ref=refs/tags/$tag" -f "sha=$commit" --jq .object)
fi

while [[ "$(jq -r .type <<< "$tag_object")" == tag ]]; do
  tag_sha=$(jq -r .sha <<< "$tag_object")
  tag_object=$(gh api "repos/$repo/git/tags/$tag_sha" --jq .object)
done

if ! jq -e --arg commit "$commit" '.type == "commit" and .sha == $commit' <<< "$tag_object" > /dev/null; then
  echo "Tag $tag points to a different commit than $commit." >&2
  exit 1
fi

find_release() {
  gh api "repos/$repo/releases?per_page=100" --paginate --slurp |
    jq -c --arg tag "$tag" '[.[][] | select(.tag_name == $tag)] | if length > 1 then error("Multiple releases use \($tag)") else .[0] // empty end'
}

find_asset() {
  jq -c --arg name "$1" '[.assets[] | select(.name == $name)] | if length > 1 then error("Multiple assets use \($name)") else .[0] // empty end' <<< "$release"
}

verify_asset() {
  local asset=$1
  local uploaded=$2
  if [[ -z "$uploaded" ]] || ! jq -e --arg digest "sha256:$(hash_file "$asset")" '.state == "uploaded" and .digest == $digest' <<< "$uploaded" > /dev/null; then
    echo "GitHub release asset $(basename "$asset") does not match the verified build." >&2
    exit 1
  fi
}

release=$(find_release)
if [[ -z "$release" ]]; then
  gh release create "$tag" --repo "$repo" --verify-tag --draft --title "Roomkit $version" --generate-notes
  release=$(find_release)
fi
release_id=$(jq -er .id <<< "$release")

pending_assets=()
draft=$(jq -r .draft <<< "$release")
for asset in "$dmg" "$checksum"; do
  uploaded=$(find_asset "$(basename "$asset")")
  if [[ -z "$uploaded" ]] || {
    [[ "$draft" == true ]] && jq -e '.state == "starter" and (.id | type == "number")' <<< "$uploaded" > /dev/null
  }; then
    pending_assets+=("$asset")
  else
    verify_asset "$asset" "$uploaded"
  fi
done

if [[ -n "${pending_assets[0]:-}" ]]; then
  for asset in "${pending_assets[@]}"; do
    uploaded=$(find_asset "$(basename "$asset")")
    if [[ -n "$uploaded" ]]; then
      asset_id=$(jq -r .id <<< "$uploaded")
      gh api --method DELETE "repos/$repo/releases/assets/$asset_id"
    fi
  done
  gh release upload "$tag" "${pending_assets[@]}" --repo "$repo"
  release=$(gh api "repos/$repo/releases/$release_id")
  for asset in "$dmg" "$checksum"; do
    verify_asset "$asset" "$(find_asset "$(basename "$asset")")"
  done
fi

if jq -e .draft <<< "$release" > /dev/null; then
  gh api --method PATCH "repos/$repo/releases/$release_id" -F draft=false -f make_latest=legacy --jq .html_url
else
  jq -r .html_url <<< "$release"
fi
