/**
 * Main store implementation
 */

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import type { Stats } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import type {
  Store,
  StoreOptions,
  Key,
  Document,
  QuerySpec,
  WriteOptions,
  GetOptions,
  RemoveOptions,
  StoreStats,
  DetailedStats,
  FormatTarget,
  FormatOptions,
  CanonicalOptions,
  HierarchicalKey,
  Slug,
  MaterializedPath,
  Page,
  ListChildrenOptions,
  RepairReport,
  SchemaRegistry,
  SchemaValidator,
  SchemaRef,
  RebuildIndexesOptions,
  ReindexOptions,
  ReindexSummary,
  ReindexAllSummary,
} from "./types.js";
import { DocumentCache } from "./cache.js";
import {
  validateDocument,
  validateName,
  validateKey,
  validateTypeName,
  validateWithSchema,
} from "./validation.js";
import {
  listFiles,
  atomicWrite,
  readDocument,
  removeDocument,
  DirTransaction,
  ensureDirectory,
} from "./io.js";
import { evaluateQuery, matches, project, getPath } from "./query.js";
import { stableStringify } from "./format.js";
import { IndexManager } from "./indexes.js";
import { canonicalize, safeParseJson } from "./format/canonical.js";
import {
  DocumentReadError,
  FormatError,
  DocumentNotFoundError,
  MarkdownMissingError,
} from "./errors.js";
import { HierarchyManager } from "./hierarchy/hierarchy-manager.js";
import { validateMaterializedPath, validatePathDepth } from "./validation.js";
import { createSchemaRegistry } from "./schema/registry.js";
import { createSchemaValidator } from "./schema/validator.js";
import { generateSlug, generateUniqueSlug } from "./slug.js";
import type { SlugOptions, MarkdownMap } from "./types.js";
import { resolveMdPath, checkSymlink, verifyIntegrity, type PathPolicy } from "./markdown.js";

const execFile = promisify(execFileCallback);

/**
 * JSON Store implementation with Git-backed file storage
 *
 * Provides CRUD operations, Mango query support, optional indexes, and Git integration.
 * All documents are stored as prettified JSON files with deterministic formatting for clean diffs.
 *
 * @example
 * ```typescript
 * const store = openStore({ root: './data' });
 *
 * // Store a document
 * await store.put(
 *   { type: 'task', id: 'task-1' },
 *   { type: 'task', id: 'task-1', title: 'Fix bug', status: 'open' }
 * );
 *
 * // Query documents
 * const results = await store.query({
 *   type: 'task',
 *   filter: { status: { $eq: 'open' } },
 *   sort: { priority: -1 }
 * });
 * ```
 */
class JSONStore implements Store {
  #options: Required<StoreOptions & { enableHierarchy?: boolean; experimental?: any }>;
  #cache: DocumentCache;
  #indexManager: IndexManager;
  #hierarchyManager?: HierarchyManager;
  #rootPath: string;
  #schemaRegistry: SchemaRegistry | null = null;
  #schemaValidator: SchemaValidator | null = null;
  #schemaLoadPromise: Promise<void> | null = null;

  constructor(options: StoreOptions) {
    // Resolve root to absolute path for consistent cache keys
    const resolvedRoot = path.resolve(options.root);

    // Canonicalize root path to prevent symlink traversal
    let canonicalRoot = resolvedRoot;
    try {
      canonicalRoot = fsSync.realpathSync(resolvedRoot);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
      // Root doesn't exist yet - use resolved path
    }

    // Clamp format concurrency to safe range (1-64)
    const formatConcurrency = Math.max(1, Math.min(64, options.formatConcurrency ?? 16));

    this.#options = {
      root: canonicalRoot,
      indent: options.indent ?? 2,
      stableKeyOrder: options.stableKeyOrder ?? "alpha",
      watch: options.watch ?? false,
      enableIndexes: options.enableIndexes ?? false,
      indexes: options.indexes ?? {},
      formatConcurrency,
      enableHierarchy: options.enableHierarchy ?? false,
      schemaMode: options.schemaMode ?? "off",
      customFormats: options.customFormats ?? {},
      defaultSchemas: options.defaultSchemas ?? {},
      experimental: options.experimental ?? {},
      slugConfig: options.slugConfig ?? {},
      markdownSidecars: options.markdownSidecars ?? { enabled: false },
    };

