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

// Runtime testing modules (opt-in, starts a dev server)
import './api-health';

// AI-powered modules (require ANTHROPIC_API_KEY)
import './naming-quality';
import './doc-staleness';
import './arch-smells';
import './test-quality';

// Go-native modules (require Go toolchain)
import './go-security';
import './go-dependencies';
import './go-complexity';
import './go-dead-code';
import './go-test-coverage';

// Rust-native modules (require Rust toolchain)
import './rust-security';
import './rust-dependencies';
import './rust-complexity';
import './rust-dead-code';
import './rust-test-coverage';

// New static modules
import './type-safety';
import './secrets-scan';
import './config-quality';
import './telemetry-observability';

// New AI-powered modules
import './doc-accuracy';
import './context-conflicts';
import './error-handling';
