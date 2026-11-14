use bytes::{Buf, BufMut, Bytes};
use prost::Message;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::fs;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::codegen::http::{Request as HttpRequest, Response as HttpResponse};
use tonic::codegen::Service;
use tonic::server::{ClientStreamingService, NamedService, ServerStreamingService, StreamingService, UnaryService};
use tonic::{Request as TonicRequest, Response as TonicResponse, Status};

struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("mcp-proc-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct McpProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    lines: tokio::io::Lines<BufReader<ChildStdout>>,
}

impl McpProcess {
    async fn spawn(workspace: &Path, extra_args: &[&str]) -> Self {
        let bin_path = env!("CARGO_BIN_EXE_api_client_reborn");
        let mut cmd = Command::new(bin_path);
        cmd.arg("mcp")
            .arg("--workspace")
            .arg(workspace);
        for arg in extra_args {
            cmd.arg(arg);
        }
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit());

        let mut child = cmd.spawn().expect("failed to spawn api_client_reborn");
        let stdin = BufWriter::new(child.stdin.take().expect("stdin"));
        let stdout = child.stdout.take().expect("stdout");
        let lines = BufReader::new(stdout).lines();

        Self { child, stdin, lines }
    }

    async fn send_raw(&mut self, json_str: &str) {
        self.stdin.write_all(json_str.as_bytes()).await.unwrap();
        self.stdin.write_all(b"\n").await.unwrap();
        self.stdin.flush().await.unwrap();
    }

    async fn send_request(&mut self, id: Value, method: &str, params: Value) {
        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        self.send_raw(&serde_json::to_string(&req).unwrap()).await;
    }

    async fn send_notification(&mut self, method: &str, params: Value) {
        let notif = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        self.send_raw(&serde_json::to_string(&notif).unwrap()).await;
    }

    async fn read_response(&mut self) -> Value {
        loop {
            let line = self.lines.next_line().await.unwrap().expect("unexpected EOF on stdout");
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str(&line).expect("valid JSON response");
        }
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

// -----------------------------------------------------------------------------
// Local HTTP Test Server Fixture
// -----------------------------------------------------------------------------

async fn read_full_http_request<R: AsyncReadExt + Unpin>(socket: &mut R) -> std::io::Result<String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let mut content_length: Option<usize> = None;
    let mut header_len = None;

    loop {
        let n = socket.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);

        if header_len.is_none() {
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                header_len = Some(pos + 4);
                let header_str = String::from_utf8_lossy(&buf[..pos]);
                for line in header_str.lines() {
                    let lower = line.to_ascii_lowercase();
                    if lower.starts_with("content-length:") {
                        if let Some(val) = line.split(':').nth(1) {
                            if let Ok(cl) = val.trim().parse::<usize>() {
                                content_length = Some(cl);
                            }
                        }
                    }
                }
            }
        }

        if let Some(hlen) = header_len {
            let cl = content_length.unwrap_or(0);
            if buf.len() >= hlen + cl {
                break;
            }
        }
    }

    Ok(String::from_utf8_lossy(&buf).to_string())
}

async fn start_http_fixture() -> (SocketAddr, tokio::sync::oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                res = listener.accept() => {
                    let Ok((mut socket, _)) = res else { break };
                    tokio::spawn(async move {
                        let Ok(req_str) = read_full_http_request(&mut socket).await else { return };

                        if req_str.contains("/slow") {
                            tokio::time::sleep(Duration::from_secs(3)).await;
                            let resp = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: 15\r\n\r\n{\"slow\":\"done\"}";
                            let _ = socket.write_all(resp.as_bytes()).await;
                            let _ = socket.flush().await;
                            let _ = socket.shutdown().await;
                        } else if req_str.contains("/large") {
                            let big_body = "x".repeat(50_000);
                            let resp = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                                big_body.len(),
                                big_body
                            );
                            let _ = socket.write_all(resp.as_bytes()).await;
                            let _ = socket.flush().await;
                            let _ = socket.shutdown().await;
                        } else {
                            // Extract body after \r\n\r\n
                            let body = if let Some(idx) = req_str.find("\r\n\r\n") {
                                &req_str[idx + 4..]
                            } else {
                                ""
                            };
                            let resp_body = json!({
                                "status": "ok",
                                "echo": body,
                                "received": true
                            }).to_string();
                            let resp = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                                resp_body.len(),
                                resp_body
                            );
                            let _ = socket.write_all(resp.as_bytes()).await;
                            let _ = socket.flush().await;
                            let _ = socket.shutdown().await;
                        }
                    });
                }
            }
        }
    });

    (addr, shutdown_tx)
}

// -----------------------------------------------------------------------------
// Local gRPC Test Server Fixture
// -----------------------------------------------------------------------------

#[derive(Clone, Default)]
pub struct RawCodec;

impl Codec for RawCodec {
    type Encode = Bytes;
    type Decode = Bytes;
    type Encoder = RawEncoder;
    type Decoder = RawDecoder;
    fn encoder(&mut self) -> Self::Encoder { RawEncoder }
    fn decoder(&mut self) -> Self::Decoder { RawDecoder }
}

pub struct RawEncoder;
impl Encoder for RawEncoder {
    type Item = Bytes;
    type Error = Status;
    fn encode(&mut self, item: Bytes, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.put(item);
        Ok(())
    }
}

pub struct RawDecoder;
impl Decoder for RawDecoder {
    type Item = Bytes;
    type Error = Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        Ok(Some(src.copy_to_bytes(src.remaining())))
    }
}

