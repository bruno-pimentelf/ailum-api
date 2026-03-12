import type { LLMToolDefinition } from './llm.types.js'

/** Converts tool def (TypeBox schema) to LLMToolDefinition (JSON Schema) */
export function toLLMTool(def: {
  name: string
  description: string
  input_schema: { type?: string; properties?: Record<string, unknown>; required?: string[] }
}): LLMToolDefinition {
  const schema = def.input_schema as { type?: string; properties?: Record<string, unknown>; required?: string[] }
  return {
    name: def.name,
    description: def.description,
    input_schema: {
      type: 'object',
      properties: schema.properties ?? {},
      required: schema.required,
    },
  }
}
