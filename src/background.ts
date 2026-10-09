import { fetchHealthStatus, panelErrorMessage, redactPrompt, scanPrompt } from "./api.ts";
import { hasPatternFindings } from "./localScan.ts";
import { isExtensionMessage } from "./messages.ts";
import type { Decision, HealthStatus, ReviewSnapshot } from "./types.ts";

const BADGE: Record<HealthStatus, { text: string; color: string; title: string }> = {
  ready: {
    text: "",
    color: "#12B76A",
    title: "Warden · Ready",
  },
  model_missing: {
    text: "!",
    color: "#2F6FED",
    title: "Warden · The local model is not installed",
  },
  offline: {
    text: "!",
    color: "#F04438",
    title: "Warden · Ollama is not reachable on port 11434",
  },
  backend_off: {
    text: "!",
    color: "#98A2B3",
    title: "Warden · Ollama returned an error",
  },
};

let health: HealthStatus = "backend_off";
const useAi = true;
let generation = 0;
let redactGeneration = 0;
let review: ReviewSnapshot | null = null;
let reviewTabId: number | undefined;
let scanController: AbortController | null = null;
let committedKeptIds: string[] = [];
let committedText: string | null = null;

function broadcast(message: { type: "HEALTH_STATUS"; status: HealthStatus } | { type: "REVIEW_UPDATE"; review: ReviewSnapshot | null }): void {
  void chrome.runtime.sendMessage(message).catch(() => {
    // The side panel is not open.
  });
}

async function refreshHealth(): Promise<HealthStatus> {
  health = await fetchHealthStatus();
  await applyBadge(health);
  broadcast({ type: "HEALTH_STATUS", status: health });
  return health;
}

async function applyBadge(status: HealthStatus): Promise<void> {
  if (!navigator.onLine) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#F04438" });
    await chrome.action.setTitle({ title: "Warden · No internet" });
    return;
  }
  const badge = BADGE[status];
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setTitle({ title: badge.title });
}

async function openReviewPanel(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;

  try {
    await chrome.sidePanel.setOptions({ tabId, path: "index.html", enabled: true });
    await chrome.sidePanel.open({ tabId });
    return true;
  } catch {
    await chrome.action.setTitle({
      title: "Warden · A prompt is waiting. Open the side panel to review it.",
    });
    return false;
  }
}

async function notifyTab(tabId: number | undefined, message: { type: "CHECK_BUSY" } | { type: "CHECK_SETTLED"; review: boolean }): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The page bridge is attached on the next ChatGPT load.
  }
}

async function focusChatGptPage(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tabId, { active: true });
  // The side panel holds keyboard focus, so a paste into ChatGPT is ignored until the panel closes.
  try {
    await chrome.sidePanel.close({ tabId });
  } catch {
    // The panel is already closed.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function restoreSidePanel(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({ tabId, path: "index.html", enabled: true });
}

async function releaseTab(tabId: number | undefined, action: Decision, text: string): Promise<boolean> {
  if (tabId === undefined) return false;
  let panelClosed = false;
  if (action === "send_redacted") {
    try {
      await focusChatGptPage(tabId);
      panelClosed = true;
    } catch {
      // The paste still runs. It succeeds once the ChatGPT page has focus.
    }
  }
  let replaced = action !== "send_redacted";
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["page-hook.js"],
      world: "MAIN",
      injectImmediately: true,
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      injectImmediately: true,
      args: [action, text],
      func: (nextAction: string, nextText: string) => {
        const apply = (window as unknown as {
          __promptshieldApply?: (action: string, text: string) => boolean | Promise<boolean>;
        }).__promptshieldApply;
        if (typeof apply !== "function") return false;
        return apply(nextAction, nextText);
      },
    });
    replaced = result?.result === true;
  } catch {
    replaced = false;
  }
  if (panelClosed) {
    try {
      await restoreSidePanel(tabId);
    } catch {
      // The manifest side panel path stays available from the toolbar icon.
    }
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "RELEASE", action, text });
  } catch {
    // The bridge only clears its hold. The page hook already applied the release.
  }
  return replaced;
}

async function beginReview(tabId: number | undefined, text: string): Promise<void> {
  if (reviewTabId !== undefined && reviewTabId !== tabId) {
    await releaseTab(reviewTabId, "cancel", "");
  }

  const current = ++generation;
  redactGeneration += 1;
  scanController?.abort();
  const controller = new AbortController();
  scanController = controller;

  if (current !== generation) return;

  reviewTabId = tabId;
  review = {
    text,
    phase: "scanning",
    useAi,
    startedAt: Date.now(),
    scan: null,
    redactedText: null,
    keptIds: [],
    error: null,
    redactError: null,
  };
  committedKeptIds = [];
  committedText = null;
  broadcast({ type: "REVIEW_UPDATE", review });
  void notifyTab(tabId, { type: "CHECK_BUSY" });
  void refreshHealth();

  try {
    const scan = await scanPrompt(text, useAi, controller.signal);
    if (current !== generation) return;
    if (scan.findings.length === 0) {
      review = null;
      reviewTabId = undefined;
      committedKeptIds = [];
      committedText = null;
      broadcast({ type: "REVIEW_UPDATE", review });
      await releaseTab(tabId, "send_original", text);
      return;
    }
    const keptIds = scan.findings.map((finding) => finding.id);
    review = {
      text,
      phase: "ready",
      useAi,
      startedAt: review.startedAt,
      scan,
      redactedText: scan.redactedText,
      keptIds,
      error: null,
      redactError: null,
    };
    committedKeptIds = keptIds;
    committedText = scan.redactedText;
  } catch (error) {
    if (current !== generation) return;
    review = {
      ...(review as ReviewSnapshot),
      phase: "error",
      error: panelErrorMessage(error),
    };
  }

  if (current !== generation || !review) return;
  broadcast({ type: "REVIEW_UPDATE", review });
  await openReviewPanel(tabId);
  await notifyTab(tabId, { type: "CHECK_SETTLED", review: false });
}

