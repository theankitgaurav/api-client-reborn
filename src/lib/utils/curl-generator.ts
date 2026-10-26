/**
 * Resolves variables and extracts the clean executable terminal command
 * (cURL) from the raw file content.
 */
export function getResolvedCommand(
  rawContent: string,
  variables: Record<string, string>
): string {
  if (!rawContent) return '';

  // 1. Separate leading comment directives (# @name, # @timeout, etc.)
  const lines = rawContent.split('\n');
  const commandLines: string[] = [];
  let readingDirectives = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (readingDirectives && (trimmed.startsWith('# @') || trimmed === '' || (trimmed.startsWith('#') && !trimmed.startsWith('#!')))) {
      continue;
    }
    readingDirectives = false;
    commandLines.push(line);
  }

  const rawCommand = commandLines.join('\n').trim();

  // 2. Resolve mustache tokens: {{variable}}
  return rawCommand.replace(/\{\{([^}]+)\}\}/g, (match, token) => {
    const key = token.trim();

    if (key === '$uuid') {
      return crypto.randomUUID();
    }
    if (key === '$isoTimestamp') {
      return new Date().toISOString();
    }
    if (key === '$timestamp') {
      return Math.floor(Date.now() / 1000).toString();
    }

    if (variables && key in variables) {
      return variables[key];
    }

    return match;
  });
}
