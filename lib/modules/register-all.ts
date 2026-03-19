/**
 * Import all modules to trigger their registration side effects.
 * Import this file once at app startup to ensure all modules are registered.
 */
import './security';
import './dependencies';
import './complexity';
import './git-health';
import './dead-code';
import './circular-deps';
import './test-coverage';

// Structural pattern matching modules (ast-grep)
import './compliance';
import './ast-rules';

// AI-powered modules (require ANTHROPIC_API_KEY)
import './naming-quality';
import './doc-staleness';
import './arch-smells';
import './test-quality';
