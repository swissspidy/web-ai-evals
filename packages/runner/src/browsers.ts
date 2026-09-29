import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import type { BrowserConfig } from './config.js';

/**
 * Playwright's default Chromium switches break built-in AI:
 * - `--disable-component-update` stops the component updater that downloads Gemini Nano.
 * - `--disable-background-networking` blocks the model manifest fetch.
 * - `--disable-features=...,OptimizationHints,Translate,...` disables the on-device
 *   model service and the Translator backend.
 * - `--disable-extensions` blocks extension polyfills (WebAI Studio's Classifier).
 * We drop those defaults and re-add the harmless part of Playwright's feature list.
 */
export const IGNORED_DEFAULT_ARGS = [
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-field-trial-config',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
];

const KEEP_DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'MediaRouter',
  'LensOverlay',
  'msForceBrowserSignIn',
];

/**
 * Flag presets. They only help on machines that meet Chrome's requirements;
 * they cannot make an unsupported device run Gemini Nano.
 */
export const FLAG_PRESETS: Record<string, { enable?: string[]; args?: string[] }> = {
  /** Writer/Rewriter/Proofreader developer trials (chrome://flags #writer-api etc.). */
  'writing-apis': { enable: ['AIWriterAPI', 'AIRewriterAPI', 'AIProofreadingAPI'] },
  /** Prompt API sampling parameters (chrome://flags/#prompt-api-sampling-mode). */
  'sampling-mode': { enable: ['AIPromptAPIParams'] },
  /** Force the CPU backend of the on-device model service. */
  'force-cpu': { enable: ['OnDeviceModelForceCpuBackend'] },
  /** WebGPU on Linux / software adapters (needed for WebLLM without a supported GPU driver). */
  'unsafe-webgpu': { args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'], enable: ['Vulkan'] },
};

export function browserArgs(config: BrowserConfig): { args: string[]; flags: string[] } {
  const enable = [...(config.enableFeatures ?? [])];
  const args = [...(config.args ?? [])];
  for (const name of config.presets ?? []) {
    const preset = FLAG_PRESETS[name];
    if (!preset) throw new Error(`unknown flag preset "${name}" (known: ${Object.keys(FLAG_PRESETS).join(', ')})`);
    enable.push(...(preset.enable ?? []));
    args.push(...(preset.args ?? []));
  }
  const disable = [...KEEP_DISABLED_FEATURES, ...(config.disableFeatures ?? [])];
  // Chrome uses the last occurrence of a switch, so these override Playwright's own lists.
  args.push(`--disable-features=${disable.join(',')}`);
  args.push(`--enable-features=${['CDPScreenshotNewSurface', ...enable].join(',')}`);
  const flags = [...args];
  return { args, flags };
}

export function proxyFor(config: BrowserConfig): { server: string; bypass: string } | undefined {
  if (config.proxy === false) return undefined;
  const server = config.proxy ?? process.env.HTTPS_PROXY ?? process.env.https_proxy;
  return server ? { server, bypass: '127.0.0.1,localhost,::1' } : undefined;
}

export interface LaunchedBrowser {
  context: BrowserContext;
  profileDir: string;
  flags: string[];
  version: string;
}

export async function launchBrowser(config: BrowserConfig & { id: string }, profilesDir: string): Promise<LaunchedBrowser> {
  const profileDir = config.profileDir ?? path.join(profilesDir, config.id);
  await mkdir(profileDir, { recursive: true });
  const { args, flags } = browserArgs(config);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: config.channel === 'chromium' ? undefined : config.channel,
    executablePath: config.executablePath ?? (config.channel === 'chromium' ? process.env.WAE_CHROMIUM_EXECUTABLE : undefined),
    headless: config.headless ?? false,
    args,
    ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
    proxy: proxyFor(config),
    viewport: { width: 1000, height: 700 },
  });
  const version = context.browser()?.version() ?? (await versionViaCdp(context));
  return { context, profileDir, flags, version };
}

async function versionViaCdp(context: BrowserContext): Promise<string> {
  const page = context.pages()[0] ?? (await context.newPage());
  const session = await context.newCDPSession(page);
  try {
    const v = (await session.send('Browser.getVersion')) as { product: string };
    return v.product.replace(/^[^/]+\//, '');
  } finally {
    await session.detach().catch(() => {});
  }
}
