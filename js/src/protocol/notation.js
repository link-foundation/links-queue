/**
 * Links Notation integration module
 *
 * Provides parsing and serialization of Links Notation strings
 * for protocol communication and data exchange.
 *
 * @module protocol/notation
 * @see https://github.com/link-foundation/links-notation
 */

import {
  Parser as LinoParser,
  Link as LinoLink,
  formatLinks,
  FormatOptions as LinoFormatOptions,
} from 'links-notation';
import { createLink, isLink, getLinkId } from '../index.js';

// =============================================================================
// LinksNotation Class
// =============================================================================

/**
 * Wrapper class for Links Notation parsing and serialization.
 *
 * Integrates the links-notation library with links-queue's Link type,
 * providing bidirectional conversion between notation strings and Link objects.
 *
 * @example
 * // Parse notation string
 * const links = LinksNotation.parse('((hello world) (foo bar))');
 *
 * // Serialize to notation string
 * const notation = LinksNotation.stringify(links);
 * const pretty = LinksNotation.stringify(links, { pretty: true });
 */
export class LinksNotation {
  /**
   * Default parser instance (singleton).
   * @type {LinoParser}
   * @private
   */
  static #parser = null;

  /**
   * Gets or creates the default parser instance.
   * @returns {LinoParser} The parser instance
   * @private
   */
  static #getParser() {
    if (!this.#parser) {
      this.#parser = new LinoParser();
    }
    return this.#parser;
  }

  /**
   * Parses a Links Notation string into an array of Link objects.
   *
   * @param {string} input - The Links Notation string to parse
   * @param {ParseOptions} [options] - Optional parsing options
   * @returns {import('../index.js').Link[]} Array of parsed Link objects
   * @throws {NotationParseError} If parsing fails
   *
   * @example
   * // Simple reference
   * const links1 = LinksNotation.parse('hello');
   * // -> [{ id: 0, source: 'hello', target: 'hello' }]
   *
   * // Link with values
   * const links2 = LinksNotation.parse('(type: enqueue)');
   * // -> [{ id: 0, source: 'type', target: 'enqueue' }]
   *
   * // Nested structure
   * const links3 = LinksNotation.parse('((type: enqueue) (queue: tasks))');
   */
  static parse(input, options = {}) {
    if (typeof input !== 'string') {
      throw new TypeError('Input must be a string');
    }

    const parser = options.parser || this.#getParser();

    try {
      const linoLinks = parser.parse(input);
      return linoLinks.map((linoLink, index) =>
        this.#convertLinoLinkToLink(linoLink, index)
      );
    } catch (error) {
      const parseError = new NotationParseError(
        `Failed to parse Links Notation: ${error.message}`,
        error.location
      );
      parseError.cause = error;
      throw parseError;
    }
  }

  /**
   * Serializes Link objects to a Links Notation string.
   *
   * @param {import('../index.js').Link | import('../index.js').Link[]} links - Link or array of links to serialize
   * @param {StringifyOptions} [options] - Serialization options
   * @returns {string} The Links Notation string representation
   *
   * @example
   * // Compact output (default)
   * const str = LinksNotation.stringify(links);
   * // -> "(type: enqueue)"
   *
   * // Pretty output with less parentheses
   * const pretty = LinksNotation.stringify(links, { pretty: true });
   * // -> "type: enqueue"
   *
   * // Custom formatting
   * const custom = LinksNotation.stringify(links, {
   *   lessParentheses: true,
   *   maxLineLength: 40
   * });
   */
  static stringify(links, options = {}) {
    const linksArray = Array.isArray(links) ? links : [links];
    const linoLinks = linksArray.map((link) =>
      this.#convertLinkToLinoLink(link)
    );

    const formatOpts = this.#buildFormatOptions(options);
    return formatLinks(linoLinks, formatOpts);
  }

  /**
   * Creates a parser instance with custom options.
   *
   * @param {ParserOptions} [options] - Parser configuration
   * @returns {NotationParser} A configured parser instance
   *
   * @example
   * const parser = LinksNotation.createParser({ maxInputSize: 1024 * 1024 });
   * const links = parser.parse(input);
   */
  static createParser(options = {}) {
    return new NotationParser(options);
  }

  /**
   * Creates a stream parser for processing large inputs.
   *
   * @param {StreamParserOptions} [options] - Stream parser configuration
   * @returns {NotationStreamParser} A stream parser instance
   *
   * @example
   * const parser = LinksNotation.createStreamParser();
   * parser.on('link', (link) => console.log(link));
   * parser.write(chunk1);
   * parser.write(chunk2);
   * parser.end();
   */
  static createStreamParser(options = {}) {
    return new NotationStreamParser(options);
  }

  /**
   * Converts a links-notation Link to a links-queue Link.
   *
   * @param {LinoLink} linoLink - The links-notation Link object
   * @param {number} index - Index used for generating ID
   * @returns {import('../index.js').Link} The links-queue Link object
   * @private
   */
  static #convertLinoLinkToLink(linoLink, index) {
    if (!linoLink) {
      return createLink(index, null, null);
    }

    // Simple reference (id only, no values)
    if (!linoLink.values || linoLink.values.length === 0) {
      const id = linoLink.id || null;
      return createLink(index, id, id);
    }

    // Link with values - convert to source/target model
    const id = linoLink.id;
    const values = linoLink.values;

    if (values.length === 1) {
      const firstValue = values[0];

      // Check if this is a wrapper around a simple reference (id: null with single value)
      if (id === null) {
        // This is "hello" parsed as { id: null, values: [{ id: "hello", values: [] }] }
        // Return as a self-referencing link: source=hello, target=hello
        const ref = this.#extractValue(firstValue);
        return createLink(index, ref, ref);
      }

      // Named link with value: (id: value) -> source=id, target=value
      const target = this.#extractValue(firstValue);
      return createLink(index, id, target);
    }

    if (values.length === 2) {
      // Two values: (source target) or (id: source target)
      const source = this.#extractValue(values[0]);
      const target = this.#extractValue(values[1]);

      if (id !== null) {
        // (id: source target) -> has additional values
        return createLink(index, source, target, [id]);
      }
      return createLink(index, source, target);
    }

    // More than 2 values: first two are source/target, rest are values
    const source = this.#extractValue(values[0]);
    const target = this.#extractValue(values[1]);
    const additionalValues =
      id !== null
        ? [id, ...values.slice(2).map((v) => this.#extractValue(v))]
        : values.slice(2).map((v) => this.#extractValue(v));

    return createLink(
      index,
      source,
      target,
      additionalValues.length > 0 ? additionalValues : undefined
    );
  }

  /**
   * Extracts value from a links-notation element.
   *
   * @param {LinoLink|string} element - Element to extract from
   * @returns {import('../index.js').LinkRef} Extracted value
   * @private
   */
  static #extractValue(element) {
    if (!element) {
      return null;
    }
    if (typeof element === 'string') {
      return element;
    }
    if (element instanceof LinoLink || (element.id !== undefined && element)) {
      // If it's a nested link with values, recursively convert
      if (element.values && element.values.length > 0) {
        return this.#convertLinoLinkToLink(element, 0);
      }
      // Simple reference
      return element.id || null;
    }
    return String(element);
  }

  /**
   * Converts a links-queue Link to a links-notation Link.
   *
   * @param {import('../index.js').Link} link - The links-queue Link object
   * @returns {LinoLink} The links-notation Link object
   * @private
   */
  static #convertLinkToLinoLink(link) {
    if (!link) {
      return new LinoLink(null, []);
    }

    if (!isLink(link)) {
      // If it's a primitive value, create a simple reference
      return new LinoLink(String(link), []);
    }

    const source = this.#convertRefToLinoValue(link.source);
    const target = this.#convertRefToLinoValue(link.target);

    // Check if this is a self-referencing (named) link
    // Only use the named link shortcut when source is a string
    // (not a complex link with the same id)
    const sourceId = getLinkId(link.source);
    const targetId = getLinkId(link.target);

    if (
      sourceId === targetId &&
      !link.values?.length &&
      typeof source === 'string'
    ) {
      // Named link: (name: name) -> (name)
      return new LinoLink(source, []);
    }

    // Build values array
    const values = [
      typeof source === 'string'
        ? new LinoLink(source, [])
        : this.#convertLinkToLinoLink(source),
      typeof target === 'string'
        ? new LinoLink(target, [])
        : this.#convertLinkToLinoLink(target),
    ];

    // Add additional values if present
    if (link.values && link.values.length > 0) {
      for (const val of link.values) {
        const converted = this.#convertRefToLinoValue(val);
        values.push(
          typeof converted === 'string'
            ? new LinoLink(converted, [])
            : this.#convertLinkToLinoLink(converted)
        );
      }
    }

    return new LinoLink(null, values);
  }

  /**
   * Converts a LinkRef to a value suitable for links-notation.
   *
   * @param {import('../index.js').LinkRef} ref - Reference to convert
   * @returns {string|import('../index.js').Link} Converted value
   * @private
   */
  static #convertRefToLinoValue(ref) {
    if (ref === null || ref === undefined) {
      return '';
    }
    if (isLink(ref)) {
      return ref;
    }
    return String(ref);
  }

  /**
   * Builds FormatOptions from stringify options.
   *
   * @param {StringifyOptions} options - Stringify options
   * @returns {LinoFormatOptions|boolean} Format options or boolean
   * @private
   */
  static #buildFormatOptions(options) {
    if (options.pretty) {
      return new LinoFormatOptions({
        lessParentheses: true,
        indentLongLines: true,
        maxLineLength: 80,
      });
    }

    if (
      options.lessParentheses !== undefined ||
      options.maxLineLength !== undefined ||
      options.indentLongLines !== undefined ||
      options.groupConsecutive !== undefined
    ) {
      return new LinoFormatOptions({
        lessParentheses: options.lessParentheses ?? false,
        maxLineLength: options.maxLineLength ?? 80,
        indentLongLines: options.indentLongLines ?? false,
        groupConsecutive: options.groupConsecutive ?? false,
      });
    }

    return false; // Default: full parentheses
  }
}

