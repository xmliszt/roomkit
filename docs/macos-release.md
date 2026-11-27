# Release Roomkit for macOS

Roomkit supports Apple silicon Macs on macOS 15 or later. The DMG includes the editor, local daemon, Node.js and the sample room. Roomkit opens the editor in an app window and keeps both services running until you quit. Choose **Open in Browser** from the Roomkit menu to open the editor in your default browser. Roomkit uses loopback ports 42140 and 42141. Both windows use the projects and settings in `~/Library/Application Support/Roomkit`. Editor preferences such as the floor grid, snapping and object labels are saved separately in the app window and your browser. Export projects from a source checkout and import them into the packaged app.

## Build and test

On an Apple silicon Mac with the Xcode command-line tools, Node.js 24 and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
ROOMKIT_VERSION=0.1.0 desktop/build-dmg.sh
desktop/smoke-dmg.sh dist/Roomkit-0.1.0-arm64.dmg
```

For a manual launch test, drag Roomkit from the DMG to Applications and open it. Confirm that the Roomkit menu bar icon shows the installed version. Open the sample room, close the editor window, and choose **Open Roomkit** from the menu bar to reopen it. Use **Open in Browser** to check the same project in the browser. **Show Startup Log** opens the current startup log. Use **Quit Roomkit** from the menu bar to stop the editor and daemon. Run this test with a signed release on a Mac without the development toolchain.

## Sign and notarize

Create a [Developer ID Application certificate](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/) and an [App Store Connect team API key for notarization](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow). Export the certificate and its private key as a password-protected PKCS#12 file.

For an automated build, use the `macos-release` GitHub environment restricted to `main` and add these environment secrets:

| Secret | Value |
| --- | --- |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity from `security find-identity -v -p codesigning` |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64-encoded PKCS#12 file |
| `APPLE_CERTIFICATE_PASSWORD` | Password used to export the PKCS#12 file |
| `APPLE_NOTARY_KEY_BASE64` | Base64-encoded App Store Connect `.p8` |
| `APPLE_NOTARY_KEY_ID` | App Store Connect API key ID |
| `APPLE_NOTARY_ISSUER_ID` | App Store Connect team issuer ID |

Add the Sparkle private key as `SPARKLE_ED_PRIVATE_KEY` and the dedicated release store's read-write token as `BLOB_READ_WRITE_TOKEN` in that environment. Keep the existing Sparkle key paired with the public key in `desktop/Info.plist`.

Run **Publish Roomkit for macOS** from `main` with a three-part version. Leave **Publish the verified DMG, checksum, update feed and GitHub Release** enabled for a public release. Turn it off to keep the signed build, checksum and signed appcast as a private workflow artifact.

The workflow signs, notarizes and smoke-tests the DMG before preparing the signed update feed. It verifies the public files before updating one release record. All localized pages use stable download URLs at roomkit.space, and Sparkle reads the same record through `/appcast.xml`. After web publication succeeds, the workflow creates a `v`-prefixed Git tag at the build commit and publishes the DMG and checksum on GitHub Releases.

If publication fails after building, rerun the failed job in the original workflow run to reuse the notarized artifact. The workflow checks that a retry matches the public download and any existing GitHub tag and assets. Use a higher version for a new build.

For a local signed build, install the certificate in your keychain and create a [notarytool keychain profile](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow). Run `desktop/sign-dmg.sh dist/Roomkit-0.1.0-arm64.dmg dist/signed/Roomkit-0.1.0-arm64.dmg` with `ROOMKIT_SIGN_IDENTITY` and `ROOMKIT_NOTARY_PROFILE` set.

The workflow artifact requires repository access. Use the public download routes for distribution.

## Publish an app update

Roomkit checks the [update feed](https://www.roomkit.space/appcast.xml) automatically. **Check for Updates…** also checks on demand. When an update is available, the filled Roomkit icon and **Update to Roomkit…** menu item show it. Sparkle asks before downloading and installing the update. Quit shuts down the editor and daemon before the app is replaced.

After publication, from an older updater-enabled installation in Applications, select **Check for Updates…** or **Update to Roomkit…** and install. Confirm Roomkit relaunches with the new version, existing projects, and settings.
