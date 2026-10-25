use serde::{Serialize, Serializer};

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Lexer error: {0}")]
    LexerError(String),

    #[error("cURL parser error: {0}")]
    CurlParserError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Request cancelled")]
    Cancelled,

    #[error("Environment resolution error: {0}")]
    EnvError(String),

    #[error("Filesystem error: {0}")]
    FsError(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_str())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
