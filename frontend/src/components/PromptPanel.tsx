import { useEffect, useState } from "react";
import { RedactTool } from "./RedactTool.tsx";
import { FindingRows, HighlightedText, PlaceholderText, SendIcon, StatusPill, StepHeading } from "./reviewUi.tsx";
import type { Decision, HealthStatus, ReviewSnapshot } from "../types.ts";

const STATUS_COPY: Record<Exclude<HealthStatus, "ready">, { title: string; detail: string; tone: "good" | "info" | "bad" }> = {
  model_missing: { title: "Model missing", detail: "Pattern checks still run", tone: "info" },
  offline: { title: "Offline", detail: "Pattern checks still run", tone: "bad" },
  backend_off: { title: "Checker error", detail: "The local checker hit an error", tone: "bad" },
};

function isChatGptUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
  } catch {
    return false;
  }
}

type PromptPanelProps = {
  extension: boolean;
  status: HealthStatus | null;
  review: ReviewSnapshot | null;
  redacting: boolean;
  onToggleFinding: (id: string, keep: boolean) => void;
  onDecide: (decision: Decision) => void;
};

export function PromptPanel({ extension, status, review, redacting, onToggleFinding, onDecide }: PromptPanelProps) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [onChatGpt, setOnChatGpt] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scanning = review?.phase === "scanning";

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!extension) return;
    let cancelled = false;

    const applyTab = (url: string | undefined) => {
      if (!cancelled) setOnChatGpt(isChatGptUrl(url));
    };

    const refresh = () => {
      void chrome.windows.getCurrent().then((window) =>
        chrome.tabs.query({ active: true, windowId: window.id }).then((tabs) => applyTab(tabs[0]?.url)),
      );
    };

    refresh();

    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      void chrome.tabs.get(info.tabId).then((tab) => applyTab(tab.url));
    };
    const onUpdated = (_tabId: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (!tab.active) return;
      if (info.url !== undefined || info.status === "complete") applyTab(tab.url);
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [extension]);

  useEffect(() => {
    if (!scanning) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [scanning, review?.text]);

  const checkerStatus = !online
    ? { title: "No internet", detail: "ChatGPT needs a connection", tone: "bad" as const }
    : status && status !== "ready"
      ? STATUS_COPY[status]
      : { title: "Ready", detail: "ChatGPT tab is open", tone: "good" as const };

  const redactStatus =
    status === "model_missing" || status === "offline" || status === "backend_off"
      ? STATUS_COPY[status]
      : { title: "Ready", detail: "Works in offline mode", tone: "info" as const };

  const showContext = review?.phase === "scanning" && now - review.startedAt > 400;
  const checkingLine = review?.phase === "scanning" ? (showContext ? "Checking context with local AI…" : "Checking the prompt…") : null;

  return (
    <main className="panel">
      <header className="brand-header">
        <img src="/icons/icon32.png" alt="" width="32" height="32" />
        <div>
          <strong>Warden</strong>
          <p>Your data. Your control.</p>
        </div>
      </header>
      <div hidden={onChatGpt}>
        <RedactTool status={redactStatus} />
      </div>

      {onChatGpt ? (
        <div className={online ? "sheet" : "sheet checker-disabled"}>
          <section className="intro">
            <div className="intro-row">
              <h1>ChatGPT Guard</h1>
              <StatusPill title={checkerStatus.title} detail={checkerStatus.detail} tone={checkerStatus.tone} />
            </div>
            <p>Review and protect your prompt before sending to ChatGPT.</p>
          </section>

          {checkingLine ? <BusyLine label={checkingLine} /> : null}

          {review?.phase === "scanning" ? (
            <section className="card">
              <StepHeading step={1} title="Your prompt" hint="This prompt is being checked before it is sent." aside={<Count n={review.text.length} />} />
              <div className="text-box">
                <p className="plain-text">{review.text}</p>
              </div>
              <div className="actions">
                <button type="button" className="button button-ghost" onClick={() => onDecide("cancel")}>
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {review?.phase === "error" || (review && review.phase === "ready" && !review.scan) ? (
            <section className="card">
              <p className="form-error" role="alert">
                {review.error ?? "The scan did not finish."}
              </p>
              <div className="text-box">
                <p className="plain-text">{review.text}</p>
              </div>
              <div className="actions">
                <button type="button" className="button button-ghost" onClick={() => onDecide("cancel")}>
                  Close
                </button>
              </div>
            </section>
          ) : null}

          {review?.phase === "ready" && review.scan ? (
            <ReadyReview review={review} redacting={redacting} disabled={!online} onToggleFinding={onToggleFinding} onDecide={onDecide} />
          ) : null}

          {!review ? (
            <p className="empty-note">
              A prompt with nothing sensitive is sent automatically. Sensitive details are held here for review.
              {!extension ? " Load the unpacked extension from dist, then open this panel from the toolbar." : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function ReadyReview({
  review,
  redacting,
  disabled,
  onToggleFinding,
  onDecide,
}: {
  review: ReviewSnapshot;
  redacting: boolean;
  disabled: boolean;
  onToggleFinding: (id: string, keep: boolean) => void;
  onDecide: (decision: Decision) => void;
}) {
  const scan = review.scan;
  if (!scan) return null;
  const action = scan.recommendedAction;
  const findings = scan.findings;
  const busy = redacting || disabled;

  if (action === "redact_and_review") {
    return (
      <>
        <section className="card">
          <StepHeading
            step={1}
            title="Your prompt"
            hint="Checked items below are replaced before this prompt is sent."
            aside={<Count n={review.text.length} />}
          />
          <div className="text-box">
            <p className="plain-text">
              <HighlightedText text={review.text} findings={findings} keptIds={review.keptIds} />
            </p>
          </div>
        </section>

        <section className="card">
          <StepHeading
            step={2}
            title="Detected information"
            hint="Review the detected items. Checked items will be replaced with placeholders."
            aside={
              <span className="findings-count">
                {findings.length} {findings.length === 1 ? "finding" : "findings"}
              </span>
            }
          />
          <FindingRows findings={findings} keptIds={review.keptIds} disabled={busy} onToggle={onToggleFinding} />
          {review.redactError ? (
            <p className="form-error" role="alert">
              {review.redactError}
            </p>
          ) : null}
        </section>

        <section className="card">
          <StepHeading step={3} title="Preview" hint="This is the text with sensitive information replaced." />
          <div className="preview-box preview-blue">
            {review.redactedText ? <PlaceholderText text={review.redactedText} tone="blue" /> : <p className="preview-text">The redacted draft is still being prepared.</p>}
          </div>
          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy || review.redactedText === null}
              onClick={() => onDecide("send_redacted")}
            >
              <SendIcon />
              Send to ChatGPT
            </button>
            <button type="button" className="button button-ghost" onClick={() => onDecide("cancel")}>
              Cancel
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="card">
      {action === "warn" ? <p className="note note-warn">A low-sensitivity match was found. You can send the original draft.</p> : null}
      {action === "block" ? <p className="note note-block">This prompt will not be sent.</p> : null}
      {action === "allow" ? <p className="empty-note">Nothing sensitive was found. Send the original draft.</p> : null}
      <StepHeading step={1} title="Your prompt" aside={<Count n={review.text.length} />} />
      <div className="text-box">
        <p className="plain-text">
          <HighlightedText text={review.text} findings={findings} />
        </p>
      </div>
      {findings.length > 0 ? (
        <>
          <div className="section-gap" />
          <StepHeading
            step={2}
            title="Detected information"
            aside={
              <span className="findings-count">
                {findings.length} {findings.length === 1 ? "finding" : "findings"}
              </span>
            }
          />
          <FindingRows findings={findings} />
        </>
      ) : null}
      <div className="actions">
        {action === "allow" ? (
          <button type="button" className="button button-primary" disabled={disabled} onClick={() => onDecide("send_original")}>
            <SendIcon />
            Send
          </button>
        ) : null}
        {action === "warn" ? (
          <button type="button" className="button button-primary" disabled={disabled} onClick={() => onDecide("send_original")}>
            <SendIcon />
            Send anyway
          </button>
        ) : null}
        <button type="button" className="button button-ghost" onClick={() => onDecide("cancel")}>
          {action === "block" ? "Close" : "Cancel"}
        </button>
      </div>
    </section>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="char-count">
      {n} {n === 1 ? "character" : "characters"}
    </span>
  );
}

function BusyLine({ label }: { label: string }) {
  return (
    <p className="status-line checking" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}
