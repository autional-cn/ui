#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')));
const MANIFEST_PATH = path.join(ROOT, 'ASTRYX_MANIFEST.json');

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function parseArgs(argv) {
  const args = [];
  const options = {
    json: false,
    dense: false,
    detail: 'compact',
    lang: 'en',
    site: undefined,
    type: undefined,
    limit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      args.push(part);
      continue;
    }

    if (part === '--json') {
      options.json = true;
      continue;
    }
    if (part === '--dense') {
      options.dense = true;
      options.lang = 'dense';
      continue;
    }
    if (part === '--detail') {
      options.detail = argv[i + 1];
      i += 1;
      continue;
    }
    if (part.startsWith('--detail=')) {
      options.detail = part.split('=')[1];
      continue;
    }
    if (part === '--lang') {
      options.lang = argv[i + 1];
      i += 1;
      continue;
    }
    if (part.startsWith('--lang=')) {
      options.lang = part.split('=')[1];
      continue;
    }
    if (part === '--site') {
      options.site = argv[i + 1];
      i += 1;
      continue;
    }
    if (part.startsWith('--site=')) {
      options.site = part.split('=')[1];
      continue;
    }
    if (part === '--type') {
      options.type = argv[i + 1];
      i += 1;
      continue;
    }
    if (part.startsWith('--type=')) {
      options.type = part.split('=')[1];
      continue;
    }
    if (part === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (part.startsWith('--limit=')) {
      options.limit = Number(part.split('=')[1]);
      continue;
    }
  }

  return { args, options };
}

function success(type, data) {
  return { type, data };
}

function failure(code, error, suggestions = []) {
  return { error, code, suggestions };
}

