/**
 * Test file for links-queue
 * Works with Node.js, Bun, and Deno via test-anywhere
 */

import { describe, it, expect } from 'test-anywhere';
import {
  add,
  multiply,
  Any,
  isLink,
  isLinkId,
  isLinkRef,
  getLinkId,
  createLink,
  matchesPattern,
} from '../src/index.js';

// =============================================================================
// Link and LinkRef Tests
// =============================================================================

describe('Link creation', () => {
  it('should create a simple link with createLink', () => {
    const link = createLink(1, 2, 3);
    expect(link.id).toBe(1);
    expect(link.source).toBe(2);
    expect(link.target).toBe(3);
  });

  it('should create a link with bigint IDs', () => {
    const link = createLink(1n, 2n, 3n);
    expect(link.id).toBe(1n);
    expect(link.source).toBe(2n);
    expect(link.target).toBe(3n);
  });

  it('should create a link with string IDs', () => {
    const link = createLink('link-1', 'source-id', 'target-id');
    expect(link.id).toBe('link-1');
    expect(link.source).toBe('source-id');
    expect(link.target).toBe('target-id');
  });

  it('should create a link with nested link as source', () => {
    const inner = createLink(2, 3, 4);
    const outer = createLink(1, inner, 5);
    expect(outer.id).toBe(1);
    expect(outer.source).toEqual(inner);
    expect(outer.target).toBe(5);
  });

  it('should create a universal link with values', () => {
    const link = createLink(1, 2, 3, [4, 5, 6]);
    expect(link.id).toBe(1);
    expect(link.source).toBe(2);
    expect(link.target).toBe(3);
    expect(link.values).toEqual([4, 5, 6]);
  });

  it('should not include values property if values array is empty', () => {
    const link = createLink(1, 2, 3, []);
    expect(link.values).toBeUndefined();
  });

  it('should freeze the created link', () => {
    const link = createLink(1, 2, 3);
    expect(Object.isFrozen(link)).toBe(true);
  });
});

describe('Deeply nested links', () => {
  it('should support arbitrary nesting levels', () => {
    const level3 = createLink(3, 30, 31);
    const level2 = createLink(2, level3, 21);
    const level1 = createLink(1, level2, 11);

    expect(level1.id).toBe(1);
    expect(level1.source.id).toBe(2);
    expect(level1.source.source.id).toBe(3);
    expect(level1.source.source.source).toBe(30);
    expect(level1.source.source.target).toBe(31);
  });
});

// =============================================================================
// Type Check Functions Tests
// =============================================================================

describe('isLink', () => {
  it('should return true for valid Link objects', () => {
    expect(isLink({ id: 1, source: 2, target: 3 })).toBe(true);
    expect(isLink(createLink(1, 2, 3))).toBe(true);
  });

  it('should return false for non-Link values', () => {
    expect(isLink(null)).toBe(false);
    expect(isLink(undefined)).toBe(false);
    expect(isLink(42)).toBe(false);
    expect(isLink('link')).toBe(false);
    expect(isLink({})).toBe(false);
    expect(isLink({ id: 1 })).toBe(false);
    expect(isLink({ id: 1, source: 2 })).toBe(false);
  });
});

describe('isLinkId', () => {
  it('should return true for valid LinkId types', () => {
    expect(isLinkId(42)).toBe(true);
    expect(isLinkId(0)).toBe(true);
    expect(isLinkId(-1)).toBe(true);
    expect(isLinkId(9007199254740993n)).toBe(true);
    expect(isLinkId('uuid-here')).toBe(true);
    expect(isLinkId('')).toBe(true);
  });

  it('should return false for non-LinkId values', () => {
    expect(isLinkId(null)).toBe(false);
    expect(isLinkId(undefined)).toBe(false);
    expect(isLinkId({})).toBe(false);
    expect(isLinkId([])).toBe(false);
    expect(isLinkId(Symbol('test'))).toBe(false);
  });
});