// =============================================================================
// NotationParser Class
// =============================================================================

/**
 * Stateful parser for Links Notation with custom configuration.
 *
 * @example
 * const parser = new NotationParser({ maxInputSize: 1024 * 1024 });
 * const links = parser.parse(input);
 */
export class NotationParser {
  /** @type {LinoParser} */
  #parser;

  /**
   * Creates a new NotationParser instance.
   *
   * @param {ParserOptions} [options] - Parser configuration
   */
  constructor(options = {}) {
    this.#parser = new LinoParser({
      maxInputSize: options.maxInputSize || 10 * 1024 * 1024,
      maxDepth: options.maxDepth || 1000,
    });
  }

  /**
   * Parses a Links Notation string.
   *
   * @param {string} input - Input to parse
   * @returns {import('../index.js').Link[]} Parsed links
   */
  parse(input) {
    return LinksNotation.parse(input, { parser: this.#parser });
  }
}

// =============================================================================
// NotationStreamParser Class
// =============================================================================

/**
 * Stream parser for processing large Links Notation inputs incrementally.
 *
 * Note: This is a basic implementation. Full streaming support requires
 * the underlying links-notation library to support incremental parsing.
 *
 * @example
 * const parser = new NotationStreamParser();
 * parser.on('link', (link) => console.log('Got link:', link));
 * parser.on('error', (err) => console.error('Parse error:', err));
 * parser.on('end', () => console.log('Parsing complete'));
 *
 * parser.write('((type: ');
 * parser.write('enqueue)');
 * parser.write(' (queue: tasks))');
 * parser.end();
 */
export class NotationStreamParser {
  /** @type {string} */
  #buffer = '';

  /** @type {Map<string, Function[]>} */
  #listeners = new Map();

  /** @type {boolean} */
  #ended = false;

  /**
   * Creates a new NotationStreamParser instance.
   *
   * @param {StreamParserOptions} [options] - Parser configuration
   */
  constructor(options = {}) {
    this.options = {
      maxBufferSize: options.maxBufferSize || 10 * 1024 * 1024,
    };
  }

  /**
   * Registers an event listener.
   *
   * @param {'link'|'error'|'end'} event - Event name
   * @param {Function} callback - Event handler
   * @returns {this} The parser instance for chaining
   */
  on(event, callback) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, []);
    }
    this.#listeners.get(event).push(callback);
    return this;
  }

  /**
   * Removes an event listener.
   *
   * @param {'link'|'error'|'end'} event - Event name
   * @param {Function} callback - Event handler to remove
   * @returns {this} The parser instance for chaining
   */
  off(event, callback) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Writes data to the parser buffer.
   *
   * @param {string} chunk - Data chunk to add
   * @returns {this} The parser instance for chaining
   * @throws {Error} If parser has ended or buffer overflow
   */
  write(chunk) {
    if (this.#ended) {
      throw new Error('Cannot write to ended stream parser');
    }

    this.#buffer += chunk;

    if (this.#buffer.length > this.options.maxBufferSize) {
      const error = new Error('Buffer size exceeded maximum');
      this.#emit('error', error);
      throw error;
    }

    return this;
  }

  /**
   * Signals end of input and processes the buffer.
   */
  end() {
    if (this.#ended) {
      return;
    }

    this.#ended = true;

    try {
      const links = LinksNotation.parse(this.#buffer);
      for (const link of links) {
        this.#emit('link', link);
      }
      this.#emit('end');
    } catch (error) {
      this.#emit('error', error);
    }

    this.#buffer = '';
  }

  /**
   * Emits an event to registered listeners.
   *
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @private
   */
  #emit(event, data) {
    const listeners = this.#listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }
}

