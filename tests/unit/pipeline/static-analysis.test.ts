import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  buildFileTree,
  extractFilePaths,
  getLeafFolders,
  saveArtifact,
  loadArtifact,
} from '../../../src/pipeline/static-analysis'

import type { TreeNode } from '../../../src/pipeline/static-analysis'

// --- Temp directory with a realistic mini codebase ---

let tempDir: string
let scanRoot: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-static-test-'))
  scanRoot = path.join(tempDir, 'project')

  // Build a mini codebase structure:
  // project/
  //   src/
  //     config.ts
  //     utils/
  //       helpers.ts
  //       format.ts
  //     api/
  //       router.ts
  //       handlers/
  //         users.ts
  //   package.json
  //   README.md
  //   LICENSE
  //   Makefile
  //   logo.png          (binary — should be excluded)
  //   data.zip           (binary — should be excluded)
  //   node_modules/
  //     some-pkg/
  //       index.js

  const files: Record<string, string> = {
    'src/config.ts': 'export const port = 3000',
    'src/utils/helpers.ts': 'export function help() {}',
    'src/utils/format.ts': 'export function fmt() {}',
    'src/api/router.ts': 'import { help } from "../utils/helpers"',
    'src/api/handlers/users.ts': 'export function getUsers() {}',
    'package.json': '{"name": "test"}',
    'README.md': '# Test',
    'LICENSE': 'MIT License',
    'Makefile': 'build:\n\techo hello',
    'logo.png': 'fake-binary-content',
    'data.zip': 'fake-binary-content',
    'node_modules/some-pkg/index.js': 'module.exports = {}',
  }

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(scanRoot, filePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')
  }
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// --- buildFileTree ---

describe('buildFileTree', () => {
  it('returns a tree rooted at the scan directory', () => {
    const tree = buildFileTree(scanRoot)

    expect(tree.type).toBe('directory')
    expect(tree.relativePath).toBe('.')
  })

  it('includes source files in the tree', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    expect(paths).toContain('src/config.ts')
    expect(paths).toContain('src/utils/helpers.ts')
    expect(paths).toContain('src/api/router.ts')
  })

  it('excludes node_modules by default', () => {
    const tree = buildFileTree(scanRoot)
    const allPaths = extractFilePaths(tree)

    const nodeModulePaths = allPaths.filter((p) => p.includes('node_modules'))
    expect(nodeModulePaths).toEqual([])
  })

  it('respects custom exclude patterns', () => {
    const tree = buildFileTree(scanRoot, { exclude: ['node_modules', 'utils'] })
    const paths = extractFilePaths(tree)

    expect(paths).not.toContain('src/utils/helpers.ts')
    expect(paths).not.toContain('src/utils/format.ts')
    expect(paths).toContain('src/config.ts')
  })

  it('throws on non-existent scan root', () => {
    expect(() => buildFileTree(path.join(tempDir, 'does-not-exist'))).toThrow()
  })

  it('includes file metadata (extension, size)', () => {
    const tree = buildFileTree(scanRoot)
    const configNode = findNode(tree, 'src/config.ts')

    expect(configNode).toBeDefined()
    expect(configNode!.extension).toBe('ts')
    expect(configNode!.sizeInBytes).toBeGreaterThan(0)
  })
})

// --- extractFilePaths ---