#[derive(Clone, PartialEq, Message)]
pub struct HelloRequest {
    #[prost(string, tag = "1")]
    pub greeting: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct HelloResponse {
    #[prost(string, tag = "1")]
    pub reply: String,
}

#[derive(Clone)]
struct SayHelloUnary;

impl UnaryService<Bytes> for SayHelloUnary {
    type Response = Bytes;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::Response>, Status>> + Send>>;

    fn call(&mut self, req: TonicRequest<Bytes>) -> Self::Future {
        let echoed_metadata = req.metadata().get("x-test").cloned();
        let raw = req.into_inner();
        let hello_req = HelloRequest::decode(raw).unwrap_or(HelloRequest { greeting: "world".into() });
        let resp = HelloResponse {
            reply: format!("Hello, {}!", hello_req.greeting),
        };
        Box::pin(async move {
            let mut response = TonicResponse::new(Bytes::from(resp.encode_to_vec()));
            if let Some(value) = echoed_metadata {
                response.metadata_mut().insert("x-echoed-metadata", value);
            }
            Ok(response)
        })
    }
}

#[derive(Clone)]
struct SlowUnary;

impl UnaryService<Bytes> for SlowUnary {
    type Response = Bytes;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::Response>, Status>> + Send>>;

    fn call(&mut self, _req: TonicRequest<Bytes>) -> Self::Future {
        Box::pin(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let resp = HelloResponse { reply: "slow done".into() };
            Ok(TonicResponse::new(Bytes::from(resp.encode_to_vec())))
        })
    }
}

#[derive(Clone)]
struct LargeUnary;

impl UnaryService<Bytes> for LargeUnary {
    type Response = Bytes;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::Response>, Status>> + Send>>;

    fn call(&mut self, _req: TonicRequest<Bytes>) -> Self::Future {
        Box::pin(async move {
            let big_reply = "x".repeat(50_000);
            let resp = HelloResponse { reply: big_reply };
            Ok(TonicResponse::new(Bytes::from(resp.encode_to_vec())))
        })
    }
}

#[derive(Clone)]
struct ServerStreamingReplies;

impl ServerStreamingService<Bytes> for ServerStreamingReplies {
    type Response = Bytes;
    type ResponseStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<Bytes, Status>> + Send>>;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::ResponseStream>, Status>> + Send>>;

    fn call(&mut self, req: TonicRequest<Bytes>) -> Self::Future {
        let raw = req.into_inner();
        let hello_req = HelloRequest::decode(raw).unwrap_or(HelloRequest { greeting: "stream".into() });
        let g = hello_req.greeting;
        Box::pin(async move {
            let s = tokio_stream::iter(vec![
                Ok(Bytes::from(HelloResponse { reply: format!("1: {}", g) }.encode_to_vec())),
                Ok(Bytes::from(HelloResponse { reply: format!("2: {}", g) }.encode_to_vec())),
            ]);
            Ok(TonicResponse::new(Box::pin(s) as Self::ResponseStream))
        })
    }
}

#[derive(Clone)]
struct ClientStreamingGreetings;

impl ClientStreamingService<Bytes> for ClientStreamingGreetings {
    type Response = Bytes;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::Response>, Status>> + Send>>;

    fn call(&mut self, req: TonicRequest<tonic::Streaming<Bytes>>) -> Self::Future {
        let mut stream = req.into_inner();
        Box::pin(async move {
            let mut count = 0;
            while let Ok(Some(bytes)) = stream.message().await {
                let _ = HelloRequest::decode(bytes);
                count += 1;
            }
            let resp = HelloResponse {
                reply: format!("Received {} greetings", count),
            };
            Ok(TonicResponse::new(Bytes::from(resp.encode_to_vec())))
        })
    }
}

#[derive(Clone)]
struct BidiHello;

impl StreamingService<Bytes> for BidiHello {
    type Response = Bytes;
    type ResponseStream = Pin<Box<dyn tokio_stream::Stream<Item = Result<Bytes, Status>> + Send>>;
    type Future = Pin<Box<dyn Future<Output = Result<TonicResponse<Self::ResponseStream>, Status>> + Send>>;

    fn call(&mut self, req: TonicRequest<tonic::Streaming<Bytes>>) -> Self::Future {
        let mut stream = req.into_inner();
        Box::pin(async move {
            let (tx, rx) = tokio::sync::mpsc::channel(8);
            tokio::spawn(async move {
                loop {
                    let request = match stream.message().await {
                        Ok(Some(bytes)) => match HelloRequest::decode(bytes) {
                            Ok(request) => request,
                            Err(error) => {
                                let _ = tx.send(Err(Status::invalid_argument(error.to_string()))).await;
                                break;
                            }
                        },
                        Ok(None) => break,
                        Err(status) => {
                            let _ = tx.send(Err(status)).await;
                            break;
                        }
                    };
                    let response = HelloResponse {
                        reply: format!("Echo: {}", request.greeting),
                    };
                    if tx.send(Ok(Bytes::from(response.encode_to_vec()))).await.is_err() {
                        break;
                    }
                }
            });
            let response_stream = tokio_stream::wrappers::ReceiverStream::new(rx);
            Ok(TonicResponse::new(Box::pin(response_stream) as Self::ResponseStream))
        })
    }
}

#[derive(Clone)]
pub struct HelloServer;

impl NamedService for HelloServer {
    const NAME: &'static str = "HelloService";
}

