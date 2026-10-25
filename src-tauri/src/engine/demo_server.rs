use bytes::Bytes;
use http::{Request, Response};
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Full};
use prost::Message;
use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tonic::server::NamedService;
use tower::Service;

#[derive(Clone, PartialEq, prost::Message)]
pub struct UserRequest {
    #[prost(int32, tag = "1")]
    pub id: i32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct UserResponse {
    #[prost(int32, tag = "1")]
    pub id: i32,
    #[prost(string, tag = "2")]
    pub name: String,
    #[prost(string, tag = "3")]
    pub email: String,
    #[prost(string, tag = "4")]
    pub role: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct EchoRequest {
    #[prost(string, tag = "1")]
    pub message: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct EchoResponse {
    #[prost(string, tag = "1")]
    pub message: String,
    #[prost(int64, tag = "2")]
    pub timestamp: i64,
}

#[derive(Clone, Default)]
pub struct UserServiceServer;

impl NamedService for UserServiceServer {
    const NAME: &'static str = "api.v1.UserService";
}

fn frame_grpc_message(bytes: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + bytes.len());
    frame.push(0); // compression flag (0 = uncompressed)
    frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(bytes);
    frame
}

fn parse_grpc_frame(bytes: &[u8]) -> Option<&[u8]> {
    if bytes.len() < 5 {
        return None;
    }
    let len = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]) as usize;
    if bytes.len() < 5 + len {
        return None;
    }
    Some(&bytes[5..5 + len])
}

impl<B> Service<Request<B>> for UserServiceServer
where
    B: http_body::Body<Data = Bytes> + Send + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>> + Send + 'static,
{
    type Response = Response<BoxBody<Bytes, tonic::Status>>;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, req: Request<B>) -> Self::Future {
        Box::pin(async move {
            let path = req.uri().path().to_string();
            let (_parts, body) = req.into_parts();

            let collected = match body.collect().await {
                Ok(c) => c.to_bytes(),
                Err(_) => Bytes::new(),
            };

            let payload = parse_grpc_frame(&collected).unwrap_or(&[]);

            if path == "/api.v1.UserService/GetUser" {
                let user_req = UserRequest::decode(payload).unwrap_or(UserRequest { id: 0 });
                let id = if user_req.id == 0 { 42 } else { user_req.id };
                let user_resp = UserResponse {
                    id,
                    name: if id == 42 { "Jane Doe".to_string() } else { format!("User {}", id) },
                    email: if id == 42 { "jane.doe@example.com".to_string() } else { format!("user{}@example.com", id) },
                    role: if id == 42 { "Admin".to_string() } else { "Member".to_string() },
                };

                let resp_frame = frame_grpc_message(&user_resp.encode_to_vec());
                let body = Full::new(Bytes::from(resp_frame))
                    .map_err(|never| match never {})
                    .boxed();

                let mut resp = Response::new(body);
                resp.headers_mut().insert("content-type", "application/grpc".parse().unwrap());
                resp.headers_mut().insert("grpc-status", "0".parse().unwrap());
                resp.headers_mut().insert("grpc-message", "OK".parse().unwrap());
                return Ok(resp);
            }

            if path == "/api.v1.UserService/Echo" {
                let echo_req = EchoRequest::decode(payload).unwrap_or(EchoRequest { message: String::new() });
                let echo_resp = EchoResponse {
                    message: echo_req.message,
                    timestamp: chrono::Utc::now().timestamp(),
                };

                let resp_frame = frame_grpc_message(&echo_resp.encode_to_vec());
                let body = Full::new(Bytes::from(resp_frame))
                    .map_err(|never| match never {})
                    .boxed();

                let mut resp = Response::new(body);
                resp.headers_mut().insert("content-type", "application/grpc".parse().unwrap());
                resp.headers_mut().insert("grpc-status", "0".parse().unwrap());
                return Ok(resp);
            }

            // Unimplemented
            let body = Full::new(Bytes::new())
                .map_err(|never| match never {})
                .boxed();
            let mut resp = Response::new(body);
            resp.headers_mut().insert("content-type", "application/grpc".parse().unwrap());
            resp.headers_mut().insert("grpc-status", "12".parse().unwrap());
            resp.headers_mut().insert("grpc-message", "unknown method".parse().unwrap());
            Ok(resp)
        })
    }
}

