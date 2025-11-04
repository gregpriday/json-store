/**
 * Zod schemas for validating tool inputs and outputs
 * Provides runtime type safety and detailed validation errors
 */

import { z } from "zod";

// Secure patterns that prevent path traversal
const typePattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const idPattern = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

const TypeStringSchema = z.string().min(1).superRefine((val, ctx) => {
  if (!typePattern.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "type must start with alphanumeric and contain only lowercase letters, numbers, dots, underscores, and hyphens",
    });
  }
});

const IdStringSchema = z.string().min(1).superRefine((val, ctx) => {
  if (!idPattern.test(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "id must start with alphanumeric and contain only letters, numbers, dots, underscores, and hyphens",
    });
  }
});

// Key schema - type and id must be non-empty strings
export const KeySchema = z.object({
  type: TypeStringSchema,
  id: IdStringSchema,
});

// Document schema - any record with at least type and id fields
export const DocumentSchema = z.record(z.string(), z.any()).superRefine((doc, ctx) => {
  if (typeof doc.type !== "string" || !typePattern.test(doc.type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["type"],
      message: "Document must include 'type' field matching the key format",
    });
  }
  if (typeof doc.id !== "string" || !idPattern.test(doc.id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["id"],
      message: "Document must include 'id' field matching the key format",
    });
  }
});

// Commit options schema
export const CommitSchema = z
  .object({
    message: z.string().min(1, "commit message must be non-empty"),
    batch: z.string().optional(),
  })
  .optional();

// Projection schema - all values must be 0 or 1, and cannot mix both
export const ProjectionSchema = z.record(z.string(), z.union([z.literal(0), z.literal(1)])).superRefine((proj, ctx) => {
  const values = Object.values(proj);
  if (values.length === 0) return;
  const hasZero = values.includes(0);
  const hasOne = values.includes(1);
  if (hasZero && hasOne) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Projection cannot mix 0 and 1 values",
    });
  }
});

// Sort schema - all values must be 1 or -1
export const SortSchema = z.record(z.string(), z.union([z.literal(1), z.literal(-1)]));

// Filter schema - can be any object (Mango query operators)
export const FilterSchema = z.record(z.string(), z.any());

// Query spec schema with validation and defaults
export const QuerySpecSchema = z.object({
  type: TypeStringSchema.optional(),
  filter: FilterSchema,
  projection: ProjectionSchema.optional(),
  sort: SortSchema.optional(),
  limit: z
    .number()
    .int()
    .positive()
    .superRefine((val, ctx) => {
      if (val > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "limit cannot exceed 1000",
        });
      }
    })
    .default(100),
  skip: z
    .number()
    .int()
    .min(0)
    .superRefine((val, ctx) => {
      if (val > 10000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "skip cannot exceed 10000",
        });
      }
    })
    .default(0),
});

// Tool input schemas

export const GetDocInputSchema = z.object({
  type: TypeStringSchema,
  id: IdStringSchema,
});

export const PutDocInputSchema = z.object({
  type: TypeStringSchema,
  id: IdStringSchema,
  doc: DocumentSchema,
  commit: CommitSchema,
});

export const RemoveDocInputSchema = z.object({
  type: TypeStringSchema,
  id: IdStringSchema,
  commit: CommitSchema,
});

export const ListIdsInputSchema = z.object({
  type: TypeStringSchema,
});

export const QueryInputSchema = QuerySpecSchema;

export const EnsureIndexInputSchema = z.object({
  type: TypeStringSchema,
  field: z.string().min(1).superRefine((val, ctx) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "field must be a valid field name (letters, numbers, dots, underscores, hyphens)",
      });
    }
  }),
});

// Tool output schemas (for documentation)

export const GetDocOutputSchema = z.object({
  doc: DocumentSchema.nullable(),
});

export const PutDocOutputSchema = z.object({
  ok: z.boolean(),
});

export const RemoveDocOutputSchema = z.object({
  ok: z.boolean(),
});

export const ListIdsOutputSchema = z.object({
  ids: z.array(z.string()),
  count: z.number().int().min(0),
});

export const QueryOutputSchema = z.object({
  results: z.array(DocumentSchema),
  count: z.number().int().min(0),
});

export const EnsureIndexOutputSchema = z.object({
  ok: z.boolean(),
});

// Export types
export type Key = z.infer<typeof KeySchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type Projection = z.infer<typeof ProjectionSchema>;
export type Sort = z.infer<typeof SortSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type QuerySpec = z.infer<typeof QuerySpecSchema>;

export type GetDocInput = z.infer<typeof GetDocInputSchema>;
export type PutDocInput = z.infer<typeof PutDocInputSchema>;
export type RemoveDocInput = z.infer<typeof RemoveDocInputSchema>;
export type ListIdsInput = z.infer<typeof ListIdsInputSchema>;
export type QueryInput = z.infer<typeof QueryInputSchema>;
export type EnsureIndexInput = z.infer<typeof EnsureIndexInputSchema>;
