/**
 * Unit tests for Zod schemas
 */

import { describe, it, expect } from "vitest";
import {
  KeySchema,
  DocumentSchema,
  ProjectionSchema,
  SortSchema,
  QuerySpecSchema,
  GetDocInputSchema,
  PutDocInputSchema,
  RemoveDocInputSchema,
  ListIdsInputSchema,
  QueryInputSchema,
  EnsureIndexInputSchema,
} from "../../schemas.js";

describe("KeySchema", () => {
  it("should accept valid keys", () => {
    expect(() => KeySchema.parse({ type: "task", id: "123" })).not.toThrow();
    expect(() => KeySchema.parse({ type: "my-type", id: "my-id_123" })).not.toThrow();
  });

  it("should reject invalid type (uppercase)", () => {
    expect(() => KeySchema.parse({ type: "Task", id: "123" })).toThrow();
  });

  it("should reject invalid id (with spaces)", () => {
    expect(() => KeySchema.parse({ type: "task", id: "my id" })).toThrow();
  });

  it("should reject empty strings", () => {
    expect(() => KeySchema.parse({ type: "", id: "123" })).toThrow();
    expect(() => KeySchema.parse({ type: "task", id: "" })).toThrow();
  });

  it("should reject path traversal patterns", () => {
    expect(() => KeySchema.parse({ type: "../etc", id: "123" })).toThrow(/type/);
    expect(() => KeySchema.parse({ type: "..", id: "123" })).toThrow(/type/);
    expect(() => KeySchema.parse({ type: "task", id: "/etc/passwd" })).toThrow(/id/);
    expect(() => KeySchema.parse({ type: "task", id: ".." })).toThrow(/id/);
    expect(() => KeySchema.parse({ type: ".hidden", id: "123" })).toThrow(/type/);
  });

  it("should reject keys starting or ending with separators", () => {
    expect(() => KeySchema.parse({ type: "-task", id: "123" })).toThrow(/type/);
    expect(() => KeySchema.parse({ type: "task-", id: "123" })).toThrow(/type/);
    expect(() => KeySchema.parse({ type: "task", id: "-123" })).toThrow(/id/);
  });
});

describe("DocumentSchema", () => {
  it("should accept valid documents", () => {
    expect(() =>
      DocumentSchema.parse({ type: "task", id: "123", title: "Test" })
    ).not.toThrow();
  });

  it("should reject documents without type", () => {
    expect(() => DocumentSchema.parse({ id: "123", title: "Test" })).toThrow();
  });

  it("should reject documents without id", () => {
    expect(() => DocumentSchema.parse({ type: "task", title: "Test" })).toThrow();
  });

  it("should reject documents with empty type or id", () => {
    expect(() => DocumentSchema.parse({ type: "", id: "123" })).toThrow(/type/);
    expect(() => DocumentSchema.parse({ type: "task", id: "" })).toThrow(/id/);
  });

  it("should reject documents with invalid key patterns", () => {
    expect(() => DocumentSchema.parse({ type: "../etc", id: "123" })).toThrow(/type/);
    expect(() => DocumentSchema.parse({ type: "task", id: "/etc/passwd" })).toThrow(/id/);
    expect(() => DocumentSchema.parse({ type: "Task", id: "123" })).toThrow(/type/);
  });
});

describe("ProjectionSchema", () => {
  it("should accept valid projections", () => {
    expect(() => ProjectionSchema.parse({ title: 1, status: 1 })).not.toThrow();
    expect(() => ProjectionSchema.parse({ password: 0, secret: 0 })).not.toThrow();
    expect(() => ProjectionSchema.parse({})).not.toThrow();
  });

  it("should reject mixed 0 and 1 projections", () => {
    expect(() => ProjectionSchema.parse({ title: 1, password: 0 })).toThrow(/cannot mix/);
  });
});

describe("SortSchema", () => {
  it("should accept valid sort specifications", () => {
    expect(() => SortSchema.parse({ title: 1 })).not.toThrow();
    expect(() => SortSchema.parse({ createdAt: -1 })).not.toThrow();
    expect(() => SortSchema.parse({ title: 1, createdAt: -1 })).not.toThrow();
  });

  it("should reject invalid sort values", () => {
    expect(() => SortSchema.parse({ title: 0 })).toThrow();
    expect(() => SortSchema.parse({ title: 2 })).toThrow();
  });
});

describe("QuerySpecSchema", () => {
  it("should accept valid query specs with defaults", () => {
    const result = QuerySpecSchema.parse({ filter: { type: "task" } });
    expect(result.limit).toBe(100);
    expect(result.skip).toBe(0);
  });

  it("should accept custom limit and skip", () => {
    const result = QuerySpecSchema.parse({
      filter: { type: "task" },
      limit: 50,
      skip: 10,
    });
    expect(result.limit).toBe(50);
    expect(result.skip).toBe(10);
  });

  it("should reject limit > 1000", () => {
    expect(() =>
      QuerySpecSchema.parse({ filter: { type: "task" }, limit: 1001 })
    ).toThrow(/cannot exceed 1000/);
  });

  it("should reject skip > 10000", () => {
    expect(() =>
      QuerySpecSchema.parse({ filter: { type: "task" }, skip: 10001 })
    ).toThrow(/cannot exceed 10000/);
  });

  it("should reject negative limit", () => {
    expect(() =>
      QuerySpecSchema.parse({ filter: { type: "task" }, limit: -1 })
    ).toThrow();
  });

  it("should reject negative skip", () => {
    expect(() =>
      QuerySpecSchema.parse({ filter: { type: "task" }, skip: -1 })
    ).toThrow();
  });

  it("should enforce limit/skip boundaries", () => {
    expect(() => QuerySpecSchema.parse({ filter: {}, limit: 0 })).toThrow();
    expect(() => QuerySpecSchema.parse({ filter: {}, limit: 1000, skip: 10000 })).not.toThrow();
  });

  it("should reject path traversal in type", () => {
    expect(() => QuerySpecSchema.parse({ filter: {}, type: "../etc" })).toThrow(/type/);
    expect(() => QuerySpecSchema.parse({ filter: {}, type: ".." })).toThrow(/type/);
  });
});