/// Starts the demo gRPC services.
/// - reflection_port (e.g. 50051): UserService + gRPC Server Reflection
/// - no_reflection_port (e.g. 50052): UserService WITHOUT Server Reflection
pub async fn start_demo_grpc_services(
    reflection_port: u16,
    no_reflection_port: u16,
    proto_path: &str,
) -> crate::error::Result<()> {
    let proto_file = std::path::Path::new(proto_path);
    let parent_dir = proto_file.parent().unwrap_or(std::path::Path::new("."));

    let fds = protox::compile([proto_file], [parent_dir])
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to compile proto: {}", e)))?;
    let fds_bytes = fds.encode_to_vec();

    let reflection_service_v1 = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1()
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to build reflection v1: {}", e)))?;

    let reflection_service_v1alpha = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1alpha()
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to build reflection v1alpha: {}", e)))?;

    let addr_reflection: std::net::SocketAddr = format!("127.0.0.1:{}", reflection_port)
        .parse()
        .map_err(|e| crate::error::AppError::InternalError(format!("Invalid address: {}", e)))?;

    let addr_no_reflection: std::net::SocketAddr = format!("127.0.0.1:{}", no_reflection_port)
        .parse()
        .map_err(|e| crate::error::AppError::InternalError(format!("Invalid address: {}", e)))?;

    let s1 = tonic::transport::Server::builder()
        .add_service(reflection_service_v1)
        .add_service(reflection_service_v1alpha)
        .add_service(UserServiceServer)
        .serve(addr_reflection);

    // Spawn server 2 (No reflection)
    let s2 = tonic::transport::Server::builder()
        .add_service(UserServiceServer)
        .serve(addr_no_reflection);

    tokio::try_join!(
        async { s1.await.map_err(|e| crate::error::AppError::InternalError(format!("Reflection server error: {}", e))) },
        async { s2.await.map_err(|e| crate::error::AppError::InternalError(format!("No-reflection server error: {}", e))) }
    )?;

    Ok(())
}

#[derive(Debug)]
pub struct UnixStreamWrapper(pub tokio::net::UnixStream);

impl tonic::transport::server::Connected for UnixStreamWrapper {
    type ConnectInfo = ();
    fn connect_info(&self) -> Self::ConnectInfo {}
}

