import { describe, it, expect } from "vitest";
import { matches, getPath, project, sortDocuments } from "./query.js";
import type { Document } from "./types.js";

describe("getPath", () => {
  it("should get top-level property", () => {
    const obj = { name: "test" };
    expect(getPath(obj, "name")).toBe("test");
  });

  it("should get nested property", () => {
    const obj = { user: { name: "Alice" } };
    expect(getPath(obj, "user.name")).toBe("Alice");
  });

  it("should return undefined for missing path", () => {
    const obj = { name: "test" };
    expect(getPath(obj, "user.name")).toBeUndefined();
  });
});

describe("matches", () => {
  const doc: Document = {
    type: "task",
    id: "1",
    title: "Test task",
    status: "open",
    priority: 5,
  };

  it("should match $eq operator", () => {
    expect(matches(doc, { status: { $eq: "open" } })).toBe(true);
    expect(matches(doc, { status: { $eq: "closed" } })).toBe(false);
  });

  it("should match $ne operator", () => {
    expect(matches(doc, { status: { $ne: "closed" } })).toBe(true);
    expect(matches(doc, { status: { $ne: "open" } })).toBe(false);
  });

  it("should match $in operator", () => {
    expect(matches(doc, { status: { $in: ["open", "ready"] } })).toBe(true);
    expect(matches(doc, { status: { $in: ["closed", "done"] } })).toBe(false);
  });

  it("should match $gt and $gte operators", () => {
    expect(matches(doc, { priority: { $gt: 4 } })).toBe(true);
    expect(matches(doc, { priority: { $gte: 5 } })).toBe(true);
    expect(matches(doc, { priority: { $gt: 5 } })).toBe(false);
  });

  it("should match $and operator", () => {
    expect(
      matches(doc, {
        $and: [{ status: { $eq: "open" } }, { priority: { $gte: 5 } }],
      })
    ).toBe(true);
  });

  it("should match $or operator", () => {
    expect(
      matches(doc, {
        $or: [{ status: { $eq: "closed" } }, { priority: { $gte: 5 } }],
      })
    ).toBe(true);
  });

  it("should match $not operator", () => {
    expect(matches(doc, { $not: { status: { $eq: "closed" } } })).toBe(true);
  });
});

describe("project", () => {
  const doc: Document = {
    type: "task",
    id: "1",
    title: "Test",
    status: "open",
    priority: 5,
  };

  it("should include only specified fields", () => {
    const result = project(doc, { id: 1, title: 1 });
    expect(result).toEqual({ id: "1", title: "Test" });
  });

  it("should return full document if no projection", () => {
    const result = project(doc);
    expect(result).toEqual(doc);
  });
});

describe("sortDocuments", () => {
  const docs: Document[] = [
    { type: "task", id: "1", priority: 3, title: "C" },
    { type: "task", id: "2", priority: 1, title: "A" },
    { type: "task", id: "3", priority: 2, title: "B" },
  ];

  it("should sort ascending by field", () => {
    const sorted = [...docs];
    sortDocuments(sorted, { priority: 1 });
    expect(sorted.map((d) => d.priority)).toEqual([1, 2, 3]);
  });

  it("should sort descending by field", () => {
    const sorted = [...docs];
    sortDocuments(sorted, { priority: -1 });
    expect(sorted.map((d) => d.priority)).toEqual([3, 2, 1]);
  });

  it("should sort by multiple fields", () => {
    const multiDocs: Document[] = [
      { type: "task", id: "1", priority: 2, title: "B" },
      { type: "task", id: "2", priority: 1, title: "A" },
      { type: "task", id: "3", priority: 2, title: "A" },
    ];
    sortDocuments(multiDocs, { priority: 1, title: 1 });
    expect(multiDocs[0].id).toBe("2"); // priority 1
    expect(multiDocs[1].id).toBe("3"); // priority 2, title A
    expect(multiDocs[2].id).toBe("1"); // priority 2, title B
  });
});
