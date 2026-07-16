/** Bytes legíveis (unidades binárias, 1 casa). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** Uptime "2d 3h 14m". */
export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Pontos do polyline de uma sparkline (0–100 → SVG w×h). */
export function sparkPoints(samples: number[], w: number, h: number, max = 100): string {
  if (samples.length === 0) return "";
  const step = samples.length > 1 ? w / (samples.length - 1) : 0;
  return samples
    .map((v, i) => {
      const y = h - (Math.min(Math.max(v, 0), max) / max) * h;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