impl<B> Service<HttpRequest<B>> for HelloServer
where
    B: tonic::codegen::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<tonic::codegen::StdError> + Send + 'static,
{
    type Response = HttpResponse<tonic::body::Body>;
    type Error = Infallible;
    type Future = tonic::codegen::BoxFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: HttpRequest<B>) -> Self::Future {
        let path = req.uri().path().to_string();
        Box::pin(async move {
            let mut grpc = tonic::server::Grpc::new(RawCodec);
            if path == "/HelloService/SayHello" {
                let res = grpc.unary(SayHelloUnary, req).await;
                Ok(res)
            } else if path == "/HelloService/LotsOfReplies" {
                let res = grpc.server_streaming(ServerStreamingReplies, req).await;
                Ok(res)
            } else if path == "/HelloService/LotsOfGreetings" {
                let res = grpc.client_streaming(ClientStreamingGreetings, req).await;
                Ok(res)
            } else if path == "/HelloService/SlowCall" {
                let res = grpc.unary(SlowUnary, req).await;
                Ok(res)
            } else if path == "/HelloService/LargeCall" {
                let res = grpc.unary(LargeUnary, req).await;
                Ok(res)
            } else {
                let res = HttpResponse::builder()
                    .header("content-type", "application/grpc")
                    .header("grpc-status", "12")
                    .body(tonic::body::Body::empty())
                    .unwrap();
                Ok(res)
            }
        })
    }
}

#[derive(Clone)]
struct BidiHelloServer;

impl NamedService for BidiHelloServer {
    const NAME: &'static str = "fixture.BidiService";
}

impl<B> Service<HttpRequest<B>> for BidiHelloServer
where
    B: tonic::codegen::Body<Data = bytes::Bytes> + Send + 'static,
    B::Error: Into<tonic::codegen::StdError> + Send + 'static,
{
    type Response = HttpResponse<tonic::body::Body>;
    type Error = Infallible;
    type Future = tonic::codegen::BoxFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: HttpRequest<B>) -> Self::Future {
        Box::pin(async move {
            let path = req.uri().path();
            if path == "/fixture.BidiService/BidiHello" {
                let response = tonic::server::Grpc::new(RawCodec)
                    .streaming(BidiHello, req)
                    .await;
                Ok(response)
            } else {
                Ok(HttpResponse::builder()
                    .header("content-type", "application/grpc")
                    .header("grpc-status", "12")
                    .body(tonic::body::Body::empty())
                    .unwrap())
            }
        })
    }
}

async fn start_grpc_fixture() -> (SocketAddr, tokio::sync::oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_dir = manifest_dir.join("tests/fixtures");
    let proto_path = fixture_dir.join("test_hello.proto");
    let bidi_proto_path = fixture_dir.join("bidi.proto");
    let fds = protox::compile([&proto_path, &bidi_proto_path], [&fixture_dir]).unwrap();
    let fds_bytes = fds.encode_to_vec();

    let reflection_service = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1()
        .unwrap();

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(reflection_service)
            .add_service(HelloServer)
            .add_service(BidiHelloServer)
            .serve_with_incoming_shutdown(tokio_stream::wrappers::TcpListenerStream::new(listener), async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    (addr, shutdown_tx)
}

async fn start_grpc_tls_fixture() -> (SocketAddr, tokio::sync::oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_dir = manifest_dir.join("tests/fixtures");
    let proto_path = fixture_dir.join("test_hello.proto");
    let bidi_proto_path = fixture_dir.join("bidi.proto");
    let fds = protox::compile([&proto_path, &bidi_proto_path], [&fixture_dir]).unwrap();
    let fds_bytes = fds.encode_to_vec();

    let reflection_service = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1()
        .unwrap();
    let identity = tonic::transport::Identity::from_pem(
        include_bytes!("fixtures/grpc-server.crt").as_slice(),
        include_bytes!("fixtures/grpc-server.key").as_slice(),
    );
    let tls_config = tonic::transport::ServerTlsConfig::new().identity(identity);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .tls_config(tls_config)
            .unwrap()
            .add_service(reflection_service)
            .add_service(HelloServer)
            .add_service(BidiHelloServer)
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                async {
                    let _ = shutdown_rx.await;
                },
            )
            .await
            .unwrap();
    });

    (addr, shutdown_tx)
}

async fn save_grpc_request(proc: &mut McpProcess, id: u64, path: &str, content: String) {
    proc.send_request(json!(id), "tools/call", json!({
        "name": "save_request",
        "arguments": { "path": path, "content": content }
    })).await;
    let response = proc.read_response().await;
    assert_eq!(response["result"]["isError"], false, "{}", response);
}

async fn execute_grpc_request(proc: &mut McpProcess, id: u64, path: &str) -> Value {
    proc.send_request(json!(id), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": path }
    })).await;
    proc.read_response().await
}