describe('isLinkRef', () => {
  it('should return true for LinkId values', () => {
    expect(isLinkRef(42)).toBe(true);
    expect(isLinkRef(1n)).toBe(true);
    expect(isLinkRef('id')).toBe(true);
  });

  it('should return true for Link objects', () => {
    expect(isLinkRef({ id: 1, source: 2, target: 3 })).toBe(true);
    expect(isLinkRef(createLink(1, 2, 3))).toBe(true);
  });

  it('should return false for invalid values', () => {
    expect(isLinkRef(null)).toBe(false);
    expect(isLinkRef({})).toBe(false);
  });
});

describe('getLinkId', () => {
  it('should return the ID directly for LinkId values', () => {
    expect(getLinkId(42)).toBe(42);
    expect(getLinkId(1n)).toBe(1n);
    expect(getLinkId('uuid')).toBe('uuid');
  });

  it('should extract ID from Link objects', () => {
    const link = createLink(99, 2, 3);
    expect(getLinkId(link)).toBe(99);
  });

  it('should extract ID from nested Link objects', () => {
    const inner = createLink(10, 20, 30);
    expect(getLinkId(inner)).toBe(10);
  });
});

// =============================================================================
// Pattern Matching Tests
// =============================================================================

describe('matchesPattern', () => {
  const link = createLink(1, 5, 10);

  it('should match when pattern is empty', () => {
    expect(matchesPattern(link, {})).toBe(true);
  });

  it('should match by id', () => {
    expect(matchesPattern(link, { id: 1 })).toBe(true);
    expect(matchesPattern(link, { id: 2 })).toBe(false);
  });

  it('should match by source', () => {
    expect(matchesPattern(link, { source: 5 })).toBe(true);
    expect(matchesPattern(link, { source: 99 })).toBe(false);
  });

  it('should match by target', () => {
    expect(matchesPattern(link, { target: 10 })).toBe(true);
    expect(matchesPattern(link, { target: 99 })).toBe(false);
  });

  it('should match multiple fields', () => {
    expect(matchesPattern(link, { source: 5, target: 10 })).toBe(true);
    expect(matchesPattern(link, { source: 5, target: 99 })).toBe(false);
    expect(matchesPattern(link, { id: 1, source: 5, target: 10 })).toBe(true);
  });

  it('should match Any wildcard for source', () => {
    expect(matchesPattern(link, { source: Any })).toBe(true);
    expect(matchesPattern(link, { source: Any, target: 10 })).toBe(true);
    expect(matchesPattern(link, { source: Any, target: 99 })).toBe(false);
  });

  it('should match Any wildcard for target', () => {
    expect(matchesPattern(link, { target: Any })).toBe(true);
    expect(matchesPattern(link, { source: 5, target: Any })).toBe(true);
    expect(matchesPattern(link, { source: 99, target: Any })).toBe(false);
  });

  it('should match Any wildcard for id', () => {
    expect(matchesPattern(link, { id: Any })).toBe(true);
    expect(matchesPattern(link, { id: Any, source: 5 })).toBe(true);
  });

  it('should match all with Any wildcards', () => {
    expect(matchesPattern(link, { id: Any, source: Any, target: Any })).toBe(
      true
    );
  });

  it('should match nested link reference by ID', () => {
    const inner = createLink(5, 50, 51);
    const outer = createLink(1, inner, 10);

    // Pattern matches source by extracting its ID
    expect(matchesPattern(outer, { source: 5 })).toBe(true);
    expect(matchesPattern(outer, { source: inner })).toBe(true);
  });
});

// =============================================================================
// Any Symbol Tests
// =============================================================================

describe('Any symbol', () => {
  it('should be a unique symbol', () => {
    expect(typeof Any).toBe('symbol');
    expect(Any.toString()).toBe('Symbol(Any)');
  });

  it('should be referentially equal to itself', () => {
    expect(Any === Any).toBe(true);
  });
});

// =============================================================================
// Backward Compatibility Tests (deprecated functions)
// =============================================================================

describe('add function (deprecated)', () => {
  it('should add two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('should add negative numbers', () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it('should add zero', () => {
    expect(add(5, 0)).toBe(5);
  });
});

describe('multiply function (deprecated)', () => {
  it('should multiply two positive numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  it('should multiply by zero', () => {
    expect(multiply(5, 0)).toBe(0);
  });

  it('should multiply negative numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
  });
});
