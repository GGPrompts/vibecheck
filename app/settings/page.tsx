"use client";

import { useEffect, useState, useCallback } from "react";
import { Eye, EyeOff, Plus, Trash2, Check, X, Loader2, FolderSearch, RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ModelOverrides {
  global?: string;
  modules?: Record<string, string>;
}

interface Settings {
  hasApiKey: boolean;
  enabledModules: string[] | null;
  aiTokenBudget: number;
  aiProvider: "api" | "cli" | "auto";
  modelOverrides?: ModelOverrides | null;
}

interface Repo {
  id: string;
  name: string;
  path: string;
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

const MODULE_LIST = [
  {
    id: "security",
    name: "Security",
    description: "Scans for common security vulnerabilities and exposed secrets.",
  },
  {
    id: "dependencies",
    name: "Dependencies",
    description: "Checks for outdated, deprecated, or vulnerable packages.",
  },
  {
    id: "complexity",
    name: "Complexity",
    description: "Analyzes code complexity metrics and identifies overly complex functions.",
  },
  {
    id: "git-health",
    name: "Git Health",
    description: "Evaluates commit patterns, branch hygiene, and collaboration metrics.",
  },
];

const AI_MODULE_LIST = [
  { id: "naming-quality", name: "Naming Quality" },
  { id: "doc-staleness", name: "Doc Staleness" },
  { id: "arch-smells", name: "Architecture Smells" },
  { id: "test-quality", name: "Test Quality" },
];

const TIER_OPTIONS = [
  { value: "haiku", label: "Haiku", price: "$0.25 / $1.25" },
  { value: "sonnet", label: "Sonnet", price: "$3.00 / $15.00" },
  { value: "opus", label: "Opus", price: "$15.00 / $75.00" },
] as const;

function formatTokenBudget(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K tokens`;
  }
  return `${value} tokens`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    hasApiKey: false,
    enabledModules: null,
    aiTokenBudget: 100000,
    aiProvider: "auto",
  });
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // API key form
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  // Module toggles (local state for form)
  const [enabledModules, setEnabledModules] = useState<string[]>(
    MODULE_LIST.map((m) => m.id)
  );

  // Token budget
  const [tokenBudget, setTokenBudget] = useState(100000);

  // AI provider
  const [aiProvider, setAiProvider] = useState<"api" | "cli" | "auto">("auto");
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  const [checkingCli, setCheckingCli] = useState(false);

  // Model tier overrides
  const [globalTier, setGlobalTier] = useState<string>("sonnet");
  const [moduleTiers, setModuleTiers] = useState<Record<string, string>>({});

  // Scan directories
  const [scanDirs, setScanDirs] = useState<string[]>([]);
  const [scanDirsDefault, setScanDirsDefault] = useState(true);
  const [newScanDir, setNewScanDir] = useState("");
  const [savingScanDirs, setSavingScanDirs] = useState(false);
  const [scanDirsSaved, setScanDirsSaved] = useState(false);

  // Audit prompts
  const [auditPrompts, setAuditPrompts] = useState<
    Record<string, { moduleId: string; name: string; prompt: string; isCustom: boolean }>
  >({});
  const [auditPromptsLoading, setAuditPromptsLoading] = useState(true);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  // Add repo dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const fetchScanDirs = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/scan-dirs");
      const data = await res.json();
      if (Array.isArray(data.scanDirs)) {
        setScanDirs(data.scanDirs);
        setScanDirsDefault(data.isDefault ?? true);
      }
    } catch {
      // Silently handle
    }
  }, []);

  const fetchAuditPrompts = useCallback(async () => {
    setAuditPromptsLoading(true);
    try {
      const res = await fetch("/api/settings/audit-prompts");
      const data = await res.json();
      if (data.prompts) {
        setAuditPrompts(data.prompts);
      }
    } catch {
      // Silently handle
    } finally {
      setAuditPromptsLoading(false);
    }
  }, []);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/repos");
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepos(data);
      }
    } catch {
      // Silently handle
    }
  }, []);

  const checkCliAvailability = useCallback(async () => {
    setCheckingCli(true);
    try {
      const res = await fetch("/api/ai-provider/check");
      const data = await res.json();
      setCliAvailable(data.cliAvailable ?? false);
    } catch {
      setCliAvailable(false);
    } finally {
      setCheckingCli(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data: Settings = await res.json();
      setSettings(data);
      if (data.enabledModules) {
        setEnabledModules(data.enabledModules);
      }
      setTokenBudget(data.aiTokenBudget);
      setAiProvider(data.aiProvider ?? "auto");
      if (data.modelOverrides) {
        setGlobalTier(data.modelOverrides.global ?? "sonnet");
        setModuleTiers(data.modelOverrides.modules ?? {});
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchRepos();
    fetchScanDirs();
    fetchAuditPrompts();
    checkCliAvailability();
  }, [fetchSettings, fetchRepos, fetchScanDirs, fetchAuditPrompts, checkCliAvailability]);

  async function handleSaveApiKey() {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    setKeySaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        setKeySaved(true);
        setApiKey("");
        setSettings((prev) => ({ ...prev, hasApiKey: true }));
        setTimeout(() => setKeySaved(false), 3000);
      }
    } catch {
      // Silently handle
    } finally {
      setSavingKey(false);
    }
  }

  function toggleModule(moduleId: string) {
    setEnabledModules((prev) =>
      prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId]
    );
  }

  async function handleSaveSettings() {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledModules,
          aiTokenBudget: tokenBudget,
          aiProvider,
          modelOverrides: {
            global: globalTier,
            modules: moduleTiers,
          },
        }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch {
      // Silently handle
    } finally {
      setSaving(false);
    }
  }

  function handleAddScanDir() {
    const dir = newScanDir.trim();
    if (!dir) return;
    if (scanDirs.includes(dir)) {
      setNewScanDir("");
      return;
    }
    setScanDirs((prev) => [...prev, dir]);
    setScanDirsDefault(false);
    setNewScanDir("");
  }

  function handleRemoveScanDir(dir: string) {
    setScanDirs((prev) => prev.filter((d) => d !== dir));
    setScanDirsDefault(false);
  }

  async function handleResetScanDirs() {
    setSavingScanDirs(true);
    try {
      // Save empty scanDirs to reset to defaults
      const res = await fetch("/api/settings/scan-dirs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanDirs: [] }),
      });
      if (res.ok) {
        await fetchScanDirs();
      }
    } catch {
      // Silently handle
    } finally {
      setSavingScanDirs(false);
    }
  }

  async function handleSaveScanDirs() {
    setSavingScanDirs(true);
    setScanDirsSaved(false);
    try {
      const res = await fetch("/api/settings/scan-dirs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanDirs }),
      });
      if (res.ok) {
        setScanDirsSaved(true);
        setScanDirsDefault(false);
        setTimeout(() => setScanDirsSaved(false), 3000);
      }
    } catch {
      // Silently handle
    } finally {
      setSavingScanDirs(false);
    }
  }

  function handlePromptChange(moduleId: string, value: string) {
    setAuditPrompts((prev) => ({
      ...prev,
      [moduleId]: {
        ...prev[moduleId],
        prompt: value,
        isCustom: true,
      },
    }));
  }

  async function handleResetPrompt(moduleId: string) {
    // Fetch fresh defaults from the API by saving with an empty prompt for
    // this module, then re-fetching
    const currentPrompts = { ...auditPrompts };
    // Set an empty string to signal "use default"
    const promptsToSave: Record<string, string> = {};
    for (const [id, entry] of Object.entries(currentPrompts)) {
      if (id === moduleId) continue; // Skip the one being reset
      promptsToSave[id] = entry.prompt;
    }

    try {
      await fetch("/api/settings/audit-prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: promptsToSave }),
      });
      await fetchAuditPrompts();
    } catch {
      // Silently handle
    }
  }

  async function handleSavePrompts() {
    setSavingPrompts(true);
    setPromptsSaved(false);
    try {
      const promptsToSave: Record<string, string> = {};
      for (const [moduleId, entry] of Object.entries(auditPrompts)) {
        promptsToSave[moduleId] = entry.prompt;
      }

      const res = await fetch("/api/settings/audit-prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompts: promptsToSave }),
      });
      if (res.ok) {
        setPromptsSaved(true);
        await fetchAuditPrompts();
        setTimeout(() => setPromptsSaved(false), 3000);
      }
    } catch {
      // Silently handle
    } finally {
      setSavingPrompts(false);
    }
  }

  async function handleAddRepo() {
    if (!newRepoPath.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newRepoPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Failed to add repository");
        setAdding(false);
        return;
      }
      setNewRepoPath("");
      setDialogOpen(false);
      fetchRepos();
    } catch {
      setAddError("Failed to add repository");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteRepo(id: string) {
    try {
      await fetch("/api/repos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchRepos();
    } catch {
      // Silently handle
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Configure Vibecheck preferences and API keys
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure Vibecheck preferences and API keys
        </p>
      </div>

      {/* Anthropic API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Anthropic API Key
            {settings.hasApiKey && (
              <Badge variant="secondary">Connected</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Required for AI-powered analysis modules. Your key is stored locally.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showApiKey ? "text" : "password"}
                placeholder={settings.hasApiKey ? "Key saved - enter new key to replace" : "sk-ant-..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveApiKey();
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <Button
              onClick={handleSaveApiKey}
              disabled={savingKey || !apiKey.trim()}
            >
              {savingKey ? "Saving..." : keySaved ? "Saved!" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* AI Backend */}
      <Card>
        <CardHeader>
          <CardTitle>AI Backend</CardTitle>
          <CardDescription>
            Choose how Vibecheck connects to Claude for AI analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Claude Code (CLI) option */}
          <button
            type="button"
            onClick={() => setAiProvider("cli")}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              aiProvider === "cli"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude Code (Max plan)</span>
                  {aiProvider === "cli" && (
                    <Badge variant="secondary">Selected</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Uses <code className="text-xs">claude -p</code> subprocess. No API key needed, no cost tracking.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {checkingCli ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : cliAvailable ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-600">Available</span>
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-red-600">Not found</span>
                  </>
                )}
              </div>
            </div>
          </button>

          {/* API Key option */}
          <button
            type="button"
            onClick={() => setAiProvider("api")}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              aiProvider === "api"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">API Key</span>
                  {aiProvider === "api" && (
                    <Badge variant="secondary">Selected</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Uses @anthropic-ai/sdk. Shows token usage and cost tracking.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                {settings.hasApiKey ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-600">Available</span>
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-red-600">No key</span>
                  </>
                )}
              </div>
            </div>
          </button>

          {/* Auto option */}
          <button
            type="button"
            onClick={() => setAiProvider("auto")}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              aiProvider === "auto"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Auto-detect</span>
                {aiProvider === "auto" && (
                  <Badge variant="secondary">Selected</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Try Claude Code first (free), fall back to API key if unavailable.
              </p>
            </div>
          </button>
        </CardContent>
      </Card>

      <Separator />

      {/* Model Tiers */}
      <Card>
        <CardHeader>
          <CardTitle>Model Tiers</CardTitle>
          <CardDescription>
            Choose which Claude model tier to use for AI analysis. Prices shown are per million tokens (input / output).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Global tier dropdown */}
          <div className="space-y-2">
            <Label htmlFor="global-tier">Global Model Tier</Label>
            <select
              id="global-tier"
              value={globalTier}
              onChange={(e) => setGlobalTier(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {TIER_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} ({t.price})
                </option>
              ))}
            </select>
          </div>

          <Separator />

          {/* Per-module overrides */}
          <div className="space-y-2">
            <Label>Per-Module Overrides</Label>
            <p className="text-xs text-muted-foreground">
              Override the global tier for individual AI modules. &quot;Use global&quot; inherits the global setting.
            </p>
            <div className="space-y-3 mt-2">
              {AI_MODULE_LIST.map((mod) => (
                <div
                  key={mod.id}
                  className="flex items-center justify-between gap-4"
                >
                  <Label className="text-sm font-normal min-w-[140px]">
                    {mod.name}
                  </Label>
                  <select
                    value={moduleTiers[mod.id] ?? ""}
                    onChange={(e) => {
                      setModuleTiers((prev) => {
                        const next = { ...prev };
                        if (e.target.value === "") {
                          delete next[mod.id];
                        } else {
                          next[mod.id] = e.target.value;
                        }
                        return next;
                      });
                    }}
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <option value="">Use global</option>
                    {TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} ({t.price})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Preset buttons */}
          <div className="space-y-2">
            <Label>Presets</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setGlobalTier("haiku");
                  setModuleTiers({});
                }}
              >
                Budget Mode
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setGlobalTier("sonnet");
                  setModuleTiers({});
                }}
              >
                Balanced
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setGlobalTier("opus");
                  setModuleTiers({});
                }}
              >
                Deep Scan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Module Toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Modules</CardTitle>
          <CardDescription>
            Enable or disable individual analysis modules for scans.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {MODULE_LIST.map((mod) => (
            <div
              key={mod.id}
              className="flex items-center justify-between gap-4"
            >
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{mod.name}</Label>
                <p className="text-xs text-muted-foreground">
                  {mod.description}
                </p>
              </div>
              <Switch
                checked={enabledModules.includes(mod.id)}
                onCheckedChange={() => toggleModule(mod.id)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Separator />

      {/* AI Token Budget */}
      <Card>
        <CardHeader>
          <CardTitle>AI Token Budget</CardTitle>
          <CardDescription>
            Maximum number of tokens to use per scan for AI analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Budget</Label>
            <span className="text-sm font-medium">
              {formatTokenBudget(tokenBudget)}
            </span>
          </div>
          <Slider
            value={[tokenBudget]}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? val[0] : val;
              setTokenBudget(v as number);
            }}
            min={10000}
            max={500000}
            step={10000}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>10K</span>
            <span>500K</span>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Audit Prompts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Audit Prompts
          </CardTitle>
          <CardDescription>
            Customize the system prompts sent to the AI for each audit module.
            Changes affect what the AI focuses on during audits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {auditPromptsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : Object.keys(auditPrompts).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No audit modules available.
            </p>
          ) : (
            <>
              {Object.values(auditPrompts).map((entry) => (
                <div
                  key={entry.moduleId}
                  className="space-y-2 rounded-lg border border-border p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        {entry.name}
                      </Label>
                      {entry.isCustom && (
                        <Badge variant="secondary">Custom</Badge>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResetPrompt(entry.moduleId)}
                      disabled={!entry.isCustom}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Reset to Default
                    </Button>
                  </div>
                  <textarea
                    value={entry.prompt}
                    onChange={(e) =>
                      handlePromptChange(entry.moduleId, e.target.value)
                    }
                    rows={4}
                    className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y dark:bg-input/30"
                  />
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSavePrompts}
                  disabled={savingPrompts}
                  size="sm"
                >
                  {savingPrompts
                    ? "Saving..."
                    : promptsSaved
                      ? "Saved!"
                      : "Save All"}
                </Button>
                {promptsSaved && (
                  <span className="text-sm text-muted-foreground">
                    Audit prompts have been saved.
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Scan Directories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSearch className="h-5 w-5" />
            Scan Directories
            {scanDirsDefault && (
              <Badge variant="secondary">Defaults</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Directories to scan when discovering repositories. Vibecheck looks for
            projects containing a <code className="text-xs">.git</code> folder or{" "}
            <code className="text-xs">package.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current directories list */}
          {scanDirs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scan directories configured.
            </p>
          ) : (
            <div className="space-y-2">
              {scanDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm font-mono truncate" title={dir}>
                    {dir}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveScanDir(dir)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add new directory */}
          <div className="flex gap-2">
            <Input
              placeholder="/home/user/projects"
              value={newScanDir}
              onChange={(e) => setNewScanDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddScanDir();
              }}
            />
            <Button
              onClick={handleAddScanDir}
              disabled={!newScanDir.trim()}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveScanDirs}
              disabled={savingScanDirs}
              size="sm"
            >
              {savingScanDirs
                ? "Saving..."
                : scanDirsSaved
                  ? "Saved!"
                  : "Save Directories"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetScanDirs}
              disabled={savingScanDirs}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset to Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Repo Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Repositories</span>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger
                render={
                  <Button size="sm">
                    <Plus className="h-4 w-4" />
                    Add Repo
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Repository</DialogTitle>
                  <DialogDescription>
                    Enter the absolute path to a local repository.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="settings-repo-path">Repository Path</Label>
                  <Input
                    id="settings-repo-path"
                    placeholder="/home/user/projects/my-repo"
                    value={newRepoPath}
                    onChange={(e) => setNewRepoPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddRepo();
                    }}
                  />
                  {addError && (
                    <p className="text-xs text-destructive">{addError}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleAddRepo}
                    disabled={adding || !newRepoPath.trim()}
                  >
                    {adding ? "Adding..." : "Add"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardTitle>
          <CardDescription>
            Manage the repositories tracked by Vibecheck.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories added yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Last Scan</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {repos.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell className="font-medium">{repo.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground" title={repo.path}>
                      {repo.path}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {repo.latestScan?.createdAt
                        ? new Date(repo.latestScan.createdAt).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        onClick={() => handleDeleteRepo(repo.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Save Settings */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSaveSettings} disabled={saving}>
          {saving ? "Saving..." : saveSuccess ? "Settings Saved!" : "Save Settings"}
        </Button>
        {saveSuccess && (
          <span className="text-sm text-muted-foreground">
            All settings have been saved.
          </span>
        )}
      </div>
    </div>
  );
}
