import fs from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeBundle } from '../types/runtime.js';

const ROOT = path.resolve(process.cwd(), '..');
const CACHE_DIR = path.resolve(ROOT, 'data', 'cache');
const RUNTIME_FILE = path.join(CACHE_DIR, 'runtime.json');

export async function saveRuntime(runtime: RuntimeBundle) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), 'utf8');
}

export async function readRuntime(): Promise<RuntimeBundle | null> {
  try {
    return JSON.parse(await fs.readFile(RUNTIME_FILE, 'utf8')) as RuntimeBundle;
  } catch {
    return null;
  }
}

export async function saveRaw(name: string, data: unknown) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}
