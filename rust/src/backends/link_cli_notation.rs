//! Links Notation parser and serializer for link-cli communication.
//!
//! This module provides parsing and serialization of Links Notation strings
//! for communicating with link-cli processes via stdin/stdout.
//!
//! # Links Notation Format
//!
//! Links Notation uses a substitution-based syntax:
//! - A link has three components: index, source, and target
//! - Notation `(1: 1 1)` represents a link with index 1, source 1, target 1
//! - When index is undefined `((1 1))`, the database assigns an ID
//!
//! # CRUD Operations
//!
//! - Create: `() ((source target))` - replace nothing with something
//! - Read: `((($i: $s $t)) (($i: $s $t)))` - match and return
//! - Delete: `((source target)) ()` - replace something with nothing
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::backends::link_cli_notation::{LinksNotation, ParsedLink};
//!
//! // Parse a response
//! let links = LinksNotation::parse("(1: 2 3)").unwrap();
//! assert_eq!(links[0].id, Some(1));
//! assert_eq!(links[0].source, 2);
//! assert_eq!(links[0].target, 3);
//!
//! // Create a save command
//! let cmd = LinksNotation::create_command(5, 10);
//! assert_eq!(cmd, "() ((5 10))");
//! ```

use crate::LinkType;
use std::fmt::Display;
use std::str::FromStr;

// =============================================================================
// Parsed Link
// =============================================================================

/// A parsed link from Links Notation.
///
/// Represents a link with optional ID (assigned by database if None),
/// source reference, and target reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLink<T: LinkType> {
    /// The link's ID (None if to be assigned by database).
    pub id: Option<T>,
    /// The source reference.
    pub source: T,
    /// The target reference.
    pub target: T,
}

impl<T: LinkType> ParsedLink<T> {
    /// Creates a new parsed link with an ID.
    #[must_use]
    pub const fn new(id: T, source: T, target: T) -> Self {
        Self {
            id: Some(id),
            source,
            target,
        }
    }

    /// Creates a new parsed link without an ID (to be assigned).
    #[must_use]
    pub const fn without_id(source: T, target: T) -> Self {
        Self {
            id: None,
            source,
            target,
        }
    }
}

// =============================================================================
// Parse Error
// =============================================================================

/// Error that can occur during Links Notation parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotationParseError {
    /// Unexpected character encountered.
    UnexpectedChar {
        /// The unexpected character.
        char: char,
        /// Position in the input.
        position: usize,
    },
    /// Expected a character but found something else.
    ExpectedChar {
        /// Expected character.
        expected: char,
        /// Found character (or None for EOF).
        found: Option<char>,
        /// Position in the input.
        position: usize,
    },
    /// Invalid number format.
    InvalidNumber {
        /// The invalid string.
        value: String,
        /// Position in the input.
        position: usize,
    },
    /// Unexpected end of input.
    UnexpectedEof {
        /// What was expected.
        expected: String,
    },
    /// Empty input.
    EmptyInput,
    /// General parse error.
    Other(String),
}

impl Display for NotationParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnexpectedChar { char, position } => {
                write!(f, "Unexpected character '{char}' at position {position}")
            }
            Self::ExpectedChar {
                expected,
                found,
                position,
            } => {
                if let Some(c) = found {
                    write!(
                        f,
                        "Expected '{expected}' but found '{c}' at position {position}"
                    )
                } else {
                    write!(
                        f,
                        "Expected '{expected}' but found EOF at position {position}"
                    )
                }
            }
            Self::InvalidNumber { value, position } => {
                write!(f, "Invalid number '{value}' at position {position}")
            }
            Self::UnexpectedEof { expected } => {
                write!(f, "Unexpected end of input, expected {expected}")
            }
            Self::EmptyInput => write!(f, "Empty input"),
            Self::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for NotationParseError {}

/// Result type for notation parsing.
pub type NotationResult<T> = Result<T, NotationParseError>;

// =============================================================================
// Parser
// =============================================================================

/// Parser for Links Notation.
struct NotationParser<'a, T: LinkType> {
    input: &'a str,
    position: usize,
    _marker: std::marker::PhantomData<T>,
}

