// Load .env before any other module evaluates. ESM imports are hoisted, so a
// loadEnvFile call in an entry module's body runs only AFTER every imported
// module has already evaluated — any module reading process.env at import
// time would see missing keys. Importing this dependency-free module FIRST
// guarantees .env is populated before anything else runs.
//
// process.loadEnvFile is Node >=21.7. The dev sources run on Node >=24
// (native type-stripping); the published bin (compiled to dist/) runs on the
// @flue/runtime floor (>=22.19), which also covers loadEnvFile.
try {
  process.loadEnvFile('.env');
} catch (e) {
  // A missing .env is fine (fresh checkout / CI), matching the tolerant
  // --env-file-if-exists behavior. Anything beyond that (malformed .env,
  // permission errors, ...) is rethrown: swallowing it would surface later as
  // a confusing provider-key failure.
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
