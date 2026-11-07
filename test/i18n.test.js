import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANGUAGES, FALLBACK_LANGUAGE, MESSAGES, pickLanguage, messageParams, translate,
} from '../src/i18n.js';

const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const sorted = (xs) => [...xs].sort();

test('each language has a table, and the fallback is a language', () => {
  assert.deepEqual(sorted(Object.keys(MESSAGES)), sorted(LANGUAGES));
  assert.ok(LANGUAGES.includes(FALLBACK_LANGUAGE));
});

test('all languages have the same keys', () => {
  const keys = sorted(Object.keys(MESSAGES[FALLBACK_LANGUAGE]));
  LANGUAGES.forEach((lang) => assert.deepEqual(sorted(Object.keys(MESSAGES[lang])), keys, lang));
});

test('all languages have the same parameters in each message', () => {
  Object.entries(MESSAGES[FALLBACK_LANGUAGE]).forEach(([key, text]) => {
    LANGUAGES.forEach((lang) =>
      assert.deepEqual(sorted(messageParams(MESSAGES[lang][key])), sorted(messageParams(text)), `${lang} ${key}`));
  });
});

test('no message is empty', () => {
  LANGUAGES.forEach((lang) =>
    Object.entries(MESSAGES[lang]).forEach(([key, text]) => assert.ok(text.trim(), `${lang} ${key}`)));
});

test('pickLanguage: the first known base language, else the fallback', () => {
  assert.equal(pickLanguage(['sk-SK', 'en-US']), 'sk');
  assert.equal(pickLanguage(['de-DE', 'en-GB', 'sk']), 'en');
  assert.equal(pickLanguage(['SK']), 'sk');
  assert.equal(pickLanguage(['de', 'fr']), 'en');
  assert.equal(pickLanguage([]), 'en');
  assert.equal(pickLanguage(undefined), 'en');
});

test('translate: parameters, fallback language, fallback key', () => {
  assert.equal(translate('sk', 'banner.correct', { note: 'E' }), 'Správne — E');
  assert.equal(translate('en', 'score', { correct: 3, total: 4, streak: 0 }), 'Score 3 / 4 · Streak 0');
  assert.equal(translate('xx', 'btn.start'), 'Start');
  assert.equal(translate('sk', 'no.such.key'), 'no.such.key');
  assert.equal(translate('en', 'help').includes('{Space}'), true); // a missing parameter stays
});

test('every key in index.html and ui.js exists', () => {
  const html = src('index.html');
  const fromHtml = [...html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  const fromUi = [...src('ui.js').matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(fromHtml.length > 20 && fromUi.length > 20);
  [...fromHtml, ...fromUi].forEach((key) => assert.ok(key in MESSAGES.en, key));
});
