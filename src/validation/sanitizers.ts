/**
 * Input sanitization utilities for FreshGuard Core Phase 2
 *
 * Provides advanced sanitization functions for secure input handling
 * with configurable security policies and logging.
 *
 * @license MIT
 */

// ==============================================
// Configuration and Constants
// ==============================================

/**
 * Sanitization policy configuration
 */
export interface SanitizationPolicy {
  /** Remove control characters (0x00-0x1F, 0x7F) */
  removeControlCharacters: boolean;
  /** Remove SQL comment patterns (-- and /* *\/) */
  removeSqlComments: boolean;
  /** Remove dangerous SQL operators (;, etc.) */
  removeSqlOperators: boolean;
  /** Maximum allowed length */
  maxLength: number;
  /** Whether to throw on empty result after sanitization */
  throwOnEmpty: boolean;
  /** Custom patterns to remove */
  customPatterns?: RegExp[];
  /** Allow Unicode characters */
  allowUnicode: boolean;
}

/**
 * Default sanitization policy (security-first)
 */
const DEFAULT_POLICY: SanitizationPolicy = {
  removeControlCharacters: true,
  removeSqlComments: true,
  removeSqlOperators: true,
  maxLength: 256,
  throwOnEmpty: true,
  allowUnicode: false
};

/**
 * Lenient sanitization policy (for user-facing content)
 */
const LENIENT_POLICY: SanitizationPolicy = {
  removeControlCharacters: true,
  removeSqlComments: false,
  removeSqlOperators: false,
  maxLength: 1024,
  throwOnEmpty: false,
  allowUnicode: true
};

/**
 * Strict sanitization policy (for SQL identifiers)
 */
const STRICT_POLICY: SanitizationPolicy = {
  removeControlCharacters: true,
  removeSqlComments: true,
  removeSqlOperators: true,
  maxLength: 64,
  throwOnEmpty: true,
  allowUnicode: false,
  customPatterns: [
    /[^\w\s\-\.]/g, // Only allow alphanumeric, whitespace, hyphen, dot
    /\s{2,}/g       // Collapse multiple whitespace
  ]
};

// ==============================================
// Sanitization Results
// ==============================================

/**
 * Result of sanitization operation
 */
export interface SanitizationResult {
  /** The sanitized value */
  value: string;
  /** Whether any changes were made */
  wasModified: boolean;
  /** List of modifications made */
  modifications: string[];
  /** Original length */
  originalLength: number;
  /** Final length */
  finalLength: number;
}

// ==============================================
// Core Sanitization Functions
// ==============================================

/**
 * Sanitize string input with configurable policy
 */
export function sanitizeString(
  input: unknown,
  policy: Partial<SanitizationPolicy> = {}
): SanitizationResult {
  // Merge with default policy
  const activePolicy: SanitizationPolicy = { ...DEFAULT_POLICY, ...policy };

  // Convert to string
  let value = String(input ?? '');
  const originalLength = value.length;
  const modifications: string[] = [];

  // Check initial length
  if (value.length > activePolicy.maxLength) {
    value = value.substring(0, activePolicy.maxLength);
    modifications.push(`Truncated to ${activePolicy.maxLength} characters`);
  }

  // Trim whitespace
  const trimmed = value.trim();
  if (trimmed !== value) {
    value = trimmed;
    modifications.push('Trimmed whitespace');
  }

  // Remove control characters
  if (activePolicy.removeControlCharacters) {
    const beforeControl = value;
    value = value.replace(/[\x00-\x1F\x7F]/g, '');
    if (value !== beforeControl) {
      modifications.push('Removed control characters');
    }
  }

  // Remove SQL comments
  if (activePolicy.removeSqlComments) {
    const beforeComments = value;
    value = value.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (value !== beforeComments) {
      modifications.push('Removed SQL comments');
    }
  }

  // Remove SQL operators
  if (activePolicy.removeSqlOperators) {
    const beforeOperators = value;
    value = value.replace(/[;]/g, '');
    if (value !== beforeOperators) {
      modifications.push('Removed SQL operators');
    }
  }

  // Remove non-Unicode characters if not allowed
  if (!activePolicy.allowUnicode) {
    const beforeUnicode = value;
    value = value.replace(/[^\x20-\x7E]/g, '');
    if (value !== beforeUnicode) {
      modifications.push('Removed non-ASCII characters');
    }
  }

  // Apply custom patterns
  if (activePolicy.customPatterns) {
    for (const pattern of activePolicy.customPatterns) {
      const beforeCustom = value;
      value = value.replace(pattern, ' ').replace(/\s+/g, ' ').trim();
      if (value !== beforeCustom) {
        modifications.push(`Applied custom pattern: ${pattern.toString()}`);
      }
    }
  }

  // Check if empty after sanitization
  if (activePolicy.throwOnEmpty && value.length === 0) {
    throw new Error('Input is empty after sanitization');
  }

  return {
    value,
    wasModified: modifications.length > 0,
    modifications,
    originalLength,
    finalLength: value.length
  };
}

