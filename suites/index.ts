/**
 * Example suites shipped with web-ai-evals. All data in this directory was
 * written for this project and is released under CC0-1.0 (see LICENSE).
 */
import { chrF, classification, contains, jsonFieldMatch, jsonSchema, rougeL, wordCount } from '@web-ai-evals/scorers';
import type { SuiteConfig } from '@web-ai-evals/runner';
import { readFileSync } from 'node:fs';

const here = (p: string) => new URL(p, import.meta.url).pathname;
const extractionSchema = JSON.parse(readFileSync(here('./extraction/schema.json'), 'utf8')) as Record<string, unknown>;

export const sentiment: SuiteConfig = {
  id: 'sentiment',
  description: 'Three-way sentiment classification of short reviews and statements.',
  dataset: here('./sentiment/data.jsonl'),
  license: 'CC0-1.0',
  task: {
    type: 'classify',
    labels: ['positive', 'negative', 'neutral'],
    system: 'You are a precise text classifier. Answer with a single lowercase label.',
  },
  scorers: [classification()],
};

export const summarization: SuiteConfig = {
  id: 'summarization',
  description: 'One-to-two sentence summaries of short news-style articles.',
  dataset: here('./summarization/data.jsonl'),
  license: 'CC0-1.0',
  task: {
    type: 'summarize',
    prompt: 'Summarize the following article in one or two sentences. Reply with the summary only.\n\n{{text}}',
    apiOptions: { type: 'tldr', length: 'short', format: 'plain-text' },
  },
  scorers: [rougeL(), wordCount()],
};

export const extraction: SuiteConfig = {
  id: 'extraction',
  description: 'Structured JSON extraction of restaurant booking requests.',
  dataset: here('./extraction/data.jsonl'),
  license: 'CC0-1.0',
  task: {
    type: 'extract',
    responseSchema: extractionSchema,
    prompt:
      'Extract the booking from the message as JSON with the keys "name" (string), "date" (YYYY-MM-DD), "city" (string) and "guests" (integer). Reply with JSON only.\n\nMessage: {{text}}',
  },
  scorers: [jsonFieldMatch(), jsonSchema()],
};

export const translation: SuiteConfig = {
  id: 'translation',
  description: 'English to German translation of everyday sentences.',
  dataset: here('./translation/data.jsonl'),
  license: 'CC0-1.0',
  task: { type: 'translate', sourceLanguage: 'en', targetLanguage: 'de' },
  scorers: [chrF(), contains({ name: 'exact' })],
};

export const allSuites = [sentiment, summarization, extraction, translation];
