import { buildScan, locateAiFindings, MODEL, redactLocally } from "./localScan.ts";
import type { AiStatus, HealthStatus, RedactSpan, ScanResult } from "./types.ts";

const OLLAMA_BASE = "http://127.0.0.1:11434";
const MAX_TEXT_LENGTH = 20000;

const AI_TIMEOUT_MS = 120000;

const TOKEN_CATEGORIES: Record<string, string> = {
  PERSON: "person",
  EMAIL: "email",
  PHONE: "phone",
  ADDRESS: "address",
  SSN: "government_id",
  ID: "government_id",
  UUID: "personal_id",
  CREDIT_CARD: "payment_card",
  CARD: "payment_card",
  IBAN: "account_number",
  GENDER: "gender",
  AGE: "age",
  RACE: "race",
  MARITAL_STATUS: "marital_status",
};

// The Distil-PII model was fine-tuned on this exact prompt; rewording it degrades its output.
const CLASSIFIER_PROMPT = `You are a problem solving model working on task_description XML block:
<task_description>
Produce a redacted version of texts, removing sensitive personal data while preserving operational signals. The model must return a single json blob with:

* **redacted_text** is the input with minimal, in-place replacements of redacted entities.
* **entities** as an array of objects with exactly three fields {value: original_value, replacement_token: replacement, reason: reasoning}.

## What to redact (→ replacement token)

* **PERSON** — customer/patient/person names (first/last/full; identifying initials) → \`[PERSON]\`
* **EMAIL** — any email, including obfuscated \`name(at)domain(dot)com\` → \`[EMAIL]\`
* **PHONE** — any international/national format (separators/emoji bullets allowed) → \`[PHONE]\`
* **ADDRESS** — street + number; full postal lines; apartment/unit numbers → \`[ADDRESS]\`
* **SSN** — US Social Security numbers → \`[SSN]\`
* **ID** — national IDs (PESEL, NIN, Aadhaar, DNI, etc.) when personal → \`[ID]\`
* **UUID** — person-scoped system identifiers (e.g., MRN/NHS/patient IDs/customer UUIDs) → \`[UUID]\`
* **CREDIT_CARD** — 13–19 digits (spaces/hyphens allowed) → \`[CARD_LAST4:####]\` (keep last-4 only)
* **IBAN** — IBAN/bank account numbers → \`[IBAN_LAST4:####]\` (keep last-4 only)
* **GENDER** — self-identification (male/female/non-binary/etc.) → \`[GENDER]\`
* **AGE** — stated ages (“I’m 29”, “age: 47”, “29 y/o”) → \`[AGE_YEARS:##]\`
* **RACE** — race/ethnicity self-identification → \`[RACE]\`
* **MARITAL_STATUS** — married/single/divorced/widowed/partnered → \`[MARITAL_STATUS]\`

## Keep (do not redact)

* Card **last-4** when only last-4 is present (e.g., “ending 9021”, “•••• 9021”).
* Operational IDs: order/ticket/invoice numbers, shipment tracking, device serials, case IDs.
* Non-personal org info: company names, product names, team names.
* Cities/countries alone (redact full street+number, not plain city/country mentions).

## Output schema (exactly these fields)
* **redacted_text** The original text with all the sensitive information replaced with redacted tokens
* **entities** Array with all the replaced elements, each element represented by following fields
  * **replacement_token**: one of \`[PERSON] | [EMAIL] | [PHONE] | [ADDRESS] | [SSN] | [ID] | [UUID] | [CREDIT_CARD] | [IBAN] | [GENDER] | [AGE] | [RACE] | [MARITAL_STATUS]\`
  * **value**: original text that was redacted
  * **reason**: brief string explaining the rule/rationale

for example
{
  "redacted_text": "Hi, I'm [PERSON] and my email is [EMAIL].",
  "entities": [
    { "type": "PERSON", "value": "John Smith", "reason": "person name"},
    { "type": "EMAIL", "value": "john.smith@example.com", "reason": "email"},
  ]
}
</task_description>
You will be given a single task with context in the context XML block and the task in the question XML block
Solve the task in question block based on the context in context block.
Generate only the answer, do not generate anything else
`;

function classifierRequest(text: string): string {
  return `

Now for the real task, solve the task in question block based on the context in context block.
Generate only the solution, do not generate anything else
<context>
${text}
</context>
<question>Redact provided text according to the task description and return redacted elements.</question>
`;
}

function tokenCategory(token: string): string | undefined {
  const name = token.replace(/[[\]]/g, "").split(":")[0].trim().toUpperCase();
  return TOKEN_CATEGORIES[name] ?? TOKEN_CATEGORIES[name.replace(/_(?:LAST4|YEARS)$/, "")];
}

export class BackendError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function panelErrorMessage(error: unknown): string {
  if (error instanceof BackendError) return error.message;
  return "Ollama is not reachable on port 11434.";
}

function modelNames(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.models)) return [];
  return body.models.flatMap((model) => {
    if (!isRecord(model)) return [];
    const name = typeof model.name === "string" ? model.name : typeof model.model === "string" ? model.model : "";
    return name ? [name] : [];
  });
}

function hasModel(names: string[]): boolean {
  return names.some((name) => name === MODEL || name.startsWith(`${MODEL}:`));
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return "backend_off";
    return hasModel(modelNames(await response.json())) ? "ready" : "model_missing";
  } catch {
    return "offline";
  }
}

function parseQuotes(content: string): Array<{ category: string; quote: string; reason: string }> {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entities)) return [];
  return parsed.entities.flatMap((entity) => {
    if (!isRecord(entity) || typeof entity.value !== "string") return [];
    const token = typeof entity.replacement_token === "string" ? entity.replacement_token : typeof entity.type === "string" ? entity.type : "";
    const category = tokenCategory(token);
    if (!category) return [];
    return [{ category, quote: entity.value, reason: typeof entity.reason === "string" ? entity.reason : "" }];
  });
}

async function classify(text: string, signal: AbortSignal): Promise<{ status: AiStatus; findings: ReturnType<typeof locateAiFindings> }> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(AI_TIMEOUT_MS);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  timeout.addEventListener("abort", abort);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: "30m",
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content: classifierRequest(text) },
        ],
        format: "json",
        options: { temperature: 0 },
      }),
    });
    if (!response.ok) return { status: "unavailable", findings: [] };
    const body: unknown = await response.json();
    const content =
      isRecord(body) && isRecord(body.message) && typeof body.message.content === "string" ? body.message.content : "";
    if (!content) return { status: "invalid_output", findings: [] };
    return { status: "completed", findings: locateAiFindings(text, parseQuotes(content)) };
  } catch (error) {
    if (signal.aborted) throw error;
    const status: AiStatus = timeout.aborted || performance.now() - started >= AI_TIMEOUT_MS ? "timeout" : "unavailable";
    return { status, findings: [] };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function scanPrompt(text: string, useAi: boolean, signal: AbortSignal): Promise<ScanResult> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new BackendError(413, "Prompt is too long to check");
  }

  if (!useAi) {
    return buildScan(text, [], { status: "skipped", model: MODEL, latencyMs: 0 });
  }

  const started = performance.now();
  const ai = await classify(text, signal);
  return buildScan(text, ai.findings, {
    status: ai.status,
    model: MODEL,
    latencyMs: Math.round(performance.now() - started),
  });
}

export async function redactPrompt(text: string, findings: RedactSpan[]): Promise<string> {
  return redactLocally(text, findings);
}
