/**
 * Store adapter for CLI
 * Provides a thin wrapper over the SDK Store interface
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { openStore, type QuerySpec, type Document } from "@jsonstore/sdk";

/**
 * CLI Store interface
 * Matches SDK Store but simplified for CLI use cases
 */
export interface CliStore {
  /**
   * Initialize store directory structure
   */
  init(): Promise<void>;

  /**
   * Store or update a document
   */
  put(
    ref: { type: string; id: string },
    doc: unknown,
    opts?: { gitCommit?: string }
  ): Promise<void>;

  /**
   * Retrieve a document by key
   */
  get(ref: { type: string; id: string }): Promise<unknown | null>;

  /**
   * Remove a document
   */
  remove(ref: { type: string; id: string }, opts?: { gitCommit?: string }): Promise<void>;

  /**
   * List all document IDs for a type
   */
  list(type: string): Promise<string[]>;

  /**
   * Query documents using Mango query language
   */
  query(spec: QuerySpec): Promise<unknown[]>;

  /**
   * Format documents to canonical representation
   */
  format(scope: { all?: boolean; type?: string; id?: string }): Promise<void>;

  /**
   * Get statistics for the store or a type
   */
  stats(type?: string): Promise<{ count: number; bytes: number }>;
}

/**
 * Open a CLI store backed by the SDK
 */
export function openCliStore(root: string): CliStore {
  const store = openStore({ root });

  return {
    async init(): Promise<void> {
      // Create root directory if it doesn't exist
      await fs.mkdir(root, { recursive: true });
      // Create _meta directory
      const metaDir = path.join(root, "_meta");
      await fs.mkdir(metaDir, { recursive: true });
    },

    async put(ref, doc, opts): Promise<void> {
      if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
        throw new Error("Document payload must be a JSON object");
      }

      const payload = doc as Record<string, unknown>;

      const typeValue = (payload as { type?: unknown }).type;
      if (typeValue !== undefined && typeValue !== ref.type) {
        throw new Error(
          `Document type "${String(typeValue)}" does not match CLI argument "${ref.type}"`
        );
      }

      const idValue = (payload as { id?: unknown }).id;
      if (idValue !== undefined && idValue !== ref.id) {
        throw new Error(`Document id "${String(idValue)}" does not match CLI argument "${ref.id}"`);
      }

      const normalized = {
        ...payload,
        type: ref.type,
        id: ref.id,
      } as Document;

      return store.put(ref, normalized, opts);
    },

    async get(ref): Promise<unknown | null> {
      return store.get(ref);
    },

    async remove(ref, opts): Promise<void> {
      return store.remove(ref, opts);
    },

    async list(type): Promise<string[]> {
      return store.list(type);
    },

    async query(spec): Promise<unknown[]> {
      return store.query(spec);
    },

    async format(scope): Promise<void> {
      if (scope.all) {
        return store.format({ all: true });
      }
      if (scope.type && scope.id) {
        return store.format({ type: scope.type, id: scope.id });
      }
      if (scope.type) {
        return store.format({ type: scope.type });
      }
      if (scope.id) {
        throw new Error("Format requires a type when specifying an id");
      }

      throw new Error("Format scope must specify --all or a type");
    },

    async stats(type): Promise<{ count: number; bytes: number }> {
      return store.stats(type);
    },
  };
}
