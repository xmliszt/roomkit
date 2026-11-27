#!/bin/bash
set -euo pipefail

if [[ -z "${1:-}" || -z "${2:-}" || -n "${3:-}" || -e "$2" ]]; then
  printf '%s\n' 'Usage: desktop/sign-dmg.sh unsigned.dmg new-signed.dmg' >&2
  exit 1
fi
: "${ROOMKIT_SIGN_IDENTITY:?Set a Developer ID Application signing identity}"
: "${ROOMKIT_NOTARY_PROFILE:?Set a notarytool keychain profile}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
stage="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$stage/volume" -quiet || return 1
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
app="$stage/disk/Roomkit.app"
resources="$app/Contents/Resources"
hdiutil attach "$1" -readonly -nobrowse -mountpoint "$stage/volume" -quiet
mounted=true
ditto "$stage/volume/Roomkit.app" "$app"
hdiutil detach "$stage/volume" -quiet
mounted=false
ln -s /Applications "$stage/disk/Applications"

while IFS= read -r -d '' binary; do
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp "$binary"
done < <(find "$resources" -type f \( -name '*.node' -o -name '*.dylib' \) -print0)
codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime --entitlements "$script_dir/node-entitlements.plist" "$app/Contents/Helpers/node"
sparkle="$app/Contents/Frameworks/Sparkle.framework"
if [[ -d "$sparkle" ]]; then
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime "$sparkle/Autoupdate"
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime "$sparkle/Updater.app"
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime "$sparkle/XPCServices/Installer.xpc"
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime --preserve-metadata=entitlements "$sparkle/XPCServices/Downloader.xpc"
  codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime "$sparkle"
fi
codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --options runtime --entitlements "$script_dir/app-entitlements.plist" "$app"
codesign --verify --deep --strict "$app"

dmg="$stage/Roomkit.dmg"
hdiutil create -fs HFS+ -format UDZO -volname Roomkit -srcfolder "$stage/disk" "$dmg"
codesign --force --sign "$ROOMKIT_SIGN_IDENTITY" --timestamp --identifier space.roomkit.disk-image "$dmg"
notary_args=(--keychain-profile "$ROOMKIT_NOTARY_PROFILE")
if [[ -n "${ROOMKIT_NOTARY_KEYCHAIN:-}" ]]; then
  notary_args+=(--keychain "$ROOMKIT_NOTARY_KEYCHAIN")
fi
xcrun notarytool submit "$dmg" "${notary_args[@]}" --wait --timeout 20m
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature "$dmg"
mkdir -p "$(dirname "$2")"
mv "$dmg" "$2"
printf 'Signed and notarized %s\n' "$2"
