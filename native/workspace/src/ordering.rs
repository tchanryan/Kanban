// Default-alphabet port of fractional-indexing (CC0), by David Greenspan.
// Reference: node_modules/fractional-indexing/src/index.js. No custom alphabets.
use crate::model::{Result, StorageError};
const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const HEADS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn length(head: u8) -> Result<usize> {
    let i = HEADS
        .iter()
        .position(|v| *v == head)
        .ok_or_else(|| StorageError::invalid("Invalid order key head"))?;
    Ok(if i < 26 { 27 - i } else { i - 24 })
}
pub fn validate(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 1000 || !key.is_ascii() {
        return Err(StorageError::invalid("Invalid order key"));
    }
    let n = length(key.as_bytes()[0])?;
    if key.len() < n
        || key.as_bytes()[1..].iter().any(|c| !DIGITS.contains(c))
        || (key.len() > n && key.ends_with('0'))
        || key == format!("A{}", "0".repeat(26))
    {
        return Err(StorageError::invalid("Invalid order key"));
    }
    Ok(())
}
fn integer(key: &str) -> &str {
    &key[..length(key.as_bytes()[0]).expect("validated key")]
}
fn step(key: &str, up: bool) -> Option<String> {
    let mut bytes = key.as_bytes().to_vec();
    for i in (1..bytes.len()).rev() {
        let d = DIGITS.iter().position(|x| *x == bytes[i])?;
        if up && d < 61 {
            bytes[i] = DIGITS[d + 1];
            return String::from_utf8(bytes).ok();
        }
        if !up && d > 0 {
            bytes[i] = DIGITS[d - 1];
            return String::from_utf8(bytes).ok();
        }
        bytes[i] = if up { b'0' } else { b'z' };
    }
    let index = HEADS.iter().position(|x| *x == bytes[0])?;
    let next = if up {
        index.checked_add(1)?
    } else {
        index.checked_sub(1)?
    };
    let head = *HEADS.get(next)?;
    let n = length(head).ok()?;
    Some(format!(
        "{}{}",
        head as char,
        if up { "0" } else { "z" }.repeat(n - 1)
    ))
}
fn midpoint(a: &str, b: Option<&str>) -> Result<String> {
    if b.is_some_and(|v| a >= v) || a.ends_with('0') || b.is_some_and(|v| v.ends_with('0')) {
        return Err(StorageError::invalid("Invalid ordering bounds"));
    }
    if let Some(b) = b {
        let n = b
            .bytes()
            .enumerate()
            .take_while(|(i, c)| a.as_bytes().get(*i).copied().unwrap_or(b'0') == *c)
            .count();
        if n > 0 {
            return Ok(format!(
                "{}{}",
                &b[..n],
                midpoint(a.get(n..).unwrap_or(""), Some(&b[n..]))?
            ));
        }
    }
    let da = a
        .bytes()
        .next()
        .map(|c| DIGITS.iter().position(|v| *v == c).unwrap())
        .unwrap_or(0);
    let db = b
        .map(|v| DIGITS.iter().position(|c| *c == v.as_bytes()[0]).unwrap())
        .unwrap_or(62);
    if db - da > 1 {
        return Ok((DIGITS[(da + db).div_ceil(2)] as char).to_string());
    }
    if let Some(b) = b {
        if b.len() > 1 {
            return Ok(b[..1].into());
        }
    }
    Ok(format!(
        "{}{}",
        DIGITS[da] as char,
        midpoint(a.get(1..).unwrap_or(""), None)?
    ))
}
pub fn between<'a>(mut a: Option<&'a str>, mut b: Option<&'a str>) -> Result<String> {
    if let Some(a) = a {
        validate(a)?;
    }
    if let Some(b) = b {
        validate(b)?;
    }
    if a.zip(b).is_some_and(|(a, b)| a > b) {
        std::mem::swap(&mut a, &mut b);
    }
    let result = match (a, b) {
        (None, None) => "a0".into(),
        (None, Some(b)) => {
            let ib = integer(b);
            if ib == format!("A{}", "0".repeat(26)) {
                format!("{}{}", ib, midpoint("", Some(&b[ib.len()..]))?)
            } else if ib < b {
                ib.into()
            } else {
                step(ib, false).ok_or_else(|| StorageError::invalid("Ordering exhausted"))?
            }
        }
        (Some(a), None) => {
            let ia = integer(a);
            match step(ia, true) {
                Some(i) => i,
                None => format!("{}{}", ia, midpoint(&a[ia.len()..], None)?),
            }
        }
        (Some(a), Some(b)) => {
            let ia = integer(a);
            let ib = integer(b);
            if ia == ib {
                format!("{}{}", ia, midpoint(&a[ia.len()..], Some(&b[ib.len()..]))?)
            } else {
                let i =
                    step(ia, true).ok_or_else(|| StorageError::invalid("Ordering exhausted"))?;
                if i.as_str() < b {
                    i
                } else {
                    format!("{}{}", ia, midpoint(&a[ia.len()..], None)?)
                }
            }
        }
    };
    validate(&result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    #[test]
    fn matches_web_ordering_across_integer_boundaries_and_dense_insertions() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/web-contract.json")).unwrap();
        for case in fixture["ordering"].as_array().unwrap() {
            assert_eq!(
                super::between(case["a"].as_str(), case["b"].as_str()).unwrap(),
                case["result"].as_str().unwrap()
            );
        }
        for invalid in ["", "a", "a00", "☃", "a!", "A00000000000000000000000000"] {
            assert!(super::validate(invalid).is_err());
        }
    }
}
