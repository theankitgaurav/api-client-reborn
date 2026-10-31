export interface HeaderPair {
  key: String;
  value: String;
}

export interface BasicAuth {
  username: string;
  password?: string;
}

export interface ParsedCurlRequest {
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body?: string;
  basic_auth?: BasicAuth;
  timeout_ms?: number;
  follow_redirects: boolean;
  insecure: boolean;
  proxy?: string;
  unsupported_flags: string[];
}

export interface RequestMetadata {
  name?: string;
  description?: string;
  timeout_ms?: number;
  default_env?: string;
  service?: string;
  method?: string;
}

export interface TestCase {
  test_type: string;
  expected: any;
  path?: string;
}

export interface TestResultItem {
  name: string;
  passed: boolean;
  error?: string;
}

export interface SidecarMetadata {
  name?: string;
  description?: string;
  tests: TestCase[];
  tab_color?: string;
  pre_request_script?: string;
  post_response_script?: string;
}

export interface VariableItem {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
}

export interface FileDetails {
  path: string;
  raw_content: string;
  metadata: RequestMetadata;
  sidecar?: SidecarMetadata;
}

export interface WorkspaceFileItem {
  name: string;
  path: string;
  is_dir: boolean;
  display_name?: string;
  method?: string;
  kind?: 'http' | 'grpc';
  children?: WorkspaceFileItem[];
}

export interface GrpcRequestConfig {
  name: string;
  endpoint: string;
  service: string;
  method: string;
  request_json: string;
  metadata: { key: string; value: string }[];
  proto_file?: string | null;
  use_reflection: boolean;
  tls_enabled: boolean;
  tls_insecure: boolean;
  tls_ca_file?: string | null;
  timeout_ms: number;
}

export interface GrpcMethodInfo {
  name: string;
  input_type: string;
  output_type: string;
  client_streaming: boolean;
  server_streaming: boolean;
}

export interface GrpcServiceInfo {
  name: string;
  methods: GrpcMethodInfo[];
}

export interface EnvironmentItem {
  name: string;
  file_path: string;
  variables: [string, string][];
}

export interface RequestHistoryEntry {
  id: string;
  timestamp: string;
  request_name: string;
  request_path: string | null;
  method: string;
  url: string;
  raw_command: string;
  status: number | null;
  status_text: string;
  headers: { key: string; value: string }[];
  response_body: string;
  duration_ms: number | null;
  total_bytes: number;
  is_streaming: boolean;
  response_file_path?: string | null;
  is_body_truncated?: boolean;
  total_events_count?: number;
  error: string | null;
}

export type ResponseChunk =
  | { type: 'Started'; payload: { request_id: string } }
  | {
      type: 'HeaderReceived';
      payload: {
        status: number;
        status_text: string;
        headers: { key: string; value: string }[];
        protocol: string;
        ttfb_ms: number;
        is_streaming: boolean;
      };
    }
  | {
      type: 'BodyChunk';
      payload: {
        text: string;
        bytes_received: number;
      };
    }
  | {
      type: 'SseChunk';
      payload: {
        id?: string;
        event?: string;
        data: string;
      };
    }
  | {
      type: 'Finished';
      payload: {
        total_duration_ms: number;
        total_bytes: number;
        spool_file_path?: string;
      };
    }
  | {
      type: 'Failed';
      payload: {
        error: string;
      };
    };
