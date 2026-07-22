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

profit - ready to start
