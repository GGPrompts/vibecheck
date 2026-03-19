import type { ModuleDefinition, ModuleRunner, RegisteredModule } from './types';

const modules = new Map<string, RegisteredModule>();

export function registerModule(
  definition: ModuleDefinition,
  runner: ModuleRunner
): void {
  modules.set(definition.id, { definition, runner });
}

export function getModule(id: string): RegisteredModule | undefined {
  return modules.get(id);
}

export function getAllModules(): RegisteredModule[] {
  return Array.from(modules.values());
}

/**
 * Returns enabled modules. If enabledIds is provided, returns only modules
 * whose id is in that list. Otherwise returns modules where defaultEnabled is true.
 */
export function getEnabledModules(enabledIds?: string[]): RegisteredModule[] {
  const all = getAllModules();
  if (enabledIds) {
    const idSet = new Set(enabledIds);
    return all.filter((m) => idSet.has(m.definition.id));
  }
  return all.filter((m) => m.definition.defaultEnabled);
}
