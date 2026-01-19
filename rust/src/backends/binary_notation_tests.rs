//! Tests for binary notation encoding/decoding.
//!
//! This module contains unit tests for the binary notation implementation.

use super::*;
use crate::{Link, LinkRef};

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