    // Initialize cache with default settings
    // JSONSTORE_CACHE_SIZE=0 disables caching
    this.#cache = new DocumentCache({
      maxSize: 10000,
      root: canonicalRoot,
    });

    // Initialize index manager
    this.#indexManager = new IndexManager(resolvedRoot, {
      indent: this.#options.indent,
      stableKeyOrder: this.#options.stableKeyOrder,
    });

    // Initialize hierarchy manager if enabled
    if (this.#options.enableHierarchy) {
      this.#hierarchyManager = new HierarchyManager({
        root: resolvedRoot,
        indent: this.#options.indent,
        stableKeyOrder: this.#options.stableKeyOrder,
        maxDepth: this.#options.experimental?.maxDepth,
      });

      // Initialize async (recover from crashes)
      this.#hierarchyManager.initialize().catch((err) => {
        console.error("Failed to initialize hierarchy manager:", err);
      });
    }

    this.#rootPath = canonicalRoot;

    // Initialize schema validation if mode is not 'off'
    if (this.#options.schemaMode !== "off") {
      this.#schemaRegistry = createSchemaRegistry();
      this.#schemaValidator = createSchemaValidator(this.#schemaRegistry);

      // Register custom formats if provided
      if (Object.keys(this.#options.customFormats).length > 0) {
        this.#schemaValidator.registerFormats(this.#options.customFormats);
      }

      // Load schemas asynchronously (non-blocking)
      // Schemas will be available after this promise resolves
      this.#schemaLoadPromise = this.#schemaRegistry.loadAll(canonicalRoot).catch((err) => {
        // Log error but don't fail construction
        console.warn(`Failed to load schemas: ${err.message}`);
      });
    }
  }

  get options(): Required<StoreOptions> {
    return this.#options;
  }

  /**
   * Store or update a document
   *
   * Atomically writes the document to disk with deterministic formatting.
   * Invalidates cache entry and updates indexes if enabled.
   *
   * @param key - Document identifier (type and id)
   * @param doc - Document data (must include matching type and id fields)
   * @param opts - Optional write options (git commit message)
   * @throws {ValidationError} If key or document is invalid
   * @throws {DocumentWriteError} If write operation fails
   *
   * @example
   * ```typescript
   * await store.put(
   *   { type: 'task', id: 'task-1' },
   *   { type: 'task', id: 'task-1', title: 'Fix bug', status: 'open' }
   * );
   * ```
   */
  async put(key: Key, doc: Document, opts?: WriteOptions): Promise<void> {
    // Validate key and document
    validateKey(key);
    validateDocument(key, doc);

    // Schema validation (if enabled)
    if (this.#options.schemaMode !== "off" && this.#schemaValidator && this.#schemaRegistry) {
      // Wait for schema loading to complete if still in progress
      if (this.#schemaLoadPromise) {
        await this.#schemaLoadPromise;
      }

      // Determine schema reference
      let schemaRef: SchemaRef | undefined = doc.schemaRef;

      // Fall back to default schema for kind if no schemaRef provided
      if (!schemaRef && doc.kind && this.#options.defaultSchemas[doc.kind]) {
        schemaRef = this.#options.defaultSchemas[doc.kind];
      }

      // Validate if schema reference is present
      if (schemaRef) {
        const result = validateWithSchema(
          doc,
          schemaRef,
          this.#schemaValidator,
          this.#options.schemaMode
        );

        if (!result.ok) {
          if (this.#options.schemaMode === "strict") {
            // In strict mode, throw error with all validation errors
            const errorMessages = result.errors
              .map((e) => `  ${e.pointer}: ${e.message}`)
              .join("\n");
            throw new Error(
              `Schema validation failed for ${key.type}/${key.id}:\n${errorMessages}`
            );
          } else if (this.#options.schemaMode === "lenient") {
            // In lenient mode, log warnings but continue
            console.warn(`Schema validation warnings for ${key.type}/${key.id}:`);
            result.errors.forEach((e) => {
              console.warn(`  ${e.pointer}: ${e.message}`);
            });
          }
        }
      } else if (this.#options.schemaMode === "strict") {
        // In strict mode with no schema ref, fail fast
        throw new Error(
          `Schema validation failed for ${key.type}/${key.id}: no schemaRef and no default schema for kind "${doc.kind || "N/A"}"`
        );
      }
    }

    // Get old document for index updates and slug processing
    let oldDoc: Document | null = null;
    const needsOldDoc = this.#options.enableIndexes || this.#getSlugConfig(key.type);
    if (needsOldDoc) {
      try {
        oldDoc = await this.get(key);
      } catch (err: any) {
        // Document doesn't exist yet - that's fine
        // But rethrow read/parse errors to avoid creating duplicate slugs
        if (err.code !== "ENOENT" && !(err instanceof DocumentNotFoundError)) {
          throw err;
        }
      }
    }

    // Process slug (if configured for this type)
    let processedDoc = doc;
    let slugScopeKey = "";
    let oldSlugScopeKey = "";
    let oldSlug: string | undefined;

    const slugConfig = this.#getSlugConfig(key.type);
    if (slugConfig) {
      const result = await this.#processSlug(key, doc, oldDoc);
      processedDoc = result.doc;
      slugScopeKey = result.scopeKey;
      oldSlugScopeKey = result.oldScopeKey ?? result.scopeKey;
      oldSlug = result.oldSlug;

      // Claim the new slug (if it changed or scope changed)
      const slugChanged = processedDoc.slug && processedDoc.slug !== oldSlug;
      const scopeChanged = slugScopeKey !== oldSlugScopeKey;

      if (processedDoc.slug && (slugChanged || scopeChanged)) {
        const claimResult = await this.#indexManager.claimSlug(
          key.type,
          slugScopeKey,
          processedDoc.slug,
          key.id
        );

        if (!claimResult.ok) {
          throw new Error(
            `Slug "${processedDoc.slug}" is already taken by document ${claimResult.holderId}`
          );
        }
      }
    }

    // Check if markdown sidecars are enabled and provided
    const hasMarkdown = opts?.markdown && Object.keys(opts.markdown).length > 0;
    const markdownEnabled = this.#options.markdownSidecars?.enabled === true;
    const hasMdField = doc.md !== undefined;

    // Check if document exists in Layout 1 format (subfolder)
    let existsInLayout1 = false;
    if (markdownEnabled && hasMdField) {
      const layout1Path = path.join(this.getDocumentDir(key), `${key.id}.json`);
      try {
        await fs.access(layout1Path);
        existsInLayout1 = true;
      } catch {
        // Layout 1 file doesn't exist
      }
    }

    // Use transaction-based write if:
    // 1. Markdown sidecars are enabled AND document has md field AND
    // 2. Either markdown content is provided OR document already exists in Layout 1
    // This ensures Layout 1 documents get JSON updates even when markdown is omitted
    if (markdownEnabled && hasMdField && (hasMarkdown || existsInLayout1)) {
      await this.writeMarkdownWithTransaction(key, doc, opts?.markdown || {});

      // Update indexes (if enabled)
      if (this.#options.enableIndexes) {
        const fields = this.#getIndexedFields(key.type);
        for (const field of fields) {
          const oldValue = oldDoc ? getPath(oldDoc, field) : undefined;
          const newValue = getPath(doc, field);
          await this.#indexManager.updateIndex(key.type, field, key.id, oldValue, newValue);
        }
      }

      // Optional git commit (non-blocking, logs errors)
      if (opts?.gitCommit) {
        const filePath = this.getFilePath(key);
        try {
          await this.gitCommit(filePath, opts.gitCommit);
        } catch (err: any) {
          console.error("Git commit failed:", err.message);
        }
      }

      return;
    }

    // Standard write path (no markdown sidecars)
    // Canonicalize document with stable formatting
    const content = stableStringify(
      processedDoc,
      this.#options.indent,
      this.#options.stableKeyOrder
    );

    // Get file path
    const filePath = this.getFilePath(key);

    // No-op write optimization: skip write if content unchanged
    let unchanged = false;
    try {
      const prev = await readDocument(filePath);
      unchanged = prev === content;
    } catch (err: any) {
      // File doesn't exist - proceed with write
      // But rethrow other read errors (EPERM, EIO, etc.) to surface real failures
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    // Perform atomic write if content changed
    if (!unchanged) {
      try {
        await atomicWrite(filePath, content);
      } catch (err: any) {
        // Compensating action: release slug claim if write failed
        const slugChanged = processedDoc.slug && processedDoc.slug !== oldSlug;
        const scopeChanged = slugScopeKey !== oldSlugScopeKey;
        if (slugConfig && processedDoc.slug && (slugChanged || scopeChanged)) {
          await this.#indexManager.releaseSlug(key.type, slugScopeKey, processedDoc.slug, key.id);
        }
        throw err;
      }
    }

    // Release old slug after successful write (use old scope if document moved)
    // Release if: slug text changed OR (slug text same but scope changed)
    const shouldReleaseOldSlug =
      slugConfig &&
      oldSlug &&
      !unchanged &&
      (oldSlug !== processedDoc.slug || slugScopeKey !== oldSlugScopeKey);

    if (shouldReleaseOldSlug) {
      // TypeScript: oldSlug is guaranteed to be string due to shouldReleaseOldSlug guard
      const releaseScope = oldSlugScopeKey || slugScopeKey;
      await this.#indexManager.releaseSlug(key.type, releaseScope, oldSlug!, key.id);

      // Handle alias creation for published slug changes (only if slug text changed)
      if (slugConfig.allowPublishedRename !== false && oldSlug !== processedDoc.slug) {
        // Add old slug as alias
        const currentAliases = (processedDoc.aliases as string[]) ?? [];
        if (!currentAliases.includes(oldSlug!)) {
          await this.#indexManager.updateSlugAliases(key.type, slugScopeKey, [oldSlug!], [], key.id);
        }
      }
    }

    // Avoid serving stale data after concurrent writers; next read will repopulate safely.
    this.#cache.delete(filePath);

    // Update indexes (if enabled and document changed)
    if (this.#options.enableIndexes && !unchanged) {
      const fields = this.#getIndexedFields(key.type);
      for (const field of fields) {
        const oldValue = oldDoc ? getPath(oldDoc, field) : undefined;
        const newValue = getPath(processedDoc, field);
        await this.#indexManager.updateIndex(key.type, field, key.id, oldValue, newValue);
      }
    }

    // Optional git commit (non-blocking, logs errors)
    if (!unchanged && opts?.gitCommit) {
      try {
        await this.gitCommit(filePath, opts.gitCommit);
      } catch (err: any) {
        console.error("Git commit failed:", err.message);
      }
    }
  }

  /**
   * Retrieve a document by key
   *
   * Returns the document from cache if available and valid, otherwise reads from disk.
   * Implements TOCTOU (Time-of-check to time-of-use) guard by re-checking file stats after read.
   *
   * @param key - Document identifier (type and id)
   * @param opts - Optional get options (include markdown, etc.)
   * @returns Document if found, null if not found. If includeMarkdown is true, adds _markdown field with content
   * @throws {ValidationError} If key is invalid
   * @throws {DocumentReadError} If read operation fails (excluding ENOENT)
   *
   * @example
   * ```typescript
   * const doc = await store.get({ type: 'task', id: 'task-1' });
   * if (doc) {
   *   console.log(doc.title);
   * }
   *
   * // With markdown
   * const docWithMd = await store.get({ type: 'city', id: 'new-york' }, { includeMarkdown: true });
   * console.log(docWithMd._markdown.summary);
   * ```
   */
  async get(key: Key, opts?: GetOptions): Promise<Document | null> {
    validateKey(key);

    // For Layout 1 (markdown sidecars), files are in subdirectories
    // Check subdirectory first if markdown sidecars are enabled
    let filePath = this.getFilePath(key);
    if (this.#options.markdownSidecars?.enabled) {
      const layout1Path = path.join(this.getDocumentDir(key), `${key.id}.json`);
      // Check if layout 1 file exists
      try {
        await fs.access(layout1Path);
        filePath = layout1Path;
      } catch {
        // Fall back to flat path
      }
    }

    // Retry up to 3 times if file changes during read (TOCTOU guard)
    for (let attempt = 0; attempt < 3; attempt++) {
      // Check if file exists and get initial stats
      const st1 = await fs.stat(filePath).catch((err: any) => {
        if (err?.code === "ENOENT") {
          return null;
        }
        throw err;
      });
      if (!st1 || !st1.isFile()) {
        return null;
      }

      // Try cache first (with metadata validation)
      const cached = this.#cache.get(filePath, st1);
      if (cached) {
        // If markdown is requested and document has md field, load it
        if (opts?.includeMarkdown && cached.md) {
          const markdown = await this.readMarkdownFields(key, cached);
          return { ...cached, _markdown: markdown };
        }
        return cached;
      }

      // Cache miss - read from disk using readDocument for consistent error handling
      let content: string;
      try {
        content = await readDocument(filePath);
      } catch (err: any) {
        // Handle concurrent deletion (DocumentNotFoundError has code ENOENT)
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      }

      // Parse document with better error messages
      let doc: Document;
      try {
        doc = JSON.parse(content) as Document;
      } catch (err: any) {
        throw new Error(`Failed to parse JSON document at ${filePath}: ${err.message}`);
      }

      // Validate document has required fields and matches key
      try {
        validateDocument(key, doc);
      } catch (err: any) {
        throw new Error(`Document validation failed for ${filePath}: ${err.message}`);
      }

      // TOCTOU guard: re-check stats after reading
      // If file changed during read, retry (unless this is last attempt)
      const st2 = await fs.stat(filePath).catch((err: any) => {
        if (err?.code === "ENOENT") {
          return null;
        }
        throw err;
      });
      if (st2 && st2.mtimeMs === st1.mtimeMs && st2.size === st1.size) {
        // Stats match - safe to cache and return
        this.#cache.set(filePath, doc, st2);

        // If markdown is requested and document has md field, load it
        if (opts?.includeMarkdown && doc.md) {
          const markdown = await this.readMarkdownFields(key, doc);
          return { ...doc, _markdown: markdown };
        }
        return doc;
      }

      // Stats don't match - file changed during read
      // Retry unless this was the last attempt
      if (attempt === 2) {
        // Last attempt - return without caching
        // If markdown is requested and document has md field, load it
        if (opts?.includeMarkdown && doc.md) {
          const markdown = await this.readMarkdownFields(key, doc);
          return { ...doc, _markdown: markdown };
        }
        return doc;
      }
    }

    // Should never reach here, but TypeScript needs a return
    return null;
  }

  /**
   * Remove a document
   *
   * Deletes the document file and updates indexes if enabled.
   * Operation is idempotent - no error if document doesn't exist.
   *
   * @param key - Document identifier (type and id)
   * @param opts - Optional remove options (git commit message)
   * @throws {ValidationError} If key is invalid
   *
   * @example
   * ```typescript
   * await store.remove({ type: 'task', id: 'task-1' });
   * ```
   */
  async remove(key: Key, opts?: RemoveOptions): Promise<void> {
    validateKey(key);
    const filePath = this.getFilePath(key);

    // Get document for index updates (if indexes enabled)
    let doc: Document | null = null;
    if (this.#options.enableIndexes) {
      try {
        doc = await this.get(key);
      } catch {
        // Document doesn't exist - removal is idempotent
      }
    }

    // Remove document (idempotent - no error if doesn't exist)
    await removeDocument(filePath);

    // Clear from cache
    this.#cache.delete(filePath);

    // Update indexes (if enabled and document existed)
    if (this.#options.enableIndexes && doc) {
      const fields = this.#getIndexedFields(key.type);
      for (const field of fields) {
        const value = getPath(doc, field);
        await this.#indexManager.updateIndex(key.type, field, key.id, value, undefined);
      }
    }

    // Optional git commit (non-blocking, logs errors)
    if (opts?.gitCommit) {
      try {
        await this.gitCommit(filePath, opts.gitCommit);
      } catch (err: any) {
        console.error("Git commit failed:", err.message);
      }
    }
  }

  /**
   * List all document IDs for a given type
   *
   * Returns a sorted array of document IDs. Does not load document content.
   *
   * @param type - Entity type to list
   * @returns Sorted array of document IDs
   * @throws {ValidationError} If type name is invalid
   *
   * @example
   * ```typescript
   * const ids = await store.list('task');
   * console.log(`Found ${ids.length} tasks`);
   * ```
   */
  async list(type: string): Promise<string[]> {
    validateName(type, "type");
    const typeDir = path.join(this.#rootPath, type);

    // Ensure type directory doesn't contain symlinks
    this.assertNoSymbolicLinks(typeDir);

    // List all .json files
    const files = await listFiles(typeDir, ".json");

    // Extract IDs (remove .json extension) and return sorted
    return files.map((f) => path.basename(f, ".json")).sort();
  }

  /**
   * Execute a Mango query to find matching documents
   *
   * Supports filtering, sorting, projection, and pagination. Uses indexes when available
   * and implements several fast paths for common query patterns.
   *
   * @param spec - Query specification with filter, optional sort/projection/pagination
   * @returns Array of matching documents (may be empty)
   * @throws {Error} If query specification is invalid
   *
   * @example
   * ```typescript
   * // Find open high-priority tasks
   * const results = await store.query({
   *   type: 'task',
   *   filter: {
   *     $and: [
   *       { status: { $eq: 'open' } },
   *       { priority: { $gte: 8 } }
   *     ]
   *   },
   *   sort: { priority: -1, createdAt: -1 },
   *   limit: 10
   * });
   * ```
   */
  async query(spec: QuerySpec): Promise<Document[]> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    // Validate input
    if (!spec.filter || typeof spec.filter !== "object") {
      throw new Error("query() requires a filter object");
    }

    if (spec.skip !== undefined && (typeof spec.skip !== "number" || spec.skip < 0)) {
      throw new Error("skip must be a non-negative number");
    }

    if (spec.limit !== undefined && (typeof spec.limit !== "number" || spec.limit <= 0)) {
      throw new Error("limit must be a positive number");
    }

    // Validate type if provided
    if (spec.type) {
      validateName(spec.type, "type");
    }

    // Check for index fast path: equality filter on indexed field
    if (this.#options.enableIndexes && spec.type && this.#isEqualityFilter(spec.filter)) {
      const eqFilter = this.#isEqualityFilter(spec.filter);
      if (eqFilter && (await this.#indexManager.hasIndex(spec.type, eqFilter.field))) {
        const result = await this.#queryWithIndex(spec, eqFilter);

        if (process.env.JSONSTORE_DEBUG) {
          const duration = performance.now() - startTime;
          console.error(
            `[JSONSTORE_DEBUG] query: ${result.length} results, ${duration.toFixed(2)}ms, indexPath=true, type=${spec.type}, field=${eqFilter.field}`
          );
        }

        return result;
      }
    }

    // Check for fast path: single type, simple ID-based filter, no sort/projection
    if (spec.type && !spec.sort && !spec.projection && this.canUseFastPath(spec.filter)) {
      const ids = this.extractIdsFromFilter(spec.filter);
      if (ids) {
        const docs: Document[] = [];

        for (const id of ids) {
          const doc = await this.get({ type: spec.type, id });
          if (doc && matches(doc, spec.filter)) {
            docs.push(doc);
          }
        }

        // Sort by ID for stable ordering
        docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        // Apply pagination
        const skip = spec.skip ?? 0;
        const result =
          spec.limit !== undefined ? docs.slice(skip, skip + spec.limit) : docs.slice(skip);

        if (process.env.JSONSTORE_DEBUG) {
          const duration = performance.now() - startTime;
          console.error(
            `[JSONSTORE_DEBUG] query: ${result.length} results, ${duration.toFixed(2)}ms, fastPath=true, type=${spec.type}`
          );
        }

        return result;
      }
    }

    // General path: evaluate query with full scan
    let results: Document[];

    if (!spec.sort) {
      // No sort: can use streaming with early termination
      const matches: Document[] = [];
      const skip = spec.skip ?? 0;
      const limit = spec.limit;
      let skipped = 0;
      let taken = 0;

      for await (const doc of this.scan(spec)) {
        if (this.matchesFilter(doc, spec.filter)) {
          if (skipped < skip) {
            skipped++;
          } else if (limit === undefined || taken < limit) {
            matches.push(doc);
            taken++;
            if (limit !== undefined && taken >= limit) {
              break;
            }
          }
        }
      }

      // Apply projection if needed
      results = spec.projection ? matches.map((d) => project(d, spec.projection)) : matches;
    } else {
      // With sort: must materialize all matches, but filter during scan to avoid buffering non-matching docs
      const allDocs: Document[] = [];
      for await (const doc of this.scan(spec)) {
        if (this.matchesFilter(doc, spec.filter)) {
          allDocs.push(doc);
        }
      }

      // Use evaluateQuery for sort+paginate+project (filtering already applied)
      results = evaluateQuery(allDocs, {
        filter: {}, // Already filtered during scan
        sort: spec.sort,
        skip: spec.skip,
        limit: spec.limit,
        projection: spec.projection,
      });
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] query: ${results.length} results, ${duration.toFixed(2)}ms, fastPath=false, type=${spec.type ?? "all"}, sort=${!!spec.sort}`
      );
    }

    return results;
  }

  /**
   * Check if a filter can use the fast path (ID-only filter)
   */
  private canUseFastPath(filter: any): boolean {
    // Fast path only for simple id filters: { id: { $eq: "x" } } or { id: { $in: [...] } }
    if (!filter || typeof filter !== "object") return false;

    const keys = Object.keys(filter);
    if (keys.length !== 1 || keys[0] !== "id") return false;

    const idFilter = filter.id;
    if (!idFilter || typeof idFilter !== "object") return false;

    const ops = Object.keys(idFilter);
    return ops.length === 1 && (ops[0] === "$eq" || ops[0] === "$in");
  }

  /**
   * Extract IDs from a fast-path filter
   */
  private extractIdsFromFilter(filter: any): string[] | null {
    if (!filter?.id) return null;

    const idFilter = filter.id;
    if (idFilter.$eq !== undefined) {
      return [String(idFilter.$eq)];
    }
    if (Array.isArray(idFilter.$in)) {
      return Array.from(new Set(idFilter.$in.map(String)));
    }

    return null;
  }

  /**
   * Test if document matches filter (wrapper for query.matches)
   */
  private matchesFilter(doc: Document, filter: any): boolean {
    return matches(doc, filter);
  }

  /**
   * Check if filter is a simple equality filter
   * Returns { field, value } if it matches, null otherwise
   */
  #isEqualityFilter(filter: any): { field: string; value: any } | null {
    if (!filter || typeof filter !== "object") return null;

    const keys = Object.keys(filter);
    if (keys.length !== 1) return null;

    const field = keys[0]!;
    const cond: any = filter[field];

    // Support both { field: value } and { field: { $eq: value } }
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$eq" in cond) {
        return { field, value: cond.$eq };
      }
      // Not an equality operator
      return null;
    }

    // Direct value (scalar equality)
    return { field, value: cond };
  }

  async stats(type?: string): Promise<StoreStats> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    if (type) {
      // Stats for specific type
      validateTypeName(type);
      const result = await this.getTypeStats(type);

      if (process.env.JSONSTORE_DEBUG) {
        const duration = performance.now() - startTime;
        console.error(
          `[JSONSTORE_DEBUG] stats: type=${type}, count=${result.count}, bytes=${result.bytes}, ${duration.toFixed(2)}ms`
        );
      }

      return result;
    }

    // Stats for all types
    const types = await this.listTypes();
    let totalCount = 0;
    let totalBytes = 0;

    // Process types with limited concurrency to avoid FD exhaustion
    const CONCURRENCY = 16;
    for (let i = 0; i < types.length; i += CONCURRENCY) {
      const batch = types.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((t) => this.getTypeStats(t)));

      for (const stats of results) {
        totalCount += stats.count;
        totalBytes += stats.bytes;
      }
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] stats: type=all, types=${types.length}, count=${totalCount}, bytes=${totalBytes}, ${duration.toFixed(2)}ms`
      );
    }

    return { count: totalCount, bytes: totalBytes };
  }

  async detailedStats(): Promise<DetailedStats> {
    const startTime = process.env.JSONSTORE_DEBUG ? performance.now() : 0;

    const types = await this.listTypes();
    const typeStats: Record<string, StoreStats> = {};

    let totalCount = 0;
    let totalBytes = 0;
    let globalMin = Infinity;
    let globalMax = 0;

    // Process types with limited concurrency
    const CONCURRENCY = 16;
    for (let i = 0; i < types.length; i += CONCURRENCY) {
      const batch = types.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (type) => {
          const detailed = await this.scanType(type);
          return { type, ...detailed };
        })
      );

      for (const result of results) {
        typeStats[result.type] = { count: result.count, bytes: result.bytes };
        totalCount += result.count;
        totalBytes += result.bytes;
        if (result.count > 0) {
          globalMin = Math.min(globalMin, result.minBytes);
          globalMax = Math.max(globalMax, result.maxBytes);
        }
      }
    }

    if (process.env.JSONSTORE_DEBUG) {
      const duration = performance.now() - startTime;
      console.error(
        `[JSONSTORE_DEBUG] detailedStats: types=${types.length}, count=${totalCount}, bytes=${totalBytes}, ${duration.toFixed(2)}ms`
      );
    }

    return {
      count: totalCount,
      bytes: totalBytes,
      avgBytes: totalCount > 0 ? totalBytes / totalCount : 0,
      minBytes: globalMin === Infinity ? 0 : globalMin,
      maxBytes: globalMax,
      types: typeStats,
    };
  }

  /**
   * Execute query using index fast path
   */
  async #queryWithIndex(
    spec: QuerySpec,
    eqFilter: { field: string; value: any }
  ): Promise<Document[]> {
    // Get IDs from index
    const ids = await this.#indexManager.queryWithIndex(spec.type!, eqFilter.field, eqFilter.value);

    // Optimize: if no sort/projection and we have skip/limit, pre-slice IDs before loading docs
    let idsToLoad = ids;
    let needsPagination = false;

    if (!spec.sort && !spec.projection) {
      const skip = spec.skip ?? 0;
      const limit = spec.limit;

      if (limit !== undefined) {
        idsToLoad = ids.slice(skip, skip + limit);
      } else if (skip > 0) {
        idsToLoad = ids.slice(skip);
      }
    } else {
      needsPagination = true;
    }

    // Load documents
    const docs: Document[] = [];
    for (const id of idsToLoad) {
      const doc = await this.get({ type: spec.type!, id });
      if (doc && matches(doc, spec.filter)) {
        docs.push(doc);
      }
    }

    // If we need sort/projection/pagination, use evaluateQuery
    if (needsPagination) {
      return evaluateQuery(docs, {
        filter: {}, // Already filtered
        sort: spec.sort,
        skip: spec.skip,
        limit: spec.limit,
        projection: spec.projection,
      });
    }

    // Apply projection if needed (pagination already done via ID pre-slice)
    return spec.projection ? docs.map((d) => project(d, spec.projection)) : docs;
  }

  /**
   * Get indexed fields for a type
   */
  async #listTypes(): Promise<string[]> {
    const dataDir = path.join(this.#rootPath);
    try {
      const entries = await fs.readdir(dataDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
        .map((e) => e.name);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  #getIndexedFields(type: string): string[] {
    const fields = this.#options.indexes?.[type] ?? [];
    return fields.filter((field) => !this.#isReservedIndexField(field));
  }

  #isReservedIndexField(field: string): boolean {
    return field === "_slug" || field === "_alias";
  }

  #syncTrackedIndexes(type: string, fields: readonly string[]): void {
    const filteredExisting =
      this.#options.indexes[type]?.filter((field) => !this.#isReservedIndexField(field)) ?? [];
    const filteredFields = fields.filter((field) => !this.#isReservedIndexField(field));

    if (filteredFields.length === 0) {
      if (filteredExisting.length > 0) {
        this.#options.indexes[type] = filteredExisting;
      } else if (this.#options.indexes[type]) {
        delete this.#options.indexes[type];
      }
      return;
    }

    const merged = [...filteredExisting];
    for (const field of filteredFields) {
      if (!merged.includes(field)) {
        merged.push(field);
      }
    }

    this.#options.indexes[type] = merged;
  }

  /**
   * Get slug configuration for a type
   */
  #getSlugConfig(type: string): SlugOptions | undefined {
    return this.#options.slugConfig?.[type];
  }

  /**
   * Extract source field value(s) for slug generation
   */
  #extractSlugSource(doc: Document, source: string | string[]): string {
    if (typeof source === "string") {
      const value = getPath(doc, source);
      return String(value ?? "");
    }

    // Array of fields: concatenate with space
    const values = source.map((field) => {
      const value = getPath(doc, field);
      return String(value ?? "");
    });
    return values.filter((v) => v).join(" ");
  }

  /**
   * Process slug for a document
   * Generates slug from source fields and ensures uniqueness in scope
   * Returns the document with slug field set, and old slug if changed
   */
  async #processSlug(
    key: Key,
    doc: Document,
    oldDoc: Document | null
  ): Promise<{ doc: Document; oldSlug?: string; scopeKey: string; oldScopeKey?: string }> {
    const config = this.#getSlugConfig(key.type);
    if (!config) {
      return { doc, scopeKey: "", oldScopeKey: "" };
    }

    // Extract source text for slug generation
    const sourceText = this.#extractSlugSource(doc, config.source);

    // Generate base slug
    const baseSlug = generateSlug(sourceText, {
      maxLength: config.maxLength,
      reservedWords: config.reservedWords,
      transliterate: config.transliterate,
      locale: config.locale,
    });

    // Determine scope key (and old scope if document existed)
    const scopeKey = config.scope ? config.scope(doc) : "global";
    const oldScopeKey = oldDoc && config.scope ? config.scope(oldDoc) : scopeKey;

    // Check if document already has the same slug
    const oldSlug = oldDoc?.slug as string | undefined;
    if (oldSlug === baseSlug) {
      // No change needed
      return { doc: { ...doc, slug: baseSlug }, oldSlug, scopeKey, oldScopeKey };
    }

    // Get all existing slugs in this scope
    const existingSlugs = await this.#indexManager.getSlugsInScope(key.type, scopeKey);

    // Generate unique slug (will use baseSlug if available, or add suffix)
    const uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs, config.maxLength ?? 64);

    return {
      doc: { ...doc, slug: uniqueSlug },
      oldSlug,
      scopeKey,
      oldScopeKey,
    };
  }

  async ensureIndex(type: string, field: string): Promise<void> {
    validateName(type, "type");
    validateName(field, "id"); // Reuse validation pattern
    if (this.#isReservedIndexField(field)) {
      throw new Error(`Cannot manage reserved index field "${field}" with ensureIndex()`);
    }
    await this.#indexManager.ensureIndex(type, field);

    this.#syncTrackedIndexes(type, [field]);
  }

  async rebuildIndexes(type: string, options?: RebuildIndexesOptions): Promise<ReindexSummary> {
    validateName(type, "type");
    let fields = options?.fields;

    if (!fields || fields.length === 0) {
      const configuredFields = this.#options.indexes[type] ?? [];
      const diskFields = await this.#indexManager.listIndexes(type);
      fields = [...new Set([...configuredFields, ...diskFields])];
    } else {
      fields = [...new Set(fields)];
    }

    const filteredFields = fields.filter((field) => !this.#isReservedIndexField(field));

    if (filteredFields.length === 0) {
      this.#syncTrackedIndexes(type, []);
      return {
        type,
        docsScanned: 0,
        fields: [],
        durationMs: 0,
      };
    }

    const rebuildOptions: RebuildIndexesOptions = {
      ...(options ?? {}),
      fields: filteredFields,
    };

    const summary = await this.#indexManager.rebuildIndexes(type, rebuildOptions);

    const rebuiltFields = summary.fields.map((f) => f.field);
    this.#syncTrackedIndexes(type, rebuiltFields);

    return summary;
  }

  async reindex(options?: ReindexOptions): Promise<ReindexAllSummary> {
    const startTime = performance.now();
    const types: ReindexSummary[] = [];
    let totalDocs = 0;
    let totalIndexes = 0;

    // Get all types that have indexes
    const typesWithIndexes = new Set<string>();

    // Add types from configured indexes
    for (const type of Object.keys(this.#options.indexes)) {
      typesWithIndexes.add(type);
    }

    // Add types with index files on disk
    const dataDir = this.#rootPath;
    try {
      const entries = await fs.readdir(dataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith("_")) {
          const indexDir = path.join(dataDir, entry.name, "_indexes");
          try {
            await fs.access(indexDir);
            typesWithIndexes.add(entry.name);
          } catch {
            // No index directory, skip
          }
        }
      }
    } catch {
      // Data directory doesn't exist or can't be read
    }

    // Rebuild indexes for each type
    for (const type of Array.from(typesWithIndexes).sort()) {
      const summary = await this.rebuildIndexes(type, {
        force: options?.force,
      });

      if (summary.fields.length === 0) {
        continue;
      }

      types.push(summary);
      totalDocs += summary.docsScanned;
      totalIndexes += summary.fields.length;
    }

    const durationMs = parseFloat((performance.now() - startTime).toFixed(2));

    return {
      totalDocs,
      totalIndexes,
      types,
      durationMs,
    };
  }

  /**
   * Get a document by slug
   *
   * @param type - Entity type
   * @param scopeKey - Scope key (e.g., country code for city slugs)
   * @param slug - Slug to look up
   * @returns Document if found, null otherwise
   */
  async getBySlug(type: string, scopeKey: string, slug: string): Promise<Document | null> {
    validateName(type, "type");

    // Find document ID by slug
    const docId = await this.#indexManager.findSlugHolder(type, scopeKey, slug);
    if (!docId) {
      return null;
    }

    // Get document by ID
    return this.get({ type, id: docId });
  }

  /**
   * Resolve a slug or alias to a document
   *
   * @param type - Entity type
   * @param scopeKey - Scope key
   * @param slugOrAlias - Slug or alias to resolve
   * @returns Document if found, null otherwise
   */
  async resolveSlugOrAlias(
    type: string,
    scopeKey: string,
    slugOrAlias: string
  ): Promise<Document | null> {
    validateName(type, "type");

    // Resolve slug or alias to document ID
    const docId = await this.#indexManager.resolveSlugOrAlias(type, scopeKey, slugOrAlias);
    if (!docId) {
      return null;
    }

    // Get document by ID
    return this.get({ type, id: docId });
  }

  async format(target?: FormatTarget, options?: FormatOptions): Promise<number> {
    const dryRun = options?.dryRun ?? false;
    const failFast = options?.failFast ?? false;
    let reformattedCount = 0;
    const errors: Array<{ file: string; error: string }> = [];

    // Build canonical options from store settings
    const canonicalOpts: CanonicalOptions = {
      indent: this.#options.indent,
      stableKeyOrder:
        this.#options.stableKeyOrder === "alpha" ? true : this.#options.stableKeyOrder,
      eol: "LF",
      trailingNewline: true,
    };

    if (!target || "all" in target) {
      // Format all documents in all types
      const types = await this.getAllTypes();
      for (const type of types) {
        const count = await this.formatType(type, canonicalOpts, dryRun, failFast, errors);
        reformattedCount += count;
      }
    } else if (target.id) {
      // Format specific document
      const formatted = await this.formatDocument(
        target.type,
        target.id,
        canonicalOpts,
        dryRun,
        failFast,
        errors
      );
      if (formatted) reformattedCount++;
    } else {
      // Format all documents of a type
      const count = await this.formatType(target.type, canonicalOpts, dryRun, failFast, errors);
      reformattedCount += count;
    }

    // Log errors if any occurred
    if (errors.length > 0 && process.env.JSONSTORE_DEBUG) {
      console.error(`[JSONSTORE_DEBUG] format: ${errors.length} errors occurred:`);
      for (const { file, error } of errors) {
        console.error(`  ${file}: ${error}`);
      }
    }

    return reformattedCount;
  }

  private async readSnapshot(
    filePath: string
  ): Promise<{ content: string; normalized: string; stats: Stats } | null> {
    let handle: fs.FileHandle | null = null;

    try {
      handle = await fs.open(filePath, "r");
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return null;
      }
      throw new DocumentReadError(filePath, { cause: err });
    }

    try {
      const stats = await handle.stat();
      const content = await handle.readFile({ encoding: "utf-8" });
      return {
        content,
        normalized: content.replace(/\r?\n/g, "\n"),
        stats,
      };
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return null;
      }
      throw new DocumentReadError(filePath, { cause: err });
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Ignore close errors; the descriptor may already be closed
        }
      }
    }
  }

  /**
   * Format a single document
   * @returns true if document was reformatted, false if already canonical or error occurred
   */
  private async formatDocument(
    type: string,
    id: string,
    canonicalOpts: CanonicalOptions,
    dryRun: boolean,
    failFast: boolean,
    errors: Array<{ file: string; error: string }>
  ): Promise<boolean> {
    const filePath = this.getFilePath({ type, id });

    try {
      // Take a consistent snapshot of the current file contents and metadata
      const snapshot = await this.readSnapshot(filePath);
      if (!snapshot) {
        throw new DocumentNotFoundError(filePath);
      }

      const current = snapshot.content;
      const normalizedCurrent = snapshot.normalized;

      // Parse JSON with safe error handling
      const parseResult = safeParseJson(current);
      if (!parseResult.success) {
        const error = `Invalid JSON: ${parseResult.error}`;
        errors.push({ file: filePath, error });
        if (failFast) {
          throw new FormatError(filePath, { cause: new Error(error) });
        }
        if (process.env.JSONSTORE_DEBUG) {
          console.warn(`[JSONSTORE_DEBUG] format: skipping ${filePath}: ${error}`);
        }
        return false;
      }

      const doc = parseResult.data as Document;

      // Generate canonical representation
      const canonical = canonicalize(doc, canonicalOpts);

      // Check if formatting would change anything (byte-stable check)
      // Compare against original content to ensure line endings are normalized
      if (current === canonical) {
        // Already canonical - no-op
        if (process.env.JSONSTORE_DEBUG) {
          console.error(`[JSONSTORE_DEBUG] format: ${filePath} already canonical`);
        }
        return false;
      }

      // Content differs - write canonical version (unless dry run)
      if (!dryRun) {
        const latest = await this.readSnapshot(filePath);
        if (!latest) {
          const error = "Document was removed during formatting";
          this.#cache.delete(filePath);
          if (failFast) {
            throw new FormatError(filePath, { cause: new Error(error) });
          }
          errors.push({ file: filePath, error });
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`[JSONSTORE_DEBUG] format: ${filePath} vanished before write`);
          }
          return false;
        }

        if (latest.normalized !== normalizedCurrent) {
          if (latest.normalized === canonical) {
            // Another writer already canonicalized the document; refresh cache and skip
            this.#cache.set(filePath, doc, latest.stats);
            if (process.env.JSONSTORE_DEBUG) {
              console.error(`[JSONSTORE_DEBUG] format: ${filePath} already canonical (concurrent)`);
            }
            return false;
          }

          const error =
            "Concurrent modification detected while formatting; skipping to avoid overwriting changes";
          this.#cache.delete(filePath);
          if (failFast) {
            throw new FormatError(filePath, { cause: new Error(error) });
          }
          errors.push({ file: filePath, error });
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`[JSONSTORE_DEBUG] format: ${filePath} changed concurrently, skipping`);
          }
          return false;
        }

        await atomicWrite(filePath, canonical);

        // Update cache with new stats
        const stats = await fs.stat(filePath);
        this.#cache.set(filePath, doc, stats);
      }

      if (process.env.JSONSTORE_DEBUG) {
        console.error(
          `[JSONSTORE_DEBUG] format: ${dryRun ? "would reformat" : "reformatted"} ${filePath}`
        );
      }

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ file: filePath, error: errorMsg });

      if (failFast) {
        throw err;
      }

      if (process.env.JSONSTORE_DEBUG) {
        console.warn(`[JSONSTORE_DEBUG] format: error formatting ${filePath}: ${errorMsg}`);
      }

      return false;
    }
  }

  /**
   * Format all documents of a type with bounded concurrency
   * @returns Number of documents reformatted
   */
  private async formatType(
    type: string,
    canonicalOpts: CanonicalOptions,
    dryRun: boolean,
    failFast: boolean,
    errors: Array<{ file: string; error: string }>
  ): Promise<number> {
    validateName(type, "type");

    // Get all document IDs
    let ids: string[];
    try {
      ids = await this.list(type);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const typePath = path.join(this.#rootPath, type);
      errors.push({ file: typePath, error: errorMsg });

      if (process.env.JSONSTORE_DEBUG) {
        console.warn(
          `[JSONSTORE_DEBUG] format: failed to list documents in ${typePath}: ${errorMsg}`
        );
      }

      if (failFast) {
        throw err;
      }

      return 0;
    }
    if (ids.length === 0) {
      return 0;
    }

    let reformattedCount = 0;
    const concurrency = this.#options.formatConcurrency;

    // Process documents with bounded concurrency
    const queue = [...ids];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const id = queue.shift();
            if (!id) break;

            const formatted = await this.formatDocument(
              type,
              id,
              canonicalOpts,
              dryRun,
              failFast,
              errors
            );
            if (formatted) {
              reformattedCount++;
            }
          }
        })()
      );
    }

    await Promise.all(workers);
    return reformattedCount;
  }

  /**
   * Get statistics for a specific type
   * @param type - Type name
   * @returns Statistics for the type
   */
  private async getTypeStats(type: string): Promise<StoreStats> {
    const result = await this.scanType(type);
    return { count: result.count, bytes: result.bytes };
  }

  /**
   * Scan a type directory and collect detailed statistics
   * @param type - Type name
   * @returns Detailed scan results
   */
  private async scanType(
    type: string
  ): Promise<{ count: number; bytes: number; minBytes: number; maxBytes: number }> {
    const typeDir = path.join(this.#options.root, type);

    // Check directory metadata without following symlinks
    const dirStats = await fs.lstat(typeDir).catch((err: any) => {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    });

    if (!dirStats) {
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
      if (process.env.JSONSTORE_DEBUG) {
        console.warn(`[JSONSTORE_DEBUG] Skipping unsafe type directory: ${typeDir}`);
      }
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    const realTypeDir = await fs.realpath(typeDir).catch((err: any) => {
      if (err.code === "ENOENT") {
        return null;
      }
      throw err;
    });

    if (!realTypeDir) {
      return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
    }

    const realRootDir = await fs.realpath(this.#options.root);
    const relativeDir = path.relative(realRootDir, realTypeDir);
    if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
      throw new Error(`Type directory resolves outside of store root: ${type}`);
    }

    let count = 0;
    let bytes = 0;
    let minBytes = Infinity;
    let maxBytes = 0;
    let skippedFiles = 0;

    try {
      // Use opendir for streaming to avoid memory spikes with large directories
      const dir = await fs.opendir(realTypeDir);

      for await (const entry of dir) {
        // Only process .json files
        if (!entry.name.endsWith(".json")) {
          continue;
        }

        // Get file stats using lstat to avoid following symlinks
        const filePath = path.join(realTypeDir, entry.name);
        try {
          const stats = await fs.lstat(filePath);

          // Skip anything that isn't a regular file (covers symlinks, directories, sockets, etc.)
          if (!stats.isFile()) {
            if (process.env.JSONSTORE_DEBUG) {
              console.warn(`[JSONSTORE_DEBUG] Skipping non-file: ${filePath}`);
            }
            skippedFiles++;
            continue;
          }

          count++;
          bytes += stats.size;
          minBytes = Math.min(minBytes, stats.size);
          maxBytes = Math.max(maxBytes, stats.size);
        } catch (err: any) {
          // Handle transient errors (file deleted between readdir and lstat)
          if (err.code === "ENOENT") {
            if (process.env.JSONSTORE_DEBUG) {
              console.warn(`[JSONSTORE_DEBUG] File disappeared during scan: ${filePath}`);
            }
            skippedFiles++;
            continue;
          }
          // Log other errors but continue scanning
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`[JSONSTORE_DEBUG] Error stating file ${filePath}:`, err.message);
          }
          skippedFiles++;
        }
      }
    } catch (err: any) {
      // Directory disappeared or became inaccessible during scan
      if (err.code === "ENOENT") {
        return { count: 0, bytes: 0, minBytes: 0, maxBytes: 0 };
      }
      throw err;
    }

    if (process.env.JSONSTORE_DEBUG && skippedFiles > 0) {
      console.warn(`[JSONSTORE_DEBUG] Skipped ${skippedFiles} files in ${type}`);
    }

    return {
      count,
      bytes,
      minBytes: count > 0 ? minBytes : 0,
      maxBytes: count > 0 ? maxBytes : 0,
    };
  }

  /**
   * List all types in the store (wrapper for getAllTypes)
   * @returns Array of type names
   */
  private async listTypes(): Promise<string[]> {
    return this.getAllTypes();
  }

  /**
   * List all types (directories) in the store
   * @returns Array of type names
   */
  private async getAllTypes(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.#rootPath, { withFileTypes: true });

      // Filter to directories only, exclude _meta and hidden directories
      // Also exclude symlinks for security
      const types: string[] = [];

      for (const entry of entries) {
        // Skip symlinks for security
        if (entry.isSymbolicLink()) {
          continue;
        }

        // Skip internal and hidden directories
        if (entry.name.startsWith("_") || entry.name.startsWith(".")) {
          continue;
        }

        // Only include directories
        if (!entry.isDirectory()) {
          continue;
        }

        // Validate type name
        try {
          validateTypeName(entry.name);
          types.push(entry.name);
        } catch {
          // Skip invalid type names
          if (process.env.JSONSTORE_DEBUG) {
            console.warn(`Skipping invalid type name: ${entry.name}`);
          }
        }
      }

      return types.sort();
    } catch (err: any) {
      // If root doesn't exist yet, return empty array
      if (err.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Assert that a path contains no symbolic links
   * @param targetPath - Path to check
   * @throws {Error} If path contains symbolic links or escapes root
   */
  private assertNoSymbolicLinks(targetPath: string): void {
    const normalized = path.resolve(targetPath);
    const relative = path.relative(this.#rootPath, normalized);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal detected: resolved path "${normalized}" is outside root "${this.#rootPath}"`
      );
    }

    // Root itself is OK
    if (!relative) {
      return;
    }

    // Check each path component for symlinks
    const segments = relative.split(path.sep);
    let current = this.#rootPath;
    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        const stats = fsSync.lstatSync(current);
        if (stats.isSymbolicLink()) {
          throw new Error(
            `Path traversal detected: component "${current}" is a symbolic link under root "${this.#rootPath}"`
          );
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // Path doesn't exist yet - that's OK
          return;
        }
        throw err;
      }
    }
  }

  /**
<<<<<<< HEAD
   * Store or update a document with hierarchical relationships
   */
  async putHierarchical(
    key: HierarchicalKey,
    doc: Document,
    parentKey?: Key,
    slug?: Slug,
    opts?: WriteOptions
  ): Promise<void> {
    if (!this.#hierarchyManager) {
      throw new Error("Hierarchy support not enabled. Set enableHierarchy: true in StoreOptions.");
    }

    // Validate key and document
    validateKey(key);
    validateDocument(key, doc);

    // If there's a parent, load its document to get the parent path
    let parentPath: MaterializedPath | undefined;
    if (parentKey) {
      const parentDoc = await this.get(parentKey);
      if (!parentDoc) {
        throw new Error(`Parent document not found: ${parentKey.type}/${parentKey.id}`);
      }
      parentPath = (parentDoc as any).path as MaterializedPath | undefined;
    }

    // Compute the materialized path if slug is provided
    if (slug) {
      let computedPath: string;
      if (parentPath) {
        // Compute child path from parent path + slug
        computedPath = `${parentPath}/${slug}`;
      } else {
        // Root level document
        computedPath = `/${slug}`;
      }

      // Validate the path
      const validatedPath = validateMaterializedPath(computedPath);

      // Check depth limit
      const maxDepth = this.#options.experimental?.maxDepth ?? 32;
      validatePathDepth(validatedPath, maxDepth);

      // Assign validated path to document
      (doc as any).path = validatedPath;
    }

    // Get old document for hierarchy updates
    const oldDoc = await this.get(key);

    // Perform regular put operation FIRST to ensure document exists before index
    await this.put(key, doc, opts);

    // Perform hierarchical indexing via HierarchyManager
    // This happens after document write to ensure index never points to non-existent doc
    await this.#hierarchyManager.putHierarchical(key, doc, parentKey, slug, oldDoc ?? undefined);
  }

  /**
   * Resolve entity by scoped slug path
   */
  async getByPath(scope: string, _type: string, slugPath: string): Promise<Document | null> {
    if (!this.#hierarchyManager) {
      throw new Error("Hierarchy support not enabled. Set enableHierarchy: true in StoreOptions.");
    }

    // For now, treat scope+type+slugPath as a materialized path
    // TODO: Implement proper scoped slug resolution
    const path = validateMaterializedPath(`/${scope}/${slugPath}`);

    const entry = await this.#hierarchyManager.getByPath(path);
    if (!entry) {
      return null;
    }

    // Load the actual document
    return await this.get({ type: entry.type, id: entry.id });
  }

  /**
   * List children of a parent with pagination
   */
  async listChildren(_parentKey: Key, _options?: ListChildrenOptions): Promise<Page<Document>> {
    if (!this.#hierarchyManager) {
      throw new Error("Hierarchy support not enabled. Set enableHierarchy: true in StoreOptions.");
    }

    // TODO: Implement children enumeration
    throw new Error("listChildren not yet implemented");
  }

  /**
   * Find document by materialized path
   */
  async findByPath(path: MaterializedPath): Promise<Document | null> {
    if (!this.#hierarchyManager) {
      throw new Error("Hierarchy support not enabled. Set enableHierarchy: true in StoreOptions.");
    }

    const entry = await this.#hierarchyManager.findByPath(path);
    if (!entry) {
      return null;
    }

    // Load the actual document
    return await this.get({ type: entry.type, id: entry.id });
  }

  /**
   * Rebuild hierarchical indexes from primary documents
   */
  async repairHierarchy(type?: string): Promise<RepairReport> {
    if (!this.#hierarchyManager) {
      throw new Error("Hierarchy support not enabled. Set enableHierarchy: true in StoreOptions.");
    }

    const startTime = performance.now();
    const types = type ? [type] : await this.#listTypes();
    const errors: Array<{ path: string; error: string }> = [];
    let documentsScanned = 0;
    let indexesRebuilt = 0;

    // Load all documents
    const allDocs: Document[] = [];
    for (const t of types) {
      try {
        const ids = await this.list(t);
        for (const id of ids) {
          try {
            const doc = await this.get({ type: t, id });
            if (doc) {
              allDocs.push(doc);
              documentsScanned++;
            }
          } catch (err: any) {
            errors.push({ path: `${t}/${id}`, error: err.message });
          }
        }
      } catch (err: any) {
        errors.push({ path: t, error: err.message });
      }
    }

    // Rebuild indexes
    indexesRebuilt = await this.#hierarchyManager.repairHierarchy(allDocs);

    const durationMs = performance.now() - startTime;

    return {
      types,
      documentsScanned,
      indexesRebuilt,
      errors,
      durationMs,
    };
  }

  /**
   * Read markdown content for a specific field
   *
   * @param key - Document key (type and id)
   * @param fieldKey - Field name in the md map
   * @returns Markdown content as string
   * @throws {MarkdownMissingError} if file doesn't exist or isn't referenced
   * @throws {MarkdownIntegrityError} if integrity check fails
   *
   * @example
   * ```typescript
   * const summary = await store.readMarkdown({ type: 'city', id: 'new-york' }, 'summary');
   * console.log(summary);
   * ```
   */
  async readMarkdown(key: Key, fieldKey: string): Promise<string> {
    // Get the document to access markdown references
    const doc = await this.get(key);
    if (!doc) {
      throw new DocumentNotFoundError(this.getFilePath(key));
    }

    return this.readMarkdownField(key, doc, fieldKey);
  }

  /**
   * Write markdown content for a specific field
   *
   * Updates a single markdown file without modifying the JSON document.
   * The document must already have a markdown reference for this field.
   *
   * @param key - Document key (type and id)
   * @param fieldKey - Field name in the md map
   * @param content - Markdown content to write
   * @throws {MarkdownMissingError} if field is not referenced in document
   *
   * @example
   * ```typescript
   * await store.writeMarkdown(
   *   { type: 'city', id: 'new-york' },
   *   'summary',
   *   '# New York City\n\nThe city that never sleeps.'
   * );
   * ```
   */
  async writeMarkdown(key: Key, fieldKey: string, content: string | Buffer): Promise<void> {
    // Get the document to access markdown references
    const doc = await this.get(key);
    if (!doc) {
      throw new DocumentNotFoundError(this.getFilePath(key));
    }

    const mdMap = doc.md as MarkdownMap | undefined;
    if (!mdMap || !(fieldKey in mdMap)) {
      throw new MarkdownMissingError(
        fieldKey,
        `Field "${fieldKey}" is not referenced in document md map`
      );
    }

    const ref = mdMap[fieldKey];
    const docDir = this.getDocumentDir(key);
    const policy = this.getMarkdownPathPolicy();

    // Resolve and validate path
    const { absPath } = resolveMdPath(docDir, ref, policy);

    // Check for symlinks before writing
    await checkSymlink(absPath, policy);

    // Ensure parent directory exists
    const parentDir = path.dirname(absPath);
    await ensureDirectory(parentDir);

    // Re-check for symlinks immediately before write to close TOCTOU window
    // This catches any symlink swaps that happened after the initial check
    await checkSymlink(absPath, policy);

    // Write content atomically
    const contentStr = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    await atomicWrite(absPath, contentStr);
  }

  async close(): Promise<void> {
    // Cleanup resources (file watchers, cache, etc.)
    this.#cache.clear();
  }

  /**
   * Scan documents matching a query spec
   * @param spec - Query specification
   * @yields Documents from disk/cache
   */
  private async *scan(spec: QuerySpec): AsyncIterable<Document> {
    // Determine which types to scan
    const types = spec.type ? [spec.type] : await this.getAllTypes();

    // Scan each type
    for (const type of types) {
      const ids = await this.list(type);

      // Read each document
      for (const id of ids) {
        const doc = await this.get({ type, id });
        if (doc) {
          yield doc;
        }
      }
    }
  }

  /**
   * Get absolute file path for a document key
   * @param key - Document key
   * @returns Normalized absolute file path
   * @throws {Error} If key contains path traversal sequences
   */
  private getFilePath(key: Key): string {
    // Validate key components to prevent path traversal
    if (
      key.type.includes("..") ||
      key.type.includes("/") ||
      key.type.includes("\\") ||
      path.isAbsolute(key.type)
    ) {
      throw new Error(
        `Invalid key.type "${key.type}": must not contain path traversal sequences or separators`
      );
    }
    if (
      key.id.includes("..") ||
      key.id.includes("/") ||
      key.id.includes("\\") ||
      path.isAbsolute(key.id)
    ) {
      throw new Error(
        `Invalid key.id "${key.id}": must not contain path traversal sequences or separators`
      );
    }

    // Build path: root/type/id.json
    const filePath = path.join(this.#rootPath, key.type, `${key.id}.json`);
    const resolvedPath = path.resolve(filePath);

    // Double-check: ensure resolved path is still under root
    const relative = path.relative(this.#rootPath, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Path traversal detected: resolved path "${resolvedPath}" is outside root "${this.#rootPath}"`
      );
    }

    // Ensure no symbolic links in the path
    this.assertNoSymbolicLinks(resolvedPath);

    return resolvedPath.replace(/\\/g, "/");
  }

  /**
   * Commit a file change to git (optional, non-blocking)
   * @param filePath - File path to commit
   * @param message - Commit message
   */
  private async gitCommit(filePath: string, message: string): Promise<void> {
    // Run git commands from the store root directory
    const cwd = this.#options.root;

    try {
      // Add file to staging (handles both additions and removals)
      await execFile("git", ["add", "-A", "--", filePath], { cwd });

      // Commit only this file (--only ensures we don't commit other staged changes)
      await execFile("git", ["commit", "--only", "-m", message, "--", filePath], { cwd });
    } catch (err) {
      // On failure, unstage the file to keep the index clean
      try {
        await execFile("git", ["reset", "--", filePath], { cwd });
      } catch {
        // Ignore reset errors
      }
      throw err;
    }
  }

  /**
   * Get the directory path for a document (Layout 1: subfolder-per-object)
   * @param key - Document key
   * @returns Absolute path to document directory
   */
  private getDocumentDir(key: Key): string {
    return path.join(this.#rootPath, key.type, key.id);
  }

  /**
   * Create path policy for markdown validation
   * @returns PathPolicy with allowed roots
   */
  private getMarkdownPathPolicy(): PathPolicy {
    return {
      allowedRoots: [this.#rootPath],
      allowSymlinks: false,
    };
  }

  /**
   * Read markdown content for a document field
   * @param key - Document key
   * @param doc - Document containing markdown references
   * @param fieldKey - Field name in the md map
   * @returns Markdown content as string
   * @throws {MarkdownMissingError} if file doesn't exist
   * @throws {MarkdownIntegrityError} if integrity check fails
   */
  private async readMarkdownField(key: Key, doc: Document, fieldKey: string): Promise<string> {
    const mdMap = doc.md as MarkdownMap | undefined;
    if (!mdMap || !(fieldKey in mdMap)) {
      throw new MarkdownMissingError(fieldKey, "not referenced in document");
    }

    const ref = mdMap[fieldKey];
    const docDir = this.getDocumentDir(key);
    const policy = this.getMarkdownPathPolicy();

    // Resolve path
    const { absPath } = resolveMdPath(docDir, ref, policy);

    // Check for symlinks
    await checkSymlink(absPath, policy);

    // Read content
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new MarkdownMissingError(fieldKey, absPath, { cause: err });
      }
      throw new DocumentReadError(absPath, { cause: err });
    }

    // Verify integrity if sha256 is present
    if (typeof ref === "object" && ref.sha256) {
      await verifyIntegrity(absPath, ref.sha256);
    }

    return content;
  }

  /**
   * Read all markdown fields for a document
   * @param key - Document key
   * @param doc - Document containing markdown references
   * @returns Map of field names to markdown content
   */
  private async readMarkdownFields(key: Key, doc: Document): Promise<Record<string, string>> {
    const mdMap = doc.md as MarkdownMap | undefined;
    if (!mdMap) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const fieldKey of Object.keys(mdMap)) {
      result[fieldKey] = await this.readMarkdownField(key, doc, fieldKey);
    }
    return result;
  }

  /**
   * Write markdown files using a directory transaction (Layout 1)
   * @param key - Document key
   * @param doc - Document with markdown references
   * @param markdown - Map of field names to markdown content
   */
  private async writeMarkdownWithTransaction(
    key: Key,
    doc: Document,
    markdown: Record<string, string | Buffer>
  ): Promise<void> {
    const docDir = this.getDocumentDir(key);
    const policy = this.getMarkdownPathPolicy();

    // Validate all markdown paths and preserve untouched fields
    const mdMap = doc.md as MarkdownMap | undefined;
    const preservedMarkdown = new Map<string, string>();
    const resolvedPaths = new Map<string, string>();

    if (mdMap) {
      for (const [fieldKey, ref] of Object.entries(mdMap)) {
        // Validate and resolve path
        const { relPath, absPath } = resolveMdPath(docDir, ref, policy);
        resolvedPaths.set(fieldKey, relPath);

        // Check for symlinks in target path (before transaction)
        // This prevents writing through symlinked directories
        await checkSymlink(absPath, policy);

        // If markdown not provided, read existing content to preserve it
        if (markdown[fieldKey] === undefined) {
          try {
            const existingContent = await this.readMarkdownField(key, doc, fieldKey);
            preservedMarkdown.set(fieldKey, existingContent);
          } catch (err) {
            // If file doesn't exist yet, that's okay for new documents
            // But rethrow other errors
            if (!(err instanceof MarkdownMissingError)) {
              throw err;
            }
          }
        }
      }
    }

    // Create transaction with pre-commit validation to reduce TOCTOU window
    const txn = new DirTransaction(docDir, {
      preCommitValidation: async () => {
        // Re-validate all markdown paths immediately before commit
        // This catches any symlink/hardlink swaps that happened after initial validation
        if (mdMap) {
          for (const [_fieldKey, ref] of Object.entries(mdMap)) {
            const { absPath } = resolveMdPath(docDir, ref, policy);
            await checkSymlink(absPath, policy);
          }
        }
      },
    });

    try {
      // Write JSON file
      const content = stableStringify(doc, this.#options.indent, this.#options.stableKeyOrder);
      await txn.writeFile(`${key.id}.json`, content);

      // Write markdown files based on references in doc.md
      if (mdMap) {
        for (const [fieldKey] of Object.entries(mdMap)) {
          const mdContent = markdown[fieldKey] ?? preservedMarkdown.get(fieldKey);
          if (mdContent === undefined) {
            throw new MarkdownMissingError(fieldKey, resolvedPaths.get(fieldKey) || "");
          }
          await txn.writeFile(resolvedPaths.get(fieldKey)!, mdContent);
        }
      }

      // Commit transaction (runs pre-commit validation)
      await txn.commit();

      // Invalidate cache for both flat and layout 1 paths
      const flatFilePath = this.getFilePath(key);
      this.#cache.delete(flatFilePath);
      const layout1FilePath = path.join(docDir, `${key.id}.json`);
      this.#cache.delete(layout1FilePath);
    } catch (err) {
      await txn.abort();
      throw err;
    }
  }
}

