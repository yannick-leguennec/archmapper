/**
 * The eager config singleton. Imports dotenv to load .env, then creates the config.
 * All production code imports from this file.
 *
 * Pure logic lives in config.loader.ts (tested independently without dotenv side effects).
 */
import 'dotenv/config'
import { loadConfig } from './config.loader'

export { validateProjectName, loadConfig } from './config.loader'
export const config = loadConfig()
