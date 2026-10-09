import type { Finding, RecommendedAction, RedactSpan, RiskLevel, ScanResult, Severity } from "./types.ts";

const MODEL = "llama3.2";

const LABELS: Record<string, string> = {
  person: "PERSON",
  person_name: "PERSON",
  email: "EMAIL",
  phone: "PHONE",
  address: "ADDRESS",
  government_id: "GOVERNMENT_ID",
  credential: "CREDENTIAL",
  ip_address: "IP_ADDRESS",
  date_of_birth: "DATE_OF_BIRTH",
  payment_card: "CARD",
  health_info: "HEALTH",
  financial_info: "FINANCIAL",
  confidential_info: "CONFIDENTIAL",
  confidential_keyword: "CONFIDENTIAL",
};

const SEVERITY_RANK: Record<RiskLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };
const ACTION_BY_RISK: Record<RiskLevel, RecommendedAction> = {
  none: "allow",
  low: "warn",
  medium: "redact_and_review",
  high: "redact_and_review",
};
const AI_SEVERITY: Record<string, Severity> = {
  person: "medium",
  person_name: "medium",
  address: "high",
  credential: "high",
  date_of_birth: "high",
  ip_address: "medium",
  health_info: "high",
  financial_info: "medium",
  confidential_info: "medium",
};

const CATEGORY_ALIAS: Record<string, string> = {
  person_name: "person",
  name: "person",
  dob: "date_of_birth",
  birthday: "date_of_birth",
  ip: "ip_address",
  password: "credential",
  secret: "credential",
};

type Span = { start: number; end: number; match: string };

type DraftFinding = {
  category: string;
  severity: Severity;
  source: "pattern" | "ai";
  detector: string;
  start: number;
  end: number;
  match: string;
  reason: string;
};

const EMAIL_PATTERN = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
const MOBILE_PATTERN = /(?<![\d+])(?:\+63|0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;
const LANDLINE_PATTERN = /(?<![\d+(])(?:\(0\d{1,2}\)|\+63[\s-]?\(?[2-8]\d?\)?)[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g;
const CARD_PATTERN = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;
const IPV4_PATTERN = /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d)/g;
const PERSON_PATTERN = /\b(?:my name is|full name is|name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/gi;
const ADDRESS_PATTERN = /\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way)\b\.?/g;
const CREDENTIAL_LABEL_PATTERN = /\b(?:password|passwd|pwd|passcode|secret|api[_ ]?key|access[_ ]?token|token)\b\s*[:=]\s*['"]?([^\s'",.;!?]{6,})/gi;
const CREDENTIAL_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g;
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DOB_PATTERN = new RegExp(
  `\\b(?:date of birth|birth date|birthday|d\\.?o\\.?b\\.?|born(?:\\s+on)?)\\b\\s*[:\\-]?\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}|(?:${MONTH})\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:${MONTH})\\.?\\s+\\d{4})`,
  "gi",
);
const PASSPORT_PATTERN = /\bpassport\b(?:\s*(?:no\.?|number|num|#))?(?:\s+is)?\s*[:#-]?\s*([A-Z]{1,2}\d{6,9})\b/gi;
const PERSON_BEFORE_BORN_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?=,?\s+born\b)/g;
const TIN_PATTERN = /(?<![\d-])\d{3}-\d{3}-\d{3}(?:-\d{3}(?:\d{2})?)?(?![\d-])/g;
const SSS_PATTERN = /(?<![\d-])\d{2}-\d{7}-\d(?![\d-])/g;
const PHILHEALTH_PATTERN = /(?<![\d-])\d{2}-\d{9}-\d(?![\d-])/g;
const UMID_PATTERN = /(?<![\d-])\d{4}-\d{7}-\d(?![\d-])/g;
const SSN_PATTERN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

function matchAll(text: string, pattern: RegExp): Span[] {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    match: match[0],
  }));
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function capturedSpan(text: string, pattern: RegExp, group = 1): Span[] {
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern)).flatMap((match) => {
    const value = match[group];
    if (!value || match.index === undefined) return [];
    const start = match.index + match[0].lastIndexOf(value);
    return [{ start, end: start + value.length, match: value }];
  });
}

