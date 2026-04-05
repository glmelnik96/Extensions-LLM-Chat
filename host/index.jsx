/**
 * ExtendScript host entry point for the Extensions LLM Chat panel.
 *
 * This file defines the bridge function that the CEP panel calls via CSInterface.evalScript.
 * It applies a given expression string to the currently selected property, when possible.
 */

//@target aftereffects

// ============================================================================
// Undo helpers.
// Each tool call gets its own undo group. The panel counts mutating
// tool calls and can batch-undo them via N × app.executeCommand(16).
// ============================================================================

/**
 * Begin an undo group for the current tool operation.
 */
function _beginToolUndo (label) {
  app.beginUndoGroup(label);
}

/**
 * End the current undo group.
 */
function _endToolUndo () {
  try { app.endUndoGroup(); } catch (e) {}
}

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
    _beginToolUndo('Apply Expression');
    targetProp.expression = expressionText;
    targetProp.expressionEnabled = true;
    _endToolUndo();
  } catch (e2) {
    try {
      _endToolUndo();
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

    // Resolve propertyPath using the shared _resolveProperty helper.
    var current = _resolveProperty(layer, propertyPath);

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
      _beginToolUndo('Apply Expression to Target');
      targetProp.expression = expressionText;
      targetProp.expressionEnabled = true;

      // Check if AE flagged an expression error (AE does not throw on bad expressions).
      var exprErr = '';
      try { exprErr = targetProp.expressionError || ''; } catch (eCheck) {}
      if (exprErr && exprErr.length > 0) {
        // Roll back the broken expression.
        try {
          targetProp.expression = '';
          targetProp.expressionEnabled = false;
        } catch (eRollback) {}
        _endToolUndo();
        result.ok = false;
        result.message = 'Expression error on "' + propName + '" (layer "' + layerName + '"): ' + exprErr;
        result.expressionError = exprErr;
        return resultToJson(result);
      }

      _endToolUndo();
    } catch (e3) {
      try {
        _endToolUndo();
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

  // Use the shared _resolveProperty function (no local duplicate).

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
    _beginToolUndo('Apply Expression Batch');

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

        var targetProp = _resolveProperty(layer, propertyPath);
        if (!(targetProp instanceof Property) || targetProp.canSetExpression !== true) {
          itemResult.message = 'Resolved property cannot accept expressions.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        targetProp.expression = expressionText;
        targetProp.expressionEnabled = true;

        // Check for expression error (AE does not throw on bad expressions).
        var batchExprErr = '';
        try { batchExprErr = targetProp.expressionError || ''; } catch (eBatchCheck) {}
        if (batchExprErr && batchExprErr.length > 0) {
          try {
            targetProp.expression = '';
            targetProp.expressionEnabled = false;
          } catch (eBatchRollback) {}
          itemResult.ok = false;
          itemResult.message = 'Expression error on "' + targetProp.name + '" (layer "' + layer.name + '"): ' + batchExprErr;
          itemResult.expressionError = batchExprErr;
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

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
      _endToolUndo();
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
      _endToolUndo();
    } catch (ignored) {}
    result.ok = false;
    result.message = 'Unexpected error in batch apply: ' + eOuter.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Resolve a layer inside a comp by persistent id (preferred) or by index.
 * Returns the Layer or null.
 */
function _resolveLayer (comp, layerIndex, layerId) {
  var layer = null;
  // Prefer persistent id.
  if (typeof layerId === 'number' && layerId >= 0) {
    try {
      for (var li = 1; li <= comp.numLayers; li++) {
        var c = comp.layer(li);
        if (c && c.id === layerId) { layer = c; break; }
      }
    } catch (e) { layer = null; }
  }
  // Fallback to index.
  if (!layer) {
    if (typeof layerIndex === 'number' && layerIndex >= 1 && layerIndex <= comp.numLayers) {
      try { layer = comp.layer(layerIndex); } catch (e2) { layer = null; }
    }
  }
  return layer;
}

/**
 * Well-known property path → matchName fast-path map.
 * Format: "Group>Prop" → ["ADBE Group MatchName", "ADBE Prop MatchName"]
 */
var _KNOWN_PATHS = {
  'Transform>Anchor Point': ['ADBE Transform Group', 'ADBE Anchor Point'],
  'Transform>Position':     ['ADBE Transform Group', 'ADBE Position'],
  'Transform>Scale':        ['ADBE Transform Group', 'ADBE Scale'],
  'Transform>Rotation':     ['ADBE Transform Group', 'ADBE Rotate Z'],
  'Transform>X Rotation':   ['ADBE Transform Group', 'ADBE Rotate X'],
  'Transform>Y Rotation':   ['ADBE Transform Group', 'ADBE Rotate Y'],
  'Transform>Opacity':      ['ADBE Transform Group', 'ADBE Opacity'],
  'Text>Source Text':       ['ADBE Text Properties', 'ADBE Text Document'],
};

/**
 * Resolve a property on a layer given a path string like "Transform>Position",
 * "Effects>Gaussian Blur>Blurriness", etc.
 * Returns the Property/PropertyGroup or null.
 */
function _resolveProperty (layer, propertyPath) {
  if (!layer || typeof propertyPath !== 'string' || !propertyPath.length) return null;

  // Fast-path for well-known paths.
  var known = _KNOWN_PATHS[propertyPath];
  if (known) {
    try {
      var g = layer.property(known[0]);
      if (g) return g.property(known[1]);
    } catch (e) {}
    return null;
  }

  // Generic segment walk.
  // AE property() accepts matchNames and display names, but for shape layer
  // content the display names (e.g. "Ellipse 1") don't always resolve via
  // property(name). We try direct lookup first, then scan children by name.
  var segments = propertyPath.split('>');
  var current = layer;
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (!seg) { current = null; break; }
    var next = null;
    // Try direct lookup (works for matchNames and most display names).
    try { next = current.property(seg); } catch (e2) { next = null; }
    // If direct lookup failed and current is a group, scan children by name.
    if (!next && current.numProperties !== undefined) {
      try {
        var segLower = seg.toLowerCase();
        for (var ci = 1; ci <= current.numProperties; ci++) {
          try {
            var child = current.property(ci);
            if (child && child.name && child.name.toLowerCase() === segLower) {
              next = child;
              break;
            }
          } catch (eChild) {}
        }
      } catch (eScan) {}
    }
    if (!next) { current = null; break; }
    current = next;
  }
  return current;
}

/**
 * Describe a layer type as a friendly string.
 */
function _layerTypeString (layer) {
  if (!layer) return 'unknown';
  try {
    if (layer instanceof CameraLayer) return 'camera';
    if (layer instanceof LightLayer) return 'light';
    if (layer instanceof ShapeLayer) return 'shape';
    if (layer instanceof TextLayer) return 'text';
    if (layer.nullLayer === true) return 'null';
    if (layer.adjustmentLayer === true) return 'adjustment';
    if (layer.source && layer.source instanceof CompItem) return 'precomp';
    return 'av';
  } catch (e) { return 'unknown'; }
}

// ============================================================================
// Layer operations
// ============================================================================

/**
 * Create a new layer in the active composition.
 * @param {string} layerType  'solid'|'shape'|'text'|'null'|'adjustment'|'camera'|'light'
 * @param {string} name       Layer name
 * @param {object} opts       Optional: { color:[r,g,b], width, height, duration, text, fontSize }
 */
function extensionsLlmChat_createLayer (layerType, name, opts) {
  var result = { ok: false, message: '', layerIndex: null, layerId: null, layerName: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    if (!opts || typeof opts !== 'object') opts = {};

    var layer = null;
    var w = typeof opts.width === 'number' ? opts.width : comp.width;
    var h = typeof opts.height === 'number' ? opts.height : comp.height;
    var dur = typeof opts.duration === 'number' ? opts.duration : comp.duration;
    var col = (opts.color instanceof Array && opts.color.length >= 3)
      ? opts.color : [0.5, 0.5, 0.5];
    var layerName = (typeof name === 'string' && name.length) ? name : layerType;

    _beginToolUndo('Agent: Create layer');

    if (layerType === 'solid') {
      layer = comp.layers.addSolid(col, layerName, w, h, 1, dur);
    } else if (layerType === 'shape') {
      layer = comp.layers.addShape();
      layer.name = layerName;
    } else if (layerType === 'text') {
      var textDoc = new TextDocument(typeof opts.text === 'string' ? opts.text : '');
      if (typeof opts.fontSize === 'number') textDoc.fontSize = opts.fontSize;
      if (typeof opts.font === 'string') textDoc.font = opts.font;
      layer = comp.layers.addText(textDoc);
      layer.name = layerName;
    } else if (layerType === 'null') {
      layer = comp.layers.addNull(dur);
      layer.name = layerName;
    } else if (layerType === 'adjustment') {
      layer = comp.layers.addSolid(col, layerName, w, h, 1, dur);
      layer.adjustmentLayer = true;
    } else if (layerType === 'camera') {
      var camPreset = typeof opts.preset === 'string' ? opts.preset : '';
      layer = comp.layers.addCamera(layerName, [comp.width / 2, comp.height / 2]);
    } else if (layerType === 'light') {
      layer = comp.layers.addLight(layerName, [comp.width / 2, comp.height / 2]);
    } else {
      _endToolUndo();
      result.message = 'Unknown layer type: ' + layerType;
      return resultToJson(result);
    }

    _endToolUndo();

    result.ok = true;
    result.layerIndex = layer.index;
    result.layerId = layer.id;
    result.layerName = layer.name;
    result.message = 'Created ' + layerType + ' layer "' + layer.name + '" at index ' + layer.index + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'createLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Delete a layer from the active composition.
 */
function extensionsLlmChat_deleteLayer (layerIndex, layerId) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var n = layer.name;
    _beginToolUndo('Agent: Delete layer');
    layer.remove();
    _endToolUndo();
    result.ok = true;
    result.message = 'Deleted layer "' + n + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'deleteLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Duplicate a layer. Returns info about the new layer.
 */
function extensionsLlmChat_duplicateLayer (layerIndex, layerId) {
  var result = { ok: false, message: '', layerIndex: null, layerId: null, layerName: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    _beginToolUndo('Agent: Duplicate layer');
    var dup = layer.duplicate();
    _endToolUndo();
    result.ok = true;
    result.layerIndex = dup.index;
    result.layerId = dup.id;
    result.layerName = dup.name;
    result.message = 'Duplicated "' + layer.name + '" → "' + dup.name + '" at index ' + dup.index + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'duplicateLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Move a layer to a new index.
 */
function extensionsLlmChat_reorderLayer (layerIndex, layerId, newIndex) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    if (typeof newIndex !== 'number' || newIndex < 1 || newIndex > ctx.comp.numLayers) {
      result.message = 'Invalid new index: ' + newIndex; return resultToJson(result);
    }
    _beginToolUndo('Agent: Reorder layer');
    layer.moveTo(newIndex);
    _endToolUndo();
    result.ok = true;
    result.message = 'Moved "' + layer.name + '" to index ' + newIndex + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'reorderLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set or clear a layer's parent.
 * Pass parentLayerIndex=0 and parentLayerId=-1 to unparent.
 */
function extensionsLlmChat_setLayerParent (layerIndex, layerId, parentLayerIndex, parentLayerId) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var child = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!child) { result.message = 'Child layer not found.'; return resultToJson(result); }

    _beginToolUndo('Agent: Set layer parent');
    if ((!parentLayerIndex || parentLayerIndex <= 0) && (!parentLayerId || parentLayerId < 0)) {
      child.parent = null;
      _endToolUndo();
      result.ok = true;
      result.message = 'Unparented "' + child.name + '".';
      return resultToJson(result);
    }

    var parent = _resolveLayer(ctx.comp, parentLayerIndex, parentLayerId);
    if (!parent) {
      _endToolUndo();
      result.message = 'Parent layer not found.';
      return resultToJson(result);
    }
    child.parent = parent;
    _endToolUndo();
    result.ok = true;
    result.message = 'Parented "' + child.name + '" → "' + parent.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setLayerParent error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set in/out points for a layer.
 */
function extensionsLlmChat_setLayerTiming (layerIndex, layerId, inPoint, outPoint, startTime) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    _beginToolUndo('Agent: Set layer timing');
    if (typeof startTime === 'number') layer.startTime = startTime;
    if (typeof inPoint === 'number') layer.inPoint = inPoint;
    if (typeof outPoint === 'number') layer.outPoint = outPoint;
    _endToolUndo();
    result.ok = true;
    result.message = 'Set timing on "' + layer.name + '": in=' + layer.inPoint + ', out=' + layer.outPoint + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setLayerTiming error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Rename a layer.
 */
function extensionsLlmChat_renameLayer (layerIndex, layerId, newName) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var old = layer.name;
    _beginToolUndo('Agent: Rename layer');
    layer.name = String(newName);
    _endToolUndo();
    result.ok = true;
    result.message = 'Renamed "' + old + '" → "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'renameLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Keyframe operations
// ============================================================================

/**
 * Add keyframes to a property.
 * @param {number} layerIndex
 * @param {number} layerId
 * @param {string} propertyPath e.g. "Transform>Position"
 * @param {Array}  keyframes    [{ time:number, value:*, inType, outType, easeIn, easeOut }]
 *
 * inType/outType: 'linear'|'bezier'|'hold' (default 'bezier')
 * easeIn/easeOut: [{ speed, influence }] per dimension — optional
 */
function extensionsLlmChat_addKeyframes (layerIndex, layerId, propertyPath, keyframes) {
  var result = { ok: false, message: '', addedCount: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop) { result.message = 'Property "' + propertyPath + '" not found.'; return resultToJson(result); }
    if (!(prop instanceof Property)) {
      result.message = '"' + propertyPath + '" is a group, not a property.'; return resultToJson(result);
    }
    if (!(keyframes instanceof Array) || keyframes.length === 0) {
      result.message = 'No keyframes provided.'; return resultToJson(result);
    }

    // Map string interpolation types to AE enums.
    function toKeyType (str) {
      if (str === 'linear') return KeyframeInterpolationType.LINEAR;
      if (str === 'hold') return KeyframeInterpolationType.HOLD;
      return KeyframeInterpolationType.BEZIER;
    }

    _beginToolUndo('Agent: Add keyframes');

    for (var i = 0; i < keyframes.length; i++) {
      var kf = keyframes[i];
      if (!kf || typeof kf.time !== 'number') continue;
      var val = kf.value;
      // Ensure array values are proper AE arrays.
      if (val instanceof Array) {
        var arr = [];
        for (var vi = 0; vi < val.length; vi++) arr.push(val[vi]);
        val = arr;
      }

      var kIdx = prop.addKey(kf.time);
      prop.setValueAtKey(kIdx, val);
      result.addedCount++;

      // Set interpolation type.
      var inT = toKeyType(kf.inType);
      var outT = toKeyType(kf.outType);
      try { prop.setInterpolationTypeAtKey(kIdx, inT, outT); } catch (eInterp) {}

      // Set easing if provided.
      if (kf.easeIn || kf.easeOut) {
        try {
          var numDims = prop.value instanceof Array ? prop.value.length : 1;
          var eIn = [];
          var eOut = [];
          for (var d = 0; d < numDims; d++) {
            var inSpec = (kf.easeIn instanceof Array && kf.easeIn[d]) ? kf.easeIn[d] : null;
            var outSpec = (kf.easeOut instanceof Array && kf.easeOut[d]) ? kf.easeOut[d] : null;
            var speed_in = (inSpec && typeof inSpec.speed === 'number') ? inSpec.speed : 0;
            var infl_in = (inSpec && typeof inSpec.influence === 'number') ? inSpec.influence : 33.33;
            var speed_out = (outSpec && typeof outSpec.speed === 'number') ? outSpec.speed : 0;
            var infl_out = (outSpec && typeof outSpec.influence === 'number') ? outSpec.influence : 33.33;
            eIn.push(new KeyframeEase(speed_in, infl_in));
            eOut.push(new KeyframeEase(speed_out, infl_out));
          }
          prop.setTemporalEaseAtKey(kIdx, eIn, eOut);
        } catch (eEase) {}
      }
    }

    _endToolUndo();
    result.ok = true;
    result.message = 'Added ' + result.addedCount + ' keyframe(s) to "' + propertyPath + '" on "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Read all keyframes from a property.
 */
function extensionsLlmChat_getKeyframes (layerIndex, layerId, propertyPath) {
  var result = { ok: false, message: '', keyframes: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    var numKeys = prop.numKeys;
    for (var i = 1; i <= numKeys; i++) {
      var kf = { time: prop.keyTime(i), value: prop.keyValue(i) };
      try {
        kf.inInterpolation = String(prop.keyInInterpolationType(i));
        kf.outInterpolation = String(prop.keyOutInterpolationType(i));
      } catch (eI) {}
      try {
        kf.temporalEaseIn = [];
        kf.temporalEaseOut = [];
        var teIn = prop.keyInTemporalEase(i);
        var teOut = prop.keyOutTemporalEase(i);
        for (var d = 0; d < teIn.length; d++) {
          kf.temporalEaseIn.push({ speed: teIn[d].speed, influence: teIn[d].influence });
        }
        for (var d2 = 0; d2 < teOut.length; d2++) {
          kf.temporalEaseOut.push({ speed: teOut[d2].speed, influence: teOut[d2].influence });
        }
      } catch (eEase) {}
      result.keyframes.push(kf);
    }
    result.ok = true;
    result.message = numKeys + ' keyframe(s) on "' + propertyPath + '".';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Delete keyframes at specified times (or all if times is empty/null).
 */
function extensionsLlmChat_deleteKeyframes (layerIndex, layerId, propertyPath, times) {
  var result = { ok: false, message: '', deletedCount: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    _beginToolUndo('Agent: Delete keyframes');
    if (!times || !(times instanceof Array) || times.length === 0) {
      // Delete all keyframes, backwards to preserve indices.
      for (var i = prop.numKeys; i >= 1; i--) {
        prop.removeKey(i);
        result.deletedCount++;
      }
    } else {
      // Delete at specific times — find nearest key.
      for (var t = 0; t < times.length; t++) {
        var kIdx = prop.nearestKeyIndex(times[t]);
        if (kIdx > 0 && Math.abs(prop.keyTime(kIdx) - times[t]) < 0.001) {
          prop.removeKey(kIdx);
          result.deletedCount++;
        }
      }
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Deleted ' + result.deletedCount + ' keyframe(s) from "' + propertyPath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'deleteKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set easing on an existing keyframe by key index.
 */
function extensionsLlmChat_setKeyframeEasing (layerIndex, layerId, propertyPath, keyIndex, inType, outType, easeIn, easeOut) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found.'; return resultToJson(result);
    }
    if (typeof keyIndex !== 'number' || keyIndex < 1 || keyIndex > prop.numKeys) {
      result.message = 'Invalid keyframe index: ' + keyIndex; return resultToJson(result);
    }

    function toKeyType (str) {
      if (str === 'linear') return KeyframeInterpolationType.LINEAR;
      if (str === 'hold') return KeyframeInterpolationType.HOLD;
      return KeyframeInterpolationType.BEZIER;
    }

    _beginToolUndo('Agent: Set keyframe easing');

    if (typeof inType === 'string' || typeof outType === 'string') {
      prop.setInterpolationTypeAtKey(keyIndex, toKeyType(inType), toKeyType(outType));
    }

    if (easeIn || easeOut) {
      var numDims = prop.value instanceof Array ? prop.value.length : 1;
      var eIn = [];
      var eOut = [];
      for (var d = 0; d < numDims; d++) {
        var inSpec = (easeIn instanceof Array && easeIn[d]) ? easeIn[d] : null;
        var outSpec = (easeOut instanceof Array && easeOut[d]) ? easeOut[d] : null;
        var sp_in = (inSpec && typeof inSpec.speed === 'number') ? inSpec.speed : 0;
        var inf_in = (inSpec && typeof inSpec.influence === 'number') ? inSpec.influence : 33.33;
        var sp_out = (outSpec && typeof outSpec.speed === 'number') ? outSpec.speed : 0;
        var inf_out = (outSpec && typeof outSpec.influence === 'number') ? outSpec.influence : 33.33;
        eIn.push(new KeyframeEase(sp_in, inf_in));
        eOut.push(new KeyframeEase(sp_out, inf_out));
      }
      prop.setTemporalEaseAtKey(keyIndex, eIn, eOut);
    }

    _endToolUndo();
    result.ok = true;
    result.message = 'Set easing on keyframe #' + keyIndex + ' of "' + propertyPath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setKeyframeEasing error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Property operations
// ============================================================================

/**
 * Get the value of a property, optionally at a specific time.
 */
function extensionsLlmChat_getPropertyValue (layerIndex, layerId, propertyPath, time) {
  var result = { ok: false, message: '', value: null, hasExpression: false, expression: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    if (typeof time === 'number') {
      result.value = prop.valueAtTime(time, false);
    } else {
      result.value = prop.value;
    }
    try {
      result.hasExpression = prop.expressionEnabled === true;
      result.expression = prop.expression || '';
    } catch (eExpr) {}
    result.ok = true;
    result.message = 'Got value of "' + propertyPath + '" on "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getPropertyValue error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Read the expression on a property: text, enabled state, error info.
 */
function extensionsLlmChat_getExpression (layerIndex, layerId, propertyPath) {
  var result = {
    ok: false, message: '',
    expression: '', expressionEnabled: false,
    expressionError: '', canSetExpression: false
  };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    try { result.canSetExpression = prop.canSetExpression === true; } catch (e1) {}
    try { result.expressionEnabled = prop.expressionEnabled === true; } catch (e2) {}
    try { result.expression = prop.expression || ''; } catch (e3) {}
    try { result.expressionError = prop.expressionError || ''; } catch (e4) {}

    // Force expression evaluation to surface errors that only appear after eval.
    if (result.expressionEnabled && result.expression.length > 0) {
      try {
        // Reading valueAtTime forces AE to evaluate the expression at current time.
        var comp = ctx.comp;
        prop.valueAtTime(comp.time, false);
        // Re-read error after forced evaluation.
        try { result.expressionError = prop.expressionError || ''; } catch (e5) {}
      } catch (eEval) {}
    }

    result.ok = true;
    // Make the error prominent in the message so the agent can't miss it.
    if (result.expressionError && result.expressionError.length > 0) {
      result.message = 'EXPRESSION ERROR on "' + propertyPath + '" (layer "' + layer.name + '"): ' + result.expressionError;
    } else if (result.expressionEnabled && result.expression.length > 0) {
      result.message = 'Expression on "' + propertyPath + '" (layer "' + layer.name + '"): enabled, no errors.';
    } else if (result.expression.length > 0) {
      result.message = 'Expression on "' + propertyPath + '" (layer "' + layer.name + '"): present but disabled.';
    } else {
      result.message = 'No expression on "' + propertyPath + '" (layer "' + layer.name + '").';
    }
    return resultToJson(result);
  } catch (e) {
    result.message = 'getExpression error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set a static property value (no keyframes).
 */
function extensionsLlmChat_setPropertyValue (layerIndex, layerId, propertyPath, value) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    // Ensure array values.
    if (value instanceof Array) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(value[i]);
      value = arr;
    }
    _beginToolUndo('Agent: Set property value');
    prop.setValue(value);
    _endToolUndo();
    result.ok = true;
    result.message = 'Set "' + propertyPath + '" on "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setPropertyValue error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * List all expressable properties on a layer (deeper scan than getActiveCompSummary).
 */
function extensionsLlmChat_getLayerProperties (layerIndex, layerId) {
  var result = { ok: false, message: '', layerName: '', layerType: '', properties: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    result.layerName = layer.name;
    result.layerType = _layerTypeString(layer);

    function walkGroup (group, pathPrefix) {
      if (!group) return;
      try {
        var numP = group.numProperties;
        if (typeof numP !== 'number') return;
        for (var i = 1; i <= numP; i++) {
          try {
            var p = group.property(i);
            if (!p) continue;
            var pPath = pathPrefix ? (pathPrefix + '>' + p.name) : p.name;
            if (p instanceof Property) {
              var info = { path: pPath, name: p.name, matchName: p.matchName || '' };
              try { info.canSetExpression = p.canSetExpression === true; } catch (eC) {}
              try { info.numKeys = p.numKeys; } catch (eK) {}
              try { info.hasExpression = p.expressionEnabled === true; } catch (eE) {}
              result.properties.push(info);
            } else if (p.numProperties !== undefined && p.numProperties > 0) {
              // Recurse into property groups, but limit depth.
              if (pPath.split('>').length < 5) {
                walkGroup(p, pPath);
              }
            }
          } catch (eInner) {}
        }
      } catch (eWalk) {}
    }

    walkGroup(layer, '');
    result.ok = true;
    result.message = 'Found ' + result.properties.length + ' properties on "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getLayerProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Effect operations
// ============================================================================

/**
 * Add an effect to a layer by matchName or display name.
 */
function extensionsLlmChat_addEffect (layerIndex, layerId, effectMatchName) {
  var result = { ok: false, message: '', effectIndex: null };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer does not support effects.'; return resultToJson(result); }
    _beginToolUndo('Agent: Add effect');
    var fx = effects.addProperty(effectMatchName);
    _endToolUndo();
    if (!fx) { result.message = 'Failed to add effect "' + effectMatchName + '".'; return resultToJson(result); }
    result.ok = true;
    result.effectIndex = fx.propertyIndex;
    result.message = 'Added effect "' + fx.name + '" (index ' + fx.propertyIndex + ') to "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addEffect error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Remove an effect by index (1-based).
 */
function extensionsLlmChat_removeEffect (layerIndex, layerId, effectIndex) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer has no effects.'; return resultToJson(result); }
    if (typeof effectIndex !== 'number' || effectIndex < 1 || effectIndex > effects.numProperties) {
      result.message = 'Invalid effect index.'; return resultToJson(result);
    }
    var fx = effects.property(effectIndex);
    var n = fx ? fx.name : '?';
    _beginToolUndo('Agent: Remove effect');
    fx.remove();
    _endToolUndo();
    result.ok = true;
    result.message = 'Removed effect "' + n + '" from "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'removeEffect error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * List properties of a specific effect on a layer.
 */
function extensionsLlmChat_getEffectProperties (layerIndex, layerId, effectIndex) {
  var result = { ok: false, message: '', effectName: '', properties: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer has no effects.'; return resultToJson(result); }
    var fx = effects.property(effectIndex);
    if (!fx) { result.message = 'Effect not found at index ' + effectIndex + '.'; return resultToJson(result); }
    result.effectName = fx.name;

    for (var i = 1; i <= fx.numProperties; i++) {
      try {
        var p = fx.property(i);
        if (!p) continue;
        var info = { index: i, name: p.name, matchName: p.matchName || '' };
        if (p instanceof Property) {
          try { info.value = p.value; } catch (eV) {}
          try { info.canSetExpression = p.canSetExpression === true; } catch (eC) {}
        }
        result.properties.push(info);
      } catch (eP) {}
    }
    result.ok = true;
    result.message = 'Effect "' + fx.name + '" has ' + result.properties.length + ' properties.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getEffectProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set a specific effect property value.
 * @param {number} effectIndex 1-based index in the Effects stack
 * @param {number} propIndex   1-based index within the effect
 * @param {*}      value       The value to set
 */
function extensionsLlmChat_setEffectPropertyValue (layerIndex, layerId, effectIndex, propIndex, value) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer has no effects.'; return resultToJson(result); }
    var fx = effects.property(effectIndex);
    if (!fx) { result.message = 'Effect not found.'; return resultToJson(result); }
    var prop = fx.property(propIndex);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Effect property not found at index ' + propIndex + '.'; return resultToJson(result);
    }
    if (value instanceof Array) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(value[i]);
      value = arr;
    }
    _beginToolUndo('Agent: Set effect property');
    prop.setValue(value);
    _endToolUndo();
    result.ok = true;
    result.message = 'Set "' + prop.name + '" on effect "' + fx.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setEffectPropertyValue error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Composition operations
// ============================================================================

/**
 * Create a new composition in the project.
 */
function extensionsLlmChat_createComp (name, width, height, pixelAspect, duration, frameRate) {
  var result = { ok: false, message: '', compName: '' };
  try {
    if (!app || !app.project) { result.message = 'No active project.'; return resultToJson(result); }
    var n = (typeof name === 'string' && name.length) ? name : 'New Comp';
    var w = (typeof width === 'number' && width > 0) ? width : 1920;
    var h = (typeof height === 'number' && height > 0) ? height : 1080;
    var pa = (typeof pixelAspect === 'number' && pixelAspect > 0) ? pixelAspect : 1;
    var d = (typeof duration === 'number' && duration > 0) ? duration : 10;
    var fr = (typeof frameRate === 'number' && frameRate > 0) ? frameRate : 30;

    _beginToolUndo('Agent: Create composition');
    var comp = app.project.items.addComp(n, w, h, pa, d, fr);
    _endToolUndo();

    result.ok = true;
    result.compName = comp.name;
    result.message = 'Created composition "' + comp.name + '" (' + w + 'x' + h + ', ' + fr + 'fps, ' + d + 's).';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'createComp error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Precompose selected layers (by indices).
 * @param {Array}  layerIndices  Array of 1-based layer indices to precompose
 * @param {string} compName      Name for the new precomp
 * @param {boolean} moveAttributes  If true, move attributes into precomp (option 1). Default true.
 */
function extensionsLlmChat_precomposeLayers (layerIndices, compName, moveAttributes) {
  var result = { ok: false, message: '', precompName: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    if (!(layerIndices instanceof Array) || layerIndices.length === 0) {
      result.message = 'No layer indices provided.'; return resultToJson(result);
    }
    var n = (typeof compName === 'string' && compName.length) ? compName : 'Precomp';
    var moveAttr = (typeof moveAttributes === 'boolean') ? moveAttributes : true;

    _beginToolUndo('Agent: Precompose layers');
    var newComp = ctx.comp.layers.precompose(layerIndices, n, moveAttr);
    _endToolUndo();

    result.ok = true;
    result.precompName = newComp ? newComp.name : n;
    result.message = 'Precomposed ' + layerIndices.length + ' layer(s) into "' + result.precompName + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'precomposeLayers error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Update settings of the active composition.
 */
function extensionsLlmChat_setCompSettings (settings) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    if (!settings || typeof settings !== 'object') {
      result.message = 'No settings provided.'; return resultToJson(result);
    }
    var comp = ctx.comp;
    _beginToolUndo('Agent: Set comp settings');
    if (typeof settings.name === 'string') comp.name = settings.name;
    if (typeof settings.width === 'number') comp.width = settings.width;
    if (typeof settings.height === 'number') comp.height = settings.height;
    if (typeof settings.duration === 'number') comp.duration = settings.duration;
    if (typeof settings.frameRate === 'number') comp.frameRate = settings.frameRate;
    if (typeof settings.bgColor instanceof Array) comp.bgColor = settings.bgColor;
    _endToolUndo();
    result.ok = true;
    result.message = 'Updated comp settings for "' + comp.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setCompSettings error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Text layer operations
// ============================================================================

/**
 * Set text document properties on a text layer's Source Text.
 * @param {object} textProps { text, font, fontSize, fillColor, strokeColor, strokeWidth,
 *                             justification, tracking, leading, baselineShift }
 */
function extensionsLlmChat_setTextDocument (layerIndex, layerId, textProps) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }
    if (!textProps || typeof textProps !== 'object') {
      result.message = 'No text properties provided.'; return resultToJson(result);
    }

    var textProp = _resolveProperty(layer, 'Text>Source Text');
    if (!textProp || !(textProp instanceof Property)) {
      result.message = 'Layer is not a text layer or Source Text not found.'; return resultToJson(result);
    }

    _beginToolUndo('Agent: Set text document');
    var doc = textProp.value;
    if (typeof textProps.text === 'string') doc.text = textProps.text;
    if (typeof textProps.font === 'string') doc.font = textProps.font;
    if (typeof textProps.fontSize === 'number') doc.fontSize = textProps.fontSize;
    if (textProps.fillColor instanceof Array) doc.fillColor = textProps.fillColor;
    if (textProps.strokeColor instanceof Array) doc.strokeColor = textProps.strokeColor;
    if (typeof textProps.strokeWidth === 'number') doc.strokeWidth = textProps.strokeWidth;
    if (typeof textProps.justification === 'string') {
      var justMap = {
        'left': ParagraphJustification.LEFT_JUSTIFY,
        'center': ParagraphJustification.CENTER_JUSTIFY,
        'right': ParagraphJustification.RIGHT_JUSTIFY,
        'full': ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT,
      };
      if (justMap[textProps.justification]) doc.justification = justMap[textProps.justification];
    }
    if (typeof textProps.tracking === 'number') doc.tracking = textProps.tracking;
    if (typeof textProps.leading === 'number') doc.leading = textProps.leading;
    if (typeof textProps.baselineShift === 'number') doc.baselineShift = textProps.baselineShift;
    textProp.setValue(doc);
    _endToolUndo();
    result.ok = true;
    result.message = 'Updated text on "' + layer.name + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setTextDocument error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Extended comp summary (richer than getActiveCompSummary)
// ============================================================================

/**
 * Return a detailed summary of the active composition including layer types,
 * parent chains, in/out points, effects list, and expression status.
 */
function extensionsLlmChat_getDetailedCompSummary (filterOptions) {
  var result = {
    ok: false, message: '', compName: '', width: 0, height: 0,
    duration: 0, frameRate: 0, numLayers: 0, layers: []
  };
  try {
    var opts = (typeof filterOptions === 'object' && filterOptions) ? filterOptions : {};
    var filterType = typeof opts.layerType === 'string' ? opts.layerType : null;
    var filterName = typeof opts.nameContains === 'string' ? opts.nameContains.toLowerCase() : null;
    var maxLayers = typeof opts.maxLayers === 'number' ? opts.maxLayers : 0;
    var compact = opts.compact === true;

    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    result.compName = comp.name;
    result.width = comp.width;
    result.height = comp.height;
    result.duration = comp.duration;
    result.frameRate = comp.frameRate;
    result.numLayers = comp.numLayers;

    var addedCount = 0;
    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        var layer = comp.layer(i);
        if (!layer) continue;

        var layerType = _layerTypeString(layer);

        // Apply filters.
        if (filterType && layerType !== filterType) continue;
        if (filterName) {
          try {
            if (layer.name.toLowerCase().indexOf(filterName) === -1) continue;
          } catch (eFN) { continue; }
        }
        if (maxLayers > 0 && addedCount >= maxLayers) break;

        // Compact mode: minimal info per layer to save tokens.
        if (compact) {
          var compactInfo = {
            index: layer.index,
            id: layer.id,
            name: layer.name,
            type: layerType,
          };
          try { compactInfo.threeDLayer = layer.threeDLayer === true; } catch (e3Dc) {}
          try {
            if (layer.parent) compactInfo.parentIndex = layer.parent.index;
          } catch (ePc) {}
          result.layers.push(compactInfo);
          addedCount++;
          continue;
        }

        // Full mode: detailed info per layer.
        var info = {
          index: layer.index,
          id: layer.id,
          name: layer.name,
          type: layerType,
          matchName: layer.matchName || '',
          inPoint: layer.inPoint,
          outPoint: layer.outPoint,
          startTime: layer.startTime,
          threeDLayer: false,
          width: null,
          height: null,
          parentIndex: null,
          parentName: '',
          effects: [],
          hasExpressions: false,
        };
        // 3D layer flag.
        try { info.threeDLayer = layer.threeDLayer === true; } catch (e3D) {}
        // Layer dimensions (available for AVLayer/TextLayer/ShapeLayer, not for cameras/lights).
        try {
          if (typeof layer.width === 'number') info.width = layer.width;
          if (typeof layer.height === 'number') info.height = layer.height;
        } catch (eDim) {}
        try {
          if (layer.parent) {
            info.parentIndex = layer.parent.index;
            info.parentName = layer.parent.name;
          }
        } catch (eP) {}

        // List effects.
        try {
          var fx = layer.property('ADBE Effect Parade');
          if (fx) {
            for (var fi = 1; fi <= fx.numProperties; fi++) {
              try {
                var eff = fx.property(fi);
                if (eff) info.effects.push({ index: fi, name: eff.name, matchName: eff.matchName || '' });
              } catch (eEff) {}
            }
          }
        } catch (eFx) {}

        // Check for expressions on common properties.
        var commonPaths = [
          'Transform>Position', 'Transform>Scale', 'Transform>Rotation', 'Transform>Opacity'
        ];
        for (var cp = 0; cp < commonPaths.length; cp++) {
          try {
            var pr = _resolveProperty(layer, commonPaths[cp]);
            if (pr && pr instanceof Property && pr.expressionEnabled) {
              info.hasExpressions = true;
              break;
            }
          } catch (eExp) {}
        }

        result.layers.push(info);
        addedCount++;
      } catch (eLayer) {}
    }

    result.ok = true;
    var filterNote = '';
    if (filterType) filterNote += ' (type: ' + filterType + ')';
    if (filterName) filterNote += ' (name: "' + opts.nameContains + '")';
    if (compact) filterNote += ' [compact]';
    result.message = 'Summary of "' + comp.name + '": ' + result.layers.length + '/' + comp.numLayers + ' layers' + filterNote + '.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getDetailedCompSummary error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// JSON serialization
// ============================================================================

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

