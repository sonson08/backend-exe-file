# Warden

**Your data. Your control.**

Warden is a Chrome extension that checks what you are about to send to ChatGPT and stops personal or sensitive information from leaving your computer. Everything runs locally: pattern checks run inside the extension, and the AI check uses a model running on your own machine through [Ollama](https://ollama.com). No prompt text is sent to any outside server by Warden.

It has two tools, picked automatically from the tab you are on:

- **ChatGPT Guard** (on chatgpt.com) catches prompts before they are sent, and lets you send a redacted version instead.
- **Text Redact** (on any other tab) redacts any text you paste in, and works even with no internet connection.

## How it works

### ChatGPT Guard

1. You press Send (or Enter) in ChatGPT. Warden holds the prompt and shows a small "Checking prompt" chip on the page.
2. The prompt is scanned locally in two passes:
   - **Pattern checks** (instant) look for things with a recognizable shape: emails, phone numbers, card numbers, government IDs, account numbers, transaction IDs, dates of birth, passwords and API keys, IP addresses, street addresses, and labelled names.
   - **AI check** (slower) asks the local Distil-PII model for things patterns miss, such as names in free text, ages, marital status, gender, and race or ethnicity.
3. If nothing is found, the prompt is sent as normal and the side panel never opens.
4. If something is found, the Warden side panel opens with:
   - the prompt, with every flagged part highlighted in red,
   - a list of findings with checkboxes, so you choose what to redact,
   - a **Preview** of the text with placeholders such as `[PERSON_1]` and `[EMAIL_1]`.
5. Press **Send to ChatGPT** to replace the prompt with the redacted version and send it, or go back and edit the original.

The same value always gets the same placeholder, so `[PERSON_1]` means the same person everywhere in the prompt.

The checker needs an internet connection (ChatGPT does), so it is disabled while you are offline.

### Text Redact

On any tab other than ChatGPT, the side panel shows Text Redact. Paste text, run the redaction, untick anything you want to keep, then copy the redacted text. Pattern checks need no network at all, so this works offline.

### Status

Each tool shows a status next to its title:

| Status | Meaning |
| --- | --- |
| Ready | Everything is working. |
| Model missing | Ollama is running but the model is not installed. Pattern checks still run. |
| Offline | Ollama is not reachable on port 11434. Pattern checks still run. |
| Checker error | Ollama is running but returned an error. |
| No internet | ChatGPT Guard is disabled until you are back online. |

## Requirements

- Google Chrome (or another Chromium browser that supports side panels)
- Node.js 20 or newer
- [Ollama](https://ollama.com), running on `http://127.0.0.1:11434`
- The Distil-PII model:

  ```bash
  ollama pull hf.co/mradermacher/Distil-PII-Llama-3.2-3B-Instruct-GGUF:Q4_K_M
  ```

Without Ollama or the model, Warden still works using pattern checks only.

## Setup

```bash
npm install
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Refresh any open ChatGPT tabs.

After changing the code, run `npm run build` again, press the reload button on Warden in `chrome://extensions`, and refresh ChatGPT.

## Project structure

| Path | Purpose |
| --- | --- |
| `manifest.config.ts` | Chrome extension manifest (name, icons, permissions, side panel). |
| `src/background.ts` | Service worker. Injects the page scripts into ChatGPT, receives held prompts, runs scans, opens the side panel, and sends the final prompt back to the page. |
| `public/page-hook.js` | Runs inside the ChatGPT page. Intercepts Send and Enter, holds the prompt, and later writes the redacted text into the composer and sends it. |
| `public/page-bridge.js` | Connects the page to the extension and shows the "Checking prompt" chip. |
| `src/localScan.ts` | Pattern checks, merging of pattern and AI findings, placeholders, and the redacted text. |
| `src/api.ts` | Talks to Ollama: health check and the AI scan, using the prompt the Distil-PII model was trained on. |
| `src/App.tsx`, `src/components/PromptPanel.tsx` | Side panel. Picks ChatGPT Guard or Text Redact from the active tab. |
| `src/components/RedactTool.tsx` | The Text Redact tool. |
| `src/components/reviewUi.tsx` | Shared UI pieces: highlighted text, finding rows, status pill, icons. |
| `src/highlight.ts` | Splits text into highlighted and plain segments. |
| `src/types.ts`, `src/messages.ts` | Shared types and the messages passed between the page, background, and panel. |

## Notes and limits

- The AI check runs on the CPU unless Ollama has a supported GPU, and can take 30–60 seconds. It times out after 120 seconds; pattern results are still shown if it does.
- Some numbers are only flagged when labelled (for example `Account Number: 8392014756`), because bare numbers are too easy to confuse with order numbers or quantities.
- Detection is a safety net, not a guarantee. Always check the preview before sending.
