use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default)]
pub struct CancellationManager {
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl CancellationManager {
    pub fn new() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register(&self, request_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        let mut map = self.tokens.lock().unwrap();
        map.insert(request_id.to_string(), token.clone());
        token
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        let mut map = self.tokens.lock().unwrap();
        if let Some(token) = map.remove(request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub fn remove(&self, request_id: &str) {
        let mut map = self.tokens.lock().unwrap();
        map.remove(request_id);
    }
}
