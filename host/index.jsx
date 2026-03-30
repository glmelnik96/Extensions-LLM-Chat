/**
 * ExtendScript host entry point for the Extensions LLM Chat panel.
 *
 * This file defines the bridge function that the CEP panel calls via CSInterface.evalScript.
 * It applies a given expression string to the currently selected property, when possible.
 */

//@target aftereffects

/**
 * Resolve the "active composition" in a defensive way.
 *
 * This accounts for cases where:
 * - app.project.activeItem is null
 * - app.project.activeItem is not a CompItem (e.g. Project panel selection)
 * - there is an active composition viewer whose comp differs from activeItem
 *
 * Returns a plain object (not JSON) with shape:
 * {
 *   ok: boolean,
 *   statusCode: string,      // e.g. 'NO_PROJECT', 'NO_COMP', 'COMP_FROM_ACTIVE_ITEM', 'COMP_FROM_VIEWER'
 *   message: string,
 *   compName: string,
 *   comp: CompItem|null,
 *   viewerType: string,      // best-effort description of active viewer type
 *   projectActiveItemType: string // best-effort description of app.project.activeItem
 * }
 */
function extensionsLlmChat_resolveActiveComp () {
  var ctx = {
    ok: false,
    statusCode: '',
    message: '',
    compName: '',
    comp: null,
    viewerType: '',
    projectActiveItemType: '',
  };

  if (!app || !app.project) {
    ctx.statusCode = 'NO_PROJECT';
    ctx.message = 'No active project in After Effects.';
    return ctx;
  }

  function isCompItem (item) {
    if (!item) return false;
    // Primary check: real CompItem instance.
    try {
      if (item instanceof CompItem) return true;
    } catch (e1) {}
    // Fallback structural check: comps have numLayers and layer().
    try {
      if (
        typeof item.numLayers === 'number' &&
        typeof item.layer === 'function'
      ) {
        return true;
      }
    } catch (e2) {}
    return false;
  }

  var activeItem = null;
  try {
    activeItem = app.project.activeItem;
  } catch (eActiveItem) {
    activeItem = null;
  }

  if (activeItem) {
    try {
      if (isCompItem(activeItem)) {
        ctx.projectActiveItemType = 'CompItem';
      } else {
        ctx.projectActiveItemType = '' + activeItem;
      }
    } catch (eType1) {
      ctx.projectActiveItemType = 'Unknown';
    }
  } else {
    ctx.projectActiveItemType = 'None';
  }

  var viewer = null;
  try {
    viewer = app.activeViewer;
  } catch (eViewer) {
    viewer = null;
  }

  var viewerType = '';
  if (viewer) {
    try {
      // In modern AE, viewer.type is a ViewerType enum; stringify it for diagnostics.
      viewerType = '' + viewer.type;
    } catch (eViewerType) {
      viewerType = 'Unknown';
    }
  } else {
    viewerType = 'None';
  }
  ctx.viewerType = viewerType;

  // 1) Prefer a real CompItem from app.project.activeItem when available.
  if (isCompItem(activeItem)) {
    ctx.ok = true;
    ctx.statusCode = 'COMP_FROM_ACTIVE_ITEM';
    ctx.comp = activeItem;
    ctx.compName = activeItem.name;
    ctx.message =
      'Active composition is "' +
      activeItem.name +
      '" (from project activeItem).';
    return ctx;
  }

  // 2) If activeItem is not a comp, but the active viewer is a composition viewer,
  //    activate it so that app.project.activeItem becomes the comp. When the user
  //    has clicked in the CEP panel, app.activeViewer is often null, so this may
  //    not run; we fall back in step 4.
  var isCompositionViewer = false;
  if (viewer) {
    try {
      if (typeof ViewerType !== 'undefined' && viewer.type === ViewerType.VIEWER_COMPOSITION) {
        isCompositionViewer = true;
      }
    } catch (eType) {}
    if (!isCompositionViewer && viewer.type !== undefined) {
      isCompositionViewer = String(viewer.type).indexOf('COMPOSITION') !== -1;
    }
    if (isCompositionViewer && typeof viewer.setActive === 'function') {
      try {
        viewer.setActive();
      } catch (eSetActive2) {}
      try {
        activeItem = app.project.activeItem;
      } catch (eActiveItem2) {
        activeItem = null;
      }
      if (isCompItem(activeItem)) {
        ctx.ok = true;
        ctx.statusCode = 'COMP_FROM_VIEWER';
        ctx.comp = activeItem;
        ctx.compName = activeItem.name;
        ctx.projectActiveItemType = 'CompItem';
        ctx.message =
          'Active composition is "' +
          activeItem.name +
          '" (from composition viewer).';
        return ctx;
      }
    }
  }

  // 3) No comp from activeItem or viewer; try first composition in project as fallback.
  //    This handles the case where the user has a comp open but the CEP panel has focus,
  //    so app.activeViewer is null and activeItem may not be the comp.
  var numItems = 0;
  try {
    numItems = app.project.numItems;
  } catch (eNum) {}
  for (var iProj = 1; iProj <= numItems; iProj++) {
    var item = null;
    try {
      item = app.project.item(iProj);
    } catch (eItem) {
      continue;
    }
    if (item && isCompItem(item)) {
      ctx.ok = true;
      ctx.statusCode = 'COMP_FROM_PROJECT_FALLBACK';
      ctx.comp = item;
      ctx.compName = item.name;
      ctx.message =
        'Using composition "' +
        item.name +
        '". To use a different comp: select it in the Project panel or click in its timeline, then press @ again.';
      return ctx;
    }
  }

  // 4) No usable composition found.
  if (!activeItem && !viewer) {
    ctx.statusCode = 'NO_ACTIVE_ITEM_OR_VIEWER';
    ctx.message =
      'No active composition and no composition in project. Open a comp and try again.';
    return ctx;
  }

  if (!activeItem && viewer) {
    ctx.statusCode = 'NO_ACTIVE_ITEM_VIEWER_NOT_COMP';
    ctx.message =
      'No active composition: the active viewer is not linked to a composition.';
    return ctx;
  }

  ctx.statusCode = 'ACTIVE_ITEM_NOT_COMP';
  ctx.message =
    'No active composition: the current project selection is not a composition in the timeline.';
  return ctx;
}

