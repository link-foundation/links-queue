//! Binary Links Notation encoder/decoder.
//!
//! This module provides high-performance binary encoding/decoding for Links,
//! achieving 1.2-1.7x smaller message sizes compared to text notation.

// Allow unused constants that are part of the spec but not yet implemented
#![allow(dead_code)]
// Allow truncation casts - we check bounds elsewhere
#![allow(clippy::cast_possible_truncation)]
//!
//! # Wire Format
//!
//! Every binary message starts with an 11-byte header:
//! - Magic (4 bytes): 0x4C4E4B51 ("LNKQ")
//! - Version (2 bytes): Protocol version (major.minor)
//! - Flags (1 byte): Message flags (compression, etc.)
//! - Length (4 bytes): Payload length in bytes
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::backends::binary_notation::{BinaryNotation, BinaryNotationError};
//! use links_queue::{Link, LinkRef};
//!
//! // Encode links
//! let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
//! let buffer = BinaryNotation::encode(&[link])?;
//!
//! // Decode links
//! let decoded = BinaryNotation::decode(&buffer)?;
//! assert_eq!(decoded.len(), 1);
//! ```

use crate::{Link, LinkRef, LinkType};
use std::fmt::Display;
use std::io::{self, Read, Write};
use std::str::FromStr;

// =============================================================================
// Constants
// =============================================================================

/// Magic number for protocol identification: "LNKQ"
pub const MAGIC: u32 = 0x4C4E_4B51;

/// Current protocol version (1.0)
pub const VERSION: u16 = 0x0100;

/// Header size in bytes
pub const HEADER_SIZE: usize = 11;

// Flag bits
/// Payload is compressed
pub const FLAG_COMPRESSED: u8 = 0x01;
/// Compression algorithm mask
pub const FLAG_COMPRESSION_MASK: u8 = 0x06;
/// Zstd compression
pub const FLAG_COMPRESSION_ZSTD: u8 = 0x02;
/// LZ4 compression
pub const FLAG_COMPRESSION_LZ4: u8 = 0x04;
/// Has CRC32 checksum
pub const FLAG_HAS_CHECKSUM: u8 = 0x08;
/// Message is part of a stream
pub const FLAG_STREAMING: u8 = 0x10;

// Link type bits
/// Source is a link ID reference
pub const TYPE_SOURCE_IS_ID: u8 = 0x01;
/// Target is a link ID reference
pub const TYPE_TARGET_IS_ID: u8 = 0x02;
/// Self-referencing link (source == target)
pub const TYPE_SELF_REF: u8 = 0x04;
/// Link has an explicit ID
pub const TYPE_HAS_ID: u8 = 0x08;
/// Link has additional values array
pub const TYPE_HAS_VALUES: u8 = 0x10;
/// ID size mask
pub const TYPE_ID_SIZE_MASK: u8 = 0x60;
/// ID is varint encoded
pub const TYPE_ID_SIZE_VARINT: u8 = 0x00;
/// ID is 4 bytes
pub const TYPE_ID_SIZE_4BYTES: u8 = 0x20;
/// ID is 8 bytes
pub const TYPE_ID_SIZE_8BYTES: u8 = 0x40;

// Literal type markers
/// Null value
pub const LITERAL_NULL: u8 = 0x00;
/// Boolean false
pub const LITERAL_FALSE: u8 = 0x01;
/// Boolean true
pub const LITERAL_TRUE: u8 = 0x02;
/// Variable-length integer
pub const LITERAL_VARINT: u8 = 0x10;
/// 32-bit integer
pub const LITERAL_INT32: u8 = 0x11;
/// 64-bit integer
pub const LITERAL_INT64: u8 = 0x12;
/// 64-bit float
pub const LITERAL_FLOAT64: u8 = 0x13;
/// Short string (1-byte length)
pub const LITERAL_STRING_SHORT: u8 = 0x20;
/// Medium string (2-byte length)
pub const LITERAL_STRING_MEDIUM: u8 = 0x21;
/// Long string (4-byte length)
pub const LITERAL_STRING_LONG: u8 = 0x22;
/// Short binary (1-byte length)
pub const LITERAL_BINARY_SHORT: u8 = 0x30;
/// Medium binary (2-byte length)
pub const LITERAL_BINARY_MEDIUM: u8 = 0x31;
/// Long binary (4-byte length)
pub const LITERAL_BINARY_LONG: u8 = 0x32;
/// Inline link
pub const LITERAL_LINK: u8 = 0x40;

// =============================================================================
// Error Types
// =============================================================================

