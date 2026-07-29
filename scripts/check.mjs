// Project gate. Parses every module, resolves every local import, confirms the
// referenced assets exist, and validates the manifest against the catalog.
//
// It deliberately does not open a browser: that is a separate, approved step.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    // vendor/ is third party code, checked for presence rather than parsed.
    if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(root);
const jsFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
// Only browser code is bound by the import map. Node tooling under scripts/ is
// free to use node: builtins.
const isBrowserModule = (file) => relative(root, file).replace(/\\/g, '/').startsWith('src/');

// --- 1. every module parses, and every local import resolves ---------------

const BARE_ALLOWED = [/^three$/, /^three\/addons\//];

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');

  // Node's own parser is the source of truth for syntax. package.json sets
  // type: module, so .js files are parsed as modules.
  const parsed = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (parsed.status !== 0) {
    fail(`${relative(root, file)}: ${(parsed.stderr || '').trim().split('\n').slice(0, 3).join(' ')}`);
  }

  const importRe = /(?:^|[\s;{(])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]/g;
  const bareImportRe = /(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [importRe, bareImportRe, dynamicRe]) {
    let match;
    while ((match = re.exec(source))) {
      const spec = match[1];
      if (BARE_ALLOWED.some((p) => p.test(spec))) continue;
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        if (isBrowserModule(file)) {
          fail(`${relative(root, file)}: bare import "${spec}" is not in the import map.`);
        }
        continue;
      }
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) {
        fail(`${relative(root, file)}: import "${spec}" does not resolve to a file.`);
      }
    }
  }

  // new URL(...) asset references must resolve too.
  const urlRe = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
  let m;
  while ((m = urlRe.exec(source))) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) {
      fail(`${relative(root, file)}: new URL("${m[1]}") does not resolve to a file.`);
    }
  }
}

// --- 2. assets referenced from HTML and CSS exist --------------------------

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'styles.css'), 'utf8');

for (const match of html.matchAll(/(?:href|src)="(?!https?:|data:|#)([^"]+)"/g)) {
  if (!existsSync(join(root, match[1]))) fail(`index.html references missing file: ${match[1]}`);
}
for (const match of css.matchAll(/url\(\s*['"]?(?!https?:|data:)([^'")]+)['"]?\s*\)/g)) {
  if (!existsSync(join(root, match[1]))) fail(`styles.css references missing file: ${match[1]}`);
}

// --- 2b. the import map resolves, including vendored third party code ------

const importMapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!importMapMatch) {
  fail('index.html has no import map, so bare specifiers would not resolve.');
} else {
  const imports = JSON.parse(importMapMatch[1]).imports ?? {};

  // Every bare specifier the browser code uses must have a mapping.
  const used = new Set();
  for (const file of jsFiles.filter(isBrowserModule)) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/from\s*['"](three(?:\/[^'"]*)?)['"]/g)) used.add(m[1]);
  }

  for (const spec of used) {
    let target = null;
    if (imports[spec]) target = imports[spec];
    else {
      const prefix = Object.keys(imports)
        .filter((key) => key.endsWith('/') && spec.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
      if (prefix) target = imports[prefix] + spec.slice(prefix.length);
    }

    if (!target) {
      fail(`No import map entry covers "${spec}".`);
      continue;
    }
    if (/^https?:/.test(target)) {
      notes.push(`Remote dependency: ${spec} -> ${target}`);
      continue;
    }
    if (!existsSync(join(root, target.replace(/^\.\//, '')))) {
      fail(`Import map sends "${spec}" to ${target}, which is not present.`);
    }
  }

  // Vendored modules pull in their own relative dependencies.
  const vendorRoot = join(root, 'vendor');
  if (existsSync(vendorRoot)) {
    for (const file of walk(vendorRoot).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/from\s*['"](\.[^'"]*)['"]/g)) {
        if (!existsSync(resolve(dirname(file), m[1]))) {
          fail(`vendor: ${relative(root, file)} needs ${m[1]}, which was not vendored.`);
        }
      }
    }
  }
}

// --- 3. manifest agrees with the catalog -----------------------------------

const manifest = JSON.parse(readFileSync(join(root, 'assets', 'manifest.json'), 'utf8'));
const catalogSource = readFileSync(join(root, 'src', 'catalog.js'), 'utf8');
const catalogIds = [...catalogSource.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]);

if (catalogIds.length !== 19) {
  fail(`Expected 19 volumes in the catalog, found ${catalogIds.length}.`);
}
if (manifest.items.length !== catalogIds.length) {
  fail(`Manifest has ${manifest.items.length} items but the catalog has ${catalogIds.length}.`);
}
for (const item of manifest.items) {
  if (!catalogIds.includes(item.id)) fail(`Manifest lists unknown volume "${item.id}".`);
  for (const channel of ['spine', 'cover', 'model']) {
    const spec = item[channel];
    if (!spec) {
      fail(`Manifest item "${item.id}" is missing the "${channel}" channel.`);
      continue;
    }
    if (!spec.src && !spec.fallback) {
      fail(`Manifest item "${item.id}" channel "${channel}" has neither src nor fallback.`);
    }
    // A src that is set must point at a file that is actually present.
    if (spec.src) {
      const assetRoot = manifest.pack.assetRoot ?? '';
      const target = join(root, assetRoot, spec.src);
      if (!existsSync(target)) {
        fail(`Manifest item "${item.id}" channel "${channel}" points at missing file ${spec.src}.`);
      }
    }
  }
}
const missingFromManifest = catalogIds.filter((id) => !manifest.items.some((i) => i.id === id));
if (missingFromManifest.length) {
  fail(`Catalog volumes absent from the manifest: ${missingFromManifest.join(', ')}.`);
}

// --- 4. copy rules ---------------------------------------------------------

const DASHES = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
const copyFiles = [
  join(root, 'index.html'),
  join(root, 'styles.css'),
  join(root, 'README.md'),
  ...jsFiles,
];
for (const file of copyFiles) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  // Built from code points so this file does not trip its own rule.
  const hit = source.match(DASHES);
  if (hit) {
    const line = source.slice(0, hit.index).split('\n').length;
    fail(`${relative(root, file)}:${line}: em dash or en dash found. Use a hyphen.`);
  }
}

// The rail is one tick per volume, and the interface promises nineteen.
if (!html.includes('nineteen volumes') && !html.includes('nineteen')) {
  fail('index.html no longer states the size of the collection.');
}

// --- 5. no MCP calls in browser code ---------------------------------------

for (const file of jsFiles.filter((f) => f.includes(`${'src'}`))) {
  const source = readFileSync(file, 'utf8');
  if (/mcp\.mint\.gg\/mcp/.test(source)) {
    fail(`${relative(root, file)}: browser code must never call Mint MCP.`);
  }
}

// --- report ----------------------------------------------------------------

notes.push(`Modules parsed and import checked: ${jsFiles.length}`);
notes.push(`Volumes: ${catalogIds.length}`);
notes.push(`Manifest source: ${manifest.pack.source}`);

for (const note of notes) console.log(`  ${note}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