function extensionsLlmChat_applyExpression (expressionText) {
  var result = {
    ok: false,
    message: '',
  };

  if (typeof expressionText !== 'string' || !expressionText.length) {
    result.ok = false;
    result.message = 'No expression text was provided to the host.';
    return resultToJson(result);
  }

  var ctx = extensionsLlmChat_resolveActiveComp();
  if (!ctx.ok || !ctx.comp) {
    result.ok = false;
    result.message = ctx.message || 'No active composition. Please select a composition and a property, then try again.';
    return resultToJson(result);
  }

  var comp = ctx.comp;
  var selectedProps = comp.selectedProperties;

  if (!selectedProps || selectedProps.length === 0) {
    result.ok = false;
    result.message = 'No property is selected. Select a property that can have an expression and try again.';
    return resultToJson(result);
  }

  // Find the first selected property that can accept an expression.
  var targetProp = null;
  var i;
  for (i = 0; i < selectedProps.length; i++) {
    var p = selectedProps[i];
    // Only apply to actual properties that support expressions.
    if (p instanceof Property && p.canSetExpression === true) {
      targetProp = p;
      break;
    }
  }

  if (!targetProp) {
    result.ok = false;
    result.message = 'The selected property cannot accept an expression. Choose a property that supports expressions (e.g. Transform, Effect, Text, etc.).';
    return resultToJson(result);
  }

  // Build a short, user-friendly description for messaging.
  var propName = targetProp.name;
  var layerName = '';
  try {
    var group = targetProp.propertyGroup(targetProp.propertyDepth);
    if (group && group instanceof AVLayer) {
      layerName = group.name;
    }
  } catch (e) {
    // Best-effort only; ignore if we cannot safely resolve the layer name.
  }

  try {
    app.beginUndoGroup('Apply Extensions LLM Chat Expression');
    targetProp.expression = expressionText;
    targetProp.expressionEnabled = true;
    app.endUndoGroup();
  } catch (e2) {
    try {
      app.endUndoGroup();
    } catch (ignored) {}

    result.ok = false;
    result.message = 'Failed to apply expression: ' + e2.toString();
    return resultToJson(result);
  }

  result.ok = true;
  if (layerName && layerName.length) {
    result.message = 'Expression applied to "' + propName + '" on layer "' + layerName + '".';
  } else {
    result.message = 'Expression applied to "' + propName + '".';
  }

  return resultToJson(result);
}

