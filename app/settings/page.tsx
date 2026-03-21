"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ApiKeyCard,
  ProfileSelector,
  TierSelector,
  AiBackendCard,
  ModelTiersCard,
  ModuleTogglesCard,
  TokenBudgetCard,
  AuditPromptsCard,
  ScanDirsCard,
  RepositoriesCard,
  useSettings,
} from "@/components/settings";

export default function SettingsPage() {
  const s = useSettings();

  if (s.loading) {
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

      <ApiKeyCard
        hasApiKey={s.settings.hasApiKey}
        apiKey={s.apiKey}
        showApiKey={s.showApiKey}
        savingKey={s.savingKey}
        keySaved={s.keySaved}
        onApiKeyChange={s.setApiKey}
        onToggleShow={() => s.setShowApiKey(!s.showApiKey)}
        onSave={s.handleSaveApiKey}
      />

      <Separator />

      <ProfileSelector
        projectProfile={s.projectProfile}
        onProfileChange={s.setProjectProfile}
      />

      <Separator />

      <TierSelector
        scanTier={s.scanTier}
        onTierChange={s.setScanTier}
      />

      <Separator />

      <AiBackendCard
        aiProvider={s.aiProvider}
        checkingCli={s.checkingCli}
        cliAvailable={s.cliAvailable}
        hasApiKey={s.settings.hasApiKey}
        onProviderChange={s.setAiProvider}
      />

      <Separator />

      <ModelTiersCard
        globalTier={s.globalTier}
        moduleTiers={s.moduleTiers}
        onGlobalTierChange={s.setGlobalTier}
        onModuleTiersChange={s.setModuleTiers}
      />

      <Separator />

      <ModuleTogglesCard
        enabledModules={s.enabledModules}
        onToggleModule={s.toggleModule}
      />

      <Separator />

      <TokenBudgetCard
        tokenBudget={s.tokenBudget}
        onTokenBudgetChange={s.setTokenBudget}
      />

      <Separator />

      <AuditPromptsCard
        auditPrompts={s.auditPrompts}
        auditPromptsLoading={s.auditPromptsLoading}
        savingPrompts={s.savingPrompts}
        promptsSaved={s.promptsSaved}
        onPromptChange={s.handlePromptChange}
        onResetPrompt={s.handleResetPrompt}
        onSavePrompts={s.handleSavePrompts}
      />

      <Separator />

      <ScanDirsCard
        scanDirs={s.scanDirs}
        scanDirsDefault={s.scanDirsDefault}
        newScanDir={s.newScanDir}
        savingScanDirs={s.savingScanDirs}
        scanDirsSaved={s.scanDirsSaved}
        onNewScanDirChange={s.setNewScanDir}
        onAddScanDir={s.handleAddScanDir}
        onRemoveScanDir={s.handleRemoveScanDir}
        onSaveScanDirs={s.handleSaveScanDirs}
        onResetScanDirs={s.handleResetScanDirs}
      />

      <Separator />

      <RepositoriesCard
        repos={s.repos}
        dialogOpen={s.dialogOpen}
        newRepoPath={s.newRepoPath}
        addError={s.addError}
        adding={s.adding}
        onDialogOpenChange={s.setDialogOpen}
        onNewRepoPathChange={s.setNewRepoPath}
        onAddRepo={s.handleAddRepo}
        onDeleteRepo={s.handleDeleteRepo}
      />

      {/* Spacer so content isn't hidden behind sticky bar */}
      <div className="h-16" />

      {/* Sticky Save Settings bar */}
      <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-background/95 backdrop-blur-sm border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-3">
          <Button onClick={s.handleSaveSettings} disabled={s.saving}>
            {s.saving ? "Saving..." : s.saveSuccess ? "Settings Saved!" : "Save Settings"}
          </Button>
          {s.saveSuccess && (
            <span className="text-sm text-muted-foreground">
              All settings have been saved.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
