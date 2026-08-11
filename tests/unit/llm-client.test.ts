import { describe, it, expect, vi } from 'vitest'
import {
  createLlmClient,
  analyzeFile,
  synthesizeModule,
  buildBatchRequests,
  getJsonSchema,
  trackUsage,
} from '../../src/llm-client'

import type Anthropic from '@anthropic-ai/sdk'
import type { AnalyzeFileParams, SynthesizeModuleParams, UsageTokens } from '../../src/llm-client'

// --- Mock helpers ---

function createMockResponse(toolInput: unknown, usage?: Partial<Anthropic.Usage>): Anthropic.Message {
  return {
    id: 'msg_test_123',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test_123',
        name: 'record_file_analysis',
        input: toolInput,
      },
    ],
    usage: {
      input_tokens: usage?.input_tokens ?? 1000,
      output_tokens: usage?.output_tokens ?? 500,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
    },
  } as Anthropic.Message
}

function createMockClient(response: Anthropic.Message): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  } as unknown as Anthropic
}

const DEFAULT_FILE_PARAMS: AnalyzeFileParams = {
  model: 'claude-sonnet-4-6',
  systemPrompt: 'You are an expert software architect.',
  filePath: 'src/config.ts',
  fileContent: 'export const port = 3000',
  depEdges: '',
  maxTokens: 4096,
}

const DEFAULT_MODULE_PARAMS: SynthesizeModuleParams = {
  model: 'claude-opus-4-6',
  systemPrompt: 'You are an expert software architect.',
  folderPath: 'src/pipeline',
  childSummaries: '- file-phase.ts: Handles file analysis\n- progress.ts: Checkpointing',
  maxTokens: 4096,
}

// --- createLlmClient ---

describe('createLlmClient', () => {
  it('returns an Anthropic client with messages.create method', () => {
    const client = createLlmClient('sk-ant-test-key')

    expect(client).toBeDefined()
    expect(typeof client.messages.create).toBe('function')
  })

  it('returns a client with messages.countTokens method', () => {
    const client = createLlmClient('sk-ant-test-key')

    expect(typeof client.messages.countTokens).toBe('function')
  })
})

// --- getJsonSchema ---

describe('getJsonSchema', () => {
  it('returns a JSON schema for file analysis', () => {
    const schema = getJsonSchema('file')

    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    const props = schema.properties as Record<string, unknown>
    expect(props['path']).toBeDefined()
    expect(props['purpose']).toBeDefined()
    expect(props['exports']).toBeDefined()
    expect(props['imports']).toBeDefined()
    expect(props['keyAbstractions']).toBeDefined()
    expect(props['patterns']).toBeDefined()
  })

  it('returns a JSON schema for module analysis', () => {
    const schema = getJsonSchema('module')

    expect(schema.type).toBe('object')
    const props = schema.properties as Record<string, unknown>
    expect(props['path']).toBeDefined()
    expect(props['purpose']).toBeDefined()
    expect(props['publicApi']).toBeDefined()
    expect(props['crossCuttingConcerns']).toBeDefined()
    expect(props['children']).toBeDefined()
  })

  it('returns the same object on repeated calls (cached)', () => {
    const schema1 = getJsonSchema('file')
    const schema2 = getJsonSchema('file')

    expect(schema1).toBe(schema2) // same reference
  })

  // Strict tool use requires additionalProperties: false on every object.
  // Without it the API cannot enforce the schema, and the model is free to
  // return "a, b" where an array is declared — the ZodParseError that killed
  // ~60% of items on both the consilium and ai-consensus runs.
  it.each(['file', 'module'] as const)(
    'sets additionalProperties false on the %s schema so strict tool use is valid',
    (kind) => {
      const schema = getJsonSchema(kind)

      expect(schema['additionalProperties']).toBe(false)
    }
  )

  // Strict tool use rejects string/numeric constraints. zodToJsonSchema emits
  // minLength for z.string().min(1), so it must be stripped before the call.
  it.each(['file', 'module'] as const)(
    'strips constraints strict tool use does not support from the %s schema',
    (kind) => {
      const schema = getJsonSchema(kind)
      const props = schema['properties'] as Record<string, Record<string, unknown>>

      expect(props['path']!['minLength']).toBeUndefined()
      expect(props['purpose']!['minLength']).toBeUndefined()
    }
  )

  it.each(['file', 'module'] as const)(
    'keeps required and array item types intact on the %s schema',
    (kind) => {
      const schema = getJsonSchema(kind)
      const props = schema['properties'] as Record<string, Record<string, unknown>>

      expect(schema['required']).toContain('path')
      expect(props['patterns']!['type']).toBe('array')
      expect(props['patterns']!['items']).toEqual({ type: 'string' })
    }
  )
})

// --- analyzeFile ---