describe("Tool input schemas", () => {
  describe("GetDocInputSchema", () => {
    it("should accept valid input", () => {
      expect(() => GetDocInputSchema.parse({ type: "task", id: "123" })).not.toThrow();
    });

    it("should reject missing fields", () => {
      expect(() => GetDocInputSchema.parse({ type: "task" })).toThrow();
      expect(() => GetDocInputSchema.parse({ id: "123" })).toThrow();
    });

    it("should reject path traversal", () => {
      expect(() => GetDocInputSchema.parse({ type: "../etc", id: "123" })).toThrow(/type/);
      expect(() => GetDocInputSchema.parse({ type: "task", id: "/evil" })).toThrow(/id/);
    });
  });

  describe("PutDocInputSchema", () => {
    it("should accept valid input without commit", () => {
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "123",
          doc: { type: "task", id: "123", title: "Test" },
        })
      ).not.toThrow();
    });

    it("should accept valid input with commit", () => {
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "123",
          doc: { type: "task", id: "123", title: "Test" },
          commit: { message: "Add task" },
        })
      ).not.toThrow();
    });

    it("should reject missing doc", () => {
      expect(() => PutDocInputSchema.parse({ type: "task", id: "123" })).toThrow();
    });

    it("should reject path traversal in type/id", () => {
      expect(() =>
        PutDocInputSchema.parse({
          type: "../etc",
          id: "123",
          doc: { type: "task", id: "123" },
        })
      ).toThrow(/type/);
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "/evil",
          doc: { type: "task", id: "123" },
        })
      ).toThrow(/id/);
    });

    it("should reject invalid document key fields", () => {
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "123",
          doc: { type: "../etc", id: "123" },
        })
      ).toThrow(/Document/);
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "123",
          doc: { type: "task", id: "/evil" },
        })
      ).toThrow(/Document/);
    });

    it("should reject empty commit message", () => {
      expect(() =>
        PutDocInputSchema.parse({
          type: "task",
          id: "123",
          doc: { type: "task", id: "123" },
          commit: { message: "" },
        })
      ).toThrow(/commit message/);
    });
  });

  describe("RemoveDocInputSchema", () => {
    it("should accept valid input", () => {
      expect(() => RemoveDocInputSchema.parse({ type: "task", id: "123" })).not.toThrow();
    });

    it("should reject path traversal", () => {
      expect(() => RemoveDocInputSchema.parse({ type: "../etc", id: "123" })).toThrow(/type/);
      expect(() => RemoveDocInputSchema.parse({ type: "task", id: "/evil" })).toThrow(/id/);
    });
  });

  describe("ListIdsInputSchema", () => {
    it("should accept valid input", () => {
      expect(() => ListIdsInputSchema.parse({ type: "task" })).not.toThrow();
    });

    it("should reject missing type", () => {
      expect(() => ListIdsInputSchema.parse({})).toThrow();
    });

    it("should reject path traversal in type", () => {
      expect(() => ListIdsInputSchema.parse({ type: ".hidden" })).toThrow(/type/);
      expect(() => ListIdsInputSchema.parse({ type: "../etc" })).toThrow(/type/);
    });
  });

  describe("QueryInputSchema", () => {
    it("should accept minimal query", () => {
      expect(() => QueryInputSchema.parse({ filter: {} })).not.toThrow();
    });

    it("should accept full query spec", () => {
      expect(() =>
        QueryInputSchema.parse({
          type: "task",
          filter: { status: "open" },
          projection: { title: 1 },
          sort: { createdAt: -1 },
          limit: 50,
          skip: 0,
        })
      ).not.toThrow();
    });

    it("should reject missing filter", () => {
      expect(() => QueryInputSchema.parse({})).toThrow();
    });

    it("should reject path traversal in type", () => {
      expect(() => QueryInputSchema.parse({ filter: {}, type: "../etc" })).toThrow(/type/);
    });
  });

  describe("EnsureIndexInputSchema", () => {
    it("should accept valid input", () => {
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "task", field: "status" })
      ).not.toThrow();
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "task", field: "nested.field" })
      ).not.toThrow();
    });

    it("should reject invalid field names", () => {
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "task", field: "field with spaces" })
      ).toThrow();
    });

    it("should reject empty field", () => {
      expect(() => EnsureIndexInputSchema.parse({ type: "task", field: "" })).toThrow();
    });

    it("should reject path traversal in type", () => {
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "../etc", field: "status" })
      ).toThrow(/type/);
    });

    it("should reject path traversal in field", () => {
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "task", field: "../path" })
      ).toThrow();
      expect(() =>
        EnsureIndexInputSchema.parse({ type: "task", field: "/leadingSlash" })
      ).toThrow();
    });
  });
});
