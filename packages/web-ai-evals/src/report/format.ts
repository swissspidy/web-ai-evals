import type { CellResult } from '../core/index.js';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function ms(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${v.toFixed(0)} ms`;
}

export function num(v: number | undefined, digits = 1): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits);
}

export function score(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(3);
}

export function pct(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
}

export function signed(v: number, digits = 3): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
}

/** Human label for the model behind a cell. */
export function modelLabel(cell: CellResult): string {
  const b = cell.environment.backend;
  const parts = [b.model ?? cell.backend.model ?? builtInName(cell)];
  if (b.dtype) parts.push(b.dtype);
  if (b.device && cell.backend.kind === 'transformers') parts.push(b.device);
  return parts.filter(Boolean).join(' · ');
}

function builtInName(cell: CellResult): string {
  const browser = cell.environment.browser.name;
  if (cell.backend.kind === 'prompt-api') return browser.includes('Edge') ? 'Edge built-in model' : 'Gemini Nano';
  return `${browser} built-in`;
}

export function cellStatus(cell: CellResult): { label: string; kind: 'good' | 'warning' | 'critical' } {
  const s = cell.summary;
  if (cell.load.status === 'unavailable') return { label: 'unavailable', kind: 'critical' };
  if (cell.load.status !== 'ok') return { label: `load ${cell.load.status}`, kind: 'critical' };
  if (s.ok === s.total) return { label: 'ok', kind: 'good' };
  return { label: `${s.ok}/${s.total} ok`, kind: s.ok === 0 ? 'critical' : 'warning' };
}
