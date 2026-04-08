/**
 * @file tool-schemas.ts
 * @description Static tool definitions for the Open Connections MCP surface.
 */

export function toolDefinitions() {
  return [
    {
      name: 'query',
      description: 'Run semantic note search against the current vault and return note-level matches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language search query.' },
          limit: { type: 'number', description: 'Maximum results to return (1-50).', minimum: 1, maximum: 50 },
          scope: { type: 'string', enum: ['all', 'blocks'], description: 'Return note-level matches or raw block hits.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'connections',
      description: 'Return semantically related notes for a note path already in the vault.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Vault-relative markdown file path.' },
          limit: { type: 'number', description: 'Maximum related notes to return (1-50).', minimum: 1, maximum: 50 },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'get',
      description: 'Read the full markdown contents of a note by its vault-relative path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Vault-relative markdown file path.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'multi_get',
      description: 'Read multiple notes by vault-relative path in one call.',
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 20,
            description: 'Vault-relative markdown file paths.',
          },
        },
        required: ['paths'],
        additionalProperties: false,
      },
    },
    {
      name: 'status',
      description: 'Report MCP endpoint status, model info, and collection counts.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}