/**
 * Return a summary of the active composition: its name, layers and a curated
 * set of common properties that can accept expressions.
 *
 * The result is a JSON string:
 * {
 *   ok: boolean,
 *   message: string,
 *   compName: string,
 *   layers: [
 *     {
 *       index: number,
 *       name: string,
 *       type: string,
 *       properties: [
 *         {
 *           path: string,        // e.g. "Transform>Position"
 *           displayName: string, // e.g. "Transform › Position"
 *           canSetExpression: boolean
 *         },
 *         ...
 *       ]
 *     },
 *     ...
 *   ]
 * }
 */
function extensionsLlmChat_getActiveCompSummary () {
  var result = {
    ok: false,
    message: '',
    compName: '',
    layers: [],
  };

  try {
    var ctx = extensionsLlmChat_resolveActiveComp();

    if (!ctx.ok || !ctx.comp) {
      result.ok = false;
      result.message =
        ctx.message || 'No active composition. Please select a comp in the timeline.';
      // Expose detection diagnostics to the panel.
      result.compStatusCode = ctx.statusCode || '';
      result.viewerType = ctx.viewerType || '';
      result.projectActiveItemType = ctx.projectActiveItemType || '';
      return resultToJson(result);
    }

    var comp = ctx.comp;
    result.compName = comp.name;

    var i;
    for (i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      if (!layer) {
        continue;
      }

      var layerInfo = {
        index: layer.index,
        id: layer.id,
        name: layer.name,
        type: layer.matchName || 'Layer',
        properties: [],
      };

      // Helper to push a property if it exists and can accept expressions.
      function addPropMatch (groupMatchName, propMatchName, pathLabel, displayName) {
        try {
          var group = layer.property(groupMatchName);
          if (!group) return;
          var prop = group.property(propMatchName);
          if (!prop) return;
          if (prop.canSetExpression === true) {
            layerInfo.properties.push({
              path: pathLabel,
              displayName: displayName,
              canSetExpression: true,
            });
          }
        } catch (e) {
          // Best-effort only; ignore and move on.
        }
      }

      // Common transform properties (use stable matchNames)
      addPropMatch('ADBE Transform Group', 'ADBE Position', 'Transform>Position', 'Transform \u203A Position');
      addPropMatch('ADBE Transform Group', 'ADBE Scale', 'Transform>Scale', 'Transform \u203A Scale');
      addPropMatch('ADBE Transform Group', 'ADBE Rotate Z', 'Transform>Rotation', 'Transform \u203A Rotation');
      addPropMatch('ADBE Transform Group', 'ADBE Opacity', 'Transform>Opacity', 'Transform \u203A Opacity');

      // Text: Source Text (use text matchNames)
      try {
        var textGroup = layer.property('ADBE Text Properties');
        if (textGroup) {
          var sourceTextProp = textGroup.property('ADBE Text Document');
          if (sourceTextProp && sourceTextProp.canSetExpression === true) {
            layerInfo.properties.push({
              path: 'Text>Source Text',
              displayName: 'Text \u203A Source Text',
              canSetExpression: true,
            });
          }
        }
      } catch (eText) {
        // Ignore text-related errors.
      }

      if (layerInfo.properties.length > 0) {
        result.layers.push(layerInfo);
      }
    }

    if (result.layers.length === 0) {
      result.ok = false;
      result.message =
        'Active composition "' +
        comp.name +
        '" has no layers with standard properties that can accept expressions.';
      result.compStatusCode = 'COMP_NO_EXPRESSABLE_LAYERS';
      result.viewerType = ctx.viewerType || '';
      result.projectActiveItemType = ctx.projectActiveItemType || '';
      return resultToJson(result);
    }

    result.ok = true;
    result.message =
      'Found ' + result.layers.length + ' layer(s) in active composition "' + comp.name + '".';
    result.compStatusCode = ctx.statusCode || 'COMP_AVAILABLE';
    result.viewerType = ctx.viewerType || '';
    result.projectActiveItemType = ctx.projectActiveItemType || '';
    return resultToJson(result);
  } catch (e2) {
    result.ok = false;
    result.message = 'Error while reading active composition: ' + e2.toString();
    return resultToJson(result);
  }
}

