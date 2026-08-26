// lib/mediacrater/scoreCalculator.ts
//
// Direct port of the extension's utils/scoreCalculator.js. No chrome
// dependencies in the original, so this is an unchanged port — same
// risk-tier logic, same dedup/grouping behavior, so a video scanned in
// the extension and the web app lands on the same risk label.

export interface Violation {
  type?: string;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | string;
  timestamp?: string;
  timestamps?: string[];
  frame?: number;
  frames?: number[];
  suggestedFix?: string;
  editingWorkaround?: string;
  eventId?: string | null;
  [key: string]: unknown;
}

export interface RiskResult {
  confidenceScore: null;
  riskLevel: 'Low Risk' | 'Medium Risk' | 'High Risk';
  riskClass: 'confidence-high' | 'confidence-medium' | 'confidence-low';
  processedViolations: Violation[];
}

/**
 * Calculate risk level from violations array.
 *
 * Low Risk    — no violations found
 * Medium Risk — exactly 1 violation of low or medium severity
 * High Risk   — any high severity violation, OR 2+ violations of any severity
 */
export function calculateConfidenceScore(violations: Violation[] | null | undefined): RiskResult {
  if (!violations || violations.length === 0) {
    return {
      confidenceScore: null,
      riskLevel: 'Low Risk',
      riskClass: 'confidence-high',
      processedViolations: [],
    };
  }

  const processedViolations = deduplicateViolations(violations);

  const hasHighSeverity = processedViolations.some(
    (v) => (v.severity || '').toString().toLowerCase() === 'high'
  );
  const count = processedViolations.length;

  let riskLevel: RiskResult['riskLevel'];
  let riskClass: RiskResult['riskClass'];

  if (hasHighSeverity || count >= 2) {
    riskLevel = 'High Risk';
    riskClass = 'confidence-low'; // red
  } else if (count === 1) {
    riskLevel = 'Medium Risk';
    riskClass = 'confidence-medium'; // amber
  } else {
    riskLevel = 'Low Risk';
    riskClass = 'confidence-high'; // green
  }

  return {
    confidenceScore: null,
    riskLevel,
    riskClass,
    processedViolations,
  };
}

/**
 * Deduplicate violations by merging those with the same type and similar
 * reason. Merges timestamps and frames for grouped display.
 */
function deduplicateViolations(violations: Violation[]): Violation[] {
  const violationMap = new Map<string, Violation>();

  for (const violation of violations) {
    const key = generateViolationKey(violation);

    if (violationMap.has(key)) {
      const existing = violationMap.get(key)!;

      if (violation.timestamp) {
        if (!existing.timestamps) {
          existing.timestamps = existing.timestamp ? [existing.timestamp] : [];
          delete existing.timestamp;
        }
        existing.timestamps.push(violation.timestamp);
      }

      if (violation.frame) {
        if (!existing.frames) {
          existing.frames = existing.frame ? [existing.frame] : [];
          delete existing.frame;
        }
        existing.frames.push(violation.frame);
      }
    } else {
      const newViolation: Violation = { ...violation };

      if (newViolation.timestamp) {
        newViolation.timestamps = [newViolation.timestamp];
        delete newViolation.timestamp;
      }

      if (newViolation.frame) {
        newViolation.frames = [newViolation.frame];
        delete newViolation.frame;
      }

      violationMap.set(key, newViolation);
    }
  }

  return Array.from(violationMap.values());
}

function generateViolationKey(violation: Violation): string {
  const type = (violation.type || 'Unknown').toLowerCase().trim();
  const reason = (violation.reason || '')
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}(\.\d+)?/g, '')
    .replace(/frame\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${type}::${reason}`;
}

/**
 * Group violations by type for UI presentation.
 */
export function groupViolationsByType(violations: Violation[]): Record<string, Violation[]> {
  const grouped: Record<string, Violation[]> = {};
  for (const violation of violations) {
    const type = violation.type || 'Other';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(violation);
  }
  return grouped;
}

/**
 * Maps a violation's severity to a left-border color class, matching the
 * extension's colored side-bar on each violation card. Falls back to
 * amber (medium) for anything unrecognized rather than no color at all —
 * an unstyled card reads as more of a bug than a reasonable default.
 */
export function severityBorderClass(severity: string | undefined): string {
  switch ((severity || '').toLowerCase()) {
    case 'high':
      return 'border-l-4 border-l-red-500';
    case 'low':
      return 'border-l-4 border-l-green-500';
    case 'medium':
    default:
      return 'border-l-4 border-l-amber-500';
  }
}
