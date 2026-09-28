#!/usr/bin/env node
/**
 * Autional design-system generator.
 *
 * Reads tokens/tokens.json (the single source of truth) and emits every
 * generated artifact into packages/. Generated files are committed.
 *
 * Usage:
 *   node scripts/generate.mjs           # write artifacts
 *   node scripts/generate.mjs --check   # verify on-disk artifacts, exit 1 on drift
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'tokens/tokens.json'), 'utf8'));
const VERSION = TOKENS.$meta.version;

const outputs = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const GENERATED = (source) =>
  `GENERATED FILE — DO NOT EDIT. Source: ${source} · Regenerate: pnpm gen · v${VERSION}`;

const isRef = (v) => typeof v === 'string' && /^\{[^}]+\}$/.test(v);
const refPath = (v) => v.slice(1, -1).split('.');
const varName = (path) => `--${path.map(String).join('-')}`;

const cssValue = (v) => {
  if (typeof v === 'string') return isRef(v) ? `var(${varName(refPath(v))})` : v;
  throw new Error(`Unsupported token value: ${JSON.stringify(v)}`);
};

const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'cursive', 'fantasy']);
const cssFontStack = (stack) =>
  stack.map((f) => (GENERIC_FAMILIES.has(f) || !/[\s\d]/.test(f) ? f : `'${f}'`)).join(', ');

/** Emit CSS custom properties for one namespace-keyed object (`$` keys skipped). */
function emitVars(tree, indent = '  ') {
  const lines = [];
  const space = ' '.repeat(indent);
  for (const [ns, group] of Object.entries(tree)) {
    if (ns.startsWith('$')) continue;
    lines.push(`${space}/* ── ${ns} ── */`);
    if (ns === 'font') {
      for (const [k, v] of Object.entries(group)) {
        if (k.startsWith('$')) continue;
        lines.push(`${space}--font-${k}: ${cssFontStack(v)};`);
      }
    } else if (ns === 'font-size') {
      for (const [k, v] of Object.entries(group)) {
        if (k.startsWith('$')) continue;
        lines.push(`${space}--font-size-${k}: ${v.size};`);
        if (v.lineHeight) lines.push(`${space}--line-height-${k}: ${v.lineHeight};`);
        if (v.fontWeight) lines.push(`${space}--font-weight-${k}: ${v.fontWeight};`);
        if (v.letterSpacing) lines.push(`${space}--letter-spacing-${k}: ${v.letterSpacing};`);
      }
    } else {
      for (const [k, v] of Object.entries(group)) {
        if (k.startsWith('$')) continue;
        if (v !== null && typeof v === 'object') {
          for (const [k2, v2] of Object.entries(v)) {
            if (k2.startsWith('$')) continue;
            lines.push(`${space}${varName([ns, k, k2])}: ${cssValue(v2)};`);
          }
        } else {
          lines.push(`${space}${varName([ns, k])}: ${cssValue(v)};`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Resolve `{a.b.c}` chains against layered contexts (later layers win). */
function makeResolver(layers) {
  const lookup = (path) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      let node = layers[i];
      let ok = node !== undefined;
      for (const seg of path) {
        if (node !== null && typeof node === 'object' && seg in node) node = node[seg];
        else { ok = false; break; }
      }
      if (ok) return node;
    }
    return undefined;
  };
  const resolve = (value, depth = 0) => {
    if (depth > 16) throw new Error(`Reference cycle at ${JSON.stringify(value)}`);
    if (typeof value !== 'string' || !isRef(value)) return value;
    const raw = lookup(refPath(value));
    if (raw === undefined) throw new Error(`Unresolved reference ${value}`);
    return resolve(raw, depth + 1);
  };
  return { resolve, raw: (path) => lookup(path) };
}

/** Pretty-print a JS value as an ES5 object literal (single quotes, 2-space). */
// Exact structural type for the emitted tokens.json, so consumers can index
// e.g. `tokens.core.color.primary['700']` without casting.
function tsType(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    const members = [...new Set(value.map((v) => tsType(v, 0)))];
    return `(${members.join(' | ')})[]`;
  }
  if (value !== null && typeof value === 'object') {
    if (Object.keys(value).length === 0) return 'Record<string, never>';
    const inner = Object.entries(value)
      .map(([k, v]) => `${pad}  ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsType(v, indent + 1)};`)
      .join('\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'unknown';
}

// String literals that contain an apostrophe (e.g. CSS font stacks) are emitted
// with double quotes so the generated JS stays parseable.
function jsStr(value) {
  return value.includes("'") ? JSON.stringify(value) : `'${value}'`;
}

function js(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (typeof v === 'string' ? jsStr(v) : js(v, indent))).join(', ')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const inner = Object.entries(value)
      .map(([k, v]) => {
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : jsStr(k);
        return `${pad}  ${key}: ${js(v, indent + 1)}`;
      })
      .join(',\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof value === 'string') return jsStr(value);
  return String(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// tokens.css (+ profile stylesheets)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_LAYER = `@layer base {
  html {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    margin: 0;
  }
  :focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }
}`;

const REDUCED_MOTION = `@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;

function themeBlock(selector, body) {
  return `${selector} {\n${body}\n}`;
}

function selectorFor(name) {
  return name === 'dark' ? '.dark,\n[data-theme="dark"]' : `[data-theme="${name}"]`;
}

function blockBody(node) {
  const parts = [];
  if (node.$colorScheme) parts.push(`  color-scheme: ${node.$colorScheme};`);
  if (node.color || node.focus) {
    parts.push(emitVars({ ...(node.color ? { color: node.color } : {}), ...(node.focus ? { focus: node.focus } : {}) }));
  }
  return parts.join('\n\n');
}

const variantBlocks = [];
// Cascade order is deliberate and must mirror the legacy tokens.css:
// [data-theme=portal|auth] set light-surface overrides and must LOSE to .dark;
// [data-theme=authenticator] is dark-first and must WIN over .dark.
const VARIANT_ORDER = ['portal', 'auth', 'dark', 'authenticator'];
const allVariants = { ...TOKENS.variants, dark: TOKENS.modes.dark };
const ordered = [
  ...VARIANT_ORDER.filter((n) => allVariants[n]),
  ...Object.keys(allVariants).filter((n) => !VARIANT_ORDER.includes(n)),
];
for (const name of ordered) {
  const node = allVariants[name];
  if (node.$kind === 'runtime') continue;
  variantBlocks.push(themeBlock(selectorFor(name), blockBody(node)));
}

// CSS artifacts live at package-root paths (not dist/) because postcss-import does
// not read the `exports` map — consumers resolve them as plain files through node_modules.
outputs.set(
  'packages/tokens/tokens.css',
  `/**\n * Autional Design Tokens — ${GENERATED('tokens/tokens.json')}\n */\n\n` +
    themeBlock(':root', emitVars(TOKENS.core)) +
    '\n\n' +
    BASE_LAYER +
    '\n\n' +
    variantBlocks.join('\n\n') +
    '\n\n' +
    REDUCED_MOTION +
    '\n',
);

for (const [name, profile] of Object.entries(TOKENS.profiles)) {
  const hasOverrides = Object.keys(profile).some((k) => !k.startsWith('$'));
  if (!hasOverrides) continue;
  const body = emitVars(
    Object.fromEntries(Object.entries(profile).filter(([k]) => !k.startsWith('$'))),
  );
  outputs.set(
    `packages/tokens/profiles/${name}.css`,
    `/**\n * Autional profile: ${name} — ${GENERATED('tokens/tokens.json')}\n * Load AFTER @autional-cn/tokens/tokens.css.\n */\n\n${themeBlock(':root', body)}\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens package: data + typed entry + antd bridge + chart colors
// ─────────────────────────────────────────────────────────────────────────────

outputs.set('packages/tokens/dist/tokens.json', JSON.stringify(TOKENS, null, 2) + '\n');

outputs.set(
  'packages/tokens/dist/index.js',
  `'use strict';\n/** ${GENERATED('tokens/tokens.json')} */\nmodule.exports = require('./tokens.json');\n`,
);

outputs.set(
  'packages/tokens/dist/index.d.ts',
  `/** ${GENERATED('tokens/tokens.json')} */\n` +
    `declare const tokens: ${tsType(TOKENS, 0)};\n` +
    `export = tokens;\n`,
);

const light = makeResolver([TOKENS.core]);
const dark = makeResolver([TOKENS.core, TOKENS.modes.dark]);
const pixel = (v) => (typeof v === 'string' && /^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : v);

const antdToken = (ctx) => ({
  colorPrimary: ctx.resolve('{color.brand-base}'),
  colorSuccess: ctx.resolve('{color.success}'),
  colorWarning: ctx.resolve('{color.warning}'),
  colorError: ctx.resolve('{color.danger}'),
  colorInfo: ctx.resolve('{color.info}'),
  colorBgContainer: ctx.resolve('{color.bg-surface}'),
  colorBgElevated: ctx.resolve('{color.bg-elevated}'),
  colorText: ctx.resolve('{color.text-primary}'),
  borderRadius: pixel(ctx.resolve('{radius.sm}')),
  fontFamily: cssFontStack(TOKENS.core.font.sans),
});

outputs.set(
  'packages/tokens/dist/antd-theme.js',
  `'use strict';\n/** ${GENERATED('tokens/tokens.json')}\n *\n * antd v5/v6 ThemeConfig bridge. Usage:\n *   const antdToken = require('@autional-cn/tokens/antd-theme');\n *   <ConfigProvider theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,\n *                            token: (isDark ? antdToken.dark : antdToken.light).token }}>\n */\n` +
    `module.exports = {\n  light: { token: ${js(antdToken(light), 1)} },\n  dark: { token: ${js(antdToken(dark), 1)} },\n};\n`,
);

outputs.set(
  'packages/tokens/dist/antd-theme.d.ts',
  `/** ${GENERATED('tokens/tokens.json')} */\n` +
    `declare const antdTheme: {\n` +
    `  light: { token: Record<string, string | number> };\n` +
    `  dark: { token: Record<string, string | number> };\n` +
    `};\n` +
    `export = antdTheme;\n`,
);

const chartColors = {};
for (const [k, v] of Object.entries(TOKENS.core.color.chart)) {
  if (!k.startsWith('$')) chartColors[k] = light.resolve(v);
}
const methodColors = {};
for (const [k, v] of Object.entries(TOKENS.core.color.method)) {
  if (!k.startsWith('$')) methodColors[k] = light.resolve(v);
}
outputs.set(
  'packages/tokens/dist/chart.js',
  `'use strict';\n/** ${GENERATED('tokens/tokens.json')}\n *\n * Literal color values for chart libraries that need real hex strings.\n * Status-like series should use the semantic group, not the chart group.\n */\n` +
    `module.exports = {\n  chart: ${js(chartColors, 1)},\n  method: ${js(methodColors, 1)},\n  semantic: {\n    success: ${js(light.resolve('{color.success}'))},\n    warning: ${js(light.resolve('{color.warning}'))},\n    danger: ${js(light.resolve('{color.danger}'))},\n    info: ${js(light.resolve('{color.info}'))},\n  },\n};\n`,
);

outputs.set(
  'packages/tokens/dist/chart.d.ts',
  `/** ${GENERATED('tokens/tokens.json')} */\n` +
    `declare const chart: {\n` +
    `  chart: Record<string, string>;\n` +
    `  method: Record<string, string>;\n` +
    `  semantic: Record<string, string>;\n` +
    `};\n` +
    `export = chart;\n`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Tailwind preset package
// ─────────────────────────────────────────────────────────────────────────────

const PALETTES = ['primary', 'sky', 'amber', 'neutral', 'chart', 'method'];
const FLAT_COLORS = [
  ['success', 'success'],
  ['warning', 'warning'],
  ['danger', 'danger'],
  ['error', 'danger'],
  ['info', 'info'],
  ['brand', 'brand'],
  ['brand-hover', 'brand-hover'],
  ['brand-soft', 'brand-soft'],
  ['brand-active', 'brand-active'],
  ['accent', 'accent'],
  ['inverse', 'text-inverse'],
  ['surface', 'bg-surface'],
  ['muted', 'bg-muted'],
  ['border-subtle', 'border-subtle'],
  ['border-strong', 'border-strong'],
];

const presetColors = {};
for (const name of PALETTES) {
  presetColors[name] = Object.fromEntries(
    Object.entries(TOKENS.core.color[name])
      .filter(([k]) => !k.startsWith('$'))
      .map(([k]) => [k, `var(${varName(['color', name, k])})`]),
  );
}
for (const [className, varSuffix] of FLAT_COLORS) {
  presetColors[className] = `var(--color-${varSuffix})`;
}

const presetFontSize = Object.fromEntries(
  Object.entries(TOKENS.core['font-size'])
    .filter(([k]) => !k.startsWith('$'))
    .map(([k, v]) => {
      const opts = {};
      if (v.lineHeight) opts.lineHeight = v.lineHeight;
      if (v.fontWeight) opts.fontWeight = v.fontWeight;
      if (v.letterSpacing) opts.letterSpacing = v.letterSpacing;
      return [k, Object.keys(opts).length ? [v.size, opts] : [v.size]];
    }),
);

const preset = {
  theme: {
    extend: {
      colors: presetColors,
      fontFamily: {
        sans: TOKENS.core.font.sans,
        serif: TOKENS.core.font.serif,
        mono: TOKENS.core.font.mono,
      },
      fontSize: presetFontSize,
      spacing: TOKENS.core.space,
      borderRadius: TOKENS.core.radius,
      boxShadow: TOKENS.core.shadow,
      zIndex: TOKENS.core.z,
      backgroundImage: Object.fromEntries(
        Object.entries(TOKENS.core.image)
          .filter(([k]) => !k.startsWith('$'))
          .map(([k]) => [k, `var(${varName(['image', k])})`]),
      ),
    },
  },
  plugins: [],
};

outputs.set(
  'packages/tailwind-preset/index.js',
  `/** @type {import('tailwindcss').Config} */\n// ${GENERATED('tokens/tokens.json')}\nmodule.exports = ${js(preset)};\n`,
);

outputs.set(
  'packages/tailwind-preset/index.d.ts',
  `/** ${GENERATED('tokens/tokens.json')} */\n` +
    `declare const preset: { theme: { extend: Record<string, unknown> } };\n` +
    `export default preset;\n`,
);

outputs.set(
  'packages/tailwind-preset/tokens.css',
  `@import '@autional-cn/tokens/tokens.css';\n\n/* ${GENERATED('tokens/tokens.json')} — redirect kept so existing\n   \`@import '@autional-cn/tailwind-preset/tokens.css'\` consumers keep working. */\n`,
);

// ─────────────────────────────────────────────────────────────────────────────
// Write or verify
// ─────────────────────────────────────────────────────────────────────────────

let drift = 0;
for (const [rel, content] of outputs) {
  const abs = join(ROOT, rel);
  if (CHECK) {
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current !== content) {
      drift++;
      console.error(`DRIFT  ${rel}`);
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`wrote  ${rel}`);
  }
}

if (CHECK) {
  if (drift > 0) {
    console.error(`\n${drift} generated file(s) out of date. Run: pnpm gen`);
    process.exit(1);
  }
  console.log(`OK — all ${outputs.size} generated files are up to date.`);
} else {
  console.log(`\nDone — ${outputs.size} files generated.`);
}