/**
 * Structured host context for LLM grounding (timeline selection, time, work area).
 * Returns JSON: ok, compName, time, workArea*, selectedLayers[], selectedProperties[], ...
 */
function extensionsLlmChat_getHostContext () {
  var result = {
    ok: false,
    message: '',
    compName: '',
    compStatusCode: '',
    viewerType: '',
    projectActiveItemType: '',
    time: null,
    workAreaStart: null,
    workAreaDuration: null,
    compDuration: null,
    fps: null,
    selectedLayers: [],
    selectedProperties: [],
  };

  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    result.compStatusCode = ctx.statusCode || '';
    result.viewerType = ctx.viewerType || '';
    result.projectActiveItemType = ctx.projectActiveItemType || '';

    if (!ctx.ok || !ctx.comp) {
      result.message = ctx.message || 'No active composition.';
      return resultToJson(result);
    }

    var comp = ctx.comp;
    result.ok = true;
    result.compName = comp.name;
    result.message = 'Host context OK.';
    try {
      result.time = comp.time;
    } catch (eT) {
      result.time = null;
    }
    try {
      result.workAreaStart = comp.workAreaStart;
      result.workAreaDuration = comp.workAreaDuration;
      result.compDuration = comp.duration;
      result.fps = comp.frameRate;
    } catch (eW) {}

    var i;
    for (i = 1; i <= comp.numLayers; i++) {
      try {
        var lyr = comp.layer(i);
        if (!lyr) continue;
        if (lyr.selected === true) {
          result.selectedLayers.push({
            index: lyr.index,
            id: lyr.id,
            name: lyr.name,
            matchName: lyr.matchName || '',
          });
        }
      } catch (eL) {}
    }

    try {
      var selProps = comp.selectedProperties;
      if (selProps && typeof selProps.length === 'number') {
        var j;
        for (j = 0; j < selProps.length; j++) {
          try {
            var pr = selProps[j];
            if (!pr) continue;
            var entry = {
              name: String(pr.name || ''),
              matchName: pr.matchName ? String(pr.matchName) : '',
            };
            try {
              if (pr.canSetExpression !== undefined) {
                entry.canSetExpression = pr.canSetExpression === true;
              }
            } catch (eC) {}
            result.selectedProperties.push(entry);
          } catch (eP) {}
        }
      }
    } catch (eSel) {}

    return resultToJson(result);
  } catch (eOuter) {
    result.ok = false;
    result.message = 'extensionsLlmChat_getHostContext error: ' + eOuter.toString();
    return resultToJson(result);
  }
}

