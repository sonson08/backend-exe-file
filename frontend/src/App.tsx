import { useEffect, useRef, useState } from "react";
import { PromptPanel } from "./components/PromptPanel.tsx";
import { isExtensionMessage } from "./messages.ts";
import type { Decision, HealthStatus, ReviewSnapshot } from "./types.ts";
import { isHealthStatus, isReviewSnapshot } from "./types.ts";

function runningAsExtension(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function readReview(response: unknown): ReviewSnapshot | null | undefined {
  if (typeof response !== "object" || response === null || !("review" in response)) return undefined;
  const { review } = response;
  if (review === null) return null;
  return isReviewSnapshot(review) ? review : undefined;
}

export default function App() {
  const extension = runningAsExtension();
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const [redacting, setRedacting] = useState(false);
  const keptRef = useRef<string[]>([]);
  keptRef.current = review?.keptIds ?? [];

  useEffect(() => {
    if (!extension) return;

    const onMessage = (message: unknown) => {
      if (!isExtensionMessage(message)) return;
      if (message.type === "HEALTH_STATUS") setStatus(message.status);
      if (message.type === "REVIEW_UPDATE") {
        setReview(message.review);
        setRedacting(false);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);

    void chrome.runtime.sendMessage({ type: "GET_HEALTH" }).then((response: unknown) => {
      if (
        typeof response === "object" &&
        response !== null &&
        "status" in response &&
        isHealthStatus(response.status)
      ) {
        setStatus(response.status);
      }
    });

    void chrome.runtime.sendMessage({ type: "GET_REVIEW" }).then((response: unknown) => {
      const next = readReview(response);
      if (next !== undefined) setReview(next);
    });

    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [extension]);

  const applyKept = (keptIds: string[]) => {
    keptRef.current = keptIds;
    setReview((currentReview) => (currentReview ? { ...currentReview, keptIds, redactError: null } : currentReview));
    if (!extension) return;
    setRedacting(true);
    void chrome.runtime.sendMessage({ type: "SET_KEPT_FINDINGS", ids: keptIds }).catch(() => {
      setRedacting(false);
    });
  };

  const onToggleFinding = (id: string, keep: boolean) => {
    const current = keptRef.current;
    const keptIds = keep ? (current.includes(id) ? current : [...current, id]) : current.filter((keptId) => keptId !== id);
    applyKept(keptIds);
  };

  const onDecide = (decision: Decision) => {
    if (!extension) return;
    void chrome.runtime.sendMessage({ type: "DECIDE", decision });
  };

  return (
    <PromptPanel
      extension={extension}
      status={status}
      review={review}
      redacting={redacting}
      onToggleFinding={onToggleFinding}
      onDecide={onDecide}
    />
  );
}