/**
 * Sanitize SQL identifier (table name, column name)
 */
export function sanitizeIdentifier(input: unknown): SanitizationResult {
  return sanitizeString(input, STRICT_POLICY);
}

/**
 * Sanitize user input (lenient approach)
 */
export function sanitizeUserInput(input: unknown, maxLength = 1024): SanitizationResult {
  return sanitizeString(input, {
    ...LENIENT_POLICY,
    maxLength
  });
}

/**
 * Sanitize filename/path (prevent directory traversal)
 */
export function sanitizePath(input: unknown): SanitizationResult {
  const pathPolicy: Partial<SanitizationPolicy> = {
    removeControlCharacters: true,
    removeSqlComments: true,
    removeSqlOperators: true,
    maxLength: 1024,
    throwOnEmpty: true,
    allowUnicode: false,
    customPatterns: [
      /\.\./g,        // Remove directory traversal
      /\/+/g,         // Collapse multiple slashes
      /^\/+|\/+$/g,   // Remove leading/trailing slashes
      /[<>:"|?*]/g    // Remove invalid filename characters
    ]
  };

  return sanitizeString(input, pathPolicy);
}

// ==============================================
// Specialized Sanitizers
// ==============================================

/**
 * Sanitize email address
 */
export function sanitizeEmail(input: unknown): SanitizationResult {
  const emailPolicy: Partial<SanitizationPolicy> = {
    removeControlCharacters: true,
    removeSqlComments: true,
    removeSqlOperators: true,
    maxLength: 320, // RFC 5321 limit
    throwOnEmpty: true,
    allowUnicode: false,
    customPatterns: [
      /[^a-zA-Z0-9@.\-_+]/g // Only allow email-valid characters
    ]
  };

  const result = sanitizeString(input, emailPolicy);

  // Additional email validation
  if (result.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.value)) {
    throw new Error('Invalid email format after sanitization');
  }

  return result;
}

/**
 * Sanitize URL
 */
