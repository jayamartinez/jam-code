//! Terminal output handling that does not depend on a live process.

/// Decodes a byte stream as UTF-8 across read boundaries. A multi-byte
/// character split between two reads is held back rather than replaced.
#[derive(Default)]
pub(crate) struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        let mut data = std::mem::take(&mut self.pending);
        data.extend_from_slice(bytes);
        let mut out = String::with_capacity(data.len());
        let mut rest = data.as_slice();
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    out.push_str(text);
                    rest = &[];
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match error.error_len() {
                        // Invalid bytes are shown, not dropped silently.
                        Some(length) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            rest = &after[length..];
                        }
                        // An incomplete character at the end waits for the next read.
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.pending = rest.to_vec();
        out
    }
}

/// Recent output kept so a view that attaches later can redraw the screen.
///
/// It is bounded: the oldest output is discarded first, cut at a line break
/// where one is close so a replay rarely starts inside an escape sequence.
pub(crate) struct Replay {
    text: String,
    limit: usize,
}

impl Replay {
    pub fn new(limit: usize) -> Self {
        Self {
            text: String::new(),
            limit,
        }
    }

    pub fn push(&mut self, output: &str) {
        self.text.push_str(output);
        if self.text.len() <= self.limit {
            return;
        }
        // Trim to three quarters so trimming is not repeated on every chunk.
        let mut cut = self.text.len() - self.limit * 3 / 4;
        while !self.text.is_char_boundary(cut) {
            cut += 1;
        }
        if let Some(line) = self.text[cut..].find('\n').filter(|offset| *offset < 4096) {
            cut += line + 1;
        }
        self.text.drain(..cut);
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn clear(&mut self) {
        self.text.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_characters_are_joined() {
        let mut stream = Utf8Stream::default();
        let bytes = "a→b".as_bytes();
        assert_eq!(stream.push(&bytes[..2]), "a");
        assert_eq!(stream.push(&bytes[2..]), "→b");
    }

    #[test]
    fn invalid_bytes_are_replaced() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(b"a\xffb"), "a\u{FFFD}b");
    }

    #[test]
    fn replay_is_bounded_and_starts_on_a_line() {
        let mut replay = Replay::new(64);
        for index in 0..100 {
            replay.push(&format!("line {index}\n"));
        }
        assert!(replay.text().len() <= 64);
        assert!(replay.text().starts_with("line "));
        assert!(replay.text().ends_with("line 99\n"));
    }
}
