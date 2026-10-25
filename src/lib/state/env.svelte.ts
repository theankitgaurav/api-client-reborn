import { getWorkspaceVariables, saveWorkspaceVariables } from '../ipc';
import type { VariableItem } from '../types';

export class EnvironmentState {
  variables = $state<VariableItem[]>([]);
  isVariablesModalOpen = $state(false);

  // Backward compatibility alias
  get isSecretsModalOpen(): boolean {
    return this.isVariablesModalOpen;
  }
  set isSecretsModalOpen(val: boolean) {
    this.isVariablesModalOpen = val;
  }

  // Backward compatibility environments
  environments = $state<{ name: string; file_path: string; variables: [string, string][] }[]>([
    { name: 'default', file_path: 'environments/default.env.json', variables: [] },
  ]);
  activeEnvName = $state('default');

  // Merged variable map for fast {{var}} interpolation
  mergedVariables = $derived.by(() => {
    const map: Record<string, string> = {};
    for (const v of this.variables) {
      if (v.key.trim()) {
        map[v.key.trim()] = v.value;
      }
    }
    return map;
  });

  constructor() {
    this.refresh();
  }

  async refresh() {
    try {
      const data = await getWorkspaceVariables('.');
      const items: VariableItem[] = [];

      // Non-secret variables from default.env.json
      for (const [k, v] of Object.entries(data.public_vars)) {
        items.push({
          id: String(Date.now() + Math.random()),
          key: k,
          value: v,
          isSecret: false,
        });
      }

      // Secret variables from .secrets.env
      for (const [k, v] of Object.entries(data.secret_vars)) {
        // If a key was also in public_vars, secret takes precedence
        const existingIdx = items.findIndex((i) => i.key === k);
        if (existingIdx >= 0) {
          items[existingIdx].value = v;
          items[existingIdx].isSecret = true;
        } else {
          items.push({
            id: String(Date.now() + Math.random()),
            key: k,
            value: v,
            isSecret: true,
          });
        }
      }

      this.variables = items;
    } catch (e) {
      console.error('Failed to load variables:', e);
    }
  }

  async updateVariables(newVariables: VariableItem[]) {
    this.variables = newVariables;

    const publicVars: Record<string, string> = {};
    const secretVars: Record<string, string> = {};

    for (const item of newVariables) {
      const k = item.key.trim();
      if (!k) continue;
      if (item.isSecret) {
        secretVars[k] = item.value;
      } else {
        publicVars[k] = item.value;
      }
    }

    try {
      await saveWorkspaceVariables('.', publicVars, secretVars);
    } catch (e) {
      console.error('Failed to save variables:', e);
    }
  }

  async setVariable(key: string, value: string, isSecret?: boolean) {
    const trimmed = key.trim();
    if (!trimmed) return;

    const existing = this.variables.find((v) => v.key === trimmed);
    if (existing) {
      existing.value = value;
      if (isSecret !== undefined) {
        existing.isSecret = isSecret;
      }
    } else {
      this.variables.push({
        id: String(Date.now() + Math.random()),
        key: trimmed,
        value,
        isSecret: isSecret ?? false,
      });
    }

    await this.updateVariables([...this.variables]);
  }
}

export const envState = new EnvironmentState();
