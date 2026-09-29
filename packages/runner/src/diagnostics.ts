import type { BrowserContext } from 'playwright';

export interface BuiltInDiagnostics {
  performanceClass?: string;
  /** Manifest criteria lines, e.g. "Enough disk space to install false (15357 MiB available, 20480 MiB required)". */
  criteria: string[];
  /** Criteria that are false: the reasons the model will not install or run. */
  blockers: string[];
  assets: string[];
  useCases: string[];
}

/**
 * Read Chrome's own view of the on-device model from chrome://on-device-internals.
 * availability() only says "downloadable"; this page says why nothing downloads
 * (disk space, VRAM, performance class, crash count). Needs the internal debug
 * pages, which are enabled from chrome://chrome-urls.
 */
export async function builtInDiagnostics(context: BrowserContext): Promise<BuiltInDiagnostics | undefined> {
  const page = await context.newPage();
  try {
    await page.goto('chrome://chrome-urls');
    const enable = page.locator('cr-button, button, [role=button]').filter({ hasText: /enable/i }).first();
    if (await enable.count()) await enable.click().catch(() => {});
    await page.goto('chrome://on-device-internals');
    await page.waitForTimeout(4000);
    const lines: string[] = await page.evaluate(() => {
      const out: string[] = [];
      const walk = (n: Node, acc: string[]) => {
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType === Node.TEXT_NODE) {
            const t = c.textContent?.trim();
            if (t) acc.push(t);
          } else if (c instanceof Element) {
            if (c.tagName === 'STYLE' || c.tagName === 'SCRIPT') continue;
            if (c.shadowRoot) walk(c.shadowRoot, acc);
            if (c.tagName === 'TR' || c.tagName === 'LI' || c.tagName === 'P' || c.tagName === 'DIV') {
              const inner: string[] = [];
              walk(c, inner);
              if (c.querySelector('div, tr, li, p')) acc.push(...inner);
              else out.push(inner.join(' '));
            } else walk(c, acc);
          }
        }
      };
      const rest: string[] = [];
      walk(document.body, rest);
      return out.concat(rest).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    });
    if (lines.some((l) => /debugging pages are currently disabled/i.test(l))) return undefined;
    const criteria = [...new Set(lines.filter((l) => /^(Enough|Device Capable|Enabled by)/.test(l)))];
    return {
      performanceClass: lines.find((l) => l.startsWith('Device performance class'))?.split(':')[1]?.trim(),
      criteria,
      blockers: criteria.filter((l) => /\bfalse\b/.test(l)),
      assets: [...new Set(lines.filter((l) => /_component\b/.test(l)))],
      useCases: [...new Set(lines.filter((l) => /^(prompt_api|summarizer_api|writing_assistance_api|proofreader_api) /.test(l)))],
    };
  } catch {
    return undefined;
  } finally {
    await page.close().catch(() => {});
  }
}
