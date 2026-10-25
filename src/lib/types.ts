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
  tags?: string[];
  service?: string;
  method?: string;
}

export interface TestCase {
  test_type: string;
  expected: any;
  path?: string;
}

export interface SidecarMetadata {
  name?: string;
  description?: string;
  tests: TestCase[];
  tab_color?: string;
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
  children?: WorkspaceFileItem[];
}

export interface EnvironmentItem {
  name: string;
  file_path: string;
  variables: [string, string][];
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
      };
    }
  | {
      type: 'Failed';
      payload: {
        error: string;
      };
    };