/**
 * Open a JSON Store instance
 *
 * Creates a new store instance with the specified configuration.
 * The store provides CRUD operations, Mango queries, optional indexes, and Git integration.
 *
 * @param options - Store configuration options
 * @param options.root - Root directory for data storage (required)
 * @param options.indent - JSON indentation spaces (default: 2)
 * @param options.stableKeyOrder - Key ordering: 'alpha' or array of keys (default: 'alpha')
 * @param options.watch - Enable file watching for cache invalidation (default: false)
 * @param options.enableIndexes - Enable equality indexes (default: false)
 * @param options.indexes - Field indexes per type: { type: [field1, field2] }
 * @param options.formatConcurrency - Max concurrency for format operations (default: 16, range: 1-64)
 * @returns Store instance ready for operations
 *
 * @example
 * ```typescript
 * // Basic store with defaults
 * const store = openStore({ root: './data' });
 *
 * // Store with custom formatting and indexes
 * const store = openStore({
 *   root: './data',
 *   indent: 2,
 *   stableKeyOrder: 'alpha',
 *   enableIndexes: true,
 *   indexes: {
 *     task: ['status', 'priority'],
 *     user: ['email']
 *   }
 * });
 * ```
 */
export function openStore(options: StoreOptions): Store {
  return new JSONStore(options);
}
