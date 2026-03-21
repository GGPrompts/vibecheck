import { NextResponse } from 'next/server';
import '@/lib/modules/register-all';
import { getAllModules } from '@/lib/modules/registry';

type ModuleGroup = 'static' | 'ai' | 'runtime' | 'go-native' | 'rust-native';

interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  /** UI grouping derived from module id and category */
  group: ModuleGroup;
}

function deriveGroup(id: string, category: string): ModuleGroup {
  if (category === 'ai') return 'ai';
  if (id.startsWith('go-')) return 'go-native';
  if (id.startsWith('rust-')) return 'rust-native';
  if (id === 'api-health') return 'runtime';
  return 'static';
}

/**
 * GET /api/modules — Return all registered module definitions.
 * Used by the settings UI to dynamically populate module toggles.
 */
export async function GET() {
  try {
    const registered = getAllModules();
    const modules: ModuleInfo[] = registered.map((m) => ({
      id: m.definition.id,
      name: m.definition.name,
      description: m.definition.description,
      category: m.definition.category,
      defaultEnabled: m.definition.defaultEnabled,
      group: deriveGroup(m.definition.id, m.definition.category),
    }));

    return NextResponse.json({ modules });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
