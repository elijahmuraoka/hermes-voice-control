#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const API_BASE = process.env.HVC_E2E_API_BASE ?? "http://127.0.0.1:8765";
const MODEL =
  process.env.HVC_GEMINI_MODEL ?? "gemini-2.5-flash-native-audio-latest";
const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

function toGeminiModelResource(model) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function makeSpeechPcm() {
  const dir = mkdtempSync(join(tmpdir(), "hvc-gemini-live-"));
  const aiff = join(dir, "prompt.aiff");
  const pcm = join(dir, "prompt.pcm");
  try {
    run("/usr/bin/say", [
      "-o",
      aiff,
      "In one short sentence, say the Hermes voice connection is ready.",
    ]);
    run("/opt/homebrew/bin/ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      aiff,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      pcm,
    ]);
    return { dir, pcm: readFileSync(pcm) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

async function postJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok)
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("websocket open timeout")),
      15_000,
    );
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("websocket error before open"));
      },
      { once: true },
    );
  });
}

function waitForOutcome(ws) {
  const seen = {
    setupComplete: false,
    outputAudio: false,
    outputText: "",
    inputText: "",
    messages: 0,
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Gemini Live timeout: ${JSON.stringify(seen)}`)),
      45_000,
    );
    ws.addEventListener("message", async (event) => {
      seen.messages += 1;
      const raw =
        typeof event.data === "string" ? event.data : await event.data.text();
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.setupComplete || message.setup_complete)
        seen.setupComplete = true;
      const serverContent = message.serverContent ?? message.server_content;
      if (serverContent?.inputTranscription?.text)
        seen.inputText += serverContent.inputTranscription.text;
      if (serverContent?.input_transcription?.text)
        seen.inputText += serverContent.input_transcription.text;
      if (serverContent?.outputTranscription?.text)
        seen.outputText += serverContent.outputTranscription.text;
      if (serverContent?.output_transcription?.text)
        seen.outputText += serverContent.output_transcription.text;
      const parts =
        serverContent?.modelTurn?.parts ??
        serverContent?.model_turn?.parts ??
        [];
      for (const part of parts) {
        const inlineData = part.inlineData ?? part.inline_data;
        const mimeType = inlineData?.mimeType ?? inlineData?.mime_type ?? "";
        if (inlineData?.data && String(mimeType).startsWith("audio/pcm"))
          seen.outputAudio = true;
      }
      if (seen.outputAudio || seen.outputText.trim().length > 0) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
    ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      if (seen.outputAudio || seen.outputText.trim()) resolve(seen);
      else
        reject(
          new Error(
            `websocket closed before output: code=${event.code} reason=${event.reason} seen=${JSON.stringify(seen)}`,
          ),
        );
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`websocket error after open: ${JSON.stringify(seen)}`));
    });
  });
}

async function main() {
  const { token, mode, model } = await postJson("/gemini/ephemeral-token");
  if (!token || mode !== "real")
    throw new Error(`expected real token, got mode=${mode}`);
  const setupModel = model ?? MODEL;
  const tmp = makeSpeechPcm();
  const ws = new WebSocket(
    `${LIVE_ENDPOINT}?access_token=${encodeURIComponent(token)}`,
  );
  try {
    await waitForOpen(ws);
    ws.send(
      JSON.stringify({
        setup: {
          model: toGeminiModelResource(setupModel),
          generationConfig: { responseModalities: ["AUDIO"] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text:
                  "You are the user's Hermes voice agent in a Gemini Live smoke test. Answer briefly.",
              },
            ],
          },
        },
      }),
    );
    const pcm = tmp.pcm;
    const chunkSize = 3200;
    for (let offset = 0; offset < pcm.length; offset += chunkSize) {
      const chunk = pcm.subarray(
        offset,
        Math.min(offset + chunkSize, pcm.length),
      );
      ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: "audio/pcm;rate=16000",
                data: chunk.toString("base64"),
              },
            ],
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    const outcome = await waitForOutcome(ws);
    console.log(
      JSON.stringify({
        ok: true,
        mode,
        model: setupModel,
        setupComplete: outcome.setupComplete,
        outputAudio: outcome.outputAudio,
        outputTextChars: outcome.outputText.length,
        inputTextChars: outcome.inputText.length,
        messages: outcome.messages,
      }),
    );
  } finally {
    try {
      ws.close(1000, "smoke complete");
    } catch {}
    rmSync(tmp.dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