#[allow(clippy::type_repetition_in_bounds)]
impl<'a, T: LinkType> NotationParser<'a, T>
where
    T: FromStr,
{
    /// Creates a new parser for the given input.
    const fn new(input: &'a str) -> Self {
        Self {
            input,
            position: 0,
            _marker: std::marker::PhantomData,
        }
    }

    /// Returns the current character or None if at end.
    fn current(&self) -> Option<char> {
        self.input[self.position..].chars().next()
    }

    /// Advances to the next character.
    fn advance(&mut self) {
        if let Some(c) = self.current() {
            self.position += c.len_utf8();
        }
    }

    /// Skips whitespace characters.
    fn skip_whitespace(&mut self) {
        while let Some(c) = self.current() {
            if c.is_whitespace() {
                self.advance();
            } else {
                break;
            }
        }
    }

    /// Expects and consumes a specific character.
    fn expect(&mut self, expected: char) -> NotationResult<()> {
        self.skip_whitespace();
        match self.current() {
            Some(c) if c == expected => {
                self.advance();
                Ok(())
            }
            found => Err(NotationParseError::ExpectedChar {
                expected,
                found,
                position: self.position,
            }),
        }
    }

    /// Parses a number.
    fn parse_number(&mut self) -> NotationResult<T> {
        self.skip_whitespace();
        let start = self.position;

        // Handle negative numbers
        if self.current() == Some('-') {
            self.advance();
        }

        // Consume digits
        while let Some(c) = self.current() {
            if c.is_ascii_digit() {
                self.advance();
            } else {
                break;
            }
        }

        let value = &self.input[start..self.position];
        if value.is_empty() || value == "-" {
            return Err(NotationParseError::InvalidNumber {
                value: value.to_string(),
                position: start,
            });
        }

        value
            .parse()
            .map_err(|_| NotationParseError::InvalidNumber {
                value: value.to_string(),
                position: start,
            })
    }

    /// Parses a single link: `(id: source target)` or `(source target)`.
    fn parse_link(&mut self) -> NotationResult<ParsedLink<T>> {
        self.skip_whitespace();
        self.expect('(')?;
        self.skip_whitespace();

        // First number could be ID or source
        let first = self.parse_number()?;
        self.skip_whitespace();

        // Check if there's a colon (making first the ID)
        if self.current() == Some(':') {
            self.advance(); // consume ':'
            self.skip_whitespace();

            let source = self.parse_number()?;
            self.skip_whitespace();
            let target = self.parse_number()?;
            self.skip_whitespace();
            self.expect(')')?;

            Ok(ParsedLink::new(first, source, target))
        } else {
            // No colon - first is source
            let target = self.parse_number()?;
            self.skip_whitespace();
            self.expect(')')?;

            Ok(ParsedLink::without_id(first, target))
        }
    }

    /// Parses multiple links from output like `(1: 2 3)(4: 5 6)` or `((1: 2 3) (4: 5 6))`.
    fn parse_links(&mut self) -> NotationResult<Vec<ParsedLink<T>>> {
        let mut links = Vec::new();
        self.skip_whitespace();

        // Check if wrapped in outer parentheses
        if self.current() == Some('(') {
            // Peek ahead to see if this starts a link or is an outer wrapper
            let saved_pos = self.position;
            self.advance();
            self.skip_whitespace();

            if self.current() == Some('(') {
                // Outer wrapper: ((link1) (link2) ...)
                while self.current() == Some('(') {
                    links.push(self.parse_link()?);
                    self.skip_whitespace();
                }
                // Consume closing outer paren
                if self.current() == Some(')') {
                    self.advance();
                }
            } else {
                // This is a single link, reset and parse
                self.position = saved_pos;
                links.push(self.parse_link()?);
            }
        }

        // Continue parsing any additional links
        self.skip_whitespace();
        while self.current() == Some('(') {
            links.push(self.parse_link()?);
            self.skip_whitespace();
        }

        Ok(links)
    }
}

// =============================================================================
// Links Notation API
// =============================================================================

