import { readingColor as getReadingColor } from '../../core/tuner/tuning';

interface TrendSample {
  cents: number | null;
  capturedAt: number;
}

interface GridLine {
  value: number;
  label: string;
  top: number;
  labelTop: number;
}

interface TrendSegment {
  left: number;
  top: number;
  width: number;
  angle: number;
  color: string;
}

interface TrendData {
  width: number;
  height: number;
  gridLines: GridLine[];
  inTuneBandTop: number;
  inTuneBandHeight: number;
  segments: TrendSegment[];
}

const TREND_HEIGHT = 98;
const VISIBLE_DURATION_MS = 8000;
const CHART_LEFT = 28;
const GRID_VALUES = [50, 25, 0, -25, -50];

Component({
  properties: {
    values: {
      type: Array,
      value: [] as TrendSample[],
      observer() { this.drawTrend(); },
    },
  },

  data: {
    width: 0,
    height: TREND_HEIGHT,
    gridLines: [] as GridLine[],
    inTuneBandTop: 0,
    inTuneBandHeight: 0,
    segments: [] as TrendSegment[],
  } as TrendData,

  lifetimes: {
    ready() {
      wx.createSelectorQuery().in(this).select('#trend-chart').boundingClientRect((rect) => {
        const width = rect?.width ?? 0;
        const height = rect?.height ?? TREND_HEIGHT;
        this.setData({ width, height });
        this.drawTrend();
      }).exec();
    },
  },

  methods: {
    drawTrend() {
      const width = this.data.width;
      if (width <= 0) return;
      const height = this.data.height || TREND_HEIGHT;
      const chartWidth = Math.max(0, width - CHART_LEFT);
      const gridLines = GRID_VALUES.map((value, index) => {
        const top = (index / 4) * height;
        return {
          value,
          label: value > 0 ? `+${value}` : String(value),
          top,
          labelTop: Math.max(0, Math.min(height - 12, top - 6)),
        };
      });
      const inTuneBandTop = this.yForCents(5, height);
      const inTuneBandBottom = this.yForCents(-5, height);
      const values = this.data.values as TrendSample[];
      const segments: TrendSegment[] = [];
      if (values.length >= 2) {
        const endTime = values[values.length - 1].capturedAt;
        const startTime = endTime - VISIBLE_DURATION_MS;
        for (let index = 1; index < values.length; index++) {
          const previous = values[index - 1];
          const current = values[index];
          if (
            previous.cents === null ||
            current.cents === null ||
            current.capturedAt - previous.capturedAt > 300
          ) continue;
          const x1 = this.xForTime(previous.capturedAt, startTime, chartWidth);
          const y1 = this.yForCents(previous.cents, height);
          const x2 = this.xForTime(current.capturedAt, startTime, chartWidth);
          const y2 = this.yForCents(current.cents, height);
          const deltaX = x2 - x1;
          const deltaY = y2 - y1;
          segments.push({
            left: x1,
            top: y1 - 1,
            width: Math.max(1, Math.sqrt(deltaX * deltaX + deltaY * deltaY)),
            angle: Math.atan2(deltaY, deltaX) * 180 / Math.PI,
            color: this.readingColor(current.cents),
          });
        }
      }
      this.setData({
        gridLines,
        inTuneBandTop,
        inTuneBandHeight: Math.max(0, inTuneBandBottom - inTuneBandTop),
        segments,
      });
    },

    xForTime(capturedAt: number, startTime: number, chartWidth: number): number {
      const ratio = Math.max(0, Math.min(1, (capturedAt - startTime) / VISIBLE_DURATION_MS));
      return CHART_LEFT + ratio * chartWidth;
    },

    yForCents(cents: number, height: number): number {
      return ((50 - Math.max(-50, Math.min(50, cents))) / 100) * height;
    },

    readingColor(cents: number): string {
      return getReadingColor(cents);
    },
  },
});
