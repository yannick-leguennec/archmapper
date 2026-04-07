/**
 * Pure config loading logic — no side effects, no dotenv, fully injectable.
 * Tests import from this file directly.
 * The eager singleton in config.ts imports from here.
 */

export function validateProjectName(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `Invalid PROJECT_NAME "${name}": must contain only letters, numbers, and underscores (A-Z, a-z, 0-9, _). ` +
      `No spaces, hyphens, or special characters.`
    )
  }
  return name
}

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  function requireEnv(name: string, description: string): string {
    const value = env[name]
    if (!value) {
      throw new Error(
        `Missing required environment variable: ${name}\n` +
        `  What it controls: ${description}\n` +
        `  See .env.example for setup instructions.`
      )
    }
    return value
  }

  function optionalEnv(name: string, defaultValue: string): string {
    return env[name] ?? defaultValue
  }

  return {
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY', 'Anthropic API key for LLM calls'),
    projectName: validateProjectName(
      requireEnv('PROJECT_NAME', 'Alphanumeric name for this analysis run')
    ),
    fileModel: optionalEnv('FILE_MODEL', 'claude-sonnet-4-6'),
    synthesisModel: optionalEnv('SYNTHESIS_MODEL', 'claude-opus-4-6'),
    scanRoot: optionalEnv('SCAN_ROOT', 'project'),
    useBatches: optionalEnv('USE_BATCHES', 'false') === 'true',
    excludePatterns: optionalEnv('EXCLUDE_PATTERNS', 'node_modules,dist,build,.git').split(','),
    maxTokens: parseInt(optionalEnv('MAX_TOKENS', '4096'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    logLevel: env['LOG_LEVEL'],
  } as const
}
