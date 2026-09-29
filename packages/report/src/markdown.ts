import type { RunFile } from '@web-ai-evals/core';
import type { RunDiff } from './diff.js';
import { cellStatus, ms, modelLabel, num, score, signed } from './format.js';

/** Compact Markdown summary, e.g. for $GITHUB_STEP_SUMMARY. */
export function renderMarkdown(runs: RunFile[]): string {
  const cells = runs.flatMap((r) => r.cells);
  const lines: string[] = [`# ${runs[0]?.name ?? 'web-ai-evals'}`, ''];
  for (const id of [...new Set(cells.map((c) => c.dataset.id))]) {
    const dc = cells.filter((c) => c.dataset.id === id);
    const primary = dc[0].scorers[0];
    lines.push(`## ${id}`, '', `| Backend | Model | Browser | Status | ${primary} | TTFT p50 | Latency p50 | Tokens/s p50 |`, '|---|---|---|---|---:|---:|---:|---:|');
    for (const c of dc) {
      lines.push(
        `| ${c.backend.id} | ${modelLabel(c)} | ${c.environment.browser.id} ${c.environment.browser.version} | ${cellStatus(c).label} | ${score(c.summary.scores[primary])} | ${ms(c.summary.ttftMs?.p50)} | ${ms(c.summary.warm?.totalMs?.p50 ?? c.summary.totalMs?.p50)} | ${num(c.summary.tokensPerSecond?.p50)} |`,
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
    lines.push(`### ${c.key}`, '', ...c.scores.map((s) => `- ${s.metric}: ${score(s.before)} → ${score(s.after)} (${signed(s.delta)})`), `- outputs changed: ${c.changedOutputs.length}/${c.after.summary.total}`, '');
  }
  return lines.join('\n');
}
