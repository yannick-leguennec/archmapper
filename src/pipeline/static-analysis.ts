import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dree from 'dree'

// --- Types ---

export interface TreeNode {
  name: string
  relativePath: string
  type: 'file' | 'directory'
  extension?: string
  sizeInBytes?: number
  children?: TreeNode[]
}

export interface DependencyEdge {
  source: string
  resolved: string
}

export interface DependencyGraph {
  modules: Array<{
    source: string
    dependencies: Array<{ resolved: string }>
  }>
}

export interface BuildOptions {
  exclude?: string[]
  force?: boolean
}

// --- Binary extensions to exclude (non-analyzable files) ---

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.wasm', '.map',
  '.lock',
])

// --- Artifact persistence ---

export function saveArtifact(outputDir: string, filename: string, data: unknown): void {
  fs.mkdirSync(outputDir, { recursive: true })
  const filePath = path.join(outputDir, filename)
  const tmpPath = path.join(outputDir, `${filename}.tmp`)
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

export function loadArtifact<T>(outputDir: string, filename: string): T | null {
  const filePath = path.join(outputDir, filename)
  if (!fs.existsSync(filePath)) {
    return null
  }
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

// --- File tree ---

export function buildFileTree(scanRoot: string, options?: BuildOptions): TreeNode {
  const excludePatterns = (options?.exclude ?? ['node_modules', 'dist', 'build', '.git'])
    .map((pattern) => new RegExp(`(^|[\\\\/])${escapeRegex(pattern)}($|[\\\\/])`))

  const result = dree.scan(scanRoot, {
    exclude: excludePatterns,
    hash: false,
    symbolicLinks: false,
  })

  if (!result) {
    throw new Error(`Failed to scan directory: ${scanRoot}. Verify SCAN_ROOT exists and is readable.`)
  }

  return toTreeNode(result, scanRoot)
}

// --- Dependency graph ---

export function buildDependencyGraph(scanRoot: string, options?: BuildOptions): DependencyGraph | null {
  try {
    // dependency-cruiser is optional — attempt dynamic import
    // If not installed or misconfigured, return null and continue without it
    const { execSync } = require('node:child_process') as typeof import('node:child_process')

    const output = execSync(
      `npx depcruise --output-type json "${scanRoot}"`,
      { encoding: 'utf-8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] }
    )

    return JSON.parse(output) as DependencyGraph
  } catch {
    // dependency-cruiser is not required — the pipeline continues without it
    return null
  }
}

// --- File path extraction ---

/**
 * Extracts all analyzable file paths from the tree.
 * Includes every file except known binary formats.
 * Files without an extension (e.g. LICENSE, Makefile) are included.
 */
export function extractFilePaths(tree: TreeNode): string[] {
  const paths: string[] = []
  walkFiles(tree, paths)
  return paths.sort()
}

function walkFiles(node: TreeNode, accumulator: string[]): void {
  if (node.type === 'file') {
    const ext = node.extension ? `.${node.extension}` : ''
    if (!BINARY_EXTENSIONS.has(ext)) {
      accumulator.push(node.relativePath)
    }
    return
  }

  if (node.children) {
    for (const child of node.children) {
      walkFiles(child, accumulator)
    }
  }
}

// --- Leaf folder extraction (for bottom-up wave computation) ---

export function getLeafFolders(tree: TreeNode): string[] {
  const leaves: string[] = []
  walkLeafFolders(tree, leaves)
  return leaves
}

function walkLeafFolders(node: TreeNode, accumulator: string[]): void {
  if (node.type !== 'directory') return

  const childDirs = (node.children ?? []).filter((c) => c.type === 'directory')

  if (childDirs.length === 0) {
    // This directory has no subdirectories — it's a leaf
    accumulator.push(node.relativePath)
  } else {
    for (const child of childDirs) {
      walkLeafFolders(child, accumulator)
    }
  }
}

// --- Helpers ---

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toTreeNode(dreeNode: dree.Dree, scanRoot: string): TreeNode {
  const relativePath = path.relative(scanRoot, dreeNode.path).replace(/\\/g, '/')

  const node: TreeNode = {
    name: dreeNode.name,
    relativePath: relativePath || '.',
    type: dreeNode.type === dree.Type.DIRECTORY ? 'directory' : 'file',
  }

  if (dreeNode.extension) {
    node.extension = dreeNode.extension
  }

  if (dreeNode.sizeInBytes !== undefined) {
    node.sizeInBytes = dreeNode.sizeInBytes
  }

  if (dreeNode.children) {
    node.children = dreeNode.children.map((child) => toTreeNode(child, scanRoot))
  }

  return node
}
