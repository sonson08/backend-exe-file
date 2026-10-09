(function () {
  if (globalThis.__promptshieldBridge) return;
  globalThis.__promptshieldBridge = true;

  let pending = false;
  let heldAt = 0;

  const style = document.createElement("style");
  style.textContent = [
    "#promptshield-busy {",
    "  position: fixed; z-index: 2147483646; left: 50%; bottom: 24px; transform: translateX(-50%);",
    "  display: flex; align-items: center; gap: 8px; padding: 10px 14px;",
    "  border-radius: 999px; background: #fff; color: #1c2430;",
    "  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.16); font: 13px/1.2 'Segoe UI', system-ui, sans-serif;",
    "}",
    "#promptshield-busy .promptshield-spin {",
    "  width: 14px; height: 14px; border: 2px solid #d0d5dd; border-top-color: #12b76a;",
    "  border-radius: 50%; animation: promptshield-spin 0.7s linear infinite;",
    "}",
    "@keyframes promptshield-spin { to { transform: rotate(360deg); } }",
  ].join("");
  document.documentElement.appendChild(style);

  function hideNote(id) {
    const node = document.getElementById(id);
    if (node) node.remove();
  }

  function showBusy() {
    if (document.getElementById("promptshield-busy")) return;
    const node = document.createElement("div");
    node.id = "promptshield-busy";
    node.setAttribute("role", "status");
    const spin = document.createElement("span");
    spin.className = "promptshield-spin";
    spin.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "Checking prompt";
    node.append(spin, label);
    document.documentElement.appendChild(node);
  }

  function isSendControl(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest("button, [role='button']");
    if (!(control instanceof HTMLElement)) return false;
    const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-testid") || ""} ${control.id}`;
    if (/dictat|voice|microphone|transcri|\bstop\b|feedback/i.test(label)) return false;
    if (control.id === "composer-submit-button") return true;
    if (/send-button|composer-submit-button/i.test(control.getAttribute("data-testid") || "")) return true;
    if (/^send(\s+(prompt|message))?$/i.test((control.getAttribute("aria-label") || "").trim())) return true;
    return control instanceof HTMLButtonElement && control.type === "submit";
  }

  function composerText() {
    const fields = document.querySelectorAll(
      "#prompt-textarea, #mobile-composer-prompt, textarea[name='prompt'], .ProseMirror[contenteditable='true'], [contenteditable='true'][role='textbox']",
    );
    let best = "";
    for (const field of fields) {
      if (!(field instanceof HTMLElement)) continue;
      const value = field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement ? field.value : field.innerText || "";
      const trimmed = value.trim();
      if (trimmed.length > best.length) best = trimmed;
    }
    return best;
  }

  function holdText(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (pending && performance.now() - heldAt < 800) return;
    pending = true;
    heldAt = performance.now();
    showBusy();
    chrome.runtime.sendMessage({ type: "PROMPT_HELD", text: trimmed }).catch(() => {
      pending = false;
      hideNote("promptshield-busy");
    });
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isSendControl(event.target)) return;
      holdText(composerText());
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("#prompt-textarea, #mobile-composer-prompt, textarea, [contenteditable='true']")) return;
      holdText(composerText());
    },
    true,
  );

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "promptshield-page" || data.type !== "hold" || typeof data.text !== "string") return;
    holdText(data.text);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;
    if (message.type === "CHECK_BUSY") {
      showBusy();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "CHECK_SETTLED") {
      hideNote("promptshield-busy");
      sendResponse({ ok: true });
      return;
    }
    if (message.type !== "RELEASE") return;
    if (message.action !== "send_original" && message.action !== "send_redacted" && message.action !== "cancel") return;
    if (typeof message.text !== "string") return;
    pending = false;
    heldAt = 0;
    hideNote("promptshield-busy");
    sendResponse({ ok: true });
  });
})();
