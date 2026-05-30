// Registers the JSON loader hook (json-loader.mjs) for the current process so a
// subsequently-run ESM entrypoint can import the project's .json data modules.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./json-loader.mjs', pathToFileURL('./scripts/'));