/// Links Notation parser and serializer.
///
/// Provides static methods for parsing and generating Links Notation strings
/// for communication with link-cli.
pub struct LinksNotation;

impl LinksNotation {
    /// Parses a Links Notation string into a vector of parsed links.
    ///
    /// # Arguments
    ///
    /// * `input` - The Links Notation string to parse
    ///
    /// # Returns
    ///
    /// Vector of parsed links.
    ///
    /// # Errors
    ///
    /// Returns `NotationParseError` if parsing fails.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::backends::link_cli_notation::LinksNotation;
    ///
    /// let links = LinksNotation::parse::<u64>("(1: 2 3)").unwrap();
    /// assert_eq!(links[0].id, Some(1));
    /// ```
    pub fn parse<T: LinkType + FromStr>(input: &str) -> NotationResult<Vec<ParsedLink<T>>> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let mut parser = NotationParser::new(trimmed);
        parser.parse_links()
    }

    /// Creates a command string for saving a new link.
    ///
    /// Uses the pattern `() ((source target))` to create a new link
    /// with an auto-assigned ID.
    ///
    /// # Arguments
    ///
    /// * `source` - The source reference
    /// * `target` - The target reference
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn create_command<T: LinkType + Display>(source: T, target: T) -> String {
        format!("() (({source} {target}))")
    }

    /// Creates a command string for reading a link by ID.
    ///
    /// Uses pattern matching to find a specific link by ID.
    ///
    /// # Arguments
    ///
    /// * `id` - The link ID to read
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn read_by_id_command<T: LinkType + Display>(id: T) -> String {
        format!("(({id}: $s $t)) (({id}: $s $t))")
    }

    /// Creates a command string for reading all links.
    ///
    /// Uses variables to match any link.
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn read_all_command() -> String {
        "(($i: $s $t)) (($i: $s $t))".to_string()
    }

    /// Creates a command string for deleting a link by ID.
    ///
    /// Uses the pattern `((id: source target)) ()` to delete a link.
    /// First we need to read the link to get its source and target.
    ///
    /// # Arguments
    ///
    /// * `id` - The link ID
    /// * `source` - The link's source
    /// * `target` - The link's target
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn delete_command<T: LinkType + Display>(id: T, source: T, target: T) -> String {
        format!("(({id}: {source} {target})) ()")
    }

    /// Creates a command string for querying links by source.
    ///
    /// # Arguments
    ///
    /// * `source` - The source reference to match
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn query_by_source_command<T: LinkType + Display>(source: T) -> String {
        format!("(($i: {source} $t)) (($i: {source} $t))")
    }

    /// Creates a command string for querying links by target.
    ///
    /// # Arguments
    ///
    /// * `target` - The target reference to match
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn query_by_target_command<T: LinkType + Display>(target: T) -> String {
        format!("(($i: $s {target})) (($i: $s {target}))")
    }

    /// Creates a command string for querying links by source and target.
    ///
    /// # Arguments
    ///
    /// * `source` - The source reference to match
    /// * `target` - The target reference to match
    ///
    /// # Returns
    ///
    /// The command string for link-cli.
    #[must_use]
    pub fn query_by_source_and_target_command<T: LinkType + Display>(
        source: T,
        target: T,
    ) -> String {
        format!("(($i: {source} {target})) (($i: {source} {target}))")
    }

    /// Formats a parsed link to Links Notation string.
    ///
    /// # Arguments
    ///
    /// * `link` - The parsed link to format
    ///
    /// # Returns
    ///
    /// The Links Notation string representation.
    #[must_use]
    pub fn format_link<T: LinkType + Display>(link: &ParsedLink<T>) -> String {
        link.id.map_or_else(
            || format!("({} {})", link.source, link.target),
            |id| format!("({id}: {} {})", link.source, link.target),
        )
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod parse_tests {
        use super::*;

        #[test]
        fn test_parse_link_with_id() {
            let links = LinksNotation::parse::<u64>("(1: 2 3)").unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].id, Some(1));
            assert_eq!(links[0].source, 2);
            assert_eq!(links[0].target, 3);
        }

        #[test]
        fn test_parse_link_without_id() {
            let links = LinksNotation::parse::<u64>("(2 3)").unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].id, None);
            assert_eq!(links[0].source, 2);
            assert_eq!(links[0].target, 3);
        }

        #[test]
        fn test_parse_multiple_links() {
            let links = LinksNotation::parse::<u64>("(1: 2 3)(4: 5 6)").unwrap();
            assert_eq!(links.len(), 2);
            assert_eq!(links[0].id, Some(1));
            assert_eq!(links[1].id, Some(4));
        }

        #[test]
        fn test_parse_wrapped_links() {
            let links = LinksNotation::parse::<u64>("((1: 2 3) (4: 5 6))").unwrap();
            assert_eq!(links.len(), 2);
            assert_eq!(links[0].id, Some(1));
            assert_eq!(links[1].id, Some(4));
        }

        #[test]
        fn test_parse_empty() {
            let links = LinksNotation::parse::<u64>("").unwrap();
            assert!(links.is_empty());
        }

        #[test]
        fn test_parse_whitespace() {
            let links = LinksNotation::parse::<u64>("  ( 1 : 2  3 )  ").unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].id, Some(1));
        }

        #[test]
        fn test_parse_self_referential() {
            let links = LinksNotation::parse::<u64>("(1: 1 1)").unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].id, Some(1));
            assert_eq!(links[0].source, 1);
            assert_eq!(links[0].target, 1);
        }
    }

    mod command_tests {
        use super::*;

        #[test]
        fn test_create_command() {
            let cmd = LinksNotation::create_command(5u64, 10u64);
            assert_eq!(cmd, "() ((5 10))");
        }

        #[test]
        fn test_read_by_id_command() {
            let cmd = LinksNotation::read_by_id_command(42u64);
            assert_eq!(cmd, "((42: $s $t)) ((42: $s $t))");
        }

        #[test]
        fn test_read_all_command() {
            let cmd = LinksNotation::read_all_command();
            assert_eq!(cmd, "(($i: $s $t)) (($i: $s $t))");
        }

        #[test]
        fn test_delete_command() {
            let cmd = LinksNotation::delete_command(1u64, 2u64, 3u64);
            assert_eq!(cmd, "((1: 2 3)) ()");
        }

        #[test]
        fn test_query_by_source_command() {
            let cmd = LinksNotation::query_by_source_command(5u64);
            assert_eq!(cmd, "(($i: 5 $t)) (($i: 5 $t))");
        }

        #[test]
        fn test_query_by_target_command() {
            let cmd = LinksNotation::query_by_target_command(10u64);
            assert_eq!(cmd, "(($i: $s 10)) (($i: $s 10))");
        }

        #[test]
        fn test_query_by_source_and_target_command() {
            let cmd = LinksNotation::query_by_source_and_target_command(5u64, 10u64);
            assert_eq!(cmd, "(($i: 5 10)) (($i: 5 10))");
        }
    }

    mod format_tests {
        use super::*;

        #[test]
        fn test_format_link_with_id() {
            let link = ParsedLink::new(1u64, 2u64, 3u64);
            let formatted = LinksNotation::format_link(&link);
            assert_eq!(formatted, "(1: 2 3)");
        }

        #[test]
        fn test_format_link_without_id() {
            let link = ParsedLink::without_id(2u64, 3u64);
            let formatted = LinksNotation::format_link(&link);
            assert_eq!(formatted, "(2 3)");
        }
    }

    mod error_tests {
        use super::*;

        #[test]
        fn test_parse_invalid_missing_paren() {
            // Input without starting parenthesis returns empty result since there's no link
            let result = LinksNotation::parse::<u64>("1: 2 3").unwrap();
            assert!(result.is_empty());
        }

        #[test]
        fn test_parse_invalid_unclosed_paren() {
            let result = LinksNotation::parse::<u64>("(1: 2 3");
            assert!(result.is_err());
        }

        #[test]
        fn test_parse_invalid_number() {
            let result = LinksNotation::parse::<u64>("(abc: 2 3)");
            assert!(result.is_err());
        }
    }
}
