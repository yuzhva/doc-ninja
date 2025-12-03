## Possible issues

### With `sharp`:

For BE that runs in local:

```bash
pnpm rebuild sharp
```

For Docker:

```bash
docker exec -u root -it doc-ninja-doc-ninja--dev-1 bash
pnpm install --os=linux --cpu=x64 sharp

cd apps/be-krang
pnpm install --os=linux --cpu=x64 sharp
pnpm rebuild sharp

cd ../../
pnpm rebuild sharp
```

| OS | Install command |
| macOS (Homebrew) | `brew install --cask libreoffice` |
| Ubuntu / Debian | `apt update && apt install libreoffice` |
| Windows (winget) | `winget install --id TheDocumentFoundation.LibreOffice -e` |
