export const MAX_BODY_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB preview limit
export const MAX_STREAM_MESSAGES = 1000; // Sliding window cap

export interface StreamItem {
  id?: string;
  event?: string;
  data: string;
  timestamp: string;
  bytes?: number;
}

export class StreamBuffer {
  bodyText = '';
  isBodyTruncated = false;
  totalBytes = 0;
  totalEventsCount = 0;
  streamMessages: StreamItem[] = [];
  spoolFilePath: string | null = null;

  appendBodyChunk(text: string, bytesReceived: number) {
    this.totalBytes = bytesReceived;

    if (text) {
      if (this.bodyText.length < MAX_BODY_TEXT_BYTES) {
        const remaining = MAX_BODY_TEXT_BYTES - this.bodyText.length;
        if (text.length <= remaining) {
          this.bodyText += text;
        } else {
          this.bodyText += text.substring(0, remaining);
          this.isBodyTruncated = true;
        }
      } else {
        this.isBodyTruncated = true;
      }

      const raw = text.trim();
      if (raw) {
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this.totalEventsCount++;
          if (this.streamMessages.length >= MAX_STREAM_MESSAGES) {
            this.streamMessages.shift();
          }
          this.streamMessages.push({
            event: 'chunk',
            data: line,
            timestamp: new Date().toLocaleTimeString(),
            bytes: line.length,
          });
        }
      }
    }
  }

  appendSseChunk(id?: string, event?: string, data?: string) {
    const eventData = data || '';
    this.totalEventsCount++;
    if (this.streamMessages.length >= MAX_STREAM_MESSAGES) {
      this.streamMessages.shift();
    }
    this.streamMessages.push({
      id,
      event: event || 'message',
      data: eventData,
      timestamp: new Date().toLocaleTimeString(),
      bytes: eventData.length,
    });
  }

  finish(totalBytes: number, spoolFilePath?: string) {
    this.totalBytes = totalBytes;
    if (spoolFilePath) {
      this.spoolFilePath = spoolFilePath;
    }
  }

  clear() {
    this.bodyText = '';
    this.isBodyTruncated = false;
    this.totalBytes = 0;
    this.totalEventsCount = 0;
    this.streamMessages = [];
    this.spoolFilePath = null;
  }
}
