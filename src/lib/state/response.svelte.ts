import { cancelRequest, executeRequest } from '../ipc';
import type { ResponseChunk } from '../types';
import { envState } from './env.svelte';
import { workspaceState } from './workspace.svelte';

export interface StreamItem {
  id?: string;
  event?: string;
  data: string;
  timestamp: string;
  bytes?: number;
}

export class ResponseState {
  isExecuting = $state(false);
  isStreaming = $state(false);
  activeRequestId = $state<string | null>(null);

  status = $state<number | null>(null);
  statusText = $state<string>('');
  protocol = $state<string>('');
  ttfbMs = $state<number | null>(null);
  durationMs = $state<number | null>(null);
  totalBytes = $state<number>(0);

  headers = $state<{ key: string; value: string }[]>([]);
  bodyText = $state<string>('');
  streamMessages = $state<StreamItem[]>([]);
  error = $state<string | null>(null);

  activeTab = $state<'body' | 'headers' | 'stream' | 'raw'>('body');

  async runCurrentRequest() {
    if (!workspaceState.activeFile) return;

    this.isExecuting = true;
    this.isStreaming = false;
    this.error = null;
    this.status = null;
    this.statusText = '';
    this.headers = [];
    this.bodyText = '';
    this.streamMessages = [];
    this.durationMs = null;
    this.totalBytes = 0;
    this.activeTab = 'body';

    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;

    try {
      await executeRequest(
        requestId,
        workspaceState.activeFile.raw_content,
        envState.mergedVariables,
        (chunk: ResponseChunk) => {
          this.handleChunk(chunk);
        }
      );
    } catch (e: any) {
      this.error = e.toString();
      this.isExecuting = false;
    }
  }

  handleChunk(chunk: ResponseChunk) {
    switch (chunk.type) {
      case 'HeaderReceived':
        this.status = chunk.payload.status;
        this.statusText = chunk.payload.status_text;
        this.headers = chunk.payload.headers;
        this.protocol = chunk.payload.protocol;
        this.ttfbMs = chunk.payload.ttfb_ms;
        this.isStreaming = chunk.payload.is_streaming;

        if (this.isStreaming) {
          this.activeTab = 'stream';
        }
        break;

      case 'BodyChunk': {
        this.bodyText += chunk.payload.text;
        this.totalBytes = chunk.payload.bytes_received;

        // If streaming or line-delimited chunks
        const raw = chunk.payload.text.trim();
        if (raw) {
          const lines = raw.split('\n').filter((l) => l.trim().length > 0);
          for (const line of lines) {
            this.streamMessages.push({
              event: 'chunk',
              data: line,
              timestamp: new Date().toLocaleTimeString(),
              bytes: line.length,
            });
          }
        }

        if (this.isStreaming && this.activeTab !== 'stream') {
          this.activeTab = 'stream';
        }
        break;
      }

      case 'SseChunk':
        this.streamMessages.push({
          id: chunk.payload.id,
          event: chunk.payload.event || 'message',
          data: chunk.payload.data,
          timestamp: new Date().toLocaleTimeString(),
          bytes: chunk.payload.data.length,
        });
        if (this.activeTab !== 'stream') {
          this.activeTab = 'stream';
        }
        break;

      case 'Finished':
        this.durationMs = chunk.payload.total_duration_ms;
        this.totalBytes = chunk.payload.total_bytes;
        this.isExecuting = false;
        break;

      case 'Failed':
        this.error = chunk.payload.error;
        this.isExecuting = false;
        break;
    }
  }

  async cancel() {
    if (this.activeRequestId && this.isExecuting) {
      await cancelRequest(this.activeRequestId);
      this.isExecuting = false;
    }
  }
}

export const responseState = new ResponseState();
