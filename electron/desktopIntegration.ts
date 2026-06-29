import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// AppImages don't get a Start Menu entry on their own unless something like AppImageLauncher is
// installed. Re-writing this .desktop file on every launch (cheap, idempotent) gives the AppImage
// a real launcher entry without depending on that, while electron-updater keeps replacing the
// file at this same APPIMAGE path so the Exec target stays valid across updates.
export async function integrateLinuxDesktopEntry(iconSourcePath: string) {
  if (process.platform !== "linux") return;
  const appImagePath = process.env.APPIMAGE;
  if (!appImagePath) return;

  try {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    const applicationsDir = path.join(dataHome, "applications");
    const iconsDir = path.join(dataHome, "icons");
    await fs.mkdir(applicationsDir, { recursive: true });
    await fs.mkdir(iconsDir, { recursive: true });

    const iconDestPath = path.join(iconsDir, "technicalsketcher.png");
    await fs.copyFile(iconSourcePath, iconDestPath);

    const desktopEntry =
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=TechnicalSketcher",
        `Exec="${appImagePath}" %U`,
        `Icon=${iconDestPath}`,
        "Terminal=false",
        "Categories=Office;Graphics;",
        "StartupWMClass=technicalsketcher",
      ].join("\n") + "\n";

    await fs.writeFile(path.join(applicationsDir, "technicalsketcher.desktop"), desktopEntry, "utf-8");
  } catch (err) {
    console.error("Failed to integrate desktop entry:", err);
  }
}
