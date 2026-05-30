// Node module-customization hook that lets attribute-less `import x from './x.json'`
// work under plain node — the same thing Vite does for the app. The data adapter
// (src/data/index.js) imports JSON without an `assert { type: 'json' }` clause,
// which Node rejects by default; this hook injects the attribute so the test
// runner can import the real modules instead of re-reading the JSON by hand.
//
// Used via: node --import ./scripts/register-json.mjs scripts/test.mjs
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    return nextLoad(url, { ...context, importAttributes: { type: 'json' } });
  }
  return nextLoad(url, context);
}
