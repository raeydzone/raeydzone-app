import { BLEND_MODES, BUNDLED_FONTS, CANVAS_H, CANVAS_W } from './studio'

type Schema = Record<string, unknown>

export interface ToolDef {
  name: string
  description: string
  inputSchema: Schema
}

const num = (description: string): Schema => ({ type: 'number', description })
const str = (description: string): Schema => ({ type: 'string', description })
const bool = (description: string): Schema => ({ type: 'boolean', description })
const color = (description: string): Schema => ({ type: 'string', description: description + ' CSS colour, e.g. #ff2a2a.' })
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})
const nullable = (schema: Schema, description: string): Schema => ({
  anyOf: [schema, { type: 'null' }],
  description
})
const point = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }
const points = (description: string): Schema => ({ type: 'array', items: point, minItems: 3, description })
const rect = (description: string): Schema => ({
  ...obj(
    { x: num('Left edge.'), y: num('Top edge.'), width: num('Width.'), height: num('Height.') },
    ['x', 'y', 'width', 'height']
  ),
  description
})

const common: Record<string, Schema> = {
  name: str('Layer name shown in the layers panel.'),
  x: num('Left edge of the layer box, canvas pixels.'),
  y: num('Top edge of the layer box, canvas pixels.'),
  width: num('Box width in canvas pixels. Text layers size themselves from the font size; giving x and width together aligns the text inside that span.'),
  height: num('Box height in canvas pixels. Text layers size themselves from the font size instead.'),
  rotation: num('Rotation in degrees around the box centre.'),
  flipX: bool('Mirror horizontally.'),
  flipY: bool('Mirror vertically.'),
  opacity: num('0 to 1.'),
  blend: { type: 'string', enum: [...BLEND_MODES], description: 'Blend mode against the layers below.' },
  visible: bool('Hidden layers are not rendered.'),
  locked: bool('Locked layers cannot be dragged on the canvas by the human.'),
  shadow: nullable(
    obj({ color: color('Shadow colour.'), opacity: num('0 to 1.'), blur: num('Blur radius px.'), x: num('Offset x px.'), y: num('Offset y px.') }),
    'Drop shadow following the layer shape. null removes it.'
  ),
  glow: nullable(
    obj({ color: color('Glow colour.'), opacity: num('0 to 1.'), size: num('Spread px, 4 to 120.') }),
    'Automatic outer glow following the layer silhouette. null removes it.'
  ),
  stroke: nullable(
    obj({ color: color('Outline colour.'), width: num('Outline width px, 1 to 40.'), opacity: num('0 to 1.') }),
    'Outline around the layer silhouette (the classic white or black cut-out border). null removes it.'
  ),
  tint: nullable(
    obj({ color: color('Tint colour.'), amount: num('0 to 1.') }),
    'Washes the layer with a colour, keeping its shape. null removes it.'
  ),
  adjust: obj({
    brightness: num('Percent, 100 is unchanged.'),
    contrast: num('Percent, 100 is unchanged.'),
    saturation: num('Percent, 100 is unchanged, 0 is greyscale.'),
    hue: num('Hue rotation in degrees.'),
    blur: num('Gaussian blur px.')
  })
}

const textProps: Record<string, Schema> = {
  text: str('The text. Use \\n for line breaks. Wrap words in *asterisks* to paint them in the highlight colour, e.g. "IT\'S THE *ENDBOSS!*".'),
  font: str(`Font family — any installed font (see list_fonts). Bundled thumbnail fonts: ${BUNDLED_FONTS.join(', ')}.`),
  size: num('Font size px. Thumbnail headlines are usually 90 to 180.'),
  weight: num('100 to 900. Snaps to the nearest weight the font actually has; list_fonts shows them.'),
  italic: bool('Italic.'),
  uppercase: bool('Render in capitals.'),
  fill: color('Main text colour.'),
  highlight: color('Colour for *highlighted* words.'),
  align: { type: 'string', enum: ['left', 'center', 'right'] },
  letterSpacing: num('Extra spacing between letters px.'),
  lineHeight: num('Line height as a multiple of size, e.g. 0.95.')
}

