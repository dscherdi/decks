import { Chart } from "chart.js";

export const PALETTE = {
  blue: "--color-blue",
  green: "--color-green",
  orange: "--color-orange",
  yellow: "--color-yellow",
  red: "--color-red",
  purple: "--color-purple",
} as const;

interface RgbParts {
  r: number;
  g: number;
  b: number;
}

let initialized = false;

function readVar(varName: string): string {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

export function getObsidianColor(varName: string): string {
  return readVar(varName);
}

function parseColor(color: string): RgbParts | null {
  const trimmed = color.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("#")) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return { r, g, b };
      }
    }
    return null;
  }

  const match = trimmed.match(
    /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/
  );
  if (match) {
    return {
      r: Math.round(parseFloat(match[1])),
      g: Math.round(parseFloat(match[2])),
      b: Math.round(parseFloat(match[3])),
    };
  }

  return null;
}

export function withAlpha(varName: string, alpha: number): string {
  const color = getObsidianColor(varName);
  const parts = parseColor(color);
  if (!parts) return color;
  return `rgba(${parts.r}, ${parts.g}, ${parts.b}, ${alpha})`;
}

export function interpolateColor(
  fromVar: string,
  toVar: string,
  t: number
): string {
  const fromColor = getObsidianColor(fromVar);
  const toColor = getObsidianColor(toVar);
  const from = parseColor(fromColor);
  const to = parseColor(toColor);
  if (!from || !to) return fromColor;
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

export function initChartTheme(): void {
  if (initialized) return;
  initialized = true;

  const fontFamily = readVar("--font-interface");
  if (fontFamily) {
    Chart.defaults.font.family = fontFamily;
  }
  Chart.defaults.color = getObsidianColor("--text-muted");
  Chart.defaults.plugins.tooltip.animation = false;
}

export function getCategoryXAxis() {
  return {
    grid: { display: false },
    ticks: {
      maxRotation: 0,
      autoSkip: true,
      maxTicksLimit: 12,
    },
  };
}

export function getLinearYAxis() {
  return {
    beginAtZero: true,
    grid: {
      color: getObsidianColor("--background-modifier-border-hover"),
      drawTicks: false,
    },
    ticks: { precision: 0 },
  };
}

export function getNativeTooltip() {
  return {
    backgroundColor: getObsidianColor("--background-secondary-alt"),
    titleColor: getObsidianColor("--text-normal"),
    bodyColor: getObsidianColor("--text-muted"),
    borderColor: getObsidianColor("--background-modifier-border"),
    borderWidth: 1,
    cornerRadius: 4,
    padding: 8,
    displayColors: true,
    animation: false as const,
  };
}

export const BAR_DATASET_DEFAULTS = {
  borderRadius: 4,
  borderSkipped: false as const,
  barPercentage: 0.6,
};

export const LINE_DATASET_DEFAULTS = {
  tension: 0.4,
  fill: true,
  borderWidth: 2,
  pointRadius: 0,
  pointHoverRadius: 5,
};