/**
 * Save the active composition's current frame as PNG (requires CompItem.saveFrameToPng).
 * @param {string} absolutePath POSIX path to output .png file
 */
function extensionsLlmChat_saveCompFramePng (absolutePath) {
  var result = {
    ok: false,
    message: '',
    path: '',
  };

  try {
    if (typeof absolutePath !== 'string' || !absolutePath.length) {
      result.message = 'No output path for saveCompFramePng.';
      return resultToJson(result);
    }

    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) {
      result.message = ctx.message || 'No active composition.';
      result.compStatusCode = ctx.statusCode || '';
      return resultToJson(result);
    }

    var comp = ctx.comp;
    if (typeof comp.saveFrameToPng !== 'function') {
      result.ok = false;
      result.message =
        'This After Effects build does not provide comp.saveFrameToPng. Use a supported AE version or screen capture (full screen / preview) instead.';
      return resultToJson(result);
    }

    var outFile = new File(absolutePath);
    try {
      var parent = outFile.parent;
      if (parent && !parent.exists) {
        parent.create();
      }
    } catch (eMk) {}

    comp.saveFrameToPng(comp.time, outFile);
    result.ok = true;
    try {
      result.path = outFile.fsName ? String(outFile.fsName) : String(absolutePath);
    } catch (ePath) {
      result.path = String(absolutePath);
    }
    try {
      result.fileSize = outFile.length;
    } catch (eLen) {}
    result.message = 'Saved frame at t=' + comp.time + 's.';
    return resultToJson(result);
  } catch (eSave) {
    result.ok = false;
    result.message = 'saveFrameToPng failed: ' + eSave.toString();
    return resultToJson(result);
  }
}

/**
 * Apply an expression directly to a specific layer/property combination,
 * identified by layer index and a simple property path string like
 * "Transform>Position" or "Text>Source Text".
 *
 * Returns the same JSON shape as extensionsLlmChat_applyExpression().
 */
