import type { VariableItem } from '$lib/types';

export function appendVariableDraft(
  variables: VariableItem[],
  draft: Omit<VariableItem, 'id'>,
  id: string,
): VariableItem[] {
  const key = draft.key.trim();
  if (!key) return variables;
  return [
    ...variables,
    {
      ...draft,
      id,
      key,
    },
  ];
}
