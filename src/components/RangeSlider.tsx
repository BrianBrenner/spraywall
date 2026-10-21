/**
 * Two-handle slider over a list of labels (e.g. grades). Built from two native
 * range inputs stacked on one track, so touch, mouse and keyboard all work.
 */
export function RangeSlider({ labels, lo, hi, onChange, ariaLabel }: {
  labels: string[];
  lo: number;
  hi: number;
  onChange: (lo: number, hi: number) => void;
  ariaLabel: string;
}) {
  const max = Math.max(0, labels.length - 1);
  const pct = (i: number) => (max ? (i / max) * 100 : 0);
  return (
    <div className="range-slider">
      <div className="range-track">
        <div className="range-fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={lo}
        // When both handles meet near the top end, the "from" handle must be the one on top or it can't move.
        style={{ zIndex: lo === hi && lo > max / 2 ? 2 : 1 }}
        aria-label={`${ariaLabel}: from`}
        aria-valuetext={labels[lo]}
        onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={hi}
        style={{ zIndex: 1 }}
        aria-label={`${ariaLabel}: to`}
        aria-valuetext={labels[hi]}
        onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))}
      />
    </div>
  );
}
