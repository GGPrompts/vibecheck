import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RepoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Repository Health
        </h1>
        <p className="text-muted-foreground">Repository ID: {id}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Health Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Repository health dashboard coming soon. This page will show the
            overall health score, radar chart, hotspot quadrant, module scores,
            and recent findings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
