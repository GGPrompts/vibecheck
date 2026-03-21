"use client";

import { useEffect, useState, useCallback } from "react";
import type { Settings, Repo, AuditPromptEntry, ModuleInfo } from "./types";

export function useSettings() {
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

  // Registered modules fetched from API
  const [allModules, setAllModules] = useState<ModuleInfo[]>([]);

  // Module toggles (local state for form) — initialized empty, populated after fetch
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [modulesInitialized, setModulesInitialized] = useState(false);

  // Token budget
  const [tokenBudget, setTokenBudget] = useState(100000);

  // AI provider
  const [aiProvider, setAiProvider] = useState<"api" | "cli" | "auto" | "codex">("auto");
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  const [checkingCli, setCheckingCli] = useState(false);

  // Model tier overrides
  const [globalTier, setGlobalTier] = useState<string>("sonnet");
  const [moduleTiers, setModuleTiers] = useState<Record<string, string>>({});

  // Project profile and scan tier
  const [projectProfile, setProjectProfile] = useState<string>("team");
  const [scanTier, setScanTier] = useState<string>("pro");

  // Scan directories
  const [scanDirs, setScanDirs] = useState<string[]>([]);
  const [scanDirsDefault, setScanDirsDefault] = useState(true);
  const [newScanDir, setNewScanDir] = useState("");
  const [savingScanDirs, setSavingScanDirs] = useState(false);
  const [scanDirsSaved, setScanDirsSaved] = useState(false);

  // Audit prompts
  const [auditPrompts, setAuditPrompts] = useState<
    Record<string, AuditPromptEntry>
  >({});
  const [auditPromptsLoading, setAuditPromptsLoading] = useState(true);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  // Add repo dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // --- Fetch functions ---

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch("/api/modules");
      const data = await res.json();
      if (Array.isArray(data.modules)) {
        setAllModules(data.modules);
        // Only set default enabled modules if we haven't loaded settings yet
        if (!modulesInitialized) {
          setEnabledModules((prev) => {
            // If settings already populated enabledModules, keep those
            if (prev.length > 0) return prev;
            // Otherwise default to modules with defaultEnabled: true
            return data.modules
              .filter((m: ModuleInfo) => m.defaultEnabled)
              .map((m: ModuleInfo) => m.id);
          });
          setModulesInitialized(true);
        }
      }
    } catch {
      // Silently handle
    }
  }, [modulesInitialized]);

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
      setProjectProfile(data.profile ?? "team");
      setScanTier(data.tier ?? "pro");
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModules();
    fetchSettings();
    fetchRepos();
    fetchScanDirs();
    fetchAuditPrompts();
    checkCliAvailability();
  }, [fetchModules, fetchSettings, fetchRepos, fetchScanDirs, fetchAuditPrompts, checkCliAvailability]);

  // --- Handlers ---

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
          profile: projectProfile,
          tier: scanTier,
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
    const currentPrompts = { ...auditPrompts };
    const promptsToSave: Record<string, string> = {};
    for (const [id, entry] of Object.entries(currentPrompts)) {
      if (id === moduleId) continue;
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

  return {
    // Core state
    settings,
    loading,
    saving,
    saveSuccess,

    // API key
    apiKey,
    setApiKey,
    showApiKey,
    setShowApiKey,
    savingKey,
    keySaved,
    handleSaveApiKey,

    // Modules
    allModules,
    enabledModules,
    toggleModule,

    // Token budget
    tokenBudget,
    setTokenBudget,

    // AI provider
    aiProvider,
    setAiProvider,
    cliAvailable,
    checkingCli,

    // Model tiers
    globalTier,
    setGlobalTier,
    moduleTiers,
    setModuleTiers,

    // Profile & tier
    projectProfile,
    setProjectProfile,
    scanTier,
    setScanTier,

    // Scan dirs
    scanDirs,
    scanDirsDefault,
    newScanDir,
    setNewScanDir,
    savingScanDirs,
    scanDirsSaved,
    handleAddScanDir,
    handleRemoveScanDir,
    handleSaveScanDirs,
    handleResetScanDirs,

    // Audit prompts
    auditPrompts,
    auditPromptsLoading,
    savingPrompts,
    promptsSaved,
    handlePromptChange,
    handleResetPrompt,
    handleSavePrompts,

    // Repos
    repos,
    dialogOpen,
    setDialogOpen,
    newRepoPath,
    setNewRepoPath,
    addError,
    adding,
    handleAddRepo,
    handleDeleteRepo,

    // Save all
    handleSaveSettings,
  };
}
