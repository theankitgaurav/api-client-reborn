use crate::engine::stream::SseParser;
use crate::error::{AppError, Result};
use crate::ipc::types::ResponseChunk;
use crate::parser::curl::{BasicAuth, HeaderPair, HttpMethod, ParsedCurlRequest};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
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
    request_builder = request_builder.headers(headers);

    // Basic Auth
    if let Some(BasicAuth { username, password }) = parsed.basic_auth {
        request_builder = request_builder.basic_auth(username, password);
    }

    // Body
    if let Some(body_text) = parsed.body {
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
            res.map_err(|e| AppError::NetworkError(e.to_string()))?
        }
    };

    let ttfb_ms = start_time.elapsed().as_millis() as u64;

    // 6. Collect response headers
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let protocol = format!("{:?}", response.version());

    let mut resp_headers = Vec::new();
    let mut is_sse = false;

    for (k, v) in response.headers() {
        let key_str = k.to_string();
        let val_str = v.to_str().unwrap_or("").to_string();
        if key_str.eq_ignore_ascii_case("content-type") && val_str.contains("text/event-stream") {
            is_sse = true;
        }
        resp_headers.push(HeaderPair {
            key: key_str,
            value: val_str,
        });
    }

    let _ = channel.send(ResponseChunk::HeaderReceived {
        status,
        status_text,
        headers: resp_headers,
        protocol,
        ttfb_ms,
    });

    // 7. Stream response body
    let mut stream = response.bytes_stream();
    let mut total_bytes = 0;
    let mut sse_parser = if is_sse { Some(SseParser::new()) } else { None };

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
                        let len = bytes.len();
                        total_bytes += len;
                        let text = String::from_utf8_lossy(&bytes).to_string();

                        if let Some(parser) = &mut sse_parser {
                            let events = parser.feed(&text);
                            for event in events {
                                let _ = channel.send(ResponseChunk::SseChunk {
                                    id: event.id,
                                    event: event.event,
                                    data: event.data,
                                });
                            }
                        } else {
                            let _ = channel.send(ResponseChunk::BodyChunk {
                                text,
                                bytes_received: total_bytes,
                            });
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

    let total_duration_ms = start_time.elapsed().as_millis() as u64;
    let _ = channel.send(ResponseChunk::Finished {
        total_duration_ms,
        total_bytes,
    });

    Ok(())
}