/// Error codes for binary notation operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryNotationErrorCode {
    /// Magic number mismatch
    InvalidMagic = 0x01,
    /// Protocol version not supported
    UnsupportedVersion = 0x02,
    /// Unknown or invalid flags
    InvalidFlags = 0x03,
    /// Message shorter than declared length
    TruncatedMessage = 0x04,
    /// Unknown link type byte
    InvalidType = 0x05,
    /// Malformed literal encoding
    InvalidLiteral = 0x06,
    /// Decompression error
    DecompressionFailed = 0x07,
    /// CRC32 checksum failed
    ChecksumMismatch = 0x08,
    /// I/O error
    IoError = 0x10,
}

/// Error thrown when binary notation encoding/decoding fails.
#[derive(Debug)]
pub struct BinaryNotationError {
    /// Error message
    pub message: String,
    /// Error code
    pub code: BinaryNotationErrorCode,
    /// Position in buffer where error occurred
    pub position: Option<usize>,
}

impl BinaryNotationError {
    /// Creates a new `BinaryNotationError`.
    #[must_use]
    pub fn new(message: impl Into<String>, code: BinaryNotationErrorCode) -> Self {
        Self {
            message: message.into(),
            code,
            position: None,
        }
    }

    /// Creates a new error with position.
    #[must_use]
    pub fn with_position(
        message: impl Into<String>,
        code: BinaryNotationErrorCode,
        position: usize,
    ) -> Self {
        Self {
            message: message.into(),
            code,
            position: Some(position),
        }
    }
}

impl Display for BinaryNotationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(pos) = self.position {
            write!(f, "{} (at position {})", self.message, pos)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl std::error::Error for BinaryNotationError {}

impl From<io::Error> for BinaryNotationError {
    fn from(err: io::Error) -> Self {
        Self::new(err.to_string(), BinaryNotationErrorCode::IoError)
    }
}

/// Result type for binary notation operations.
pub type BinaryNotationResult<T> = Result<T, BinaryNotationError>;

// =============================================================================
// VarInt Encoding/Decoding (LEB128)
// =============================================================================

/// Encodes a value as a variable-length integer (LEB128).
///
/// # Arguments
///
/// * `value` - The value to encode
/// * `writer` - Writer to write to
///
/// # Returns
///
/// Number of bytes written.
pub fn encode_varint<W: Write>(value: u64, writer: &mut W) -> io::Result<usize> {
    let mut v = value;
    let mut bytes_written = 0;

    loop {
        let mut byte = (v & 0x7F) as u8;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        writer.write_all(&[byte])?;
        bytes_written += 1;
        if v == 0 {
            break;
        }
    }

    Ok(bytes_written)
}

/// Decodes a variable-length integer (LEB128).
///
/// # Arguments
///
/// * `reader` - Reader to read from
///
/// # Returns
///
/// Decoded value.
pub fn decode_varint<R: Read>(reader: &mut R) -> BinaryNotationResult<u64> {
    let mut result: u64 = 0;
    let mut shift = 0;

    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;

        result |= u64::from(byte[0] & 0x7F) << shift;

        if byte[0] & 0x80 == 0 {
            break;
        }

        shift += 7;
        if shift > 63 {
            return Err(BinaryNotationError::new(
                "VarInt too large",
                BinaryNotationErrorCode::InvalidLiteral,
            ));
        }
    }

    Ok(result)
}

/// Gets the number of bytes needed to encode a value as varint.
#[must_use]
pub const fn varint_size(value: u64) -> usize {
    if value == 0 {
        return 1;
    }
    let bits = 64 - value.leading_zeros() as usize;
    (bits + 6) / 7
}

// =============================================================================
// String Encoding/Decoding
// =============================================================================

/// Encodes a string to the writer.
pub fn encode_string<W: Write>(s: &str, writer: &mut W) -> io::Result<usize> {
    let bytes = s.as_bytes();
    let len = bytes.len();

    let header_size = if len <= 255 {
        writer.write_all(&[LITERAL_STRING_SHORT])?;
        writer.write_all(&[len as u8])?;
        2
    } else if len <= 65535 {
        writer.write_all(&[LITERAL_STRING_MEDIUM])?;
        writer.write_all(&(len as u16).to_be_bytes())?;
        3
    } else {
        writer.write_all(&[LITERAL_STRING_LONG])?;
        writer.write_all(&(len as u32).to_be_bytes())?;
        5
    };

    writer.write_all(bytes)?;
    Ok(header_size + len)
}

