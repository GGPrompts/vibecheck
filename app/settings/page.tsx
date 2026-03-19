import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure Vibecheck preferences and API keys
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Settings panel coming soon. You will be able to configure your
            Anthropic API key, enable/disable modules, set AI token budgets, and
            manage repositories.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
