import { useMemo, useState } from "react";
import { BackendError, scanPrompt } from "../api.ts";
import { CopyIcon, FindingRows, HighlightedText, PlaceholderText, RefreshIcon, SparkIcon, StatusPill, StepHeading } from "./reviewUi.tsx";
import type { Finding, ScanResult } from "../types.ts";

function copyText(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "true");
  field.style.position = "fixed";
  field.style.left = "-9999px";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function textWithKept(text: string, findings: Finding[], keptIds: string[]): string {
  let result = "";
  let cursor = 0;
  for (const finding of findings.filter((item) => keptIds.includes(item.id)).sort((a, b) => a.start - b.start)) {
    result += text.slice(cursor, finding.start) + finding.placeholder;
    cursor = finding.end;
  }
  return result + text.slice(cursor);
}

export function RedactTool({ status }: { status: { title: string; detail: string; tone: "good" | "info" | "bad" } }) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const redacted = useMemo(() => (result ? textWithKept(draft, result.findings, keptIds) : ""), [draft, result, keptIds]);

  const onRedact = () => {
    const text = draft.trim();
    if (!text) {
      setResult(null);
      setKeptIds([]);
      setCopied(false);
      setError("Enter text to redact.");
      return;
    }

    setBusy(true);
    setError(null);
    setCopied(false);
    void scanPrompt(text, true, new AbortController().signal)
      .then((scan) => {
        setDraft(text);
        setResult(scan);
        setKeptIds(scan.findings.map((finding) => finding.id));
      })
      .catch((caught: unknown) => {
        setResult(null);
        setKeptIds([]);
        setError(caught instanceof BackendError ? caught.message : "The text could not be redacted.");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const onCopy = () => {
    if (!result) return;
    setCopied(copyText(redacted));
  };

  const onClear = () => {
    setDraft("");
    setResult(null);
    setKeptIds([]);
    setError(null);
    setCopied(false);
  };

  const onToggle = (id: string, keep: boolean) => {
    setCopied(false);
    setKeptIds((current) => (keep ? (current.includes(id) ? current : [...current, id]) : current.filter((keptId) => keptId !== id)));
  };

  return (
    <div className="sheet">
      <section className="intro">
        <div className="intro-row">
          <h1>Text Redact</h1>
          <StatusPill title={status.title} detail={status.detail} tone={status.tone} />
        </div>
        <p>Redact sensitive information from any supplied text.</p>
      </section>

      <section className="card">
        <StepHeading
          step={1}
          title="Enter your text"
          aside={
            <span className="aside-row">
              {result ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setResult(null);
                    setKeptIds([]);
                    setCopied(false);
                  }}
                >
                  Edit text
                </button>
              ) : null}
              <span className="char-count">
                {draft.length} {draft.length === 1 ? "character" : "characters"}
              </span>
            </span>
          }
        />
        {result && result.findings.length > 0 ? (
          <div className="text-box">
            <p className="plain-text">
              <HighlightedText text={draft} findings={result.findings} keptIds={keptIds} />
            </p>
          </div>
        ) : (
          <textarea
            className="text-input"
            value={draft}
            placeholder="Paste or type text below. Sensitive details will be detected and redacted."
            aria-label="Enter your text"
            onChange={(event) => {
              setDraft(event.target.value);
              setResult(null);
              setKeptIds([]);
              setCopied(false);
            }}
          />
        )}
        <button type="button" className="button button-primary button-block" disabled={busy} onClick={onRedact}>
          {busy ? <span className="spinner spinner-light" aria-hidden="true" /> : <SparkIcon />}
          {busy ? "Redacting…" : "Redact text"}
        </button>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {result && result.findings.length > 0 ? (
        <section className="card">
          <StepHeading
            step={2}
            title="Detected information"
            hint="Review the detected items. Checked items will be replaced with placeholders."
            aside={
              <span className="findings-count">
                {result.findings.length} {result.findings.length === 1 ? "finding" : "findings"}
              </span>
            }
          />
          <FindingRows findings={result.findings} keptIds={keptIds} onToggle={onToggle} />
        </section>
      ) : null}

      {result ? (
        <section className="card">
          <StepHeading
            step={result.findings.length > 0 ? 3 : 2}
            title={result.findings.length > 0 ? "Redacted text" : "Nothing sensitive found"}
            hint={
              result.findings.length > 0
                ? "This is the text with sensitive information replaced. You can copy it before using it."
                : "The text can stay as it is."
            }
          />
          <div className="preview-box preview-green">
            <button type="button" className="icon-button preview-copy" aria-label="Copy redacted text" onClick={onCopy}>
              <CopyIcon />
            </button>
            <PlaceholderText text={redacted} tone="green" />
          </div>
          <div className="actions">
            <button type="button" className="button button-ghost" onClick={onCopy}>
              <CopyIcon />
              {copied ? "Copied" : "Copy redacted text"}
            </button>
            <button type="button" className="button button-ghost" onClick={onClear}>
              <RefreshIcon />
              Clear and try again
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