// -----------------------------------------------------------------------------
// Integration Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_process_initialization_and_tool_annotations_and_schemas() {
    let ws = TempWorkspace::new();
    let mut proc = McpProcess::spawn(ws.path(), &[]).await;

    // 1. Initialize
    proc.send_request(json!(1), "initialize", json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": { "name": "test-suite", "version": "1.0" }
    })).await;

    let init_resp = proc.read_response().await;
    assert_eq!(init_resp["id"], 1);
    assert_eq!(init_resp["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(init_resp["result"]["serverInfo"]["name"], "api-client-reborn-mcp");

    // 2. notifications/initialized
    proc.send_notification("notifications/initialized", json!({})).await;

    // 3. Ping
    proc.send_request(json!(2), "ping", json!({})).await;
    let ping_resp = proc.read_response().await;
    assert_eq!(ping_resp["id"], 2);
    assert_eq!(ping_resp["result"], json!({}));

    // 4. tools/list
    proc.send_request(json!(3), "tools/list", json!({})).await;
    let tools_resp = proc.read_response().await;
    let tools = tools_resp["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 7);

    let find_tool = |name: &str| tools.iter().find(|t| t["name"] == name).expect(name);

    // Verify Read-Only annotations
    assert_eq!(find_tool("list_requests")["annotations"]["readOnly"], true);
    assert_eq!(find_tool("get_request")["annotations"]["readOnly"], true);
    assert_eq!(find_tool("list_environments")["annotations"]["readOnly"], true);

    // Verify Destructive annotations
    assert_eq!(find_tool("save_request")["annotations"]["destructive"], true);

    // Verify OpenWorldHint on network tools
    assert_eq!(find_tool("execute_request")["annotations"]["openWorldHint"], true);
    assert_eq!(find_tool("execute_grpc_request")["annotations"]["openWorldHint"], true);
    assert_eq!(find_tool("execute_quick_curl")["annotations"]["openWorldHint"], true);

    // Verify nested schemas
    for net_tool in ["execute_request", "execute_grpc_request", "execute_quick_curl"] {
        let t = find_tool(net_tool);
        let vars_schema = &t["inputSchema"]["properties"]["variables"];
        assert_eq!(vars_schema["type"], "object");
        assert_eq!(vars_schema["additionalProperties"]["type"], "string");
        assert_eq!(t["inputSchema"]["additionalProperties"], false);
    }

    let save_tool = find_tool("save_request");
    let sidecar_schema = &save_tool["inputSchema"]["properties"]["sidecar"];
    assert_eq!(sidecar_schema["type"], "object");
    assert!(sidecar_schema["properties"]["pre_request_script"].is_object());
    assert!(sidecar_schema["properties"]["post_response_script"].is_object());
    assert_eq!(sidecar_schema["properties"]["tests"]["type"], "array");
    assert_eq!(save_tool["inputSchema"]["additionalProperties"], false);
}

#[tokio::test]
async fn test_process_workspace_path_validation_and_extensions() {
    let ws = TempWorkspace::new();
    let mut proc = McpProcess::spawn(ws.path(), &[]).await;

    // 1. save_request: valid .curl and .grpcurl
    proc.send_request(json!(10), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "auth/login.curl",
            "content": "curl https://api.example.com/login",
            "name": "Login Request",
            "description": "User login"
        }
    })).await;
    let save_resp = proc.read_response().await;
    assert_eq!(save_resp["result"]["isError"], false);

    proc.send_request(json!(11), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "grpc/echo.grpcurl",
            "content": "grpcurl -plaintext localhost:50051 HelloService/SayHello",
            "name": "gRPC Echo"
        }
    })).await;
    let save_grpc_resp = proc.read_response().await;
    assert_eq!(save_grpc_resp["result"]["isError"], false);

    // 2. list_requests
    proc.send_request(json!(12), "tools/call", json!({
        "name": "list_requests",
        "arguments": {}
    })).await;
    let list_resp = proc.read_response().await;
    let list_data: Value = serde_json::from_str(list_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(list_data["total"], 2);

    // Filter by folder
    proc.send_request(json!(13), "tools/call", json!({
        "name": "list_requests",
        "arguments": { "folder": "auth" }
    })).await;
    let list_auth_resp = proc.read_response().await;
    let list_auth_data: Value = serde_json::from_str(list_auth_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(list_auth_data["total"], 1);

    // 3. get_request on valid request
    proc.send_request(json!(14), "tools/call", json!({
        "name": "get_request",
        "arguments": { "path": "auth/login.curl" }
    })).await;
    let get_resp = proc.read_response().await;
    assert_eq!(get_resp["result"]["isError"], false);
    let req_details: Value = serde_json::from_str(get_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(req_details["name"], "Login Request");

    // 4. get_request extension rejection: reject anything other than .curl, .grpcurl, .grpc
    for bad_file in ["test.txt", "data.json", ".secrets.env", "script.sh"] {
        proc.send_request(json!(15), "tools/call", json!({
            "name": "get_request",
            "arguments": { "path": bad_file }
        })).await;
        let bad_resp = proc.read_response().await;
        assert_eq!(bad_resp["result"]["isError"], true);
        let err_text = bad_resp["result"]["content"][0]["text"].as_str().unwrap();
        assert!(err_text.contains("Invalid request file extension"));
    }

    // 5. Parent traversal rejection
    proc.send_request(json!(16), "tools/call", json!({
        "name": "get_request",
        "arguments": { "path": "../../etc/passwd.curl" }
    })).await;
    let trav_resp = proc.read_response().await;
    assert_eq!(trav_resp["result"]["isError"], true);
    assert!(trav_resp["result"]["content"][0]["text"].as_str().unwrap().contains("escapes workspace root"));

    // 6. Symlink escape rejection
    #[cfg(unix)]
    {
        let outside = TempWorkspace::new();
        let outside_file = outside.path().join("leak.curl");
        fs::write(&outside_file, "curl https://evil.com").unwrap();

        let link = ws.path().join("symlink_dir");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();

        proc.send_request(json!(17), "tools/call", json!({
            "name": "get_request",
            "arguments": { "path": "symlink_dir/leak.curl" }
        })).await;
        let symlink_resp = proc.read_response().await;
        assert_eq!(symlink_resp["result"]["isError"], true);
        assert!(symlink_resp["result"]["content"][0]["text"].as_str().unwrap().contains("escapes workspace root"));
    }
}

#[tokio::test]
async fn test_process_secrets_precedence_and_metadata_redaction() {
    let ws = TempWorkspace::new();
    let root = ws.path();

    // 1. environments/default.env.json
    fs::create_dir_all(root.join("environments")).unwrap();
    fs::write(root.join("environments/default.env.json"), r#"{"tier": "default", "api_key": "raw_default_key"}"#).unwrap();

    // 2. environments/production.env.json
    fs::write(root.join("environments/production.env.json"), r#"{"app_mode": "production", "api_key": "raw_prod_key"}"#).unwrap();

    // 3. collection_variables.json
    fs::create_dir_all(root.join("collections/api/.apiclient")).unwrap();
    fs::write(root.join("collections/api/.apiclient/collection_variables.json"), r#"{"tier": "collection"}"#).unwrap();

    // 4. .apiclient/.secrets.env (canonical format with comments and quotes)
    fs::create_dir_all(root.join(".apiclient")).unwrap();
    fs::write(root.join(".apiclient/.secrets.env"), r#"
# Comment line
tier=from_secrets_env
API_KEY="secret_key_42" # inline comment
SUPER_TOKEN='tok_99'
DUPLICATE=first
DUPLICATE=final_duplicate_val
"#).unwrap();

    // Legacy JSON secret store (must be ignored by MCP!)
    fs::write(root.join(".apiclient/.secrets.json"), r#"{"legacy_secret": "must_be_ignored"}"#).unwrap();

    let mut proc = McpProcess::spawn(root, &[]).await;

    // Test list_environments masks secret tokens
    proc.send_request(json!(20), "tools/call", json!({
        "name": "list_environments",
        "arguments": {}
    })).await;
    let env_resp = proc.read_response().await;
    let env_data: Value = serde_json::from_str(env_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let prod_env = env_data["environments"].as_array().unwrap().iter().find(|e| e["name"] == "production").unwrap();
    assert_eq!(prod_env["variables"]["api_key"], "***");
    assert_eq!(prod_env["variables"]["app_mode"], "production");

    // Save request with Authorization header
    proc.send_request(json!(21), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "collections/api/test.curl",
            "content": "curl https://api.example.com -H 'Authorization: Bearer mysecret' -H 'X-Custom: public_val'"
        }
    })).await;
    let _ = proc.read_response().await;

    // get_request: verify metadata redaction on headers, but rawContent remains untouched
    proc.send_request(json!(22), "tools/call", json!({
        "name": "get_request",
        "arguments": { "path": "collections/api/test.curl" }
    })).await;
    let get_resp = proc.read_response().await;
    let details: Value = serde_json::from_str(get_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    let headers = details["headers"].as_array().unwrap();
    let auth_header = headers.iter().find(|h| h["key"].as_str().map(|k| k.eq_ignore_ascii_case("authorization")).unwrap_or(false)).unwrap();
    assert_eq!(auth_header["value"], "***"); // Masked in metadata

    let custom_header = headers.iter().find(|h| h["key"].as_str().map(|k| k.eq_ignore_ascii_case("x-custom")).unwrap_or(false)).unwrap();
    assert_eq!(custom_header["value"], "public_val");

    // Raw content is untouched
    assert!(details["rawContent"].as_str().unwrap().contains("Authorization: Bearer mysecret"));
}

#[tokio::test]
async fn test_process_malformed_requests_and_unknown_methods() {
    let ws = TempWorkspace::new();
    let mut proc = McpProcess::spawn(ws.path(), &[]).await;

    // 1. Malformed JSON
    proc.send_raw("{ this is invalid json }").await;
    let err_resp = proc.read_response().await;
    assert_eq!(err_resp["error"]["code"], -32700);

    // 2. Unknown method
    proc.send_request(json!(99), "unknown/rpc_method", json!({})).await;
    let method_err = proc.read_response().await;
    assert_eq!(method_err["id"], 99);
    assert_eq!(method_err["error"]["code"], -32601);
}

#[tokio::test]
async fn test_process_http_execution_cancellation_and_size_limits() {
    let (http_addr, _shutdown) = start_http_fixture().await;
    let ws = TempWorkspace::new();
    let root = ws.path();

    // Write secrets.env
    fs::create_dir_all(root.join(".apiclient")).unwrap();
    fs::write(root.join(".apiclient/.secrets.env"), "TEST_SECRET=injected_pass_123\n").unwrap();

    // Spawn server with 4 MiB default
    let mut proc = McpProcess::spawn(root, &[]).await;

    // 1. execute_quick_curl
    let quick_cmd = format!(
        "curl -X POST \"http://{}/echo\" -H \"Content-Type: application/json\" -d '{{\"msg\":\"hello {{{{TEST_SECRET}}}}\"}}'",
        http_addr
    );
    proc.send_request(json!(30), "tools/call", json!({
        "name": "execute_quick_curl",
        "arguments": { "curl_command": quick_cmd }
    })).await;
    let quick_resp = proc.read_response().await;
    assert_eq!(quick_resp["result"]["isError"], false);
    let quick_res: Value = serde_json::from_str(quick_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(quick_res["status"], 200);
    // Secret was resolved and injected into body
    assert!(quick_res["body"].as_str().unwrap().contains("injected_pass_123"));

    // 2. execute_request with sidecar tests
    let saved_content = format!(
        "curl -X POST \"http://{}/echo\" -H \"Content-Type: application/json\" -d '{{\"ping\":\"pong\"}}'",
        http_addr
    );
    proc.send_request(json!(31), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "echo.curl",
            "content": saved_content,
            "sidecar": {
                "post_response_script": "pm.test('Status is 200', function() { pm.expect(pm.response.code).to.equal(200); });"
            }
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(32), "tools/call", json!({
        "name": "execute_request",
        "arguments": { "path": "echo.curl" }
    })).await;
    let exec_resp = proc.read_response().await;
    assert_eq!(exec_resp["result"]["isError"], false);
    let exec_res: Value = serde_json::from_str(exec_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(exec_res["status"], 200);
    assert_eq!(exec_res["tests"][0]["name"], "Status is 200");
    assert_eq!(exec_res["tests"][0]["passed"], true);

    fs::write(
        root.join("timeout.curl"),
        format!("# @timeout 100\ncurl \"http://{}/slow\"", http_addr),
    ).unwrap();
    proc.send_request(json!(35), "tools/call", json!({
        "name": "execute_request",
        "arguments": { "path": "timeout.curl" }
    })).await;
    let timeout_resp = proc.read_response().await;
    assert_eq!(timeout_resp["result"]["isError"], true);
    assert!(timeout_resp["result"]["content"][0]["text"].as_str().unwrap().contains("timed out"));

    // 3. HTTP Cancellation
    let slow_cmd = format!("curl \"http://{}/slow\"", http_addr);
    proc.send_request(json!(33), "tools/call", json!({
        "name": "execute_quick_curl",
        "arguments": { "curl_command": slow_cmd }
    })).await;

    // Send cancellation immediately
    tokio::time::sleep(Duration::from_millis(50)).await;
    proc.send_notification("notifications/cancelled", json!({ "requestId": 33 })).await;

    let cancel_resp = proc.read_response().await;
    assert_eq!(cancel_resp["id"], 33);
    assert_eq!(cancel_resp["error"]["code"], -32800);
    assert!(cancel_resp["error"]["message"].as_str().unwrap().contains("cancelled"));

    drop(proc);

    // 4. Response size limit rejection: spawn server with --max-response-bytes 1024
    let mut proc_bounded = McpProcess::spawn(root, &["--max-response-bytes", "1024"]).await;
    let large_cmd = format!("curl \"http://{}/large\"", http_addr);
    proc_bounded.send_request(json!(34), "tools/call", json!({
        "name": "execute_quick_curl",
        "arguments": { "curl_command": large_cmd }
    })).await;

    let size_resp = proc_bounded.read_response().await;
    assert_eq!(size_resp["result"]["isError"], true);
    let err_msg = size_resp["result"]["content"][0]["text"].as_str().unwrap();
    assert!(err_msg.contains("Response size limit exceeded") || err_msg.contains("exceeds maximum allowed"));
}

#[tokio::test]
async fn test_process_grpc_unary_streaming_reflection_and_proto() {
    let (grpc_addr, _shutdown) = start_grpc_fixture().await;
    let ws = TempWorkspace::new();
    let root = ws.path();

    // Copy hello.proto into workspace
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let proto_src = manifest_dir.join("tests/fixtures/test_hello.proto");
    fs::create_dir_all(root.join("protos")).unwrap();
    fs::copy(proto_src, root.join("protos/hello.proto")).unwrap();

    let mut proc = McpProcess::spawn(root, &[]).await;

    // 1. Save and execute unary gRPC request with reflection
    let unary_cmd = format!(
        "grpcurl -plaintext -d '{{\"greeting\":\"Gemini\"}}' {} HelloService/SayHello",
        grpc_addr
    );
    proc.send_request(json!(40), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "say_hello.grpcurl",
            "content": unary_cmd,
            "sidecar": {
                "post_response_script": "pm.test('Greeting check', function() { pm.expect(pm.response.json().reply).to.include('Gemini'); });"
            }
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(41), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "say_hello.grpcurl" }
    })).await;
    let unary_resp = proc.read_response().await;
    assert_eq!(unary_resp["result"]["isError"], false);
    let unary_data: Value = serde_json::from_str(unary_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(unary_data["status"], 200);
    assert_eq!(unary_data["parsedJson"]["reply"], "Hello, Gemini!");
    assert_eq!(unary_data["tests"][0]["name"], "Greeting check");
    assert_eq!(unary_data["tests"][0]["passed"], true);

    // 2. Execute with local proto file
    let proto_cmd = format!(
        "grpcurl -plaintext -import-path protos -proto hello.proto -d '{{\"greeting\":\"ProtoTester\"}}' {} HelloService/SayHello",
        grpc_addr
    );
    proc.send_request(json!(42), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "say_hello_proto.grpcurl",
            "content": proto_cmd
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(43), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "say_hello_proto.grpcurl" }
    })).await;
    let proto_resp = proc.read_response().await;
    assert_eq!(proto_resp["result"]["isError"], false);
    let proto_data: Value = serde_json::from_str(proto_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(proto_data["parsedJson"]["reply"], "Hello, ProtoTester!");

    // 3. Server-streaming gRPC call
    let stream_cmd = format!(
        "grpcurl -plaintext -d '{{\"greeting\":\"Streaming\"}}' {} HelloService/LotsOfReplies",
        grpc_addr
    );
    proc.send_request(json!(44), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "streaming.grpcurl",
            "content": stream_cmd
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(45), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "streaming.grpcurl" }
    })).await;
    let stream_resp = proc.read_response().await;
    assert_eq!(stream_resp["result"]["isError"], false);
    let stream_data: Value = serde_json::from_str(stream_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(stream_data["body"].as_str().unwrap().contains("1: Streaming"));
    assert!(stream_data["body"].as_str().unwrap().contains("2: Streaming"));

    // 4. Client-streaming gRPC call (printf pipe)
    let client_stream_cmd = format!(
        "printf '%s\\n' '{{\"greeting\":\"g1\"}}' '{{\"greeting\":\"g2\"}}' | grpcurl -plaintext -d @ {} HelloService/LotsOfGreetings",
        grpc_addr
    );
    proc.send_request(json!(46), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "client_stream.grpcurl",
            "content": client_stream_cmd
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(47), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "client_stream.grpcurl" }
    })).await;
    let cs_resp = proc.read_response().await;
    assert_eq!(cs_resp["result"]["isError"], false);
    let cs_data: Value = serde_json::from_str(cs_resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(cs_data["body"].as_str().unwrap().contains("Received 2 greetings"));

    save_grpc_request(
        &mut proc,
        55,
        "timeout.grpcurl",
        format!(
            "# @timeout 100\ngrpcurl -plaintext -d '{{}}' {} HelloService/SlowCall",
            grpc_addr
        ),
    ).await;
    let timeout_resp = execute_grpc_request(&mut proc, 56, "timeout.grpcurl").await;
    assert_eq!(timeout_resp["result"]["isError"], true);

    // 5. gRPC Cancellation
    let slow_grpc = format!("grpcurl -plaintext -d '{{}}' {} HelloService/SlowCall", grpc_addr);
    proc.send_request(json!(48), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "slow.grpcurl",
            "content": slow_grpc
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(49), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "slow.grpcurl" }
    })).await;

    tokio::time::sleep(Duration::from_millis(50)).await;
    proc.send_notification("notifications/cancelled", json!({ "requestId": 49 })).await;

    let cancel_grpc_resp = proc.read_response().await;
    assert_eq!(cancel_grpc_resp["id"], 49);
    assert_eq!(cancel_grpc_resp["error"]["code"], -32800);
    assert!(cancel_grpc_resp["error"]["message"].as_str().unwrap().contains("cancelled"));

    // 6. Transport cross-call rejection
    proc.send_request(json!(50), "tools/call", json!({
        "name": "execute_request",
        "arguments": { "path": "say_hello.grpcurl" }
    })).await;
    let reject_resp1 = proc.read_response().await;
    assert_eq!(reject_resp1["result"]["isError"], true);
    assert!(reject_resp1["result"]["content"][0]["text"].as_str().unwrap().contains("execute_request only supports .curl"));

    // Save a .curl file
    proc.send_request(json!(51), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "dummy.curl",
            "content": "curl https://example.com"
        }
    })).await;
    let _ = proc.read_response().await;

    proc.send_request(json!(52), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "dummy.curl" }
    })).await;
    let reject_resp2 = proc.read_response().await;
    assert_eq!(reject_resp2["result"]["isError"], true);
    assert!(reject_resp2["result"]["content"][0]["text"].as_str().unwrap().contains("execute_grpc_request only supports .grpcurl"));

    drop(proc);

    // 7. gRPC response size limit rejection
    let mut proc_bounded = McpProcess::spawn(root, &["--max-response-bytes", "100"]).await;
    let large_grpc = format!("grpcurl -plaintext -d '{{}}' {} HelloService/LargeCall", grpc_addr);
    proc_bounded.send_request(json!(53), "tools/call", json!({
        "name": "save_request",
        "arguments": {
            "path": "large_grpc.grpcurl",
            "content": large_grpc
        }
    })).await;
    let _ = proc_bounded.read_response().await;

    proc_bounded.send_request(json!(54), "tools/call", json!({
        "name": "execute_grpc_request",
        "arguments": { "path": "large_grpc.grpcurl" }
    })).await;
    let size_grpc_resp = proc_bounded.read_response().await;
    assert_eq!(size_grpc_resp["result"]["isError"], true);
    assert!(size_grpc_resp["result"]["content"][0]["text"].as_str().unwrap().contains("exceeds maximum allowed"));
}

