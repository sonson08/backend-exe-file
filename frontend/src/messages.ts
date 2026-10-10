import type { Decision, HealthStatus, ReviewSnapshot } from "./types.ts";
import { isHealthStatus, isReviewSnapshot } from "./types.ts";

export type ExtensionMessage =
  | { type: "GET_HEALTH" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_USE_AI"; useAi: boolean }
  | { type: "GET_REVIEW" }
  | { type: "PROMPT_HELD"; text: string }
  | { type: "SET_KEPT_FINDINGS"; ids: string[] }
  | { type: "DECIDE"; decision: Decision }
  | { type: "HEALTH_STATUS"; status: HealthStatus }
  | { type: "REVIEW_UPDATE"; review: ReviewSnapshot | null }
  | { type: "RELEASE"; action: Decision; text: string }
  | { type: "OPEN_PANEL" };

function isDecision(value: unknown): value is Decision {
  return value === "send_original" || value === "send_redacted" || value === "cancel";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;

  const message = value as {
    type?: unknown;
    text?: unknown;
    useAi?: unknown;
    ids?: unknown;
    decision?: unknown;
    status?: unknown;
    review?: unknown;
    action?: unknown;
  };

  switch (message.type) {
    case "GET_HEALTH":
    case "GET_SETTINGS":
    case "GET_REVIEW":
    case "OPEN_PANEL":
      return true;
    case "SET_USE_AI":
      return typeof message.useAi === "boolean";
    case "PROMPT_HELD":
      return typeof message.text === "string";
    case "SET_KEPT_FINDINGS":
      return isStringArray(message.ids);
    case "DECIDE":
      return isDecision(message.decision);
    case "HEALTH_STATUS":
      return isHealthStatus(message.status);
    case "REVIEW_UPDATE":
      return message.review === null || isReviewSnapshot(message.review);
    case "RELEASE":
      return isDecision(message.action) && typeof message.text === "string";
    default:
      return false;
  }
}
