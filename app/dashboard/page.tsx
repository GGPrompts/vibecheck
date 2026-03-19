import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of all registered repositories
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Repositories</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No repositories registered yet. Add a repository in Settings to get
            started.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