const shapeProps: Record<string, Schema> = {
  shape: { type: 'string', enum: ['rect', 'ellipse', 'polygon'] },
  fill: color('Fill colour.'),
  gradient: nullable(
    obj({
      type: { type: 'string', enum: ['linear', 'radial'] },
      from: color('Start colour (centre for radial).'),
      to: color('End colour (edge for radial). Use a transparent colour like #00000000 to fade out.'),
      angle: num('Linear direction in degrees, 90 is top to bottom.')
    }, ['type', 'from', 'to']),
    'Gradient fill, overrides fill. null for a solid fill.'
  ),
  radius: num('Corner radius px for rect.'),
  feather: num('Softens the edge by this many px — high values turn a shape into a soft light or shadow blob.'),
  points: points('Polygon anchor points in canvas pixels, [[x, y], ...]. Setting them recomputes the box.')
}

export const STUDIO_TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    description: 'Returns the canvas size, background, every layer top to bottom with all of its properties, and the image assets you can place (attachments, generated images). Call this first and whenever you are unsure of the current state — the human can edit the canvas at any time.',
    inputSchema: obj({})
  },
  {
    name: 'list_fonts',
    description: 'Lists the font families installed on this PC with the weights each one has. Bundled thumbnail fonts come first.',
    inputSchema: obj({ search: str('Optional case-insensitive filter, e.g. "condensed" or "impact".') })
  },
  {
    name: 'view_canvas',
    description: `Renders the canvas (${CANVAS_W}x${CANVAS_H}) and returns it as an image so you can judge the result. Use it after every meaningful change. outlines draws each layer box with its id; region zooms into part of the canvas; layer_id renders one layer alone on a checkerboard.`,
    inputSchema: obj({
      outlines: bool('Draw labelled layer boxes over the render.'),
      region: rect('Optional crop of the canvas to inspect in detail.'),
      layer_id: str('Optional: render only this layer.')
    })
  },
  {
    name: 'view_asset',
    description: 'Returns an asset (an attachment or generated image) as an image so you can see it before placing it.',
    inputSchema: obj({ asset_id: str('Asset id from get_document.') }, ['asset_id'])
  },
  {
    name: 'add_image',
    description: 'Places an asset on the canvas as a new image layer, on top unless below_layer_id is given. Without a box it is fitted: "cover" fills the whole canvas (backgrounds), "contain" fits inside it.',
    inputSchema: obj({
      asset_id: str('Asset id.'),
      fit: { type: 'string', enum: ['cover', 'contain'], description: 'Used when no box is given. Default contain.' },
      ...common,
      below_layer_id: str('Insert directly under this layer instead of on top.')
    }, ['asset_id'])
  },
  {
    name: 'add_text',
    description: 'Adds a text layer. Defaults: Montserrat 900, size 120, white, centred, no outline. Combine with stroke, shadow and glow for the bold thumbnail look.',
    inputSchema: obj({ ...textProps, ...common, below_layer_id: str('Insert under this layer.') }, ['text'])
  },
  {
    name: 'add_shape',
    description: 'Adds a rectangle, ellipse or polygon. Use polygons with points as anchor points to draw a manual glow or light shape: give it a bright fill, a large feather and blend "screen" or "color-dodge" and put it behind or over the subject. Use a full-canvas rect with a radial gradient for vignettes and colour washes.',
    inputSchema: obj({ ...shapeProps, ...common, below_layer_id: str('Insert under this layer.') }, ['shape'])
  },
  {
    name: 'update_layer',
    description: 'Changes any properties of a layer: position, size, rotation, opacity, blend, effects (shadow, glow, stroke, tint), adjustments, text and shape properties. Only the given properties change. Effects passed as null are removed.',
    inputSchema: obj({ layer_id: str('Layer id.'), ...common, ...textProps, ...shapeProps }, ['layer_id'])
  },
  {
    name: 'arrange_layer',
    description: 'Moves a layer in the stack.',
    inputSchema: obj({
      layer_id: str('Layer id.'),
      to: { type: 'string', enum: ['top', 'bottom', 'up', 'down'], description: 'up/down move one step.' }
    }, ['layer_id', 'to'])
  },
  {
    name: 'duplicate_layer',
    description: 'Copies a layer (with its mask and effects) directly above itself and returns the new id. Handy for a blurred glow copy behind a subject.',
    inputSchema: obj({ layer_id: str('Layer id.') }, ['layer_id'])
  },
  {
    name: 'delete_layer',
    description: 'Removes a layer.',
    inputSchema: obj({ layer_id: str('Layer id.') }, ['layer_id'])
  },
  {
    name: 'set_background',
    description: 'Sets the canvas background colour shown under all layers.',
    inputSchema: obj({ color: color('Background colour.') }, ['color'])
  },
  {
    name: 'cut_out',
    description: 'Smart cut-out: the cut-out model sees the layer image and hides everything except the subject in an image layer by writing its mask. Describe the subject when the image holds more than one thing, and pass a box (canvas pixels) around it to cut one object out of a busy screenshot. Check the result with view_canvas and fix edges with edit_mask.',
    inputSchema: obj({
      layer_id: str('Image layer id.'),
      subject: str('What to keep, e.g. "the man with the hand on his face".'),
      box: rect('Optional box around the subject, canvas pixels.')
    }, ['layer_id'])
  },
  {
    name: 'edit_mask',
    description: 'Manual mask editing on an image layer, exactly like a human with a lasso and brush. Coordinates are canvas pixels. hide_polygon / show_polygon hide or reveal the area inside the anchor points; hide_brush / show_brush paint along a path; feather softens edges; invert swaps shown and hidden; reset removes the mask.',
    inputSchema: obj({
      layer_id: str('Image layer id.'),
      action: { type: 'string', enum: ['hide_polygon', 'show_polygon', 'hide_brush', 'show_brush', 'feather', 'invert', 'reset'] },
      points: { type: 'array', items: point, description: 'Polygon anchors or brush path, canvas pixels.' },
      radius: num('Brush radius px, or feather amount px.')
    }, ['layer_id', 'action'])
  },
  {
    name: 'generate_image',
    description: 'Generates a new image with the image model the creator picked for generation and stores it as an asset (effects, objects, backgrounds, props). The model can see reference images: pass assets, layers, or the whole current canvas to restyle, extend or match them. Set transparent for a cut-out-ready result on models that support it; otherwise ask for a plain flat background and set cut_out. With place it is added as a layer. Costs money per call — be deliberate.',
    inputSchema: obj({
      prompt: str('Detailed description of the image. Refer to the reference images by order, e.g. "the person in the first reference".'),
      reference_asset_ids: { type: 'array', items: { type: 'string' }, description: 'Assets the model should see.' },
      reference_layer_ids: { type: 'array', items: { type: 'string' }, description: 'Layers to render on their own and show the model.' },
      reference_canvas: bool('Show the model the current full canvas as a reference.'),
      aspect_ratio: { type: 'string', enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] },
      transparent: bool('Ask for a transparent background (GPT Image models only).'),
      place: bool('Add the result as a layer on top.'),
      cut_out: bool('When placing, also cut the main subject out (skipped when the result is already transparent).')
    }, ['prompt'])
  },
  {
    name: 'generative_fill',
    description: 'Photoshop-style generative fill: the image model repaints a region of the current composite from a prompt, and the result lands as a new feathered image layer over that region (non-destructive). Use it to extend backgrounds, remove things (facecams, HUD, text, overlays), add fire, smoke, debris or light in place. By default the region is blanked first, so the model invents fresh content and nothing old survives — one call with a box covering the whole object, frame and shadow included, is enough to remove it. The prompt describes what belongs there afterwards, not what to remove. Costs money per call.',
    inputSchema: obj({
      prompt: str('What should appear in the region, e.g. "dark chain-link fence over a dim concrete wall".'),
      region: rect('Region to repaint, canvas pixels. Cover the whole object including its frame or border.'),
      keep_contents: bool('Let the model see and build on what is in the region now (smoke over the scene, light on an object). Leave off to replace it.')
    }, ['prompt', 'region'])
  },
  {
    name: 'undo',
    description: 'Reverts the last change to the canvas.',
    inputSchema: obj({})
  },
  {
    name: 'report_missing_feature',
    description: 'Files a note for the developers of this studio when the tools fall short of what the request needed: a missing tool, option or effect, or a tool that misbehaved. The reports are collected so the gap can be built for future requests. File one per gap as soon as you hit it, then carry on with the best workaround. Keep the title short and generic so repeats of the same gap group together, e.g. "Curved text along an arc". Not for creative choices or questions to the creator.',
    inputSchema: obj({
      kind: { type: 'string', enum: ['missing_feature', 'bug'], description: 'missing_feature when the capability does not exist, bug when a tool did not do what it promised.' },
      title: str('Short, generic name of the gap.'),
      detail: str('What the request needed, and exactly where the tools fell short.'),
      workaround: str('What you did instead, if anything.')
    }, ['kind', 'title', 'detail'])
  }
]