impl AsyncRead for UnixStreamWrapper {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl AsyncWrite for UnixStreamWrapper {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}

pub struct UnixIncoming(pub tokio::net::UnixListener);

impl futures_util::Stream for UnixIncoming {
    type Item = std::io::Result<UnixStreamWrapper>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.0.poll_accept(cx) {
            Poll::Ready(Ok((stream, _))) => Poll::Ready(Some(Ok(UnixStreamWrapper(stream)))),
            Poll::Ready(Err(e)) => Poll::Ready(Some(Err(e))),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Starts demo gRPC services bound to Unix domain sockets.
pub async fn start_demo_grpc_services_unix(
    reflection_sock: &str,
    no_reflection_sock: &str,
    proto_path: &str,
) -> crate::error::Result<()> {
    let _ = std::fs::remove_file(reflection_sock);
    let _ = std::fs::remove_file(no_reflection_sock);

    let l1 = tokio::net::UnixListener::bind(reflection_sock).map_err(|e| {
        crate::error::AppError::InternalError(format!("Failed to bind unix socket {}: {}", reflection_sock, e))
    })?;
    let l2 = tokio::net::UnixListener::bind(no_reflection_sock).map_err(|e| {
        crate::error::AppError::InternalError(format!("Failed to bind unix socket {}: {}", no_reflection_sock, e))
    })?;

    let proto_file = std::path::Path::new(proto_path);
    let parent_dir = proto_file.parent().unwrap_or(std::path::Path::new("."));

    let fds = protox::compile([proto_file], [parent_dir])
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to compile proto: {}", e)))?;
    let fds_bytes = fds.encode_to_vec();

    let reflection_service = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1()
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to build reflection: {}", e)))?;

    let s1 = tonic::transport::Server::builder()
        .add_service(reflection_service)
        .add_service(UserServiceServer)
        .serve_with_incoming(UnixIncoming(l1));

    let s2 = tonic::transport::Server::builder()
        .add_service(UserServiceServer)
        .serve_with_incoming(UnixIncoming(l2));

    tokio::select! {
        res1 = s1 => {
            if let Err(e) = res1 {
                return Err(crate::error::AppError::InternalError(format!("Reflection server error: {}", e)));
            }
        }
        res2 = s2 => {
            if let Err(e) = res2 {
                return Err(crate::error::AppError::InternalError(format!("No-reflection server error: {}", e)));
            }
        }
    }

    Ok(())
}

#[derive(Debug)]
pub struct DuplexStreamWrapper(pub tokio::io::DuplexStream);

impl tonic::transport::server::Connected for DuplexStreamWrapper {
    type ConnectInfo = ();
    fn connect_info(&self) -> Self::ConnectInfo {}
}

impl AsyncRead for DuplexStreamWrapper {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl AsyncWrite for DuplexStreamWrapper {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}

pub struct DuplexIncoming(pub tokio::sync::mpsc::Receiver<tokio::io::DuplexStream>);

impl futures_util::Stream for DuplexIncoming {
    type Item = std::io::Result<DuplexStreamWrapper>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match self.0.poll_recv(cx) {
            Poll::Ready(Some(s)) => Poll::Ready(Some(Ok(DuplexStreamWrapper(s)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Starts demo gRPC services bound to in-memory duplex channels (zero network/OS socket dependencies).
pub async fn start_demo_grpc_services_duplex(
    reflection_rx: tokio::sync::mpsc::Receiver<tokio::io::DuplexStream>,
    no_reflection_rx: tokio::sync::mpsc::Receiver<tokio::io::DuplexStream>,
    proto_path: &str,
) -> crate::error::Result<()> {
    let proto_file = std::path::Path::new(proto_path);
    let parent_dir = proto_file.parent().unwrap_or(std::path::Path::new("."));

    let fds = protox::compile([proto_file], [parent_dir])
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to compile proto: {}", e)))?;
    let fds_bytes = fds.encode_to_vec();

    let reflection_service_v1 = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1()
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to build reflection v1: {}", e)))?;

    let reflection_service_v1alpha = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(&fds_bytes)
        .build_v1alpha()
        .map_err(|e| crate::error::AppError::InternalError(format!("Failed to build reflection v1alpha: {}", e)))?;

    let s1 = tonic::transport::Server::builder()
        .add_service(reflection_service_v1)
        .add_service(reflection_service_v1alpha)
        .add_service(UserServiceServer)
        .serve_with_incoming(DuplexIncoming(reflection_rx));

    let s2 = tonic::transport::Server::builder()
        .add_service(UserServiceServer)
        .serve_with_incoming(DuplexIncoming(no_reflection_rx));

    tokio::select! {
        res1 = s1 => {
            if let Err(e) = res1 {
                return Err(crate::error::AppError::InternalError(format!("Reflection server error: {}", e)));
            }
        }
        res2 = s2 => {
            if let Err(e) = res2 {
                return Err(crate::error::AppError::InternalError(format!("No-reflection server error: {}", e)));
            }
        }
    }

    Ok(())
}
