export type IntroSkipInterval = {
  startTime: number;
  endTime: number;
  source: "aniskip";
};

export function normalizeIntroSkipInterval(value: unknown, duration: number): IntroSkipInterval | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<IntroSkipInterval>;
  if (item.source !== "aniskip" || typeof item.startTime !== "number" || typeof item.endTime !== "number" || !Number.isFinite(item.startTime) || !Number.isFinite(item.endTime) || item.startTime < 0 || item.endTime <= item.startTime || item.endTime - item.startTime < 15 || item.endTime - item.startTime > 180 || item.endTime > duration + 5) return null;
  return { startTime: item.startTime, endTime: item.endTime, source: "aniskip" };
}

export function isIntroSkipVisible(interval: IntroSkipInterval | null, currentTime: number): boolean {
  return Boolean(interval && currentTime >= interval.startTime && currentTime < interval.endTime);
}
