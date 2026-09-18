import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWave, validateRequest } from "./protocol.mjs";

const request = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  voice: "af_heart",
  text: "Welcome to your next story.",
};
test("only built-in voices and bounded text are accepted", () => {
  assert.deepEqual(validateRequest(JSON.stringify(request)), request);
  for (const patch of [
    { voice: "../custom" },
    { text: "x".repeat(401) },
    { text: " " },
    { id: "" },
  ]) {
    assert.throws(() =>
      validateRequest(JSON.stringify({ ...request, ...patch })),
    );
  }
});
test("audio is iOS-compatible mono PCM16 WAV", () => {
  const wav = encodeWave(new Float32Array([-2, 0, 2]));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.readInt16LE(44), -32768);
  assert.equal(wav.readInt16LE(48), 32767);
  assert.throws(() => encodeWave(new Float32Array([NaN])));
});
