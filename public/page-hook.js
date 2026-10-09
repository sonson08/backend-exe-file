(function () {
  // A previous extension reload leaves this hook alive in the page. Drop that copy before installing the new one.
  window.dispatchEvent(new Event("promptshield-reset"));

  const listeners = [];
  const on = (type, fn, capture) => {
    window.addEventListener(type, fn, capture);
    listeners.push({ type, fn, capture });
  };

  window.addEventListener("promptshield-reset", function reset() {
    window.removeEventListener("promptshield-reset", reset);
    for (const listener of listeners) window.removeEventListener(listener.type, listener.fn, listener.capture);
  });

  const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "#mobile-composer-prompt",
    "textarea[name='prompt-textarea']",
    "textarea[name='prompt']",
    ".ProseMirror[contenteditable='true']",
    "[class*='prosemirror' i] [contenteditable='true']",
    "[contenteditable='true'][role='textbox']",
    "[class*='prosemirror' i][contenteditable='true']",
    "form textarea",
    "form [contenteditable='true']",
  ].join(", ");

  let releasing = false;
  let lastComposer = window.__promptshieldComposer && window.__promptshieldComposer.isConnected ? window.__promptshieldComposer : null;

  function activeRewrite() {
    return window.__promptshieldRewrite || null;
  }

  function clearRewrite() {
    window.__promptshieldRewrite = null;
  }

  if (!window.__promptshieldNetwork) {
    window.__promptshieldNetwork = true;
    const nativeFetch = window.fetch;
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__promptshieldUrl = String(url || "");
      return nativeOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (typeof body === "string" && conversationUrl(this.__promptshieldUrl)) body = rewritePayload(body);
      return nativeSend.call(this, body);
    };
    window.fetch = function (input, init) {
      if (typeof Request !== "undefined" && input instanceof Request && (!init || init.body == null) && conversationUrl(input.url)) {
        return input.clone().text().then((body) => {
          const headers = new Headers(input.headers);
          return nativeFetch.call(this, input.url, {
            method: input.method,
            headers,
            body: rewritePayload(body),
            credentials: input.credentials,
            mode: input.mode,
            cache: input.cache,
            redirect: input.redirect,
            referrer: input.referrer,
          });
        });
      }
      const rewritten = rewriteRequest(input, init);
      return nativeFetch.call(this, rewritten.input, rewritten.init);
    };
  }

  function conversationUrl(input) {
    const url = typeof input === "string" ? input : input && input.url;
    return typeof url === "string" && /\/conversation(?:\/|\?|$)/.test(url);
  }

  function replacePrompt(value, from, to) {
    if (typeof value === "string") {
      if (samePrompt(value, from)) return { value: to, changed: true };
      if (from.length >= 8 && value.includes(from)) return { value: value.split(from).join(to), changed: true };
      return { value, changed: false };
    }
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((item) => {
        const replaced = replacePrompt(item, from, to);
        changed = changed || replaced.changed;
        return replaced.value;
      });
      return { value: next, changed };
    }
    if (value && typeof value === "object") {
      let changed = false;
      const next = {};
      for (const key of Object.keys(value)) {
        const replaced = replacePrompt(value[key], from, to);
        changed = changed || replaced.changed;
        next[key] = replaced.value;
      }
      return { value: next, changed };
    }
    return { value, changed: false };
  }

  function rewritePayload(body) {
    const pending = activeRewrite();
    if (!pending || typeof body !== "string") return body;
    try {
      const replaced = replacePrompt(JSON.parse(body), pending.from, pending.to);
      if (!replaced.changed) return body;
      clearRewrite();
      return JSON.stringify(replaced.value);
    } catch {
      if (pending.from.length >= 8 && body.includes(pending.from)) {
        clearRewrite();
        return body.split(pending.from).join(pending.to);
      }
      return body;
    }
  }

  function rewriteRequest(input, init) {
    if (!activeRewrite() || !conversationUrl(input)) return { input, init };
    if (typeof FormData !== "undefined" && init && init.body instanceof FormData) {
      const pending = activeRewrite();
      const prompt = init.body.get("prompt");
      if (pending && typeof prompt === "string" && (samePrompt(prompt, pending.from) || prompt.includes(pending.from))) {
        init.body.set("prompt", samePrompt(prompt, pending.from) ? pending.to : prompt.split(pending.from).join(pending.to));
        clearRewrite();
      }
      return { input, init };
    }
    if (init && typeof init.body === "string") {
      return { input, init: { ...init, body: rewritePayload(init.body) } };
    }
    return { input, init };
  }

  function shown(element, minWidth, minHeight) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= minWidth && rect.height >= minHeight;
  }

  function visible(element) {
    return shown(element, 80, 12);
  }

  function composers() {
    return [...document.querySelectorAll(COMPOSER_SELECTOR)].filter(visible);
  }

  function readComposer(composer) {
    if (!(composer instanceof HTMLElement)) return "";
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return composer.value;
    return composer.innerText || composer.textContent || "";
  }

  function composerFrom(target) {
    const list = composers();
    if (target instanceof Element) {
      const direct = list.find((composer) => composer === target || composer.contains(target));
      if (direct) return direct;
      const form = target.closest("form");
      if (form) {
        const inForm = list
          .filter((composer) => form.contains(composer))
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        if (inForm) return inForm;
      }
    }
    return list.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] ?? null;
  }

  function isSendControl(target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest("button, [role='button']");
    if (!(control instanceof HTMLElement) || !shown(control, 16, 16)) return false;
    const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("data-testid") || ""} ${control.id}`;
    if (/dictat|voice|microphone|transcri|\bstop\b|feedback/i.test(label)) return false;
    if (control.id === "composer-submit-button") return true;
    if (/send-button|composer-submit-button/i.test(control.getAttribute("data-testid") || "")) return true;
    if (/^send(\s+(prompt|message))?$/i.test(control.getAttribute("aria-label") || "")) return true;
    if (control instanceof HTMLButtonElement && control.type === "submit") {
      const form = control.closest("form");
      return form instanceof HTMLFormElement && composers().some((composer) => form.contains(composer));
    }
    return false;
  }

  function hold(event, composer) {
    if (releasing) return;
    const text = readComposer(composer).trim();
    if (!text) return;
    lastComposer = composer;
    window.__promptshieldComposer = composer;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    window.postMessage({ source: "promptshield-page", type: "hold", text }, window.location.origin);
  }

  function onKey(event) {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.isComposing) return;
    const composer = composerFrom(event.target);
    if (!composer || !(event.target instanceof Node) || !composer.contains(event.target)) return;
    hold(event, composer);
  }

  function onPointer(event) {
    if (!isSendControl(event.target)) return;
    const composer = composerFrom(event.target) || lastComposer;
    if (composer) hold(event, composer);
  }

  function onSubmit(event) {
    const composer = composerFrom(event.target);
    if (composer) hold(event, composer);
  }

  function plainText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim();
  }

  function samePrompt(left, right) {
    return plainText(left).replace(/\s+/g, " ") === plainText(right).replace(/\s+/g, " ");
  }

  function viewFromValue(value) {
    if (!value || !value.state || !value.state.doc || typeof value.dispatch !== "function" || !value.dom) return null;
    return value;
  }

  function viewFromNode(node) {
    const described = node && node.pmViewDesc && node.pmViewDesc.view;
    if (viewFromValue(described)) return described;
    if (!node) return null;
    const names = Object.getOwnPropertyNames(node);
    for (const name of names) {
      let value;
      try {
        value = node[name];
      } catch {
        continue;
      }
      if (viewFromValue(value)) return value;
      if (value && viewFromValue(value.view)) return value.view;
    }
    return null;
  }

  function viewFromFiber(node) {
    const key = node ? Object.keys(node).find((name) => name.startsWith("__reactFiber") || name.startsWith("__reactInternalInstance")) : "";
    let fiber = key ? node[key] : null;
    let steps = 0;
    while (fiber && steps < 40) {
      steps += 1;
      let hook = fiber.memoizedState;
      let hooks = 0;
      while (hook && hooks < 30) {
        hooks += 1;
        const value = hook.memoizedState;
        const editor = value && value.current && value.current.state && value.current.dom ? value.current : value;
        if (editor && editor.state && editor.state.doc && typeof editor.dispatch === "function" && editor.dom) return editor;
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function proseMirrorView(composer) {
    const described = (node) => {
      const view = node && node.pmViewDesc && node.pmViewDesc.view;
      return viewFromValue(view) ? view : null;
    };
    const direct = described(composer) || viewFromNode(composer) || viewFromFiber(composer);
    if (direct) return direct;
    if (!composer) return null;
    for (const node of composer.querySelectorAll("*")) {
      const view = described(node);
      if (view) return view;
    }
    let parent = composer.parentElement;
    for (let depth = 0; depth < 8 && parent; depth += 1) {
      const view = described(parent) || viewFromFiber(parent);
      if (view && (view.dom === composer || view.dom.contains(composer) || composer.contains(view.dom))) return view;
      parent = parent.parentElement;
    }
    return null;
  }

  function editorText(view) {
    return view.state.doc.textBetween(0, view.state.doc.content.size, "\n", "\n");
  }

  function textBlock(schema) {
    const nodes = schema.nodes;
    if (!nodes) return null;
    if (nodes.paragraph) return nodes.paragraph;
    if (typeof nodes.get === "function" && nodes.get("paragraph")) return nodes.get("paragraph");
    return Object.values(nodes).find((node) => node && node.isTextblock) ?? null;
  }

  function transactionFor(view, flat) {
    const size = view.state.doc.content.size;
    if (size >= 2) return view.state.tr.insertText(flat, 1, Math.max(1, size - 1));
    const schema = view.state.schema;
    const paragraph = textBlock(schema);
    if (!paragraph) return null;
    const node = paragraph.create(null, flat ? schema.text(flat) : null);
    return view.state.tr.replaceWith(0, size, node);
  }

  function paragraphTransaction(view, flat) {
    const schema = view.state.schema;
    const paragraph = textBlock(schema);
    if (!paragraph) return null;
    const node = paragraph.create(null, flat ? schema.text(flat) : null);
    try {
      return view.state.tr.replaceWith(0, view.state.doc.content.size, node);
    } catch {
      return view.state.tr.replaceWith(0, view.state.doc.content.size, schema.topNodeType.create(null, [node]).content);
    }
  }

  function replaceProseMirror(view, text) {
    const flat = plainText(text).replace(/\s+/g, " ");
    try {
      const transaction = transactionFor(view, flat) || paragraphTransaction(view, flat);
      if (!transaction) return false;
      view.dispatch(transaction);
      if (samePrompt(editorText(view), flat)) return true;
    } catch {
      // A plugin rejected the change. Apply a full paragraph replace below.
    }
    try {
      const transaction = paragraphTransaction(view, flat);
      if (!transaction) return false;
      view.updateState(view.state.apply(transaction));
      return samePrompt(editorText(view), flat);
    } catch {
      return false;
    }
  }

  function replaceField(composer, text) {
    const prototype = composer instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return false;
    const previous = composer.value;
    setter.call(composer, text);
    if (composer._valueTracker) composer._valueTracker.setValue(previous);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: text }));
    return composer.value === text;
  }

  function adoptDomText(composer, text) {
    const flat = plainText(text).replace(/\s+/g, " ");
    const block = composer.querySelector("p") || composer;
    block.textContent = flat;
    const view = proseMirrorView(composer);
    try {
      if (view && view.domObserver && typeof view.domObserver.flush === "function") view.domObserver.flush();
    } catch {
      // The editor can still be read from the updated text.
    }
    let current = readComposer(composer);
    if (view) {
      try {
        current = editorText(view);
      } catch {
        current = readComposer(composer);
      }
    }
    return samePrompt(current, flat);
  }

  function replaceEditable(composer, text) {
    const view = proseMirrorView(composer);
    if (view) {
      try {
        if (replaceProseMirror(view, text)) return true;
      } catch {
        // The editor rejected that transaction. Fall through to a selection replace.
      }
    }

    window.focus();
    try {
      composer.focus();
    } catch {
      // A selection replace can still run when focus is refused.
    }
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("selectAll", false, null);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    if (!document.execCommand("insertText", false, lines[0])) return false;
    for (let index = 1; index < lines.length; index += 1) {
      document.execCommand("insertParagraph", false, null);
      if (lines[index]) document.execCommand("insertText", false, lines[index]);
    }
    return samePrompt(submissionText(composer), text);
  }

  function submissionText(composer) {
    const view = proseMirrorView(composer);
    if (view) {
      try {
        return editorText(view);
      } catch {
        // The editor state could not be read. Use the visible text.
      }
    }
    return readComposer(composer);
  }

  function clearAndPaste(composer, text) {
    window.focus();
    try {
      composer.focus();
    } catch {
      // The selection can still be replaced when focus is refused.
    }

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      composer.select();
      if (document.hasFocus() && document.execCommand("insertText", false, text) && samePrompt(composer.value, text)) return true;
      return replaceField(composer, text);
    }

    // Pasting needs the ChatGPT page itself to be focused. The side panel is closed first so this can run.
    if (!document.hasFocus()) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("selectAll", false, null);
    if (document.execCommand("insertText", false, text) && (samePrompt(submissionText(composer), text) || samePrompt(readComposer(composer), text))) {
      return true;
    }
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    if (!document.execCommand("insertText", false, text)) return false;
    return samePrompt(submissionText(composer), text) || samePrompt(readComposer(composer), text);
  }

  function writeComposer(composer, text) {
    if (clearAndPaste(composer, text)) return true;

    const view = proseMirrorView(composer);
    if (view) {
      try {
        if (replaceProseMirror(view, text) && samePrompt(editorText(view), text)) return true;
      } catch {
        // Fall through. A focused selection replace can still update the editor.
      }
    }

    const form = composer.closest("form");
    const fields = form ? [...form.querySelectorAll("textarea, input[name='prompt']")] : [];
    for (const field of fields) {
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) replaceField(field, text);
    }
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return replaceField(composer, text) && samePrompt(composer.value, text);
    }
    if (replaceEditable(composer, text) && samePrompt(submissionText(composer), text)) return true;
    if (proseMirrorView(composer)) return false;
    return adoptDomText(composer, text);
  }

  function findSendButton() {
    return [...document.querySelectorAll("button, [role='button']")].find((element) => isSendControl(element)) ?? null;
  }

  function clickSend() {
    const started = performance.now();
    const tick = () => {
      const button = findSendButton();
      if (button instanceof HTMLElement) {
        releasing = true;
        button.click();
        window.setTimeout(() => {
          releasing = false;
        }, 1000);
        return;
      }
      if (performance.now() - started > 1000) return;
      window.setTimeout(tick, 50);
    };
    tick();
  }

  function composerForRelease() {
    const saved = window.__promptshieldComposer;
    if (saved && saved.isConnected) return saved;
    const remembered = lastComposer && lastComposer.isConnected ? lastComposer : null;
    if (remembered) return remembered;
    const prompt = document.querySelector("#prompt-textarea");
    if (prompt instanceof HTMLElement && (prompt.isContentEditable || prompt instanceof HTMLTextAreaElement) && readComposer(prompt).trim()) return prompt;
    const mobile = document.querySelector("#mobile-composer-prompt");
    if (mobile instanceof HTMLElement && readComposer(mobile).trim()) return mobile;
    const filled = composers()
      .map((composer) => ({ composer, text: readComposer(composer).trim() }))
      .filter((item) => item.text)
      .sort((a, b) => b.text.length - a.text.length);
    if (filled[0]) return filled[0].composer;
    const button = findSendButton();
    let root = button instanceof HTMLElement ? button.parentElement : null;
    for (let depth = 0; depth < 6 && root; depth += 1) {
      const nearby = [...root.querySelectorAll("textarea, [contenteditable='true']")]
        .filter(visible)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
      if (nearby[0]) return nearby[0];
      root = root.parentElement;
    }
    return remembered || composerFrom(document.body);
  }

  function applyRelease(action, text) {
    if (action === "cancel") return Promise.resolve(true);
    const composer = composerForRelease();
    if (action !== "send_redacted") {
      if (!composer) return Promise.resolve(false);
      clickSend();
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const started = performance.now();
      const attempt = () => {
        const field = composerForRelease() || composer;
        if (field) {
          const original = plainText(submissionText(field));
          if (!window.__promptshieldRewrite && original && !samePrompt(original, text)) {
            window.__promptshieldRewrite = { from: original, to: text };
          }
          window.focus();
          try {
            field.focus();
          } catch {
            // The editor can still be updated through its document state.
          }
          if (writeComposer(field, text) && samePrompt(submissionText(field), text)) {
            clickSend();
            resolve(true);
            return;
          }
        }
        if (performance.now() - started > 2000) {
          clearRewrite();
          releasing = false;
          resolve(false);
          return;
        }
        window.setTimeout(attempt, 50);
      };
      attempt();
    });
  }

  function onRelease(event) {
    const data = event.data;
    if (!data || data.source !== "promptshield-ext" || data.type !== "release") return;
    applyRelease(data.action, typeof data.text === "string" ? data.text : "");
  }

  window.__promptshieldApply = applyRelease;

  on("keydown", onKey, true);
  on("keyup", onKey, true);
  on("pointerdown", onPointer, true);
  on("click", onPointer, true);
  on("submit", onSubmit, true);
  on("message", onRelease, false);
})();
