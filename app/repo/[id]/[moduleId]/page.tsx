import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ id: string; moduleId: string }>;
}) {
  const { id, moduleId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Module Drilldown</h1>
        <p className="text-muted-foreground">
          Repository: {id} &middot; Module: {moduleId}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{moduleId}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Module drilldown coming soon. This page will show score trends, full
            findings table, and module-specific visualizations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
