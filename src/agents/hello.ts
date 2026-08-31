'use agent';
import '../lib/load-env.ts';
import { DEFAULT_MODEL } from '../app.ts';
import { useModel } from '@flue/runtime';

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function Hello() {
  useModel(process.env.AGENT_MODEL || DEFAULT_MODEL);
  return 'You are a helpful assistant. Keep replies short.';
}
