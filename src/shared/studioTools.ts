import { BLEND_MODES, BUNDLED_FONTS, CANVAS_H, CANVAS_W, STROKE_POSITIONS } from './studio'

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
const stack = (item: Schema, description: string): Schema => ({ type: 'array', items: item, maxItems: 8, description })
const ids = (description: string): Schema => ({ type: 'array', items: { type: 'string' }, description })
const points = (description: string): Schema => ({ type: 'array', items: point, minItems: 3, description })
const rect = (description: string): Schema => ({
  ...obj(
    { x: num('Left edge.'), y: num('Top edge.'), width: num('Width.'), height: num('Height.') },
    ['x', 'y', 'width', 'height']
  ),
  description
})

const shadowItem = obj({
  color: color('Shadow colour.'),
  opacity: num('0 to 1.'),
  blur: num('Blur radius px.'),
  x: num('Offset x px.'),
  y: num('Offset y px.'),
  inner: bool('true casts it inside the layer edge (inner shadow) instead of behind it.')
})
const glowItem = obj({
  color: color('Glow colour.'),
  opacity: num('0 to 1.'),
  size: num('Spread px, 4 to 160.'),
  inner: bool('true lights the inside of the edge (inner glow) instead of spilling outwards.')
})
const strokeItem = obj({
  color: color('Outline colour.'),
  width: num('Outline width px, 1 to 60.'),
  opacity: num('0 to 1.'),
  position: { type: 'string', enum: [...STROKE_POSITIONS], description: 'outside grows out of the shape (default), inside eats into it, center straddles the edge.' }
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
  shadows: stack(shadowItem, 'Shadows following the layer shape, as many as you need: a tight dark one plus a soft wide one reads as real depth. [] removes them all.'),
  glows: stack(glowItem, 'Glows following the layer silhouette. [] removes them all.'),
  strokes: stack(
    strokeItem,
    'Outlines around the layer silhouette, listed from the content outwards: [{white, 8}, {black, 10}] is the classic white-then-black thumbnail border, each ring nesting around the last. [] removes them all.'
  ),
  shadow: nullable(shadowItem, 'Shorthand that edits the first entry of shadows; null clears them all.'),
  glow: nullable(glowItem, 'Shorthand that edits the first entry of glows; null clears them all.'),
  stroke: nullable(strokeItem, 'Shorthand that edits the first entry of strokes; null clears them all.'),
  tint: nullable(
    obj({ color: color('Tint colour.'), amount: num('0 to 1.') }),
    'Washes the layer with a colour, keeping its shape. null removes it.'
  ),
  clip: nullable(
    obj({
      from: str('Id of the layer or group this one is clipped to.'),
      mode: { type: 'string', enum: ['alpha', 'luma'], description: 'alpha clips to where the source covers anything; luma also uses its brightness, so dark areas hide and light areas show.' },
      invert: bool('Show only where the source does NOT cover.'),
      feather: num('Softens the clip edge by this many px.')
    }, ['from']),
    'Clipping mask: this layer is only visible where another layer or group covers. Put an image over a text layer and clip it to that text for photo-filled letters; clip a gradient or a light wash to a cut-out subject; clip a texture to a badge group. The source does not have to be visible — hide it to use it purely as a mask. null removes the clip.'
  ),
  adjust: obj({
    brightness: num('Percent, 100 is unchanged.'),
    contrast: num('Percent, 100 is unchanged.'),
    saturation: num('Percent, 100 is unchanged, 0 is greyscale.'),
    hue: num('Hue rotation in degrees.'),
    blur: num('Gaussian blur px.')
  })
}

const gradient = (description: string): Schema => nullable(
  obj({
    type: { type: 'string', enum: ['linear', 'radial'] },
    from: color('Start colour (centre for radial).'),
    to: color('End colour (edge for radial). Use a transparent colour like #00000000 to fade out.'),
    angle: num('Linear direction in degrees, 90 is top to bottom.')
  }, ['type', 'from', 'to']),
  description
)

const textProps: Record<string, Schema> = {
  text: str('The text. Use \\n for line breaks. Wrap words in *asterisks* to paint them in the highlight colour, e.g. "IT\'S THE *ENDBOSS!*".'),
  font: str(`Font family — any installed font (see list_fonts). Bundled thumbnail fonts: ${BUNDLED_FONTS.join(', ')}.`),
  size: num('Font size px. Thumbnail headlines are usually 90 to 180.'),
  weight: num('100 to 900. Snaps to the nearest weight the font actually has; list_fonts shows them.'),
  italic: bool('Italic.'),
  uppercase: bool('Render in capitals.'),
  fill: color('Main text colour.'),
  gradient: gradient('Gradient across the letters, overrides fill; *highlighted* words keep the highlight colour. Linear at angle 90 runs top to bottom of the text box. null for a solid fill.'),
  highlight: color('Colour for *highlighted* words.'),
  align: { type: 'string', enum: ['left', 'center', 'right'] },
  letterSpacing: num('Extra spacing between letters px.'),
  lineHeight: num('Line height as a multiple of size, e.g. 0.95.')
}

const shapeProps: Record<string, Schema> = {
  shape: { type: 'string', enum: ['rect', 'ellipse', 'polygon'] },
  fill: color('Fill colour.'),
  gradient: gradient('Gradient fill, overrides fill. null for a solid fill.'),
  radius: num('Corner radius px for rect.'),
  feather: num('Softens the edge by this many px — high values turn a shape into a soft light or shadow blob.'),
  points: points('Polygon anchor points in canvas pixels, [[x, y], ...]. Setting them recomputes the box.')
}

export const STUDIO_TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    description: 'Returns the canvas size, background, every layer top to bottom with all of its properties (group holds the id of the group it belongs to), the layer groups with their members and boxes, and the image assets you can place (attachments, generated images). Call this first and whenever you are unsure of the current state — the human can edit the canvas at any time.',
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
    description: 'Adds a text layer. Defaults: Montserrat 900, size 120, white, centred, no outline. Combine with strokes, shadows and glows for the bold thumbnail look — stack two strokes for a white-then-black border.',
    inputSchema: obj({ ...textProps, ...common, below_layer_id: str('Insert under this layer.') }, ['text'])
  },
  {
    name: 'add_shape',
    description: 'Adds a rectangle, ellipse or polygon. Use polygons with points as anchor points to draw a manual glow or light shape: give it a bright fill, a large feather and blend "screen" or "color-dodge" and put it behind or over the subject. Use a full-canvas rect with a radial gradient for vignettes and colour washes.',
    inputSchema: obj({ ...shapeProps, ...common, below_layer_id: str('Insert under this layer.') }, ['shape'])
  },
  {
    name: 'update_layer',
    description: 'Changes any properties of a layer: position, size, rotation, opacity, blend, effect stacks (shadows, glows, strokes) and tint, clipping, adjustments, text and shape properties. Only the given properties change. A stack passed as a list replaces it; null or [] removes it.',
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
    name: 'group_layers',
    description: 'Groups layers into one named unit, e.g. a badge built from a shape, a dot and a text layer. The members are stacked together where the topmost one was. Clicking any member on the canvas selects the whole group, and update_group, duplicate_group and delete_group act on all of it. Returns the group id.',
    inputSchema: obj({
      layer_ids: { ...ids('Two or more layer ids.'), minItems: 2 },
      name: str('Group name shown in the layers panel, e.g. "LIVE badge".')
    }, ['layer_ids', 'name'])
  },
  {
    name: 'update_group',
    description: 'Changes a whole group at once: rename it, move it (dx/dy, or x/y for the top-left of the group box), scale it about its centre (type size, outlines, glows and shadows scale along), show or hide it, lock it, or move it through the stack as one block. Members stay editable on their own with update_layer.',
    inputSchema: obj({
      group_id: str('Group id.'),
      name: str('New group name.'),
      dx: num('Move right by this many px.'),
      dy: num('Move down by this many px.'),
      x: num('Place the left edge of the group box here.'),
      y: num('Place the top edge of the group box here.'),
      scale: num('Uniform scale factor, e.g. 1.25 for a quarter bigger.'),
      visible: bool('Show or hide every member.'),
      locked: bool('Lock or unlock every member.'),
      arrange: { type: 'string', enum: ['top', 'bottom', 'up', 'down'], description: 'Move the group in the stack; up/down step past one neighbouring layer.' }
    }, ['group_id'])
  },
  {
    name: 'duplicate_group',
    description: 'Copies a group with all of its layers as a new group directly above it and returns the new ids.',
    inputSchema: obj({ group_id: str('Group id.'), dx: num('Offset the copy right px.'), dy: num('Offset the copy down px.') }, ['group_id'])
  },
  {
    name: 'ungroup',
    description: 'Dissolves a group. Its layers stay exactly where they are.',
    inputSchema: obj({ group_id: str('Group id.') }, ['group_id'])
  },
  {
    name: 'delete_group',
    description: 'Deletes a group together with all of its layers.',
    inputSchema: obj({ group_id: str('Group id.') }, ['group_id'])
  },
  {
    name: 'list_projects',
    description: 'Lists the creator\'s thumbnail studios (videos and streams, most recently edited first) with their versions, so you can reuse something from an earlier thumbnail: a badge, logo, frame, text style or cut-out the creator already has. The current project is included and marked current, for its other versions.',
    inputSchema: obj({ search: str('Optional case-insensitive filter on the project name.') })
  },
  {
    name: 'browse_project',
    description: 'Shows one version of a thumbnail from list_projects: a render of it, its layers top to bottom with ids, names, groups and boxes, its groups, and its assets. Set outlines to label the layer boxes on the render. Use the ids with import_from_project.',
    inputSchema: obj({
      project_id: str('Project id from list_projects.'),
      version_id: str('Version id from list_projects. Defaults to the version that was open last.'),
      outlines: bool('Draw labelled layer boxes over the render.')
    }, ['project_id'])
  },
  {
    name: 'import_from_project',
    description: 'Copies layers, whole groups and assets from another thumbnail into this one. Layers keep their position, effects and masks and land on top of the stack; group_ids bring every member along as a new group. asset_ids only add images to this project\'s assets for add_image. Returns the new ids.',
    inputSchema: obj({
      project_id: str('Project id from list_projects.'),
      version_id: str('Version id. Defaults to the version that was open last.'),
      layer_ids: ids('Layers to copy.'),
      group_ids: ids('Groups to copy with all their layers.'),
      asset_ids: ids('Assets to copy into this project.')
    }, ['project_id'])
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
    description: 'Manual mask editing on any layer — image, text or shape — exactly like a human with a lasso and brush. Coordinates are canvas pixels. hide_polygon / show_polygon hide or reveal the area inside the anchor points; hide_brush / show_brush paint along a path; feather softens edges; invert swaps shown and hidden; reset removes the mask. For clipping one layer to the shape of another, use clip on update_layer instead.',
    inputSchema: obj({
      layer_id: str('Layer id — any kind.'),
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
