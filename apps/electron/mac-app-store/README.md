# Mac App Store

What the Mac App Store build (`pnpm run make` on macOS) needs, where each piece
lives, and how to set up a new Mac.

| What                                                     | Where                                     | In git          |
| -------------------------------------------------------- | ----------------------------------------- | --------------- |
| `entitlements.mas.plist`, `entitlements.mas.child.plist` | this folder                               | yes             |
| `DocNinja_MAS_Distribution_Profile.provisionprofile`     | this folder                               | no (downloaded) |
| `DocNinja_Dev_Profile.provisionprofile`                  | this folder (only for `package`)          | no (downloaded) |
| Signing certificates + their private keys                | login Keychain                            | never           |
| App Store Connect API key `AuthKey_<key id>.p8`          | `~/.appstoreconnect/private_keys/`        | never           |
| Team ID, Bundle ID, API key IDs                          | `apps/electron/.env` (see `.env.example`) | never           |

Keep a copy of the certificates (`.p12`), the `.p8` key and the `.env` values
in a password manager: they are all that a new Mac needs that isn't in the
repo or downloadable again.

## Entitlements

Written by hand, not generated: `@electron/osx-sign`'s defaults add camera,
microphone, USB, printing and network access, and App Review asks for a
justification of every entitlement. Add one only when the app needs it.

- `entitlements.mas.plist`: the top-level `DocNinja.app` (sandbox + files the
  user picks). No network entitlements: the app neither listens nor connects
  (the backend is reached in memory, see `src/backend-process.mts`). App
  Review's automated check rejects `network.server` when the app serves
  nothing (guideline 2.4.5), so don't add it back for a loopback server.
- `entitlements.mas.child.plist`: every nested executable (Electron helpers,
  the PyInstaller binaries). Apple allows only these two keys there.

## New Mac checklist

1. **Xcode** from the App Store, then accept its license once (the build runs
   Xcode's `lipo`, `codesign` and `productbuild`):

   ```sh
   sudo xcodebuild -license accept
   ```

2. **Python from [python.org](https://www.python.org/downloads/macos/)**: its
   installer is universal2 (Intel + Apple silicon), which the be-krang Python
   binaries need. Homebrew's `python3` builds Apple-silicon-only binaries,
   which `make` refuses.

3. **Certificates** (Keychain). The build needs:
   - `Apple Distribution: <name> (<team id>)`: signs the app
   - `3rd Party Mac Developer Installer: <name> (<team id>)`: signs the `.pkg`
     (created as "Mac Installer Distribution")
   - `Apple Development: <name> (…)`: only for `package`

   Either import the `.p12` from the password manager (double-click it), or
   create new ones in **Xcode > Settings > Accounts > Manage Certificates > +**.
   New certificates need new profiles (step 4): a profile works only with the
   certificates it was made with.

   To back them up: **Keychain Access > My Certificates**, select them,
   **File > Export Items… > .p12** with a password.

   Check with:

   ```sh
   security find-identity -v
   ```

4. **Provisioning profiles**: [developer.apple.com > Profiles](https://developer.apple.com/account/resources/profiles/list),
   for the App ID `com.mainset.DocNinja`. Download and save them here under
   these exact names:
   - `DocNinja_MAS_Distribution_Profile.provisionprofile`: type
     "Mac App Store Connect", with the Apple Distribution certificate
   - `DocNinja_Dev_Profile.provisionprofile`: type "macOS App Development",
     with the Apple Development certificate and this Mac registered under
     Devices (its Provisioning UDID: **System Information > Hardware**)

   They expire after a year; download them again then (the build says when
   one is missing or made for another Bundle ID).

5. **App Store Connect API key** (for `upload:mas`):
   [App Store Connect > Users and Access > Integrations](https://appstoreconnect.apple.com/access/integrations/api),
   role "App Manager". The `.p8` downloads only once: put it at
   `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`.

6. **`apps/electron/.env`**: copy `.env.example` and fill in the `MAS__*` and
   `ASC__*` values.

## Build and upload

1. From the repo root, build everything, including the Python binaries:

   ```sh
   pnpm i
   pnpm run build:apps--release
   ```

2. Electron Forge needs pnpm's `hoisted` layout: uncomment
   `nodeLinker: hoisted` in `pnpm-workspace.yaml`, then reinstall **from a
   clean state** (switching layouts over an existing install leaves a mix of
   both that breaks other builds):

   ```sh
   rm -rf node_modules apps/*/node_modules packages/*/node_modules
   pnpm i
   ```

3. Make and upload the `.pkg` (one universal package for Intel and Apple
   silicon):

   ```sh
   cd apps/electron
   pnpm run make
   pnpm run upload:mas
   ```

4. The build appears in App Store Connect > TestFlight once Apple has
   processed it; select it in the app version and submit for review.

Each upload needs a higher `CFBundleVersion` than the last one: bump
`version` in `package.json`.

To try the sandboxed build on this Mac before uploading (a
distribution-signed app only runs once installed from the store):

```sh
pnpm run package
open out/DocNinja-mas-universal/DocNinja.app
```
