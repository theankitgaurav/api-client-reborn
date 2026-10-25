use crate::error::{AppError, Result};
use crate::parser::comment_meta::SidecarMetadata;
use std::fs;
use std::path::Path;

/// Reads the companion `.meta.json` if present for a given `.curl` file path
pub fn read_sidecar_meta(curl_path: &Path) -> Option<SidecarMetadata> {
    let sidecar_path = curl_path.with_extension("meta.json");
    if !sidecar_path.exists() {
        return None;
    }

    if let Ok(content) = fs::read_to_string(&sidecar_path) {
        serde_json::from_str::<SidecarMetadata>(&content).ok()
    } else {
        None
    }
}

/// Saves the companion `.meta.json` alongside the `.curl` file.
/// If metadata is empty/default, removes existing sidecar to keep workspace clean.
pub fn save_sidecar_meta(curl_path: &Path, meta: &SidecarMetadata) -> Result<()> {
    let sidecar_path = curl_path.with_extension("meta.json");

    if meta.tests.is_empty()
        && meta.tab_color.is_none()
        && meta.description.is_none()
        && meta.pre_request_script.is_none()
        && meta.post_response_script.is_none()
    {
        if sidecar_path.exists() {
            let _ = fs::remove_file(sidecar_path);
        }
        return Ok(());
    }

    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| AppError::FsError(format!("Serialization error: {}", e)))?;

    fs::write(sidecar_path, json)
        .map_err(|e| AppError::FsError(format!("Failed to write sidecar: {}", e)))?;

    Ok(())
}
