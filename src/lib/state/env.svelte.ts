import {
  getWorkspaceEnvironments,
  getWorkspaceSecrets,
  saveWorkspaceSecrets,
} from '../ipc';
import type { EnvironmentItem } from '../types';

export class EnvironmentState {
  environments = $state<EnvironmentItem[]>([]);
  activeEnvName = $state<string>('development');
  secrets = $state<Record<string, string>>({});
  isSecretsModalOpen = $state(false);

  // Computes the merged variable map (active environment vars + secrets overlay)
  mergedVariables = $derived.by(() => {
    const map: Record<string, string> = {};

    // 1. Environment variables
    const active = this.environments.find((e) => e.name === this.activeEnvName);
    if (active) {
      for (const [k, v] of active.variables) {
        map[k] = v;
      }
    }

    // 2. Secret variables take highest precedence
    for (const [k, v] of Object.entries(this.secrets)) {
      map[k] = v;
    }

    return map;
  });

  constructor() {
    this.refresh();
  }

  async refresh() {
    try {
      this.environments = await getWorkspaceEnvironments('.');
      this.secrets = await getWorkspaceSecrets('.');
      if (this.environments.length > 0 && !this.activeEnvName) {
        this.activeEnvName = this.environments[0].name;
      }
    } catch (e) {
      console.error('Failed to load environments:', e);
    }
  }

  async updateSecrets(newSecrets: Record<string, string>) {
    this.secrets = newSecrets;
    await saveWorkspaceSecrets('.', newSecrets);
  }
}

export const envState = new EnvironmentState();
