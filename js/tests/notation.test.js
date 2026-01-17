/**
 * Unit tests for Links Notation integration.
 *
 * Tests the parsing and serialization of Links Notation strings.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LinksNotation,
  NotationParser,
  NotationStreamParser,
  NotationParseError,
} from '../src/protocol/notation.js';

describe('LinksNotation', () => {
  describe('parse', () => {
    it('should parse a simple reference', () => {
      const links = LinksNotation.parse('hello');
      assert.equal(links.length, 1);
      assert.equal(links[0].source, 'hello');
      assert.equal(links[0].target, 'hello');
    });

    it('should parse a link with id and value', () => {
      const links = LinksNotation.parse('(type: enqueue)');
      assert.equal(links.length, 1);
      assert.equal(links[0].source, 'type');
      assert.equal(links[0].target, 'enqueue');
    });

    it('should parse space-separated values as a link', () => {
      // In links-notation, "hello world" forms a single link with source=hello, target=world
      const links = LinksNotation.parse('hello world');
      assert.equal(links.length, 1);
      assert.equal(links[0].source, 'hello');
      assert.equal(links[0].target, 'world');
    });

    it('should parse parenthesized links', () => {
      // (hello) (world) forms a single link containing two nested self-referencing links
      const links = LinksNotation.parse('(hello) (world)');
      assert.equal(links.length, 1);
      // The source and target are nested Link objects
      assert.ok(typeof links[0].source === 'object');
      assert.ok(typeof links[0].target === 'object');
    });

    it('should parse links with multiple values', () => {
      const links = LinksNotation.parse('(id: value1 value2)');
      assert.equal(links.length, 1);
      // The first two values become source/target
      assert.equal(links[0].source, 'value1');
      assert.equal(links[0].target, 'value2');
    });

    it('should handle nested structures', () => {
      const links = LinksNotation.parse('((hello world))');
      assert.equal(links.length, 1);
    });

    it('should throw NotationParseError on invalid input', () => {
      assert.throws(
        () => LinksNotation.parse('((unclosed'),
        (err) => err instanceof NotationParseError
      );
    });

    it('should throw TypeError on non-string input', () => {
      assert.throws(() => LinksNotation.parse(123), TypeError);
      assert.throws(() => LinksNotation.parse(null), TypeError);
      assert.throws(() => LinksNotation.parse(undefined), TypeError);
    });

    it('should parse quoted strings', () => {
      const links = LinksNotation.parse('"hello world"');
      assert.equal(links.length, 1);
      assert.equal(links[0].source, 'hello world');
    });

    it('should parse empty input as empty array', () => {
      const links = LinksNotation.parse('');
      assert.equal(links.length, 0);
    });
  });

  describe('stringify', () => {
    it('should serialize a simple link', () => {
      const link = { id: 0, source: 'hello', target: 'hello' };
      const notation = LinksNotation.stringify(link);
      // Result should contain 'hello'
      assert.ok(notation.includes('hello'));
    });

    it('should serialize a link with different source and target', () => {
      const link = { id: 0, source: 'type', target: 'enqueue' };
      const notation = LinksNotation.stringify(link);
      assert.ok(notation.includes('type'));
      assert.ok(notation.includes('enqueue'));
    });

    it('should serialize an array of links', () => {
      const links = [
        { id: 0, source: 'hello', target: 'hello' },
        { id: 1, source: 'world', target: 'world' },
      ];
      const notation = LinksNotation.stringify(links);
      assert.ok(notation.includes('hello'));
      assert.ok(notation.includes('world'));
    });

    it('should support pretty option', () => {
      const link = { id: 0, source: 'type', target: 'enqueue' };
      const notation = LinksNotation.stringify(link, { pretty: true });
      // Pretty output should have less parentheses
      assert.ok(typeof notation === 'string');
    });

    it('should support lessParentheses option', () => {
      const link = { id: 0, source: 'type', target: 'enqueue' };
      const notation = LinksNotation.stringify(link, { lessParentheses: true });
      assert.ok(typeof notation === 'string');
    });

    it('should handle null/undefined gracefully', () => {
      const link = { id: 0, source: null, target: null };
      const notation = LinksNotation.stringify(link);
      assert.ok(typeof notation === 'string');
    });

    it('should handle links with values', () => {
      const link = { id: 0, source: 'a', target: 'b', values: ['c', 'd'] };
      const notation = LinksNotation.stringify(link);
      assert.ok(typeof notation === 'string');
    });
  });

  describe('createParser', () => {
    it('should create a parser with default options', () => {
      const parser = LinksNotation.createParser();
      assert.ok(parser instanceof NotationParser);
    });

    it('should create a parser with custom options', () => {
      const parser = LinksNotation.createParser({
        maxInputSize: 1024,
        maxDepth: 100,
      });
      assert.ok(parser instanceof NotationParser);
    });

    it('should parse input using custom parser', () => {
      const parser = LinksNotation.createParser();
      const links = parser.parse('hello');
      assert.equal(links.length, 1);
    });
  });

  describe('createStreamParser', () => {
    it('should create a stream parser', () => {
      const parser = LinksNotation.createStreamParser();
      assert.ok(parser instanceof NotationStreamParser);
    });

    it('should emit links on end', (_, done) => {
      const parser = LinksNotation.createStreamParser();
      const received = [];

      parser.on('link', (link) => {
        received.push(link);
      });

      parser.on('end', () => {
        assert.ok(received.length > 0);
        done();
      });

      parser.write('hello');
      parser.end();
    });

    it('should emit error on parse failure', (_, done) => {
      const parser = LinksNotation.createStreamParser();

      parser.on('error', (err) => {
        assert.ok(err instanceof Error);
        done();
      });

      parser.write('((unclosed');
      parser.end();
    });

    it('should throw on write after end', () => {
      const parser = LinksNotation.createStreamParser();
      parser.end();

      assert.throws(() => parser.write('data'), /ended/);
    });

    it('should support chained writes', () => {
      const parser = LinksNotation.createStreamParser();
      const result = parser.write('hel').write('lo');
      assert.strictEqual(result, parser);
    });

    it('should support off to remove listeners', () => {
      const parser = LinksNotation.createStreamParser();
      const handler = () => {};

      parser.on('link', handler);
      parser.off('link', handler);
      // No assertion needed - just checking it doesn't throw
    });
  });
});

describe('NotationParser', () => {
  it('should create instance with default options', () => {
    const parser = new NotationParser();
    assert.ok(parser);
  });

  it('should parse valid input', () => {
    const parser = new NotationParser();
    const links = parser.parse('(test: value)');
    assert.equal(links.length, 1);
  });
});

describe('NotationStreamParser', () => {
  it('should create instance with default options', () => {
    const parser = new NotationStreamParser();
    assert.ok(parser);
    assert.ok(parser.options.maxBufferSize > 0);
  });

  it('should create instance with custom options', () => {
    const parser = new NotationStreamParser({ maxBufferSize: 1024 });
    assert.equal(parser.options.maxBufferSize, 1024);
  });
});

describe('NotationParseError', () => {
  it('should have correct name', () => {
    const error = new NotationParseError('test error');
    assert.equal(error.name, 'NotationParseError');
  });

  it('should store location', () => {
    const location = { line: 1, column: 5, offset: 4 };
    const error = new NotationParseError('test error', location);
    assert.deepEqual(error.location, location);
  });

  it('should handle null location', () => {
    const error = new NotationParseError('test error');
    assert.equal(error.location, null);
  });
});

describe('Round-trip conversion', () => {
  it('should round-trip simple link', () => {
    const original = '(type: enqueue)';
    const links = LinksNotation.parse(original);
    const serialized = LinksNotation.stringify(links);

    // Re-parse and verify structure is preserved
    const reparsed = LinksNotation.parse(serialized);
    assert.equal(reparsed.length, links.length);
  });

  it('should round-trip multiple links', () => {
    const original = 'hello world';
    const links = LinksNotation.parse(original);
    const serialized = LinksNotation.stringify(links);

    const reparsed = LinksNotation.parse(serialized);
    assert.equal(reparsed.length, links.length);
  });
});
