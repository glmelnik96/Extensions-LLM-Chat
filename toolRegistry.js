/**
 * Agent Tool Registry — OpenAI-compatible function definitions for all AE operations.
 * These are sent via the `tools` parameter in chat/completions API calls.
 */
(function () {
  'use strict'

  var tools = [
    // ── Bulk execution ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'batch_call',
        description: 'Run up to 60 tool calls in ONE turn, sequentially. Use this whenever the same operation applies to 3+ layers/properties ("for every selected layer", "for each shape layer", "remove X from all…") and no dedicated *_batch tool fits. Every sub-call is validated exactly as if issued on its own; the reply lists per-call ok/message plus how many succeeded. Retry only the failed indices — never re-send a whole batch.',
        parameters: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: 'Calls to run, in order. Cannot contain batch_call itself.',
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string', description: 'Tool name, e.g. "set_layer_timing"' },
                  args: { type: 'object', description: 'Arguments object for that tool' }
                },
                required: ['tool', 'args']
              }
            }
          },
          required: ['calls']
        }
      }
    },
    // ── Read tools ─────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_detailed_comp_summary',
        description: 'Snapshot of the active composition — the state you must reason from. Per layer: type, id, in/out, parent, `enabled` (video switch), `locked`, current `transform` values (position/scale/rotation/opacity/anchorPoint at comp time), `compPosition` for parented layers, `animated` = keyframe ranges per property ({numKeys, from, to}), expressions (path, snippet, error), effects, `text` for text layers. Root: width/height, time, bgColor. Always call this first and use the VALUES it returns instead of guessing. For large comps (20+ layers), use compact:true or filters to reduce token usage.',
        parameters: {
          type: 'object',
          properties: {
            compact: { type: 'boolean', description: 'If true, return minimal info per layer (index, id, name, type, 3D, parent) to save tokens. Default: false.' },
            layer_type: { type: 'string', enum: ['shape', 'text', 'solid', 'null', 'adjustment', 'precomp', 'camera', 'light', 'av'], description: 'Filter layers by type' },
            name_contains: { type: 'string', description: 'Filter layers whose name contains this substring (case-insensitive)' },
            max_layers: { type: 'number', description: 'Maximum number of layers to return (0 = no limit)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_host_context',
        description: 'Get timeline context: current time, work area, selected layers and properties.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_property_value',
        description: 'Read the current value of a layer property, optionally at a specific time. Also returns expression info.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID (preferred over index)' },
            property_path: { type: 'string', description: 'Property path like "Transform>Position", "Transform>Opacity"' },
            time: { type: 'number', description: 'Time in seconds to sample value at (optional)' }
          },
          required: ['layer_index', 'property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_keyframes',
        description: 'Read all keyframes from a property including times, values, and easing.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' }
          },
          required: ['layer_index', 'property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'probe_motion',
        description: 'Measure what a property ACTUALLY does over time, with keyframes and expressions applied — the scripted equivalent of scrubbing the timeline. Use it to VERIFY motion before reporting (does it move, how far, when, is the layer visible then). `space:"comp"` returns Position in composition space with the parent chain applied — use it for parented layers, orbits and rigs. Returns samples [{t, value, visible}] and a summary {changes, maxDelta, first, last, numKeys, hasExpression, expressionError}.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID (preferred)' },
            property_path: { type: 'string', description: 'Property path, e.g. "Transform>Position", "Transform>Scale", "Effects>Slider Control>Slider". Default: Transform>Position' },
            times: { type: 'array', items: { type: 'number' }, description: 'Sample times in seconds (max 25). Omit to sample evenly across the layer\'s visible window.' },
            samples: { type: 'number', description: 'Number of evenly spaced samples when `times` is omitted (2-25, default 5)' },
            space: { type: 'string', enum: ['layer', 'comp'], description: '"comp" = composition space (parent chain applied; Position only). Default "layer" (the raw property value, i.e. PARENT space for parented layers)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_layer_properties',
        description: 'List all properties on a layer (deep scan). Use to discover effect properties, shape paths, etc.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_effect_properties',
        description: 'List properties of a specific effect on a layer.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            effect_index: { type: 'number', description: '1-based effect index in the Effects stack' }
          },
          required: ['layer_index', 'effect_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'search_layers',
        description: 'Find layers in the active composition by name substring (case-insensitive), optionally filtered by layer type. Returns minimal info per match: index, id, name, type (max 50). Cheaper than get_detailed_comp_summary when you only need to locate specific layers.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Substring to match against layer names (case-insensitive)' },
            layer_type: { type: 'string', enum: ['shape', 'text', 'solid', 'null', 'adjustment', 'precomp', 'camera', 'light', 'av'], description: 'Filter matches by layer type' }
          },
          required: ['pattern']
        }
      }
    },

    // ── Layer mutation tools ───────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_layer',
        description: 'Create a new layer in the active composition. Types: solid, shape, text, null, adjustment, camera, light. A camera is refused in a comp with no 3D layers (it would render nothing) — for camera shake use apply_motion_recipe(recipe:"shake").',
        parameters: {
          type: 'object',
          properties: {
            layer_type: { type: 'string', enum: ['solid', 'shape', 'text', 'null', 'adjustment', 'camera', 'light'] },
            name: { type: 'string', description: 'Layer name' },
            color: { type: 'array', items: { type: 'number' }, description: 'RGB color [0-1, 0-1, 0-1] for solid/adjustment layers' },
            width: { type: 'number', description: 'Width in pixels (defaults to comp width)' },
            height: { type: 'number', description: 'Height in pixels (defaults to comp height)' },
            duration: { type: 'number', description: 'Duration in seconds (defaults to comp duration)' },
            text: { type: 'string', description: 'Initial text content for text layers' },
            font: { type: 'string', description: 'Font name for text layers' },
            font_size: { type: 'number', description: 'Font size for text layers' },
            client_op_id: { type: 'string', description: 'Optional unique id for idempotency. If you retry the same logical operation, reuse the same id and the tool will return the original result instead of double-creating.' }
          },
          required: ['layer_type']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_layer',
        description: 'Delete a layer from the active composition.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'duplicate_layer',
        description: 'Duplicate a layer. Returns the new layer info.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reorder_layer',
        description: 'Move a layer to a new position in the layer stack.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: 'Current 1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            new_index: { type: 'number', description: 'Target 1-based index' }
          },
          required: ['layer_index', 'new_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_layer_parent',
        description: 'Set or clear a layer\'s parent. To unparent, set parent_layer_index to 0.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: 'Child layer index' },
            layer_id: { type: 'number', description: 'Child layer ID' },
            parent_layer_index: { type: 'number', description: 'Parent layer index (0 to unparent)' },
            parent_layer_id: { type: 'number', description: 'Parent layer ID' }
          },
          required: ['layer_index', 'parent_layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_layer_timing',
        description: 'Set in point, out point, and/or start time for a layer (in seconds). USE THIS for "visible from A to B" / "show only between X and Y" / "starts at" requests — a trim is a hard cut. Opacity keyframes are NOT a substitute: linear 0→100→0 ramps leave the layer half-transparent for most of its window; if opacity must be used, take hold keys.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            in_point: { type: 'number', description: 'In point in seconds' },
            out_point: { type: 'number', description: 'Out point in seconds' },
            start_time: { type: 'number', description: 'Start time in seconds' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_layer',
        description: 'Rename a layer.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            new_name: { type: 'string', description: 'New name for the layer' }
          },
          required: ['layer_index', 'new_name']
        }
      }
    },

    // ── Keyframe tools ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'add_keyframes',
        description: 'Add keyframes to ONE property. Each keyframe has time, value, and optional easing. For multi-dimensional properties (Position, Scale), value is an array like [x, y] or [x, y, z]. WHEN: single property only — if you are animating 2+ properties or layers, use set_keyframes_batch instead (one call instead of many).',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path like "Transform>Position"' },
            keyframes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number', description: 'Time in seconds' },
                  value: { description: 'Value — number for 1D properties, array for multi-dimensional' },
                  in_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Incoming interpolation (default: bezier) — shapes the segment BEFORE this key. Note: to make a value STAY constant after a key, set that key\'s out_type to hold (in_type has no effect on what follows).' },
                  out_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Outgoing interpolation (default: bezier) — shapes the segment AFTER this key. hold = the value stays exactly at this key\'s value until the next key (no ramp). For on/off visibility windows put out_type:"hold" on EVERY key of the window.' },
                  ease_in: {
                    type: 'array',
                    items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } },
                    description: 'Per-dimension incoming ease [{ speed, influence }]. influence 0-100, speed in units/sec.'
                  },
                  ease_out: {
                    type: 'array',
                    items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } },
                    description: 'Per-dimension outgoing ease [{ speed, influence }]'
                  }
                },
                required: ['time', 'value']
              },
              description: 'Array of keyframes to add'
            }
          },
          required: ['layer_index', 'property_path', 'keyframes']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_keyframes',
        description: 'Delete keyframes from a property. Select which to delete by `times` and/or `key_indices` (1-based, same indexing as set_keyframe_easing). ONLY when BOTH are omitted does this delete ALL keyframes.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            times: { type: 'array', items: { type: 'number' }, description: 'Delete the keyframes nearest these times (within ~1ms)' },
            key_indices: { type: 'array', items: { type: 'number' }, description: '1-based keyframe indices to delete (same indexing as set_keyframe_easing key_index)' }
          },
          required: ['layer_index', 'property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_keyframe_easing',
        description: 'Set interpolation and easing on a specific keyframe by index.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            key_index: { type: 'number', description: '1-based keyframe index' },
            in_type: { type: 'string', enum: ['linear', 'bezier', 'hold'] },
            out_type: { type: 'string', enum: ['linear', 'bezier', 'hold'] },
            ease_in: { type: 'array', items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } } },
            ease_out: { type: 'array', items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } } }
          },
          required: ['layer_index', 'property_path', 'key_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'copy_ease',
        description: 'Copy the temporal easing (speed + influence, plus interpolation type) from ONE source keyframe onto other keyframes — the "make these ease like that one" operation. Dimension-aware: a 1D source ease is fanned out to every dimension of a multi-dimensional target. Use this instead of hand-computing ease_in/ease_out arrays for each keyframe.',
        parameters: {
          type: 'object',
          properties: {
            source_layer_index: { type: 'number', description: '1-based index of the layer to copy ease FROM' },
            source_layer_id: { type: 'number', description: 'Persistent id of the source layer (preferred)' },
            source_property_path: { type: 'string', description: 'Property to copy ease from, e.g. "Transform>Position"' },
            source_key_index: { type: 'number', description: '1-based source keyframe index. Omit to use the property\'s LAST keyframe.' },
            target_layer_index: { type: 'number', description: '1-based index of the layer to apply ease TO. Omit to reuse the source layer.' },
            target_layer_id: { type: 'number', description: 'Persistent id of the target layer' },
            target_property_path: { type: 'string', description: 'Property to apply ease to. Omit to reuse source_property_path.' },
            key_indices: { type: 'array', items: { type: 'number' }, description: '1-based target keyframe indices. Omit to apply to ALL keyframes of the target property.' },
            mode: { type: 'string', enum: ['both', 'in', 'out'], description: 'Which side of the ease to copy: both (default), incoming only, or outgoing only.' }
          },
          required: ['source_property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reverse_keyframes',
        description: 'Reverse the keyframe VALUES of a property in time so the animation plays backwards, keeping the original keyframe times in place. Incoming/outgoing easing is swapped per keyframe so the motion feel is preserved. Needs at least 2 keyframes.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property whose keyframes to reverse, e.g. "Transform>Position"' }
          },
          required: ['property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'shift_keyframes',
        description: 'Move ALL keyframes of one property in time by a fixed offset, preserving per-key easing and interpolation. Use align_to:"layer_in_point" to snap the first keyframe to the layer\'s in-point ("start of the layer" means the in-point, NOT comp time 0 — keyframes before the in-point play while the layer is invisible). Prefer this over deleting and re-creating keyframes.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property whose keyframes to shift, e.g. "Transform>Position" or "Effects>Fill>Color"' },
            time_offset: { type: 'number', description: 'Offset in seconds (negative = earlier). Ignored when align_to is set.' },
            align_to: { type: 'string', enum: ['layer_in_point'], description: 'Instead of a fixed offset, shift so the FIRST keyframe lands exactly on the layer\'s in-point.' }
          },
          required: ['property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'stagger_layers',
        description: 'Offset multiple layers in time to create a cascade/stagger. Layer-level timing shift (distinct from set_keyframes_batch, which staggers keyframes within one property). Layers are ordered by their comp index; each successive layer is pushed by offset*i.',
        parameters: {
          type: 'object',
          properties: {
            layer_indices: { type: 'array', items: { type: 'number' }, description: '1-based indices of the layers to stagger (at least 2), in any order — they are sorted by comp index.' },
            layer_ids: { type: 'array', items: { type: 'number' }, description: 'Optional persistent ids, parallel to layer_indices; when present each id takes precedence over the index at the same position.' },
            offset: { type: 'number', description: 'Time offset between consecutive layers.' },
            unit: { type: 'string', enum: ['seconds', 'frames'], description: 'Unit for offset (default seconds).' },
            direction: { type: 'string', enum: ['forward', 'reverse'], description: 'forward = top layer first (default); reverse = bottom layer first.' },
            mode: { type: 'string', enum: ['inPoint', 'startTime', 'keyframes'], description: 'inPoint (default) aligns then staggers layer in-points; startTime shifts layer start times; keyframes shifts every keyframe on each layer.' }
          },
          required: ['layer_indices', 'offset']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_motion_recipe',
        description: 'Apply a standard motion pattern to one or more layers in ONE call, done right by construction: keys start at each layer\'s IN-POINT (never comp 0), easy-ease, parent space handled, undo as one group. PREFER this over hand-built keyframes for: pop_in (centres the anchor without moving the layer, Scale 0→current with a small overshoot), slide_in (enters from fully OUTSIDE the frame on the chosen side and lands on the current position), fade (opacity in / out at the out-point / both), pulse (smooth scale breathing expression), orbit (parents the layer to a new rotating null at the reference layer — constant radius, one turn per `period`), follow (Position expression follows a leader layer with `delay` seconds lag, keeping the current offset), shake (camera-shake wiggle on Position + Rotation; with NO layer_ids it builds a whole-comp rig: a "Camera Shake" null at the comp centre that every 2D layer is parented to — use this for "тряска камеры" in 2D comps, where a real camera does nothing). Use `direction:"out"` for exits. Returns per-layer what was done (times, values, offscreen start point).',
        parameters: {
          type: 'object',
          properties: {
            recipe: { type: 'string', enum: ['pop_in', 'slide_in', 'fade', 'pulse', 'orbit', 'follow', 'shake'], description: 'Which pattern to apply' },
            layer_ids: { type: 'array', items: { type: 'number' }, description: 'Persistent ids of the target layers (preferred)' },
            layer_indices: { type: 'array', items: { type: 'number' }, description: '1-based indices, used when layer_ids is absent' },
            duration: { type: 'number', description: 'Seconds per layer for pop_in / slide_in / fade (default 0.6)' },
            delay: { type: 'number', description: 'Seconds after the layer\'s in-point before the motion starts (default 0). For `follow`: the lag behind the leader (default 0.5)' },
            stagger: { type: 'number', description: 'Extra seconds added per successive layer, in the given order (default 0)' },
            direction: { type: 'string', enum: ['in', 'out', 'both'], description: 'in (default) = entrance from the in-point; out = exit (fade: ends at the out-point); both = fade in and out' },
            from: { type: 'string', enum: ['left', 'right', 'top', 'bottom'], description: 'slide_in: which frame edge the layer enters from (default left)' },
            ease: { type: 'number', description: 'Easy-ease influence in percent, 0–100 (default 75)' },
            overshoot: { type: 'number', description: 'Fraction of the travel to overshoot before settling, e.g. 0.1 (pop_in defaults to 0.1, others 0)' },
            period: { type: 'number', description: 'pulse: seconds per breath (default 1); orbit: seconds per full turn (default 4)' },
            amount: { type: 'number', description: 'pulse: ± scale percent (default 10); shake: wiggle amplitude in px (default 20)' },
            frequency: { type: 'number', description: 'shake: wiggles per second (default 4)' },
            rotation: { type: 'number', description: 'shake: rotation wiggle amplitude in degrees (default 1, 0 = none)' },
            radius: { type: 'number', description: 'orbit: radius in px (default: the current distance to the reference layer)' },
            around_layer_id: { type: 'number', description: 'orbit: layer to orbit around; follow: leader layer to follow' },
            around_layer_index: { type: 'number', description: 'orbit / follow: 1-based index alternative to around_layer_id' },
            replace: { type: 'boolean', description: 'Replace existing keyframes on the animated property (default true). false = merge with existing keys' }
          },
          required: ['recipe']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'randomize_property',
        description: 'Give each of several layers a random value on one transform property — for organic variation (scatter positions, jitter rotations, vary scales). Multi-dimensional properties get an independent random per axis unless per-axis ranges are given; scale is uniform by default.',
        parameters: {
          type: 'object',
          properties: {
            layer_indices: { type: 'array', items: { type: 'number' }, description: '1-based indices of the layers to randomize.' },
            layer_ids: { type: 'array', items: { type: 'number' }, description: 'Optional persistent ids, parallel to layer_indices.' },
            property_path: { type: 'string', description: 'Property to randomize, e.g. "Transform>Rotation", "Transform>Position", "Transform>Scale", "Transform>Opacity".' },
            min: { type: 'number', description: 'Minimum random value (default 0).' },
            max: { type: 'number', description: 'Maximum random value (default 100).' },
            mode: { type: 'string', enum: ['absolute', 'offset'], description: 'absolute (default) sets the value; offset adds the random amount to the current value.' },
            min_x: { type: 'number', description: 'Per-axis override (X) for multi-dim properties.' },
            max_x: { type: 'number', description: 'Per-axis override (X).' },
            min_y: { type: 'number', description: 'Per-axis override (Y).' },
            max_y: { type: 'number', description: 'Per-axis override (Y).' },
            uniform: { type: 'boolean', description: 'Scale only: when true (default) X and Y get the same random; false randomizes axes independently.' }
          },
          required: ['layer_indices', 'property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'move_anchor_point',
        description: 'Move a layer\'s anchor point to a named position on its content bounds (center, corners, edges) WITHOUT the layer jumping — the position is compensated by the anchor delta (scaled), and keyframed anchor/position tracks are offset too. Fixes the classic "anchor moved, layer flew off" problem before adding scale/rotation.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            position: { type: 'string', enum: ['center', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'], description: 'Target anchor position on the layer\'s content bounds.' }
          },
          required: ['position']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_keyframes_batch',
        description: 'Add keyframes to MULTIPLE properties/layers in ONE host call. Preferred over repeated add_keyframes whenever you animate 2+ properties (e.g. Position + Opacity, or several layers). All edits share one undo group. Returns per-target ok/error details — on partial failure, fix and re-send only the failed targets.',
        parameters: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              description: 'Batch targets. Each item adds keyframes to one property of one layer.',
              items: {
                type: 'object',
                properties: {
                  layer_index: { type: 'number', description: '1-based layer index' },
                  layer_id: { type: 'number', description: 'Persistent layer ID (preferred when available)' },
                  property_path: { type: 'string', description: 'Property path like "Transform>Position"' },
                  keyframes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        time: { type: 'number', description: 'Time in seconds' },
                        value: { description: 'Value — number for 1D properties, array for multi-dimensional' },
                        in_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Incoming interpolation (default: bezier) — shapes the segment BEFORE this key. Note: to make a value STAY constant after a key, set that key\'s out_type to hold (in_type has no effect on what follows).' },
                        out_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Outgoing interpolation (default: bezier) — shapes the segment AFTER this key. hold = the value stays exactly at this key\'s value until the next key (no ramp). For on/off visibility windows put out_type:"hold" on EVERY key of the window.' },
                        ease_in: {
                          type: 'array',
                          items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } },
                          description: 'Per-dimension incoming ease [{ speed, influence }]. influence 0-100, speed in units/sec.'
                        },
                        ease_out: {
                          type: 'array',
                          items: { type: 'object', properties: { speed: { type: 'number' }, influence: { type: 'number' } } },
                          description: 'Per-dimension outgoing ease [{ speed, influence }]'
                        }
                      },
                      required: ['time', 'value']
                    },
                    description: 'Keyframes to add to this property'
                  }
                },
                required: ['property_path', 'keyframes']
              }
            }
          },
          required: ['targets']
        }
      }
    },

    // ── Property tools ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'set_property_value',
        description: 'Set a static value on a property that has NO keyframes. For Position use [x, y], for Scale use [x, y] as percentage, for Opacity use a number 0-100, for Rotation use degrees. On an ANIMATED property the call is refused (PROPERTY_HAS_KEYFRAMES) because a static value deletes every key — edit the keys instead; pass replace_keyframes:true only when the user explicitly wants the animation removed.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            value: { description: 'The value to set — number, array, or string depending on property type' },
            replace_keyframes: { type: 'boolean', description: 'Default false. true = delete ALL keyframes on the property and set the static value — only when the user explicitly asked for the animation to be removed.' }
          },
          required: ['layer_index', 'property_path', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_expression',
        description: 'Read the current expression on a property: expression text, enabled state, error message, and whether the property supports expressions. Use this to inspect or debug existing expressions before modifying them.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path like "Transform>Position"' }
          },
          required: ['layer_index', 'property_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_expression',
        description: 'Apply an After Effects expression to a property. The expression is JavaScript code that AE evaluates each frame. If the expression has errors, the tool returns ok:false with the error message — read it and fix the expression. To REMOVE an expression ("убери/удали экспрешен"), call this with expression:"" — that is the only way; do NOT use set_property_value, which leaves the expression in place and only changes the static value underneath it.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            expression: { type: 'string', description: 'The expression code to apply; "" removes the expression' }
          },
          required: ['layer_index', 'property_path', 'expression']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_expression_batch',
        description: 'Apply expressions to multiple properties in one host call. Use for multi-layer expression setup to reduce round trips, and for clearing expressions off many layers at once (expression:"" per target). Returns per-target success/error details.',
        parameters: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              description: 'Batch targets. Each item applies one expression to one property.',
              items: {
                type: 'object',
                properties: {
                  layer_index: { type: 'number', description: '1-based layer index' },
                  layer_id: { type: 'number', description: 'Persistent layer ID (preferred when available)' },
                  property_path: { type: 'string', description: 'Property path like "Transform>Position"' },
                  expression: { type: 'string', description: 'Expression code to apply; "" removes the expression' }
                },
                required: ['property_path', 'expression']
              }
            }
          },
          required: ['targets']
        }
      }
    },
    // ── Shape content tools ──────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'add_shape_rectangle',
        description: 'Add a rectangle shape group to a shape layer with optional fill and stroke.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            name: { type: 'string', description: 'Name for the shape group (default "Rectangle")' },
            width: { type: 'number', description: 'Rectangle width in px (default 200)' },
            height: { type: 'number', description: 'Rectangle height in px (default 200)' },
            position: { type: 'array', items: { type: 'number' }, description: '[x, y] position relative to layer anchor' },
            roundness: { type: 'number', description: 'Corner roundness in px' },
            fill_color: { type: 'array', items: { type: 'number' }, description: 'RGB fill [0-1, 0-1, 0-1]' },
            fill_opacity: { type: 'number', description: 'Fill opacity 0-100' },
            stroke_color: { type: 'array', items: { type: 'number' }, description: 'RGB stroke [0-1, 0-1, 0-1]' },
            stroke_width: { type: 'number', description: 'Stroke width in px' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_shape_ellipse',
        description: 'Add an ellipse shape group to a shape layer with optional fill and stroke.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            name: { type: 'string', description: 'Name for the shape group (default "Ellipse")' },
            width: { type: 'number', description: 'Ellipse width in px (default 200)' },
            height: { type: 'number', description: 'Ellipse height in px (default 200)' },
            position: { type: 'array', items: { type: 'number' }, description: '[x, y] position relative to layer anchor' },
            fill_color: { type: 'array', items: { type: 'number' }, description: 'RGB fill [0-1, 0-1, 0-1]' },
            fill_opacity: { type: 'number', description: 'Fill opacity 0-100' },
            stroke_color: { type: 'array', items: { type: 'number' }, description: 'RGB stroke [0-1, 0-1, 0-1]' },
            stroke_width: { type: 'number', description: 'Stroke width in px' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_shape_path',
        description: 'Add a custom bezier path to a shape layer. Vertices are [x,y] arrays in layer coordinates.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            name: { type: 'string', description: 'Name for the shape group' },
            vertices: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Array of [x, y] vertex positions (minimum 2)' },
            in_tangents: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Incoming tangent handles per vertex' },
            out_tangents: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Outgoing tangent handles per vertex' },
            closed: { type: 'boolean', description: 'Close the path (default true)' },
            fill_color: { type: 'array', items: { type: 'number' }, description: 'RGB fill [0-1, 0-1, 0-1]' },
            stroke_color: { type: 'array', items: { type: 'number' }, description: 'RGB stroke [0-1, 0-1, 0-1]' },
            stroke_width: { type: 'number', description: 'Stroke width in px' }
          },
          required: ['layer_index', 'vertices']
        }
      }
    },

    // ── 3D / Camera / Light tools ─────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'set_layer_3d',
        description: 'Enable or disable 3D on a layer. Does not apply to camera/light layers (always 3D). Never switch 2D layers to 3D just so a camera can shake or move them — use apply_motion_recipe(recipe:"shake") or a parent null instead; 3D changes rendering (perspective, sorting, blur) for the whole comp.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            enabled: { type: 'boolean', description: 'true to enable 3D, false to disable' }
          },
          required: ['layer_index', 'enabled']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_camera_properties',
        description: 'Set camera-specific properties: zoom, focus distance, aperture, blur level, depth of field.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based camera layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            zoom: { type: 'number', description: 'Camera zoom in pixels' },
            focus_distance: { type: 'number', description: 'Focus distance in pixels' },
            aperture: { type: 'number', description: 'Aperture value' },
            blur_level: { type: 'number', description: 'Blur level 0-100' },
            depth_of_field: { type: 'boolean', description: 'Enable depth of field' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_light_properties',
        description: 'Set light-specific properties: intensity, color, cone angle, cone feather.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based light layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            intensity: { type: 'number', description: 'Light intensity 0-300%' },
            color: { type: 'array', items: { type: 'number' }, description: 'RGB color [0-1, 0-1, 0-1]' },
            cone_angle: { type: 'number', description: 'Cone angle in degrees (spot lights)' },
            cone_feather: { type: 'number', description: 'Cone feather 0-100%' }
          },
          required: ['layer_index']
        }
      }
    },

    // ── Mask tools ────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'add_mask',
        description: 'Add a mask to a layer. Creates a rectangular mask by default, or use vertices for custom shape.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            mode: { type: 'string', enum: ['add', 'subtract', 'intersect', 'lighten', 'darken'], description: 'Mask mode (default "add")' },
            vertices: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Custom mask path vertices [x,y] in layer coords' },
            in_tangents: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Incoming bezier tangents' },
            out_tangents: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Outgoing bezier tangents' },
            closed: { type: 'boolean', description: 'Close the mask path (default true)' },
            feather: { type: 'number', description: 'Mask feather in px' },
            opacity: { type: 'number', description: 'Mask opacity 0-100' },
            expansion: { type: 'number', description: 'Mask expansion in px' },
            inset: { type: 'number', description: 'Inset from layer edges in px (for default rect mask)' },
            client_op_id: { type: 'string', description: 'Optional unique id for idempotency. Reuse on retry to avoid double-creating the mask.' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_mask_properties',
        description: 'Modify properties of an existing mask: feather, opacity, expansion, mode, inverted.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            mask_index: { type: 'number', description: '1-based mask index' },
            feather: { type: 'number', description: 'Mask feather in px' },
            opacity: { type: 'number', description: 'Mask opacity 0-100' },
            expansion: { type: 'number', description: 'Mask expansion in px' },
            mode: { type: 'string', enum: ['add', 'subtract', 'intersect', 'lighten', 'darken'] },
            inverted: { type: 'boolean', description: 'Invert the mask' }
          },
          required: ['layer_index', 'mask_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_mask_info',
        description: 'Read all masks on a layer: mode, feather, opacity, expansion, vertex count.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' }
          },
          required: ['layer_index']
        }
      }
    },

    // ─��� Marker tools ──────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'add_marker',
        description: 'Add a marker to a layer or the composition.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index (for layer markers)' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            target: { type: 'string', enum: ['layer', 'comp'], description: '"layer" (default) or "comp"' },
            time: { type: 'number', description: 'Time in seconds (default: current time)' },
            comment: { type: 'string', description: 'Marker comment text' },
            duration: { type: 'number', description: 'Marker duration in seconds' },
            client_op_id: { type: 'string', description: 'Optional unique id for idempotency. Reuse on retry to avoid duplicate markers at the same time.' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_markers',
        description: 'Read all markers from a layer or the composition.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            target: { type: 'string', enum: ['layer', 'comp'], description: '"layer" (default) or "comp"' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_marker',
        description: 'Delete a marker by its 1-based index.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            target: { type: 'string', enum: ['layer', 'comp'], description: '"layer" (default) or "comp"' },
            marker_index: { type: 'number', description: '1-based marker index' }
          },
          required: ['marker_index']
        }
      }
    },

    // ── Import / Project items tools ──────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'list_project_items',
        description: 'List all items in the AE project: compositions, footage, folders.',
        parameters: {
          type: 'object',
          properties: {
            max_items: { type: 'number', description: 'Max items to return (default 100)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'import_file',
        description: 'Import a file (image, video, audio) into the AE project.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute file path to import' }
          },
          required: ['file_path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_item_to_comp',
        description: 'Add a project item (footage, comp) to the active composition as a new layer.',
        parameters: {
          type: 'object',
          properties: {
            project_item_index: { type: 'number', description: '1-based project item index from list_project_items' }
          },
          required: ['project_item_index']
        }
      }
    },

    // ── Capture tool ──────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'capture_comp_frame',
        description: 'Save a composition frame as PNG. Returns the file path that can be shown as a preview image. By default captures at the current playhead time; at_time:"auto" picks a time where content layers are actually visible (useful when the playhead sits before every layer\'s in-point and the frame would be black). Never moves the playhead.',
        parameters: {
          type: 'object',
          properties: {
            at_time: {
              type: 'string',
              enum: ['current', 'auto'],
              description: '"current" (default) = capture at the playhead; "auto" = capture at an automatically chosen content-visible time.'
            }
          },
          required: []
        }
      }
    },

    // ── Expression library / linking tools ───────────────────────────
    {
      type: 'function',
      function: {
        name: 'search_expression_library',
        description: 'Search a curated library of battle-tested After Effects expression snippets (inertial bounce, typewriter, wiggle variants, loops, overshoot, stagger by index, auto-fade, squash & stretch, etc.) PLUS the user\'s personal saved snippets (marked source:"user"). Returns ready-to-apply expression code with notes and any required controller effects. ALWAYS check here before writing a non-trivial expression from scratch.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keywords describing the desired behavior, e.g. "bounce", "typewriter", "loop pingpong", "follow with delay"' },
            max_results: { type: 'number', description: 'Maximum snippets to return (default 5)' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'save_user_expression',
        description: 'Save an expression to the user\'s personal snippet library (persists in the panel, no AE call). Use when the user asks to save/remember an expression for later. Saved snippets appear in search_expression_library results marked source:"user". Include RU + EN keywords so future searches find it.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short human-readable snippet name' },
            expression: { type: 'string', description: 'The full expression code to save' },
            keywords: { type: 'string', description: 'Comma-separated search keywords, EN + RU (e.g. "shake, camera, тряска")' },
            target: { type: 'string', description: 'Property kind the snippet is meant for (e.g. "Position", "Text>Source Text")' },
            notes: { type: 'string', description: 'Usage hints: placeholders, tuning knobs, required effects' }
          },
          required: ['name', 'expression']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_user_expressions',
        description: 'List all snippets in the user\'s personal expression library (id, name, keywords, target, expression, notes). Use before delete_user_expression or when the user asks what is saved.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_user_expression',
        description: 'Delete a snippet from the user\'s personal expression library by id. Get ids from list_user_expressions. Only do this when the user explicitly asks to remove a saved snippet.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Snippet id (e.g. "ux_1753600000000_ab12")' }
          },
          required: ['id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'link_properties',
        description: 'Link a target property to a source property with a live expression (e.g. "Scale of B follows Scale of A", "Position linked to a Null controller"). Builds thisComp.layer("...") reference automatically, applies it with error checking, and returns the evaluated value. Optional scale multiplier and offset.',
        parameters: {
          type: 'object',
          properties: {
            target_layer_index: { type: 'number', description: '1-based index of the layer that RECEIVES the expression' },
            target_layer_id: { type: 'number', description: 'Persistent ID of the target layer (preferred)' },
            target_property_path: { type: 'string', description: 'Property path on the target layer, e.g. "Transform>Position"' },
            source_layer_index: { type: 'number', description: '1-based index of the layer to read FROM' },
            source_layer_id: { type: 'number', description: 'Persistent ID of the source layer (preferred)' },
            source_property_path: { type: 'string', description: 'Property path on the source layer, e.g. "Transform>Position", "Effects>Slider Control>Slider"' },
            scale: { type: 'number', description: 'Optional multiplier applied to the source value' },
            offset: { description: 'Optional offset added to the source value — number for 1D, [x, y] array for 2D properties' }
          },
          required: ['target_property_path', 'source_property_path']
        }
      }
    },

    // ── Effect tools ───────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'list_available_effects',
        description: 'Search effects actually installed in this After Effects (built-in + third-party plugins) by name substring. Returns displayName, matchName, and category. Use when unsure of the exact matchName before add_effect — never guess matchNames for exotic/third-party effects.',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', description: 'Substring to match against effect display name or matchName (case-insensitive), e.g. "glow", "blur", "particular"' },
            category: { type: 'string', description: 'Optional category filter, e.g. "Blur & Sharpen", "Stylize"' },
            max_results: { type: 'number', description: 'Maximum effects to return (default 25)' }
          },
          required: ['filter']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_effect',
        description: 'Add an effect to a layer by matchName or display name. Common effects: "ADBE Gaussian Blur 2" (Gaussian Blur), "ADBE Fill" (Fill), "ADBE Glo2" (Glow), "ADBE Drop Shadow" (Drop Shadow), "ADBE Displacement Map" (Displacement Map), "CC Particle World", "ADBE Tritone" (Tritone).',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            effect_match_name: { type: 'string', description: 'Effect matchName or display name' },
            effect_name: { type: 'string', description: 'Optional custom display name for the added effect instance (e.g. "Wiggle Freq" for a Slider Control referenced by expressions)' },
            client_op_id: { type: 'string', description: 'Optional unique id for idempotency. Reuse on retry to avoid stacking duplicate effects.' }
          },
          required: ['layer_index', 'effect_match_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'remove_effect',
        description: 'Remove an effect from a layer by effect index.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            effect_index: { type: 'number', description: '1-based effect index' }
          },
          required: ['layer_index', 'effect_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_effect_property',
        description: 'Set a value on a specific property within an effect. Prefer property_name over property_index — names are stable across AE versions; numeric indices are brittle and easy to confuse with adjacent toggles.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            effect_index: { type: 'number', description: '1-based effect index' },
            property_name: { type: 'string', description: 'Property display name within the effect (e.g. "Color", "Opacity", "Amount", "Radius"). PREFERRED — pass exact display name as shown in AE Effect Controls panel.' },
            property_index: { type: 'number', description: '1-based property index within the effect. Use only as fallback when name is unknown.' },
            value: { description: 'The value to set. Type must match the property: number for sliders/toggles, [r,g,b] or [r,g,b,a] (0..1) for colors, [x,y] for points.' }
          },
          required: ['layer_index', 'effect_index', 'value']
        }
      }
    },

    // ── Composition tools ──────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_comp',
        description: 'Create a new composition in the project.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            width: { type: 'number', description: 'Pixels (default 1920)' },
            height: { type: 'number', description: 'Pixels (default 1080)' },
            duration: { type: 'number', description: 'Seconds (default 10)' },
            frame_rate: { type: 'number', description: 'FPS (default 30)' },
            client_op_id: { type: 'string', description: 'Optional unique id for idempotency. Reuse on retry to avoid duplicate compositions.' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'precompose_layers',
        description: 'Precompose one or more layers into a new composition.',
        parameters: {
          type: 'object',
          properties: {
            layer_indices: { type: 'array', items: { type: 'number' }, description: 'Array of 1-based layer indices to precompose' },
            layer_ids: { type: 'array', items: { type: 'number' }, description: 'Array of persistent layer IDs (preferred over indices — indices shift on reorder)' },
            comp_name: { type: 'string', description: 'Name for the new precomp' },
            move_attributes: { type: 'boolean', description: 'Move layer attributes into precomp (default true)' }
          },
          required: ['comp_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_comp_settings',
        description: 'Modify active composition settings (name, dimensions, duration, frame rate, background color, comp-level motion blur switch).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            duration: { type: 'number' },
            frame_rate: { type: 'number' },
            bg_color: { type: 'array', items: { type: 'number' }, description: 'Background color RGB [0-1, 0-1, 0-1]' },
            motion_blur: { type: 'boolean', description: 'Comp-level Motion Blur master switch. Must be ON for per-layer motion blur to render.' }
          },
          required: []
        }
      }
    },

    // ── Text tools ─────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'set_text_document',
        description: 'Set text properties on a text layer (content, font, size, color, justification, tracking, leading).',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            text: { type: 'string', description: 'Text content' },
            font: { type: 'string', description: 'Font family name' },
            font_size: { type: 'number', description: 'Font size in pixels' },
            fill_color: { type: 'array', items: { type: 'number' }, description: 'RGB fill color [0-1, 0-1, 0-1]' },
            stroke_color: { type: 'array', items: { type: 'number' }, description: 'RGB stroke color' },
            stroke_width: { type: 'number' },
            justification: { type: 'string', enum: ['left', 'center', 'right', 'full'] },
            tracking: { type: 'number' },
            leading: { type: 'number' },
            baseline_shift: { type: 'number' }
          },
          required: ['layer_index']
        }
      }
    },

    // ── Create Shapes from Text ────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_shapes_from_text',
        description: 'Convert a text layer into a shape layer with vector outlines of each glyph. The original text layer is preserved. Use the resulting shape layer as a track matte, for path animations, or to extract outlines. Only works on text layers.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' }
          },
          required: ['layer_index']
        }
      }
    },

    // ── Blend mode ────────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'set_blend_mode',
        description: 'Set the blending mode of a layer (normal, add, multiply, screen, overlay, etc.)',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: 'Layer index (1-based)' },
            layer_id: { type: 'number', description: 'Layer ID (alternative to index)' },
            blend_mode: { type: 'string', description: 'Blend mode: normal, add, multiply, screen, overlay, soft_light, hard_light, difference, color_dodge, color_burn, linear_dodge, linear_burn, darken, lighten, dissolve, stencil_alpha, silhouette_alpha, alpha_add, luminescent_premul' }
          },
          required: ['blend_mode']
        }
      }
    },

    // ── Track matte / switches / time remap / split / open comp ───────────
    {
      type: 'function',
      function: {
        name: 'set_track_matte',
        description: 'Set or remove a track matte on a layer (alpha/luma reveals). The matte layer defines transparency for the target layer. Specify matte_layer_index/matte_layer_id to pick any layer as matte (AE 23+); on older AE only the layer directly above works. matte_type "none" removes the matte.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based index of the layer that RECEIVES the matte' },
            layer_id: { type: 'number', description: 'Persistent layer ID (alternative to index)' },
            matte_type: { type: 'string', enum: ['alpha', 'alpha_inverted', 'luma', 'luma_inverted', 'none'], description: 'Matte mode. alpha = matte layer alpha channel, luma = matte layer brightness.' },
            matte_layer_index: { type: 'number', description: '1-based index of the layer to USE as the matte (optional — defaults to the layer directly above)' },
            matte_layer_id: { type: 'number', description: 'Persistent ID of the matte layer' }
          },
          required: ['layer_index', 'matte_type']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_layer_switches',
        description: 'Toggle layer switches: visibility (enabled), motion_blur, adjustment, shy, solo, locked, guide, collapse_transformation (continuous rasterization), effects_active, audio_enabled. Only the switches you pass are changed. NOTE: per-layer motion_blur also needs the comp-level switch — set_comp_settings { motion_blur: true }.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            enabled: { type: 'boolean', description: 'Layer visibility (eyeball)' },
            motion_blur: { type: 'boolean', description: 'Per-layer motion blur switch' },
            adjustment: { type: 'boolean', description: 'Make this an adjustment layer' },
            shy: { type: 'boolean' },
            solo: { type: 'boolean' },
            locked: { type: 'boolean' },
            guide: { type: 'boolean', description: 'Guide layer (excluded from render)' },
            collapse_transformation: { type: 'boolean', description: 'Collapse transformations / continuously rasterize' },
            effects_active: { type: 'boolean', description: 'Master effects on/off for the layer' },
            audio_enabled: { type: 'boolean' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_time_remap',
        description: 'Enable/disable time remapping on a footage or precomp layer. After enabling, animate the "Time Remap" property (value = source time in seconds) with add_keyframes / set_keyframe_easing for freeze frames and speed ramps. Shape/text/solid layers must be precomposed first.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            enabled: { type: 'boolean', description: 'true to enable time remapping, false to disable' }
          },
          required: ['layer_index', 'enabled']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'split_layer',
        description: 'Split a layer at a time (like Edit > Split Layer): the original keeps everything before the split time, a duplicate placed directly above plays everything after. Returns indices/ids of both parts.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            time: { type: 'number', description: 'Split time in seconds — must be strictly between the layer in-point and out-point' }
          },
          required: ['layer_index', 'time']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'open_comp',
        description: 'Open a composition in the viewer and make it the ACTIVE comp for all subsequent tools. Use after precompose_layers or create_comp to work inside the result, or to switch between comps. Find comp ids via list_project_items.',
        parameters: {
          type: 'object',
          properties: {
            comp_id: { type: 'number', description: 'Project item id of the comp (preferred — returned by list_project_items, create_comp, precompose_layers)' },
            comp_name: { type: 'string', description: 'Exact comp name (fails if ambiguous)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'transcribe_comp_audio',
        description: 'Transcribe the ACTIVE comp audio with Whisper (speech-to-text). Renders the comp audio to a temp AIFF via the render queue, uploads it, and returns timed text segments. Segments are cached panel-side — call create_subtitles right after (no need to pass segments back). For comps longer than ~90s of audio, transcribe in chunks via start_time/end_time. Read-only: does not modify the project.',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string', description: 'REQUIRED. ISO 639-1 code of the speech language, e.g. "ru", "en". The endpoint rejects requests without it — ask the user if unsure.' },
            start_time: { type: 'number', description: 'Optional chunk start in comp seconds (default: comp start)' },
            end_time: { type: 'number', description: 'Optional chunk end in comp seconds (default: comp end)' }
          },
          required: ['language']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_subtitles',
        description: 'Create an animated subtitle layer from transcription segments (uses the segments cached by the last transcribe_comp_audio automatically — normally call with just styling options). Builds readable cues (smart line wrap, splits long phrases), sets Source Text hold keyframes, pins the text block to the bottom/center/top, optionally adds a background box and a per-word animation (word-by-word reveal or CapCut-style karaoke highlight). Pass `segments` explicitly only to override/correct the cached transcription.',
        parameters: {
          type: 'object',
          properties: {
            segments: {
              type: 'array',
              description: 'Optional override: [{startSec, endSec, text}]. Omit to use the cached transcription.',
              items: {
                type: 'object',
                properties: {
                  startSec: { type: 'number' },
                  endSec: { type: 'number' },
                  text: { type: 'string' }
                },
                required: ['startSec', 'endSec', 'text']
              }
            },
            layer_name: { type: 'string', description: 'Subtitle layer name (default "Subtitles")' },
            font: { type: 'string', description: 'PostScript font name (e.g. "ArialMT"). Default: current AE default' },
            font_size: { type: 'number', description: 'Font size in px (default ~4.5% of comp height)' },
            fill_color: { type: 'array', items: { type: 'number' }, description: 'Text color [r,g,b] 0-1 (default white)' },
            position: { type: 'string', description: '"bottom" (default), "center", or "top". Defaults sit inside YouTube safe zones: on 16:9 the text clears the bottom ~12% player controls; on vertical (Shorts) comps it sits at ~70% height, clear of the bottom-UI and side action buttons' },
            box: { type: 'boolean', description: 'Background box behind the text (default true; default false for animation "karaoke", which has its own plate)' },
            box_color: { type: 'array', items: { type: 'number' }, description: 'Box color [r,g,b] 0-1 (default black)' },
            box_opacity: { type: 'number', description: 'Box opacity 0-100 (default 60)' },
            animation: { type: 'string', description: '"word_reveal" (default; words appear one by one), "karaoke" (CapCut style: a colored plate travels under the word being spoken and that word switches color; forces single-line cues), or "none" (whole cue at once)' },
            highlight_color: { type: 'array', items: { type: 'number' }, description: 'Karaoke plate color [r,g,b] 0-1 (default yellow [1,0.84,0])' },
            highlight_text_color: { type: 'array', items: { type: 'number' }, description: 'Karaoke color of the spoken word [r,g,b] 0-1 (default near-black)' },
            max_chars_per_line: { type: 'number', description: 'Line wrap width in characters (default 20)' },
            max_lines: { type: 'number', description: 'Max lines per cue (default 2; ignored for "karaoke")' },
            max_cue_duration: { type: 'number', description: 'Max seconds per cue before splitting (default 4)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_subtitles',
        description: 'Fix the TEXT of an EXISTING subtitle rig (created by create_subtitles) without breaking its animation: keyframes are rewritten in place on the same layers and all timing is preserved (a word-count change only redistributes time inside that one cue). Use this when the transcription misheard a word — do NOT delete and re-create the rig. Call with NO `edits` first to get the numbered cue list, then pass edits: {find, replace} fixes a word/phrase wherever it occurs (case-insensitive), {cue_index, text} replaces one cue\u2019s whole text (1-based index from the listing).',
        parameters: {
          type: 'object',
          properties: {
            layer_id: { type: 'number', description: 'id of the subtitle TEXT layer. Omit to auto-detect the single subtitle rig in the active comp (errors list candidates if there are several)' },
            edits: {
              type: 'array',
              description: 'Text edits. Omit to just LIST the cues with indices and timing. Each item: {find, replace} or {cue_index, text}.',
              items: {
                type: 'object',
                properties: {
                  find: { type: 'string', description: 'Word or phrase to find (case-insensitive, matched on the cue text with line breaks flattened)' },
                  replace: { type: 'string', description: 'Replacement text (may be empty to delete the word)' },
                  cue_index: { type: 'number', description: '1-based cue number from the listing (alternative to find/replace)' },
                  text: { type: 'string', description: 'New full text for that cue (used with cue_index)' }
                }
              }
            }
          },
          required: []
        }
      }
    }
  ]

  if (typeof window !== 'undefined') {
    window.AGENT_TOOL_REGISTRY = { tools: tools }
  }
})()
