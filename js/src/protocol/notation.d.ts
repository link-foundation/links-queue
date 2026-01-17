/**
 * Links Notation integration module
 *
 * Provides parsing and serialization of Links Notation strings
 * for protocol communication and data exchange.
 *
 * @module protocol/notation
 */

import { Link, LinkRef } from '../index.d.ts';

// =============================================================================
// Options Types
// =============================================================================

/**
 * Options for parsing Links Notation.
 */
export interface ParseOptions {
  /**
   * Custom parser instance to use.
   */
  parser?: NotationParser;
}

/**
 * Options for serializing to Links Notation.
 */
export interface StringifyOptions {
  /**
   * Use pretty formatting (less parentheses, indentation).
   * @default false
   */
  pretty?: boolean;

  /**
   * Remove optional parentheses.
   * @default false
   */
  lessParentheses?: boolean;

  /**
   * Maximum line length before wrapping.
   * @default 80
   */
  maxLineLength?: number;

  /**
   * Indent lines exceeding maxLineLength.
   * @default false
   */
  indentLongLines?: boolean;

  /**
   * Group consecutive links with same ID.
   * @default false
   */
  groupConsecutive?: boolean;
}

/**
 * Options for creating a parser.
 */
export interface ParserOptions {
  /**
   * Maximum input size in bytes.
   * @default 10485760 (10MB)
   */
  maxInputSize?: number;

  /**
   * Maximum nesting depth.
   * @default 1000
   */
  maxDepth?: number;
}

/**
 * Options for stream parser.
 */
export interface StreamParserOptions {
  /**
   * Maximum buffer size in bytes.
   * @default 10485760 (10MB)
   */
  maxBufferSize?: number;
}

/**
 * Location information for parse errors.
 */
export interface ParseLocation {
  /**
   * Line number (1-based).
   */
  line: number;

  /**
   * Column number (1-based).
   */
  column: number;

  /**
   * Character offset from start.
   */
  offset: number;
}

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
export declare class LinksNotation {
  /**
   * Parses a Links Notation string into an array of Link objects.
   *
   * @param input - The Links Notation string to parse
   * @param options - Optional parsing options
   * @returns Array of parsed Link objects
   * @throws {NotationParseError} If parsing fails
   *
   * @example
   * const links = LinksNotation.parse('(type: enqueue)');
   */
  static parse(input: string, options?: ParseOptions): Link[];

  /**
   * Serializes Link objects to a Links Notation string.
   *
   * @param links - Link or array of links to serialize
   * @param options - Serialization options
   * @returns The Links Notation string representation
   *
   * @example
   * const str = LinksNotation.stringify(links);
   * const pretty = LinksNotation.stringify(links, { pretty: true });
   */
  static stringify(links: Link | Link[], options?: StringifyOptions): string;

  /**
   * Creates a parser instance with custom options.
   *
   * @param options - Parser configuration
   * @returns A configured parser instance
   */
  static createParser(options?: ParserOptions): NotationParser;

  /**
   * Creates a stream parser for processing large inputs.
   *
   * @param options - Stream parser configuration
   * @returns A stream parser instance
   */
  static createStreamParser(
    options?: StreamParserOptions
  ): NotationStreamParser;
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
export declare class NotationParser {
  /**
   * Creates a new NotationParser instance.
   *
   * @param options - Parser configuration
   */
  constructor(options?: ParserOptions);

  /**
   * Parses a Links Notation string.
   *
   * @param input - Input to parse
   * @returns Parsed links
   */
  parse(input: string): Link[];
}

// =============================================================================
// NotationStreamParser Class
// =============================================================================

/**
 * Stream parser event types.
 */
export type StreamParserEvent = 'link' | 'error' | 'end';

/**
 * Stream parser event handler types.
 */
export type StreamParserHandler<E extends StreamParserEvent> = E extends 'link'
  ? (link: Link) => void
  : E extends 'error'
    ? (error: Error) => void
    : E extends 'end'
      ? () => void
      : never;

/**
 * Stream parser for processing large Links Notation inputs incrementally.
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
export declare class NotationStreamParser {
  /**
   * Parser configuration options.
   */
  readonly options: Required<StreamParserOptions>;

  /**
   * Creates a new NotationStreamParser instance.
   *
   * @param options - Parser configuration
   */
  constructor(options?: StreamParserOptions);

  /**
   * Registers an event listener.
   *
   * @param event - Event name
   * @param callback - Event handler
   * @returns The parser instance for chaining
   */
  on<E extends StreamParserEvent>(
    event: E,
    callback: StreamParserHandler<E>
  ): this;

  /**
   * Removes an event listener.
   *
   * @param event - Event name
   * @param callback - Event handler to remove
   * @returns The parser instance for chaining
   */
  off<E extends StreamParserEvent>(
    event: E,
    callback: StreamParserHandler<E>
  ): this;

  /**
   * Writes data to the parser buffer.
   *
   * @param chunk - Data chunk to add
   * @returns The parser instance for chaining
   * @throws {Error} If parser has ended or buffer overflow
   */
  write(chunk: string): this;

  /**
   * Signals end of input and processes the buffer.
   */
  end(): void;
}

// =============================================================================
// NotationParseError Class
// =============================================================================

/**
 * Error thrown when parsing Links Notation fails.
 */
export declare class NotationParseError extends Error {
  /**
   * Error name.
   */
  readonly name: 'NotationParseError';

  /**
   * Location of the error in the input.
   */
  readonly location: ParseLocation | null;

  /**
   * The underlying error that caused this error.
   */
  cause?: Error;

  /**
   * Creates a new NotationParseError.
   *
   * @param message - Error message
   * @param location - Error location in input
   */
  constructor(message: string, location?: ParseLocation);
}
