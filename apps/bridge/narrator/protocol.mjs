export const VOICES = [
  "af_heart",
  "af_bella",
  "af_nicole",
  "am_michael",
  "am_fenrir",
  "bf_emma",
  "bm_george",
];

export function validateRequest(line) {
  if (line.length > 8000) throw new Error("Request is too large");
  const request = JSON.parse(line);
  if (
    !request ||
    typeof request.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(request.id)
  )
    throw new Error("Invalid request ID");
  if (!VOICES.includes(request.voice))
    throw new Error("Unknown built-in voice");
  if (
    typeof request.text !== "string" ||
    !request.text.trim() ||
    request.text.length > 400
  )
    throw new Error("Invalid passage length");
  return request;
}

export function encodeWave(samples, rate = 24000) {
  if (!samples?.length || samples.length > rate * 120)
    throw new Error("Invalid audio length");
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error("Invalid audio sample");
    const value = Math.min(1, Math.max(-1, samples[i]));
    wav.writeInt16LE(
      Math.round(value * (value < 0 ? 32768 : 32767)),
      44 + i * 2,
    );
  }
  return wav;
}
