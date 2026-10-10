import type { ReactNode } from "react";
import type { Finding } from "../types.ts";
import { draftSegments } from "../highlight.ts";

export function categoryTitle(finding: Finding): string {
  if (finding.source === "ai") return categoryFallback(finding.category);
  return finding.reason || categoryFallback(finding.category);
}

function categoryFallback(category: string): string {
  const labels: Record<string, string> = {
    person: "Person name",
    person_name: "Person name",
    email: "Email address",
    phone: "Phone",
    address: "Address",
    government_id: "Government ID",
    credential: "Credential",
    ip_address: "IP address",
    date_of_birth: "Date of birth",
    payment_card: "Payment card",
    account_number: "Account number",
    transaction_id: "Transaction ID",
    personal_id: "Personal ID",
    gender: "Gender",
    age: "Age",
    race: "Race or ethnicity",
    marital_status: "Marital status",
    health_info: "Health",
    financial_info: "Financial",
    confidential_info: "Confidential",
    confidential_keyword: "Confidential keyword",
  };
  return labels[category] ?? category;
}

export function HighlightedText({
  text,
  findings,
  keptIds,
}: {
  text: string;
  findings: Finding[];
  keptIds?: string[];
}) {
  const segments = draftSegments(text, findings);
  if (segments.length === 0) return <span>{text || "\u00a0"}</span>;
  return (
    <>
      {segments.map((segment, index) => {
        if (!segment.finding) return <span key={index}>{segment.text}</span>;
        const active = keptIds === undefined || keptIds.includes(segment.finding.id);
        return (
          <mark key={`${segment.finding.id}-${index}`} className="span span-rose" data-off={active ? "false" : "true"}>
            {segment.text}
          </mark>
        );
      })}
    </>
  );
}

export function PlaceholderText({ text, tone }: { text: string; tone: "blue" | "green" }) {
  const parts = text.split(/(\[[A-Z][A-Z0-9_]*\d+\])/g);
  return (
    <p className="preview-text">
      {parts.map((part, index) =>
        /^\[[A-Z][A-Z0-9_]*\d+\]$/.test(part) ? (
          <mark key={index} className={`token token-${tone}`}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </p>
  );
}

export function StepHeading({
  step,
  title,
  hint,
  aside,
}: {
  step: number;
  title: string;
  hint?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="step-head">
      <span className="step-num">{step}</span>
      <div className="step-copy">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      {aside ? <div className="step-aside">{aside}</div> : null}
    </div>
  );
}

export function FindingRows({
  findings,
  keptIds,
  disabled,
  onToggle,
}: {
  findings: Finding[];
  keptIds?: string[];
  disabled?: boolean;
  onToggle?: (id: string, keep: boolean) => void;
}) {
  return (
    <ul className="finding-rows">
      {findings.map((finding) => {
        const checked = keptIds?.includes(finding.id) ?? true;
        return (
          <li key={finding.id}>
            <label className="finding-row">
              {onToggle ? (
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onToggle(finding.id, event.target.checked)}
                />
              ) : null}
              <CategoryIcon category={finding.category} />
              <span className="finding-copy">
                <span className="finding-kind">{categoryTitle(finding)}</span>
                <span className="finding-match">{finding.match}</span>
              </span>
              <span className="finding-badges">
                <span className="placeholder-pill">{finding.placeholder}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function CategoryIcon({ category }: { category: string }) {
  return (
    <span className="cat-icon" aria-hidden="true">
      {category === "email" ? <MailIcon /> : category === "date_of_birth" ? <CalendarIcon /> : category === "phone" ? <PhoneIcon /> : category === "government_id" ? <IdIcon /> : category === "payment_card" || category === "account_number" || category === "transaction_id" ? <CardIcon /> : category === "credential" ? <KeyIcon /> : category === "address" ? <PinIcon /> : <PersonIcon />}
    </span>
  );
}

export function StatusPill({ title, detail, tone }: { title: string; detail: string; tone: "good" | "info" | "bad" }) {
  return (
    <div className={`status-pill tone-${tone}`} role="status">
      <span className="status-dot" />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M3.4 11.2 20.2 4.2c.7-.3 1.4.4 1.1 1.1l-7 16.8c-.3.8-1.4.8-1.7 0l-2.4-6.1-6.1-2.4c-.8-.3-.8-1.4 0-1.7Z" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 2.5 13.8 8l5.7 1.8-5.7 1.8L12 17.1l-1.8-5.5L4.5 9.8 10.2 8 12 2.5Zm6.2 11.2.8 2.5 2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8.8-2.5Z" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M8 8.5h9.5V19H8z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M6.5 15.5H5V5h10.5v1.5" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M19 12a7 7 0 1 1-2-4.9M19 5v4.2h-4.2" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M12 12a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 12Zm-5.2 7.2a5.2 5.2 0 0 1 10.4 0" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M7 4.5v2.2M17 4.5v2.2M5 9h14M6.2 6.2h11.6A1.2 1.2 0 0 1 19 7.4v10.4a1.2 1.2 0 0 1-1.2 1.2H6.2A1.2 1.2 0 0 1 5 17.8V7.4a1.2 1.2 0 0 1 1.2-1.2Z" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M4.5 7.5h15v9h-15v-9Zm3 2.2h3.2M7.5 12.5h5.5M7.5 14.6h4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M5 7.5h14v9H5v-9Zm0 1 7 5 7-5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M8 5.5h2.2l1.1 2.6-1.5 1a11 11 0 0 0 4.1 4.1l1-1.5 2.6 1.1V17a1.5 1.5 0 0 1-1.6 1.5A12.5 12.5 0 0 1 6.5 7.1 1.5 1.5 0 0 1 8 5.5Z" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M4.5 8h15v8.5h-15V8Zm0 3h15M7.5 14.2h3" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M14.5 10.2a3.2 3.2 0 1 0-3.1 3.8l.1 1.5h2l.8-1.2.9.6 1.2-1.6-1.9-1.1Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M12 19.5s5-4.2 5-8.2a5 5 0 1 0-10 0c0 4 5 8.2 5 8.2Zm0-6.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z" />
    </svg>
  );
}
