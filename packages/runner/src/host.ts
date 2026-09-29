import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function hostInfo() {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model?.trim(),
    cores: os.cpus().length,
    memoryBytes: os.totalmem(),
  };
}

/**
 * Built-in model versions are not exposed to JavaScript. Chrome stores the
 * on-device model under `<profile>/OptGuideOnDeviceModel/<version>/` and the
 * component manifest under `OptimizationGuideModelsManifest/<version>/`, so we
 * read the versions from disk. Returns undefined when nothing is installed.
 */
export async function builtInModelVersions(profileDir: string): Promise<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  const dirs: Array<[string, string]> = [
    ['onDeviceModel', 'OptGuideOnDeviceModel'],
    ['modelsManifest', 'OptimizationGuideModelsManifest'],
  ];
  for (const [key, dir] of dirs) {
    const version = await latestVersionDir(path.join(profileDir, dir));
    if (version) out[key] = version;
  }
  // The component manifest names the base model and its version, e.g. v3Nano 2025.06.30.1229.
  if (out.onDeviceModel) {
    const manifest = await readFile(path.join(profileDir, 'OptGuideOnDeviceModel', out.onDeviceModel, 'manifest.json'), 'utf8').catch(() => undefined);
    if (manifest) {
      try {
        const m = JSON.parse(manifest) as { BaseModelSpec?: { name?: string; version?: string } };
        if (m.BaseModelSpec?.name) out.baseModel = m.BaseModelSpec.name;
        if (m.BaseModelSpec?.version) out.baseModelVersion = m.BaseModelSpec.version;
      } catch {
        /* ignore */
      }
    }
  }
  // Local State records the device performance class and which asset was requested.
  const localState = await readFile(path.join(profileDir, 'Local State'), 'utf8').catch(() => undefined);
  if (localState) {
    try {
      const og = (JSON.parse(localState) as { optimization_guide?: Record<string, any> }).optimization_guide;
      const od = og?.on_device;
      if (od?.performance_class !== undefined) out.performanceClass = String(od.performance_class);
      if (od?.vram_mb !== undefined) out.vramMb = String(od.vram_mb);
      const ledger = og?.model_execution?.manifest_asset_ledger as Record<string, { asset_id?: string; requested_version?: string }> | undefined;
      for (const entry of Object.values(ledger ?? {})) {
        if (entry.asset_id) out[`asset:${entry.asset_id}`] = entry.requested_version ?? '';
      }
    } catch {
      /* ignore */
    }
  }
  return Object.keys(out).length ? out : undefined;
}

async function latestVersionDir(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const versions = entries.filter((e) => e.isDirectory() && /^\d+(\.\d+)*$/.test(e.name)).map((e) => e.name);
  versions.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  });
  return versions.at(-1);
}

/** Total size of the model-related folders of a profile (download activity signal). */
export async function dirBytes(profileDir: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) await walk(p, depth + 1);
      else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  for (const d of ['OptGuideOnDeviceModel', 'component_crx_cache', 'TranslateKit', 'optimization_guide_model_store']) {
    await walk(path.join(profileDir, d), 0);
  }
  return total;
}
