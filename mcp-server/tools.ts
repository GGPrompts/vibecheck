/**
 * MCP tool definitions for vibecheck — barrel re-export.
 *
 * Each tool is implemented in its own file under tools/.
 * This file re-exports everything so existing imports from './tools.js' continue to work.
 */

export { vibecheckScanInput, handleVibecheckScan } from './tools/scan.js';
export {
  vibecheckHealthInput,
  vibecheckModuleInput,
  vibecheckCompareInput,
  handleVibecheckHealth,
  handleVibecheckModule,
  handleVibecheckCompare,
} from './tools/health.js';
export {
  vibecheckPromptInput,
  vibecheckNextActionsInput,
  handleVibecheckPrompt,
  handleVibecheckNextActions,
} from './tools/prompt.js';
export { vibecheckFindingsInput, handleVibecheckFindings } from './tools/findings.js';
export { vibecheckSettingsInput, handleVibecheckSettings } from './tools/settings.js';
