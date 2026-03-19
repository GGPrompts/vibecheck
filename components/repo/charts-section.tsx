'use client';

import { Card, CardContent } from '@/components/ui/card';
import { RadarChart } from '@/components/radar-chart';
import { HotspotQuadrant } from '@/components/hotspot-quadrant';
import type { ScanModule, HotspotDataPoint } from './types';

interface ChartsSectionProps {
  modules: ScanModule[];
  hotspotData: HotspotDataPoint[];
}

export function ChartsSection({ modules, hotspotData }: ChartsSectionProps) {
  if (modules.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Module Scores</h2>
          <Card>
            <CardContent className="pt-4">
              <RadarChart
                data={modules.map((mod) => ({
                  moduleId: mod.moduleId,
                  moduleName: mod.moduleId
                    .split('-')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' '),
                  score: mod.score,
                  confidence: mod.confidence,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* Hotspot Quadrant */}
        {hotspotData.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Hotspot Quadrant</h2>
            <HotspotQuadrant data={hotspotData} />
          </div>
        )}
      </div>
    </section>
  );
}
