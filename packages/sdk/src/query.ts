/**
 * Mango query evaluation engine
 */

import type { Filter, Document, Projection, Sort } from "./types.js";

/**
 * Get a nested value from an object using dot-path notation
 * @param obj - Object to get value from
 * @param path - Dot-separated path (e.g., "address.city")
 * @returns Value at path, or undefined if not found
 */
export function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Evaluate a field-level condition
 * @param val - Actual field value
 * @param cond - Condition to test (operator object or literal value)
 * @returns true if condition matches
 */
function matchField(val: any, cond: any): boolean {
  // If condition is an operator object
  if (cond && typeof cond === "object" && !Array.isArray(cond)) {
    for (const [op, rhs] of Object.entries(cond)) {
      switch (op) {
        case "$eq":
          // Special handling for array fields: check if rhs is contained in array
          if (Array.isArray(val)) {
            if (!val.includes(rhs)) return false;
          } else {
            if (!(val === rhs)) return false;
          }
          break;
        case "$ne":
          if (!(val !== rhs)) return false;
          break;
        case "$in":
          if (!Array.isArray(rhs) || !rhs.includes(val)) return false;
          break;
        case "$nin":
          if (!Array.isArray(rhs) || rhs.includes(val)) return false;
          break;
        case "$gt":
          if (!(val > (rhs as any))) return false;
          break;
        case "$gte":
          if (!(val >= (rhs as any))) return false;
          break;
        case "$lt":
          if (!(val < (rhs as any))) return false;
          break;
        case "$lte":
          if (!(val <= (rhs as any))) return false;
          break;
        case "$exists": {
          const exists = val !== undefined;
          if (exists !== rhs) return false;
          break;
        }
        case "$type": {
          const actualType = Array.isArray(val) ? "array" : typeof val;
          if (actualType !== rhs) return false;
          break;
        }
        default:
          throw new Error(`Unknown operator: ${op}`);
      }
    }
    return true;
  }

  // Direct equality
  // Special handling for array fields: check if cond is contained in array
  if (Array.isArray(val)) {
    return val.includes(cond);
  }
  return val === cond;
}

/**
 * Test if a document matches a Mango filter
 * @param doc - Document to test
 * @param filter - Mango filter object
 * @returns true if document matches filter
 */
export function matches(doc: Document, filter: Filter): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  for (const [key, value] of Object.entries(filter)) {
    if (key === "$and") {
      if (!Array.isArray(value)) {
        throw new Error("$and operator requires an array of filters");
      }
      if (!value.every((f) => matches(doc, f))) {
        return false;
      }
      continue;
    }

    if (key === "$or") {
      if (!Array.isArray(value)) {
        throw new Error("$or operator requires an array of filters");
      }
      if (!value.some((f) => matches(doc, f))) {
        return false;
      }
      continue;
    }

    if (key === "$not") {
      if (matches(doc, value as Filter)) {
        return false;
      }
      continue;
    }

    const docValue = getPath(doc, key);
    if (!matchField(docValue, value)) {
      return false;
    }
  }

  return true;
}

/**
 * Apply projection to a document
 * @param doc - Document to project
 * @param projection - Projection spec (1 = include, 0 = exclude)
 * @returns Projected document
 */
export function project(doc: Document, projection?: Projection): Document {
  if (!projection || Object.keys(projection).length === 0) {
    return doc;
  }

  const includeFields = Object.entries(projection)
    .filter(([, v]) => v === 1)
    .map(([k]) => k);

  if (includeFields.length === 0) {
    // Exclusion mode (not commonly used, but supported)
    const excludeFields = Object.entries(projection)
      .filter(([, v]) => v === 0)
      .map(([k]) => k);
    const result = { ...doc };
    for (const field of excludeFields) {
      delete result[field];
    }
    return result;
  }

  // Inclusion mode
  const result: any = {};
  for (const field of includeFields) {
    if (field.includes(".")) {
      // Nested field projection - simplified for MVP
      const value = getPath(doc, field);
      if (value !== undefined) {
        result[field] = value;
      }
    } else {
      if (doc[field] !== undefined) {
        result[field] = doc[field];
      }
    }
  }
  return result as Document;
}

/**
 * Compare two values for sorting
 * Handles mixed types by type precedence
 * @param a - First value
 * @param b - Second value
 * @returns -1, 0, or 1
 */
function compareValues(a: any, b: any): number {
  // Handle undefined/null
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  // Same type comparison
  const typeA = typeof a;
  const typeB = typeof b;

  if (typeA === typeB) {
    if (typeA === "number" || typeA === "string") {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeA === "boolean") {
      return a === b ? 0 : a ? 1 : -1;
    }
  }

  // Mixed types - use type precedence: null < boolean < number < string < object
  const typePrecedence: Record<string, number> = {
    undefined: 0,
    boolean: 1,
    number: 2,
    string: 3,
    object: 4,
  };

  return (typePrecedence[typeA] ?? 5) - (typePrecedence[typeB] ?? 5);
}

/**
 * Sort documents according to sort specification
 * @param docs - Documents to sort (mutates array)
 * @param sort - Sort specification
 */
export function sortDocuments(docs: Document[], sort?: Sort): void {
  if (!sort || Object.keys(sort).length === 0) {
    return;
  }

  const sortFields = Object.entries(sort);

  docs.sort((a, b) => {
    for (const [field, direction] of sortFields) {
      const aVal = getPath(a, field);
      const bVal = getPath(b, field);
      const cmp = compareValues(aVal, bVal);

      if (cmp !== 0) {
        return direction === 1 ? cmp : -cmp;
      }
    }
    return 0;
  });
}

/**
 * Apply pagination to documents
 * @param docs - Documents to paginate
 * @param skip - Number to skip (default: 0)
 * @param limit - Maximum to return (default: unlimited)
 * @returns Paginated slice
 */
export function paginate(docs: Document[], skip = 0, limit?: number): Document[] {
  const start = skip;
  const end = limit !== undefined ? start + limit : undefined;
  return docs.slice(start, end);
}

/**
 * Evaluate a complete query against an array of documents
 * Pure orchestrator that composes filter → sort → paginate → project
 * @param docs - Documents to evaluate
 * @param spec - Query specification
 * @returns Filtered, sorted, paginated, and projected documents
 */
export function evaluateQuery(
  docs: Document[],
  spec: { filter: Filter; sort?: Sort; skip?: number; limit?: number; projection?: Projection }
): Document[] {
  // 1. Filter
  const filtered = docs.filter((d) => matches(d, spec.filter));

  // 2. Sort (if specified)
  if (spec.sort && Object.keys(spec.sort).length > 0) {
    sortDocuments(filtered, spec.sort);
  }

  // 3. Paginate
  const sliced = paginate(filtered, spec.skip ?? 0, spec.limit);

  // 4. Project (last to minimize work and keep sorting stable)
  return spec.projection ? sliced.map((d) => project(d, spec.projection)) : sliced;
}