export function sanitizeUrl(input: unknown): SanitizationResult {
  const urlPolicy: Partial<SanitizationPolicy> = {
    removeControlCharacters: true,
    removeSqlComments: false, // URLs can contain these characters
    removeSqlOperators: false,
    maxLength: 2048, // Common URL length limit
    throwOnEmpty: true,
    allowUnicode: true, // URLs can contain Unicode
    customPatterns: [
      /javascript:/gi,  // Remove javascript: protocol
      /data:/gi,        // Remove data: protocol
      /vbscript:/gi     // Remove vbscript: protocol
    ]
  };

  const result = sanitizeString(input, urlPolicy);

  // Ensure URL starts with http:// or https://
  if (result.value && !result.value.match(/^https?:\/\//i)) {
    throw new Error('URL must start with http:// or https://');
  }

  return result;
}

/**
 * Sanitize JSON string (for configuration)
 */
export function sanitizeJson(input: unknown): SanitizationResult {
  const jsonPolicy: Partial<SanitizationPolicy> = {
    removeControlCharacters: false, // JSON can contain control chars
    removeSqlComments: false,
    removeSqlOperators: false,
    maxLength: 65536, // 64KB limit
    throwOnEmpty: true,
    allowUnicode: true
  };

  const result = sanitizeString(input, jsonPolicy);

  // Validate JSON syntax
  if (result.value) {
    try {
      JSON.parse(result.value);
    } catch (error) {
      throw new Error('Invalid JSON format after sanitization');
    }
  }

  return result;
}

// ==============================================
// Batch Sanitization
// ==============================================

/**
 * Sanitize multiple strings with the same policy
 */
export function sanitizeBatch(
  inputs: unknown[],
  policy: Partial<SanitizationPolicy> = {}
): {
  results: SanitizationResult[],
  summary: {
    total: number,
    modified: number,
    errors: number
  }
} {
  const results: SanitizationResult[] = [];
  let modified = 0;
  let errors = 0;

  for (const input of inputs) {
    try {
      const result = sanitizeString(input, policy);
      results.push(result);
      if (result.wasModified) {
        modified++;
      }
    } catch (error) {
      errors++;
      // Push error result
      results.push({
        value: '',
        wasModified: false,
        modifications: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        originalLength: String(input ?? '').length,
        finalLength: 0
      });
    }
  }

  return {
    results,
    summary: {
      total: inputs.length,
      modified,
      errors
    }
  };
}

// ==============================================
// Security Utilities
// ==============================================

/**
 * Check if string contains dangerous patterns
 */
export function containsDangerousPatterns(input: string): {
  isDangerous: boolean,
  patterns: string[]
} {
  const dangerousPatterns = [
    { name: 'SQL Injection', pattern: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b)|(\-\-)|(\;)|(\'\s*(OR|AND)\s*\w+\s*=)/i },
    { name: 'Script Injection', pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/i },
    { name: 'Command Injection', pattern: /(\||\&\&|\|\||\;)\s*(rm|del|format|cat|type|echo|curl|wget|powershell|cmd|bash|sh)/i },
    { name: 'Path Traversal', pattern: /(\.\.[\/\\])|(\.\.[\/\\].*[\/\\])/i },
    { name: 'XSS Patterns', pattern: /(javascript\s*:)|(on\w+\s*=)|(expression\s*\()/i }
  ];

  const foundPatterns: string[] = [];

  for (const { name, pattern } of dangerousPatterns) {
    if (pattern.test(input)) {
      foundPatterns.push(name);
    }
  }

  return {
    isDangerous: foundPatterns.length > 0,
    patterns: foundPatterns
  };
}

/**
 * Escape string for use in SQL queries (additional safety)
 */
export function escapeForSql(input: string): string {
  return input
    .replace(/'/g, "''")     // Escape single quotes
    .replace(/\\/g, '\\\\')   // Escape backslashes
    .replace(/\x00/g, '\\0')  // Escape null bytes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\x1a/g, '\\Z'); // Escape ctrl+Z
}

/**
 * Create safe string for logging (redact sensitive info)
 */
export function createLogSafeString(input: string, maxLength = 100): string {
  // Redact common sensitive patterns
  let safe = input
    .replace(/password\s*[:=]\s*['"]\w+['"]/gi, 'password="[REDACTED]"')
    .replace(/token\s*[:=]\s*['"]\w+['"]/gi, 'token="[REDACTED]"')
    .replace(/key\s*[:=]\s*['"]\w+['"]/gi, 'key="[REDACTED]"')
    .replace(/secret\s*[:=]\s*['"]\w+['"]/gi, 'secret="[REDACTED]"');

  // Truncate if too long
  if (safe.length > maxLength) {
    safe = safe.substring(0, maxLength - 3) + '...';
  }

  return safe;
}

// ==============================================
// Export all sanitization utilities
// ==============================================

export const sanitizers = {
  sanitizeString,
  sanitizeIdentifier,
  sanitizeUserInput,
  sanitizePath,
  sanitizeEmail,
  sanitizeUrl,
  sanitizeJson,
  sanitizeBatch,
  containsDangerousPatterns,
  escapeForSql,
  createLogSafeString
} as const;

export const policies = {
  DEFAULT_POLICY,
  LENIENT_POLICY,
  STRICT_POLICY
} as const;

export type {
  SanitizationPolicy,
  SanitizationResult
};