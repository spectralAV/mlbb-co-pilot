import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { PatchManifestSchema, validatePatchPath } from './validatePatch.js';
import { backupProject } from './backupProject.js';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

export async function applyPatch(zipFile: string) {
  const zip = new AdmZip(zipFile);
  const manifestEntry = zip.getEntry('patch.json') ?? zip.getEntry('patch-manifest.json');
  if (!manifestEntry) throw new Error('Patch ZIP missing patch.json or patch-manifest.json');

  const manifest = PatchManifestSchema.parse(JSON.parse(manifestEntry.getData().toString('utf8')));
  const backupPath = await backupProject(manifest.name);
  const log: string[] = [`Validated ${manifest.name}@${manifest.version}`, `Backup: ${backupPath}`];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName === 'patch.json' || entry.entryName === 'patch-manifest.json') continue;
    if (!entry.entryName.startsWith('files/')) continue;
    if (entry.entryName.includes('..') || entry.entryName.startsWith('/') || /^[A-Za-z]:/.test(entry.entryName)) {
      throw new Error(`Unsafe patch path: ${entry.entryName}`);
    }

    const relative = entry.entryName.replace(/^files\//, '');
    validatePatchPath(relative);
    const target = path.resolve(PROJECT_ROOT, relative);
    if (!target.startsWith(PROJECT_ROOT)) throw new Error(`Unsafe output path: ${relative}`);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
    log.push(`Wrote ${relative}`);
  }

  log.push(manifest.npmInstall ? 'npmInstall requested; run npm run install:all manually for now.' : 'No dependency install requested.');
  log.push(manifest.restart ? 'Restart requested; restart npm run dev manually for now.' : 'No restart requested.');

  return { ok: true, manifest, backupPath, log };
}
