import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const BACKUP_ROOT = path.resolve(ROOT, '..', 'backups');

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'backups'].includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

export async function backupProject(label: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_ROOT, `${stamp}-${label.replace(/[^a-z0-9_-]/gi, '_')}`);
  await copyDir(path.resolve(ROOT, '..'), backupPath);
  return backupPath;
}
