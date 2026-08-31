import { sqlite } from '@flue/runtime/node';
import type { PersistenceAdapter } from '@flue/runtime/adapter';

// Conversations, attachments, and accepted submissions are stored here so
// they survive a restart. Swap in another adapter (Postgres, libSQL, ...)
// when one host's SQLite file is no longer enough:
// https://flueframework.com/docs/guide/database/
// The explicit annotation keeps the emitted .d.ts portable — the inferred
// type would reference a @flue/runtime internal module.
const store: PersistenceAdapter = sqlite('./data/flue.db');
export default store;
