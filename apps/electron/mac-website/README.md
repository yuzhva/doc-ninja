# macOS website download (DMG)

`pnpm run make:dmg` (on macOS) makes `out/make/DocNinja-<version>-universal.dmg`:
the file the website's download button links to. Opened, it shows the app,
an arrow and the Applications folder to drag it onto.

It is the same app as the Mac App Store build, built differently:

|                  | App Store (`make`) | Website (`make:dmg`)                                 |
| ---------------- | ------------------ | ---------------------------------------------------- |
| Certificate      | Apple Distribution | **Developer ID Application**                         |
| App Sandbox      | yes                | no (reads picked folders directly, as on Windows)    |
| Hardened runtime | no                 | yes, with `entitlements.plist` in this folder        |
| Checked by Apple | App Review         | notarization (automatic malware scan, a few minutes) |
| Updates          | App Store          | none built in: users download the new DMG            |

Both use the Bundle ID `MAS__BUNDLE_ID`, so installing one replaces the other.

## What it runs on

Any Mac with macOS 12 (Monterey) or later, Intel or Apple silicon: the
universal build holds both (Electron's `LSMinimumSystemVersion` is 12.0).

## One-time setup

Everything for the App Store build (see `../mac-app-store/README.md`), plus:

1. **The "Developer ID Application" certificate**: Xcode > Settings >
   Accounts > Manage Certificates > + > Developer ID Application. Only the
   team's Account Holder can create it. Back it up as a `.p12` with the others.
   Check with `security find-identity -v -p codesigning`.
2. **Finder automation**: the first `make:dmg` asks to let the terminal (or
   VS Code) control Finder, which lays out the DMG window. Allow it (System
   Settings > Privacy & Security > Automation).

The App Store Connect API key (`ASC__*` in `.env`) notarizes; no other secrets.

## Build

From `apps/electron`, after the same preparation as `make` (built apps,
hoisted `node_modules`, see `../mac-app-store/README.md`):

```sh
pnpm run make:dmg                    # universal (Intel + Apple silicon), ~200 MB
pnpm run make:dmg -- --arch=arm64    # Apple silicon only
pnpm run make:dmg -- --skip-package  # DMG again from the app already in out/
```

It ends by asking Gatekeeper about the result (`spctl`): "accepted, source=Notarized
Developer ID" is what a user's Mac will see.

The window's background is `images/dmg/background.png` (660×400) and
`background@2x.png`, rendered from `images/dmg/background.html`; replace both
to change it, and keep the icon positions in `scripts/make-dmg.mjs` on the arrow.
