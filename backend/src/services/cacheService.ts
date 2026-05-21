import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cacheDir = path.resolve(process.cwd(), "..", "data", "cache");

async function ensure() { await mkdir(cacheDir, { recursive: true }); }

export const cache = {
  dir: cacheDir,
  async read<T = any>(file: string, fallback: T): Promise<T> {
    try {
      await ensure();
      const raw = await readFile(path.join(cacheDir, file), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  async write(file: string, data: any) {
    await ensure();
    await writeFile(path.join(cacheDir, file), JSON.stringify(data, null, 2), "utf8");
  },
  async setMetadata(key: string, value: any) {
    const meta = await this.read("metadata.json", {} as any);
    meta[key] = value;
    meta.updatedAt = new Date().toISOString();
    await this.write("metadata.json", meta);
  }
};
