/* Merge plugins/*.json into index.json — the single file the app fetches.
   Keeps the index shape stable: [{id, name, description, icon, type, layout,
   version, repo, path, ref, submittedBy, testedAt, latestOk, verified}]. */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dir = new URL('../plugins/', import.meta.url).pathname;
const out = new URL('../index.json', import.meta.url).pathname;
const entries = [];
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith('.json')) continue;
  try { entries.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); }
  catch (e) { console.error('skip', f, e.message); }
}
writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), plugins: entries }, null, 2) + '\n');
console.log(`index.json: ${entries.length} plugin(s)`);
