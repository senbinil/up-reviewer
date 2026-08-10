'use agent';
import { useModel } from '@flue/runtime';

// Every exported capitalized function in a 'use agent' module is an agent,
// and the function's name is its durable identity. The return value is the
// agent's system prompt.
export function Hello() {
	useModel('deepseek/deepseek-v4-flash');
	return 'You are a helpful assistant. Keep replies short.';
}
