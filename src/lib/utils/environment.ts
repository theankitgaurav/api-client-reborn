import type { EnvironmentItem } from '$lib/types';

export function normalizeEnvironmentName(name: string): string {
  return name.trim();
}

export function isDefaultEnvironmentName(name: string): boolean {
  return normalizeEnvironmentName(name).toLowerCase() === 'default';
}

export function slugifyEnvironmentName(name: string): string {
  let slug = '';
  let separator = false;
  for (const character of normalizeEnvironmentName(name).toLowerCase()) {
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      slug += character.toLowerCase();
      separator = false;
    } else if (!separator) {
      slug += '_';
      separator = true;
    }
  }
  return slug.replace(/^_+|_+$/g, '') || 'environment';
}

export function hasDuplicateEnvironmentName(
  environments: EnvironmentItem[],
  name: string,
): boolean {
  const normalized = normalizeEnvironmentName(name).toLowerCase();
  if (!normalized) return false;
  const slug = slugifyEnvironmentName(normalized);
  return environments.some((environment) => {
    const existingName = normalizeEnvironmentName(environment.name).toLowerCase();
    return existingName === normalized
      || slugifyEnvironmentName(existingName) === slug;
  });
}
