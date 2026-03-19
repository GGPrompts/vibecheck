import type { Severity } from '../../types';

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  pattern: string; // ast-grep pattern
  language: string; // 'typescript' | 'javascript'
  severity: Severity;
  hipaaCategory: string; // e.g., 'Privacy Rule', 'Security Rule'
  hipaaRef: string; // e.g., '§164.312(a)(1)'
  message: string;
  suggestion: string;
}

// PHI-related variable name fragments used across multiple rules
const PHI_NAMES = ['ssn', 'dob', 'patient', 'medical', 'diagnosis', 'healthRecord', 'mrn', 'phi'];

/**
 * Helper to generate multiple rules from a template, one per PHI variable name.
 * This keeps the rule set concise while covering all PHI-related identifiers.
 */
function expandPhiRules(
  template: (phiName: string) => ComplianceRule
): ComplianceRule[] {
  return PHI_NAMES.map(template);
}

// --- Rule definitions ---

const phiInLogRules: ComplianceRule[] = expandPhiRules((name) => ({
  id: `phi-in-logs-${name}`,
  name: `PHI in Logs (${name})`,
  description: `Detects console logging of variables containing PHI-related name "${name}"`,
  pattern: `console.log($$$, ${name}, $$$)`,
  language: 'typescript',
  severity: 'high',
  hipaaCategory: 'Privacy Rule',
  hipaaRef: '§164.502(a)',
  message: `PHI variable "${name}" is being logged to the console. Console logs may be captured by log aggregation systems, exposing protected health information.`,
  suggestion: `Remove "${name}" from the log statement or redact sensitive fields before logging. Use a HIPAA-compliant logging library that automatically redacts PHI.`,
}));

// Expand to other console methods
const consoleMethodRules: ComplianceRule[] = ['info', 'warn', 'error'].flatMap((method) =>
  expandPhiRules((name) => ({
    id: `phi-in-console-${method}-${name}`,
    name: `PHI in console.${method} (${name})`,
    description: `Detects console.${method} calls containing PHI-related variable "${name}"`,
    pattern: `console.${method}($$$, ${name}, $$$)`,
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'Privacy Rule',
    hipaaRef: '§164.502(a)',
    message: `PHI variable "${name}" is logged via console.${method}(). This may expose protected health information in log output.`,
    suggestion: `Remove "${name}" from the console.${method}() call or use a HIPAA-compliant logging library with automatic PHI redaction.`,
  }))
);

const hardcodedPhiPatterns: ComplianceRule[] = [
  {
    id: 'hardcoded-ssn-assignment',
    name: 'Hardcoded SSN Pattern',
    description: 'Detects string literals that look like SSN assignments',
    pattern: `const ssn = $STR`,
    language: 'typescript',
    severity: 'critical',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(1)',
    message: 'A variable named "ssn" is assigned a value directly. Hardcoded SSNs in source code are a critical HIPAA violation.',
    suggestion: 'Never hardcode SSNs or other PHI in source code. Use environment variables, encrypted vaults, or secure database lookups.',
  },
  {
    id: 'hardcoded-mrn-assignment',
    name: 'Hardcoded MRN Pattern',
    description: 'Detects string literals that look like MRN assignments',
    pattern: `const mrn = $STR`,
    language: 'typescript',
    severity: 'critical',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(1)',
    message: 'A variable named "mrn" (Medical Record Number) is assigned a value directly. Hardcoded MRNs in source code are a HIPAA violation.',
    suggestion: 'Never hardcode MRNs or other PHI identifiers in source code. Use secure storage and retrieval mechanisms.',
  },
  ...expandPhiRules((name) => ({
    id: `hardcoded-phi-let-${name}`,
    name: `Hardcoded PHI Assignment (${name})`,
    description: `Detects let/var assignments to PHI-named variable "${name}" with a string literal`,
    pattern: `let ${name} = $STR`,
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(1)',
    message: `Variable "${name}" is assigned a value directly. If this contains PHI, it should not be hardcoded in source code.`,
    suggestion: `Avoid hardcoding PHI values. Retrieve "${name}" from a secure, encrypted data store at runtime.`,
  })),
];

const phiInErrorResponses: ComplianceRule[] = [
  // res.json containing PHI
  ...expandPhiRules((name) => ({
    id: `phi-in-res-json-${name}`,
    name: `PHI in Response JSON (${name})`,
    description: `Detects PHI variable "${name}" included in res.json() response`,
    pattern: `res.json({ $$$, ${name}, $$$ })`,
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'Privacy Rule',
    hipaaRef: '§164.502(a)',
    message: `PHI variable "${name}" is included in an HTTP JSON response. This may expose PHI to unauthorized recipients.`,
    suggestion: `Remove "${name}" from the response object, or ensure the endpoint requires proper authentication and the data is encrypted in transit (TLS). Apply minimum necessary principle.`,
  })),
  // res.send containing PHI
  ...expandPhiRules((name) => ({
    id: `phi-in-res-send-${name}`,
    name: `PHI in Response Send (${name})`,
    description: `Detects PHI variable "${name}" passed to res.send()`,
    pattern: `res.send(${name})`,
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'Privacy Rule',
    hipaaRef: '§164.502(a)',
    message: `PHI variable "${name}" is directly sent in an HTTP response via res.send(). This may expose protected health information.`,
    suggestion: `Avoid sending raw PHI in responses. Apply the minimum necessary standard and ensure proper access controls and encryption.`,
  })),
  // throw new Error containing PHI
  ...expandPhiRules((name) => ({
    id: `phi-in-thrown-error-${name}`,
    name: `PHI in Thrown Error (${name})`,
    description: `Detects PHI variable "${name}" in thrown errors that may surface in stack traces`,
    pattern: `throw new Error(${name})`,
    language: 'typescript',
    severity: 'medium',
    hipaaCategory: 'Privacy Rule',
    hipaaRef: '§164.502(a)',
    message: `PHI variable "${name}" is included in a thrown Error. Error messages may appear in logs, stack traces, or error reporting services.`,
    suggestion: `Use generic error messages instead of including PHI. Log the detailed error securely on the server side with PHI redaction.`,
  })),
];

