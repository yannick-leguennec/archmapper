type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
}

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  source: string
  [key: string]: unknown
}

interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warning(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  critical(message: string, fields?: Record<string, unknown>): void
  child(context: Record<string, unknown>): Logger
}

function resolveMinLevel(nodeEnv: string, logLevelOverride: string | undefined): LogLevel {
  if (logLevelOverride && logLevelOverride in LEVEL_ORDER) {
    return logLevelOverride as LogLevel
  }
  return nodeEnv === 'production' ? 'INFO' : 'DEBUG'
}

function shouldEmit(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[entryLevel] >= LEVEL_ORDER[minLevel]
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry)
  if (LEVEL_ORDER[entry.level] >= LEVEL_ORDER['ERROR']) {
    process.stderr.write(output + '\n')
  } else {
    process.stdout.write(output + '\n')
  }
}

function createLogger(
  source: string,
  minLevel: LogLevel,
  extraContext: Record<string, unknown> = {},
): Logger {
  function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (!shouldEmit(level, minLevel)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      source,
      ...extraContext,
      ...fields,
    }
    emit(entry)
  }

  return {
    debug: (message, fields) => log('DEBUG', message, fields),
    info: (message, fields) => log('INFO', message, fields),
    warning: (message, fields) => log('WARNING', message, fields),
    error: (message, fields) => log('ERROR', message, fields),
    critical: (message, fields) => log('CRITICAL', message, fields),
    child: (context) => createLogger(source, minLevel, { ...extraContext, ...context }),
  }
}

export function createRootLogger(nodeEnv: string, logLevelOverride: string | undefined): Logger {
  const minLevel = resolveMinLevel(nodeEnv, logLevelOverride)
  return createLogger('root', minLevel)
}

export type { Logger, LogLevel, LogEntry }
