import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

type PersistedConfig = {
  lastVaultPath?: string;
};

function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

async function readConfig(): Promise<PersistedConfig> {
  try {
    return JSON.parse(await fs.readFile(configFilePath(), "utf-8"));
  } catch {
    return {};
  }
}

async function writeConfig(config: PersistedConfig): Promise<void> {
  await fs.mkdir(path.dirname(configFilePath()), { recursive: true });
  await fs.writeFile(configFilePath(), JSON.stringify(config, null, 2), "utf-8");
}

export async function getLastVaultPath(): Promise<string | null> {
  return (await readConfig()).lastVaultPath ?? null;
}

export async function setLastVaultPath(vaultPath: string): Promise<void> {
  const config = await readConfig();
  config.lastVaultPath = vaultPath;
  await writeConfig(config);
}
