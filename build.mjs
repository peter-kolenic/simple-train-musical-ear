// Inline src/*.js into dist/ear-trainer.html.
// Strip import lines and the `export` keyword. Concatenate the modules in
// dependency order inside one IIFE.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = (name) => join(root, 'src', name);
const OUT = join(root, 'dist', 'ear-trainer.html');
const MARKER = '<!--SCRIPT-->';

// Dependency order. Add modules here as phases add them.
const MODULES = ['music.js', 'game.js', 'ui.js'];

const stripModuleSyntax = (code) =>
  code
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line))
    .filter((line) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))
    .map((line) => line.replace(/^(\s*)export\s+(default\s+)?/, '$1'))
    .join('\n');

const bundle = MODULES
  .map((name) => `// ---- ${name} ----\n${stripModuleSyntax(readFileSync(src(name), 'utf8'))}`)
  .join('\n');

const html = readFileSync(src('index.html'), 'utf8');
if (!html.includes(MARKER)) throw new Error(`index.html has no ${MARKER} marker`);

// A literal "</script" in the bundle would end the script element early.
if (/<\/script/i.test(bundle)) throw new Error('bundle contains "</script"');

const script = `<script>\n(() => {\n'use strict';\n${bundle}\n})();\n</script>`;
// Function replacer: "$" in the bundle must not act as a replacement pattern.
const out = html.replace(MARKER, () => script);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${Buffer.byteLength(out)} bytes)`);