/// Decodes a string from the reader.
pub fn decode_string<R: Read>(reader: &mut R) -> BinaryNotationResult<String> {
    let mut type_byte = [0u8; 1];
    reader.read_exact(&mut type_byte)?;

    let len = match type_byte[0] {
        LITERAL_STRING_SHORT => {
            let mut len_byte = [0u8; 1];
            reader.read_exact(&mut len_byte)?;
            usize::from(len_byte[0])
        }
        LITERAL_STRING_MEDIUM => {
            let mut len_bytes = [0u8; 2];
            reader.read_exact(&mut len_bytes)?;
            usize::from(u16::from_be_bytes(len_bytes))
        }
        LITERAL_STRING_LONG => {
            let mut len_bytes = [0u8; 4];
            reader.read_exact(&mut len_bytes)?;
            u32::from_be_bytes(len_bytes) as usize
        }
        _ => {
            return Err(BinaryNotationError::new(
                format!("Invalid string type: 0x{:02X}", type_byte[0]),
                BinaryNotationErrorCode::InvalidLiteral,
            ))
        }
    };

    let mut buffer = vec![0u8; len];
    reader.read_exact(&mut buffer)?;

    String::from_utf8(buffer).map_err(|e| {
        BinaryNotationError::new(
            format!("Invalid UTF-8 string: {e}"),
            BinaryNotationErrorCode::InvalidLiteral,
        )
    })
}

/// Gets the number of bytes needed to encode a string.
#[must_use]
pub const fn string_size(s: &str) -> usize {
    let len = s.len();
    if len <= 255 {
        2 + len
    } else if len <= 65535 {
        3 + len
    } else {
        5 + len
    }
}

// =============================================================================
// Value Encoding/Decoding
// =============================================================================

/// Encoded value type for binary notation.
#[derive(Debug, Clone)]
pub enum EncodedValue {
    /// Null value
    Null,
    /// Boolean value
    Bool(bool),
    /// Integer value
    Int(u64),
    /// String value
    String(String),
    /// Link value
    Link(Box<EncodedLink>),
}

/// Encoded link for binary notation.
#[derive(Debug, Clone)]
pub struct EncodedLink {
    /// Optional link ID
    pub id: Option<u64>,
    /// Source value
    pub source: EncodedValue,
    /// Target value
    pub target: EncodedValue,
    /// Additional values
    pub values: Vec<EncodedValue>,
}

impl EncodedLink {
    /// Creates a new encoded link.
    #[must_use]
    pub const fn new(id: Option<u64>, source: EncodedValue, target: EncodedValue) -> Self {
        Self {
            id,
            source,
            target,
            values: Vec::new(),
        }
    }

    /// Creates an encoded link with values.
    #[must_use]
    pub const fn with_values(
        id: Option<u64>,
        source: EncodedValue,
        target: EncodedValue,
        values: Vec<EncodedValue>,
    ) -> Self {
        Self {
            id,
            source,
            target,
            values,
        }
    }
}

/// Encodes a value to the writer.
pub fn encode_value<W: Write>(value: &EncodedValue, writer: &mut W) -> io::Result<usize> {
    match value {
        EncodedValue::Null => {
            writer.write_all(&[LITERAL_NULL])?;
            Ok(1)
        }
        EncodedValue::Bool(false) => {
            writer.write_all(&[LITERAL_FALSE])?;
            Ok(1)
        }
        EncodedValue::Bool(true) => {
            writer.write_all(&[LITERAL_TRUE])?;
            Ok(1)
        }
        EncodedValue::Int(n) => {
            writer.write_all(&[LITERAL_VARINT])?;
            let size = encode_varint(*n, writer)?;
            Ok(1 + size)
        }
        EncodedValue::String(s) => encode_string(s, writer),
        EncodedValue::Link(link) => {
            writer.write_all(&[LITERAL_LINK])?;
            let size = encode_link_body(link, writer)?;
            Ok(1 + size)
        }
    }
}

/// Encodes a value as an ID reference (just varint).
pub fn encode_value_as_id<W: Write>(value: u64, writer: &mut W) -> io::Result<usize> {
    encode_varint(value, writer)
}

