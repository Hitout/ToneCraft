import { calculatePendulumTrack } from './pendulum-geometry';

Component({
  properties: {
    playing: {
      type: Boolean,
      value: false,
    },
    beatDurationMs: {
      type: Number,
      value: 500,
    },
    beatCount: {
      type: Number,
      value: 4,
      observer() {
        this.measureTrack();
      },
    },
  },

  data: {
    trackStart: 0,
    trackWidth: 0,
  },

  lifetimes: {
    ready() {
      this.measureTrack();
    },
  },

  methods: {
    measureTrack() {
      this.createSelectorQuery()
        .select('.pendulum')
        .boundingClientRect((rect) => {
          if (rect === null) return;
          const width = rect.width;
          const track = calculatePendulumTrack(width, this.data.beatCount);
          this.setData({
            trackStart: track.start,
            trackWidth: track.width,
          });
        })
        .exec();
    },
  },
});