describe('extractFilePaths', () => {
  it('includes all text-based source files', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    expect(paths).toContain('src/config.ts')
    expect(paths).toContain('src/api/router.ts')
    expect(paths).toContain('package.json')
    expect(paths).toContain('README.md')
  })

  it('includes files without extensions (LICENSE, Makefile)', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    expect(paths).toContain('LICENSE')
    expect(paths).toContain('Makefile')
  })

  it('excludes binary files (.png, .zip, etc.)', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    expect(paths).not.toContain('logo.png')
    expect(paths).not.toContain('data.zip')
  })

  it('returns paths sorted alphabetically', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
  })

  it('uses forward slashes in paths (cross-platform)', () => {
    const tree = buildFileTree(scanRoot)
    const paths = extractFilePaths(tree)

    for (const p of paths) {
      expect(p).not.toContain('\\')
    }
  })

  it('returns an empty array for a directory with only binary files', () => {
    const binDir = path.join(tempDir, 'binaries-only')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, 'image.png'), 'fake', 'utf-8')
    fs.writeFileSync(path.join(binDir, 'archive.zip'), 'fake', 'utf-8')

    const tree = buildFileTree(binDir)
    const paths = extractFilePaths(tree)

    expect(paths).toEqual([])
  })
})

// --- getLeafFolders ---

describe('getLeafFolders', () => {
  it('returns folders with no subdirectories', () => {
    const tree = buildFileTree(scanRoot)
    const leaves = getLeafFolders(tree)

    // src/utils/ and src/api/handlers/ are leaves (no subdirs inside them)
    expect(leaves).toContain('src/utils')
    expect(leaves).toContain('src/api/handlers')
  })

  it('does not return folders that contain subdirectories', () => {
    const tree = buildFileTree(scanRoot)
    const leaves = getLeafFolders(tree)

    // src/ has subdirectories (utils/, api/), so it's not a leaf
    expect(leaves).not.toContain('src')
    // src/api/ has subdirectory (handlers/), so it's not a leaf
    expect(leaves).not.toContain('src/api')
  })

  it('returns the root as a leaf for a flat structure with no subdirectories', () => {
    const flatDir = path.join(tempDir, 'flatproject')
    fs.mkdirSync(flatDir, { recursive: true })
    fs.writeFileSync(path.join(flatDir, 'index.ts'), 'export {}', 'utf-8')

    const tree = buildFileTree(flatDir)
    const leaves = getLeafFolders(tree)

    expect(leaves).toEqual(['.'])
  })
})

// --- saveArtifact + loadArtifact ---

describe('saveArtifact and loadArtifact', () => {
  it('round-trips JSON data correctly', () => {
    const dir = path.join(tempDir, 'artifacts')
    const data = { name: 'test', items: [1, 2, 3] }

    saveArtifact(dir, 'test.json', data)
    const loaded = loadArtifact<typeof data>(dir, 'test.json')

    expect(loaded).toEqual(data)
  })

  it('returns null when file does not exist', () => {
    const dir = path.join(tempDir, 'empty-artifacts')
    fs.mkdirSync(dir, { recursive: true })

    const result = loadArtifact(dir, 'missing.json')

    expect(result).toBeNull()
  })

  it('creates the output directory if it does not exist', () => {
    const dir = path.join(tempDir, 'new', 'nested', 'dir')

    saveArtifact(dir, 'data.json', { created: true })

    expect(fs.existsSync(path.join(dir, 'data.json'))).toBe(true)
  })

  it('does not leave a .tmp file behind (atomic write)', () => {
    const dir = path.join(tempDir, 'atomic-artifact')

    saveArtifact(dir, 'clean.json', { atomic: true })

    const files = fs.readdirSync(dir)
    expect(files).toContain('clean.json')
    expect(files).not.toContain('clean.json.tmp')
  })

  it('overwrites existing artifact on re-save', () => {
    const dir = path.join(tempDir, 'overwrite')

    saveArtifact(dir, 'data.json', { version: 1 })
    saveArtifact(dir, 'data.json', { version: 2 })

    const loaded = loadArtifact<{ version: number }>(dir, 'data.json')
    expect(loaded!.version).toBe(2)
  })
})

// --- Helper to find a node by relative path ---

function findNode(tree: TreeNode, relativePath: string): TreeNode | undefined {
  if (tree.relativePath === relativePath) return tree
  if (!tree.children) return undefined
  for (const child of tree.children) {
    const found = findNode(child, relativePath)
    if (found) return found
  }
  return undefined
}