function labelledGovId(text: string, labels: string[], digitCounts: number[]): Span[] {
  const pattern = new RegExp(
    `\\b(?:${labels.join("|")})\\b(?:\\s*(?:no\\.?|number|num|#))?\\s*[:#-]?\\s*(\\d{9,14})(?!\\d)`,
    "gi",
  );
  return capturedSpan(text, pattern).filter((span) => digitCounts.includes(span.match.length));
}

function finding(span: Span, category: string, severity: Severity, detector: string, reason: string): DraftFinding {
  return { ...span, category, severity, source: "pattern", detector, reason };
}

export function hasPatternFindings(text: string): boolean {
  return patternFindings(text).length > 0;
}

function patternFindings(text: string): DraftFinding[] {
  const email = matchAll(text, EMAIL_PATTERN).map((span) => finding(span, "email", "high", "email", "Email address"));
  const mobile = matchAll(text, MOBILE_PATTERN).map((span) => finding(span, "phone", "medium", "ph_mobile", "Philippine mobile number"));
  const landline = matchAll(text, LANDLINE_PATTERN).map((span) => finding(span, "phone", "low", "ph_landline", "Philippine landline number"));
  const cards = matchAll(text, CARD_PATTERN)
    .filter((span) => passesLuhn(span.match.replace(/\D/g, "")))
    .map((span) => finding(span, "payment_card", "high", "payment_card", "Payment card number"));
  const people = [...capturedSpan(text, PERSON_PATTERN), ...capturedSpan(text, PERSON_BEFORE_BORN_PATTERN)]
    .filter((span) => /^[A-Z]/.test(span.match))
    .map((span) => finding(span, "person", "medium", "person", "Person name"));
  const addresses = matchAll(text, ADDRESS_PATTERN).map((span) => finding(span, "address", "high", "address", "Street address"));
  const ips = matchAll(text, IPV4_PATTERN).map((span) => finding(span, "ip_address", "medium", "ipv4", "IP address"));
  const labeledSecrets = capturedSpan(text, CREDENTIAL_LABEL_PATTERN).map((span) => finding(span, "credential", "high", "credential_label", "Credential"));
  const tokenSecrets = matchAll(text, CREDENTIAL_TOKEN_PATTERN).map((span) => finding(span, "credential", "high", "credential_token", "Credential"));
  const births = capturedSpan(text, DOB_PATTERN).map((span) => finding(span, "date_of_birth", "high", "date_of_birth", "Date of birth"));
  const government = [
    ...matchAll(text, TIN_PATTERN).map((span) => finding(span, "government_id", "high", "ph_tin", "TIN")),
    ...matchAll(text, SSS_PATTERN).map((span) => finding(span, "government_id", "high", "ph_sss", "SSS number")),
    ...matchAll(text, PHILHEALTH_PATTERN).map((span) => finding(span, "government_id", "high", "ph_philhealth", "PhilHealth number")),
    ...matchAll(text, UMID_PATTERN).map((span) => finding(span, "government_id", "high", "ph_umid", "UMID")),
    ...matchAll(text, SSN_PATTERN).map((span) => finding(span, "government_id", "high", "ssn", "Social Security number")),
    ...labelledGovId(text, ["TIN"], [9, 12, 14]).map((span) => finding(span, "government_id", "high", "ph_tin", "TIN")),
    ...labelledGovId(text, ["SSS"], [10]).map((span) => finding(span, "government_id", "high", "ph_sss", "SSS number")),
    ...labelledGovId(text, ["PhilHealth", "PHIC"], [12]).map((span) => finding(span, "government_id", "high", "ph_philhealth", "PhilHealth number")),
    ...labelledGovId(text, ["UMID", "CRN"], [12]).map((span) => finding(span, "government_id", "high", "ph_umid", "UMID")),
    ...labelledGovId(text, ["SSN", "passport", "driver's license", "drivers license", "national id"], [9, 10, 12]).map((span) =>
      finding(span, "government_id", "high", "government_id", "Government ID"),
    ),
    ...capturedSpan(text, PASSPORT_PATTERN).map((span) => finding(span, "government_id", "high", "passport", "Passport number")),
  ];
  return [...email, ...mobile, ...landline, ...cards, ...people, ...addresses, ...ips, ...labeledSecrets, ...tokenSecrets, ...births, ...government];
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function resolveOverlaps(findings: DraftFinding[]): DraftFinding[] {
  const ranked = [...findings].sort(
    (a, b) =>
      (b.source === "pattern" ? 1 : 0) - (a.source === "pattern" ? 1 : 0) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.end - b.start - (a.end - a.start),
  );
  const kept: DraftFinding[] = [];
  for (const finding of ranked) {
    if (!kept.some((other) => overlaps(other, finding))) kept.push(finding);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function assignPlaceholders(text: string, findings: DraftFinding[]): Array<DraftFinding & { placeholder: string }> {
  const counters: Record<string, number> = {};
  const byValue = new Map<string, string>();
  return [...findings]
    .sort((a, b) => a.start - b.start)
    .map((finding) => {
      const label = LABELS[finding.category] ?? "REDACTED";
      const key = `${label}:${text.slice(finding.start, finding.end).toLowerCase().replace(/[\s().+-]/g, "")}`;
      if (!byValue.has(key)) {
        counters[label] = (counters[label] ?? 0) + 1;
        byValue.set(key, `[${label}_${counters[label]}]`);
      }
      return { ...finding, placeholder: byValue.get(key) ?? `[${label}_1]` };
    });
}

function applyPlaceholders(text: string, findings: Array<{ start: number; end: number; placeholder: string }>): string {
  let result = "";
  let cursor = 0;
  for (const finding of [...findings].sort((a, b) => a.start - b.start)) {
    result += text.slice(cursor, finding.start) + finding.placeholder;
    cursor = finding.end;
  }
  return result + text.slice(cursor);
}

function decide(findings: DraftFinding[]): { riskLevel: RiskLevel; recommendedAction: RecommendedAction } {
  const riskLevel = findings.reduce<RiskLevel>(
    (highest, finding) => (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[highest] ? finding.severity : highest),
    "none",
  );
  return { riskLevel, recommendedAction: ACTION_BY_RISK[riskLevel] };
}

export function locateAiFindings(text: string, quotes: Array<{ category: string; quote: string; reason: string }>): DraftFinding[] {
  return quotes.flatMap((quote) => {
    const category = CATEGORY_ALIAS[quote.category] ?? quote.category;
    const severity = AI_SEVERITY[category];
    const needle = quote.quote.trim();
    if (!severity || needle.length < 2) return [];
    const start = text.indexOf(needle);
    if (start < 0) return [];
    return [
      {
        category,
        severity,
        source: "ai" as const,
        detector: `ai.${category}`,
        start,
        end: start + needle.length,
        match: text.slice(start, start + needle.length),
        reason: quote.reason.trim().slice(0, 200) || "Contextual match",
      },
    ];
  });
}

export function buildScan(text: string, aiFindings: DraftFinding[], ai: ScanResult["ai"]): ScanResult {
  const resolved = assignPlaceholders(text, resolveOverlaps([...patternFindings(text), ...aiFindings]));
  const decision = decide(resolved);
  const findings: Finding[] = resolved.map((finding, index) => ({
    id: `f${index + 1}`,
    category: finding.category,
    severity: finding.severity,
    source: finding.source,
    detector: finding.detector,
    start: finding.start,
    end: finding.end,
    match: finding.match,
    placeholder: finding.placeholder,
    reason: finding.reason,
  }));
  return {
    riskLevel: decision.riskLevel,
    recommendedAction: decision.recommendedAction,
    findings,
    redactedText: applyPlaceholders(text, resolved),
    ai,
  };
}

export function redactLocally(text: string, spans: RedactSpan[]): string {
  const drafts: DraftFinding[] = spans.map((span) => ({
    category: span.category,
    severity: "high",
    source: "pattern",
    detector: span.category,
    start: span.start,
    end: span.end,
    match: text.slice(span.start, span.end),
    reason: "",
  }));
  return applyPlaceholders(text, assignPlaceholders(text, drafts));
}

export { MODEL };
