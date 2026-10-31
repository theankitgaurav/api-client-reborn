use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

pub struct StreamSpooler {
    file: Option<File>,
    path: PathBuf,
    total_bytes: usize,
    chunk_count: usize,
    start_time: Instant,
}

impl Drop for StreamSpooler {
    fn drop(&mut self) {
        // Keep completed spool files for history/export, but remove partial files
        // left behind when a request is cancelled or fails before `finish`.
        if self.file.take().is_some() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

impl StreamSpooler {
    pub async fn new(workspace_root: Option<&Path>) -> Result<Self> {
        let dir = if let Some(root) = workspace_root {
            root.join(".apiclient").join("cache")
        } else {
            std::env::temp_dir().join("apiclient_cache")
        };

        if !dir.exists() {
            let _ = fs::create_dir_all(&dir).await;
        }

        let file_name = format!("stream_{}.bin", Uuid::new_v4());
        let path = dir.join(file_name);

        let file = File::create(&path)
            .await
            .map_err(|e| AppError::FsError(format!("Failed to create spool file: {}", e)))?;

        Ok(Self {
            file: Some(file),
            path,
            total_bytes: 0,
            chunk_count: 0,
            start_time: Instant::now(),
        })
    }

    pub async fn write(&mut self, bytes: &[u8]) -> Result<()> {
        if let Some(file) = &mut self.file {
            file.write_all(bytes)
                .await
                .map_err(|e| AppError::FsError(format!("Failed writing spool: {}", e)))?;
            self.total_bytes += bytes.len();
            self.chunk_count += 1;
        }
        Ok(())
    }

    pub async fn finish(&mut self) -> Result<(PathBuf, usize)> {
        if let Some(mut file) = self.file.take() {
            file.flush()
                .await
                .map_err(|e| AppError::FsError(format!("Failed flushing spool: {}", e)))?;
        }
        Ok((self.path.clone(), self.total_bytes))
    }

    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }

    pub fn chunk_count(&self) -> usize {
        self.chunk_count
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.start_time.elapsed().as_millis() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_spooler_lifecycle() {
        let mut spooler = StreamSpooler::new(None).await.unwrap();
        assert_eq!(spooler.total_bytes(), 0);

        let sample_data = b"Hello, streaming world!";
        spooler.write(sample_data).await.unwrap();
        assert_eq!(spooler.total_bytes(), sample_data.len());

        let (path, total) = spooler.finish().await.unwrap();
        assert_eq!(total, sample_data.len());
        assert!(path.exists());

        let read_back = tokio::fs::read(&path).await.unwrap();
        assert_eq!(read_back, sample_data);

        // Cleanup
        let _ = tokio::fs::remove_file(path).await;
    }
}
