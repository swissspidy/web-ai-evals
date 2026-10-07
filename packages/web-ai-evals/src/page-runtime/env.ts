import type { GpuInfo, PageEnvironment } from '../core/index.js';
import { g } from './adapters/types.js';

const BUILT_IN_APIS = ['LanguageModel', 'Summarizer', 'Writer', 'Rewriter', 'Proofreader', 'Translator', 'LanguageDetector', 'Classifier'];

const GPU_LIMITS = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup'] as const;

export async function captureGpu(): Promise<GpuInfo | undefined> {
  if (!('gpu' in navigator)) return undefined;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return undefined;
  const info = adapter.info;
  const limits: Record<string, number> = {};
  for (const name of GPU_LIMITS) limits[name] = Number(adapter.limits[name]);
  return {
    vendor: info?.vendor,
    architecture: info?.architecture,
    device: info?.device,
    description: info?.description,
    isFallbackAdapter: (info as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter,
    features: [...adapter.features].sort(),
    limits,
  };
}

export async function captureEnvironment(): Promise<PageEnvironment> {
  const uaData = g.navigator.userAgentData;
  let high: Record<string, unknown> = {};
  if (uaData?.getHighEntropyValues) {
    high = await uaData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness']).catch(() => ({}));
  }
  const gpu = await captureGpu();
  return {
    userAgent: navigator.userAgent,
    fullVersionList: high.fullVersionList as PageEnvironment['fullVersionList'],
    platform: uaData?.platform,
    platformVersion: high.platformVersion as string | undefined,
    architecture: high.architecture as string | undefined,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGb: g.navigator.deviceMemory,
    webgpu: !!gpu,
    gpu,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    builtInApis: Object.fromEntries(BUILT_IN_APIS.map((name) => [name, typeof g[name] !== 'undefined'])),
  };
}
