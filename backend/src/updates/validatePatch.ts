import { z } from 'zod';

const CvModuleManifestSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  surfaces: z.array(z.enum(['draft', 'minimap', 'live_hud', 'result_screen', 'ocr', 'training', 'dataset'])).default([]),
  experiments: z.array(z.string().min(1)).default([]),
  entrypoints: z.object({
    status: z.string().min(1).optional(),
    train: z.string().min(1).optional(),
    infer: z.string().min(1).optional(),
    docs: z.string().min(1).optional()
  }).default({}),
  risk: z.enum(['experimental', 'local', 'trusted']).default('experimental')
});

export const PatchManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.enum(['module', 'cv-module', 'patch']).default('module'),
  cvModule: CvModuleManifestSchema.optional(),
  requires: z.string().optional(),
  restart: z.boolean().default(false),
  npmInstall: z.boolean().default(false)
}).superRefine((manifest, ctx) => {
  if (manifest.type !== 'cv-module') return;
  if (!manifest.cvModule) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cvModule'],
      message: 'CV module ZIPs must include a cvModule manifest block.'
    });
    return;
  }
  const hasCvPath = manifest.cvModule.entrypoints.status
    || manifest.cvModule.entrypoints.train
    || manifest.cvModule.entrypoints.infer
    || manifest.cvModule.experiments.length
    || manifest.cvModule.surfaces.length;
  if (!hasCvPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cvModule'],
      message: 'CV module metadata must declare at least one surface, experiment, or entrypoint.'
    });
  }
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
