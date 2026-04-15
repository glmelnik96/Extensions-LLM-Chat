/**
 * extractAnimationParams.jsx
 *
 * Standalone ExtendScript for After Effects.
 * Run via: File > Scripts > Run Script File
 *
 * Extracts ALL animation parameters from every composition in the current project:
 * structure, transforms, keyframes with easing, masks, effects, expressions,
 * shape paths (vertices/tangents), text document properties.
 *
 * Output: JSON file on Desktop named "{ProjectName}_animation_params.json"
 */
(function () {
  // =========================================================================
  // Configuration
  // =========================================================================
  var CONFIG = {
    outputFolder: Folder.desktop,
    maxPropertyDepth: 20,
    // Set to array of comp names to filter, or null for ALL comps
    compFilter: null
  };

  // =========================================================================
  // JSON Serializer (ES3-compatible)
  // =========================================================================
  function jsonStringify(val, depth) {
    if (depth === undefined) depth = 0;
    if (depth > CONFIG.maxPropertyDepth) return '"[max depth]"';

    if (val === null || val === undefined) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
      if (isNaN(val)) return 'null';
      if (!isFinite(val)) return 'null';
      return String(val);
    }
    if (typeof val === 'string') return '"' + escapeJsonString(val) + '"';

    // Array
    if (val instanceof Array) {
      if (val.length === 0) return '[]';
      var arrParts = [];
      for (var i = 0; i < val.length; i++) {
        arrParts.push(jsonStringify(val[i], depth + 1));
      }
      return '[' + arrParts.join(',') + ']';
    }

    // Object
    if (typeof val === 'object') {
      var objParts = [];
      for (var k in val) {
        if (!val.hasOwnProperty(k)) continue;
        objParts.push('"' + escapeJsonString(k) + '":' + jsonStringify(val[k], depth + 1));
      }
      if (objParts.length === 0) return '{}';
      return '{' + objParts.join(',') + '}';
    }

    return '"' + escapeJsonString(String(val)) + '"';
  }

  function escapeJsonString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') out += '\\"';
      else if (c === '\\') out += '\\\\';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else {
        var code = s.charCodeAt(i);
        if (code < 32) {
          var hex = code.toString(16);
          while (hex.length < 4) hex = '0' + hex;
          out += '\\u' + hex;
        } else {
          out += c;
        }
      }
    }
    return out;
  }

  // =========================================================================
  // Helpers
  // =========================================================================
  function safeGet(fn) {
    try { return fn(); } catch (e) { return null; }
  }

  function getLayerType(layer) {
    if (layer instanceof CameraLayer) return 'camera';
    if (layer instanceof LightLayer) return 'light';
    if (layer instanceof ShapeLayer) return 'shape';
    if (layer instanceof TextLayer) return 'text';
    try { if (layer.nullLayer) return 'null'; } catch (e) {}
    try { if (layer.adjustmentLayer) return 'adjustment'; } catch (e) {}
    try { if (layer.source instanceof CompItem) return 'precomp'; } catch (e) {}
    return 'av';
  }

  function blendModeToString(mode) {
    var map = {};
    try {
      map[BlendingMode.NORMAL] = 'normal';
      map[BlendingMode.ADD] = 'add';
      map[BlendingMode.MULTIPLY] = 'multiply';
      map[BlendingMode.SCREEN] = 'screen';
      map[BlendingMode.OVERLAY] = 'overlay';
      map[BlendingMode.SOFT_LIGHT] = 'softLight';
      map[BlendingMode.HARD_LIGHT] = 'hardLight';
      map[BlendingMode.DIFFERENCE] = 'difference';
      map[BlendingMode.COLOR_DODGE] = 'colorDodge';
      map[BlendingMode.COLOR_BURN] = 'colorBurn';
      map[BlendingMode.LINEAR_DODGE] = 'linearDodge';
      map[BlendingMode.LINEAR_BURN] = 'linearBurn';
      map[BlendingMode.DISSOLVE] = 'dissolve';
      map[BlendingMode.DARKEN] = 'darken';
      map[BlendingMode.LIGHTEN] = 'lighten';
      map[BlendingMode.CLASSIC_COLOR_DODGE] = 'classicColorDodge';
      map[BlendingMode.CLASSIC_COLOR_BURN] = 'classicColorBurn';
      map[BlendingMode.STENCIL_ALPHA] = 'stencilAlpha';
      map[BlendingMode.SILHOUETTE_ALPHA] = 'silhouetteAlpha';
      map[BlendingMode.ALPHA_ADD] = 'alphaAdd';
      map[BlendingMode.LUMINESCENT_PREMUL] = 'luminescentPremul';
    } catch (e) {}
    return map[mode] || String(mode);
  }

  function interpTypeToString(type) {
    try {
      if (type === KeyframeInterpolationType.LINEAR) return 'linear';
      if (type === KeyframeInterpolationType.BEZIER) return 'bezier';
      if (type === KeyframeInterpolationType.HOLD) return 'hold';
    } catch (e) {}
    return String(type);
  }

  function maskModeToString(mode) {
    var map = {};
    try {
      map[MaskMode.NONE] = 'none';
      map[MaskMode.ADD] = 'add';
      map[MaskMode.SUBTRACT] = 'subtract';
      map[MaskMode.INTERSECT] = 'intersect';
      map[MaskMode.LIGHTEN] = 'lighten';
      map[MaskMode.DARKEN] = 'darken';
      map[MaskMode.DIFFERENCE] = 'difference';
    } catch (e) {}
    return map[mode] || String(mode);
  }

  function trackMatteToString(type) {
    var map = {};
    try {
      map[TrackMatteType.NO_TRACK_MATTE] = 'none';
      map[TrackMatteType.ALPHA] = 'alpha';
      map[TrackMatteType.ALPHA_INVERTED] = 'alphaInverted';
      map[TrackMatteType.LUMA] = 'luma';
      map[TrackMatteType.LUMA_INVERTED] = 'lumaInverted';
    } catch (e) {}
    return map[type] || String(type);
  }

  // =========================================================================
  // Value Serializers
  // =========================================================================
  function serializePropertyValue(val) {
    if (val === null || val === undefined) return null;

    // Shape object (mask path, vector path)
    if (val.vertices !== undefined && val.vertices instanceof Array) {
      return serializeShapeValue(val);
    }

    // TextDocument object
    if (typeof val.text === 'string' || (typeof val.toString === 'function' && String(val).indexOf('TextDocument') !== -1)) {
      try { return serializeTextDocument(val); } catch (e) {}
    }

    // Array (AE arrays may not be standard JS arrays)
    if (val instanceof Array) {
      var arr = [];
      for (var i = 0; i < val.length; i++) arr.push(val[i]);
      return arr;
    }

    return val;
  }

  function serializeShapeValue(shape) {
    var result = { _type: 'shape', closed: false, vertices: [], inTangents: [], outTangents: [] };
    try { result.closed = shape.closed; } catch (e) {}
    try {
      for (var i = 0; i < shape.vertices.length; i++) {
        var v = shape.vertices[i];
        result.vertices.push([v[0], v[1]]);
      }
    } catch (e) {}
    try {
      for (var j = 0; j < shape.inTangents.length; j++) {
        var it = shape.inTangents[j];
        result.inTangents.push([it[0], it[1]]);
      }
    } catch (e) {}
    try {
      for (var k = 0; k < shape.outTangents.length; k++) {
        var ot = shape.outTangents[k];
        result.outTangents.push([ot[0], ot[1]]);
      }
    } catch (e) {}
    return result;
  }

  function serializeTextDocument(doc) {
    var td = { _type: 'textDocument' };
    try { td.text = doc.text; } catch (e) {}
    try { td.font = doc.font; } catch (e) {}
    try { td.fontSize = doc.fontSize; } catch (e) {}
    try { td.fillColor = [doc.fillColor[0], doc.fillColor[1], doc.fillColor[2]]; } catch (e) {}
    try { td.strokeColor = [doc.strokeColor[0], doc.strokeColor[1], doc.strokeColor[2]]; } catch (e) {}
    try { td.strokeWidth = doc.strokeWidth; } catch (e) {}
    try { td.applyFill = doc.applyFill; } catch (e) {}
    try { td.applyStroke = doc.applyStroke; } catch (e) {}
    try { td.tracking = doc.tracking; } catch (e) {}
    try { td.leading = doc.leading; } catch (e) {}
    try { td.justification = String(doc.justification); } catch (e) {}
    try { td.baselineShift = doc.baselineShift; } catch (e) {}
    try { td.allCaps = doc.allCaps; } catch (e) {}
    try { td.smallCaps = doc.smallCaps; } catch (e) {}
    try { td.fauxBold = doc.fauxBold; } catch (e) {}
    try { td.fauxItalic = doc.fauxItalic; } catch (e) {}
    return td;
  }

  // =========================================================================
  // Keyframe Extractor
  // =========================================================================
  function extractKeyframes(prop) {
    if (!prop || prop.numKeys === 0) return [];
    var keyframes = [];
    for (var i = 1; i <= prop.numKeys; i++) {
      var kf = {
        time: prop.keyTime(i),
        value: serializePropertyValue(prop.keyValue(i))
      };

      // Interpolation types
      try {
        kf.inInterp = interpTypeToString(prop.keyInInterpolationType(i));
        kf.outInterp = interpTypeToString(prop.keyOutInterpolationType(i));
      } catch (e) {}

      // Temporal ease (speed + influence per dimension)
      try {
        var teIn = prop.keyInTemporalEase(i);
        var teOut = prop.keyOutTemporalEase(i);
        kf.easeIn = [];
        kf.easeOut = [];
        for (var d = 0; d < teIn.length; d++) {
          kf.easeIn.push({ speed: teIn[d].speed, influence: teIn[d].influence });
        }
        for (var d2 = 0; d2 < teOut.length; d2++) {
          kf.easeOut.push({ speed: teOut[d2].speed, influence: teOut[d2].influence });
        }
      } catch (e) {}

      // Spatial tangents (for Position)
      try {
        var stIn = prop.keyInSpatialTangent(i);
        var stOut = prop.keyOutSpatialTangent(i);
        if (stIn) kf.spatialTangentIn = [stIn[0], stIn[1], stIn[2] || 0];
        if (stOut) kf.spatialTangentOut = [stOut[0], stOut[1], stOut[2] || 0];
      } catch (e) {}

      try { kf.roving = prop.keyRoving(i); } catch (e) {}

      keyframes.push(kf);
    }
    return keyframes;
  }

  // =========================================================================
  // Property Extractors
  // =========================================================================
  function extractProperty(prop, path) {
    if (!prop) return null;
    var result = {
      name: prop.name,
      matchName: safeGet(function () { return prop.matchName; }),
      path: path
    };

    try { result.numKeys = prop.numKeys; } catch (e) { result.numKeys = 0; }

    // Value
    try {
      result.value = serializePropertyValue(prop.value);
    } catch (e) {}

    // Keyframes
    if (result.numKeys > 0) {
      result.keyframes = extractKeyframes(prop);
    }

    // Expression
    try {
      if (prop.canSetExpression) {
        result.expressionEnabled = prop.expressionEnabled;
        if (prop.expression && prop.expression.length > 0) {
          result.expression = prop.expression;
        }
        if (prop.expressionError && prop.expressionError.length > 0) {
          result.expressionError = prop.expressionError;
        }
      }
    } catch (e) {}

    return result;
  }

  function safeExtractProp(group, matchName, path) {
    try {
      var p = group.property(matchName);
      if (p) return extractProperty(p, path || matchName);
    } catch (e) {}
    return null;
  }

  // =========================================================================
  // Recursive Property Group Walker
  // =========================================================================
  function walkPropertyGroup(group, path, depth) {
    if (depth > CONFIG.maxPropertyDepth) return null;
    if (!group) return null;

    var result = {
      name: group.name,
      matchName: safeGet(function () { return group.matchName; }),
      path: path,
      _type: 'group',
      properties: []
    };

    try { result.enabled = group.enabled; } catch (e) {}

    var count = 0;
    try { count = group.numProperties; } catch (e) { return result; }

    for (var i = 1; i <= count; i++) {
      var child = null;
      try { child = group.property(i); } catch (e) { continue; }
      if (!child) continue;

      var childPath = path ? (path + '>' + child.name) : child.name;

      try {
        if (child.propertyType === PropertyType.PROPERTY) {
          var propData = extractProperty(child, childPath);
          if (propData) result.properties.push(propData);
        } else {
          // PropertyGroup or IndexedGroup
          var sub = walkPropertyGroup(child, childPath, depth + 1);
          if (sub) result.properties.push(sub);
        }
      } catch (e) {}
    }

    return result;
  }

  // =========================================================================
  // Transform Extractor (targeted, fast)
  // =========================================================================
  function extractTransform(layer) {
    var tg = null;
    try { tg = layer.property('ADBE Transform Group'); } catch (e) {}
    if (!tg) return null;

    var result = {};
    result.anchorPoint = safeExtractProp(tg, 'ADBE Anchor Point', 'Transform>Anchor Point');
    result.position = safeExtractProp(tg, 'ADBE Position', 'Transform>Position');
    result.scale = safeExtractProp(tg, 'ADBE Scale', 'Transform>Scale');
    result.rotation = safeExtractProp(tg, 'ADBE Rotate Z', 'Transform>Rotation');
    result.opacity = safeExtractProp(tg, 'ADBE Opacity', 'Transform>Opacity');

    // 3D
    try {
      if (layer.threeDLayer) {
        result.xRotation = safeExtractProp(tg, 'ADBE Rotate X', 'Transform>X Rotation');
        result.yRotation = safeExtractProp(tg, 'ADBE Rotate Y', 'Transform>Y Rotation');
        result.orientation = safeExtractProp(tg, 'ADBE Orientation', 'Transform>Orientation');
      }
    } catch (e) {}

    // Separated position
    try {
      var posProp = tg.property('ADBE Position');
      if (posProp && posProp.dimensionsSeparated) {
        result.positionSeparated = true;
        result.xPosition = safeExtractProp(tg, 'ADBE Position_0', 'Transform>X Position');
        result.yPosition = safeExtractProp(tg, 'ADBE Position_1', 'Transform>Y Position');
        if (layer.threeDLayer) {
          result.zPosition = safeExtractProp(tg, 'ADBE Position_2', 'Transform>Z Position');
        }
      }
    } catch (e) {}

    return result;
  }

  // =========================================================================
  // Mask Extractor
  // =========================================================================
  function extractMasks(layer) {
    var maskGroup = null;
    try { maskGroup = layer.property('ADBE Mask Parade'); } catch (e) {}
    if (!maskGroup || maskGroup.numProperties === 0) return [];

    var masks = [];
    for (var mi = 1; mi <= maskGroup.numProperties; mi++) {
      try {
        var m = maskGroup.property(mi);
        var basePath = 'Masks>' + m.name;
        var info = {
          index: mi,
          name: m.name
        };

        try { info.mode = maskModeToString(m.property('ADBE Mask Mode').value); } catch (e) {}
        try { info.inverted = m.property('ADBE Mask Inverted').value; } catch (e) {}

        info.maskShape = safeExtractProp(m, 'ADBE Mask Shape', basePath + '>Mask Path');
        info.feather = safeExtractProp(m, 'ADBE Mask Feather', basePath + '>Mask Feather');
        info.opacity = safeExtractProp(m, 'ADBE Mask Opacity', basePath + '>Mask Opacity');
        info.expansion = safeExtractProp(m, 'ADBE Mask Offset', basePath + '>Mask Expansion');

        masks.push(info);
      } catch (e) {}
    }
    return masks;
  }

  // =========================================================================
  // Effects Extractor (recursive walker per effect)
  // =========================================================================
  function extractEffects(layer) {
    var fxGroup = null;
    try { fxGroup = layer.property('ADBE Effect Parade'); } catch (e) {}
    if (!fxGroup || fxGroup.numProperties === 0) return [];

    var effects = [];
    for (var fi = 1; fi <= fxGroup.numProperties; fi++) {
      try {
        var eff = fxGroup.property(fi);
        var effData = walkPropertyGroup(eff, 'Effects>' + eff.name, 0);
        if (effData) {
          effData.matchName = eff.matchName;
          try { effData.enabled = eff.enabled; } catch (e) {}
          effects.push(effData);
        }
      } catch (e) {}
    }
    return effects;
  }

  // =========================================================================
  // Shape Content Extractor (recursive walker)
  // =========================================================================
  function extractShapeContent(layer) {
    if (!(layer instanceof ShapeLayer)) return null;
    var contents = null;
    try { contents = layer.property('ADBE Root Vectors Group'); } catch (e) {}
    if (!contents) return null;
    return walkPropertyGroup(contents, 'Contents', 0);
  }

  // =========================================================================
  // Text Properties Extractor
  // =========================================================================
  function extractTextProperties(layer) {
    if (!(layer instanceof TextLayer)) return null;
    var textGroup = null;
    try { textGroup = layer.property('ADBE Text Properties'); } catch (e) {}
    if (!textGroup) return null;

    var result = {};

    // Source Text (may be keyframed, value is TextDocument)
    var sourceText = safeGet(function () { return textGroup.property('ADBE Text Document'); });
    if (sourceText) {
      result.sourceText = extractProperty(sourceText, 'Text>Source Text');
    }

    // Text Animators (recursive)
    var animators = safeGet(function () { return textGroup.property('ADBE Text Animators'); });
    if (animators && animators.numProperties > 0) {
      result.animators = walkPropertyGroup(animators, 'Text>Animators', 0);
    }

    // Path Options
    var pathOpts = safeGet(function () { return textGroup.property('ADBE Text Path Options'); });
    if (pathOpts && pathOpts.numProperties > 0) {
      result.pathOptions = walkPropertyGroup(pathOpts, 'Text>Path Options', 0);
    }

    // More Options
    var moreOpts = safeGet(function () { return textGroup.property('ADBE Text More Options'); });
    if (moreOpts && moreOpts.numProperties > 0) {
      result.moreOptions = walkPropertyGroup(moreOpts, 'Text>More Options', 0);
    }

    return result;
  }

  // =========================================================================
  // Expression Collector (flat list for convenience)
  // =========================================================================
  function collectExpressions(layer) {
    var expressions = [];

    function walk(group, path) {
      var count = 0;
      try { count = group.numProperties; } catch (e) { return; }
      for (var i = 1; i <= count; i++) {
        var child = null;
        try { child = group.property(i); } catch (e) { continue; }
        if (!child) continue;
        var childPath = path ? (path + '>' + child.name) : child.name;

        try {
          if (child.propertyType === PropertyType.PROPERTY) {
            if (child.expression && child.expression.length > 0) {
              expressions.push({
                path: childPath,
                matchName: child.matchName,
                expression: child.expression,
                enabled: child.expressionEnabled,
                error: child.expressionError || ''
              });
            }
          } else if (child.numProperties !== undefined) {
            walk(child, childPath);
          }
        } catch (e) {}
      }
    }

    for (var g = 1; g <= layer.numProperties; g++) {
      try { walk(layer.property(g), layer.property(g).name); } catch (e) {}
    }

    return expressions;
  }

  // =========================================================================
  // Layer Extractor
  // =========================================================================
  function extractLayer(layer) {
    var info = {
      index: layer.index,
      name: layer.name,
      type: getLayerType(layer),
      enabled: safeGet(function () { return layer.enabled; }),
      solo: safeGet(function () { return layer.solo; }),
      shy: safeGet(function () { return layer.shy; }),
      locked: safeGet(function () { return layer.locked; }),
      label: safeGet(function () { return layer.label; }),
      inPoint: safeGet(function () { return layer.inPoint; }),
      outPoint: safeGet(function () { return layer.outPoint; }),
      startTime: safeGet(function () { return layer.startTime; }),
      stretch: safeGet(function () { return layer.stretch; }),
      threeDLayer: safeGet(function () { return layer.threeDLayer === true; }) || false,
      blendMode: safeGet(function () { return blendModeToString(layer.blendMode); }),
      parentIndex: null,
      parentName: null,
      trackMatteType: null,
      hasTrackMatte: safeGet(function () { return layer.hasTrackMatte; }),
      isTrackMatte: safeGet(function () { return layer.isTrackMatte; }),
      autoOrient: null
    };

    try { if (layer.parent) { info.parentIndex = layer.parent.index; info.parentName = layer.parent.name; } } catch (e) {}
    try { info.trackMatteType = trackMatteToString(layer.trackMatteType); } catch (e) {}
    try { info.autoOrient = String(layer.autoOrient); } catch (e) {}

    // Source reference
    try {
      if (layer.source) {
        info.source = { name: layer.source.name };
        if (layer.source instanceof CompItem) {
          info.source.type = 'composition';
        } else {
          info.source.type = 'footage';
          try { info.source.width = layer.source.width; } catch (e) {}
          try { info.source.height = layer.source.height; } catch (e) {}
        }
      }
    } catch (e) {}

    // Subsections
    info.transform = extractTransform(layer);
    info.masks = extractMasks(layer);
    info.effects = extractEffects(layer);
    info.expressions = collectExpressions(layer);
    info.textProperties = extractTextProperties(layer);
    info.shapeContent = extractShapeContent(layer);

    return info;
  }

  // =========================================================================
  // Composition Extractor
  // =========================================================================
  function extractComposition(comp) {
    var data = {
      name: comp.name,
      width: comp.width,
      height: comp.height,
      pixelAspect: comp.pixelAspect,
      duration: comp.duration,
      frameRate: comp.frameRate,
      workAreaStart: comp.workAreaStart,
      workAreaDuration: comp.workAreaDuration,
      numLayers: comp.numLayers,
      layers: []
    };

    try { data.bgColor = [comp.bgColor[0], comp.bgColor[1], comp.bgColor[2]]; } catch (e) {}

    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        data.layers.push(extractLayer(comp.layer(i)));
      } catch (e) {
        data.layers.push({ index: i, error: e.toString() });
      }
    }

    return data;
  }

  // =========================================================================
  // Main
  // =========================================================================
  if (!app || !app.project) { alert('No project open.'); return; }

  var project = app.project;
  var projectName = 'untitled';
  try {
    projectName = project.file ? project.file.name.replace(/\.aep$/i, '') : 'untitled';
  } catch (e) {}

  // Collect compositions
  var compItems = [];
  for (var i = 1; i <= project.numItems; i++) {
    var item = project.item(i);
    if (!(item instanceof CompItem)) continue;
    if (CONFIG.compFilter !== null) {
      var found = false;
      for (var f = 0; f < CONFIG.compFilter.length; f++) {
        if (CONFIG.compFilter[f] === item.name) { found = true; break; }
      }
      if (!found) continue;
    }
    compItems.push(item);
  }

  if (compItems.length === 0) {
    alert('No compositions found' + (CONFIG.compFilter ? ' matching filter.' : '.'));
    return;
  }

  // Progress
  var totalComps = compItems.length;
  var output = {
    projectName: projectName,
    extractedAt: new Date().toString(),
    aeVersion: app.version,
    totalCompositions: totalComps,
    compositions: []
  };

  for (var ci = 0; ci < compItems.length; ci++) {
    try {
      if (app.beginUndoGroup) {} // keep AE alive
      output.compositions.push(extractComposition(compItems[ci]));
    } catch (e) {
      output.compositions.push({ name: compItems[ci].name, error: e.toString() });
    }
  }

  // Write JSON
  var jsonStr = jsonStringify(output, 0);
  var outFile = new File(CONFIG.outputFolder.fsName + '/' + projectName + '_animation_params.json');
  outFile.open('w');
  outFile.encoding = 'UTF-8';
  outFile.write(jsonStr);
  outFile.close();

  alert('Extracted ' + output.compositions.length + ' composition(s) to:\n' + outFile.fsName);
})();
