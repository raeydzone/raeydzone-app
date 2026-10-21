import {
  BLEND_MODES, BLUR_STYLES, BUNDLED_FONTS, CANVAS_H, CANVAS_W, GRADIENT_TYPES, SHAPES, STROKE_POSITIONS, WARP_STYLES
} from './studio'

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

const curve = (description: string): Schema => ({
  type: 'array',
  items: point,
  maxItems: 16,
  description: description + ' Points are [input, output], 0 to 255; at least two make a curve, [] resets it.'
})

const toneSchema = nullable(
  obj({
    levels: nullable(obj({
      black: num('Input black point 0 to 254: everything this dark or darker turns black.'),
      white: num('Input white point 1 to 255: everything this bright or brighter turns white.'),
      gamma: num('Midtone gamma, 1 is unchanged, above 1 brightens the midtones.'),
      outBlack: num('Output floor 0 to 255 — raise it for faded, matte blacks.'),
      outWhite: num('Output ceiling 0 to 255.')
    }), 'Photoshop Levels. null removes them.'),
    curves: nullable(obj({
      rgb: curve('Master curve for all channels. An S-curve [[0,0],[64,48],[192,210],[255,255]] adds punch.'),
      r: curve('Red channel curve.'),
      g: curve('Green channel curve.'),
      b: curve('Blue channel curve — lift its shadows for a teal cast.')
    }), 'Photoshop Curves, applied after levels. null removes them.'),
    map: nullable(obj({
      stops: {
        type: 'array',
        items: obj({ at: num('Brightness 0 (shadows) to 1 (highlights).'), color: color('Colour for that brightness.') }, ['at', 'color']),
        minItems: 2,
        maxItems: 16
      },
      amount: num('0 to 1 blend with the original colours.')
    }), 'Gradient map: recolours by brightness, shadows to the first stop and highlights to the last — duotones, noir, a red hell look. null removes it.'),
    lut: nullable(obj({ amount: num('0 to 1 strength of the loaded .cube LUT.') }), 'A colour LUT the creator loaded; you can change its strength or remove it with null.'),
    grade: nullable(obj({
      gain: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Multiplier per channel [r, g, b], 1 is unchanged.' },
      lift: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Offset per channel [r, g, b], -1 to 1.' },
      amount: num('0 to 1.')
    }), 'A per-channel colour shift, what match_colors writes. null removes it.')
  }),
  'Tonal adjustments on this layer (on an adjustment layer: on everything below it). Each part is optional and null removes it; null for the whole tone removes them all.'
)

const blurFxSchema = nullable(
  obj({
    style: { type: 'string', enum: [...BLUR_STYLES], description: 'motion streaks in one direction, zoom radiates from a centre (speed, impact), spin swirls round it, lens is a bokeh blur that blooms highlights into discs, tilt keeps a band sharp and blurs away from it (miniature look).' },
    amount: num('Strength: blur length px for motion and zoom, degrees for spin (up to 90), disc radius px for lens and tilt.'),
    angle: num('Degrees: the direction of a motion blur, the direction of the sharp band of a tilt-shift.'),
    x: num('Centre of a zoom or spin, or the sharp spot of lens and tilt, as a fraction of the layer box: 0.5 is the middle.'),
    y: num('As x, vertically.'),
    focus: num('0 to 1: half-height of the sharp band for tilt; for lens, the size of the sharp area around x/y (0 blurs everything).')
  }, ['style']),
  'A camera-style blur beyond the Gaussian adjust.blur. null removes it.'
)

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
  corners: nullable(
    {
      type: 'array',
      items: point,
      minItems: 4,
      maxItems: 4,
      description: 'Offsets in layer px of the top-left, top-right, bottom-right and bottom-left corners from where the box puts them.'
    },
    'Free distort: skew moves the top and bottom corners opposite ways, perspective pinches one side. The content is bent before effects, so outlines stay even. null resets it.'
  ),
  warp: nullable(
    obj({
      style: { type: 'string', enum: [...WARP_STYLES] },
      bend: num('-1 to 1. Negative flips the direction.')
    }, ['style']),
    'Photoshop-style warp: arch bends the whole layer, arc only its top edge, bulge swells the middle, flag and wave ripple it, rise climbs to the right. Great on headlines. null removes it.'
  ),
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
  }),
  tone: toneSchema,
  blurFx: blurFxSchema,
  lightWrap: nullable(
    obj({ amount: num('0 to 1 strength.'), size: num('How far the light reaches in from the edge, px.') }),
    'Light wrap: the scene behind the layer bleeds into its edge, so a pasted-in cut-out looks lit by the background instead of stuck on. Use it on every cut-out person over a bright or colourful background. null removes it.'
  ),
  contact: nullable(
    obj({
      color: color('Shadow colour.'),
      opacity: num('0 to 1.'),
      blur: num('Softness px.'),
      squash: num('0.02 to 1: how flat the silhouette is squashed onto the floor, 0.1 is a thin pool.'),
      y: num('Moves the shadow down px from the lowest point of the layer.')
    }),
    'Contact shadow: the layer\'s own silhouette squashed flat under its lowest point, as if it stands on the ground. For products, people, objects. null removes it.'
  ),
  link: nullable(str('Brand style id.'), 'The brand style this layer follows; set by apply_brand_style. null unlinks it, keeping its look.')
}

