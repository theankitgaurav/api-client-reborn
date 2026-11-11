use crate::engine::spooler::StreamSpooler;
use crate::engine::stream::SseParser;
use crate::error::{AppError, Result};
use crate::ipc::types::ResponseChunk;
use crate::parser::curl::{BasicAuth, HeaderPair, HttpMethod, ParsedCurlRequest};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use std::path::Path;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

pub async fn execute_http_request(
    request_id: String,
    parsed: ParsedCurlRequest,
    cancel_token: CancellationToken,
    channel: Channel<ResponseChunk>,
) -> Result<()> {
    let start_time = Instant::now();

    // 1. Notify that request started
    let _ = channel.send(ResponseChunk::Started {
        request_id: request_id.clone(),
    });

    // 2. Build client
    let mut client_builder = reqwest::Client::builder();

    if parsed.insecure {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }

    if parsed.follow_redirects {
        client_builder = client_builder.redirect(Policy::limited(10));
    } else {
        client_builder = client_builder.redirect(Policy::none());
    }

    if let Some(timeout_ms) = parsed.timeout_ms {
        client_builder = client_builder.timeout(Duration::from_millis(timeout_ms));
    }

    let client = client_builder
        .build()
        .map_err(|e| AppError::NetworkError(format!("Failed to build HTTP client: {}", e)))?;

    // 3. Map method
    let method = match parsed.method {
        HttpMethod::GET => reqwest::Method::GET,
        HttpMethod::POST => reqwest::Method::POST,
        HttpMethod::PUT => reqwest::Method::PUT,
        HttpMethod::DELETE => reqwest::Method::DELETE,
        HttpMethod::PATCH => reqwest::Method::PATCH,
        HttpMethod::HEAD => reqwest::Method::HEAD,
        HttpMethod::OPTIONS => reqwest::Method::OPTIONS,
        HttpMethod::CUSTOM(m) => reqwest::Method::from_bytes(m.as_bytes())
            .map_err(|e| AppError::NetworkError(format!("Invalid custom method: {}", e)))?,
    };

    // 4. Construct request
    let mut request_builder = client.request(method, &parsed.url);

    // Headers
    let mut headers = HeaderMap::new();
    for HeaderPair { key, value } in parsed.headers {
        if let (Ok(h_name), Ok(h_val)) = (
            HeaderName::from_str(&key),
            HeaderValue::from_str(&value),
        ) {
            headers.insert(h_name, h_val);
        }
    }
    if !parsed.form_fields.is_empty() {
        // reqwest must add the multipart boundary to Content-Type itself.
        headers.remove(reqwest::header::CONTENT_TYPE);
    }
    request_builder = request_builder.headers(headers);

    // Basic Auth
    if let Some(BasicAuth { username, password }) = parsed.basic_auth {
        request_builder = request_builder.basic_auth(username, password);
    }

    // Body
    if !parsed.form_fields.is_empty() {
        let mut form = reqwest::multipart::Form::new();
        for field in parsed.form_fields {
            if let Some(file_path) = field.file_path {
                let metadata = match tokio::fs::metadata(&file_path).await {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        let message = format!(
                            "Could not access upload file '{}': {}",
                            file_path, error
                        );
                        let _ = channel.send(ResponseChunk::Failed {
                            error: message.clone(),
                        });
                        return Err(AppError::FsError(message));
                    }
                };
                if !metadata.is_file() {
                    let message = format!("Upload path is not a file: '{}'.", file_path);
                    let _ = channel.send(ResponseChunk::Failed {
                        error: message.clone(),
                    });
                    return Err(AppError::FsError(message));
                }
                let file = match tokio::fs::File::open(&file_path).await {
                    Ok(file) => file,
                    Err(error) => {
                        let message = format!(
                            "Could not open upload file '{}': {}",
                            file_path, error
                        );
                        let _ = channel.send(ResponseChunk::Failed {
                            error: message.clone(),
                        });
                        return Err(AppError::FsError(message));
                    }
                };
                let file_name = Path::new(&file_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("upload.bin")
                    .to_string();
                form = form.part(
                    field.name,
                    reqwest::multipart::Part::stream_with_length(
                        reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file)),
                        metadata.len(),
                    )
                    .file_name(file_name)
                    .mime_str("application/octet-stream")
                    .expect("static MIME type is valid"),
                );
            } else {
                form = form.text(field.name, field.value);
            }
        }
        request_builder = request_builder.multipart(form);
    } else if let Some(body_text) = parsed.body {
        request_builder = request_builder.body(body_text);
    }

    // 5. Send request with cancellation awareness
    let send_future = request_builder.send();

    let response = tokio::select! {
        _ = cancel_token.cancelled() => {
            let _ = channel.send(ResponseChunk::Failed {
                error: "Request was cancelled".to_string(),
            });
            return Err(AppError::Cancelled);
        }
        res = send_future => {
            match res {
                Ok(response) => response,
                Err(error) => {
                    let message = error.to_string();
                    let _ = channel.send(ResponseChunk::Failed {
                        error: message.clone(),
                    });
                    return Err(AppError::NetworkError(message));
                }
            }
        }
    };

    let ttfb_ms = start_time.elapsed().as_millis() as u64;

    // 6. Collect response headers
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let protocol = format!("{:?}", response.version());

    let mut resp_headers = Vec::new();
    let mut is_sse = false;
    let mut is_chunked = false;

    for (k, v) in response.headers() {
        let key_str = k.to_string();
        let val_str = v.to_str().unwrap_or("").to_string();
        if key_str.eq_ignore_ascii_case("content-type") {
            let lower = val_str.to_lowercase();
            if lower.contains("text/event-stream") {
                is_sse = true;
            } else if lower.contains("stream") || lower.contains("ndjson") || lower.contains("jsonl") {
                is_chunked = true;
            }
        }
        if key_str.eq_ignore_ascii_case("transfer-encoding") && val_str.to_lowercase().contains("chunked") {
            is_chunked = true;
        }
        resp_headers.push(HeaderPair {
            key: key_str,
            value: val_str,
        });
    }

    let is_streaming = is_sse || is_chunked;

    let _ = channel.send(ResponseChunk::HeaderReceived {
        status,
        status_text,
        headers: resp_headers,
        protocol,
        ttfb_ms,
        is_streaming,
    });

    // 7. Stream response body
    let mut stream = response.bytes_stream();
    let mut spooler = StreamSpooler::new(None).await?;
    let mut sse_parser = if is_sse { Some(SseParser::new()) } else { None };
    let mut last_ipc_emit = Instant::now();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = channel.send(ResponseChunk::Failed {
                    error: "Stream was cancelled".to_string(),
                });
                return Err(AppError::Cancelled);
            }
            chunk_result = stream.next() => {
                match chunk_result {
                    Some(Ok(bytes)) => {
                        spooler.write(&bytes).await?;
                        let total_bytes = spooler.total_bytes();

                        if let Some(parser) = &mut sse_parser {
                            let text = String::from_utf8_lossy(&bytes);
                            let events = parser.feed(&text);
                            for event in events {
                                let _ = channel.send(ResponseChunk::SseChunk {
                                    id: event.id,
                                    event: event.event,
                                    data: event.data,
                                });
                            }
                        } else {
                            // Memory & IPC defense: send text up to 2 MB, then throttle progress updates
                            let should_send_text = total_bytes <= 2 * 1024 * 1024;
                            let now = Instant::now();

                            if should_send_text || now.duration_since(last_ipc_emit).as_millis() >= 40 {
                                let text = if should_send_text {
                                    String::from_utf8_lossy(&bytes).to_string()
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
                    }
                    Some(Err(e)) => {
                        let _ = channel.send(ResponseChunk::Failed {
                            error: format!("Stream error: {}", e),
                        });
                        return Err(AppError::NetworkError(e.to_string()));
                    }
                    None => {
                        // End of stream
                        break;
                    }
                }
            }
        }
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

/// A complete HTTP response for callers such as MCP that need a single structured result rather
/// than streamed UI events.
#[derive(Debug, Clone)]
pub struct CollectedHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<HeaderPair>,
    pub body: String,
    pub duration_ms: u64,
}

/// Executes a parsed request using the same transport configuration as the desktop request path,
/// collecting the response for non-UI callers.
pub async fn execute_http_request_collect(
    parsed: ParsedCurlRequest,
) -> Result<CollectedHttpResponse> {
    let start_time = Instant::now();
    let mut client_builder = reqwest::Client::builder();

    if parsed.insecure {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }
    client_builder = if parsed.follow_redirects {
        client_builder.redirect(Policy::limited(10))
    } else {
        client_builder.redirect(Policy::none())
    };
    if let Some(timeout_ms) = parsed.timeout_ms {
        client_builder = client_builder.timeout(Duration::from_millis(timeout_ms));
    }
    let client = client_builder
        .build()
        .map_err(|e| AppError::NetworkError(format!("Failed to build HTTP client: {}", e)))?;

    let method = match parsed.method {
        HttpMethod::GET => reqwest::Method::GET,
        HttpMethod::POST => reqwest::Method::POST,
        HttpMethod::PUT => reqwest::Method::PUT,
        HttpMethod::DELETE => reqwest::Method::DELETE,
        HttpMethod::PATCH => reqwest::Method::PATCH,
        HttpMethod::HEAD => reqwest::Method::HEAD,
        HttpMethod::OPTIONS => reqwest::Method::OPTIONS,
        HttpMethod::CUSTOM(value) => reqwest::Method::from_bytes(value.as_bytes())
            .map_err(|e| AppError::NetworkError(format!("Invalid HTTP method: {}", e)))?,
    };
    let mut request = client.request(method, parsed.url);

    let mut headers = HeaderMap::new();
    for HeaderPair { key, value } in parsed.headers {
        if let (Ok(header_name), Ok(header_value)) = (
            HeaderName::from_str(&key),
            HeaderValue::from_str(&value),
        ) {
            headers.insert(header_name, header_value);
        }
    }
    if !parsed.form_fields.is_empty() {
        headers.remove(reqwest::header::CONTENT_TYPE);
    }
    request = request.headers(headers);

    if let Some(BasicAuth { username, password }) = parsed.basic_auth {
        request = request.basic_auth(username, password);
    }

    if !parsed.form_fields.is_empty() {
        let mut form = reqwest::multipart::Form::new();
        for field in parsed.form_fields {
            if let Some(file_path) = field.file_path {
                let metadata = tokio::fs::metadata(&file_path)
                    .await
                    .map_err(|e| AppError::FsError(format!("Could not access upload file '{}': {}", file_path, e)))?;
                if !metadata.is_file() {
                    return Err(AppError::FsError(format!("Upload path is not a file: '{}'", file_path)));
                }
                let file = tokio::fs::File::open(&file_path)
                    .await
                    .map_err(|e| AppError::FsError(format!("Could not open upload file '{}': {}", file_path, e)))?;
                let file_name = Path::new(&file_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("upload.bin")
                    .to_string();
                form = form.part(
                    field.name,
                    reqwest::multipart::Part::stream_with_length(
                        reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(file)),
                        metadata.len(),
                    )
                    .file_name(file_name)
                    .mime_str("application/octet-stream")
                    .map_err(|e| AppError::NetworkError(format!("Invalid upload MIME type: {}", e)))?,
                );
            } else {
                form = form.text(field.name, field.value);
            }
        }
        request = request.multipart(form);
    } else if let Some(body) = parsed.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| AppError::NetworkError(e.to_string()))?;
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| HeaderPair {
            key: key.to_string(),
            value: value.to_str().unwrap_or("").to_string(),
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::NetworkError(e.to_string()))?;

    Ok(CollectedHttpResponse {
        status,
        status_text,
        headers,
        body,
        duration_ms: start_time.elapsed().as_millis() as u64,
    })
}
