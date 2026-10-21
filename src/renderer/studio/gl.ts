import { canvas, ctx2d } from './assets'

export type Uniform = number | number[]

// Either raw bytes (lookup tables, a 3D LUT) or a canvas read the same way as the source.
export interface DataTexture {
  name: string
  width?: number
  height?: number
  depth?: number
  bytes?: Uint8Array
  source?: HTMLCanvasElement
}

interface Context {
  gl: WebGL2RenderingContext
  el: HTMLCanvasElement
  programs: Map<string, WebGLProgram>
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Every pass reads its source through these helpers, in canvas pixels with y pointing down,
// so shaders never have to think about GL's upside-down texture space.
export const HEAD = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D src;
uniform vec2 size;
vec2 here() { return vec2(uv.x, 1.0 - uv.y) * size; }
vec4 at(vec2 px) { return texture(src, vec2(px.x, size.y - px.y) / size); }
`

let state: Context | null | undefined

function context(): Context | null {
  if (state !== undefined) return state
  const el = document.createElement('canvas')
  const gl = el.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
  if (!gl) return (state = null)
  el.addEventListener('webglcontextlost', () => (state = undefined))
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  state = { gl, el, programs: new Map() }
  return state
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader failed: ' + gl.getShaderInfoLog(sh))
  return sh
}

function program(c: Context, frag: string): WebGLProgram {
  const hit = c.programs.get(frag)
  if (hit) return hit
  const { gl } = c
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag))
  gl.bindAttribLocation(prog, 0, 'p')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog))
  c.programs.set(frag, prog)
  return prog
}

export function hasGl(): boolean {
  return !!context()
}

function setUniform(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null, v: Uniform): void {
  if (!loc) return
  if (typeof v === 'number') gl.uniform1f(loc, v)
  else if (v.length === 2) gl.uniform2fv(loc, v)
  else if (v.length === 3) gl.uniform3fv(loc, v)
  else gl.uniform4fv(loc, v)
}

// One full-screen pass: the source canvas in, a fresh 2D canvas out. Null when the machine
// has no WebGL2, so callers can fall back to the 2D path.
export function pass(
  src: HTMLCanvasElement,
  frag: string,
  uniforms: Record<string, Uniform> = {},
  data: DataTexture[] = []
): HTMLCanvasElement | null {
  const c = context()
  if (!c) return null
  const { gl, el } = c
  el.width = src.width
  el.height = src.height
  gl.viewport(0, 0, src.width, src.height)
  const prog = program(c, frag)
  gl.useProgram(prog)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const made: WebGLTexture[] = []
  const bind = (unit: number, name: string, target: number, upload: () => void): void => {
    const tex = gl.createTexture()!
    made.push(tex)
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target, tex)
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    upload()
    gl.uniform1i(gl.getUniformLocation(prog, name), unit)
  }
  const image = (el: HTMLCanvasElement): void => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el)
  }
  bind(0, 'src', gl.TEXTURE_2D, () => image(src))
  data.forEach((d, i) => {
    const three = !!d.depth
    bind(i + 1, d.name, three ? gl.TEXTURE_3D : gl.TEXTURE_2D, () => {
      if (d.source) return image(d.source)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      if (three) gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, d.width!, d.height!, d.depth!, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.bytes!)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, d.width!, d.height!, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.bytes!)
    })
  })
  setUniform(gl, gl.getUniformLocation(prog, 'size'), [src.width, src.height])
  for (const [name, v] of Object.entries(uniforms)) setUniform(gl, gl.getUniformLocation(prog, name), v)

  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  const out = canvas(src.width, src.height)
  ctx2d(out).drawImage(el, 0, 0)
  for (const t of made) gl.deleteTexture(t)
  return out
}
