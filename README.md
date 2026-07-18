# Workspace Plugin Registry

The plugin index for [Workspace](https://github.com/MohanViswagnaMR/Workspace).
**No plugin code lives here** — each entry in `plugins/` is a small JSON file
pointing at the author's own GitHub repository, pinned to the commit that
passed the automated tests. `index.json` (generated) is what the app searches.

> Push this folder to its own repository (suggested name:
> `workspace-plugin-registry`) and the automation below runs by itself.
> Then set the repo slug in the app's `src/services/pluginrepo.js`.

## How submission works

1. A developer builds a plugin in their own GitHub repo
   (`manifest.json` + entry `.jsx`, or `theme.css` for themes — see the
   [plugin docs](https://github.com/MohanViswagnaMR/Workspace/blob/main/docs/PERMISSIONS.md)).
2. From the Workspace app (or here on GitHub) they open a **Submit plugin**
   issue containing just their repo link.
3. The `submit` workflow fetches the plugin **at the current commit**, runs the
   same compatibility tests the app runs (manifest, plugin type, permissions,
   the code compiles), and:
   - ✅ pass → commits `plugins/<id>.json` (link + pinned commit SHA),
     rebuilds `index.json`, closes the issue with a success comment.
   - ❌ fail → comments the failing checks and closes the issue. Fix & resubmit.
4. The app fetches `index.json` (raw.githubusercontent.com is CORS-open) and
   shows the plugin in its search — installs pull straight from the
   **author's repo at the tested commit**.

## Updates & safety

- Entries are **pinned to the tested SHA** — pushing new commits to a plugin
  repo does NOT change what users install until it is re-tested.
- The weekly `revalidate` workflow re-tests each plugin's latest commit:
  if it passes, the pin advances; if it fails, the last good pin stays and the
  entry is marked `latestOk:false`.
- Automated tests prove a plugin *runs*, not that it is *safe*. Workspace
  still shows every plugin's permissions and asks for explicit consent before
  running it, and re-asks whenever the code changes. The `verified` flag in an
  entry is reserved for manual review by the registry maintainer.

## Local usage

```bash
npm install
node scripts/validate.js github.com/user/my-plugin        # test a repo
node scripts/validate.js --local ../path/to/plugin-folder # test a local folder
node scripts/build-index.js                               # rebuild index.json
```
