use crate::engine::spooler::StreamSpooler;
use crate::error::{AppError, Result};
use crate::ipc::types::ResponseChunk;
use crate::parser::curl::HeaderPair;
use crate::parser::lexer::tokenize_command;
use std::time::Instant;
use tauri::ipc::Channel;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

/// Parses a raw grpcurl command string into clean CLI arguments.
pub fn parse_grpcurl_args(command_str: &str) -> Result<Vec<String>> {
    let tokens = tokenize_command(command_str)?;

    if tokens.is_empty() {
        return Err(AppError::CurlParserError("Empty grpcurl command".to_string()));
    }

    // Strip leading "grpcurl" if present
    let args = if tokens[0] == "grpcurl" {
        tokens[1..].to_vec()
    } else {
        tokens
    };

    Ok(args)
}

/// Executes a gRPC request by invoking `grpcurl` as a managed asynchronous child process
/// with streaming stdout/stderr, disk spooling, and cancellation token integration.
pub async fn execute_grpc_request(
    request_id: String,
    command_str: String,
    cancel_token: CancellationToken,
    channel: Channel<ResponseChunk>,
) -> Result<()> {
    let start_time = Instant::now();

    // 1. Notify that request started
    let _ = channel.send(ResponseChunk::Started {
        request_id: request_id.clone(),
    });

    let args = parse_grpcurl_args(&command_str)?;

    let mut spooler = StreamSpooler::new(None).await?;

    let mut cmd = tokio::process::Command::new("grpcurl");
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let err_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "grpcurl executable not found in system PATH. To execute gRPC requests, please install grpcurl (e.g. 'brew install grpcurl' or download from https://github.com/fullstorydev/grpcurl/releases).".to_string()
            } else {
                format!("Failed to execute grpcurl: {}", e)
            };
            let _ = channel.send(ResponseChunk::Failed {
                error: err_msg.clone(),
            });
            return Err(AppError::InternalError(err_msg));
        }
    };

    let ttfb_ms = start_time.elapsed().as_millis() as u64;

    // 2. Initial header notification
    let _ = channel.send(ResponseChunk::HeaderReceived {
        status: 200,
        status_text: "OK (gRPC)".to_string(),
        headers: vec![
            HeaderPair {
                key: "content-type".to_string(),
                value: "application/grpc+json".to_string(),
            },
            HeaderPair {
                key: "protocol".to_string(),
                value: "gRPC over HTTP/2".to_string(),
            },
        ],
        protocol: "gRPC/HTTP2".to_string(),
        ttfb_ms,
        is_streaming: true,
    });

    let mut stdout = child.stdout.take().expect("Child stdout must be piped");
    let mut stderr = child.stderr.take().expect("Child stderr must be piped");

    let mut buf = [0u8; 8192];
    let mut last_ipc_emit = Instant::now();
    let mut stderr_output = String::new();

    // 3. Read stdout stream with cancellation support
    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = child.kill().await;
                let _ = channel.send(ResponseChunk::Failed {
                    error: "gRPC stream was cancelled".to_string(),
                });
                return Err(AppError::Cancelled);
            }
            read_result = stdout.read(&mut buf) => {
                match read_result {
                    Ok(0) => {
                        // EOF on stdout
                        break;
                    }
                    Ok(n) => {
                        let chunk_bytes = &buf[..n];
                        spooler.write(chunk_bytes).await?;
                        let total_bytes = spooler.total_bytes();

                        // Memory & IPC defense: send text up to 2 MB, then throttle progress updates
                        let should_send_text = total_bytes <= 2 * 1024 * 1024;
                        let now = Instant::now();

                        if should_send_text || now.duration_since(last_ipc_emit).as_millis() >= 40 {
                            let text = if should_send_text {
                                String::from_utf8_lossy(chunk_bytes).to_string()
                            } else {
                                String::new()
                            };
                            let _ = channel.send(ResponseChunk::BodyChunk {
                                text,
                                bytes_received: total_bytes,
                            });
                            last_ipc_emit = now;
                        }
                    }
                    Err(e) => {
                        let _ = channel.send(ResponseChunk::Failed {
                            error: format!("gRPC read error: {}", e),
                        });
                        return Err(AppError::InternalError(e.to_string()));
                    }
                }
            }
        }
    }

    // Read any remaining stderr output
    let _ = stderr.read_to_string(&mut stderr_output).await;

    let status = child
        .wait()
        .await
        .map_err(|e| AppError::InternalError(e.to_string()))?;

    if !status.success() && spooler.total_bytes() == 0 {
        let err = if !stderr_output.trim().is_empty() {
            stderr_output.trim().to_string()
        } else {
            format!("grpcurl exited with code {}", status.code().unwrap_or(-1))
        };
        let _ = channel.send(ResponseChunk::Failed { error: err.clone() });
        return Err(AppError::InternalError(err));
    }

    let (spool_path, total_bytes) = spooler.finish().await?;
    let total_duration_ms = start_time.elapsed().as_millis() as u64;

    let _ = channel.send(ResponseChunk::Finished {
        total_duration_ms,
        total_bytes,
        spool_file_path: Some(spool_path.to_string_lossy().to_string()),
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_grpcurl_args() {
        let cmd = "grpcurl -plaintext -H \"Authorization: Bearer my_token\" -d '{\"id\": 42}' localhost:50051 api.v1.UserService/GetUser";
        let args = parse_grpcurl_args(cmd).unwrap();

        assert_eq!(args[0], "-plaintext");
        assert_eq!(args[1], "-H");
        assert_eq!(args[2], "Authorization: Bearer my_token");
        assert_eq!(args[3], "-d");
        assert_eq!(args[4], "{\"id\": 42}");
        assert_eq!(args[5], "localhost:50051");
        assert_eq!(args[6], "api.v1.UserService/GetUser");
    }

    #[test]
    fn test_parse_grpcurl_args_multiline() {
        let cmd = "grpcurl -plaintext \\\n  -d '{\"name\": \"test\"}' \\\n  localhost:50051 TestService/Call";
        let args = parse_grpcurl_args(cmd).unwrap();

        assert_eq!(args[0], "-plaintext");
        assert_eq!(args[1], "-d");
        assert_eq!(args[2], "{\"name\": \"test\"}");
        assert_eq!(args[3], "localhost:50051");
        assert_eq!(args[4], "TestService/Call");
    }
}
