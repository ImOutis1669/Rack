import { DoubleTap } from './doubleTap';

describe('DoubleTap', () => {
  it('fires on two quick taps in the same place', () => {
    const d = new DoubleTap();
    d.start(1, 100, 100, 0);
    expect(d.end(0, 100, 100, 80)).toBe(false);
    d.start(1, 102, 101, 180);
    expect(d.end(0, 102, 101, 240)).toBe(true);
  });

  it('ignores a pinch, whose two fingers lift close together', () => {
    const d = new DoubleTap();
    d.start(1, 100, 100, 0);
    d.start(2, 200, 200, 10);
    expect(d.end(1, 100, 100, 400)).toBe(false);
    expect(d.end(0, 200, 200, 420)).toBe(false);
    // and the next single tap starts fresh, not as the second half of a double-tap
    d.start(1, 150, 150, 500);
    expect(d.end(0, 150, 150, 560)).toBe(false);
  });

  it('ignores slow taps, drags and taps too far apart in time', () => {
    const d = new DoubleTap();
    d.start(1, 0, 0, 0);
    expect(d.end(0, 0, 0, 400)).toBe(false); // long press
    d.start(1, 0, 0, 500);
    expect(d.end(0, 40, 0, 560)).toBe(false); // drag
    d.start(1, 0, 0, 600);
    d.end(0, 0, 0, 650);
    d.start(1, 0, 0, 1100);
    expect(d.end(0, 0, 0, 1150)).toBe(false); // 500 ms later: two single taps
  });
});