/// Decodes a value from the reader.
pub fn decode_value<R: Read>(reader: &mut R) -> BinaryNotationResult<EncodedValue> {
    let mut type_byte = [0u8; 1];
    reader.read_exact(&mut type_byte)?;

    match type_byte[0] {
        LITERAL_NULL => Ok(EncodedValue::Null),
        LITERAL_FALSE => Ok(EncodedValue::Bool(false)),
        LITERAL_TRUE => Ok(EncodedValue::Bool(true)),
        LITERAL_VARINT => Ok(EncodedValue::Int(decode_varint(reader)?)),
        LITERAL_INT32 => {
            let mut bytes = [0u8; 4];
            reader.read_exact(&mut bytes)?;
            Ok(EncodedValue::Int(u64::from(u32::from_be_bytes(bytes))))
        }
        LITERAL_INT64 => {
            let mut bytes = [0u8; 8];
            reader.read_exact(&mut bytes)?;
            Ok(EncodedValue::Int(u64::from_be_bytes(bytes)))
        }
        LITERAL_STRING_SHORT | LITERAL_STRING_MEDIUM | LITERAL_STRING_LONG => {
            // Read length header based on type
            let mut temp = [0u8; 4];
            let len = match type_byte[0] {
                LITERAL_STRING_SHORT => {
                    reader.read_exact(&mut temp[..1])?;
                    usize::from(temp[0])
                }
                LITERAL_STRING_MEDIUM => {
                    reader.read_exact(&mut temp[..2])?;
                    usize::from(u16::from_be_bytes([temp[0], temp[1]]))
                }
                LITERAL_STRING_LONG => {
                    reader.read_exact(&mut temp[..4])?;
                    u32::from_be_bytes([temp[0], temp[1], temp[2], temp[3]]) as usize
                }
                _ => unreachable!(),
            };

            let mut data = vec![0u8; len];
            reader.read_exact(&mut data)?;

            String::from_utf8(data)
                .map(EncodedValue::String)
                .map_err(|e| {
                    BinaryNotationError::new(
                        format!("Invalid UTF-8 string: {e}"),
                        BinaryNotationErrorCode::InvalidLiteral,
                    )
                })
        }
        LITERAL_LINK => {
            let link = decode_link_body(reader)?;
            Ok(EncodedValue::Link(Box::new(link)))
        }
        _ => Err(BinaryNotationError::new(
            format!("Unknown literal type: 0x{:02X}", type_byte[0]),
            BinaryNotationErrorCode::InvalidLiteral,
        )),
    }
}

/// Decodes a value as an ID reference (just varint).
pub fn decode_value_as_id<R: Read>(reader: &mut R) -> BinaryNotationResult<u64> {
    decode_varint(reader)
}

/// Gets the number of bytes needed to encode a value.
#[must_use]
pub fn value_size(value: &EncodedValue) -> usize {
    match value {
        EncodedValue::Null | EncodedValue::Bool(_) => 1,
        EncodedValue::Int(n) => 1 + varint_size(*n),
        EncodedValue::String(s) => string_size(s),
        EncodedValue::Link(link) => 1 + link_body_size(link),
    }
}

// =============================================================================
// Link Body Encoding/Decoding
// =============================================================================

/// Encodes a link body to the writer.
pub fn encode_link_body<W: Write>(link: &EncodedLink, writer: &mut W) -> io::Result<usize> {
    let source_is_id = matches!(&link.source, EncodedValue::Int(_));
    let target_is_id = matches!(&link.target, EncodedValue::Int(_));

    let source_id = if let EncodedValue::Int(n) = &link.source {
        Some(*n)
    } else {
        None
    };
    let target_id = if let EncodedValue::Int(n) = &link.target {
        Some(*n)
    } else {
        None
    };

    let is_self_ref = source_is_id && target_is_id && source_id == target_id;

    // Determine type flags
    let mut type_byte = 0u8;
    if source_is_id {
        type_byte |= TYPE_SOURCE_IS_ID;
    }
    if target_is_id {
        type_byte |= TYPE_TARGET_IS_ID;
    }
    if is_self_ref {
        type_byte |= TYPE_SELF_REF;
    }
    if link.id.is_some() {
        type_byte |= TYPE_HAS_ID;
    }
    if !link.values.is_empty() {
        type_byte |= TYPE_HAS_VALUES;
    }

    writer.write_all(&[type_byte])?;
    let mut bytes_written = 1;

    // Write ID if present
    if let Some(id) = link.id {
        bytes_written += encode_varint(id, writer)?;
    }

    // Write source (or both for self-ref)
    if is_self_ref {
        if let Some(id) = source_id {
            bytes_written += encode_varint(id, writer)?;
        }
    } else {
        if source_is_id {
            if let Some(id) = source_id {
                bytes_written += encode_varint(id, writer)?;
            }
        } else {
            bytes_written += encode_value(&link.source, writer)?;
        }

        if target_is_id {
            if let Some(id) = target_id {
                bytes_written += encode_varint(id, writer)?;
            }
        } else {
            bytes_written += encode_value(&link.target, writer)?;
        }
    }

    // Write values array if present
    if !link.values.is_empty() {
        bytes_written += encode_varint(link.values.len() as u64, writer)?;
        for val in &link.values {
            bytes_written += encode_value(val, writer)?;
        }
    }

    Ok(bytes_written)
}

