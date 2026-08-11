/**
 * Single gateway to the Anthropic API.
 * No other module in the project instantiates Anthropic or calls the API directly.
 *
 * Responsibilities:
 * - Create the SDK client (once at startup)
 * - Send file analysis requests (Sonnet, cached prompt, structured output)
 * - Send module synthesis requests (Opus, cached prompt, structured output)
 * - Build batch request items (for batch-client.ts to submit)
 * - Extract and compute token usage + cost from every response
 *
 * Does NOT: validate with Zod, track progress, build prompts, or manage retries.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { FileAnalysisSchema, ModuleAnalysisSchema } from './types/schema'

import type { ZodType } from 'zod'

// --- Types ---

export type AnalysisKind = 'file' | 'module'

export interface UsageInfo {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
}

export interface LlmResult {
  json: unknown
  usage: UsageInfo
}

export interface AnalyzeFileParams {
  model: string
  systemPrompt: string
  filePath: string
  fileContent: string
  depEdges: string
  maxTokens: number
}

export interface SynthesizeModuleParams {
  model: string
  systemPrompt: string
  folderPath: string
  childSummaries: string
  maxTokens: number
}

export interface BatchRequestItem {
  custom_id: string
  params: {
    model: string
    max_tokens: number
    // Declared because the batch path sends it: forced tool_choice is invalid
    // with thinking on, and Sonnet 5 / Opus 5 default it on. Leaving it out of
    // this type made the field invisible to callers and to the test that
    // guards it.
    thinking: { type: 'disabled' }
    system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
    tools: Anthropic.Messages.Tool[]
    tool_choice: { type: 'tool'; name: string }
    messages: Array<{ role: 'user'; content: string }>
  }
}

// --- Pricing per 1M tokens ---

// Pricing per 1M tokens, in USD. Source: quorum-docs-mirror/anthropic/en/build-with-claude/prompt-caching.md
// (canonical Anthropic rates). Cache rates follow Anthropic's documented ratios:
//   cacheRead  = 0.10 * input rate (90% off)
//   cacheWrite = 1.25 * input rate (5-minute ephemeral cache)
// If a user points ArchMapper at a model not listed here, the cost summary
// falls back to DEFAULT_PRICING (Sonnet 5 introductory rates) and the run still works.
//
// Sonnet 5 introductory pricing applies through 2026-08-31; from 2026-09-01 it
// rises to $3/$15 (same as Sonnet 4.6) — update this table before that date.
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  // Current defaults (2026-08)
  'claude-opus-5':               { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-sonnet-5':             { input: 2,    output: 10,   cacheRead: 0.2,   cacheWrite: 2.5 },

  // Still current / selectable
  'claude-opus-4-8':             { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-7':             { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-sonnet-4-6':           { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-haiku-4-5':            { input: 1,    output: 5,    cacheRead: 0.1,   cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001':   { input: 1,    output: 5,    cacheRead: 0.1,   cacheWrite: 1.25 },

  // Legacy models (still available; update or remove as Anthropic deprecates)
  'claude-opus-4-6':             { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-5-20251101':    { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-1-20250805':    { input: 15,   output: 75,   cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-opus-4-20250918':      { input: 5,    output: 25,   cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-20250514':      { input: 15,   output: 75,   cacheRead: 1.5,   cacheWrite: 18.75 },
  'claude-sonnet-4-5-20250929':  { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-sonnet-4-20250514':    { input: 3,    output: 15,   cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-3-haiku-20240307':     { input: 0.25, output: 1.25, cacheRead: 0.025, cacheWrite: 0.3125 },
}

const DEFAULT_PRICING = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }

// --- Client creation ---

export function createLlmClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

// --- JSON Schema for structured output ---

const schemaCache = new Map<AnalysisKind, Record<string, unknown>>()

// Constraints strict tool use does not accept. zodToJsonSchema emits minLength
// for z.string().min(1); leaving it in makes the API reject the tool definition.
// Validation still happens our side — the Zod schema is unchanged.
const UNSUPPORTED_STRICT_KEYWORDS = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'pattern',
  'format',
] as const

function stripUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedKeywords)
  if (node === null || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((UNSUPPORTED_STRICT_KEYWORDS as readonly string[]).includes(key)) continue
    out[key] = stripUnsupportedKeywords(value)
  }
  return out
}

export function getJsonSchema(kind: AnalysisKind): Record<string, unknown> {
  const cached = schemaCache.get(kind)
  if (cached) return cached

  const zodSchema: ZodType = kind === 'file' ? FileAnalysisSchema : ModuleAnalysisSchema
  const jsonSchema = zodToJsonSchema(zodSchema)

  // Remove $schema and top-level metadata — Anthropic tool input_schema needs a clean object
  const { $schema, ...rest } = jsonSchema as Record<string, unknown>
  void $schema

  const clean = stripUnsupportedKeywords(rest) as Record<string, unknown>

  schemaCache.set(kind, clean)
  return clean
}

// --- Tool definitions for structured output ---

function buildTool(kind: AnalysisKind): Anthropic.Messages.Tool {
  const name = kind === 'file' ? 'record_file_analysis' : 'record_module_analysis'
  const description = kind === 'file'
    ? 'Record the structured analysis of a source file.'
    : 'Record the structured analysis of a module/folder.'

  const schema = getJsonSchema(kind)

  // strict: true makes the API guarantee tool input matches the schema, so an
  // array field can never come back as a comma-separated string. Without it,
  // ~60% of items failed Zod parsing on real runs (consilium 22/37,
  // ai-consensus 119/195), overwhelmingly "Expected array, received string".
  // Requires additionalProperties: false + required (both emitted by
  // zodToJsonSchema) and no unsupported keywords (stripped above).
  return {
    name,
    description,
    strict: true,
    input_schema: {
      type: 'object' as const,
      ...schema,
    },
  }
}

// --- Core API calls ---

export async function analyzeFile(client: Anthropic, params: AnalyzeFileParams): Promise<LlmResult> {
  const tool = buildTool('file')

  // Forced tool_choice is incompatible with extended/adaptive thinking
  // (quorum-docs-mirror/.../extended-thinking.md). Sonnet 5 and Opus 5 both
  // default adaptive thinking ON — must disable explicitly.
  //
  // Do not set output_config.effort above `high` on Opus 5: it accepts
  // thinking:disabled only at effort `high` or below (400 at xhigh/max).
  // We never set effort, so the API default of `high` applies and this is valid.
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    thinking: { type: 'disabled' },
    system: [
      {
        type: 'text' as const,
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: tool.name },
    messages: [
      {
        role: 'user' as const,
        content: buildFileUserMessage(params.filePath, params.fileContent, params.depEdges),
      },
    ],
  })

  return {
    json: extractToolInput(response),
    usage: trackUsage(params.model, response.usage),
  }
}

export async function synthesizeModule(client: Anthropic, params: SynthesizeModuleParams): Promise<LlmResult> {
  const tool = buildTool('module')

  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    thinking: { type: 'disabled' },
    system: [
      {
        type: 'text' as const,
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: tool.name },
    messages: [
      {
        role: 'user' as const,
        content: buildModuleUserMessage(params.folderPath, params.childSummaries),
      },
    ],
  })

  return {
    json: extractToolInput(response),
    usage: trackUsage(params.model, response.usage),
  }
}

// --- Batch request building ---

export function buildBatchRequests(
  kind: AnalysisKind,
  items: Array<{ id: string; userMessage: string }>,
  model: string,
  systemPrompt: string,
  maxTokens: number,
): BatchRequestItem[] {
  const tool = buildTool(kind)

  return items.map((item) => ({
    custom_id: item.id,
    params: {
      model,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' as const },
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      tools: [tool],
      tool_choice: { type: 'tool' as const, name: tool.name },
      messages: [
        { role: 'user' as const, content: item.userMessage },
      ],
    },
  }))
}

// --- Usage tracking + cost computation ---

/**
 * The token fields cost depends on. Deliberately narrower than
 * `Anthropic.Usage`: the SDK's Usage type gains fields over time
 * (cache_creation, inference_geo, service_tier, …) and none of them affect
 * cost. Accepting only what we read keeps call sites and test fixtures stable
 * across SDK upgrades. A full `Anthropic.Usage` still satisfies this.
 */
