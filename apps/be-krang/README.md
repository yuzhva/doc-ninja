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

## Build

How Python was started Result
git bash → python works
git bash → cmd → python blocked
PowerShell → python blocked
cmd → node → python (no shell) blocked
git bash → node → python (no shell) works

What works from git bash:

- Simplest, no package manager involved, for the Python step only:

```
node ./scripts/build-python-source-code.mjs
```

For a full release, run pnpm run build first. That step doesn't download anything, so cmd.exe doesn't matter there.

- With npm, the Python step only:

```
npm_config_script_shell="C:/Program Files/Git/usr/bin/bash.exe" npm run build:python
```

- The whole build--release: use pnpm with the variable from my last message. If you'd rather cover both tools at once, put both lines in ~/.bashrc:

```
export pnpm_config_script_shell="C:/Program Files/Git/usr/bin/bash.exe"
export npm_config_script_shell="C:/Program Files/Git/usr/bin/bash.exe"
```

Running scripts with npm run is fine in this repo, but don't use npm install here: it's a pnpm workspace, and npm would create a separate package-lock.json and node_modules.
