// Private stdio worker: no listening port, cloud credentials, or text upload.
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { KokoroTTS } from "kokoro-js";
import {
  env,
  StyleTextToSpeech2Model,
  AutoTokenizer,
} from "@huggingface/transformers";
import { encodeWave, validateRequest } from "./protocol.mjs";

console.log = (...args) => console.error(...args);
env.cacheDir = resolve(process.env.HAO_NARRATION_DATA || ".cache", "models");
env.allowLocalModels = false;
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
let synthesizer;
let idleTimer;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await synthesizer?.model.dispose();
    process.exit(0);
  }, 5 * 60_000);
  idleTimer.unref();
}

async function load() {
  if (synthesizer) return synthesizer;
  const options = {
    revision: REVISION,
    dtype: "q8",
    device: "cpu",
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  };
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(MODEL, options),
    AutoTokenizer.from_pretrained(MODEL, { revision: REVISION }),
  ]);
  // Kokoro's default tokenizer truncates long passages. Never silently drop text.
  const checkedTokenizer = (text, options) => {
    const result = tokenizer(text, { ...options, truncation: false });
    if (result.input_ids.dims.at(-1) > 510) throw new Error("SPLIT_PASSAGE");
    return result;
  };
  synthesizer = new KokoroTTS(model, checkedTokenizer);
  return synthesizer;
}

async function generate(text, voice) {
  const tts = await load();
  try {
    const audio = await tts.generate(text, { voice, speed: 1 });
    return audio.audio;
  } catch (error) {
    if (error.message !== "SPLIT_PASSAGE" || text.length < 2) throw error;
    let split = text.lastIndexOf(" ", Math.floor(text.length / 2));
    if (split < 1) split = Math.floor(text.length / 2);
    const left = await generate(text.slice(0, split), voice);
    const right = await generate(text.slice(split), voice);
    const joined = new Float32Array(left.length + right.length);
    joined.set(left);
    joined.set(right, left.length);
    return joined;
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const parent = Number(process.env.HAO_NARRATION_PARENT_PID);
const watcher = parent
  ? setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        process.exit(0);
      }
    }, 5000)
  : null;
watcher?.unref();

try {
  resetIdleTimer();
  for await (const line of input) {
    clearTimeout(idleTimer);
    let id = "";
    try {
      const request = validateRequest(line);
      id = request.id;
      const samples = await generate(request.text, request.voice);
      const wav = encodeWave(samples);
      process.stdout.write(
        JSON.stringify({ id, audio: wav.toString("base64") }) + "\n",
      );
    } catch (error) {
      // Never log chapter text or credentials.
      console.error(
        "Kokoro generation failed:",
        error.name,
        error.message?.slice(0, 250),
      );
      process.stdout.write(
        JSON.stringify({
          id,
          error:
            "Kokoro could not generate this passage. Check the Bridge narrator log and retry.",
        }) + "\n",
      );
    } finally {
      resetIdleTimer();
    }
  }
} finally {
  clearTimeout(idleTimer);
  if (watcher) clearInterval(watcher);
  await synthesizer?.model.dispose();
}