const lookProp: Record<string, Schema> = {
  look: { type: 'string', enum: ['punch', 'teal', 'moody', 'warm', 'cold', 'noir', 'duo'], description: 'Applies a preset tone in one go (replacing levels, curves, map and grade): punch, teal (teal & orange), moody, warm, cold, noir, duo (red duotone). Fine-tune with tone afterwards.' }
}

const gradient = (description: string): Schema => nullable(
  obj({
    type: { type: 'string', enum: [...GRADIENT_TYPES], description: 'conic sweeps round the centre like a clock hand.' },
    from: color('Start colour (centre for radial).'),
    to: color('End colour (edge for radial). Use a transparent colour like #00000000 to fade out.'),
    angle: num('Direction in degrees for linear (90 is top to bottom) and the start of a conic sweep.'),
    stops: {
      type: 'array',
      items: obj({ at: num('Position 0 to 1 along the ramp.'), color: color('Colour at that position.') }, ['at', 'color']),
      maxItems: 16,
      description: 'Any number of colours from 2 up, replacing from/to — e.g. a fire ramp or a chrome sheen. [] goes back to from/to.'
    }
  }),
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
  lineHeight: num('Line height as a multiple of size, e.g. 0.95.'),
  wrap: nullable(num('Width px'), 'Wrap the text to this width — the box keeps that width and words flow onto new lines. null turns wrapping off.'),
  fit: bool('With wrap set: instead of wrapping, shrink the type until every line fits the wrap width. The size is then the largest it may get.'),
  arc: num('Bends the text along a circle: the widest line sweeps this many degrees, -360 to 360. Positive arcs like a rainbow, negative like a smile. Glyphs stay undistorted; for squashing letters into a shape use warp instead.'),
  styles: {
    type: 'array',
    items: obj({
      start: num('First character, counted in the text exactly as stored — asterisks included.'),
      end: num('One past the last character.'),
      fill: color('Colour for this stretch.'),
      scale: num('Size relative to the layer size, e.g. 1.6 for a word that punches out.'),
      font: str('Another installed font for this stretch.'),
      weight: num('100 to 900.'),
      italic: bool('Italic.'),
      rise: num('Lifts the stretch above the baseline by this many px; negative sinks it.')
    }, ['start', 'end']),
    description: 'Per-character styling: give one word its own colour, size, font or lift. Later entries win where they overlap. [] clears them.'
  }
}

