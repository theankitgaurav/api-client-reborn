use std::path::{Component, Path, PathBuf};

/// Centralized canonical workspace path validator enforcing strict workspace containment.
#[derive(Debug, Clone)]
pub struct WorkspacePathValidator {
    canonical_root: PathBuf,
}

impl WorkspacePathValidator {
    pub fn new(root: &Path) -> Result<Self, String> {
        let canonical_root = if root.exists() {
            root.canonicalize()
                .map_err(|e| format!("Failed to canonicalize workspace root: {e}"))?
        } else {
            root.to_path_buf()
        };
        Ok(Self { canonical_root })
    }

    pub fn root(&self) -> &Path {
        &self.canonical_root
    }

    /// Validates syntax of relative path without disk access:
    /// - Rejects NUL bytes
    /// - Rejects absolute paths (leading slash, backslash, Windows drive letters)
    /// - Rejects ParentDir (`..`) components
    pub fn check_relative_syntax(path_str: &str) -> Result<PathBuf, String> {
        if path_str.contains('\0') {
            return Err("Access denied: path contains NUL bytes.".into());
        }
        let trimmed = path_str.trim();
        if trimmed.is_empty() || trimmed == "." {
            return Ok(PathBuf::new());
        }

        let normalized = trimmed.replace('\\', "/");
        if normalized.starts_with('/') || normalized.starts_with('\\') {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                path_str
            ));
        }

        if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                path_str
            ));
        }

        let path = Path::new(&normalized);
        if path.is_absolute() {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                path_str
            ));
        }

        for component in path.components() {
            if matches!(component, Component::ParentDir) {
                return Err(format!(
                    "Access denied: path '{}' escapes workspace root.",
                    path_str
                ));
            }
        }

        Ok(PathBuf::from(normalized))
    }

    /// Resolves and validates an existing file or directory against the canonical workspace.
    /// Canonicalizes the path and asserts it starts with canonical_root.
    pub fn validate_existing_path(&self, relative_str: &str) -> Result<PathBuf, String> {
        let rel = Self::check_relative_syntax(relative_str)?;
        let candidate = if rel.as_os_str().is_empty() {
            self.canonical_root.clone()
        } else {
            self.canonical_root.join(rel)
        };

        if !candidate.exists() {
            return Err(format!("File not found: {}", relative_str));
        }

        let canonical = candidate.canonicalize().map_err(|e| {
            format!(
                "Access denied: unable to resolve path '{}': {}",
                relative_str, e
            )
        })?;

        if !canonical.starts_with(&self.canonical_root) {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                relative_str
            ));
        }

        Ok(canonical)
    }

    /// Resolves and validates a path for writing.
    /// If the candidate does not exist, traverses up to the nearest existing ancestor,
    /// canonicalizes it, and asserts it starts with canonical_root.
    pub fn validate_write_path(&self, relative_str: &str) -> Result<PathBuf, String> {
        let rel = Self::check_relative_syntax(relative_str)?;
        if rel.as_os_str().is_empty() {
            return Ok(self.canonical_root.clone());
        }

        let candidate = self.canonical_root.join(&rel);
        if candidate.exists() {
            let canonical = candidate.canonicalize().map_err(|e| {
                format!(
                    "Access denied: unable to resolve path '{}': {}",
                    relative_str, e
                )
            })?;
            if !canonical.starts_with(&self.canonical_root) {
                return Err(format!(
                    "Access denied: path '{}' escapes workspace root.",
                    relative_str
                ));
            }
            return Ok(canonical);
        }

        // Walk up to nearest existing parent directory
        let mut ancestor = candidate.as_path();
        while !ancestor.exists() {
            match ancestor.parent() {
                Some(p) => ancestor = p,
                None => break,
            }
        }

        let canonical_ancestor = ancestor.canonicalize().map_err(|e| {
            format!(
                "Access denied: unable to resolve ancestor directory: {}",
                e
            )
        })?;

        if !canonical_ancestor.starts_with(&self.canonical_root) {
            return Err(format!(
                "Access denied: path '{}' escapes workspace root.",
                relative_str
            ));
        }

        Ok(candidate)
    }

    /// Validates request file extension for get_request.
    /// Rejects every extension except `.curl`, `.grpcurl`, and `.grpc`.
    pub fn validate_request_extension(path_str: &str) -> Result<(), String> {
        let lower = path_str.to_lowercase();
        if !(lower.ends_with(".curl") || lower.ends_with(".grpcurl") || lower.ends_with(".grpc")) {
            return Err(format!(
                "Invalid request file extension: '{}'. Only .curl, .grpcurl, and .grpc files are supported.",
                path_str
            ));
        }
        Ok(())
    }

    /// Converts an absolute canonical path back to a workspace-relative string with forward slashes.
    pub fn relative_str(&self, path: &Path) -> String {
        path.strip_prefix(&self.canonical_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("test-ws-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp_workspace() -> (TempDirGuard, WorkspacePathValidator) {
        let dir = TempDirGuard::new();
        let validator = WorkspacePathValidator::new(dir.path()).unwrap();
        (dir, validator)
    }

    #[test]
    fn test_reject_nul_bytes() {
        assert!(WorkspacePathValidator::check_relative_syntax("evil\0file.curl").is_err());
    }

    #[test]
    fn test_reject_absolute_paths() {
        assert!(WorkspacePathValidator::check_relative_syntax("/etc/passwd").is_err());
        assert!(WorkspacePathValidator::check_relative_syntax("\\Windows\\System32").is_err());
        assert!(WorkspacePathValidator::check_relative_syntax("C:/Windows").is_err());
    }

    #[test]
    fn test_reject_parent_traversal() {
        assert!(WorkspacePathValidator::check_relative_syntax("../etc/passwd").is_err());
        assert!(WorkspacePathValidator::check_relative_syntax("foo/../../bar").is_err());
    }

    #[test]
    fn test_extension_validation() {
        assert!(WorkspacePathValidator::validate_request_extension("test.curl").is_ok());
        assert!(WorkspacePathValidator::validate_request_extension("test.grpcurl").is_ok());
        assert!(WorkspacePathValidator::validate_request_extension("test.grpc").is_ok());
        assert!(WorkspacePathValidator::validate_request_extension("test.txt").is_err());
        assert!(WorkspacePathValidator::validate_request_extension("test.json").is_err());
        assert!(WorkspacePathValidator::validate_request_extension("test.env").is_err());
    }

    #[test]
    fn test_nearest_existing_parent_for_write() {
        let (dir, validator) = temp_workspace();
        let sub = dir.path().join("sub");
        fs::create_dir_all(&sub).unwrap();

        let write_path = validator.validate_write_path("sub/deep/new.curl").unwrap();
        assert!(write_path.starts_with(validator.root()));
    }

    #[cfg(unix)]
    #[test]
    fn test_symlink_escaping_workspace_rejected() {
        let (dir, validator) = temp_workspace();
        let outside = TempDirGuard::new();
        let outside_file = outside.path().join("secret.txt");
        fs::write(&outside_file, "secret").unwrap();

        let link = dir.path().join("outside_link");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();

        let err = validator.validate_existing_path("outside_link/secret.txt");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("escapes workspace root"));
    }
}