async function updateKept(ids: string[]): Promise<void> {
  const current = generation;
  const requestId = ++redactGeneration;
  const snapshot = review;
  if (!snapshot?.scan || snapshot.phase !== "ready") return;

  const findings = snapshot.scan.findings
    .filter((finding) => ids.includes(finding.id))
    .map((finding) => ({ start: finding.start, end: finding.end, category: finding.category }));

  try {
    const redactedText = await redactPrompt(snapshot.text, findings);
    if (current !== generation || requestId !== redactGeneration || !review) return;
    committedKeptIds = ids;
    committedText = redactedText;
    review = { ...review, keptIds: ids, redactedText, redactError: null };
  } catch (error) {
    if (current !== generation || requestId !== redactGeneration || !review) return;
    review = {
      ...review,
      keptIds: committedKeptIds,
      redactedText: committedText,
      redactError: panelErrorMessage(error),
    };
  }

  broadcast({ type: "REVIEW_UPDATE", review });
}

async function decide(decision: Decision): Promise<void> {
  const snapshot = review;
  const tabId = reviewTabId;
  const text = decision === "send_redacted" ? snapshot?.redactedText ?? snapshot?.text ?? "" : snapshot?.text ?? "";
  if (decision === "send_redacted" && !snapshot?.redactedText) return;

  generation += 1;
  redactGeneration += 1;
  scanController?.abort();
  scanController = null;
  review = null;
  reviewTabId = undefined;
  committedKeptIds = [];
  committedText = null;
  broadcast({ type: "REVIEW_UPDATE", review });
  const replaced = await releaseTab(tabId, decision, text);
  if (decision === "send_redacted" && !replaced && snapshot) {
    review = {
      ...snapshot,
      phase: "ready",
      redactError: "The prompt box could not be cleared and the redacted draft could not be pasted. Refresh ChatGPT, then press Send to ChatGPT again.",
    };
    reviewTabId = tabId ?? undefined;
    committedKeptIds = snapshot.keptIds;
    committedText = snapshot.redactedText;
    broadcast({ type: "REVIEW_UPDATE", review });
    if (tabId !== undefined) {
      try {
        await chrome.sidePanel.open({ tabId });
      } catch {
        // The restored review is waiting the next time the panel opens.
      }
    }
  }
}

function ensureAlarm(): void {
  void chrome.alarms.create("health", { periodInMinutes: 0.5 });
}

const CHATGPT_MATCHES = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const HOOK_IDS = ["promptshield-hook", "promptshield-bridge"];

async function injectHooks(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page-hook.js"],
    world: "MAIN",
    injectImmediately: true,
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page-bridge.js"],
    world: "ISOLATED",
    injectImmediately: true,
  });
}

async function ensurePageHooks(): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const stale = registered.filter((script) => HOOK_IDS.includes(script.id)).map((script) => script.id);
  if (stale.length > 0) await chrome.scripting.unregisterContentScripts({ ids: stale });

  await chrome.scripting.registerContentScripts([
    {
      id: "promptshield-hook",
      matches: CHATGPT_MATCHES,
      js: ["page-hook.js"],
      world: "MAIN",
      runAt: "document_start",
      persistAcrossSessions: true,
    },
    {
      id: "promptshield-bridge",
      matches: CHATGPT_MATCHES,
      js: ["page-bridge.js"],
      world: "ISOLATED",
      runAt: "document_start",
      persistAcrossSessions: true,
    },
  ]);

  const tabs = await chrome.tabs.query({ url: CHATGPT_MATCHES });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await injectHooks(tab.id);
      } catch {
        // The tab navigated away before the hook could attach.
      }
    }),
  );
}

function enableSidePanel(): void {
  void chrome.sidePanel.setOptions({ path: "index.html", enabled: true });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  ensureAlarm();
  void refreshHealth();
  void ensurePageHooks();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  ensureAlarm();
  void refreshHealth();
  void ensurePageHooks();
});

function isChatGptUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com");
  } catch {
    return false;
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || !isChatGptUrl(tab.url)) return;
  void injectHooks(tabId).catch(() => {
    // The page hook is already registered for the next navigation.
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "health") void refreshHealth();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isExtensionMessage(message)) return;

  if (message.type === "GET_HEALTH") {
    void refreshHealth().then((status) => sendResponse({ status }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    sendResponse({ useAi: true });
    return;
  }

  if (message.type === "SET_USE_AI") {
    sendResponse({ useAi: true });
    return;
  }

  if (message.type === "OPEN_PANEL") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      void chrome.sidePanel.open({ tabId }).catch(() => {
        void chrome.sidePanel
          .setOptions({ tabId, path: "index.html", enabled: true })
          .then(() => chrome.sidePanel.open({ tabId }));
      });
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "GET_REVIEW") {
    sendResponse({ review });
    return;
  }

  if (message.type === "PROMPT_HELD") {
    const tabId = sender.tab?.id;
    const text = message.text.trim();
    if (tabId !== undefined && hasPatternFindings(text)) void chrome.sidePanel.open({ tabId });
    void beginReview(tabId, text);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "SET_KEPT_FINDINGS") {
    void updateKept(message.ids).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "DECIDE") {
    void decide(message.decision).then(() => sendResponse({ ok: true }));
    return true;
  }
});

enableSidePanel();
self.addEventListener("online", () => {
  void refreshHealth();
});
self.addEventListener("offline", () => {
  void refreshHealth();
});

ensureAlarm();
void refreshHealth();
void ensurePageHooks();
