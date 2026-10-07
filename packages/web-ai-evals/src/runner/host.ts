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

interface InstalledModel {
  /** Component version, e.g. "2025.8.21.1028". */
  component: string;
  /** Asset id from Local State's ledger, e.g. "nano_v3_cpu_component" or "gemma4_component". */
  asset?: string;
  baseModel?: string;
  baseModelVersion?: string;
}

async function readManifest(dir: string): Promise<{ baseModel?: string; baseModelVersion?: string }> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as { BaseModelSpec?: { name?: string; version?: string } };
    return { baseModel: m.BaseModelSpec?.name, baseModelVersion: m.BaseModelSpec?.version };
  } catch {
    return {};
  }
}

/**
 * Built-in model versions are not exposed to JavaScript, so we read them from
 * the profile. Chrome uses two layouts:
 * - `OptGuideOnDeviceModel/<version>/` for Gemini Nano, and
 * - `OptGuideManifestModel/<asset hash>/<version>/` for models installed by the
 *   manifest broker (e.g. Gemma 4 via chrome://flags/#gemma4-for-built-in-ai).
 * Each carries a `manifest.json` naming the base model. Local State's asset
 * ledger maps the hash directories to asset ids. When a profile holds several
 * models, `preferGemma4` (the Gemma 4 flag is on) picks the active one.
 * Returns undefined when nothing is installed.
 */
export async function builtInModelVersions(
  profileDir: string,
  options: { preferGemma4?: boolean } = {},
): Promise<Record<string, string> | undefined> {
  const out: Record<string, string> = {};
  const manifestVersion = await latestVersionDir(path.join(profileDir, 'OptimizationGuideModelsManifest'));
  if (manifestVersion) out.modelsManifest = manifestVersion;

  const installed: InstalledModel[] = [];
  const legacy = await latestVersionDir(path.join(profileDir, 'OptGuideOnDeviceModel'));
  if (legacy) installed.push({ component: legacy, ...(await readManifest(path.join(profileDir, 'OptGuideOnDeviceModel', legacy))) });

  let ledger: Record<string, { asset_id?: string; requested_version?: string }> = {};
  const localState = await readFile(path.join(profileDir, 'Local State'), 'utf8').catch(() => undefined);
  if (localState) {
    try {
      const og = (JSON.parse(localState) as { optimization_guide?: Record<string, any> }).optimization_guide;
      const od = og?.on_device;
      if (od?.performance_class !== undefined) out.performanceClass = String(od.performance_class);
      if (od?.vram_mb !== undefined) out.vramMb = String(od.vram_mb);
      if (od?.model_crash_count !== undefined) out.modelCrashCount = String(od.model_crash_count);
      ledger = og?.model_execution?.manifest_asset_ledger ?? {};
      for (const entry of Object.values(ledger)) {
        if (entry.asset_id) out[`asset:${entry.asset_id}`] = entry.requested_version ?? '';
      }
    } catch {
      /* ignore */
    }
  }
  for (const [hash, entry] of Object.entries(ledger)) {
    const dir = path.join(profileDir, 'OptGuideManifestModel', hash);
    const version = entry.requested_version ?? (await latestVersionDir(dir));
    if (!version) continue;
    const m = await readManifest(path.join(dir, version));
    // Only count models whose files are actually on disk.
    if (m.baseModel) installed.push({ component: version, asset: entry.asset_id, ...m });
  }
  // The legacy directory holds Nano; tag it with its asset id when the ledger has one.
  const nanoAsset = Object.values(ledger).find((e) => e.asset_id?.startsWith('nano') && e.requested_version === legacy);
  if (legacy && installed[0] && !installed[0].asset && nanoAsset?.asset_id) installed[0].asset = nanoAsset.asset_id;

  const isGemma4 = (m: InstalledModel) => /gemma4/i.test(`${m.baseModel ?? ''} ${m.asset ?? ''}`);
  const active = installed.find((m) => (options.preferGemma4 ? isGemma4(m) : !isGemma4(m))) ?? installed[0];
  if (active) {
    out.onDeviceModel = active.component;
    if (active.asset) out.activeAsset = active.asset;
    if (active.baseModel) out.baseModel = active.baseModel;
    if (active.baseModelVersion) out.baseModelVersion = active.baseModelVersion;
  }
  if (installed.length > 1) out.installedModels = installed.map((m) => `${m.baseModel ?? '?'}@${m.component}`).join(', ');
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
  for (const d of ['OptGuideOnDeviceModel', 'OptGuideManifestModel', 'component_crx_cache', 'TranslateKit', 'optimization_guide_model_store']) {
    await walk(path.join(profileDir, d), 0);
  }
  return total;
}
