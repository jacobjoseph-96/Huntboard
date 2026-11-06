// Counts what happened to every job in a search, stage by stage. Each stage must add up:
// in = kept + dropped + unread. "Unread" (the ad text could not be read) is never counted as dropped.

class Stage {
  constructor(name, n_in) {
    this.name = name;
    this.n_in = n_in;
    this.kept = 0;
    this.dropped = 0;
    this.unread = 0;
    this.reasons = {};
  }

  keep() {
    this.kept++;
  }

  drop(reason) {
    this.dropped++;
    this.reasons[reason] = (this.reasons[reason] || 0) + 1;
  }

  miss(reason) {
    this.unread++;
    this.reasons[`unread: ${reason}`] = (this.reasons[`unread: ${reason}`] || 0) + 1;
  }

  close() {
    if (this.kept + this.dropped + this.unread !== this.n_in) {
      throw new Error(`Funnel stage "${this.name}" does not add up: ${this.n_in} in, ${this.kept} kept, ${this.dropped} dropped, ${this.unread} unread`);
    }
    return { name: this.name, in: this.n_in, kept: this.kept, dropped: this.dropped, unread: this.unread, reasons: this.reasons };
  }
}

function describe(stages) {
  return stages.map((s) => {
    const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `${n} ${r}`).join(', ');
    return `${s.name}: ${s.in} in → ${s.kept} kept${s.dropped ? `, ${s.dropped} dropped` : ''}${s.unread ? `, ${s.unread} unread` : ''}${top ? ` (${top})` : ''}`;
  }).join('\n');
}

module.exports = { Stage, describe };
