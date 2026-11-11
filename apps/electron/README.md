# Electron desktop app wrapper

Known issues:
https://github.com/electron/electron/issues/20731#issuecomment-3134427985

```bash
pnpm approve-builds electron
pnpm rebuild electron
pnpm exec electron --version
```

!IMPORTANT TO BUILD THE APP

1. Install packages from root:

```bash
pnpm i // from root
```

2. Compile source code for everything: packages/toolkit, apps/ui-sauce, apps/be-krang

```bash
pnpm run build // for all
```

3. Uncomment `nodeLinker: hoisted` in `pnpm-workspace.yaml`

```bash
nodeLinker: hoisted
```

4. Go to electron app, install dependencies and make the app:

```bash
cd ./apps/electron
pnpm i
pnpm run make
```

`make` builds the store package for the OS it runs on (scripts/forge.mjs):

- Windows: the portable `.zip` and the Microsoft Store `.msix` (see `.env.example`)
- macOS: the Mac App Store `.pkg`, one universal build for Intel and Apple silicon

profit - ready to start

## Scripts

| Script                | What it does                                                                 | Windows                     | macOS                                                                    |
| --------------------- | ---------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `pnpm run start`      | Runs the app from source, for development                                    | dev mode                    | dev mode (no sandbox)                                                    |
| `pnpm run package`    | Builds the **app itself** in `out/`, to open and try; nothing to upload      | `out/doc-ninja--electron-…` | `out/DocNinja-mas-universal/DocNinja.app`: sandboxed, Development-signed |
| `pnpm run make`       | Runs `package`, then wraps the app into the **files you ship** (`out/make/`) | portable `.zip` + `.msix`   | App Store `.pkg`: Distribution-signed (won't open locally)               |
| `pnpm run upload:mas` | Validates and uploads the newest `.pkg` to App Store Connect                 | —                           | uploads                                                                  |

`package` vs `make`: `package` stops at the app bundle/folder, while `make`
goes on to the installer/store package. On macOS each is signed differently:
the `package` app is signed for this Mac so you can test the sandbox, and
the `make` `.pkg` is signed for the store, so it only runs once installed from
the App Store/TestFlight.

## Release to the Mac App Store

One-time setup (certificates, profiles, `.env`): [mac-app-store/README.md](./mac-app-store/README.md).

```sh
# 1. repo root: build packages, UI, backend and the universal Python binaries
pnpm i
pnpm run build:apps--release

# 2. (only after switching to `nodeLinker: hoisted`) clean reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm i

cd apps/electron

# 3. optional, but recommended: try the sandboxed app on this Mac
pnpm run package
open out/DocNinja-mas-universal/DocNinja.app

# 4. build the store .pkg and upload it
pnpm run make
pnpm run upload:mas
```

5. In App Store Connect, wait for the build to finish processing (TestFlight
   tab), select it in the app version, and submit for review.

Each upload needs a new build number: bump `version` in `package.json` or set
`MAS__BUILD_VERSION` in `.env` (e.g. `1.6.1`).

---

The screenshots are generated at [https://shots.so/](https://shots.so/)

---

Mac App Store build (certificates, provisioning profiles, upload): see [mac-app-store/README.md](./mac-app-store/README.md)
