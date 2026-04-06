/**
 * Agent Tool Registry — OpenAI-compatible function definitions for all AE operations.
 * These are sent via the `tools` parameter in chat/completions API calls.
 */
(function () {
  'use strict'

  var tools = [
    // ── Read tools ─────────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'get_detailed_comp_summary',
        description: 'Get a summary of the active composition: layers, types, parents, effects, timing, expressions, 3D status, dimensions. Always call this first. For large comps (20+ layers), use compact:true or filters to reduce token usage.',
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

    // ── Layer mutation tools ───────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'create_layer',
        description: 'Create a new layer in the active composition. Types: solid, shape, text, null, adjustment, camera, light.',
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
            font_size: { type: 'number', description: 'Font size for text layers' }
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
        description: 'Set in point, out point, and/or start time for a layer (in seconds).',
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
        description: 'Add keyframes to a property. Each keyframe has time, value, and optional easing. For multi-dimensional properties (Position, Scale), value is an array like [x, y] or [x, y, z].',
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
                  in_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Incoming interpolation (default: bezier)' },
                  out_type: { type: 'string', enum: ['linear', 'bezier', 'hold'], description: 'Outgoing interpolation (default: bezier)' },
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
        description: 'Delete keyframes from a property. If times array is empty or omitted, deletes ALL keyframes.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            times: { type: 'array', items: { type: 'number' }, description: 'Specific times to delete at (omit for all)' }
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

    // ── Property tools ─────────────────────────────────────────────────
    {
      type: 'function',
      function: {
        name: 'set_property_value',
        description: 'Set a static value on a property (removes keyframes). For Position use [x, y], for Scale use [x, y] as percentage, for Opacity use a number 0-100, for Rotation use degrees.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            value: { description: 'The value to set — number, array, or string depending on property type' }
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
        description: 'Apply an After Effects expression to a property. The expression is JavaScript code that AE evaluates each frame. If the expression has errors, the tool returns ok:false with the error message — read it and fix the expression.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            property_path: { type: 'string', description: 'Property path' },
            expression: { type: 'string', description: 'The expression code to apply' }
          },
          required: ['layer_index', 'property_path', 'expression']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_expression_batch',
        description: 'Apply expressions to multiple properties in one host call. Use for multi-layer expression setup to reduce round trips. Returns per-target success/error details.',
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
                  expression: { type: 'string', description: 'Expression code to apply' }
                },
                required: ['property_path', 'expression']
              }
            }
          },
          required: ['targets']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_fade_preset',
        description: 'Apply deterministic fade motion preset on layer Opacity with fixed keyframe/easing recipe.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID (preferred over index)' },
            duration: { type: 'number', description: 'Fade duration in seconds. Allowed range: 0.05..5.' },
            delay: { type: 'number', description: 'Start delay in seconds from current comp time. Allowed range: 0..10.' },
            direction: { type: 'string', enum: ['in', 'out'], description: 'Fade direction. in: 0→100 opacity, out: 100→0 opacity.' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_pop_preset',
        description: 'Apply deterministic pop motion preset on Scale + Opacity with fixed keyframe/easing recipe.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID (preferred over index)' },
            duration: { type: 'number', description: 'Pop duration in seconds. Allowed range: 0.08..5.' },
            delay: { type: 'number', description: 'Start delay in seconds from current comp time. Allowed range: 0..10.' },
            direction: { type: 'string', enum: ['in', 'out'], description: 'Pop direction. in: reveal, out: exit.' },
            intensity: { type: 'number', description: 'Pop intensity multiplier. Allowed range: 0.2..1.5.' }
          },
          required: ['layer_index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'apply_slide_preset',
        description: 'Apply deterministic slide motion preset on Position + Opacity with fixed keyframe/easing recipe.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID (preferred over index)' },
            duration: { type: 'number', description: 'Slide duration in seconds. Allowed range: 0.08..6.' },
            delay: { type: 'number', description: 'Start delay in seconds from current comp time. Allowed range: 0..10.' },
            direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Slide source direction.' },
            amplitude: { type: 'number', description: 'Slide distance in pixels. Allowed range: 8..2000.' }
          },
          required: ['layer_index']
        }
      }
    },

    // ── Effect tools ───────────────────────────────────────────────────
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
            effect_match_name: { type: 'string', description: 'Effect matchName or display name' }
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
        description: 'Set a value on a specific property within an effect.',
        parameters: {
          type: 'object',
          properties: {
            layer_index: { type: 'number', description: '1-based layer index' },
            layer_id: { type: 'number', description: 'Persistent layer ID' },
            effect_index: { type: 'number', description: '1-based effect index' },
            property_index: { type: 'number', description: '1-based property index within the effect' },
            value: { description: 'The value to set' }
          },
          required: ['layer_index', 'effect_index', 'property_index', 'value']
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
            frame_rate: { type: 'number', description: 'FPS (default 30)' }
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
            comp_name: { type: 'string', description: 'Name for the new precomp' },
            move_attributes: { type: 'boolean', description: 'Move layer attributes into precomp (default true)' }
          },
          required: ['layer_indices', 'comp_name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'set_comp_settings',
        description: 'Modify active composition settings (name, dimensions, duration, frame rate).',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            duration: { type: 'number' },
            frame_rate: { type: 'number' }
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
    }
  ]

  if (typeof window !== 'undefined') {
    window.AGENT_TOOL_REGISTRY = { tools: tools }
  }
})()
