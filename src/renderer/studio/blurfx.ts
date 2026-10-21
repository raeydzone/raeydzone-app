import { BLUR_STYLES } from '@shared/studio'
import type { BlurFx } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import { HEAD, pass } from './gl'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

// Lens and tilt-shift sample a disc whose radius varies per pixel; the golden-angle spiral
// spreads a fixed number of taps evenly over it at any radius.
const BLUR = HEAD + `
uniform float style;
uniform float amount;
uniform float angle;
uniform vec2 center;
uniform float focus;
uniform vec4 box;
const int LINE = 64;
const int DISC = 96;
void main() {
  vec2 p = here();
  vec4 acc = vec4(0.0);
  if (style < 2.5) {
    for (int i = 0; i < LINE; i++) {
      float t = float(i) / float(LINE - 1);
      vec2 q;
      if (style < 0.5) q = p + vec2(cos(angle), sin(angle)) * amount * (t - 0.5);
      else if (style < 1.5) q = p + (center - p) * min(0.95, amount / max(1.0, 0.5 * length(box.zw))) * (t - 0.5);
      else {
        float a = (t - 0.5) * radians(amount);
        vec2 r = p - center;
        q = center + vec2(r.x * cos(a) - r.y * sin(a), r.x * sin(a) + r.y * cos(a));
      }
      acc += at(q);
    }
    outColor = acc / float(LINE);
    return;
  }
  float radius = amount;
  if (style > 3.5) {
    vec2 n = vec2(-sin(angle), cos(angle));
    float band = focus * box.w * 0.5;
    radius = amount * smoothstep(band, band + max(1.0, box.w * 0.25), abs(dot(p - center, n)));
  } else if (focus > 0.0) {
    float keep = focus * 0.5 * length(box.zw);
    radius = amount * smoothstep(keep, keep * 1.6 + 1.0, length(p - center));
  }
  if (radius < 0.5) { outColor = at(p); return; }
  float total = 0.0;
  for (int i = 0; i < DISC; i++) {
    float rr = sqrt((float(i) + 0.5) / float(DISC)) * radius;
    float a = float(i) * 2.39996;
    vec4 c = at(p + vec2(cos(a), sin(a)) * rr);
    float w = 1.0;
    if (style < 3.5) w += 5.0 * pow(dot(c.rgb, vec3(0.299, 0.587, 0.114)), 5.0);
    acc += c * w;
    total += w;
  }
  outColor = acc / total;
}`

// How far a blur can carry pixels past the layer edge, so the raster leaves room for it.
export function blurReach(b: BlurFx | null, w: number, h: number): number {
  if (!b || b.amount <= 0) return 0
  if (b.style === 'motion') return b.amount / 2
  if (b.style === 'spin') return Math.min(400, (Math.hypot(w, h) / 2) * Math.sin(Math.min(Math.PI / 2, (b.amount * Math.PI) / 360)))
  return Math.min(400, b.amount)
}

// The raster is built unrotated, so turn brings canvas directions into the layer's frame.
export function applyBlur(src: HTMLCanvasElement, b: BlurFx, box: Box, turn = 0): HTMLCanvasElement {
  if (b.amount <= 0) return src
  const out = pass(src, BLUR, {
    style: BLUR_STYLES.indexOf(b.style),
    amount: b.amount,
    angle: ((b.angle + turn) * Math.PI) / 180,
    center: [box.x + b.x * box.w, box.y + b.y * box.h],
    focus: b.focus,
    box: [box.x, box.y, box.w, box.h]
  })
  if (out) return out
  const soft = canvas(src.width, src.height)
  const g = ctx2d(soft)
  g.filter = `blur(${b.amount / 3}px)`
  g.drawImage(src, 0, 0)
  return soft
}
