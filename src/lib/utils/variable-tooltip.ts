import type { VariableItem } from '../types';

export interface VariableMatch {
  raw: string;
  name: string;
  start: number;
  end: number;
}

export interface VariableInfo {
  variableName: string;
  variableValue: string | null;
  isDefined: boolean;
  isSecret: boolean;
  isDynamic: boolean;
  source: string;
}

/**
 * Finds all mustache-style variable references: {{variable_name}}
 */
export function findVariablesInText(text: string): VariableMatch[] {
  if (!text || !text.includes('{{')) return [];
  const matches: VariableMatch[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      raw: m[0],
      name: m[1].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return matches;
}

/**
 * Checks if a specific character index falls strictly within any variable token in the text.
 * Returns the matching variable, or null if the cursor is outside all variables.
 */
export function getVariableAtCursor(text: string, charIdx: number): VariableMatch | null {
  if (charIdx < 0 || !text) return null;
  const matches = findVariablesInText(text);
  for (const m of matches) {
    if (charIdx >= m.start && charIdx < m.end) {
      return m;
    }
  }
  return null;
}

let cachedCanvas: HTMLCanvasElement | null = null;
let cachedCtx: CanvasRenderingContext2D | null = null;

/**
 * Accurately measures the width of a single character in a monospace font.
 */
export function getMonospaceCharWidth(target: HTMLElement): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 7.2;
  }

  const style = window.getComputedStyle(target);
  const fontSize = parseFloat(style.fontSize) || 12;

  try {
    if (!cachedCanvas) {
      cachedCanvas = document.createElement('canvas');
      cachedCtx = cachedCanvas.getContext('2d');
    }

    if (cachedCtx) {
      const font = style.font || `${style.fontStyle || ''} ${style.fontWeight || ''} ${style.fontSize} ${style.fontFamily}`;
      cachedCtx.font = font;
      // Measure multiple characters to avoid subpixel rounding errors
      const measuredWidth = cachedCtx.measureText('MMMMMMMMMM').width / 10;
      if (measuredWidth > 0) {
        return measuredWidth;
      }
    }
  } catch {
    // fallback if canvas measurement fails
  }

  return fontSize * 0.605;
}

/**
 * Calculates which variable (if any) is located under the mouse cursor
 * for an <input>, <textarea>, or generic monospace element.
 *
 * Returns null if the mouse is not directly hovering over a variable declaration.
 */
export function getVariableAtPosition(params: {
  text: string;
  clientX: number;
  clientY: number;
  target: HTMLElement;
}): VariableMatch | null {
  const { text, clientX, clientY, target } = params;
  if (!text || !text.includes('{{')) {
    return null;
  }

  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const charWidth = getMonospaceCharWidth(target);

  if (charWidth <= 0) return null;

  const isMultiLine =
    target instanceof HTMLTextAreaElement ||
    target.tagName.toLowerCase() === 'pre' ||
    style.whiteSpace === 'pre' ||
    style.whiteSpace === 'pre-wrap';

  if (isMultiLine) {
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const scrollTop = target.scrollTop || 0;
    const scrollLeft = target.scrollLeft || 0;

    let lineHeight = parseFloat(style.lineHeight);
    if (isNaN(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(style.fontSize) || 12;
      lineHeight = fontSize * 1.5;
    }

    const relativeY = clientY - rect.top - paddingTop - borderTop + scrollTop;
    if (relativeY < 0) return null;

    const lineIdx = Math.floor(relativeY / lineHeight);
    const lines = text.split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return null;

    const lineText = lines[lineIdx];
    const relativeX = clientX - rect.left - paddingLeft - borderLeft + scrollLeft;
    if (relativeX < 0) return null;

    const charIdx = Math.floor(relativeX / charWidth);
    if (charIdx < 0 || charIdx >= lineText.length) return null;

    return getVariableAtCursor(lineText, charIdx);
  } else {
    // Single-line input
    const scrollLeft = (target as HTMLInputElement).scrollLeft || 0;
    const relativeX = clientX - rect.left - paddingLeft - borderLeft + scrollLeft;
    if (relativeX < 0) return null;

    const charIdx = Math.floor(relativeX / charWidth);
    if (charIdx < 0 || charIdx >= text.length) return null;

    return getVariableAtCursor(text, charIdx);
  }
}

/**
 * Resolves details and value for a given variable token.
 */
export function getVariableInfo(
  token: string,
  variables: VariableItem[],
  mergedVariables?: Record<string, string>
): VariableInfo {
  const key = token.trim();

  if (key === '$uuid') {
    return {
      variableName: '$uuid',
      variableValue: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'dynamic-uuid',
      isDefined: true,
      isSecret: false,
      isDynamic: true,
      source: 'Dynamic Generator',
    };
  }
  if (key === '$isoTimestamp') {
    return {
      variableName: '$isoTimestamp',
      variableValue: new Date().toISOString(),
      isDefined: true,
      isSecret: false,
      isDynamic: true,
      source: 'Dynamic Generator',
    };
  }
  if (key === '$timestamp') {
    return {
      variableName: '$timestamp',
      variableValue: Math.floor(Date.now() / 1000).toString(),
      isDefined: true,
      isSecret: false,
      isDynamic: true,
      source: 'Dynamic Generator',
    };
  }

  const found = variables.find((v) => v.key.trim() === key);
  if (found) {
    return {
      variableName: key,
      variableValue: found.value,
      isDefined: true,
      isSecret: !!found.isSecret,
      isDynamic: false,
      source: found.isSecret ? 'Secret Variable' : 'Workspace Variable',
    };
  }

  if (mergedVariables && key in mergedVariables) {
    return {
      variableName: key,
      variableValue: mergedVariables[key],
      isDefined: true,
      isSecret: false,
      isDynamic: false,
      source: 'Workspace Variable',
    };
  }

  return {
    variableName: key,
    variableValue: null,
    isDefined: false,
    isSecret: false,
    isDynamic: false,
    source: 'Unresolved Variable',
  };
}
