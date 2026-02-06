# Electron desktop app wrapper

Known issues:
https://github.com/electron/electron/issues/20731#issuecomment-3134427985

```bash
pnpm approve-builds electron
pnpm rebuild electron
pnpm exec electron --version
```

!IMPORTANT TO BUILD THE APP

```
pnpm i // from root
cd apps/electron
pnpm i // from electron
rm -rf node_modules // drop node_modules
cd ../../
pnpm i // from root
```

profit - ready to start
