import {
  getCollectionVariables,
  getWorkspaceEnvironments,
  getWorkspaceSecrets,
  saveWorkspaceEnvironment,
  saveWorkspaceSecrets,
} from '../ipc';
import type { EnvironmentItem, VariableItem } from '../types';

function createVariable(key: string, value: string, isSecret: boolean, scope: 'environment' | 'workspace'): VariableItem {
  return { id: String(Date.now() + Math.random()), key, value, isSecret, scope };
}

export class EnvironmentState {
  variables = $state<VariableItem[]>([]);
  environments = $state<EnvironmentItem[]>([]);
  activeEnvName = $state('default');
  isVariablesModalOpen = $state(false);

  get isSecretsModalOpen(): boolean {
    return this.isVariablesModalOpen;
  }
  set isSecretsModalOpen(value: boolean) {
    this.isVariablesModalOpen = value;
  }

  mergedVariables = $derived.by(() => {
    const values: Record<string, string> = {};
    // Workspace secrets provide defaults; the selected environment overrides them.
    for (const variable of this.variables) {
      if (variable.scope === 'workspace' && variable.key.trim()) {
        values[variable.key.trim()] = variable.value;
      }
    }
    for (const variable of this.variables) {
      if (variable.scope === 'environment' && variable.key.trim()) {
        values[variable.key.trim()] = variable.value;
      }
    }
    return values;
  });

  constructor() {
    void this.refresh();
  }

  async refresh(preferredEnvironment?: string) {
    try {
      this.environments = await getWorkspaceEnvironments('.');
      const storedEnvironment = typeof localStorage !== 'undefined'
        ? localStorage.getItem('active_environment')
        : null;
      const requested = preferredEnvironment || storedEnvironment || this.activeEnvName;
      const selected = this.environments.find((environment) => environment.name === requested)
        || this.environments.find((environment) => environment.name === 'default')
        || this.environments[0];
      if (!selected) {
        this.activeEnvName = 'default';
        this.variables = [];
        return;
      }

      this.activeEnvName = selected.name;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('active_environment', selected.name);
      }
      const workspaceSecrets = await getWorkspaceSecrets('.');
      this.variables = [
        ...selected.variables.map(([key, value]) => createVariable(key, value, false, 'environment')),
        ...(selected.secret_variables || []).map(([key, value]) => createVariable(key, value, true, 'environment')),
        ...Object.entries(workspaceSecrets).map(([key, value]) => createVariable(key, value, true, 'workspace')),
      ];
    } catch (error) {
      console.error('Failed to load environments:', error);
    }
  }

  async selectEnvironment(name: string) {
    if (!this.environments.some((environment) => environment.name === name)) return;
    this.activeEnvName = name;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('active_environment', name);
    }
    await this.refresh(name);
  }

  async importEnvironment(name: string, publicVariables: [string, string][], secretVariables: [string, string][]) {
    const publicVars = Object.fromEntries(publicVariables);
    const secretVars = Object.fromEntries(secretVariables);
    await saveWorkspaceEnvironment('.', name, publicVars, secretVars);
    await this.refresh(name);
  }

  async updateVariables(newVariables: VariableItem[]) {
    this.variables = newVariables;
    const publicVars: Record<string, string> = {};
    const environmentSecrets: Record<string, string> = {};
    const workspaceSecrets: Record<string, string> = {};

    for (const item of newVariables) {
      const key = item.key.trim();
      if (!key) continue;
      if (item.scope === 'workspace') {
        workspaceSecrets[key] = item.value;
      } else if (item.isSecret) {
        environmentSecrets[key] = item.value;
      } else {
        publicVars[key] = item.value;
      }
    }

    try {
      await Promise.all([
        saveWorkspaceEnvironment('.', this.activeEnvName, publicVars, environmentSecrets),
        saveWorkspaceSecrets('.', workspaceSecrets),
      ]);
      await this.refresh(this.activeEnvName);
    } catch (error) {
      console.error('Failed to save environment variables:', error);
    }
  }

  async setVariable(key: string, value: string, isSecret?: boolean) {
    const trimmed = key.trim();
    if (!trimmed) return;
    const existing = this.variables.find((variable) => variable.key === trimmed && variable.scope === 'environment');
    if (existing) {
      existing.value = value;
      if (isSecret !== undefined) existing.isSecret = isSecret;
    } else {
      this.variables.push(createVariable(trimmed, value, isSecret ?? false, 'environment'));
    }
    await this.updateVariables([...this.variables]);
  }

  async variablesForRequest(requestPath: string | null | undefined): Promise<Record<string, string>> {
    if (!requestPath) return this.mergedVariables;
    try {
      const collectionVariables = await getCollectionVariables(requestPath);
      return { ...this.mergedVariables, ...collectionVariables };
    } catch (error) {
      console.error('Failed to load collection variables:', error);
      return this.mergedVariables;
    }
  }
}

export const envState = new EnvironmentState();
