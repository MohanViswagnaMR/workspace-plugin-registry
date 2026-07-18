/* =========================================================================
   validate.js — automated plugin test (the registry's gate)
   -------------------------------------------------------------------------
   Mirrors the checks the Workspace app runs before a plugin can render
   (src/plugins.jsx testPluginCompat + src/services/plugin.js registry).
   KEEP THE CONSTANTS BELOW IN SYNC WITH THE APP — when the app gains a
   plugin type / permission / API version, mirror it here.

   Usage:
     node scripts/validate.js github.com/user/repo[/tree/ref[/path]]
     node scripts/validate.js --local ../my-plugin
   Exit 0 on pass. Prints a JSON report on stdout (last line):
     { ok, id, sha, manifest:{...}, checks:[{label,pass,detail}] }
   ========================================================================= */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { transform } from 'sucrase';

/* ---- KEEP IN SYNC with src/services/plugin.js + src/plugins.jsx ---- */
const SUPPORTED_TYPES = ['page', 'theme'];
const PLANNED_TYPES = ['layout', 'icons', 'syntax', 'components'];
const PLUGIN_LAYOUTS = ['home', 'code', 'all'];
const PERMISSIONS = ['pages:read', 'pages:navigate'];
const SUPPORTED_API_VERSIONS = [1];
const FILE_RE = /\.(json|jsx?|css|md)$/i;
const MAX_FILE = 512 * 1024;

const GH = 'https://api.github.com';
const headers = { 'User-Agent': 'workspace-plugin-registry' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

function parseUrl(u) {
  const m = String(u || '').trim().match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^\/\s]+)(?:\/(.*?))?)?\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] || '', path: (m[4] || '').replace(/\/+$/, '') };
}

async function gh(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${url}`);
  return r.json();
}

/* Resolve the exact commit SHA being tested (pin what we validated). */
async function resolveSha(ref) {
  const branch = ref.ref || (await gh(`${GH}/repos/${ref.owner}/${ref.repo}`)).default_branch;
  const c = await gh(`${GH}/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(branch)}`);
  return c.sha;
}

async function fetchFiles(ref, sha) {
  const listing = await gh(`${GH}/repos/${ref.owner}/${ref.repo}/contents/${ref.path}?ref=${sha}`);
  if (!Array.isArray(listing)) throw new Error('URL points at a file — link the plugin FOLDER (or repo root)');
  const files = {};
  await Promise.all(listing.map(async it => {
    if (it.type !== 'file' || !FILE_RE.test(it.name) || it.size > MAX_FILE) return;
    const r = await fetch(it.download_url, { headers });
    if (r.ok) files[it.name] = await r.text();
  }));
  return files;
}

function localFiles(dir) {
  const files = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && FILE_RE.test(name) && statSync(p).size <= MAX_FILE)
      files[name] = readFileSync(p, 'utf8');
  }
  return files;
}

/* CJS-style compile pass — same transforms the app applies in the browser. */
function compile(files, entry) {
  const seen = {};
  const load = path => {
    if (seen[path]) return; seen[path] = true;
    const js = transform(files[path], { transforms: ['jsx', 'imports'], production: true }).code;
    for (const m of js.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
      const base = m[1].replace(/^\.\//, '');
      const hit = [base, base + '.jsx', base + '.js'].find(c => files[c] != null);
      if (!hit) throw new Error(`${path}: import not found: "${m[1]}"`);
      load(hit);
    }
  };
  load(entry);
}

export function validateFiles(files) {
  const checks = [];
  const add = (label, pass, detail = '') => checks.push({ label, pass, detail });
  let manifest = {};
  try { manifest = JSON.parse(files['manifest.json'] || '{}'); } catch (_) {}
  const type = String(manifest.type || 'page').toLowerCase();
  const layout = String(manifest.layout || 'all').toLowerCase();
  const id = String(manifest.id || '');
  const entry = typeof manifest.entry === 'string' && files[manifest.entry] ? manifest.entry
    : ['page.jsx', 'page.js', 'index.jsx', 'index.js'].find(f => files[f]) || null;
  const styles = typeof manifest.styles === 'string' && files[manifest.styles] ? manifest.styles
    : (files['theme.css'] ? 'theme.css' : null);

  add('manifest.json present & valid JSON', !!files['manifest.json'] && !!Object.keys(manifest).length);
  add('id is set and url-safe', /^[\w.-]{2,64}$/.test(id), id ? `got "${id}"` : 'missing "id"');
  add('name & description set', !!manifest.name && !!manifest.description,
    'both are shown in the plugin search');
  add(`apiVersion supported`, SUPPORTED_API_VERSIONS.includes(manifest.apiVersion ?? 1),
    `app supports: ${SUPPORTED_API_VERSIONS.join(', ')}`);
  add(`type "${type}" supported`, SUPPORTED_TYPES.includes(type),
    PLANNED_TYPES.includes(type) ? `"${type}" plugins are planned but not yet supported`
      : SUPPORTED_TYPES.includes(type) ? '' : `must be one of: ${SUPPORTED_TYPES.join(', ')}`);
  add(`layout "${layout}" recognized`, PLUGIN_LAYOUTS.includes(layout),
    `must be one of: ${PLUGIN_LAYOUTS.join(', ')}`);
  const unknown = (manifest.permissions || []).filter(p => !PERMISSIONS.includes(p));
  add('permissions recognized', unknown.length === 0, unknown.length ? `unknown: ${unknown.join(', ')}` : '');
  if (type === 'theme') {
    add('theme css present', !!styles, 'add "styles": "theme.css" (and the file)');
  } else {
    add('entry file present', !!entry, 'need page.jsx or an "entry" field pointing at an existing file');
    if (entry) {
      try { compile(files, entry); add('code compiles (jsx + relative imports)', true); }
      catch (e) { add('code compiles (jsx + relative imports)', false, String(e.message || e)); }
    }
  }
  return { ok: checks.every(c => c.pass), id, manifest: { id, type, layout,
    name: manifest.name || id, description: manifest.description || '',
    icon: manifest.icon || '🧩', version: manifest.version || '0.0.0',
    handles: manifest.handles || [], permissions: manifest.permissions || [] }, checks };
}

/* ------------------------------------------------------------------ cli -- */
const arg = process.argv[2];
if (arg) {
  let report;
  if (arg === '--local') {
    report = { sha: 'local', repo: 'local', path: '', ...validateFiles(localFiles(process.argv[3])) };
  } else {
    const ref = parseUrl(arg);
    if (!ref) { console.error('Not a GitHub URL:', arg); process.exit(2); }
    const sha = await resolveSha(ref);
    const files = await fetchFiles(ref, sha);
    report = { sha, repo: `${ref.owner}/${ref.repo}`, path: ref.path, ...validateFiles(files) };
  }
  for (const c of report.checks)
    console.error(`${c.pass ? '  ✓' : '  ✕'} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}
