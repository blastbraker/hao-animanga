import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const folder = fileURLToPath(new URL(".", import.meta.url));
const output = resolve(folder, "../../../.tmp/kokoro-smoke.wav");
const child = spawn(process.execPath, [resolve(folder, "worker.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    HAO_NARRATION_DATA:
      process.env.HAO_NARRATION_DATA || resolve(folder, "../../../.run/kokoro"),
  },
  windowsHide: true,
});
const started = Date.now();
const timeout = setTimeout(() => {
  child.kill();
  console.error("Kokoro smoke test timed out");
  process.exitCode = 1;
}, 240_000);
child.stdin.write(
  JSON.stringify({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    voice: "af_heart",
    text: "Welcome to HAO. The little library was quiet, except for the rain against the windows. Mira opened her book and settled into the old armchair. Tonight, the next adventure could wait for no one.",
  }) + "\n",
);
try {
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    const response = JSON.parse(line);
    if (response.error) throw new Error(response.error);
    const audio = Buffer.from(response.audio, "base64");
    if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.length < 1000)
      throw new Error("Invalid WAV");
    await mkdir(resolve(output, ".."), { recursive: true });
    await writeFile(output, audio);
    console.log(
      JSON.stringify({
        output,
        generatedInSeconds: (Date.now() - started) / 1000,
        audioSeconds: (audio.length - 44) / 48000,
        bytes: audio.length,
      }),
    );
    break;
  }
} finally {
  clearTimeout(timeout);
  child.stdin.end();
}