const shapeProps: Record<string, Schema> = {
  shape: { type: 'string', enum: [...SHAPES], description: 'arrow points right — rotate the layer to aim it; bubble is a speech bubble with its tail bottom-left — flip it to move the tail.' },
  fill: color('Fill colour. "transparent" leaves only the line, for rings, frames and outlined arrows.'),
  gradient: gradient('Gradient fill, overrides fill. null for a solid fill.'),
  radius: num('Corner radius px for rect and bubble.'),
  line: nullable(
    obj({
      color: color('Line colour.'),
      width: num('Line width px.'),
      opacity: num('0 to 1.'),
      dash: num('Dash length px; 0 is a solid line.')
    }),
    'A vector line drawn along the shape outline itself, centred on the edge. With a transparent fill it makes hollow shapes: a red ring around a face, a frame, a dashed circle. null removes it.'
  ),
  sides: num('Number of points on a star, 3 to 24.'),
  inset: num('0.05 to 0.95: a star\'s inner radius, an arrow\'s shaft thickness, a bubble\'s tail size.'),
  smooth: num('0 to 1: rounds the corners of polygons, stars and arrows; 1 turns anchor points into a smooth curve.'),
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
    description: 'Adds a rectangle, ellipse, polygon, star, arrow or speech bubble. Use polygons with points as anchor points to draw a manual glow or light shape: give it a bright fill, a large feather and blend "screen" or "color-dodge" and put it behind or over the subject; smooth turns the anchors into curves. Use a full-canvas rect with a radial gradient for vignettes and colour washes, and a transparent fill with a line for rings and frames.',
    inputSchema: obj({ ...shapeProps, ...common, below_layer_id: str('Insert under this layer.') }, ['shape'])
  },
  {
    name: 'add_adjustment_layer',
    description: 'Adds an adjustment layer: it draws nothing itself but applies its tone (levels, curves, gradient map, grade, look), adjust (brightness, contrast, saturation, hue, blur) and blurFx to everything below it, like in Photoshop. By default it covers the whole canvas; give a box to limit it, mask it with edit_mask, or clip it to a layer or group so only that is changed (grade just the subject). Use it for the final colour grade of the whole thumbnail, a background-only blur under the subject, or a duotone.',
    inputSchema: obj({ ...common, ...lookProp, below_layer_id: str('Insert under this layer, so it changes only what is below that.') })
  },
  {
    name: 'match_colors',
    description: 'Colour-matches a layer to a reference by shifting each channel to the reference\'s average and spread, written as tone.grade. Without reference_layer_id the layer is matched to the rest of the thumbnail — the quick way to make a pasted-in cut-out sit in the scene\'s light. On an adjustment layer it matches everything below to the reference.',
    inputSchema: obj({
      layer_id: str('Layer to recolour.'),
      reference_layer_id: str('Layer whose colours to match, e.g. a hidden reference image. Omit for the rest of the canvas.')
    }, ['layer_id'])
  },
  {
    name: 'auto_levels',
    description: 'Stretches a layer\'s tones so its darkest pixels go black and its brightest white, written as tone.levels. On an adjustment layer it measures everything below it.',
    inputSchema: obj({ layer_id: str('Layer id.') }, ['layer_id'])
  },
  {
    name: 'update_layer',
    description: 'Changes any properties of a layer: position, size, rotation, opacity, blend, effect stacks (shadows, glows, strokes) and tint, clipping, adjustments, text and shape properties. Only the given properties change. A stack passed as a list replaces it; null or [] removes it.',
    inputSchema: obj({ layer_id: str('Layer id.'), ...common, ...lookProp, ...textProps, ...shapeProps }, ['layer_id'])
  },
  {
    name: 'align_layers',
    description: 'Lines layers up exactly instead of by eye: align edges or centres, or space three or more evenly. A whole group in the list moves as one block. One layer, or to "canvas", aligns against the canvas — centre a headline with align "center" to canvas.',
    inputSchema: obj({
      layer_ids: ids('Layers to align. Include every member of a group to move it as one.'),
      align: { type: 'string', enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'], description: 'center and middle are the horizontal and vertical centres.' },
      distribute: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Instead of aligning, make the gaps between three or more layers equal.' },
      to: { type: 'string', enum: ['selection', 'canvas'], description: 'Align against the joint box of the layers (default) or the canvas.' }
    }, ['layer_ids'])
  },
  {
    name: 'check_design',
    description: 'Runs the design doctor on the current canvas: text too small to read at 210px wide, text that blends into its background (contrast at its edge), text cut off at the canvas edge or under YouTube\'s video-length badge, text or shapes covering the face of a cut-out, too many words, and a flat overall image. Returns the findings with layer ids. Run it before you call a thumbnail finished and fix what it finds.',
    inputSchema: obj({})
  },
  {
    name: 'set_finish',
    description: 'The finishing pass over the whole thumbnail, applied after every layer, each 0 to 1: sharpen (crisp edges), clarity (local contrast that makes faces and textures pop), vibrance (boosts dull colours, spares already strong ones), bloom (bright areas glow), vignette (darkens the corners), grain (film grain). Small values go a long way: sharpen 0.3, clarity 0.3, vibrance 0.3. Given values merge into the current ones; null removes the finish.',
    inputSchema: obj({
      finish: nullable(obj({
        sharpen: num('0 to 1.'),
        clarity: num('0 to 1.'),
        vibrance: num('0 to 1.'),
        bloom: num('0 to 1.'),
        vignette: num('0 to 1.'),
        grain: num('0 to 1.')
      }), 'The finish, or null to remove it.')
    }, ['finish'])
  },
  {
    name: 'save_snapshot',
    description: 'Saves the current design as a named snapshot the creator can compare against (A/B split view) and restore. Take one before a big change you might want to undo as a whole, or to offer two takes on one version.',
    inputSchema: obj({ name: str('Short name, e.g. "Before the red grade".') })
  },
  {
    name: 'extract_palette',
    description: 'Returns the main colours of the canvas or of one layer, most used first, as hex — for picking text and accent colours that belong to the image, e.g. a highlight colour matching the subject\'s shirt.',
    inputSchema: obj({ layer_id: str('Optional: only this layer.'), count: num('How many colours, 2 to 10. Default 6.') })
  },
  {
    name: 'get_brand_kit',
    description: 'Returns the creator\'s brand kit: brand colours, fonts, saved styles (ids, names and the layer kind each was made from) and logos. Use the brand colours and fonts for text and accents whenever a kit exists, apply saved styles with apply_brand_style, and place logos with place_logo.',
    inputSchema: obj({})
  },
  {
    name: 'apply_brand_style',
    description: 'Gives a layer one of the brand kit\'s saved styles (fonts, colours, outlines, shadows, glows, grade) and links it, so the layer follows when the creator edits that style later. Style parts that only fit another layer kind are skipped.',
    inputSchema: obj({ layer_id: str('Layer id.'), style_id: str('Style id from get_brand_kit.') }, ['layer_id', 'style_id'])
  },
  {
    name: 'place_logo',
    description: 'Places one of the brand kit\'s logos as an image layer, by default small in the top-left corner; pass x, y and width to put it elsewhere.',
    inputSchema: obj({ logo_id: str('Logo id from get_brand_kit.'), x: num('Left edge.'), y: num('Top edge.'), width: num('Width px; height follows.') }, ['logo_id'])
  },
  {
    name: 'mask_group',
    description: 'Masks a whole group at once, in canvas pixels: hide_polygon hides what is inside the anchor points for every member, keep_polygon keeps only that area, reset removes the group mask. Use it to fade or cut a multi-layer element as one, e.g. a badge sliding out of frame.',
    inputSchema: obj({
      group_id: str('Group id.'),
      action: { type: 'string', enum: ['hide_polygon', 'keep_polygon', 'reset'] },
      points: points('Polygon anchors, canvas pixels.'),
      feather: num('Softens the polygon edge px.')
    }, ['group_id', 'action'])
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
    description: 'Manual mask editing on any layer — image, text or shape — exactly like a human with a lasso and brush. Coordinates are canvas pixels. hide_polygon / show_polygon hide or reveal the area inside the anchor points; hide_brush / show_brush paint along a path; feather softens edges; invert swaps shown and hidden; reset removes the mask. Refine a cut-out edge with grow and shrink (radius px pushes the edge out or in, e.g. shrink 2 to drop a halo), smooth (rounds off jaggies) and harden (snaps a soft, smeary edge clean). For clipping one layer to the shape of another, use clip on update_layer instead.',
    inputSchema: obj({
      layer_id: str('Layer id — any kind.'),
      action: { type: 'string', enum: ['hide_polygon', 'show_polygon', 'hide_brush', 'show_brush', 'feather', 'invert', 'grow', 'shrink', 'smooth', 'harden', 'reset'] },
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
    name: 'paint',
    description: 'Paints pixels on an image layer like a human with a brush: brush lays down colour, erase removes pixels, clone copies the visible canvas from source onto the path (remove a watermark, fill a gap with surrounding texture), heal does the same but matches the colour where it lands. Points are canvas pixels along the stroke. Without layer_id a new transparent paint layer is added on top first — paint on that rather than on a photo, so the original stays untouched. Returns the layer id.',
    inputSchema: obj({
      layer_id: str('Image or paint layer to paint on. Omit to start a new paint layer.'),
      mode: { type: 'string', enum: ['brush', 'erase', 'clone', 'heal'] },
      points: { type: 'array', items: point, minItems: 1, description: 'The stroke path, canvas pixels. One point is a single dab.' },
      radius: num('Brush radius px.'),
      color: color('Brush colour.'),
      opacity: num('0 to 1 for the whole stroke.'),
      hardness: num('0 is a soft airbrush, 1 a hard-edged disc.'),
      source: { ...point, description: 'Clone and heal: the canvas point that maps onto the first point of the stroke.' }
    }, ['mode', 'points'])
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
