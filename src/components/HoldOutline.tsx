import type { SVGProps } from 'react';
import { shapePath } from '../lib/geometry';
import type { HoldShape } from '../types';

/** A hold outline whose stroke stays the same on-screen width at any zoom. */
export function HoldOutline({ shape, color, width = 2.5, halo = true, ...rest }: {
  shape: HoldShape;
  color: string;
  width?: number;
  halo?: boolean;
} & SVGProps<SVGPathElement>) {
  const d = shapePath(shape);
  return (
    <g>
      {halo && <path d={d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={width + 2.5} vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke={color} strokeWidth={width} vectorEffect="non-scaling-stroke" {...rest} />
    </g>
  );
}
