interface GaugeData {
  width: number;
  noteBase: string;
  hasSharp: boolean;
  centsLabel: string;
  displayCents: number;
  knobLeft: number;
  knobTop: number;
  knobVisible: boolean;
  animationTimerId: number | null;
}

const GAUGE_HEIGHT = 210;

Component({
  properties: {
    noteName: { type: String, value: 'E', observer() { this.syncLabel(); } },
    octave: { type: Number, value: 2 },
    cents: { type: Number, value: 0, observer(value: number) { this.syncLabel(); this.animateTo(value); } },
    active: { type: Boolean, value: false, observer() { this.drawGauge(); } },
    readingColor: { type: String, value: '#72e85c', observer() { this.drawGauge(); } },
    frequencyLabel: { type: String, value: '等待声音' },
  },

  data: {
    width: 0,
    noteBase: 'E',
    hasSharp: false,
    centsLabel: '+0',
    displayCents: 0,
    knobLeft: 0,
    knobTop: 0,
    knobVisible: false,
    animationTimerId: null,
  } as GaugeData,

  lifetimes: {
    ready() {
      wx.createSelectorQuery().in(this).select('#gauge-canvas').boundingClientRect((rect) => {
        const width = rect?.width ?? 0;
        this.setData({ width });
        this.syncLabel();
        this.drawGauge();
      }).exec();
    },
    detached() {
      if (this.data.animationTimerId !== null) {
        clearTimeout(this.data.animationTimerId as unknown as ReturnType<typeof setTimeout>);
      }
    },
  },

  methods: {
    syncLabel() {
      const noteName = this.data.noteName;
      const cents = this.data.cents;
      this.setData({
        noteBase: noteName.replace('♯', ''),
        hasSharp: noteName.includes('♯'),
        centsLabel: `${cents >= 0 ? '+' : ''}${Math.round(cents)}`,
      });
    },

    animateTo(targetCents: number) {
      const target = Math.max(-50, Math.min(50, targetCents));
      const from = this.data.displayCents;
      if (this.data.animationTimerId !== null) {
        clearTimeout(this.data.animationTimerId as unknown as ReturnType<typeof setTimeout>);
      }
      const startedAt = Date.now();
      const duration = 180;
      const tick = () => {
        const progress = Math.max(0, Math.min(1, (Date.now() - startedAt) / duration));
        const eased = 1 - Math.pow(1 - progress, 3);
        this.data.displayCents = from + (target - from) * eased;
        this.drawGauge();
        if (progress < 1) this.data.animationTimerId = setTimeout(tick, 16) as unknown as number;
        else this.data.animationTimerId = null;
      };
      tick();
    },

    drawGauge() {
      const width = this.data.width;
      if (width <= 0) return;
      const context = wx.createCanvasContext('gauge-canvas', this);
      const height = GAUGE_HEIGHT;
      const centerX = width / 2;
      const centerY = height * 0.78;
      const radius = Math.min(width * 0.42, height * 0.7);
      const opacity = this.data.active ? 1 : 0.34;
      const cents = Math.max(-50, Math.min(50, this.data.displayCents));

      context.clearRect(0, 0, width, height);
      // 用足够细的短弧近似 SweepGradient，让颜色在绿、橙、红之间连续过渡。
      // 旧实现按五段整色绘制，会在 ±22 cents 和中心位置产生明显断层。
      const stops = [
        { position: 0, color: '#fe0301' },
        { position: 0.28, color: '#ff9b43' },
        { position: 0.5, color: '#72e85c' },
        { position: 0.72, color: '#ff9b43' },
        { position: 1, color: '#fe0301' },
      ];
      context.setLineWidth(7);
      context.setLineCap('round');
      const arcSegmentCount = 96;
      for (let index = 0; index < arcSegmentCount; index++) {
        const startProgress = index / arcSegmentCount;
        const endProgress = (index + 1) / arcSegmentCount;
        context.beginPath();
        context.setStrokeStyle(this.withOpacity(this.gradientColor(stops, (startProgress + endProgress) / 2), opacity));
        context.arc(
          centerX,
          centerY,
          radius,
          Math.PI + startProgress * Math.PI,
          Math.PI + endProgress * Math.PI,
          false,
        );
        context.stroke();
      }

      context.setLineCap('round');
      for (let index = 0; index <= 10; index++) {
        const angle = Math.PI + (index / 10) * Math.PI;
        const length = index % 5 === 0 ? 14 : 10;
        const outerX = centerX + Math.cos(angle) * (radius - 10);
        const outerY = centerY + Math.sin(angle) * (radius - 10);
        const innerX = centerX + Math.cos(angle) * (radius - 10 - length);
        const innerY = centerY + Math.sin(angle) * (radius - 10 - length);
        context.beginPath();
        context.setStrokeStyle(this.withOpacity('#ffffff', opacity * 0.9));
        context.setLineWidth(2);
        context.moveTo(innerX, innerY);
        context.lineTo(outerX, outerY);
        context.stroke();
      }

      context.setFontSize(9);
      context.setTextAlign('center');
      context.setTextBaseline('middle');
      for (let value = -50; value <= 50; value += 10) {
        const angle = Math.PI + ((value + 50) / 100) * Math.PI;
        const labelRadius = radius + (Math.abs(value) === 50 ? 18 : 14);
        const x = Math.max(10, Math.min(width - 10, centerX + Math.cos(angle) * labelRadius));
        const y = Math.max(8, Math.min(height - 8, centerY + Math.sin(angle) * labelRadius));
        context.setFillStyle(this.withOpacity(this.scaleColor(value), opacity));
        context.fillText(value > 0 ? `+${value}` : String(value), x, y);
      }

      const pointerAngle = Math.PI + ((cents + 50) / 100) * Math.PI;
      const pointerX = centerX + Math.cos(pointerAngle) * radius;
      const pointerY = centerY + Math.sin(pointerAngle) * radius;
      this.setData({
        knobLeft: pointerX - 21.5,
        knobTop: pointerY - 17.5,
        knobVisible: true,
      });
      context.beginPath();
      context.setShadow(0, 4, 5, 'rgba(0, 0, 0, 0.45)');
      context.setFillStyle(this.withOpacity(this.data.readingColor, opacity));
      context.arc(pointerX, pointerY, 16.5, 0, Math.PI * 2, false);
      context.fill();
      context.setShadow(0, 0, 0, 'rgba(0, 0, 0, 0)');
      context.draw();
    },

    gradientColor(
      stops: Array<{ position: number; color: string }>,
      position: number,
    ): string {
      for (let index = 1; index < stops.length; index++) {
        const right = stops[index];
        if (position <= right.position) {
          const left = stops[index - 1];
          const amount = (position - left.position) / (right.position - left.position);
          return this.blendHex(left.color, right.color, amount);
        }
      }
      return stops[stops.length - 1].color;
    },

    blendHex(start: string, end: string, amount: number): string {
      const clamped = Math.max(0, Math.min(1, amount));
      const from = start.replace('#', '');
      const to = end.replace('#', '');
      const channels = [0, 2, 4].map((offset) => {
        const startChannel = Number.parseInt(from.slice(offset, offset + 2), 16);
        const endChannel = Number.parseInt(to.slice(offset, offset + 2), 16);
        const channel = Math.round(startChannel + (endChannel - startChannel) * clamped).toString(16);
        return channel.length === 1 ? '0' + channel : channel;
      });
      return '#' + channels.join('');
    },

    withOpacity(color: string, opacity: number): string {
      const hex = color.replace('#', '');
      const red = Number.parseInt(hex.slice(0, 2), 16);
      const green = Number.parseInt(hex.slice(2, 4), 16);
      const blue = Number.parseInt(hex.slice(4, 6), 16);
      return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    },

    scaleColor(cents: number): string {
      const distance = Math.abs(cents);
      if (distance === 0) return '#f4e9d2';
      if (distance <= 20) return '#b4e074';
      if (distance <= 40) return '#ff9b43';
      return '#fe0301';
    },
  },
});
