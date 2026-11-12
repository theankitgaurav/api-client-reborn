use serde::{Serialize, Serializer};

#[derive(thiserror::Error, Debug, Clone)]
pub enum AppError {
    #[error("Lexer error: {0}")]
    LexerError(String),

    #[error("cURL parser error: {0}")]
    CurlParserError(String),

    #[error("gRPC parser error: {0}")]
    GrpcParserError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Request cancelled")]
    Cancelled,

    #[error("Response size limit exceeded: {0}")]
    ResponseLimitExceeded(String),

    #[error("Request timed out: {0}")]
    Timeout(String),

    #[error("Environment resolution error: {0}")]
    EnvError(String),

    #[error("Filesystem error: {0}")]
    FsError(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
