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
    pub children: Option<Vec<WorkspaceFileItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentItem {
    pub name: String,
    pub file_path: String,
    pub variables: Vec<(String, String)>,
}