describe('analyzeFile', () => {
  it('uses the file model (Sonnet) in the API call', async () => {
    const toolInput = { path: 'src/config.ts', purpose: 'Config loader', exports: [], imports: [], keyAbstractions: [], patterns: [] }
    const response = createMockResponse(toolInput)
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const createCall = vi.mocked(client.messages.create)
    expect(createCall).toHaveBeenCalledOnce()
    const args = createCall.mock.calls[0]![0]
    expect(args.model).toBe('claude-sonnet-4-6')
  })

  it('sets max_tokens on every call', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, { ...DEFAULT_FILE_PARAMS, maxTokens: 8192 })

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    expect(args.max_tokens).toBe(8192)
  })

  it('marks the system prompt with cache_control for prompt caching', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const systemBlocks = args.system as Array<{ cache_control?: { type: string } }>
    expect(systemBlocks[0]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('uses tool_choice to force structured output', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'record_file_analysis' })
  })

  it('marks the tool strict so the API guarantees schema-valid input', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const tools = args.tools as Array<{ strict?: boolean }>
    expect(tools[0]!.strict).toBe(true)
  })

  it('disables thinking so forced tool_choice stays valid (Sonnet 5 default)', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0] as { thinking?: { type: string } }
    expect(args.thinking).toEqual({ type: 'disabled' })
  })

  it('returns the tool input as json', async () => {
    const toolInput = { path: 'src/config.ts', purpose: 'Loads env vars', exports: ['config'], imports: [], keyAbstractions: [], patterns: ['config-module'] }
    const response = createMockResponse(toolInput)
    const client = createMockClient(response)

    const result = await analyzeFile(client, DEFAULT_FILE_PARAMS)

    expect(result.json).toEqual(toolInput)
  })

  it('returns usage info with token counts', async () => {
    const response = createMockResponse({ path: 'test' }, {
      input_tokens: 2000,
      output_tokens: 800,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 0,
    })
    const client = createMockClient(response)

    const result = await analyzeFile(client, DEFAULT_FILE_PARAMS)

    expect(result.usage.inputTokens).toBe(2000)
    expect(result.usage.outputTokens).toBe(800)
    expect(result.usage.cacheReadInputTokens).toBe(1500)
    expect(result.usage.model).toBe('claude-sonnet-4-6')
  })

  it('wraps file content in source_file tags in the user message', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, DEFAULT_FILE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const userMessage = (args.messages[0] as { content: string }).content
    expect(userMessage).toContain('<source_file path="src/config.ts">')
    expect(userMessage).toContain('export const port = 3000')
    expect(userMessage).toContain('</source_file>')
  })

  it('includes dependency edges when provided', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await analyzeFile(client, {
      ...DEFAULT_FILE_PARAMS,
      depEdges: './config → ./logger\n./config → dotenv',
    })

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const userMessage = (args.messages[0] as { content: string }).content
    expect(userMessage).toContain('./config → ./logger')
  })

  it('throws when the API call fails', async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API rate limited')),
      },
    } as unknown as Anthropic

    await expect(analyzeFile(client, DEFAULT_FILE_PARAMS)).rejects.toThrow('API rate limited')
  })

  it('throws when response has no tool_use block', async () => {
    const badResponse = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I cannot use the tool.' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message
    const client = createMockClient(badResponse)

    await expect(analyzeFile(client, DEFAULT_FILE_PARAMS)).rejects.toThrow('tool_use block')
  })
})

// --- synthesizeModule ---

describe('synthesizeModule', () => {
  it('uses the synthesis model (Opus) in the API call', async () => {
    const toolInput = { path: 'src/pipeline', purpose: 'Pipeline logic', children: [], publicApi: [], patterns: [], crossCuttingConcerns: [] }
    const response = createMockResponse(toolInput)
    const client = createMockClient(response)

    await synthesizeModule(client, DEFAULT_MODULE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    expect(args.model).toBe('claude-opus-4-6')
  })

  it('marks the module tool strict so the API guarantees schema-valid input', async () => {
    const response = createMockResponse({ path: 'src', purpose: 'p', children: [], publicApi: [], patterns: [], crossCuttingConcerns: [] })
    const client = createMockClient(response)

    await synthesizeModule(client, DEFAULT_MODULE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const tools = args.tools as Array<{ strict?: boolean }>
    expect(tools[0]!.strict).toBe(true)
  })

  it('uses tool_choice for module structured output', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await synthesizeModule(client, DEFAULT_MODULE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'record_module_analysis' })
  })

  it('includes child summaries in the user message', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await synthesizeModule(client, DEFAULT_MODULE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const userMessage = (args.messages[0] as { content: string }).content
    expect(userMessage).toContain('file-phase.ts: Handles file analysis')
    expect(userMessage).toContain('progress.ts: Checkpointing')
  })

  it('marks the system prompt as cacheable', async () => {
    const response = createMockResponse({ path: 'test' })
    const client = createMockClient(response)

    await synthesizeModule(client, DEFAULT_MODULE_PARAMS)

    const args = vi.mocked(client.messages.create).mock.calls[0]![0]
    const systemBlocks = args.system as Array<{ cache_control?: { type: string } }>
    expect(systemBlocks[0]!.cache_control).toEqual({ type: 'ephemeral' })
  })
})