const unencryptedStorage: ComplianceRule[] = [
  // localStorage
  ...expandPhiRules((name) => ({
    id: `phi-localstorage-${name}`,
    name: `PHI in localStorage (${name})`,
    description: `Detects PHI variable "${name}" stored in localStorage without encryption`,
    pattern: `localStorage.setItem($KEY, ${name})`,
    language: 'typescript',
    severity: 'critical',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(2)(iv)',
    message: `PHI variable "${name}" is stored in localStorage, which is unencrypted browser storage accessible to any script on the same origin.`,
    suggestion: `Never store PHI in localStorage. Use server-side encrypted storage or, if client-side storage is required, encrypt the data before storing and use sessionStorage with short expiry.`,
  })),
  // sessionStorage
  ...expandPhiRules((name) => ({
    id: `phi-sessionstorage-${name}`,
    name: `PHI in sessionStorage (${name})`,
    description: `Detects PHI variable "${name}" stored in sessionStorage without encryption`,
    pattern: `sessionStorage.setItem($KEY, ${name})`,
    language: 'typescript',
    severity: 'high',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(2)(iv)',
    message: `PHI variable "${name}" is stored in sessionStorage without encryption. While more limited than localStorage, it is still unencrypted browser storage.`,
    suggestion: `Encrypt PHI data before storing in sessionStorage, or preferably use server-side encrypted storage.`,
  })),
  // fs.writeFileSync
  ...expandPhiRules((name) => ({
    id: `phi-writefile-${name}`,
    name: `PHI Written to File (${name})`,
    description: `Detects PHI variable "${name}" written to a file without encryption`,
    pattern: `fs.writeFileSync($PATH, ${name})`,
    language: 'typescript',
    severity: 'critical',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(2)(iv)',
    message: `PHI variable "${name}" is written to a file via fs.writeFileSync without encryption. Files at rest must be encrypted under HIPAA.`,
    suggestion: `Encrypt the data before writing to disk. Use AES-256 encryption or a HIPAA-compliant file storage service.`,
  })),
  // fs.writeFile
  ...expandPhiRules((name) => ({
    id: `phi-writefile-async-${name}`,
    name: `PHI Written to File Async (${name})`,
    description: `Detects PHI variable "${name}" written to a file asynchronously without encryption`,
    pattern: `fs.writeFile($PATH, ${name}, $$$)`,
    language: 'typescript',
    severity: 'critical',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(a)(2)(iv)',
    message: `PHI variable "${name}" is written to a file via fs.writeFile without encryption. Files at rest must be encrypted under HIPAA.`,
    suggestion: `Encrypt the data before writing to disk. Use AES-256 encryption or a HIPAA-compliant file storage service.`,
  })),
];

const missingAccessLog: ComplianceRule[] = [
  // Database queries on patient/medical collections without audit logging
  {
    id: 'patient-find-no-audit',
    name: 'Patient Query Without Audit Log',
    description: 'Detects database find operations on patient data without accompanying audit log',
    pattern: `$DB.find({ patient: $$$ })`,
    language: 'typescript',
    severity: 'medium',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(b)',
    message: 'Database query accessing patient data detected. HIPAA requires audit controls for all access to PHI.',
    suggestion: 'Add an audit log entry whenever patient data is queried. Record who accessed the data, when, and for what purpose.',
  },
  {
    id: 'patient-findone-no-audit',
    name: 'Patient FindOne Without Audit Log',
    description: 'Detects database findOne operations on patient data without accompanying audit log',
    pattern: `$DB.findOne({ patient: $$$ })`,
    language: 'typescript',
    severity: 'medium',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(b)',
    message: 'Database findOne query accessing patient data detected. HIPAA requires audit controls for all access to PHI.',
    suggestion: 'Add an audit log entry whenever patient data is queried. Record who accessed the data, when, and for what purpose.',
  },
  {
    id: 'medical-query-no-audit',
    name: 'Medical Table Query Without Audit Log',
    description: 'Detects database query operations on medical tables',
    pattern: `$DB.query($$$medical$$$)`,
    language: 'typescript',
    severity: 'medium',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(b)',
    message: 'Database query referencing medical data detected. All access to PHI must be logged for HIPAA compliance.',
    suggestion: 'Implement audit logging middleware that automatically logs all queries to PHI-containing tables.',
  },
  {
    id: 'patient-select-no-audit',
    name: 'Patient SELECT Without Audit Log',
    description: 'Detects SQL select operations that may access patient data',
    pattern: `$DB.select($$$).from($$$patient$$$)`,
    language: 'typescript',
    severity: 'medium',
    hipaaCategory: 'Security Rule',
    hipaaRef: '§164.312(b)',
    message: 'SQL SELECT query on patient-related table detected. HIPAA requires audit trail for all PHI access.',
    suggestion: 'Wrap patient data queries in an audit-logging function that records access details before returning results.',
  },
];

/**
 * All HIPAA compliance rules exported as a single array.
 * Rules are organized by HIPAA category and can be filtered by severity.
 */
export const hipaaRules: ComplianceRule[] = [
  ...phiInLogRules,
  ...consoleMethodRules,
  ...hardcodedPhiPatterns,
  ...phiInErrorResponses,
  ...unencryptedStorage,
  ...missingAccessLog,
];