/// Decodes a link body from the reader.
pub fn decode_link_body<R: Read>(reader: &mut R) -> BinaryNotationResult<EncodedLink> {
    let mut type_byte = [0u8; 1];
    reader.read_exact(&mut type_byte)?;
    let type_byte = type_byte[0];

    let source_is_id = (type_byte & TYPE_SOURCE_IS_ID) != 0;
    let target_is_id = (type_byte & TYPE_TARGET_IS_ID) != 0;
    let is_self_ref = (type_byte & TYPE_SELF_REF) != 0;
    let has_id = (type_byte & TYPE_HAS_ID) != 0;
    let has_values = (type_byte & TYPE_HAS_VALUES) != 0;

    // Read ID if present
    let id = if has_id {
        Some(decode_varint(reader)?)
    } else {
        None
    };

    // Read source
    let source = if source_is_id {
        EncodedValue::Int(decode_varint(reader)?)
    } else {
        decode_value(reader)?
    };

    // Read target (or use source for self-ref)
    let target = if is_self_ref {
        source.clone()
    } else if target_is_id {
        EncodedValue::Int(decode_varint(reader)?)
    } else {
        decode_value(reader)?
    };

    // Read values array if present
    let values = if has_values {
        let count = decode_varint(reader)? as usize;
        let mut vals = Vec::with_capacity(count);
        for _ in 0..count {
            vals.push(decode_value(reader)?);
        }
        vals
    } else {
        Vec::new()
    };

    Ok(EncodedLink {
        id,
        source,
        target,
        values,
    })
}

/// Gets the number of bytes needed to encode a link body.
#[must_use]
pub fn link_body_size(link: &EncodedLink) -> usize {
    let source_is_id = matches!(&link.source, EncodedValue::Int(_));
    let target_is_id = matches!(&link.target, EncodedValue::Int(_));

    let source_id = if let EncodedValue::Int(n) = &link.source {
        Some(*n)
    } else {
        None
    };
    let target_id = if let EncodedValue::Int(n) = &link.target {
        Some(*n)
    } else {
        None
    };

    let is_self_ref = source_is_id && target_is_id && source_id == target_id;

    let mut size = 1; // type byte

    if let Some(id) = link.id {
        size += varint_size(id);
    }

    if is_self_ref {
        if let Some(id) = source_id {
            size += varint_size(id);
        }
    } else {
        if source_is_id {
            if let Some(id) = source_id {
                size += varint_size(id);
            }
        } else {
            size += value_size(&link.source);
        }

        if target_is_id {
            if let Some(id) = target_id {
                size += varint_size(id);
            }
        } else {
            size += value_size(&link.target);
        }
    }

    if !link.values.is_empty() {
        size += varint_size(link.values.len() as u64);
        for val in &link.values {
            size += value_size(val);
        }
    }

    size
}

// =============================================================================
// Conversion from Link<T>
// =============================================================================

impl<T: LinkType + Display + Copy> From<&Link<T>> for EncodedLink
where
    u64: From<T>,
{
    fn from(link: &Link<T>) -> Self {
        let id = Some(u64::from(link.id));
        let source = linkref_to_encoded(&link.source);
        let target = linkref_to_encoded(&link.target);

        let values = link
            .values
            .as_ref()
            .map(|vals| vals.iter().map(linkref_to_encoded).collect())
            .unwrap_or_default();

        Self {
            id,
            source,
            target,
            values,
        }
    }
}

fn linkref_to_encoded<T: LinkType + Display + Copy>(linkref: &LinkRef<T>) -> EncodedValue
where
    u64: From<T>,
{
    match linkref {
        LinkRef::Id(id) => EncodedValue::Int(u64::from(*id)),
        LinkRef::Link(link) => EncodedValue::Link(Box::new(EncodedLink::from(link.as_ref()))),
    }
}