// =============================================================================
// NotationParseError Class
// =============================================================================

/**
 * Error thrown when parsing Links Notation fails.
 *
 * @extends Error
 */
export class NotationParseError extends Error {
  /**
   * Creates a new NotationParseError.
   *
   * @param {string} message - Error message
   * @param {Object} [location] - Error location in input
   * @param {number} [location.line] - Line number (1-based)
   * @param {number} [location.column] - Column number (1-based)
   * @param {number} [location.offset] - Character offset
   */
  constructor(message, location) {
    super(message);
    this.name = 'NotationParseError';
    this.location = location || null;
  }
}

// =============================================================================
// Type Definitions (JSDoc)
// =============================================================================

/**
 * Options for parsing Links Notation.
 *
 * @typedef {Object} ParseOptions
 * @property {LinoParser} [parser] - Custom parser instance to use
 */

/**
 * Options for serializing to Links Notation.
 *
 * @typedef {Object} StringifyOptions
 * @property {boolean} [pretty=false] - Use pretty formatting (less parentheses, indentation)
 * @property {boolean} [lessParentheses=false] - Remove optional parentheses
 * @property {number} [maxLineLength=80] - Maximum line length before wrapping
 * @property {boolean} [indentLongLines=false] - Indent lines exceeding maxLineLength
 * @property {boolean} [groupConsecutive=false] - Group consecutive links with same ID
 */

/**
 * Options for creating a parser.
 *
 * @typedef {Object} ParserOptions
 * @property {number} [maxInputSize=10485760] - Maximum input size in bytes (default 10MB)
 * @property {number} [maxDepth=1000] - Maximum nesting depth
 */

/**
 * Options for stream parser.
 *
 * @typedef {Object} StreamParserOptions
 * @property {number} [maxBufferSize=10485760] - Maximum buffer size in bytes
 */