export type UsageTokens = Pick<
  Anthropic.Usage,
  'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'
>

export function trackUsage(model: string, usage: UsageTokens): UsageInfo {
  const pricing = PRICING[model] ?? DEFAULT_PRICING

  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0

  // Cost calculation:
  // - Regular input tokens (excluding cached): standard input price
  // - Cache read tokens: ~90% cheaper (cache_read price)
  // - Cache creation tokens: ~25% more expensive (cache_write price)
  // - Output tokens: standard output price
  const regularInputTokens = inputTokens - cacheReadInputTokens - cacheCreationInputTokens
  const costUsd =
    (Math.max(0, regularInputTokens) / 1_000_000) * pricing.input +
    (cacheReadInputTokens / 1_000_000) * pricing.cacheRead +
    (cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite +
    (outputTokens / 1_000_000) * pricing.output

  return {
    model,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000, // round to 6 decimal places
  }
}

// --- Helpers ---

function extractToolInput(response: Anthropic.Message): unknown {
  const toolBlock = response.content.find((block) => block.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error(
      `LLM response did not contain a tool_use block. ` +
      `stop_reason: ${response.stop_reason}. ` +
      `This may indicate the model ignored the tool_choice constraint.`
    )
  }
  return toolBlock.input
}

function buildFileUserMessage(filePath: string, fileContent: string, depEdges: string): string {
  let message = `Analyze the following source file.\n\nFile path: ${filePath}\n\n`

  if (depEdges) {
    message += `Dependencies (from static analysis):\n${depEdges}\n\n`
  }

  message += `<source_file path="${filePath}">\n${fileContent}\n</source_file>`

  return message
}

function buildModuleUserMessage(folderPath: string, childSummaries: string): string {
  return (
    `Synthesize the following folder into a module analysis.\n\n` +
    `Folder path: ${folderPath}\n\n` +
    `Child analyses:\n${childSummaries}`
  )
}
