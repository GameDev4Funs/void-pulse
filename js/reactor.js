// Host-owned objective state. Pure logic so timing and rewards can be tested without WebGL.
export const REACTOR = Object.freeze({ firstAt: 24, every: 85, window: 38, hold: 7, radius: 6, buff: 18, heal: 18, pulse: 25, rate: 1.25 });

export class Reactor {
  constructor() { this.reset(); }
  reset() {
    this.cycle = -1; this.phase = 'waiting'; this.charge = 0;
    this.left = REACTOR.firstAt; this.buffLeft = 0; this.buffUntil = 0;
    this.captures = 0; this.completedCycle = -1; this.contested = false;
  }
  tick(time, dt, players, enemies) {
    this.buffLeft = Math.max(0, this.buffUntil - time);
    if (time < REACTOR.firstAt) { this.left = REACTOR.firstAt - time; return false; }
    const cycle = Math.floor((time - REACTOR.firstAt) / REACTOR.every);
    const age = (time - REACTOR.firstAt) % REACTOR.every;
    if (cycle !== this.cycle) { this.cycle = cycle; this.charge = 0; }
    const active = age < REACTOR.window && this.completedCycle !== cycle;
    this.phase = active ? 'active' : 'waiting';
    this.left = active ? REACTOR.window - age : REACTOR.every - age;
    const inside = (p) => p.x * p.x + p.z * p.z <= REACTOR.radius ** 2;
    const occupants = players.filter(inside).length;
    this.contested = active && enemies.some(inside);
    if (!active) return false;
    const rate = occupants ? (1 + Math.min(2, occupants - 1) * 0.25) * (this.contested ? 0.3 : 1) : -0.4;
    this.charge = Math.max(0, Math.min(REACTOR.hold, this.charge + rate * dt));
    if (this.charge < REACTOR.hold) return false;
    this.completedCycle = cycle; this.captures++;
    this.buffUntil = time + REACTOR.buff; this.buffLeft = REACTOR.buff;
    this.phase = 'waiting'; this.left = REACTOR.every - age;
    return true;
  }
  snapshot() {
    return { cycle: this.cycle, phase: this.phase, charge: +this.charge.toFixed(2), left: +this.left.toFixed(1), buffLeft: +this.buffLeft.toFixed(1), captures: this.captures, contested: this.contested };
  }
}
