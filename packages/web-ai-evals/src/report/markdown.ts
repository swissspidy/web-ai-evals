import type { RunFile } from '../core/index.js';
import type { RunDiff } from './diff.js';
import { cellStatus, ms, modelLabel, num, score, signed } from './format.js';

/** Escape a value for a Markdown table cell. */
const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Compact Markdown summary, e.g. for $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(runs: RunFile[]): string {
  const cells = runs.flatMap((r) => r.cells);
  const lines: string[] = [`# ${runs[0]?.name ?? 'web-ai-evals'}`, ''];
  for (const id of [...new Set(cells.map((c) => c.dataset.id))]) {
    const dc = cells.filter((c) => c.dataset.id === id);
    const primary = dc[0].scorers[0];
    lines.push(`## ${id}`, '', `| Backend | Model | Browser | Status | ${cell(primary)} | TTFT p50 | Latency p50 | Tokens/s p50 |`, '|---|---|---|---|---:|---:|---:|---:|');
    for (const c of dc) {
      lines.push(
        `| ${cell(c.backend.id)} | ${cell(modelLabel(c))} | ${cell(`${c.environment.browser.id} ${c.environment.browser.version}`)} | ${cell(cellStatus(c).label)} | ${score(c.summary.scores[primary])} | ${ms(c.summary.ttftMs?.p50)} | ${ms(c.summary.warm?.totalMs?.p50 ?? c.summary.totalMs?.p50)} | ${num(c.summary.tokensPerSecond?.p50)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderDiffMarkdown(diff: RunDiff): string {
  const lines = [`# Diff ${diff.before.runId} → ${diff.after.runId}`, ''];
  if (!diff.flags.length) lines.push('No flagged changes.', '');
  else lines.push(`**${diff.flags.length} flagged change(s):**`, '', ...diff.flags.map((f) => `- ${f}`), '');
  for (const c of diff.cells) {
    const changed = c.scores.filter((s) => s.delta !== 0);
    if (!c.flags.length && !changed.length) continue;
    const b = c.before.environment;
    const a = c.after.environment;
    lines.push(`### ${c.key}`, '',
      `- browser: ${b.browser.version} → ${a.browser.version}; model: ${b.backend.model ?? '?'} ${b.backend.modelVersion ?? ''} → ${a.backend.model ?? '?'} ${a.backend.modelVersion ?? ''}`, ...c.scores.map((s) => `- ${s.metric}: ${score(s.before)} → ${score(s.after)} (${signed(s.delta)})`), `- outputs changed: ${c.changedOutputs.length}/${c.after.summary.total}`, '');
  }
  return lines.join('\n');
}
