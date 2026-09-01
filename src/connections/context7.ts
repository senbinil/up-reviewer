import { defineMcpConnection } from '@flue/runtime';

/**
 * Context7 MCP connection — fetches up-to-date library documentation on demand.
 * Only usable when `CONTEXT7_API_KEY` is set in the environment.
 *
 * Usage in an agent:
 * ```ts
 * if (process.env.CONTEXT7_API_KEY) {
 *   useMcpConnection(context7);
 * }
 * ```
 */
export const context7 = defineMcpConnection({
  name: 'context7',
  url: process.env.CONTEXT7_URL ?? 'https://mcp.context7.com/mcp',
  auth: () => process.env.CONTEXT7_API_KEY || '',
  optional: true,
  tools: ['resolve_library_id', 'query_documentation'],
});