function extensionsLlmChat_applyExpressionToTarget (layerIndex, layerId, propertyPath, expressionText) {
  var result = {
    ok: false,
    message: '',
  };

  try {
    if (typeof expressionText !== 'string' || !expressionText.length) {
      result.ok = false;
      result.message = 'No expression text was provided to the host.';
      return resultToJson(result);
    }

    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) {
      result.ok = false;
      result.message =
        ctx.message || 'Please select a composition in the timeline and try again.';
      result.compStatusCode = ctx.statusCode || '';
      result.viewerType = ctx.viewerType || '';
      result.projectActiveItemType = ctx.projectActiveItemType || '';
      return resultToJson(result);
    }

    var comp = ctx.comp;

    var layer = null;
    var hasValidLayerId =
      typeof layerId === 'number' && layerId >= 0;

    // Prefer resolving by persistent layer id when provided.
    if (hasValidLayerId) {
      try {
        for (var li = 1; li <= comp.numLayers; li++) {
          var candidate = comp.layer(li);
          if (candidate && candidate.id === layerId) {
            layer = candidate;
            break;
          }
        }
      } catch (eLayerScan) {
        layer = null;
      }
    }

    // Fallback to layerIndex when id was not provided or lookup failed.
    if (!layer) {
      if (typeof layerIndex !== 'number' || layerIndex < 1 || layerIndex > comp.numLayers) {
        result.ok = false;
        result.message = 'Invalid or out-of-range layer index for the active composition.';
        return resultToJson(result);
      }

      layer = comp.layer(layerIndex);
      if (!layer) {
        result.ok = false;
        result.message = 'Layer with the specified index no longer exists.';
        return resultToJson(result);
      }
    }

    if (typeof propertyPath !== 'string' || !propertyPath.length) {
      result.ok = false;
      result.message = 'No property path was provided.';
      return resultToJson(result);
    }

    // Resolve propertyPath in a locale-independent way.
    // We currently support a small, curated set of paths like:
    // "Transform>Position", "Transform>Scale", "Transform>Rotation",
    // "Transform>Opacity", "Text>Source Text".
    var current = null;
    if (propertyPath === 'Transform>Position') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Position');
    } else if (propertyPath === 'Transform>Scale') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Scale');
    } else if (propertyPath === 'Transform>Rotation') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Rotate Z');
    } else if (propertyPath === 'Transform>Opacity') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Opacity');
    } else if (propertyPath === 'Text>Source Text') {
      current = layer.property('ADBE Text Properties');
      if (current) current = current.property('ADBE Text Document');
    } else {
      // Fallback: try to interpret the path segments as display names.
      var segments = propertyPath.split('>');
      var i;
      current = layer;
      for (i = 0; i < segments.length; i++) {
        var segName = segments[i];
        if (!segName) {
          current = null;
          break;
        }
        current = current.property(segName);
        if (!current) break;
      }
    }

    if (!current) {
      result.ok = false;
      result.message =
        'Property path "' + propertyPath + '" could not be resolved on layer "' + layer.name + '".';
      return resultToJson(result);
    }

    var targetProp = current;
    if (!(targetProp instanceof Property) || targetProp.canSetExpression !== true) {
      result.ok = false;
      result.message =
        'The resolved property cannot accept an expression. Choose a compatible property and try again.';
      return resultToJson(result);
    }

    var propName = targetProp.name;
    var layerName = layer.name;

    try {
      app.beginUndoGroup('Apply Extensions LLM Chat Expression to Target');
      targetProp.expression = expressionText;
      targetProp.expressionEnabled = true;
      app.endUndoGroup();
    } catch (e3) {
      try {
        app.endUndoGroup();
      } catch (ignored) {}

      result.ok = false;
      result.message = 'Failed to apply expression to target: ' + e3.toString();
      return resultToJson(result);
    }

    result.ok = true;
    result.message =
      'Expression applied to "' + propName + '" on layer "' + layerName + '" in comp "' + comp.name + '".';
    result.compStatusCode = ctx.statusCode || 'COMP_AVAILABLE';
    result.viewerType = ctx.viewerType || '';
    result.projectActiveItemType = ctx.projectActiveItemType || '';
    return resultToJson(result);
  } catch (eOuter) {
    result.ok = false;
    result.message = 'Unexpected error in host while applying expression: ' + eOuter.toString();
    return resultToJson(result);
  }
}

/**
 * Apply multiple expressions in one undo group.
 * @param {Array} targets [{ layerIndex, layerId, propertyPath, expressionText }]
 */
