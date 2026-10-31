use crate::parser::curl::HeaderPair;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ResponseChunk {
    Started {
        request_id: String,
    },
    HeaderReceived {
        status: u16,
        status_text: String,
        headers: Vec<HeaderPair>,
        protocol: String,
        ttfb_ms: u64,
        is_streaming: bool,
    },
    BodyChunk {
        text: String,
        bytes_received: usize,
    },
    SseChunk {
        id: Option<String>,
        event: Option<String>,
        data: String,
    },
    Finished {
        total_duration_ms: u64,
        total_bytes: usize,
        #[serde(default)]
        spool_file_path: Option<String>,
    },
    Failed {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFileItem {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub display_name: Option<String>,
    pub method: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    pub children: Option<Vec<WorkspaceFileItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentItem {
    pub name: String,
    pub file_path: String,
    pub variables: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestHistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub request_name: String,
    pub request_path: Option<String>,
    pub method: String,
    pub url: String,
    pub raw_command: String,
    pub status: Option<u16>,
    pub status_text: String,
    pub headers: Vec<HeaderPair>,
    pub response_body: String,
    pub duration_ms: Option<u64>,
    pub total_bytes: usize,
    pub is_streaming: bool,
    #[serde(default)]
    pub response_file_path: Option<String>,
    #[serde(default)]
    pub is_body_truncated: bool,
    #[serde(default)]
    pub total_events_count: usize,
    pub error: Option<String>,
}
