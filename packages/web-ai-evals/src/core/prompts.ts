import type { ExampleInput, TaskDefinition, TaskType } from './types.js';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', ja: 'Japanese',
  pt: 'Portuguese', nl: 'Dutch', zh: 'Chinese', ko: 'Korean', pl: 'Polish', ru: 'Russian',
};

export function languageName(code: string | undefined): string {
  if (!code) return '';
  return LANGUAGE_NAMES[code.toLowerCase().split('-')[0]] ?? code;
}

/** Default prompt templates used when a task has no explicit `prompt`. */
export const DEFAULT_PROMPTS: Record<TaskType, string> = {
  generate: '{{text}}',
  summarize: 'Summarize the following text in one or two sentences. Reply with the summary only.\n\n{{text}}',
  write: 'Write the following. Reply with the text only.\n\n{{text}}',
  rewrite: 'Rewrite the following text. Reply with the rewritten text only.\n\n{{text}}',
  translate:
    'Translate the following text from {{sourceLanguageName}} to {{targetLanguageName}}. Reply with the translation only.\n\n{{text}}',
  classify:
    'Classify the text into exactly one of these labels: {{labels}}.\nReply with the label only.\n\nText: {{text}}\nLabel:',
  extract:
    'Extract the requested information from the text as JSON matching this schema:\n{{schema}}\nReply with JSON only.\n\nText: {{text}}',
};

/** Render a task's prompt template for a chat/completion backend. */
export function renderPrompt(task: TaskDefinition, input: ExampleInput): string {
  const template = task.prompt ?? DEFAULT_PROMPTS[task.type];
  const vars: Record<string, string> = {
    text: input.text,
    context: input.context ?? '',
    labels: (input.labels ?? []).join(', '),
    sourceLanguage: input.sourceLanguage ?? '',
    targetLanguage: input.targetLanguage ?? '',
    sourceLanguageName: languageName(input.sourceLanguage),
    targetLanguageName: languageName(input.targetLanguage),
    schema: input.schema ? JSON.stringify(input.schema) : '',
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in vars ? vars[name] : match));
}

/**
 * Map a free-form model answer onto one of the candidate labels: exact match
 * first, then the label that appears earliest in the answer.
 */
export function matchLabel(output: string, labels: string[]): string | undefined {
  const clean = output.trim().toLowerCase().replace(/^["'`*\s]+|["'`*.\s]+$/g, '');
  const exact = labels.find((l) => l.toLowerCase() === clean);
  if (exact) return exact;
  let best: { label: string; index: number } | undefined;
  for (const label of labels) {
    const re = new RegExp(`\\b${label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(clean);
    if (m && (!best || m.index < best.index)) best = { label, index: m.index };
  }
  return best?.label;
}

/** Strip markdown code fences that models like to wrap JSON in. */
export function extractJson(output: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(output);
  if (fenced) return fenced[1].trim();
  const start = output.search(/[{[]/);
  if (start === -1) return output.trim();
  const open = output[start];
  const close = open === '{' ? '}' : ']';
  const end = output.lastIndexOf(close);
  return end > start ? output.slice(start, end + 1) : output.slice(start).trim();
}
