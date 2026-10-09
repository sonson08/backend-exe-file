export type HealthStatus = "ready" | "model_missing" | "offline" | "backend_off";

export type AiStatus = "completed" | "skipped" | "unavailable" | "timeout" | "invalid_output";

export type RecommendedAction = "allow" | "warn" | "redact_and_review" | "block";

export type RiskLevel = "none" | "low" | "medium" | "high";

export type FindingSource = "pattern" | "rule" | "ai";

export type Severity = "high" | "medium" | "low";

export type Finding = {
  id: string;
  category: string;
  severity: Severity;
  source: FindingSource;
  start: number;
  end: number;
  match: string;
  placeholder: string;
  reason: string;
  detector?: string;
};

export type ScanResult = {
  riskLevel: RiskLevel;
  recommendedAction: RecommendedAction;
  findings: Finding[];
  redactedText: string;
  ai: {
    status: AiStatus;
    model?: string;
    latencyMs?: number;
  };
};

export type ReviewPhase = "scanning" | "ready" | "error";

export type ReviewSnapshot = {
  text: string;
  phase: ReviewPhase;
  useAi: boolean;
  startedAt: number;
  scan: ScanResult | null;
  redactedText: string | null;
  keptIds: string[];
  error: string | null;
  redactError: string | null;
};

export type RedactSpan = {
  start: number;
  end: number;
  category: string;
};

export type Decision = "send_original" | "send_redacted" | "cancel";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  return value === "ready" || value === "model_missing" || value === "offline" || value === "backend_off";
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.category === "string" &&
    (value.severity === "high" || value.severity === "medium" || value.severity === "low") &&
    (value.source === "pattern" || value.source === "rule" || value.source === "ai") &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.match === "string" &&
    typeof value.placeholder === "string" &&
    typeof value.reason === "string"
  );
}

export function isScanResult(value: unknown): value is ScanResult {
  if (!isRecord(value)) return false;
  if (
    value.riskLevel !== "none" &&
    value.riskLevel !== "low" &&
    value.riskLevel !== "medium" &&
    value.riskLevel !== "high"
  ) {
    return false;
  }
  if (
    value.recommendedAction !== "allow" &&
    value.recommendedAction !== "warn" &&
    value.recommendedAction !== "redact_and_review" &&
    value.recommendedAction !== "block"
  ) {
    return false;
  }
  if (typeof value.redactedText !== "string") return false;
  if (!Array.isArray(value.findings) || !value.findings.every(isFinding)) return false;
  if (!isRecord(value.ai)) return false;
  return (
    value.ai.status === "completed" ||
    value.ai.status === "skipped" ||
    value.ai.status === "unavailable" ||
    value.ai.status === "timeout" ||
    value.ai.status === "invalid_output"
  );
}

export function isReviewSnapshot(value: unknown): value is ReviewSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === "string" &&
    (value.phase === "scanning" || value.phase === "ready" || value.phase === "error") &&
    typeof value.useAi === "boolean" &&
    typeof value.startedAt === "number" &&
    (value.scan === null || isScanResult(value.scan)) &&
    (value.redactedText === null || typeof value.redactedText === "string") &&
    Array.isArray(value.keptIds) &&
    value.keptIds.every((id) => typeof id === "string") &&
    (value.error === null || typeof value.error === "string") &&
    (value.redactError === null || typeof value.redactError === "string")
  );
}