#[tokio::test]
async fn test_process_grpc_tls_verification_and_streaming_modes() {
    let (grpc_addr, _shutdown) = start_grpc_tls_fixture().await;
    let ws = TempWorkspace::new();
    let root = ws.path();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    fs::create_dir_all(root.join("protos")).unwrap();
    fs::copy(
        manifest_dir.join("tests/fixtures/test_hello.proto"),
        root.join("protos/hello.proto"),
    ).unwrap();
    fs::copy(
        manifest_dir.join("tests/fixtures/grpc-test-ca.crt"),
        root.join("tls-ca.crt"),
    ).unwrap();

    let mut proc = McpProcess::spawn(root, &[]).await;
    let target = format!("127.0.0.1:{}", grpc_addr.port());

    save_grpc_request(
        &mut proc,
        1,
        "untrusted.grpcurl",
        format!("grpcurl -d '{{\"greeting\":\"untrusted\"}}' {target} HelloService/SayHello"),
    ).await;
    let untrusted = execute_grpc_request(&mut proc, 2, "untrusted.grpcurl").await;
    assert_eq!(untrusted["result"]["isError"], true);

    save_grpc_request(
        &mut proc,
        3,
        "trusted-reflection.grpcurl",
        format!(
            "grpcurl -cacert tls-ca.crt -H 'x-test: ping' -d '{{\"greeting\":\"trusted\"}}' {target} HelloService/SayHello"
        ),
    ).await;
    let trusted = execute_grpc_request(&mut proc, 4, "trusted-reflection.grpcurl").await;
    assert_eq!(trusted["result"]["isError"], false, "{}", trusted);
    let trusted_data: Value = serde_json::from_str(
        trusted["result"]["content"][0]["text"].as_str().unwrap(),
    ).unwrap();
    assert_eq!(trusted_data["parsedJson"]["reply"], "Hello, trusted!");
    assert_eq!(trusted_data["headers"]["x-echoed-metadata"], "ping");

    save_grpc_request(
        &mut proc,
        5,
        "trusted-local-proto.grpcurl",
        format!(
            "grpcurl -cacert tls-ca.crt -import-path protos -proto hello.proto -d '{{\"greeting\":\"local proto\"}}' {target} HelloService/SayHello"
        ),
    ).await;
    let local_proto = execute_grpc_request(&mut proc, 6, "trusted-local-proto.grpcurl").await;
    assert_eq!(local_proto["result"]["isError"], false, "{}", local_proto);
    let local_proto_data: Value = serde_json::from_str(
        local_proto["result"]["content"][0]["text"].as_str().unwrap(),
    ).unwrap();
    assert_eq!(local_proto_data["parsedJson"]["reply"], "Hello, local proto!");

    save_grpc_request(
        &mut proc,
        7,
        "tls-server-stream.grpcurl",
        format!(
            "grpcurl -cacert tls-ca.crt -d '{{\"greeting\":\"server stream\"}}' {target} HelloService/LotsOfReplies"
        ),
    ).await;
    let server_stream = execute_grpc_request(&mut proc, 8, "tls-server-stream.grpcurl").await;
    assert_eq!(server_stream["result"]["isError"], false, "{}", server_stream);
    let server_stream_data: Value = serde_json::from_str(
        server_stream["result"]["content"][0]["text"].as_str().unwrap(),
    ).unwrap();
    assert!(server_stream_data["body"].as_str().unwrap().contains("1: server stream"));
    assert!(server_stream_data["body"].as_str().unwrap().contains("2: server stream"));

    let client_stream = format!(
        "printf '%s\\n' '{{\"greeting\":\"g1\"}}' '{{\"greeting\":\"g2\"}}' | grpcurl -cacert tls-ca.crt -d @ {target} HelloService/LotsOfGreetings"
    );
    save_grpc_request(&mut proc, 9, "tls-client-stream.grpcurl", client_stream).await;
    let client_stream_resp = execute_grpc_request(&mut proc, 10, "tls-client-stream.grpcurl").await;
    assert_eq!(client_stream_resp["result"]["isError"], false, "{}", client_stream_resp);
    let client_stream_data: Value = serde_json::from_str(
        client_stream_resp["result"]["content"][0]["text"].as_str().unwrap(),
    ).unwrap();
    assert!(client_stream_data["body"].as_str().unwrap().contains("Received 2 greetings"));

    let bidi_stream = format!(
        "printf '%s\\n' '{{\"greeting\":\"first\"}}' '{{\"greeting\":\"second\"}}' | grpcurl -cacert tls-ca.crt -d @ {target} fixture.BidiService/BidiHello"
    );
    save_grpc_request(&mut proc, 11, "tls-bidi-stream.grpcurl", bidi_stream).await;
    let bidi_stream_resp = execute_grpc_request(&mut proc, 12, "tls-bidi-stream.grpcurl").await;
    assert_eq!(bidi_stream_resp["result"]["isError"], false, "{}", bidi_stream_resp);
    let bidi_stream_data: Value = serde_json::from_str(
        bidi_stream_resp["result"]["content"][0]["text"].as_str().unwrap(),
    ).unwrap();
    assert!(bidi_stream_data["body"].as_str().unwrap().contains("Echo: first"));
    assert!(bidi_stream_data["body"].as_str().unwrap().contains("Echo: second"));

    save_grpc_request(
        &mut proc,
        13,
        "skip-certificate.grpcurl",
        format!("grpcurl -insecure -d '{{\"greeting\":\"skip certificate\"}}' {target} HelloService/SayHello"),
    ).await;
    let skip_certificate = execute_grpc_request(&mut proc, 14, "skip-certificate.grpcurl").await;
    assert_eq!(skip_certificate["result"]["isError"], false, "{}", skip_certificate);

    let wrong_host = format!("localhost:{}", grpc_addr.port());
    save_grpc_request(
        &mut proc,
        15,
        "wrong-host.grpcurl",
        format!(
            "grpcurl -cacert tls-ca.crt -d '{{\"greeting\":\"wrong host\"}}' {wrong_host} HelloService/SayHello"
        ),
    ).await;
    let wrong_host_resp = execute_grpc_request(&mut proc, 16, "wrong-host.grpcurl").await;
    assert_eq!(wrong_host_resp["result"]["isError"], true);

    save_grpc_request(
        &mut proc,
        17,
        "missing-ca.grpcurl",
        format!(
            "grpcurl -cacert missing-ca.crt -d '{{\"greeting\":\"missing CA\"}}' {target} HelloService/SayHello"
        ),
    ).await;
    let missing_ca = execute_grpc_request(&mut proc, 18, "missing-ca.grpcurl").await;
    assert_eq!(missing_ca["result"]["isError"], true);
    assert!(
        missing_ca["result"]["content"][0]["text"].as_str().unwrap().contains("File not found"),
        "unexpected missing CA error: {missing_ca}"
    );

    let conflicting_tls_config = json!({
        "name": "Conflicting TLS options",
        "endpoint": format!("https://{target}"),
        "service": "HelloService",
        "method": "SayHello",
        "request_json": "{}",
        "metadata": [],
        "proto_file": null,
        "use_reflection": true,
        "tls_enabled": true,
        "tls_insecure": true,
        "tls_ca_file": "tls-ca.crt",
        "timeout_ms": 30000
    }).to_string();
    save_grpc_request(&mut proc, 19, "conflicting-tls.grpc", conflicting_tls_config).await;
    let conflicting_tls = execute_grpc_request(&mut proc, 20, "conflicting-tls.grpc").await;
    assert_eq!(conflicting_tls["result"]["isError"], true);
    assert!(conflicting_tls["result"]["content"][0]["text"].as_str().unwrap().contains(
        "Choose either certificate bypass or a custom CA certificate"
    ));
}