function extensionsLlmChat_applyExpressionBatch (targets) {
  var result = {
    ok: false,
    message: '',
    appliedCount: 0,
    failedCount: 0,
    results: [],
  };

  function resolveTargetProperty (layer, propertyPath) {
    var current = null;
    if (propertyPath === 'Transform>Position') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Position');
    } else if (propertyPath === 'Transform>Scale') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Scale');
    } else if (propertyPath === 'Transform>Rotation') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Rotate Z');
    } else if (propertyPath === 'Transform>Opacity') {
      current = layer.property('ADBE Transform Group');
      if (current) current = current.property('ADBE Opacity');
    } else if (propertyPath === 'Text>Source Text') {
      current = layer.property('ADBE Text Properties');
      if (current) current = current.property('ADBE Text Document');
    } else {
      var segments = propertyPath.split('>');
      current = layer;
      for (var i = 0; i < segments.length; i++) {
        var segName = segments[i];
        if (!segName) {
          current = null;
          break;
        }
        current = current.property(segName);
        if (!current) break;
      }
    }
    return current;
  }

  try {
    if (!(targets instanceof Array) || targets.length === 0) {
      result.message = 'No batch targets provided.';
      return resultToJson(result);
    }

    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) {
      result.message = ctx.message || 'No active composition.';
      result.compStatusCode = ctx.statusCode || '';
      return resultToJson(result);
    }

    var comp = ctx.comp;
    app.beginUndoGroup('Apply Extensions LLM Chat Expression Batch');

    for (var ti = 0; ti < targets.length; ti++) {
      var t = targets[ti];
      var itemResult = { ok: false, index: ti, message: '' };
      try {
        if (!t || typeof t !== 'object') {
          itemResult.message = 'Target item is not an object.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }
        var expressionText = typeof t.expressionText === 'string' ? t.expressionText : '';
        var propertyPath = typeof t.propertyPath === 'string' ? t.propertyPath : '';
        var layerId = typeof t.layerId === 'number' ? t.layerId : null;
        var layerIndex =
          typeof t.layerIndex === 'number' ? t.layerIndex : parseInt(t.layerIndex, 10);

        if (!expressionText.length || !propertyPath.length || !(layerIndex >= 1)) {
          itemResult.message = 'Target item is missing layer/property/expression.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var layer = null;
        if (layerId !== null) {
          for (var li = 1; li <= comp.numLayers; li++) {
            var candidate = comp.layer(li);
            if (candidate && candidate.id === layerId) {
              layer = candidate;
              break;
            }
          }
        }
        if (!layer) {
          if (layerIndex < 1 || layerIndex > comp.numLayers) {
            itemResult.message = 'Layer index out of range.';
            result.failedCount++;
            result.results.push(itemResult);
            continue;
          }
          layer = comp.layer(layerIndex);
        }
        if (!layer) {
          itemResult.message = 'Layer not found.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var targetProp = resolveTargetProperty(layer, propertyPath);
        if (!(targetProp instanceof Property) || targetProp.canSetExpression !== true) {
          itemResult.message = 'Resolved property cannot accept expressions.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        targetProp.expression = expressionText;
        targetProp.expressionEnabled = true;
        itemResult.ok = true;
        itemResult.message = 'Applied to layer "' + layer.name + '" → "' + targetProp.name + '".';
        result.appliedCount++;
        result.results.push(itemResult);
      } catch (eItem) {
        itemResult.message = 'Item apply failed: ' + eItem.toString();
        result.failedCount++;
        result.results.push(itemResult);
      }
    }

    try {
      app.endUndoGroup();
    } catch (eEnd) {}

    result.ok = result.failedCount === 0;
    result.message =
      'Batch apply finished: ' + result.appliedCount + ' succeeded, ' + result.failedCount + ' failed.';
    result.compStatusCode = ctx.statusCode || 'COMP_AVAILABLE';
    result.viewerType = ctx.viewerType || '';
    result.projectActiveItemType = ctx.projectActiveItemType || '';
    return resultToJson(result);
  } catch (eOuter) {
    try {
      app.endUndoGroup();
    } catch (ignored) {}
    result.ok = false;
    result.message = 'Unexpected error in batch apply: ' + eOuter.toString();
    return resultToJson(result);
  }
}

function resultToJson (obj) {
  // Recursive JSON stringifier for simple objects and arrays used by this panel.
  // ExtendScript does not have JSON.stringify by default in older versions, so we
  // provide a minimal, safe implementation.
  function serializeValue (value) {
    if (value === null || value === undefined) {
      return 'null';
    }
    var t = typeof value;
    if (t === 'string') {
      return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    if (t === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (t === 'number') {
      return value.toString();
    }
    // Arrays
    if (value instanceof Array) {
      var items = [];
      for (var i = 0; i < value.length; i++) {
        items.push(serializeValue(value[i]));
      }
      return '[' + items.join(',') + ']';
    }
    // Plain objects (best-effort; ignores prototype chain).
    var parts = [];
    for (var key in value) {
      if (!value.hasOwnProperty(key)) continue;
      parts.push('"' + key + '":' + serializeValue(value[key]));
    }
    return '{' + parts.join(',') + '}';
  }

  return serializeValue(obj);
}