// --- buildBatchRequests ---

describe('buildBatchRequests', () => {
  it('sets custom_id to the item id (file path)', () => {
    const items = [
      { id: 'src/a.ts', userMessage: 'Analyze src/a.ts' },
      { id: 'src/b.ts', userMessage: 'Analyze src/b.ts' },
    ]

    const requests = buildBatchRequests('file', items, 'claude-sonnet-4-6', 'System prompt', 4096)

    expect(requests).toHaveLength(2)
    expect(requests[0]!.custom_id).toBe('src/a.ts')
    expect(requests[1]!.custom_id).toBe('src/b.ts')
    expect(requests[0]!.params.thinking).toEqual({ type: 'disabled' })
  })

  it('includes max_tokens in every request', () => {
    const items = [{ id: 'src/a.ts', userMessage: 'Analyze' }]

    const requests = buildBatchRequests('file', items, 'claude-sonnet-4-6', 'System', 8192)

    expect(requests[0]!.params.max_tokens).toBe(8192)
  })

  it('includes the cached system prompt in every request', () => {
    const items = [{ id: 'src/a.ts', userMessage: 'Analyze' }]

    const requests = buildBatchRequests('file', items, 'claude-sonnet-4-6', 'My system prompt', 4096)

    expect(requests[0]!.params.system[0]!.text).toBe('My system prompt')
    expect(requests[0]!.params.system[0]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('uses the correct tool for each kind', () => {
    const fileRequests = buildBatchRequests('file', [{ id: 'a', userMessage: 'x' }], 'claude-sonnet-4-6', '', 4096)
    const moduleRequests = buildBatchRequests('module', [{ id: 'b', userMessage: 'y' }], 'claude-opus-4-6', '', 4096)

    expect(fileRequests[0]!.params.tools[0]!.name).toBe('record_file_analysis')
    expect(moduleRequests[0]!.params.tools[0]!.name).toBe('record_module_analysis')
  })
})

// --- trackUsage ---

describe('trackUsage', () => {
  it('computes cost correctly for Sonnet (no cache)', () => {
    const usage: UsageTokens = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }

    const result = trackUsage('claude-sonnet-4-6', usage)

    // Sonnet: $3 input + $15 output = $18
    expect(result.costUsd).toBeCloseTo(18, 2)
  })

  it('computes cost correctly for Opus (no cache)', () => {
    const usage: UsageTokens = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }

    const result = trackUsage('claude-opus-4-6', usage)

    // Opus: $5 input + $25 output = $30
    expect(result.costUsd).toBeCloseTo(30, 2)
  })

  it('applies cache read discount (90% cheaper)', () => {
    const usage: UsageTokens = {
      input_tokens: 10_000,   // total input including cache reads
      output_tokens: 5_000,
      cache_read_input_tokens: 8_000,   // 8k of the 10k were cached
      cache_creation_input_tokens: 0,
    }

    const result = trackUsage('claude-sonnet-4-6', usage)

    // Regular input: (10000 - 8000) / 1M * $3 = $0.006
    // Cache read: 8000 / 1M * $0.30 = $0.0024
    // Output: 5000 / 1M * $15 = $0.075
    // Total: ~$0.0834
    expect(result.costUsd).toBeCloseTo(0.0834, 3)
    expect(result.cacheReadInputTokens).toBe(8_000)
  })

  it('applies cache creation surcharge (25% more expensive)', () => {
    const usage: UsageTokens = {
      input_tokens: 10_000,
      output_tokens: 5_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 4_000,  // 4k tokens written to cache
    }

    const result = trackUsage('claude-sonnet-4-6', usage)

    // Regular input: (10000 - 4000) / 1M * $3 = $0.018
    // Cache creation: 4000 / 1M * $3.75 = $0.015
    // Output: 5000 / 1M * $15 = $0.075
    // Total: ~$0.108
    expect(result.costUsd).toBeCloseTo(0.108, 3)
    expect(result.cacheCreationInputTokens).toBe(4_000)
  })

  it('falls back to default pricing for unknown models', () => {
    const usage: UsageTokens = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }

    const result = trackUsage('claude-unknown-model', usage)

    // Default (Sonnet 5 intro): $2 input + $10 output = $12
    expect(result.costUsd).toBeCloseTo(12, 2)
  })

  it('returns all token counts in the usage info', () => {
    const usage: UsageTokens = {
      input_tokens: 2000,
      output_tokens: 800,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 300,
    }

    const result = trackUsage('claude-sonnet-4-6', usage)

    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.inputTokens).toBe(2000)
    expect(result.outputTokens).toBe(800)
    expect(result.cacheReadInputTokens).toBe(1500)
    expect(result.cacheCreationInputTokens).toBe(300)
  })

  it('handles null cache token values from API', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    } as Anthropic.Usage

    const result = trackUsage('claude-sonnet-4-6', usage)

    expect(result.cacheReadInputTokens).toBe(0)
    expect(result.cacheCreationInputTokens).toBe(0)
    expect(result.costUsd).toBeGreaterThan(0)
  })
})
