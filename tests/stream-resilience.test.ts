import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StreamBuffer,
  MAX_BODY_TEXT_BYTES,
  MAX_STREAM_MESSAGES,
} from '../src/lib/utils/stream-buffer.ts';

test('StreamBuffer enforces sliding window cap on high-volume streams', () => {
  const buffer = new StreamBuffer();

  // Simulate receiving 3,500 streaming events
  for (let i = 1; i <= 3500; i++) {
    buffer.appendSseChunk(
      String(i),
      'telemetry',
      JSON.stringify({ index: i, value: Math.random() })
    );
  }

  // Memory defense: in-memory messages strictly capped at MAX_STREAM_MESSAGES
  assert.equal(buffer.streamMessages.length, MAX_STREAM_MESSAGES);
  assert.equal(buffer.totalEventsCount, 3500);

  // The latest event should be at the end of the sliding window
  assert.equal(buffer.streamMessages[buffer.streamMessages.length - 1].id, '3500');
  // Oldest retained event should be 2501
  assert.equal(buffer.streamMessages[0].id, '2501');
});

test('StreamBuffer caps bodyText preview at 2 MB for large payloads', () => {
  const buffer = new StreamBuffer();

  // 1 MB chunk of text
  const chunkSize = 1024 * 1024;
  const chunkText = 'X'.repeat(chunkSize);

  // Send 5 MB total (5 chunks)
  for (let i = 1; i <= 5; i++) {
    buffer.appendBodyChunk(chunkText, i * chunkSize);
  }

  // Body text preview must be capped at MAX_BODY_TEXT_BYTES (2 MB)
  assert.equal(buffer.bodyText.length, MAX_BODY_TEXT_BYTES);
  assert.equal(buffer.isBodyTruncated, true);

  // Total bytes received must accurately reflect the full 5 MB
  assert.equal(buffer.totalBytes, 5 * chunkSize);
});

test('StreamBuffer captures spool_file_path upon stream finish', () => {
  const buffer = new StreamBuffer();

  buffer.finish(104857600, '/tmp/apiclient_cache/stream_abc123.bin');

  assert.equal(buffer.spoolFilePath, '/tmp/apiclient_cache/stream_abc123.bin');
  assert.equal(buffer.totalBytes, 104857600);
});