impl<T: LinkType + TryFrom<u64> + FromStr + Copy + Default> TryFrom<EncodedLink> for Link<T>
where
    <T as TryFrom<u64>>::Error: std::fmt::Debug,
{
    type Error = BinaryNotationError;

    fn try_from(encoded: EncodedLink) -> Result<Self, Self::Error> {
        let id = encoded
            .id
            .map(|n| {
                T::try_from(n).map_err(|_| {
                    BinaryNotationError::new(
                        "Failed to convert ID",
                        BinaryNotationErrorCode::InvalidLiteral,
                    )
                })
            })
            .transpose()?
            .unwrap_or_default();

        let source = encoded_to_linkref::<T>(encoded.source)?;
        let target = encoded_to_linkref::<T>(encoded.target)?;

        let values = if encoded.values.is_empty() {
            None
        } else {
            Some(
                encoded
                    .values
                    .into_iter()
                    .map(encoded_to_linkref::<T>)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        };

        Ok(Self {
            id,
            source,
            target,
            values,
        })
    }
}

fn encoded_to_linkref<T: LinkType + TryFrom<u64> + FromStr + Copy + Default>(
    value: EncodedValue,
) -> BinaryNotationResult<LinkRef<T>>
where
    <T as TryFrom<u64>>::Error: std::fmt::Debug,
{
    match value {
        EncodedValue::Int(n) => T::try_from(n).map(LinkRef::Id).map_err(|_| {
            BinaryNotationError::new(
                "Failed to convert ID",
                BinaryNotationErrorCode::InvalidLiteral,
            )
        }),
        EncodedValue::Link(link) => {
            let converted: Link<T> = (*link).try_into()?;
            Ok(LinkRef::link(converted))
        }
        _ => Err(BinaryNotationError::new(
            "Unsupported value type in link reference",
            BinaryNotationErrorCode::InvalidLiteral,
        )),
    }
}

// =============================================================================
// BinaryNotation API
// =============================================================================

/// Binary Links Notation encoder/decoder.
///
/// Provides methods for encoding links to binary format and decoding
/// binary data back to links.
pub struct BinaryNotation;

/// Options for encoding to binary format.
#[derive(Debug, Clone, Default)]
pub struct EncodeOptions {
    /// Protocol version (default: current)
    pub version: Option<u16>,
    /// Additional flags
    pub flags: u8,
}

/// Options for decoding from binary format.
#[derive(Debug, Clone, Default)]
pub struct DecodeOptions {
    /// Skip version check
    pub ignore_version: bool,
}

impl BinaryNotation {
    /// Encodes links to binary format.
    ///
    /// # Arguments
    ///
    /// * `links` - Links to encode
    /// * `options` - Encoding options
    ///
    /// # Returns
    ///
    /// Encoded binary data.
    pub fn encode(
        links: &[EncodedLink],
        options: Option<EncodeOptions>,
    ) -> BinaryNotationResult<Vec<u8>> {
        let options = options.unwrap_or_default();

        // Calculate payload size
        let mut payload_size = varint_size(links.len() as u64);
        for link in links {
            payload_size += link_body_size(link);
        }

        // Allocate buffer
        let mut buffer = Vec::with_capacity(HEADER_SIZE + payload_size);

        // Write header
        buffer.extend_from_slice(&MAGIC.to_be_bytes());
        buffer.extend_from_slice(&options.version.unwrap_or(VERSION).to_be_bytes());
        buffer.push(options.flags);
        buffer.extend_from_slice(&(payload_size as u32).to_be_bytes());

        // Write payload
        let mut cursor = std::io::Cursor::new(&mut buffer);
        cursor.set_position(HEADER_SIZE as u64);

        encode_varint(links.len() as u64, &mut cursor)?;

        for link in links {
            encode_link_body(link, &mut cursor)?;
        }

        Ok(buffer)
    }

    /// Encodes typed links to binary format.
    pub fn encode_links<T: LinkType + Display + Copy>(
        links: &[Link<T>],
        options: Option<EncodeOptions>,
    ) -> BinaryNotationResult<Vec<u8>>
    where
        u64: From<T>,
    {
        let encoded: Vec<EncodedLink> = links.iter().map(EncodedLink::from).collect();
        Self::encode(&encoded, options)
    }

    /// Decodes binary data to encoded links.
    ///
    /// # Arguments
    ///
    /// * `data` - Binary data to decode
    /// * `options` - Decoding options
    ///
    /// # Returns
    ///
    /// Decoded links.
    pub fn decode(
        data: &[u8],
        options: Option<DecodeOptions>,
    ) -> BinaryNotationResult<Vec<EncodedLink>> {
        let options = options.unwrap_or_default();

        if data.len() < HEADER_SIZE {
            return Err(BinaryNotationError::with_position(
                format!(
                    "Buffer too small: expected at least {} bytes, got {}",
                    HEADER_SIZE,
                    data.len()
                ),
                BinaryNotationErrorCode::TruncatedMessage,
                0,
            ));
        }

        // Validate magic
        let magic = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
        if magic != MAGIC {
            return Err(BinaryNotationError::with_position(
                format!("Invalid magic number: expected 0x{MAGIC:08X}, got 0x{magic:08X}"),
                BinaryNotationErrorCode::InvalidMagic,
                0,
            ));
        }

        // Check version
        let version = u16::from_be_bytes([data[4], data[5]]);
        let major_version = (version >> 8) & 0xFF;
        let expected_major = (VERSION >> 8) & 0xFF;
        if major_version > expected_major && !options.ignore_version {
            return Err(BinaryNotationError::with_position(
                format!(
                    "Unsupported version: {major_version}.x (expected {expected_major}.x or lower)"
                ),
                BinaryNotationErrorCode::UnsupportedVersion,
                4,
            ));
        }

        // Read flags
        let flags = data[6];

        // Check for compression
        if (flags & FLAG_COMPRESSED) != 0 {
            return Err(BinaryNotationError::with_position(
                "Compression not yet supported",
                BinaryNotationErrorCode::InvalidFlags,
                6,
            ));
        }

        // Read payload length
        let payload_length = u32::from_be_bytes([data[7], data[8], data[9], data[10]]) as usize;

        if data.len() < HEADER_SIZE + payload_length {
            return Err(BinaryNotationError::with_position(
                format!(
                    "Buffer truncated: expected {} bytes, got {}",
                    HEADER_SIZE + payload_length,
                    data.len()
                ),
                BinaryNotationErrorCode::TruncatedMessage,
                7,
            ));
        }

        // Decode payload
        let mut cursor = std::io::Cursor::new(&data[HEADER_SIZE..]);

        let count = decode_varint(&mut cursor)? as usize;

        let mut links = Vec::with_capacity(count);
        for _ in 0..count {
            links.push(decode_link_body(&mut cursor)?);
        }

        Ok(links)
    }

    /// Decodes binary data to typed links.
    pub fn decode_links<T: LinkType + TryFrom<u64> + FromStr + Copy + Default>(
        data: &[u8],
        options: Option<DecodeOptions>,
    ) -> BinaryNotationResult<Vec<Link<T>>>
    where
        <T as TryFrom<u64>>::Error: std::fmt::Debug,
    {
        let encoded = Self::decode(data, options)?;
        encoded.into_iter().map(TryInto::try_into).collect()
    }

    /// Checks if data appears to be binary notation.
    #[must_use]
    pub fn is_binary(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        let magic = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
        magic == MAGIC
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod varint_tests {
        use super::*;

        #[test]
        fn test_encode_decode_zero() {
            let mut buf = Vec::new();
            encode_varint(0, &mut buf).unwrap();
            assert_eq!(buf, vec![0x00]);

            let mut cursor = std::io::Cursor::new(buf);
            assert_eq!(decode_varint(&mut cursor).unwrap(), 0);
        }

        #[test]
        fn test_encode_decode_127() {
            let mut buf = Vec::new();
            encode_varint(127, &mut buf).unwrap();
            assert_eq!(buf, vec![0x7F]);

            let mut cursor = std::io::Cursor::new(buf);
            assert_eq!(decode_varint(&mut cursor).unwrap(), 127);
        }

        #[test]
        fn test_encode_decode_128() {
            let mut buf = Vec::new();
            encode_varint(128, &mut buf).unwrap();
            assert_eq!(buf, vec![0x80, 0x01]);

            let mut cursor = std::io::Cursor::new(buf);
            assert_eq!(decode_varint(&mut cursor).unwrap(), 128);
        }

        #[test]
        fn test_varint_size() {
            assert_eq!(varint_size(0), 1);
            assert_eq!(varint_size(127), 1);
            assert_eq!(varint_size(128), 2);
            assert_eq!(varint_size(16383), 2);
            assert_eq!(varint_size(16384), 3);
        }
    }

    mod string_tests {
        use super::*;

        #[test]
        fn test_encode_decode_empty() {
            let mut buf = Vec::new();
            encode_string("", &mut buf).unwrap();

            let mut cursor = std::io::Cursor::new(buf);
            assert_eq!(decode_string(&mut cursor).unwrap(), "");
        }

        #[test]
        fn test_encode_decode_hello() {
            let mut buf = Vec::new();
            encode_string("hello", &mut buf).unwrap();

            let mut cursor = std::io::Cursor::new(buf);
            assert_eq!(decode_string(&mut cursor).unwrap(), "hello");
        }

        #[test]
        fn test_string_size() {
            assert_eq!(string_size(""), 2);
            assert_eq!(string_size("hello"), 2 + 5);
        }
    }

    mod link_tests {
        use super::*;

        #[test]
        fn test_encode_decode_simple_link() {
            let link = EncodedLink::new(Some(1), EncodedValue::Int(2), EncodedValue::Int(3));

            let mut buf = Vec::new();
            encode_link_body(&link, &mut buf).unwrap();

            let mut cursor = std::io::Cursor::new(buf);
            let decoded = decode_link_body(&mut cursor).unwrap();

            assert_eq!(decoded.id, Some(1));
            assert!(matches!(decoded.source, EncodedValue::Int(2)));
            assert!(matches!(decoded.target, EncodedValue::Int(3)));
        }

        #[test]
        fn test_encode_decode_self_ref_link() {
            let link = EncodedLink::new(Some(5), EncodedValue::Int(5), EncodedValue::Int(5));

            let mut buf = Vec::new();
            let size = encode_link_body(&link, &mut buf).unwrap();

            // Self-ref should be compact
            assert!(size <= 3);

            let mut cursor = std::io::Cursor::new(buf);
            let decoded = decode_link_body(&mut cursor).unwrap();

            assert_eq!(decoded.id, Some(5));
            assert!(matches!(decoded.source, EncodedValue::Int(5)));
            assert!(matches!(decoded.target, EncodedValue::Int(5)));
        }

        #[test]
        fn test_encode_decode_link_with_values() {
            let link = EncodedLink::with_values(
                Some(1),
                EncodedValue::Int(2),
                EncodedValue::Int(3),
                vec![EncodedValue::Int(4), EncodedValue::Int(5)],
            );

            let mut buf = Vec::new();
            encode_link_body(&link, &mut buf).unwrap();

            let mut cursor = std::io::Cursor::new(buf);
            let decoded = decode_link_body(&mut cursor).unwrap();

            assert_eq!(decoded.values.len(), 2);
        }
    }

    mod binary_notation_tests {
        use super::*;

        #[test]
        fn test_encode_decode_single_link() {
            let links = vec![EncodedLink::new(
                Some(1),
                EncodedValue::Int(2),
                EncodedValue::Int(3),
            )];

            let buffer = BinaryNotation::encode(&links, None).unwrap();
            let decoded = BinaryNotation::decode(&buffer, None).unwrap();

            assert_eq!(decoded.len(), 1);
            assert_eq!(decoded[0].id, Some(1));
        }

        #[test]
        fn test_encode_decode_multiple_links() {
            let links = vec![
                EncodedLink::new(Some(1), EncodedValue::Int(2), EncodedValue::Int(3)),
                EncodedLink::new(Some(4), EncodedValue::Int(5), EncodedValue::Int(6)),
            ];

            let buffer = BinaryNotation::encode(&links, None).unwrap();
            let decoded = BinaryNotation::decode(&buffer, None).unwrap();

            assert_eq!(decoded.len(), 2);
        }

        #[test]
        fn test_is_binary() {
            let links = vec![EncodedLink::new(
                Some(1),
                EncodedValue::Int(2),
                EncodedValue::Int(3),
            )];
            let buffer = BinaryNotation::encode(&links, None).unwrap();

            assert!(BinaryNotation::is_binary(&buffer));
            assert!(!BinaryNotation::is_binary(b"(1 2)"));
            assert!(!BinaryNotation::is_binary(&[1, 2, 3]));
        }

        #[test]
        fn test_decode_invalid_magic() {
            let buffer = vec![0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
            let result = BinaryNotation::decode(&buffer, None);
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err().code,
                BinaryNotationErrorCode::InvalidMagic
            );
        }

        #[test]
        fn test_decode_truncated() {
            let result = BinaryNotation::decode(&[1, 2, 3], None);
            assert!(result.is_err());
            assert_eq!(
                result.unwrap_err().code,
                BinaryNotationErrorCode::TruncatedMessage
            );
        }
    }

    mod typed_link_tests {
        use super::*;

        #[test]
        fn test_encode_typed_links() {
            let link1 = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
            let link2 = Link::new(4u64, LinkRef::Id(5), LinkRef::Id(6));

            let buffer = BinaryNotation::encode_links(&[link1, link2], None).unwrap();
            let decoded: Vec<Link<u64>> = BinaryNotation::decode_links(&buffer, None).unwrap();

            assert_eq!(decoded.len(), 2);
            assert_eq!(decoded[0].id, 1);
            assert_eq!(decoded[0].source_id(), 2);
            assert_eq!(decoded[0].target_id(), 3);
        }
    }
}
