# TechnicalSketcher

A stylus-friendly sketching/note-taking app built with Vue 3 + Vite. It ships two ways:

- **Web app** - deployed to GitHub Pages from the `prod` branch, opens a local folder ("vault")
  via the browser's File System Access API.
- **Desktop app (Electron)** - a packaged, auto-updating app for Linux and Windows, with full
  stylus support and native filesystem access (including detecting changes made to vault files
  from outside the app).

Both share the same `src/` codebase. The only thing that differs between them is how vault files
are read/written - see `src/types.ts` (`VaultFileHandle`/`VaultDirHandle`) and
`src/vault/electronHandle.ts`.

## Web development

```sh
npm install
npm run dev      # dev server
npm run build    # production build for GitHub Pages, output in dist/
npm run preview  # preview a production build locally
```

## Desktop (Electron) development

```sh
npm run electron:dev    # launches the app in a real window with hot reload
npm run electron:build  # type-checks, builds the renderer + main/preload, and packages the app
```

`electron:build` produces installers in `release/`: an AppImage + `.deb` on Linux, an NSIS
installer on Windows.

## Releasing the desktop app

```sh
npm run release             # bumps the patch version, commits, tags, and pushes
npm run release -- minor    # or: minor / major / a specific version
```

Pushing the tag triggers `.github/workflows/release-electron.yml`, which builds the app on Linux
and Windows runners and publishes the installers to GitHub Releases. Installed apps check that
feed on startup (and every few hours) via `electron-updater` and update themselves automatically.

The web deploy (`.github/workflows/deploy.yml`, GitHub Pages on push to `prod`) is a separate,
unrelated pipeline and isn't affected by this.

### Installing on Linux

Download the `.AppImage` from the [latest release](../../releases/latest), mark it executable,
and run it:

```sh
chmod +x TechnicalSketcher-*.AppImage
./TechnicalSketcher-*.AppImage
```

The first run adds a Start Menu entry automatically (no AppImageLauncher required). After that,
just launch it from the Start Menu - updates are downloaded and applied automatically.
