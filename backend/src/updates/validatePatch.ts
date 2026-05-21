import { z } from 'zod';

export const PatchManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.string().default('module'),
  requires: z.string().optional(),
  restart: z.boolean().default(false),
  npmInstall: z.boolean().default(false)
});

export type PatchManifest = z.infer<typeof PatchManifestSchema>;

export function validatePatchPath(entryName: string) {
  if (entryName.includes('..') || entryName.startsWith('/') || /^[A-Za-z]:/.test(entryName)) {
    throw new Error(`Unsafe patch path: ${entryName}`);
  }
  const allowed = ['backend/', 'frontend/', 'assets/', 'data/', 'modules/', 'map-runtime/', 'README', 'package.json', 'install.ps1', 'start.ps1'];
  if (!allowed.some((prefix) => entryName === prefix || entryName.startsWith(prefix))) {
    throw new Error(`Patch path is outside allowed project folders: ${entryName}`);
  }
}
