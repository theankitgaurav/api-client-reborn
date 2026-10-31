use crate::engine::spooler::StreamSpooler;
use crate::error::{AppError, Result};
use crate::ipc::types::ResponseChunk;
use crate::parser::curl::HeaderPair;
use bytes::{Buf, BufMut, Bytes};
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::Channel;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::{MetadataKey, MetadataValue};
use tonic::transport::{Channel as GrpcChannel, ClientTlsConfig, Endpoint};
use tonic::{Request, Status};

#[derive(Debug)]
struct SkipServerCertificateVerification;

impl rustls::client::danger::ServerCertVerifier for SkipServerCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        let provider = rustls::crypto::ring::default_provider();
        rustls::crypto::verify_tls12_signature(message, cert, signature, &provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        signature: &rustls::DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        let provider = rustls::crypto::ring::default_provider();
        rustls::crypto::verify_tls13_signature(message, cert, signature, &provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GrpcRequestConfig {
    pub name: String,
    pub endpoint: String,
    pub service: String,
    pub method: String,
    #[serde(default = "default_request_json")]
    pub request_json: String,
    #[serde(default)]
    pub metadata: Vec<HeaderPair>,
    #[serde(default)]
    pub proto_file: Option<String>,
    #[serde(default = "default_reflection")]
    pub use_reflection: bool,
    #[serde(default)]
    pub tls_enabled: bool,
    #[serde(default)]
    pub tls_insecure: bool,
    #[serde(default)]
    pub tls_ca_file: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_request_json() -> String {
    "{}".to_string()
}
fn default_reflection() -> bool {
    true
}
fn default_timeout() -> u64 {
    30_000
}

impl Default for GrpcRequestConfig {
    fn default() -> Self {
        Self {
            name: "New gRPC Request".into(),
            endpoint: "http://127.0.0.1:50051".into(),
            service: String::new(),
            method: String::new(),
            request_json: default_request_json(),
            metadata: Vec::new(),
            proto_file: None,
            use_reflection: true,
            tls_enabled: false,
            tls_insecure: false,
            tls_ca_file: None,
            timeout_ms: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcMethodInfo {
    pub name: String,
    pub input_type: String,
    pub output_type: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcServiceInfo {
    pub name: String,
    pub methods: Vec<GrpcMethodInfo>,
}

#[derive(Clone, Default)]
struct RawProtoCodec;

impl Codec for RawProtoCodec {
    type Encode = Bytes;
    type Decode = Bytes;
    type Encoder = RawProtoEncoder;
    type Decoder = RawProtoDecoder;

    fn encoder(&mut self) -> Self::Encoder { RawProtoEncoder }
    fn decoder(&mut self) -> Self::Decoder { RawProtoDecoder }
}

struct RawProtoEncoder;
impl Encoder for RawProtoEncoder {
    type Item = Bytes;
    type Error = Status;

    fn encode(&mut self, item: Bytes, dst: &mut EncodeBuf<'_>) -> std::result::Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

struct RawProtoDecoder;
impl Decoder for RawProtoDecoder {
    type Item = Bytes;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> std::result::Result<Option<Self::Item>, Self::Error> {
        Ok(Some(src.copy_to_bytes(src.remaining())))
    }
}

fn endpoint_uri(config: &GrpcRequestConfig) -> String {
    let endpoint = config.endpoint.trim();
    if endpoint.contains("://") {
        if config.tls_enabled && endpoint.starts_with("http://") {
            format!("https://{}", &endpoint["http://".len()..])
        } else if !config.tls_enabled && endpoint.starts_with("https://") {
            format!("http://{}", &endpoint["https://".len()..])
        } else {
            endpoint.to_string()
        }
    } else if config.tls_enabled {
        format!("https://{endpoint}")
    } else {
        format!("http://{endpoint}")
    }
}

async fn connect(config: &GrpcRequestConfig) -> Result<GrpcChannel> {
    let uri = endpoint_uri(config);
    let mut endpoint = Endpoint::from_shared(uri)
        .map_err(|e| AppError::NetworkError(format!("Invalid gRPC endpoint: {e}")))?
        .timeout(std::time::Duration::from_millis(config.timeout_ms.max(1)))
        .initial_connection_window_size(Some(1024 * 1024))
        .initial_stream_window_size(Some(256 * 1024));

    if config.tls_enabled {
        let mut tls = ClientTlsConfig::new().with_enabled_roots();
        if config.tls_insecure && config.tls_ca_file.as_deref().is_some_and(|p| !p.trim().is_empty()) {
            return Err(AppError::NetworkError("Choose either certificate bypass or a custom CA certificate".into()));
        }
        if let Some(path) = config.tls_ca_file.as_deref().filter(|p| !p.trim().is_empty()) {
            let pem = tokio::fs::read(path).await
                .map_err(|e| AppError::FsError(format!("Cannot read CA certificate: {e}")))?;
            tls = tls.ca_certificate(tonic::transport::Certificate::from_pem(pem));
        }
        if config.tls_insecure {
            endpoint = endpoint.tls_config_with_verifier(tls, Arc::new(SkipServerCertificateVerification))
                .map_err(|e| AppError::NetworkError(format!("Invalid TLS configuration: {e}")))?;
        } else {
            endpoint = endpoint.tls_config(tls)
                .map_err(|e| AppError::NetworkError(format!("Invalid TLS configuration: {e}")))?;
        }
    }

    endpoint.connect().await
        .map_err(|e| AppError::NetworkError(format!("Could not connect to gRPC server: {e}")))
}

async fn reflect_request(channel: GrpcChannel, request: tonic_reflection::pb::v1::ServerReflectionRequest) -> Result<tonic_reflection::pb::v1::ServerReflectionResponse> {
    use tonic_reflection::pb::v1::server_reflection_client::ServerReflectionClient;
    let mut client = ServerReflectionClient::new(channel);
    let mut stream = client.server_reflection_info(tokio_stream::iter([request])).await
        .map_err(|e| AppError::NetworkError(format!("gRPC reflection failed: {e}")))?
        .into_inner();
    stream.message().await
        .map_err(|e| AppError::NetworkError(format!("gRPC reflection failed: {e}")))?
        .ok_or_else(|| AppError::NetworkError("gRPC reflection returned no response".into()))
}

async fn descriptor_pool_from_proto(proto_file: &str) -> Result<DescriptorPool> {
    let proto_file = proto_file.to_string();
    tokio::task::spawn_blocking(move || {
        let file = PathBuf::from(&proto_file);
        if !file.is_file() {
            return Err(AppError::FsError(format!("Proto file not found: {proto_file}")));
        }
        let include = file.parent().unwrap_or(Path::new("."));
        let fds = protox::compile([file.as_path()], [include])
            .map_err(|e| AppError::InternalError(format!("Could not compile proto file: {e}")))?;
        DescriptorPool::from_file_descriptor_set(fds)
            .map_err(|e| AppError::InternalError(format!("Invalid proto descriptors: {e}")))
    }).await.map_err(|e| AppError::InternalError(format!("Proto compilation task failed: {e}")))?
}

async fn reflection_pool(channel: GrpcChannel, symbol: &str) -> Result<DescriptorPool> {
    use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
    use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;
    use tonic_reflection::pb::v1::ServerReflectionRequest;

    let response = reflect_request(channel, ServerReflectionRequest {
        host: String::new(),
        message_request: Some(MessageRequest::FileContainingSymbol(symbol.to_string())),
    }).await?;
    let files = match response.message_response {
        Some(MessageResponse::FileDescriptorResponse(fds)) => fds.file_descriptor_proto,
        Some(MessageResponse::ErrorResponse(error)) => return Err(AppError::NetworkError(error.error_message)),
        _ => return Err(AppError::NetworkError("Server reflection did not return descriptors".into())),
    };
    let mut decoded = Vec::with_capacity(files.len());
    for bytes in files {
        decoded.push(prost_types::FileDescriptorProto::decode(bytes.as_slice())
            .map_err(|e| AppError::InternalError(format!("Invalid reflected descriptor: {e}")))?);
    }
    DescriptorPool::from_file_descriptor_set(prost_types::FileDescriptorSet { file: decoded })
        .map_err(|e| AppError::InternalError(format!("Invalid reflected descriptors: {e}")))
}

async fn load_pool(config: &GrpcRequestConfig, channel: GrpcChannel) -> Result<DescriptorPool> {
    if let Some(proto) = config.proto_file.as_deref().filter(|p| !p.trim().is_empty()) {
        return descriptor_pool_from_proto(proto).await;
    }
    if !config.use_reflection {
        return Err(AppError::InternalError("Select a .proto file or enable server reflection".into()));
    }
    if config.service.trim().is_empty() {
        return Err(AppError::InternalError("Select a service before loading its descriptors".into()));
    }
    reflection_pool(channel, &config.service).await
}

fn json_to_message(descriptor: prost_reflect::MessageDescriptor, json: &Value) -> Result<DynamicMessage> {
    let text = serde_json::to_string(json).map_err(|e| AppError::InternalError(e.to_string()))?;
    let mut deserializer = serde_json::Deserializer::from_str(&text);
    let message = DynamicMessage::deserialize(descriptor, &mut deserializer)
        .map_err(|e| AppError::InternalError(format!("Invalid protobuf JSON: {e}")))?;
    deserializer.end().map_err(|e| AppError::InternalError(e.to_string()))?;
    Ok(message)
}

fn message_to_json(descriptor: prost_reflect::MessageDescriptor, bytes: &[u8]) -> Result<String> {
    let message = DynamicMessage::decode(descriptor, bytes)
        .map_err(|e| AppError::InternalError(format!("Could not decode gRPC response: {e}")))?;
    serde_json::to_string_pretty(&message)
        .map_err(|e| AppError::InternalError(format!("Could not format gRPC response: {e}")))
}

fn find_method(pool: &DescriptorPool, service: &str, method: &str) -> Result<MethodDescriptor> {
    let service = pool.get_service_by_name(service)
        .ok_or_else(|| AppError::InternalError(format!("Service '{service}' was not found in the proto descriptors")))?;
    let full_name = service.full_name().to_string();
    let found = service.methods().find(|item| item.name() == method);
    found.ok_or_else(|| AppError::InternalError(format!("Method '{method}' was not found in service '{full_name}'.")))
}

fn metadata_to_headers(metadata: &tonic::metadata::MetadataMap) -> Vec<HeaderPair> {
    metadata.iter().filter_map(|item| match item {
        tonic::metadata::KeyAndValueRef::Ascii(key, value) => Some(HeaderPair {
            key: key.as_str().to_string(),
            value: value.to_str().unwrap_or("[binary metadata]").to_string(),
        }),
        tonic::metadata::KeyAndValueRef::Binary(_, _) => None,
    }).collect()
}

fn apply_metadata<T>(request: &mut Request<T>, metadata: &[HeaderPair]) -> Result<()> {
    for pair in metadata {
        let key = MetadataKey::from_bytes(pair.key.trim().as_bytes())
            .map_err(|e| AppError::InternalError(format!("Invalid metadata key '{}': {e}", pair.key)))?;
        let value = MetadataValue::try_from(pair.value.trim())
            .map_err(|e| AppError::InternalError(format!("Invalid metadata value for '{}': {e}", pair.key)))?;
        request.metadata_mut().insert(key, value);
    }
    Ok(())
}

fn response_header(channel: &Channel<ResponseChunk>, streaming: bool, metadata: Vec<HeaderPair>, elapsed: u64) {
    let _ = channel.send(ResponseChunk::HeaderReceived {
        status: 200,
        status_text: "gRPC".into(),
        headers: metadata,
        protocol: "gRPC/HTTP2".into(),
        ttfb_ms: elapsed,
        is_streaming: streaming,
    });
}

async fn run_call(
    request_id: String,
    config: GrpcRequestConfig,
    cancel: CancellationToken,
    channel: Channel<ResponseChunk>,
    workspace_root: Option<&Path>,
) -> Result<()> {
    let start = Instant::now();
    let _ = channel.send(ResponseChunk::Started { request_id });
    let conn = tokio::select! {
        _ = cancel.cancelled() => return Err(AppError::Cancelled),
        result = connect(&config) => result?,
    };
    let pool = load_pool(&config, conn.clone()).await?;
    let method = find_method(&pool, &config.service, &config.method)?;
    let json: Value = serde_json::from_str(&config.request_json)
        .map_err(|e| AppError::InternalError(format!("Request body must be valid JSON: {e}")))?;
    let request_values = if method.is_client_streaming() {
        json.as_array().cloned().ok_or_else(|| AppError::InternalError("Client-streaming RPCs require a JSON array of request messages".into()))?
    } else {
        vec![json]
    };
    if !method.is_client_streaming() && request_values.len() != 1 {
        return Err(AppError::InternalError("Unary and server-streaming RPCs require one JSON object".into()));
    }
    let mut request_bytes = Vec::with_capacity(request_values.len());
    for value in request_values {
        let message = json_to_message(method.input(), &value)?;
        let mut bytes = Vec::with_capacity(message.encoded_len());
        message.encode(&mut bytes).map_err(|e| AppError::InternalError(e.to_string()))?;
        request_bytes.push(Bytes::from(bytes));
    }
    let path: tonic::codegen::http::uri::PathAndQuery = format!("/{}/{}", config.service, config.method)
        .parse().map_err(|e| AppError::InternalError(format!("Invalid RPC method path: {e}")))?;
    let mut client = tonic::client::Grpc::new(conn);
    client.ready().await.map_err(|e| AppError::NetworkError(format!("gRPC channel is not ready: {e}")))?;

    if !method.is_server_streaming() {
        let response = if method.is_client_streaming() {
            let (tx, rx) = mpsc::channel(8);
            tokio::spawn(async move {
                for bytes in request_bytes {
                    if tx.send(bytes).await.is_err() { break; }
                }
            });
            let mut request = Request::new(ReceiverStream::new(rx));
            apply_metadata(&mut request, &config.metadata)?;
            tokio::select! {
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
                result = client.client_streaming(request, path, RawProtoCodec) => result,
            }
                .map_err(|e| AppError::NetworkError(format!("{}: {}", e.code(), e.message())))?
        } else {
            let mut request = Request::new(request_bytes.remove(0));
            apply_metadata(&mut request, &config.metadata)?;
            tokio::select! {
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
                result = client.unary(request, path, RawProtoCodec) => result,
            }
                .map_err(|e| AppError::NetworkError(format!("{}: {}", e.code(), e.message())))?
        };
        let metadata = response.metadata().clone();
        let bytes = response.into_inner();
        let body = message_to_json(method.output(), &bytes)?;
        response_header(&channel, false, metadata_to_headers(&metadata), start.elapsed().as_millis() as u64);
        let _ = channel.send(ResponseChunk::BodyChunk { text: body.clone(), bytes_received: body.len() });
        let _ = channel.send(ResponseChunk::Finished { total_duration_ms: start.elapsed().as_millis() as u64, total_bytes: body.len(), spool_file_path: None });
    } else {
        let stream = if method.is_client_streaming() {
            let (tx, rx) = mpsc::channel(8);
            tokio::spawn(async move {
                for bytes in request_bytes {
                    if tx.send(bytes).await.is_err() { break; }
                }
            });
            let mut request = Request::new(ReceiverStream::new(rx));
            apply_metadata(&mut request, &config.metadata)?;
            client.streaming(request, path, RawProtoCodec).await
        } else {
            let mut req = Request::new(request_bytes.remove(0));
            apply_metadata(&mut req, &config.metadata)?;
            client.server_streaming(req, path, RawProtoCodec).await
        }.map_err(|e| AppError::NetworkError(format!("{}: {}", e.code(), e.message())))?;
        response_header(&channel, true, metadata_to_headers(stream.metadata()), start.elapsed().as_millis() as u64);
        let mut stream = stream.into_inner();
        let mut spool = StreamSpooler::new(workspace_root).await?;
        loop {
            let item = tokio::select! {
                _ = cancel.cancelled() => return Err(AppError::Cancelled),
                result = stream.message() => result.map_err(|e| AppError::NetworkError(format!("{}: {}", e.code(), e.message())))?,
            };
            let Some(bytes) = item else { break };
            let body = message_to_json(method.output(), &bytes)?;
            spool.write(format!("{body}\n").as_bytes()).await?;
            let _ = channel.send(ResponseChunk::SseChunk { id: None, event: Some("message".into()), data: body });
        }
        let (path, total) = spool.finish().await?;
        let _ = channel.send(ResponseChunk::Finished { total_duration_ms: start.elapsed().as_millis() as u64, total_bytes: total, spool_file_path: Some(path.to_string_lossy().to_string()) });
    }
    Ok(())
}

pub async fn execute_grpc_request(
    request_id: String,
    config: GrpcRequestConfig,
    channel: Channel<ResponseChunk>,
    cancel: CancellationToken,
    workspace_root: Option<PathBuf>,
) -> Result<()> {
    match run_call(request_id, config, cancel, channel.clone(), workspace_root.as_deref()).await {
        Ok(()) => Ok(()),
        Err(AppError::Cancelled) => {
            let _ = channel.send(ResponseChunk::Failed { error: "Request was cancelled".into() });
            Err(AppError::Cancelled)
        }
        Err(error) => {
            let _ = channel.send(ResponseChunk::Failed { error: error.to_string() });
            Err(error)
        }
    }
}

pub async fn discover_grpc_services(config: GrpcRequestConfig) -> Result<Vec<GrpcServiceInfo>> {
    let channel = connect(&config).await?;
    let pool = if let Some(proto) = config.proto_file.as_deref().filter(|p| !p.trim().is_empty()) {
        descriptor_pool_from_proto(proto).await?
    } else {
        use tonic_reflection::pb::v1::server_reflection_request::MessageRequest;
        use tonic_reflection::pb::v1::server_reflection_response::MessageResponse;
        use tonic_reflection::pb::v1::ServerReflectionRequest;
        let response = reflect_request(channel.clone(), ServerReflectionRequest {
            host: String::new(),
            message_request: Some(MessageRequest::ListServices(String::new())),
        }).await?;
        let names: Vec<String> = match response.message_response {
            Some(MessageResponse::ListServicesResponse(response)) => response.service.into_iter().map(|s| s.name).collect(),
            Some(MessageResponse::ErrorResponse(error)) => return Err(AppError::NetworkError(error.error_message)),
            _ => return Err(AppError::NetworkError("Server reflection did not return a service list".into())),
        };
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        for name in names {
            let response = reflect_request(channel.clone(), ServerReflectionRequest {
                host: String::new(),
                message_request: Some(MessageRequest::FileContainingSymbol(name)),
            }).await?;
            if let Some(MessageResponse::FileDescriptorResponse(set)) = response.message_response {
                for file in set.file_descriptor_proto {
                    let descriptor = prost_types::FileDescriptorProto::decode(file.as_slice())
                        .map_err(|e| AppError::InternalError(format!("Invalid reflected descriptor: {e}")))?;
                    let key = descriptor.name.clone().unwrap_or_default();
                    if seen.insert(key) { files.push(descriptor); }
                }
            }
        }
        DescriptorPool::from_file_descriptor_set(prost_types::FileDescriptorSet { file: files })
            .map_err(|e| AppError::InternalError(format!("Invalid reflected descriptors: {e}")))?
    };

    Ok(pool.services().map(|service| GrpcServiceInfo {
        name: service.full_name().to_string(),
        methods: service.methods().map(|method| GrpcMethodInfo {
            name: method.name().to_string(),
            input_type: method.input().full_name().to_string(),
            output_type: method.output().full_name().to_string(),
            client_streaming: method.is_client_streaming(),
            server_streaming: method.is_server_streaming(),
        }).collect(),
    }).collect())
}