function print(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, options.dense ? 0 : 2)}\n`);
    return;
  }

  if (result.error) {
    process.stderr.write(`${result.code}: ${result.error}\n`);
    if (result.suggestions?.length) {
      process.stderr.write(`Suggestions: ${result.suggestions.map((item) => item.name).join(', ')}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const { type, data } = result;
  switch (type) {
    case 'manifest':
      process.stdout.write(`Manifest: ${data.name}\nCommands: ${data.commands.map((command) => command.name).join(', ')}\n`);
      break;
    case 'sites.list':
      process.stdout.write(`${data.items.map((site) => `${site.id} - ${site.label}`).join('\n')}\n`);
      break;
    case 'site.detail':
      process.stdout.write(`${data.id}\n${data.label}\n${data.goal}\n${data.tokenFile}\n${data.styleFile}\n`);
      break;
    case 'primitives.list':
      process.stdout.write(`${data.items.map((item) => `${item.id} - ${item.role}`).join('\n')}\n`);
      break;
    case 'primitive.detail':
      process.stdout.write(`${data.id}\n${data.role}\nUse: ${data.whenToUse.join('; ')}\nAvoid: ${data.whenNotToUse.join('; ')}\n`);
      break;
    case 'resources.list':
      process.stdout.write(`${data.items.map((item) => `${item.id} -> ${item.path}`).join('\n')}\n`);
      break;
    case 'resolve.result':
      process.stdout.write(`${data.ref}\n${data.kind}\n${(data.paths || []).join('\n')}\n`);
      break;
    case 'search.results':
      process.stdout.write(`${data.results.map((item) => `[${item.kind}] ${item.id} - ${item.description}`).join('\n')}\n`);
      break;
    default:
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

function normalizeSuggestions(items, query) {
  const q = query.toLowerCase();
  return items
    .filter((item) => item.toLowerCase().includes(q) || q.includes(item.toLowerCase()))
    .slice(0, 5)
    .map((name) => ({ name, reason: 'similar id' }));
}

function findSite(manifest, id) {
  return manifest.siteProfiles.find((site) => site.id === id);
}

function getPrimitivePool(manifest) {
  const explicitSiteSpecific = (manifest.siteSpecificPrimitives || []).map((primitive) => ({
    ...primitive,
    sites: primitive.sites || [primitive.site],
  }));
  const declaredIds = new Set(explicitSiteSpecific.map((item) => item.id));
  const inferredFallback = manifest.siteProfiles.flatMap((site) =>
    (site.specificPrimitives || [])
      .filter((id) => !declaredIds.has(id))
      .map((id) => ({
        id,
        kind: 'class',
        role: `site-specific primitive for ${site.id}`,
        sites: [site.id],
        canonicalFiles: [site.styleFile],
        whenToUse: site.mustHavePatterns || [],
        whenNotToUse: [],
        examples: [],
      }))
  );
  return [...manifest.sharedPrimitives, ...explicitSiteSpecific, ...inferredFallback];
}

function findPrimitive(manifest, id) {
  return getPrimitivePool(manifest).find((primitive) => primitive.id === id);
}

function listResources(manifest, typeFilter) {
  const groups = [];
  if (!typeFilter || typeFilter === 'logos') {
    groups.push(...manifest.resources.logos.map((item) => ({ ...item, kind: 'logo' })));
  }
  if (!typeFilter || typeFilter === 'favicons') {
    groups.push(...manifest.resources.favicons.map((item) => ({ ...item, kind: 'favicon' })));
  }
  return groups;
}

function resolveRef(manifest, ref) {
  const [kind, id] = ref.includes(':') ? ref.split(':', 2) : ['primitive', ref];
  if (kind === 'site') {
    const site = findSite(manifest, id);
    if (!site) {
      return failure('ERR_UNKNOWN_SITE', `Unknown site "${id}"`, normalizeSuggestions(manifest.siteProfiles.map((item) => item.id), id));
    }
    return success('resolve.result', {
      ref,
      kind: 'site',
      paths: [site.tokenFile, site.profileFile, site.styleFile, site.guidelineFile, site.caseStudyFile].filter(Boolean),
      hints: site.mustHavePatterns,
    });
  }
  if (kind === 'primitive') {
    const primitive = findPrimitive(manifest, id);
    if (!primitive) {
      return failure('ERR_UNKNOWN_PRIMITIVE', `Unknown primitive "${id}"`, normalizeSuggestions(getPrimitivePool(manifest).map((item) => item.id), id));
    }
    return success('resolve.result', {
      ref,
      kind: 'primitive',
      paths: primitive.canonicalFiles || [],
      hints: primitive.whenToUse || [],
    });
  }
  if (kind === 'logo' || kind === 'favicon' || kind === 'resource') {
    const resource = listResources(manifest).find((item) => item.id === id);
    if (!resource) {
      return failure('ERR_UNKNOWN_RESOURCE', `Unknown resource "${id}"`, normalizeSuggestions(listResources(manifest).map((item) => item.id), id));
    }
    return success('resolve.result', {
      ref,
      kind: resource.kind,
      paths: [resource.path],
      hints: resource.role ? [resource.role] : [],
    });
  }
  return failure('ERR_INVALID_ARGUMENT', `Unknown resolve kind "${kind}"`);
}

function searchManifest(manifest, query, options) {
  const q = query.toLowerCase();
  const rows = [];

  const allow = (kind) => !options.type || options.type === kind;

  if (allow('site')) {
    for (const site of manifest.siteProfiles) {
      const hay = [site.id, site.label, site.goal, ...(site.mustHavePatterns || [])].join(' ').toLowerCase();
      if (hay.includes(q)) {
        rows.push({
          kind: 'site',
          id: site.id,
          description: site.goal,
          path: site.guidelineFile || site.styleFile,
        });
      }
    }
  }

  if (allow('primitive')) {
    for (const primitive of getPrimitivePool(manifest)) {
      const hay = [
        primitive.id,
        primitive.role,
        ...(primitive.whenToUse || []),
        ...(primitive.examples || []),
      ].join(' ').toLowerCase();
      if (hay.includes(q)) {
        rows.push({
          kind: 'primitive',
          id: primitive.id,
          description: primitive.role,
          path: (primitive.canonicalFiles || [])[0],
        });
      }
    }
  }

  if (allow('resource')) {
    for (const resource of listResources(manifest)) {
      const hay = [resource.id, resource.path, resource.role || '', resource.kind].join(' ').toLowerCase();
      if (hay.includes(q)) {
        rows.push({
          kind: 'resource',
          id: resource.id,
          description: resource.role || resource.kind,
          path: resource.path,
        });
      }
    }
  }

  if (allow('doc')) {
    for (const site of manifest.siteProfiles) {
      const docs = [site.guidelineFile, site.caseStudyFile];
      for (const doc of docs) {
        if (doc.toLowerCase().includes(q)) {
          rows.push({
            kind: 'doc',
            id: path.basename(doc),
            description: `documentation entry for ${site.id}`,
            path: doc,
          });
        }
      }
    }
  }

  if (allow('token')) {
    for (const site of manifest.siteProfiles) {
      if (site.tokenFile.toLowerCase().includes(q) || site.id.toLowerCase().includes(q)) {
        rows.push({
          kind: 'token',
          id: `${site.id}-tokens`,
          description: `token file for ${site.id}`,
          path: site.tokenFile,
        });
      }
    }
  }

  if (allow('style')) {
    for (const site of manifest.siteProfiles) {
      if (site.styleFile.toLowerCase().includes(q) || site.id.toLowerCase().includes(q)) {
        rows.push({
          kind: 'style',
          id: `${site.id}-styles`,
          description: `global style entry for ${site.id}`,
          path: site.styleFile,
        });
      }
    }
  }

  return success('search.results', {
    query,
    results: rows.slice(0, Number.isFinite(options.limit) ? options.limit : 20),
  });
}

function main() {
  const manifest = loadManifest();
  const { args, options } = parseArgs(process.argv.slice(2));
  const [command = 'manifest', arg1] = args;

  let result;

  switch (command) {
    case 'manifest':
      result = success('manifest', manifest.cliManifest);
      break;
    case 'sites':
      result = success('sites.list', {
        items: manifest.siteProfiles.map((site) => ({
          id: site.id,
          label: site.label,
          goal: site.goal,
        })),
      });
      break;
    case 'site': {
      const site = findSite(manifest, arg1);
      result = site
        ? success('site.detail', site)
        : failure('ERR_UNKNOWN_SITE', `Unknown site "${arg1}"`, normalizeSuggestions(manifest.siteProfiles.map((item) => item.id), arg1 || ''));
      break;
    }
    case 'primitives':
      result = success('primitives.list', { items: getPrimitivePool(manifest) });
      break;
    case 'primitive': {
      const primitive = findPrimitive(manifest, arg1);
      result = primitive
        ? success('primitive.detail', primitive)
        : failure('ERR_UNKNOWN_PRIMITIVE', `Unknown primitive "${arg1}"`, normalizeSuggestions(getPrimitivePool(manifest).map((item) => item.id), arg1 || ''));
      break;
    }
    case 'resources':
      result = success('resources.list', { items: listResources(manifest, options.type) });
      break;
    case 'resolve':
      result = resolveRef(manifest, arg1 || '');
      break;
    case 'search':
      result = searchManifest(manifest, arg1 || '', options);
      break;
    default:
      result = failure('ERR_INVALID_ARGUMENT', `Unknown command "${command}"`);
      break;
  }

  print(result, options);
}

main();
