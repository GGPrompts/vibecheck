import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TrendsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
        <p className="text-muted-foreground">
          Historical health data for repository: {id}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Historical Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Trends page coming soon. This page will show module score trends over
            time, finding status distribution, and DORA-adjacent metrics.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
