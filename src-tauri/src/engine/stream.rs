use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SseEvent {
    pub id: Option<String>,
    pub event: Option<String>,
    pub data: String,
    pub retry: Option<u64>,
}

#[derive(Default)]
pub struct SseParser {
    buffer: String,
    current_event: SseEvent,
}

impl SseParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds raw incoming text bytes and returns zero or more completed SSE events
    pub fn feed(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();

        while let Some(pos) = self.buffer.find("\n\n") {
            let event_block = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 2..].to_string();

            if let Some(event) = self.parse_block(&event_block) {
                events.push(event);
            }
        }

        // Also handle CRLF: \r\n\r\n
        while let Some(pos) = self.buffer.find("\r\n\r\n") {
            let event_block = self.buffer[..pos].to_string();
            self.buffer = self.buffer[pos + 4..].to_string();

            if let Some(event) = self.parse_block(&event_block) {
                events.push(event);
            }
        }

        events
    }

    fn parse_block(&self, block: &str) -> Option<SseEvent> {
        let mut id = None;
        let mut event = None;
        let mut data_lines = Vec::new();
        let mut retry = None;

        for line in block.lines() {
            let line = line.trim_end();
            if line.starts_with(':') || line.is_empty() {
                // Comment line or empty line
                continue;
            }

            if let Some((field, value)) = line.split_once(':') {
                let value = value.strip_prefix(' ').unwrap_or(value);
                match field {
                    "id" => id = Some(value.to_string()),
                    "event" => event = Some(value.to_string()),
                    "data" => data_lines.push(value.to_string()),
                    "retry" => retry = value.parse::<u64>().ok(),
                    _ => {}
                }
            } else {
                // Field with no colon
                if line == "data" {
                    data_lines.push(String::new());
                }
            }
        }

        if id.is_none() && event.is_none() && data_lines.is_empty() {
            return None;
        }

        Some(SseEvent {
            id,
            event,
            data: data_lines.join("\n"),
            retry,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sse_parser() {
        let mut parser = SseParser::new();
        let chunk1 = "event: message\ndata: Hello World\n\n";
        let events = parser.feed(chunk1);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "Hello World");

        let chunk2 = "id: 42\ndata: Line 1\ndata: Line 2\n\n";
        let events2 = parser.feed(chunk2);
        assert_eq!(events2.len(), 1);
        assert_eq!(events2[0].id.as_deref(), Some("42"));
        assert_eq!(events2[0].data, "Line 1\nLine 2");
    }
}
