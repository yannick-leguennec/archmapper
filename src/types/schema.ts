import { z } from 'zod'

export const FileAnalysisSchema = z.object({
  path: z.string().min(1),
  purpose: z.string().min(1),
  exports: z.array(z.string()),
  imports: z.array(z.string()),
  keyAbstractions: z.array(z.string()),
  patterns: z.array(z.string()),
  notes: z.string().optional(),
  tokensUsed: z.number().optional(),
})

export const ModuleAnalysisSchema = z.object({
  path: z.string().min(1),
  purpose: z.string().min(1),
  children: z.array(z.string()),
  publicApi: z.array(z.string()),
  patterns: z.array(z.string()),
  crossCuttingConcerns: z.array(z.string()),
  notes: z.string().optional(),
  tokensUsed: z.number().optional(),
})

export const ArchitectureSchema = z.object({
  schemaVersion: z.string(),
  projectName: z.string().min(1),
  fileModel: z.string().min(1),
  synthesisModel: z.string().min(1),
  generatedAt: z.string(),
  files: z.array(FileAnalysisSchema),
  modules: z.array(ModuleAnalysisSchema),
  summary: z.string().min(1),
  designPatterns: z.array(z.string()),
  notes: z.string().optional(),
})

export type FileAnalysis = z.infer<typeof FileAnalysisSchema>
export type ModuleAnalysis = z.infer<typeof ModuleAnalysisSchema>
export type Architecture = z.infer<typeof ArchitectureSchema>
