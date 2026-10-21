import type { Finish } from '@shared/studio'
import { canvas, ctx2d } from './assets'
import { HEAD, pass } from './gl'

// Clarity and bloom need the picture blurred at two radii; the 2D canvas does those blurs
// on the GPU already, so only the mixing is a shader.
const FINISH = HEAD + `
uniform sampler2D soft;
uniform sampler2D wide;
uniform float sharpen;
uniform float clarity;
uniform float vibrance;
uniform float bloom;
uniform float vignette;
uniform float grain;
vec4 atIn(sampler2D t, vec2 px) { return texture(t, vec2(px.x, size.y - px.y) / size); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = here();
  vec4 c = at(p);
  if (c.a <= 0.0) { outColor = c; return; }
  vec3 col = c.rgb / c.a;
  vec3 near = (at(p + vec2(1.0, 0.0)).rgb + at(p - vec2(1.0, 0.0)).rgb + at(p + vec2(0.0, 1.0)).rgb + at(p - vec2(0.0, 1.0)).rgb) / 4.0;
  col += (col - near) * sharpen * 2.5;
  float l = luma(col);
  col += (col - atIn(soft, p).rgb) * clarity * 1.2 * clamp(l * (1.0 - l) * 4.0, 0.0, 1.0);
  float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  col = mix(vec3(luma(col)), col, 1.0 + vibrance * (1.0 - clamp(sat, 0.0, 1.0)) * 1.3);
  vec3 lit = max(atIn(wide, p).rgb - 0.55, 0.0) / 0.45;
  col = 1.0 - (1.0 - clamp(col, 0.0, 1.0)) * (1.0 - lit * bloom);
  vec2 q = (p / size - 0.5) * vec2(1.0, size.y / size.x) * 2.0;
  col *= 1.0 - vignette * 0.85 * smoothstep(0.35, 1.25, length(q));
  col += (hash(p) - 0.5) * grain * 0.18;
  outColor = vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}`

function blurred(src: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const out = canvas(src.width, src.height)
  const g = ctx2d(out)
  g.filter = `blur(${px}px)`
  g.drawImage(src, 0, 0)
  return out
}

export function applyFinish(src: HTMLCanvasElement, f: Finish): HTMLCanvasElement {
  const scale = src.width / 1280
  const out = pass(src, FINISH, { ...f }, [
    { name: 'soft', source: blurred(src, 10 * scale) },
    { name: 'wide', source: blurred(src, 28 * scale) }
  ])
  return out ?? src
}
