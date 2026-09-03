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

/**
 * Return a robust, UI-friendly active composition note payload.
 * Unlike strict tool operations, this is best-effort and falls back to the first
 * composition in the project when focus context is ambiguous.
 */
function extensionsLlmChat_getActiveCompNote () {
  var result = {
    ok: false,
    compName: '',
    source: '',
    message: ''
  };
  try {
    if (!app || !app.project) {
      result.message = 'No active project in After Effects.';
      return resultToJson(result);
    }

    var ctx = extensionsLlmChat_resolveActiveComp();
    if (ctx && ctx.ok && ctx.comp) {
      result.ok = true;
      result.compName = ctx.comp.name || '';
      result.source = ctx.statusCode || 'resolved';
      result.message = 'Active composition resolved.';
      return resultToJson(result);
    }

    // Defensive fallback for UI: first composition in project.
    var numItems = 0;
    try { numItems = app.project.numItems || 0; } catch (eNum) { numItems = 0; }
    for (var i = 1; i <= numItems; i++) {
      var it = null;
      try { it = app.project.item(i); } catch (eItem) { it = null; }
      if (!it) continue;
      var isComp = false;
      try {
        isComp = (it instanceof CompItem) ||
          (typeof it.numLayers === 'number' && typeof it.layer === 'function');
      } catch (eType) { isComp = false; }
      if (isComp) {
        result.ok = true;
        result.compName = it.name || '';
        result.source = 'project_fallback';
        result.message = 'Using first composition from project list.';
        return resultToJson(result);
      }
    }

    result.message = (ctx && ctx.message) ? ctx.message : 'No composition found.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getActiveCompNote error: ' + e.toString();
    return resultToJson(result);
  }
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
 * Pick a capture time where comp content is actually visible.
 * The playhead often sits at t=0 where every layer is still before its
 * in-point (or scaled to 0) — a frame captured there is black, and the
 * vision check then reports false "empty frame" issues (bug-hunt
 * 2026-08-16 finding #2). Candidates: the current comp time plus the
 * visibility midpoint of every enabled content layer; each candidate is
 * scored by how many layers are visible (within in/out, opacity > 1%,
 * x/y scale above ~1%). Ties keep comp.time (least surprise). Read-only:
 * never moves the playhead.
 *
 * @param {CompItem} comp
 * @returns {number} capture time in seconds
 */
function _pickContentVisibleTime (comp) {
  try {
    var frameDur = comp.frameDuration > 0 ? comp.frameDuration : (1 / 30);
    var maxT = comp.duration - frameDur;
    if (maxT < 0) maxT = 0;
    var layers = [];
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
      try {
        var l = comp.layer(i);
        if (!l.enabled) continue;
        if (l instanceof CameraLayer || l instanceof LightLayer) continue;
        if (l.nullLayer) continue;
        layers.push(l);
      } catch (eL) {}
    }
    if (!layers.length) return comp.time;

    function scoreAt (t) {
      var score = 0;
      for (var k = 0; k < layers.length; k++) {
        try {
          var lay = layers[k];
          if (t < lay.inPoint || t >= lay.outPoint) continue;
          var tr = lay.property('ADBE Transform Group');
          if (tr) {
            var op = tr.property('ADBE Opacity');
            if (op && op.valueAtTime(t, false) <= 1) continue;
            var sc = tr.property('ADBE Scale');
            if (sc) {
              var sv = sc.valueAtTime(t, false);
              if (sv && sv.length >= 2 &&
                  (Math.abs(sv[0]) <= 1 || Math.abs(sv[1]) <= 1)) continue;
            }
          }
          score++;
        } catch (eS) {}
      }
      return score;
    }

    var bestT = comp.time;
    var bestScore = scoreAt(bestT);
    for (i = 0; i < layers.length; i++) {
      var mid = (layers[i].inPoint + layers[i].outPoint) / 2;
      if (mid < 0) mid = 0;
      if (mid > maxT) mid = maxT;
      var s = scoreAt(mid);
      if (s > bestScore) { bestScore = s; bestT = mid; }
    }
    return bestT;
  } catch (ePick) {
    return comp.time;
  }
}

/**
 * Save the active composition's current frame as PNG (requires CompItem.saveFrameToPng).
 *
 * Two modes:
 *   - Legacy: pathOrName is a full path → saves there.
 *   - Persistent (#12): pathOrName is a bare filename + persistent === true →
 *     saves under ~/AE-agent-captures/<date>/, auto-prunes old captures so
 *     the folder stays bounded.
 *
 * @param {string}  pathOrName Full path or filename (when `persistent` true)
 * @param {boolean} persistent If true, store under ~/AE-agent-captures/<date>/
 * @param {boolean} autoTime   If true, capture at a content-visible time
 *                             (see _pickContentVisibleTime) instead of the
 *                             playhead. The playhead itself never moves.
 */
function extensionsLlmChat_saveCompFramePng (pathOrName, persistent, autoTime) {
  var result = {
    ok: false,
    message: '',
    path: ''
  };

  try {
    if (typeof pathOrName !== 'string' || !pathOrName.length) {
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

    var outFile;
    if (persistent === true) {
      // Persistent path: ~/AE-agent-captures/YYYY-MM-DD/<filename>
      var home = Folder.userData ? Folder('~').fsName : '~';
      var d = new Date();
      var datedFolder = String(d.getFullYear()) + '-' +
        ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
        ('0' + d.getDate()).slice(-2);
      var rootFolder = new Folder('~/AE-agent-captures');
      if (!rootFolder.exists) { try { rootFolder.create(); } catch (eR) {} }
      // Prune BEFORE creating today's folder: the prune sweeps empty dated
      // subfolders, and saveFrameToPng writes asynchronously — pruning after
      // deleted the brand-new (still empty) day folder, so the async PNG
      // write failed with an AE "file could not be found" dialog.
      try { _pruneOldCaptures(rootFolder, 50); } catch (ePrune) {}
      var dayFolder = new Folder('~/AE-agent-captures/' + datedFolder);
      if (!dayFolder.exists) { try { dayFolder.create(); } catch (eD) {} }
      outFile = new File(dayFolder.fsName + '/' + pathOrName);
    } else {
      outFile = new File(pathOrName);
      try {
        var parent = outFile.parent;
        if (parent && !parent.exists) parent.create();
      } catch (eMk) {}
    }

    var captureTime = comp.time;
    if (autoTime === true) {
      captureTime = _pickContentVisibleTime(comp);
    }
    comp.saveFrameToPng(captureTime, outFile);
    result.ok = true;
    result.captureTime = captureTime;
    try {
      result.path = outFile.fsName ? String(outFile.fsName) : String(pathOrName);
    } catch (ePath) {
      result.path = String(pathOrName);
    }
    // Note: outFile.length is read on AE's main (ExtendScript) thread, but
    // saveFrameToPng flushes the PNG bytes on that same thread only AFTER this
    // call returns — so the size reads back as -1/0 here even though the file
    // writes correctly within ~200ms (verified live). Reporting a -1 fileSize
    // would falsely signal an empty/failed capture to the agent, so only
    // include the field when a real size is available; otherwise omit it.
    try {
      var savedLen = outFile.length;
      if (typeof savedLen === 'number' && savedLen > 0) result.fileSize = savedLen;
    } catch (eLen) {}
    result.message = 'Saved frame at t=' + captureTime + 's' +
      (autoTime === true && Math.abs(captureTime - comp.time) > 0.001
        ? ' (auto-picked content-visible time; playhead stays at ' + comp.time + 's)'
        : '') + '.';
    return resultToJson(result);
  } catch (eSave) {
    result.ok = false;
    result.message = 'saveFrameToPng failed: ' + eSave.toString();
    return resultToJson(result);
  }
}

/**
 * Read the post-expression evaluated value of a property for tool-result
 * readback. Returns a number or an array of numbers, or null when the value
 * is not a simple numeric type (e.g. TextDocument, shape, marker).
 * Readback turns every apply_expression into its own unit test: the model
 * sees the value the expression actually produces at the current time.
 */
function _exprReadbackValue (prop) {
  try {
    var v = prop.value;
    if (typeof v === 'number') return v;
    if (v instanceof Array) {
      var out = [];
      for (var i = 0; i < v.length; i++) {
        if (typeof v[i] !== 'number') return null;
        // Round to 4 decimals to keep tool results compact.
        out.push(Math.round(v[i] * 10000) / 10000);
      }
      return out;
    }
    return null;
  } catch (eReadback) {
    return null;
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
    // An empty string is the ONLY way AE removes an expression, so it is a
    // valid request, not a malformed one. Rejecting it meant "убери экспрешен"
    // had no implementation at all — the model kept guessing and the user kept
    // asking. `null`/`undefined` are still errors: those come from a broken
    // tool call, not from an intent to clear.
    if (typeof expressionText !== 'string') {
      result.ok = false;
      result.message = 'No expression text was provided to the host. Pass "" to REMOVE the expression.';
      return resultToJson(result);
    }
    var isRemoval = expressionText.length === 0;

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

    // Removal is always allowed (it can only ever fix state); guards apply to
    // actually writing an expression.
    if (!isRemoval) {
      var lockMsg = _lockedRefusal(layer);
      if (lockMsg) { result.ok = false; result.message = lockMsg; return resultToJson(result); }
      var cloneMsg = _parentCloneExprError(layer, targetProp, expressionText);
      if (cloneMsg) { result.ok = false; result.message = cloneMsg; return resultToJson(result); }
    }

    try {
      _beginToolUndo(isRemoval ? 'Remove Expression from Target' : 'Apply Expression to Target');
      targetProp.expression = expressionText;
      targetProp.expressionEnabled = !isRemoval;

      if (isRemoval) {
        _endToolUndo();
        result.ok = true;
        result.message =
          'Expression removed from "' + propName + '" on layer "' + layerName + '" in comp "' + comp.name + '".';
        result.compStatusCode = ctx.statusCode || 'COMP_AVAILABLE';
        return resultToJson(result);
      }

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
    var exprHiddenMsg = _hiddenLayerWarning(layer);
    if (exprHiddenMsg) { result.hiddenLayer = true; result.message += exprHiddenMsg; }
    var rbVal = _exprReadbackValue(targetProp);
    if (rbVal !== null) {
      result.evaluatedValue = rbVal;
      // NOTE: ExtendScript throws "invalid numeric result" on string + Array
      // concatenation (verified live in AE) — always join() arrays explicitly.
      var rbStr = (rbVal instanceof Array) ? '[' + rbVal.join(', ') + ']' : '' + rbVal;
      result.message += ' Evaluated value at current time: ' + rbStr + '.';
    }
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
        if (!(layerIndex >= 1)) layerIndex = null;

        // Empty expression = remove it (see extensionsLlmChat_applyExpressionToTarget),
        // so it must not be treated as a missing field here either.
        if (!propertyPath.length || (layerId === null && layerIndex === null)) {
          itemResult.message = 'Target item is missing layer_id/layer_index or property_path.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var layer = _resolveLayer(comp, layerIndex, layerId);
        if (!layer) {
          itemResult.message = _layerNotFoundMsg(layerId, layerIndex);
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

        // Same guards as the single-target tool (removal is always allowed).
        if (expressionText.length) {
          var batchLockMsg = _lockedRefusal(layer);
          if (batchLockMsg) {
            itemResult.message = batchLockMsg;
            result.failedCount++;
            result.results.push(itemResult);
            continue;
          }
          var batchCloneMsg = _parentCloneExprError(layer, targetProp, expressionText);
          if (batchCloneMsg) {
            itemResult.message = batchCloneMsg;
            result.failedCount++;
            result.results.push(itemResult);
            continue;
          }
        }

        targetProp.expression = expressionText;
        targetProp.expressionEnabled = expressionText.length > 0;

        if (!expressionText.length) {
          itemResult.ok = true;
          itemResult.message = 'Removed from layer "' + layer.name + '" → "' + targetProp.name + '".';
          result.appliedCount++;
          result.results.push(itemResult);
          continue;
        }

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
        var batchHiddenMsg = _hiddenLayerWarning(layer);
        if (batchHiddenMsg) { itemResult.hiddenLayer = true; itemResult.message += batchHiddenMsg; }
        var batchRbVal = _exprReadbackValue(targetProp);
        if (batchRbVal !== null) {
          itemResult.evaluatedValue = batchRbVal;
        }
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
 * Resolve a layer inside a comp by persistent id (preferred), then index,
 * then (when both are missing/invalid) fallback to the first selected layer
 * in the comp. The selection fallback handles the common LLM error of
 * forgetting to pass layer_index immediately after a create_layer call —
 * AE auto-selects the freshly created layer, so this works for chained tools.
 *
 * Returns the Layer or null.
 */
/**
 * Actionable not-found message for batch targets. Live GLM-4.7 run sent
 * layer_id 1..20 meaning stack positions — all 20 targets failed with a bare
 * "Layer not found by layer_id/layer_index." and the model could not tell
 * WHY (ids vs indexes) nor recover. Echo the failing identifiers and explain
 * the id/index distinction so the model can self-correct in one step.
 */
function _layerNotFoundMsg (layerId, layerIndex) {
  function given (v) {
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'number' && v !== v) return false; // NaN
    return true;
  }
  var what = [];
  if (given(layerId)) what.push('layer_id ' + layerId);
  if (given(layerIndex)) what.push('layer_index ' + layerIndex);
  return 'Layer not found (' + (what.length ? what.join(', ') : 'no identifier given') + '). ' +
    'Note: layer_id is the PERSISTENT id returned by create_layer/get_detailed_comp_summary, ' +
    'NOT the 1-based stack position — for positions use layer_index instead, ' +
    'or re-read real ids via get_detailed_comp_summary.';
}

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
  // Fallback to first selected layer when caller passed neither id nor a
  // valid index. This rescues tool calls that forgot the layer identifier
  // right after a mutating action like create_layer (which auto-selects).
  if (!layer) {
    var hasIdHint = (typeof layerId === 'number' && layerId >= 0);
    var hasIdxHint = (typeof layerIndex === 'number' && layerIndex >= 1);
    if (!hasIdHint && !hasIdxHint) {
      try {
        var sel = comp.selectedLayers;
        if (sel && sel.length > 0) layer = sel[0];
      } catch (eSel) {}
    }
  }
  return layer;
}

/**
 * Locked-layer refusal for targeted mutating tools. AE scripting silently
 * bypasses `layer.locked` (verified live: apply_expression succeeded on a
 * locked layer with zero indication), so without this check the agent
 * overrides a lock the user set — and never even mentions it. Returns '' when
 * the layer may be modified, otherwise the refusal message for the model.
 * Bulk convenience tools (stagger_layers, randomize_property) keep their
 * historical unlock-and-restore behavior.
 */
function _lockedRefusal (layer) {
  try {
    if (layer && layer.locked === true) {
      return 'Layer "' + layer.name + '" is LOCKED — refusing to modify it. ' +
        'Tell the user the layer is locked. If they want it changed, unlock it first via ' +
        'set_layer_switches({locked:false}) and mention the unlock in your reply.';
    }
  } catch (e) {}
  return '';
}

/**
 * Reject expressions that clone the PARENT layer's position into the Position
 * property of a parented layer. A parented layer's Position is in PARENT
 * space; `thisComp.layer("Parent").transform.position + ...` mixes comp-space
 * coordinates into parent space — the layer flies ~[parent position] pixels
 * away and parent motion applies twice (verified live: all 4 parented cards
 * landed ~2000px off after a wiggle rig used the parent position as base).
 * Returns '' when the expression is fine, otherwise the refusal message.
 */
function _parentCloneExprError (layer, targetProp, expressionText) {
  try {
    if (!layer || !layer.parent) return '';
    if (!targetProp || targetProp.matchName !== 'ADBE Position') return '';
    if (typeof expressionText !== 'string' || !expressionText.length) return '';
    var pn = layer.parent.name;
    var refs = [
      'layer("' + pn + '").transform.position',
      'layer("' + pn + '").position',
      "layer('" + pn + "').transform.position",
      "layer('" + pn + "').position"
    ];
    for (var i = 0; i < refs.length; i++) {
      if (expressionText.indexOf(refs[i]) !== -1) {
        return 'Rejected: this expression uses the position of "' + pn + '", which is the PARENT of layer "' +
          layer.name + '". A parented layer\'s Position is in PARENT space — adding the parent\'s comp-space ' +
          'position throws the layer far away and doubles the parent\'s motion. Use `value` as the base instead ' +
          '(e.g. `value + wiggle(freq, amp)`); parenting already applies the parent\'s movement.';
      }
    }
    // Same disease, other properties (eval corpus 2026-09-02: "speed up the
    // moon" ended with the child's Position rotating by the parent's rotation
    // ON TOP of the parent's own rotation — the orbit ran at 6x, not 3x).
    var kinds = ['rotation', 'scale', 'anchorPoint'];
    for (var k = 0; k < kinds.length; k++) {
      var kindRefs = [
        'layer("' + pn + '").transform.' + kinds[k],
        'layer("' + pn + '").' + kinds[k],
        "layer('" + pn + "').transform." + kinds[k],
        "layer('" + pn + "')." + kinds[k]
      ];
      for (var r = 0; r < kindRefs.length; r++) {
        if (expressionText.indexOf(kindRefs[r]) !== -1) {
          return 'Rejected: this expression reads the ' + kinds[k] + ' of "' + pn + '", which is the PARENT of layer "' +
            layer.name + '". Parenting ALREADY applies the parent\'s ' + kinds[k] + ' to this layer, so re-applying it ' +
            'in the child\'s Position doubles the motion (an orbit spins twice as fast, a scaled parent scales twice). ' +
            'Keep the child\'s Position a plain offset in parent space (e.g. [300, 0]) and change the PARENT\'s ' + kinds[k] + ' instead.';
        }
      }
    }
  } catch (e) {}
  return '';
}

/**
 * Informational note for VALUE-class mutations (set value / keyframes /
 * randomize) of the Position of a PARENTED layer. Same disease as
 * _parentCloneExprError but for plain values: models compute targets in COMP
 * pixels (e.g. "scatter across the frame" → x in 0..compWidth) while a
 * parented layer's Position is in PARENT space — verified live 2026-08-16:
 * 30 copies parented to a center null got comp-space random positions and
 * landed at x=2209..5980 in a 4096-wide comp (half off-screen).
 * Returns '' when not applicable.
 */
function _parentSpaceNote (layer, propertyPath) {
  try {
    if (!layer || !layer.parent) return '';
    if (String(propertyPath).indexOf('Position') === -1) return '';
    var pp = layer.parent.transform.position.value;
    return ' NOTE: "' + layer.name + '" is parented to "' + layer.parent.name +
      '" — its Position is in PARENT space, not comp pixels. The parent sits at [' +
      Math.round(pp[0]) + ',' + Math.round(pp[1]) + '] in the comp, so to land this layer at comp-space [x,y] use [x-' +
      Math.round(pp[0]) + ', y-' + Math.round(pp[1]) + ']. Verify the values you just set are in the right space.';
  } catch (e) {}
  return '';
}

/**
 * Warning for mutations of a layer whose video is switched OFF (eyeball).
 * AE happily animates disabled layers and nothing shows on screen — the
 * agent then reports invisible work as done (verified live 2026-08-16: a
 * three-layer trail rig built entirely on enabled=false text layers).
 * A warning, not a refusal: hidden rigs (e.g. measure layers) are legitimate.
 * Returns '' when not applicable.
 */
function _hiddenLayerWarning (layer) {
  try {
    if (layer && layer.enabled === false) {
      return ' WARNING: layer "' + layer.name + '" has its video switch DISABLED (eyeball off) — nothing on it renders, so this change is NOT visible. If it should be seen, enable it via set_layer_switches({enabled:true}); either way tell the user.';
    }
  } catch (e) {}
  return '';
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
 * Expected value-type per known property path. Used by _validateValueForPath
 * to return clear errors before AE setValue rejects with a cryptic message.
 *
 *   array2  — [x, y]
 *   array3  — [x, y, z]   (3D position when 3D layer enabled)
 *   array2or3 — accept either (Position auto-extends with 3D)
 *   number  — finite scalar
 *   percent — finite scalar; AE accepts any number, but Opacity is 0..100
 *   angle   — finite scalar in degrees (no clamp; AE wraps)
 *   text    — string (Source Text)
 */
var _PATH_VALUE_TYPES = {
  'Transform>Anchor Point': 'array2or3',
  'Transform>Position':     'array2or3',
  'Transform>Scale':        'array2or3',
  'Transform>Rotation':     'angle',
  'Transform>X Rotation':   'angle',
  'Transform>Y Rotation':   'angle',
  'Transform>Opacity':      'percent',
  'Text>Source Text':       'text'
};

/**
 * Validate that `value` looks right for `propertyPath`. Returns null when
 * the value is acceptable (or the path has no known type hint), or a
 * human-readable error message otherwise.
 *
 * Defensive — never throws; lets the host call proceed if it can't decide.
 */
function _validateValueForPath (propertyPath, value) {
  var t = _PATH_VALUE_TYPES[propertyPath];
  if (!t) return null;
  function isFiniteNum (v) { return typeof v === 'number' && isFinite(v); }
  function isArrOf (v, n) {
    if (!(v instanceof Array)) return false;
    if (v.length !== n) return false;
    for (var i = 0; i < n; i++) { if (!isFiniteNum(v[i])) return false; }
    return true;
  }
  if (t === 'array2') {
    if (!isArrOf(value, 2)) return propertyPath + ' expects [x, y] (2 numbers); got ' + _describeValue(value) + '.';
    return null;
  }
  if (t === 'array3') {
    if (!isArrOf(value, 3)) return propertyPath + ' expects [x, y, z] (3 numbers); got ' + _describeValue(value) + '.';
    return null;
  }
  if (t === 'array2or3') {
    if (!(isArrOf(value, 2) || isArrOf(value, 3))) {
      return propertyPath + ' expects [x, y] for 2D or [x, y, z] for 3D layers; got ' + _describeValue(value) + '.';
    }
    return null;
  }
  if (t === 'number' || t === 'angle') {
    if (!isFiniteNum(value)) return propertyPath + ' expects a finite number; got ' + _describeValue(value) + '.';
    return null;
  }
  if (t === 'percent') {
    if (!isFiniteNum(value)) return propertyPath + ' expects a number (0..100 for opacity); got ' + _describeValue(value) + '.';
    return null;
  }
  if (t === 'text') {
    if (typeof value !== 'string') return propertyPath + ' expects a string; got ' + _describeValue(value) + '.';
    return null;
  }
  return null;
}

function _describeValue (v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v instanceof Array) return 'array(length=' + v.length + ')';
  return typeof v + '(' + (typeof v === 'string' ? '"' + v.substr(0, 20) + (v.length > 20 ? '…' : '') + '"' : String(v)) + ')';
}

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

  // Segment alias map: common display names → AE matchNames.
  // Allows agent to use e.g. "Masks>Mask 1>Expansion" instead of ADBE matchNames.
  var _segAlias = {
    'masks': 'ADBE Mask Parade',
    'mask parade': 'ADBE Mask Parade',
    'mask mode': 'ADBE Mask Mode',
    'mask shape': 'ADBE Mask Shape',
    'mask feather': 'ADBE Mask Feather',
    'mask opacity': 'ADBE Mask Opacity',
    'mask expansion': 'ADBE Mask Offset',
    'expansion': 'ADBE Mask Offset',
    'feather': 'ADBE Mask Feather',
    'inverted': 'ADBE Mask Inverted',
    'effects': 'ADBE Effect Parade',
    'contents': 'ADBE Root Vectors Group',
    'source text': 'ADBE Text Document',
    'text': 'ADBE Text Properties'
  };

  // Generic segment walk.
  // AE property() accepts matchNames and display names, but for shape layer
  // content the display names (e.g. "Ellipse 1") don't always resolve via
  // property(name). We try direct lookup first, then scan children by name.
  var segments = propertyPath.split('>');
  var current = layer;
  for (var i = 0; i < segments.length; i++) {
    var segOrig = segments[i];
    if (!segOrig) { current = null; break; }
    // Check alias table first
    var segAlias = _segAlias[segOrig.toLowerCase()];
    var seg = segAlias || segOrig;
    var next = null;
    // Try direct lookup (works for matchNames and most display names).
    try { next = current.property(seg); } catch (e2) { next = null; }
    // Alias may be wrong in nested contexts (e.g. inner "Contents" of a shape
    // group is ADBE Vectors Group, not the root matchName) — retry original.
    if (!next && segAlias) {
      try { next = current.property(segOrig); } catch (e2b) { next = null; }
    }
    // If direct lookup failed and current is a group, scan children by name.
    // Scan with the ORIGINAL segment — the alias substitution must not hide
    // children whose display name matches what the agent actually passed.
    if (!next && current.numProperties !== undefined) {
      try {
        var segLower = segOrig.toLowerCase();
        // Numeric index fallback: "Mask 1", "Mask 2" etc. → property(N)
        var numMatch = segLower.match(/^(?:mask|effect|group)\s+(\d+)$/);
        if (numMatch) {
          var idx = parseInt(numMatch[1], 10);
          try { next = current.property(idx); } catch (eIdx) {}
        }
        if (!next) {
          for (var ci = 1; ci <= current.numProperties; ci++) {
            try {
              var child = current.property(ci);
              if (child && child.name && child.name.toLowerCase() === segLower) {
                next = child;
                break;
              }
            } catch (eChild) {}
          }
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

/**
 * Find layers by name substring (case-insensitive), optionally filtered by
 * layer type. Returns minimal info per match — much cheaper than a full
 * comp summary when the agent just needs to locate layers.
 * @param {string} pattern    substring to match against layer names
 * @param {string} layerType  optional type filter ('shape'|'text'|...)
 */
function extensionsLlmChat_searchLayers (pattern, layerType) {
  var result = { ok: false, message: '', matches: [], totalLayers: 0 };
  var MAX_MATCHES = 50;
  try {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      result.message = 'search_layers: missing `pattern` string.';
      return resultToJson(result);
    }
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    result.totalLayers = comp.numLayers;
    var needle = pattern.toLowerCase();
    var typeFilter = (typeof layerType === 'string' && layerType.length > 0) ? layerType : null;

    for (var i = 1; i <= comp.numLayers; i++) {
      if (result.matches.length >= MAX_MATCHES) break;
      var layer = comp.layer(i);
      if (!layer) continue;
      var name = String(layer.name || '');
      if (name.toLowerCase().indexOf(needle) === -1) continue;
      var lt = _layerTypeString(layer);
      if (typeFilter && lt !== typeFilter) continue;
      result.matches.push({ index: i, id: layer.id, name: name, type: lt });
    }

    result.ok = true;
    result.message = 'Found ' + result.matches.length + ' layer(s) matching "' + pattern + '"' +
      (typeFilter ? ' of type "' + typeFilter + '"' : '') +
      ' out of ' + comp.numLayers + ' total.' +
      (result.matches.length >= MAX_MATCHES ? ' (capped at ' + MAX_MATCHES + ')' : '');
    return resultToJson(result);
  } catch (e) {
    result.message = 'searchLayers error: ' + e.toString();
    return resultToJson(result);
  }
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
      // AE quirk: TextDocument property setters fail on a standalone doc
      // ("Unable to set value as it is not associated with a layer"). We must
      // attach via addText() first, then read the live doc from the layer's
      // sourceText property and apply font/fontSize via setValue.
      var initialText = typeof opts.text === 'string' ? opts.text : '';
      var textDoc = new TextDocument(initialText);
      layer = comp.layers.addText(textDoc);
      layer.name = layerName;

      var hasFontPrefs = (typeof opts.fontSize === 'number') || (typeof opts.font === 'string');
      if (hasFontPrefs) {
        try {
          var srcTextProp = layer.property('Source Text');
          var liveDoc = srcTextProp.value;
          var fontWarning = null;
          if (typeof opts.fontSize === 'number') liveDoc.fontSize = opts.fontSize;
          if (typeof opts.font === 'string' && opts.font.length) {
            try {
              liveDoc.font = opts.font;
            } catch (eFont) {
              fontWarning = 'Font "' + opts.font + '" could not be applied: ' + eFont.toString();
            }
          }
          srcTextProp.setValue(liveDoc);
          // Detect silent font fallback (AE replaces unknown fonts with a default
          // without throwing). Compare requested font against what AE saved.
          if (typeof opts.font === 'string' && opts.font.length && !fontWarning) {
            try {
              var savedFont = srcTextProp.value.font;
              if (savedFont && savedFont !== opts.font) {
                fontWarning = 'Font "' + opts.font + '" not found; AE substituted "' + savedFont + '". Pass exact PostScript name.';
              }
            } catch (eRead) {}
          }
          if (fontWarning) result.fontWarning = fontWarning;
        } catch (eApply) {
          result.fontWarning = 'Could not apply font/size: ' + eApply.toString();
        }
      }
    } else if (layerType === 'null') {
      layer = comp.layers.addNull(dur);
      layer.name = layerName;
    } else if (layerType === 'adjustment') {
      layer = comp.layers.addSolid(col, layerName, w, h, 1, dur);
      layer.adjustmentLayer = true;
    } else if (layerType === 'camera') {
      var camPreset = typeof opts.preset === 'string' ? opts.preset : '';
      var any3d = false;
      for (var c3 = 1; c3 <= comp.numLayers; c3++) {
        try { if (comp.layer(c3).threeDLayer === true) { any3d = true; break; } } catch (e3d) {}
      }
      if (!any3d && opts.force !== true) {
        _endToolUndo();
        result.message = 'create_layer(camera) refused: this composition has NO 3D layers, so a camera would change nothing on screen. ' +
          'For camera shake / camera moves in this 2D comp use apply_motion_recipe(recipe:"shake") with no layer_ids — it builds a null rig every layer follows. ' +
          'Do NOT switch layers to 3D to make a camera work: that changes how everything renders. Add a camera only when the user explicitly asks for a 3D scene.';
        result.error_code = 'CAMERA_IN_2D_COMP';
        return resultToJson(result);
      }
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (typeof newIndex !== 'number' || newIndex < 1 || newIndex > ctx.comp.numLayers) {
      result.message = 'Invalid new index: ' + newIndex + '. Comp has ' + ctx.comp.numLayers + ' layers (valid range 1..' + ctx.comp.numLayers + ').';
      return resultToJson(result);
    }
    if (layer.index === newIndex) {
      // No-op short-circuit: prevents the agent from looping the same reorder.
      result.ok = true;
      result.message = 'Layer "' + layer.name + '" is already at index ' + newIndex + '. No reorder needed.';
      result.noop = true;
      return resultToJson(result);
    }
    _beginToolUndo('Agent: Reorder layer');
    try {
      // Layer has NO moveTo(index) — that's a Property method and always
      // throws "parent is not an INDEXED_GROUP" (verified live in AE).
      // Use the real Layer API: moveBefore/moveAfter/moveToBeginning/moveToEnd.
      if (newIndex === 1) {
        layer.moveToBeginning();
      } else if (newIndex === ctx.comp.numLayers) {
        layer.moveToEnd();
      } else if (newIndex < layer.index) {
        layer.moveBefore(ctx.comp.layer(newIndex));
      } else {
        layer.moveAfter(ctx.comp.layer(newIndex));
      }
    } catch (eMove) {
      _endToolUndo();
      result.message = 'reorderLayer error: ' + String(eMove && eMove.toString ? eMove.toString() : eMove);
      return resultToJson(result);
    }
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
    if (parent.id === child.id) {
      _endToolUndo();
      result.message = 'set_layer_parent: child and parent resolve to the SAME layer ("' + child.name + '", index ' + child.index + ', id ' + child.id + '). Pass the child as layer_id and the parent as parent_layer_id — two different layers.';
      return resultToJson(result);
    }
    child.parent = parent;
    _endToolUndo();
    result.ok = true;
    result.message = 'Parented "' + child.name + '" → "' + parent.name + '".';
    // Scripted parenting preserves the child's WORLD position: AE silently
    // rewrites the child's Position into the parent's coordinate space. Report
    // the new value — models building orbit/rig chains often assume the child
    // moved to the parent (it did NOT) and end up with cancelling offsets
    // (live round-6: moon null stayed at comp center, moon orbited the sun).
    try {
      var _newPos = child.property('ADBE Transform Group').property('ADBE Position').value;
      var _parentAnchor = parent.property('ADBE Transform Group').property('ADBE Anchor Point').value;
      result.childPositionInParentSpace = _newPos;
      result.parentAnchorPoint = _parentAnchor;
      // NB: the child's Position lives in the parent's LAYER space, whose
      // origin is the layer's top-left — NOT its visual center. For solids the
      // anchor sits at the center (e.g. [960, 540] for a comp-sized solid), so
      // advising "[0, 0]" would drop the child at the solid's corner (live
      // round-6: moon-orbit null ended up 1100px away from its planet).
      result.message += ' World position preserved: "' + child.name + '" did NOT move — its Position is now [' +
        _newPos.join(', ') + '] in "' + parent.name + '"\'s coordinate space. ' +
        'To place the child exactly AT the parent (orbit-null / rig pattern), set the child\'s Position to the parent\'s Anchor Point value, which is [' +
        _parentAnchor.join(', ') + '].';
    } catch (ePos) {}
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    // Guard: when BOTH in_point and out_point are provided in one call, reject
    // an inverted/zero range (in >= out). AE otherwise silently accepts it and
    // leaves the layer with a negative duration — a degenerate, hard-to-notice
    // state. Single-field calls are unaffected.
    if (typeof inPoint === 'number' && typeof outPoint === 'number' && inPoint >= outPoint) {
      result.message = 'set_layer_timing: in_point (' + inPoint + ') must be less than out_point (' + outPoint + ').';
      return resultToJson(result);
    }
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    // Guard: a missing/empty new_name must NOT silently rename the layer to the
    // literal "null"/"undefined". Return a clean error like the other tools.
    if (newName === null || newName === undefined) {
      result.message = 'rename_layer: missing required `new_name` string.';
      return resultToJson(result);
    }
    var nameStr = String(newName).replace(/^\s+|\s+$/g, '');
    if (nameStr === '') {
      result.message = 'rename_layer: `new_name` must be a non-empty string.';
      return resultToJson(result);
    }
    var old = layer.name;
    _beginToolUndo('Agent: Rename layer');
    layer.name = nameStr;
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

// ── Blend mode ──────────────────────────────────────────────────────────────

function extensionsLlmChat_setBlendMode (layerIndex, layerId, blendMode) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    var modeMap = {
      'normal': BlendingMode.NORMAL, 'add': BlendingMode.ADD, 'multiply': BlendingMode.MULTIPLY,
      'screen': BlendingMode.SCREEN, 'overlay': BlendingMode.OVERLAY, 'soft_light': BlendingMode.SOFT_LIGHT,
      'hard_light': BlendingMode.HARD_LIGHT, 'difference': BlendingMode.DIFFERENCE,
      'color_dodge': BlendingMode.COLOR_DODGE, 'color_burn': BlendingMode.COLOR_BURN,
      'linear_dodge': BlendingMode.LINEAR_DODGE, 'linear_burn': BlendingMode.LINEAR_BURN,
      'darken': BlendingMode.DARKEN, 'lighten': BlendingMode.LIGHTEN,
      'dissolve': BlendingMode.DISSOLVE, 'classic_color_dodge': BlendingMode.CLASSIC_COLOR_DODGE,
      'classic_color_burn': BlendingMode.CLASSIC_COLOR_BURN,
      'stencil_alpha': BlendingMode.STENCIL_ALPHA, 'silhouette_alpha': BlendingMode.SILHOUETTE_ALPHA,
      'alpha_add': BlendingMode.ALPHA_ADD, 'luminescent_premul': BlendingMode.LUMINESCENT_PREMUL
    };
    var modeKey = String(blendMode || 'normal').toLowerCase().replace(/[\s-]/g, '_');
    var modeVal = modeMap[modeKey];
    if (modeVal === undefined) {
      var supported = 'normal, add, multiply, screen, overlay, soft_light, hard_light, difference, color_dodge, color_burn, linear_dodge, linear_burn, darken, lighten, dissolve, classic_color_dodge, classic_color_burn, stencil_alpha, silhouette_alpha, alpha_add, luminescent_premul';
      result.message = 'Unknown blend mode: "' + blendMode + '". Supported: ' + supported;
      return resultToJson(result);
    }

    _beginToolUndo('Agent: Set blend mode');
    layer.blendMode = modeVal;
    _endToolUndo();

    result.ok = true;
    result.message = 'Set blend mode on "' + layer.name + '" to "' + modeKey + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setBlendMode error: ' + e.toString();
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
/**
 * Shared worker: add keyframes (with interpolation + easing) to a resolved
 * Property. Used by extensionsLlmChat_addKeyframes and
 * extensionsLlmChat_setKeyframesBatch. Caller manages the undo group.
 * Returns { added:number, times:Array<number> }.
 */
/**
 * Auto-enable time remapping when a tool targets the Time Remap property on a
 * layer where it is OFF — otherwise AE throws "Can not addKey/set value ...
 * because the property or a parent property is hidden" (live round-6,
 * GLM-4.7: three failed calls, time remap never applied). Enabling also makes
 * AE create default remap keys at layer start/end. Returns a note for the
 * result message, or '' when nothing was changed.
 */
function _ensureTimeRemapEnabled (layer, prop) {
  try {
    if (prop && prop.matchName === 'ADBE Time Remapping' &&
        layer.canSetTimeRemapEnabled && !layer.timeRemapEnabled) {
      layer.timeRemapEnabled = true;
      return ' NOTE: time remapping was OFF on "' + layer.name + '" — it was enabled automatically. AE also created default remap keys at the layer start/end; they merge with yours, so delete or adjust them if they conflict (get_keyframes to inspect).';
    }
  } catch (eTR) {}
  return '';
}

/**
 * Returns a clear refusal when the target is Time Remap on a layer that AE
 * cannot remap (shape/text/solid/null — no time-based source). Without this
 * AE throws the cryptic "Can not addKey ... property is hidden" and the model
 * burns calls retrying (live round-6, gpt-oss: 25 calls, remap never applied,
 * precompose step skipped entirely).
 */
function _timeRemapBlocker (layer, prop) {
  try {
    if (prop && prop.matchName === 'ADBE Time Remapping' && !layer.canSetTimeRemapEnabled) {
      return 'Time remap is not available on "' + layer.name + '": only layers with a time-based source (precomp or footage) can be remapped — shape/text/solid/null layers cannot. Precompose the layer first (precompose_layers), then apply time remap to the resulting precomp layer.';
    }
  } catch (eTB) {}
  return '';
}

function _applyKeyframesToProp (prop, keyframes) {
  // Map string interpolation types to AE enums.
  function toKeyType (str) {
    if (str === 'linear') return KeyframeInterpolationType.LINEAR;
    if (str === 'hold') return KeyframeInterpolationType.HOLD;
    return KeyframeInterpolationType.BEZIER;
  }

  var out = { added: 0, times: [] };
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
    out.added++;
    out.times.push(kf.time);

    // Set interpolation type.
    var inT = toKeyType(kf.inType);
    var outT = toKeyType(kf.outType);
    try { prop.setInterpolationTypeAtKey(kIdx, inT, outT); } catch (eInterp) {}

    // Set easing if provided.
    if (kf.easeIn || kf.easeOut) {
      var numDims = _getTemporalEaseDims(prop, kIdx);
      var eIn = [];
      var eOut = [];
      for (var d = 0; d < numDims; d++) {
        var inSpec = (kf.easeIn instanceof Array && kf.easeIn[d]) ? kf.easeIn[d] : null;
        var outSpec = (kf.easeOut instanceof Array && kf.easeOut[d]) ? kf.easeOut[d] : null;
        var speed_in = (inSpec && typeof inSpec.speed === 'number') ? inSpec.speed : 0;
        var infl_in = (inSpec && typeof inSpec.influence === 'number') ? inSpec.influence : 33.33;
        var speed_out = (outSpec && typeof outSpec.speed === 'number') ? outSpec.speed : 0;
        var infl_out = (outSpec && typeof outSpec.influence === 'number') ? outSpec.influence : 33.33;
        eIn.push(new KeyframeEase(speed_in, _clampEaseInfluence(infl_in)));
        eOut.push(new KeyframeEase(speed_out, _clampEaseInfluence(infl_out)));
      }
      try {
        prop.setTemporalEaseAtKey(kIdx, eIn, eOut);
      } catch (eEase) {
        // Retry with 1 dimension for spatial properties
        if (numDims > 1) {
          try { prop.setTemporalEaseAtKey(kIdx, [eIn[0]], [eOut[0]]); } catch (eRetry) {}
        }
      }
    }
  }
  return out;
}

/**
 * Warning appended to keyframe-add results when the property ALREADY had
 * keyframes: new keys are MERGED into the existing animation, not replacing
 * it. Live round-5 evidence (GLM-4.7): adding "70→100%" Scale keys on top of
 * an existing intro animation produced mangled values like [70, 100, 0, 100].
 */
/**
 * Before the FIRST keyframe a property holds that key's value — AE has no
 * "static value before the keys". Eval corpus 2026-09-02 (explicit-mapping):
 * set_property_value(0) + keys 1s→100 / 2s→0 was meant as "hidden until 1s"
 * and showed the layer from t=0. Only visibility-class properties (Opacity,
 * Scale) with a VISIBLE first key that sits after the in-point get the note.
 * Returns '' when not applicable.
 */
function _firstKeyNote (layer, prop) {
  try {
    if (!layer || !prop || prop.numKeys < 1) return '';
    var mn = prop.matchName;
    if (mn !== 'ADBE Opacity' && mn !== 'ADBE Scale') return '';
    var frameDur = 1 / 30;
    try { if (layer.containingComp && layer.containingComp.frameDuration > 0) frameDur = layer.containingComp.frameDuration; } catch (eFd) {}
    var t1 = prop.keyTime(1);
    if (t1 <= layer.inPoint + frameDur) return '';
    var v1 = prop.keyValue(1);
    var visible = (v1 instanceof Array) ? (Math.abs(v1[0]) > 0.5 && Math.abs(v1[1]) > 0.5) : (v1 > 0.5);
    if (!visible) return '';
    var vs = (v1 instanceof Array) ? '[' + _r2(v1).join(', ') + ']' : String(_r2(v1));
    return ' NOTE: before the first key (t=' + _r2(t1) + 's) this property holds the first key\'s value ' + vs +
      ' — the layer is VISIBLE from its in-point (t=' + _r2(layer.inPoint) + 's), not from ' + _r2(t1) + 's; a value set earlier with set_property_value does not survive keyframes.' +
      ' If it must be hidden until ' + _r2(t1) + 's, add a key at the in-point with the off value (hold keys for a hard switch) or trim the layer with set_layer_timing.';
  } catch (e) { return ''; }
}

/**
 * Visibility built as a RAMP: Opacity keys that go 0 -> visible -> 0 with
 * linear/bezier interpolation leave the layer half-transparent for most of
 * its window (eval corpus 2026-09-02, explicit-mapping x3: "visible 1-2 s"
 * built as 0->100->0 bezier keys = 50% at the midpoints, 16-83% on a 4-key
 * card). Measure halfway between consecutive keys and report the dips.
 * Returns '' when every midpoint is fully on or fully off.
 */
function _opacityRampNote (layer, prop) {
  try {
    if (!layer || !prop || prop.matchName !== 'ADBE Opacity' || prop.numKeys < 2) return '';
    var dips = [];
    for (var k = 1; k < prop.numKeys; k++) {
      var ta = prop.keyTime(k); var tb = prop.keyTime(k + 1);
      // Short segments are fades by design (eval corpus 2026-09-03: a 0.2 s
      // fade-in flagged as "half-transparent" sent the model into a 5x
      // delete/rewrite loop of correct keys). Only slow ramps get the note.
      if (tb - ta < 0.4) continue;
      var mid = (ta + tb) / 2;
      var v = prop.valueAtTime(mid, false);
      if (v > 3 && v < 97) dips.push('t=' + _r2(mid) + 's: ' + _r2(v) + '%');
      if (dips.length >= 4) break;
    }
    if (!dips.length) return '';
    return ' NOTE: Opacity ramps gradually between keys (' + dips.join(', ') + ') — fine for a deliberate fade.' +
      ' Only if a hard on/off window ("visible from A to B") was intended: set out_type:"hold" on EVERY key of the window (hold acts on the segment AFTER a key; in_type:"hold" does nothing for what follows), or trim the layer with set_layer_timing.';
  } catch (e) { return ''; }
}

function _mergedKeysNote (prevKeys, prop) {
  if (!(prevKeys > 0)) return '';
  return ' WARNING: this property ALREADY had ' + prevKeys + ' keyframe(s) — your new keys were MERGED into the existing animation (now ' + prop.numKeys + ' total), they did NOT replace it. If you meant to REPLACE the animation, first delete the old keyframes (delete_keyframes / remove them), or set new values at the EXISTING key times.';
}

function extensionsLlmChat_addKeyframes (layerIndex, layerId, propertyPath, keyframes) {
  var result = { ok: false, message: '', addedCount: 0, addedTimes: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop) { result.message = 'Property "' + propertyPath + '" not found.'; return resultToJson(result); }
    if (!(prop instanceof Property)) {
      result.message = '"' + propertyPath + '" is a group, not a property.'; return resultToJson(result);
    }
    if (!(keyframes instanceof Array) || keyframes.length === 0) {
      result.message = 'No keyframes provided.'; return resultToJson(result);
    }

    var kfRemapErr = _timeRemapBlocker(layer, prop);
    if (kfRemapErr) { result.message = kfRemapErr; return resultToJson(result); }
    _beginToolUndo('Agent: Add keyframes');
    var kfRemapNote = _ensureTimeRemapEnabled(layer, prop);
    var kfPrevKeys = prop.numKeys;
    var applied = _applyKeyframesToProp(prop, keyframes);
    _endToolUndo();

    result.addedCount = applied.added;
    result.addedTimes = applied.times;
    result.ok = true;
    var kfMsg = 'Added ' + result.addedCount + ' keyframe(s) to "' + propertyPath + '" on "' + layer.name + '" at t=[' + applied.times.join(', ') + ']s.';
    if (kfRemapNote) { result.timeRemapEnabled = true; kfMsg += kfRemapNote; }
    var kfMergeNote = _mergedKeysNote(kfPrevKeys, prop);
    if (kfMergeNote) { result.mergedIntoExisting = true; kfMsg += kfMergeNote; }
    var kfFirstNote = _firstKeyNote(layer, prop);
    if (kfFirstNote) { result.firstKeyNote = true; kfMsg += kfFirstNote; }
    var kfRampNote = _opacityRampNote(layer, prop);
    if (kfRampNote) { result.opacityRamp = true; kfMsg += kfRampNote; }
    var kfPsNote = _parentSpaceNote(layer, propertyPath);
    if (kfPsNote) { result.parentSpace = true; kfMsg += kfPsNote; }
    var kfHiddenMsg = _hiddenLayerWarning(layer);
    if (kfHiddenMsg) { result.hiddenLayer = true; kfMsg += kfHiddenMsg; }
    result.message = kfMsg;
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Add keyframes to MULTIPLE properties/layers in one undo group.
 * @param {Array} targets [{ layerIndex, layerId, propertyPath, keyframes }]
 * keyframes items: { time, value, inType, outType, easeIn, easeOut }
 */
function extensionsLlmChat_setKeyframesBatch (targets) {
  var result = { ok: false, message: '', appliedCount: 0, failedCount: 0, totalKeyframes: 0, results: [] };
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

    _beginToolUndo('Agent: Set keyframes batch');

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
        var propertyPath = typeof t.propertyPath === 'string' ? t.propertyPath : '';
        var layerId = typeof t.layerId === 'number' ? t.layerId : null;
        var layerIndex = typeof t.layerIndex === 'number' ? t.layerIndex : parseInt(t.layerIndex, 10);
        if (!(layerIndex >= 1)) layerIndex = null;
        var kfs = (t.keyframes instanceof Array) ? t.keyframes : [];

        if (!propertyPath.length || kfs.length === 0 || (layerId === null && layerIndex === null)) {
          itemResult.message = 'Target item is missing layer_id/layer_index, property_path, or keyframes.';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var layer = _resolveLayer(comp, layerIndex, layerId);
        if (!layer) {
          itemResult.message = _layerNotFoundMsg(layerId, layerIndex);
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var kfLockMsg = _lockedRefusal(layer);
        if (kfLockMsg) {
          itemResult.message = kfLockMsg;
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var prop = _resolveProperty(layer, propertyPath);
        if (!prop || !(prop instanceof Property)) {
          itemResult.message = 'Property "' + propertyPath + '" not found or is a group on layer "' + layer.name + '".';
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }

        var kbRemapErr = _timeRemapBlocker(layer, prop);
        if (kbRemapErr) {
          itemResult.message = kbRemapErr;
          result.failedCount++;
          result.results.push(itemResult);
          continue;
        }
        var kbRemapNote = _ensureTimeRemapEnabled(layer, prop);
        var kbPrevKeys = prop.numKeys;
        var applied = _applyKeyframesToProp(prop, kfs);
        itemResult.ok = true;
        itemResult.addedCount = applied.added;
        itemResult.addedTimes = applied.times;
        itemResult.message = 'Added ' + applied.added + ' keyframe(s) to "' + propertyPath + '" on "' + layer.name + '".';
        if (kbRemapNote) { itemResult.timeRemapEnabled = true; itemResult.message += kbRemapNote; }
        var kbMergeNote = _mergedKeysNote(kbPrevKeys, prop);
        if (kbMergeNote) { itemResult.mergedIntoExisting = true; itemResult.message += kbMergeNote; }
        var kbFirstNote = _firstKeyNote(layer, prop);
        if (kbFirstNote) { itemResult.firstKeyNote = true; itemResult.message += kbFirstNote; }
        var kbRampNote = _opacityRampNote(layer, prop);
        if (kbRampNote) { itemResult.opacityRamp = true; itemResult.message += kbRampNote; }
        var kbPsNote = _parentSpaceNote(layer, propertyPath);
        if (kbPsNote) { itemResult.parentSpace = true; itemResult.message += kbPsNote; }
        var kbHiddenMsg = _hiddenLayerWarning(layer);
        if (kbHiddenMsg) { itemResult.hiddenLayer = true; itemResult.message += kbHiddenMsg; }
        result.appliedCount++;
        result.totalKeyframes += applied.added;
        result.results.push(itemResult);
      } catch (eItem) {
        itemResult.message = 'Item failed: ' + eItem.toString();
        result.failedCount++;
        result.results.push(itemResult);
      }
    }

    try { _endToolUndo(); } catch (eEnd) {}

    result.ok = result.failedCount === 0;
    result.message = 'Keyframe batch finished: ' + result.appliedCount + ' target(s) succeeded (' + result.totalKeyframes + ' keyframes), ' + result.failedCount + ' failed.';
    return resultToJson(result);
  } catch (eOuter) {
    try { _endToolUndo(); } catch (ignored) {}
    result.message = 'Unexpected error in keyframe batch: ' + eOuter.toString();
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
function extensionsLlmChat_deleteKeyframes (layerIndex, layerId, propertyPath, times, keyIndices) {
  var result = { ok: false, message: '', deletedCount: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    var hasTimes = times && (times instanceof Array) && times.length > 0;
    var hasIdx = keyIndices && (keyIndices instanceof Array) && keyIndices.length > 0;
    _beginToolUndo('Agent: Delete keyframes');
    if (!hasTimes && !hasIdx) {
      // No selector → delete ALL keyframes (backwards to preserve indices).
      for (var i = prop.numKeys; i >= 1; i--) {
        prop.removeKey(i);
        result.deletedCount++;
      }
    } else {
      // Selective: accept BOTH `times` (time-based) and `key_indices`
      // (1-based index-based, mirroring set_keyframe_easing). Collect the
      // target indices into a set so a bad/unmatched selector deletes only
      // what it matches — it never silently falls through to delete-all.
      var toDelete = {};
      if (hasIdx) {
        for (var ki = 0; ki < keyIndices.length; ki++) {
          var idx = keyIndices[ki];
          if (typeof idx === 'number' && idx >= 1 && idx <= prop.numKeys) toDelete['_' + idx] = idx;
        }
      }
      if (hasTimes) {
        for (var t = 0; t < times.length; t++) {
          var kIdx = prop.nearestKeyIndex(times[t]);
          if (kIdx > 0 && Math.abs(prop.keyTime(kIdx) - times[t]) < 0.001) toDelete['_' + kIdx] = kIdx;
        }
      }
      // Remove highest index first so lower indices stay valid.
      var arr = [];
      for (var key in toDelete) { if (toDelete.hasOwnProperty(key)) arr.push(toDelete[key]); }
      arr.sort(function (a, b) { return b - a; });
      for (var a = 0; a < arr.length; a++) {
        prop.removeKey(arr[a]);
        result.deletedCount++;
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
      var numDims = _getTemporalEaseDims(prop, keyIndex);
      var eIn = [];
      var eOut = [];
      for (var d = 0; d < numDims; d++) {
        var inSpec = (easeIn instanceof Array && easeIn[d]) ? easeIn[d] : null;
        var outSpec = (easeOut instanceof Array && easeOut[d]) ? easeOut[d] : null;
        var sp_in = (inSpec && typeof inSpec.speed === 'number') ? inSpec.speed : 0;
        var inf_in = (inSpec && typeof inSpec.influence === 'number') ? inSpec.influence : 33.33;
        var sp_out = (outSpec && typeof outSpec.speed === 'number') ? outSpec.speed : 0;
        var inf_out = (outSpec && typeof outSpec.influence === 'number') ? outSpec.influence : 33.33;
        eIn.push(new KeyframeEase(sp_in, _clampEaseInfluence(inf_in)));
        eOut.push(new KeyframeEase(sp_out, _clampEaseInfluence(inf_out)));
      }
      try {
        prop.setTemporalEaseAtKey(keyIndex, eIn, eOut);
      } catch (eEase) {
        // Retry with 1 dimension for spatial properties
        if (numDims > 1) {
          try { prop.setTemporalEaseAtKey(keyIndex, [eIn[0]], [eOut[0]]); } catch (eRetry) {}
        }
      }
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
// Advanced keyframe / layer operations
// ============================================================================

/**
 * Build an array of `targetDims` KeyframeEase objects from a source ease array,
 * fanning a shorter source out across every target dimension (dim 0 reused).
 */
function _buildEaseArray (sourceEase, targetDims) {
  var out = [];
  for (var d = 0; d < targetDims; d++) {
    var srcIdx = (d < sourceEase.length) ? d : 0;
    var src = sourceEase[srcIdx];
    out.push(new KeyframeEase(src.speed, _clampEaseInfluence(src.influence)));
  }
  return out;
}

/**
 * AE's KeyframeEase constructor requires influence in [0.1, 100] and throws
 * "Value 0 out of range 0,1 to 100" otherwise. Models routinely send 0 for a
 * linear-feeling ease (live round-6, GLM-4.7) — clamp instead of failing.
 */
function _clampEaseInfluence (v) {
  if (typeof v !== 'number' || isNaN(v)) return 33.33;
  if (v < 0.1) return 0.1;
  if (v > 100) return 100;
  return v;
}

/**
 * Resolve a parallel list of layer indices/ids into an array of layer objects.
 * ids (when present at the same position) take precedence over indices.
 */
function _resolveLayerList (comp, layerIndices, layerIds) {
  var layers = [];
  var n = (layerIndices && layerIndices.length) ? layerIndices.length : 0;
  var m = (layerIds && layerIds.length) ? layerIds.length : 0;
  var count = (n > m) ? n : m;
  for (var i = 0; i < count; i++) {
    var idx = (layerIndices && i < layerIndices.length) ? layerIndices[i] : null;
    var id = (layerIds && i < layerIds.length) ? layerIds[i] : null;
    var lyr = _resolveLayer(comp, idx, (typeof id === 'number' ? id : null));
    if (lyr) layers.push(lyr);
  }
  return layers;
}

/**
 * Copy temporal ease (and interpolation type) from one source keyframe onto
 * other keyframes of a target property. Dimension-aware.
 */
function extensionsLlmChat_copyEase (srcLayerIndex, srcLayerId, srcPropertyPath, srcKeyIndex, tgtLayerIndex, tgtLayerId, tgtPropertyPath, keyIndices, mode) {
  var result = { ok: false, message: '', count: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    mode = (mode === 'in' || mode === 'out') ? mode : 'both';

    var srcLayer = _resolveLayer(ctx.comp, srcLayerIndex, srcLayerId);
    if (!srcLayer) { result.message = 'Source layer not found.'; return resultToJson(result); }
    var srcProp = _resolveProperty(srcLayer, srcPropertyPath);
    if (!srcProp || !(srcProp instanceof Property)) { result.message = 'Source property not found or is a group.'; return resultToJson(result); }
    if (srcProp.numKeys < 1) { result.message = 'Source property "' + srcPropertyPath + '" has no keyframes.'; return resultToJson(result); }

    var srcIdx = (typeof srcKeyIndex === 'number' && srcKeyIndex >= 1 && srcKeyIndex <= srcProp.numKeys) ? srcKeyIndex : srcProp.numKeys;
    var srcEaseIn = srcProp.keyInTemporalEase(srcIdx);
    var srcEaseOut = srcProp.keyOutTemporalEase(srcIdx);
    var srcInterpIn = null, srcInterpOut = null;
    try { srcInterpIn = srcProp.keyInInterpolationType(srcIdx); srcInterpOut = srcProp.keyOutInterpolationType(srcIdx); } catch (eI) {}
    if (!srcEaseIn && !srcEaseOut) { result.message = 'Could not read easing from source keyframe #' + srcIdx + '.'; return resultToJson(result); }

    var tgtLayer = (tgtLayerIndex != null || tgtLayerId != null) ? _resolveLayer(ctx.comp, tgtLayerIndex, tgtLayerId) : srcLayer;
    if (!tgtLayer) { result.message = 'Target layer not found.'; return resultToJson(result); }
    var tgtPath = (typeof tgtPropertyPath === 'string' && tgtPropertyPath.length) ? tgtPropertyPath : srcPropertyPath;
    var tgtProp = _resolveProperty(tgtLayer, tgtPath);
    if (!tgtProp || !(tgtProp instanceof Property)) { result.message = 'Target property not found or is a group.'; return resultToJson(result); }
    if (tgtProp.numKeys < 1) { result.message = 'Target property "' + tgtPath + '" has no keyframes.'; return resultToJson(result); }

    var indices = [];
    if (keyIndices && keyIndices.length) {
      for (var ki = 0; ki < keyIndices.length; ki++) {
        var v = keyIndices[ki];
        if (typeof v === 'number' && v >= 1 && v <= tgtProp.numKeys) indices.push(v);
      }
    } else {
      for (var k = 1; k <= tgtProp.numKeys; k++) indices.push(k);
    }

    _beginToolUndo('Agent: Copy ease');
    for (var a = 0; a < indices.length; a++) {
      var idx = indices[a];
      try {
        var dims = _getTemporalEaseDims(tgtProp, idx);
        var easeIn = _buildEaseArray(srcEaseIn, dims);
        var easeOut = _buildEaseArray(srcEaseOut, dims);
        if (srcInterpIn !== null) {
          tgtProp.setInterpolationTypeAtKey(idx,
            (mode === 'both' || mode === 'in') ? srcInterpIn : tgtProp.keyInInterpolationType(idx),
            (mode === 'both' || mode === 'out') ? srcInterpOut : tgtProp.keyOutInterpolationType(idx));
        }
        if (mode === 'both') {
          tgtProp.setTemporalEaseAtKey(idx, easeIn, easeOut);
        } else if (mode === 'in') {
          tgtProp.setTemporalEaseAtKey(idx, easeIn, tgtProp.keyOutTemporalEase(idx));
        } else {
          tgtProp.setTemporalEaseAtKey(idx, tgtProp.keyInTemporalEase(idx), easeOut);
        }
        result.count++;
      } catch (eApply) {
        try {
          // Retry 1-dim for spatial properties that rejected the multi-dim array.
          var e1 = _buildEaseArray(srcEaseIn, 1);
          var o1 = _buildEaseArray(srcEaseOut, 1);
          tgtProp.setTemporalEaseAtKey(idx, e1, o1);
          result.count++;
        } catch (eRetry) {}
      }
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Copied ' + mode + ' ease from key #' + srcIdx + ' onto ' + result.count + ' keyframe(s) of "' + tgtPath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'copyEase error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Reverse the keyframe values of a property in time (play backwards), keeping
 * the original key times and swapping incoming/outgoing ease per keyframe.
 */
function extensionsLlmChat_reverseKeyframes (layerIndex, layerId, propertyPath) {
  var result = { ok: false, message: '', count: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) { result.message = 'Property not found or is a group.'; return resultToJson(result); }
    if (prop.numKeys < 2) { result.message = 'Need at least 2 keyframes to reverse "' + propertyPath + '".'; return resultToJson(result); }

    var keys = [];
    for (var k = 1; k <= prop.numKeys; k++) {
      var kd = { time: prop.keyTime(k), value: prop.keyValue(k) };
      try { kd.easeIn = prop.keyInTemporalEase(k); kd.easeOut = prop.keyOutTemporalEase(k); } catch (eE) {}
      try { kd.interpIn = prop.keyInInterpolationType(k); kd.interpOut = prop.keyOutInterpolationType(k); } catch (eT) {}
      keys.push(kd);
    }

    var times = [];
    var values = [];
    for (var t = 0; t < keys.length; t++) {
      times.push(keys[t].time);
      values.push(keys[keys.length - 1 - t].value);
    }

    _beginToolUndo('Agent: Reverse keyframes');
    for (var r = prop.numKeys; r >= 1; r--) prop.removeKey(r);
    for (var n = 0; n < times.length; n++) prop.setValueAtTime(times[n], values[n]);

    for (var e = 0; e < keys.length; e++) {
      var srcIdx = keys.length - 1 - e;
      var keyIdx = e + 1;
      try {
        if (keys[srcIdx].interpIn !== undefined) {
          prop.setInterpolationTypeAtKey(keyIdx, keys[srcIdx].interpOut, keys[srcIdx].interpIn);
        }
      } catch (e2) {}
      try {
        if (keys[srcIdx].easeIn && keys[srcIdx].easeOut) {
          prop.setTemporalEaseAtKey(keyIdx, keys[srcIdx].easeOut, keys[srcIdx].easeIn);
        }
      } catch (e3) {}
      result.count++;
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Reversed ' + result.count + ' keyframes on "' + propertyPath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'reverseKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Shift all keyframes of one property in time, preserving per-key ease and
 * interpolation. alignTo:'layer_in_point' ignores timeOffset and moves the
 * first key to the layer's inPoint (common ask: "start at the layer start" —
 * which means inPoint, NOT comp t=0; keys before inPoint play while the layer
 * is invisible).
 */
function extensionsLlmChat_shiftKeyframes (layerIndex, layerId, propertyPath, timeOffset, alignTo) {
  var result = { ok: false, message: '', count: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) { result.message = 'Property not found or is a group.'; return resultToJson(result); }
    if (prop.numKeys < 1) { result.message = 'No keyframes on "' + propertyPath + '".'; return resultToJson(result); }

    var offset = timeOffset;
    if (alignTo === 'layer_in_point') {
      offset = layer.inPoint - prop.keyTime(1);
    } else if (typeof offset !== 'number') {
      result.message = 'shift_keyframes: `time_offset` must be a number (seconds), or use align_to:"layer_in_point".';
      return resultToJson(result);
    }
    if (offset === 0) {
      result.ok = true;
      result.count = prop.numKeys;
      result.message = 'Keyframes on "' + propertyPath + '" already at the target time; nothing shifted.';
      return resultToJson(result);
    }

    var keys = [];
    for (var k = 1; k <= prop.numKeys; k++) {
      var kd = { time: prop.keyTime(k), value: prop.keyValue(k) };
      try { kd.easeIn = prop.keyInTemporalEase(k); kd.easeOut = prop.keyOutTemporalEase(k); } catch (eE) {}
      try { kd.interpIn = prop.keyInInterpolationType(k); kd.interpOut = prop.keyOutInterpolationType(k); } catch (eT) {}
      keys.push(kd);
    }

    _beginToolUndo('Agent: Shift keyframes');
    for (var r = prop.numKeys; r >= 1; r--) prop.removeKey(r);
    for (var n = 0; n < keys.length; n++) prop.setValueAtTime(keys[n].time + offset, keys[n].value);

    for (var e = 0; e < keys.length; e++) {
      var keyIdx = e + 1;
      try {
        if (keys[e].interpIn !== undefined) {
          prop.setInterpolationTypeAtKey(keyIdx, keys[e].interpIn, keys[e].interpOut);
        }
      } catch (e2) {}
      try {
        if (keys[e].easeIn && keys[e].easeOut) {
          prop.setTemporalEaseAtKey(keyIdx, keys[e].easeIn, keys[e].easeOut);
        }
      } catch (e3) {}
      result.count++;
    }
    _endToolUndo();
    result.ok = true;
    result.firstKeyTime = keys[0].time + offset;
    result.message = 'Shifted ' + result.count + ' keyframe(s) on "' + propertyPath + '" by ' + offset.toFixed(3) + 's (first key now at ' + result.firstKeyTime.toFixed(3) + 's).';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'shiftKeyframes error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Shift every keyframe on a property group (recursively) by timeShift seconds.
 */
function _shiftPropertyKeyframes (group, timeShift) {
  for (var i = 1; i <= group.numProperties; i++) {
    var prop = group.property(i);
    if (prop.propertyType === PropertyType.PROPERTY) {
      if (prop.numKeys > 0 && prop.canVaryOverTime) {
        var keys = [];
        for (var k = 1; k <= prop.numKeys; k++) keys.push({ time: prop.keyTime(k), value: prop.keyValue(k) });
        for (var r = prop.numKeys; r >= 1; r--) prop.removeKey(r);
        for (var n = 0; n < keys.length; n++) prop.setValueAtTime(keys[n].time + timeShift, keys[n].value);
      }
    } else if (prop.propertyType === PropertyType.INDEXED_GROUP || prop.propertyType === PropertyType.NAMED_GROUP) {
      _shiftPropertyKeyframes(prop, timeShift);
    }
  }
}

/**
 * Offset multiple layers in time to create a cascade/stagger.
 */
function extensionsLlmChat_staggerLayers (layerIndices, layerIds, offset, unit, direction, mode) {
  var result = { ok: false, message: '', count: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    if (typeof offset !== 'number') { result.message = 'stagger_layers: `offset` must be a number.'; return resultToJson(result); }
    mode = (mode === 'startTime' || mode === 'keyframes') ? mode : 'inPoint';
    direction = (direction === 'reverse') ? 'reverse' : 'forward';

    var layers = _resolveLayerList(ctx.comp, layerIndices, layerIds);
    if (layers.length < 2) { result.message = 'stagger_layers: need at least 2 resolvable layers.'; return resultToJson(result); }

    var amount = offset;
    if (unit === 'frames') amount = offset * ctx.comp.frameDuration;

    // Sort by comp index ascending.
    for (var a = 0; a < layers.length - 1; a++) {
      for (var b = a + 1; b < layers.length; b++) {
        if (layers[b].index < layers[a].index) { var tmp = layers[a]; layers[a] = layers[b]; layers[b] = tmp; }
      }
    }
    if (direction === 'reverse') layers.reverse();

    _beginToolUndo('Agent: Stagger layers');
    var baseIn = layers[0].inPoint;
    for (var s = 0; s < layers.length; s++) {
      var layer = layers[s];
      var shift = amount * s;
      var wasLocked = layer.locked;
      layer.locked = false;
      if (mode === 'inPoint') {
        layer.startTime = layer.startTime + (baseIn + shift - layer.inPoint);
      } else if (mode === 'startTime') {
        layer.startTime = layer.startTime + shift;
      } else {
        _shiftPropertyKeyframes(layer, shift);
      }
      layer.locked = wasLocked;
      result.count++;
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Staggered ' + result.count + ' layers by ' + offset + (unit === 'frames' ? ' frames' : 's') + ' (' + mode + ', ' + direction + ').';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'staggerLayers error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Apply a random value to one property across several layers.
 */
function extensionsLlmChat_randomizeProperty (layerIndices, layerIds, propertyPath, opts) {
  var result = { ok: false, message: '', count: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    opts = opts || {};
    var minVal = (typeof opts.min === 'number') ? opts.min : 0;
    var maxVal = (typeof opts.max === 'number') ? opts.max : 100;
    var mode = (opts.mode === 'offset') ? 'offset' : 'absolute';
    var uniform = (opts.uniform === false) ? false : true;

    var layers = _resolveLayerList(ctx.comp, layerIndices, layerIds);
    if (layers.length < 1) { result.message = 'randomize_property: no resolvable layers.'; return resultToJson(result); }

    function rnd (lo, hi) { return lo + Math.random() * (hi - lo); }

    _beginToolUndo('Agent: Randomize property');
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var prop = _resolveProperty(layer, propertyPath);
      if (!prop || !(prop instanceof Property)) continue;
      var wasLocked = layer.locked;
      layer.locked = false;
      var cur = prop.value;
      var next;
      if (cur instanceof Array) {
        next = [];
        var uni = rnd(minVal, maxVal);
        for (var d = 0; d < cur.length; d++) {
          var lo = minVal, hi = maxVal;
          if (d === 0 && typeof opts.minX === 'number') lo = opts.minX;
          if (d === 0 && typeof opts.maxX === 'number') hi = opts.maxX;
          if (d === 1 && typeof opts.minY === 'number') lo = opts.minY;
          if (d === 1 && typeof opts.maxY === 'number') hi = opts.maxY;
          var rv = (uniform && cur.length >= 2 && _isScaleProp(prop)) ? uni : rnd(lo, hi);
          next.push(mode === 'offset' ? cur[d] + rv : rv);
        }
      } else {
        var rv1 = rnd(minVal, maxVal);
        next = (mode === 'offset') ? cur + rv1 : rv1;
      }
      try { prop.setValue(next); result.count++; } catch (eSet) {}
      layer.locked = wasLocked;
      // Track the first PARENTED layer whose Position we randomized in
      // absolute mode: the model's min/max are almost always comp pixels,
      // but the values land in PARENT space (live 2026-08-16: 30 copies
      // parented to a center null scattered to x=2209..5980 in a 4K comp).
      if (!result.parentSpaceNote && mode === 'absolute') {
        var rzPsNote = _parentSpaceNote(layer, propertyPath);
        if (rzPsNote) result.parentSpaceNote = rzPsNote;
      }
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Randomized "' + propertyPath + '" on ' + result.count + ' layers (range ' + minVal + '..' + maxVal + ', ' + mode + ').';
    if (result.parentSpaceNote) {
      result.parentSpace = true;
      result.message += result.parentSpaceNote + ' (This applies to every parented layer in this batch.)';
      delete result.parentSpaceNote;
    }
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'randomizeProperty error: ' + e.toString();
    return resultToJson(result);
  }
}

function _isScaleProp (prop) {
  try { return prop.matchName === 'ADBE Scale'; } catch (e) { return false; }
}

/**
 * Move a layer's anchor point to a named position on its content bounds,
 * compensating Position so the layer does not visually jump.
 */
function extensionsLlmChat_moveAnchorPoint (layerIndex, layerId, position) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    var rect;
    try { rect = layer.sourceRectAtTime(ctx.comp.time, false); }
    catch (eRect) { result.message = 'move_anchor_point: this layer has no content bounds (sourceRectAtTime unavailable — e.g. camera/light).'; return resultToJson(result); }

    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var target;
    switch (position) {
      case 'center':       target = [cx, cy]; break;
      case 'top-left':     target = [rect.left, rect.top]; break;
      case 'top':          target = [cx, rect.top]; break;
      case 'top-right':    target = [rect.left + rect.width, rect.top]; break;
      case 'left':         target = [rect.left, cy]; break;
      case 'right':        target = [rect.left + rect.width, cy]; break;
      case 'bottom-left':  target = [rect.left, rect.top + rect.height]; break;
      case 'bottom':       target = [cx, rect.top + rect.height]; break;
      case 'bottom-right': target = [rect.left + rect.width, rect.top + rect.height]; break;
      default: result.message = 'move_anchor_point: unknown position "' + position + '".'; return resultToJson(result);
    }

    var xf = layer.property('ADBE Transform Group');
    var anchorProp = xf.property('ADBE Anchor Point');
    var posProp = xf.property('ADBE Position');
    var scaleProp = xf.property('ADBE Scale');

    var oldAnchor = anchorProp.value;
    var dx = target[0] - oldAnchor[0];
    var dy = target[1] - oldAnchor[1];
    var scale = scaleProp.value;
    var sx = scale[0] / 100;
    var sy = scale[1] / 100;

    _beginToolUndo('Agent: Move anchor point');
    if (anchorProp.numKeys > 0) {
      for (var ak = 1; ak <= anchorProp.numKeys; ak++) {
        var av = anchorProp.keyValue(ak);
        anchorProp.setValueAtTime(anchorProp.keyTime(ak), [av[0] + dx, av[1] + dy]);
      }
    } else {
      anchorProp.setValue(target);
    }

    if (posProp.numKeys > 0) {
      for (var pk = 1; pk <= posProp.numKeys; pk++) {
        var pv = posProp.keyValue(pk);
        if (pv.length === 3) posProp.setValueAtTime(posProp.keyTime(pk), [pv[0] + dx * sx, pv[1] + dy * sy, pv[2]]);
        else posProp.setValueAtTime(posProp.keyTime(pk), [pv[0] + dx * sx, pv[1] + dy * sy]);
      }
    } else {
      var pos = posProp.value;
      if (pos.length === 3) posProp.setValue([pos[0] + dx * sx, pos[1] + dy * sy, pos[2]]);
      else posProp.setValue([pos[0] + dx * sx, pos[1] + dy * sy]);
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Moved anchor point of "' + layer.name + '" to ' + position + ' (position compensated).';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'moveAnchorPoint error: ' + e.toString();
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var prop = _resolveProperty(layer, propertyPath);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'Property not found or is a group.'; return resultToJson(result);
    }
    var rawVal;
    if (typeof time === 'number') {
      rawVal = prop.valueAtTime(time, false);
    } else {
      rawVal = prop.value;
    }

    // TextDocument objects can't be serialized by resultToJson — extract fields
    if (rawVal !== null && rawVal !== undefined && typeof rawVal === 'object' && !(rawVal instanceof Array)) {
      try {
        if (rawVal.toString && rawVal.toString().indexOf('TextDocument') !== -1 ||
            typeof rawVal.text === 'string' || typeof rawVal.fontSize === 'number') {
          var td = {};
          try { td.text = rawVal.text; } catch (e) {}
          try { td.font = rawVal.font; } catch (e) {}
          try { td.fontSize = rawVal.fontSize; } catch (e) {}
          try { td.fillColor = rawVal.fillColor; } catch (e) {}
          try { td.strokeColor = rawVal.strokeColor; } catch (e) {}
          try { td.strokeWidth = rawVal.strokeWidth; } catch (e) {}
          try { td.tracking = rawVal.tracking; } catch (e) {}
          try { td.leading = rawVal.leading; } catch (e) {}
          try { td.justification = rawVal.justification; } catch (e) {}
          try { td.baselineShift = rawVal.baselineShift; } catch (e) {}
          result.value = td;
        } else {
          result.value = rawVal;
        }
      } catch (eTd) {
        result.value = rawVal;
      }
    } else {
      result.value = rawVal;
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
 * Sample a property over time with expressions AND keyframes applied — the
 * scripted equivalent of scrubbing the timeline. This is the agent's only
 * way to verify motion (the vision check sees one still frame). Position can
 * be read in comp space (parent chain applied) for orbits and parented rigs.
 *
 * @param {number|null} layerIndex
 * @param {number|null} layerId
 * @param {string|null} propertyPath  default "Transform>Position"
 * @param {number[]|null} times       explicit sample times (seconds)
 * @param {string|null} space         "layer" (default) | "comp" (Position only)
 * @param {number|null} samples       when `times` is empty: evenly spaced
 *                                    samples over the layer's visible window
 */
function extensionsLlmChat_probeMotion (layerIndex, layerId, propertyPath, times, space, samples) {
  var result = { ok: false, message: '', layerName: '', propertyPath: '', space: 'layer', samples: [], summary: null };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    var layer = _resolveLayer(comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var path = (typeof propertyPath === 'string' && propertyPath.length > 0) ? propertyPath : 'Transform>Position';
    var prop = _resolveProperty(layer, path);
    if (!prop || !(prop instanceof Property)) {
      result.message = 'probe_motion: property "' + path + '" not found on "' + layer.name + '" (or it is a group). Use get_layer_properties to discover paths.';
      return resultToJson(result);
    }
    var useComp = false;
    if (space === 'comp') {
      if (path !== 'Transform>Position') {
        result.message = 'probe_motion: space "comp" is only meaningful for Transform>Position.';
        return resultToJson(result);
      }
      useComp = true;
    }
    result.layerName = layer.name;
    result.propertyPath = path;
    result.space = useComp ? 'comp' : 'layer';

    // Sample times: explicit list, else N evenly spaced over the layer's
    // visible window (clipped to the comp) — where the animation can be seen.
    var MAX_SAMPLES = 25;
    var ts = [];
    var i;
    if (times instanceof Array) {
      for (i = 0; i < times.length && ts.length < MAX_SAMPLES; i++) {
        if (typeof times[i] === 'number' && isFinite(times[i])) ts.push(times[i]);
      }
    }
    if (ts.length === 0) {
      var n = (typeof samples === 'number' && samples >= 2) ? Math.min(Math.round(samples), MAX_SAMPLES) : 5;
      var frameDur = comp.frameDuration > 0 ? comp.frameDuration : (1 / 30);
      var t0 = layer.inPoint > 0 ? layer.inPoint : 0;
      var t1 = layer.outPoint < comp.duration ? layer.outPoint : comp.duration;
      if (t1 <= t0) { t0 = 0; t1 = comp.duration; }
      t1 = t1 - frameDur;
      if (t1 < t0) t1 = t0;
      for (i = 0; i < n; i++) ts.push(t0 + (t1 - t0) * i / (n - 1));
    }

    var enabled = true;
    try { enabled = layer.enabled !== false; } catch (eEn) {}
    var tr = null;
    try { tr = layer.property('ADBE Transform Group'); } catch (eTr) {}

    function dist (a, b) {
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
      if (a instanceof Array && b instanceof Array) {
        var acc = 0;
        var dims = a.length < b.length ? a.length : b.length;
        for (var d = 0; d < dims; d++) acc += (a[d] - b[d]) * (a[d] - b[d]);
        return Math.sqrt(acc);
      }
      return (String(a) === String(b)) ? 0 : 1;
    }

    var fd = comp.frameDuration > 0 ? comp.frameDuration : (1 / 30);
    var autoSpaced = !(times instanceof Array) || ts.length === 0 || (times instanceof Array && times.length === 0);
    var first = null;
    var maxDelta = 0;
    var anyVisible = false;
    for (i = 0; i < ts.length; i++) {
      var t = ts[i];
      var val = null;
      if (useComp) {
        val = _compSpacePosition(layer, t);
      } else {
        val = prop.valueAtTime(t, false);
        if (val !== null && typeof val === 'object' && !(val instanceof Array)) {
          try { val = String(val.text); } catch (eTx) { val = String(val); }
        }
      }
      var visible = enabled && t >= layer.inPoint && t < layer.outPoint;
      if (visible && tr) {
        try {
          var op = tr.property('ADBE Opacity');
          if (op && op.valueAtTime(t, false) <= 0) visible = false;
        } catch (eOp) {}
        try {
          var sc = tr.property('ADBE Scale');
          var sv = sc ? sc.valueAtTime(t, false) : null;
          if (sv && sv.length >= 2 && (sv[0] === 0 || sv[1] === 0)) visible = false;
        } catch (eSc) {}
      }
      if (visible) anyVisible = true;
      if (first === null) first = val;
      var dd = dist(val, first);
      if (dd > maxDelta) maxDelta = dd;
      result.samples.push({ t: _r2(t), value: _r2(val), visible: visible });
    }

    // Instantaneous speed at the first sample, measured over ONE frame. This
    // number cannot alias: evenly spaced samples over the visible window can
    // land on the same phase of a fast rotation/orbit and look static or
    // random (eval corpus 2026-09-02: a correct 3x-faster orbit read as
    // "random" from 5 samples and the model started "fixing" a healthy rig).
    var speed = null;
    try {
      var sa = useComp ? _compSpacePosition(layer, ts[0]) : prop.valueAtTime(ts[0], false);
      var sb = useComp ? _compSpacePosition(layer, ts[0] + fd) : prop.valueAtTime(ts[0] + fd, false);
      if (typeof sa === 'number' || sa instanceof Array) speed = _r2(dist(sa, sb) / fd);
    } catch (eSp) {}
    var summary = {
      changes: maxDelta > 0.001 || (speed !== null && speed > 0.001),
      maxDelta: _r2(maxDelta),
      first: result.samples[0].value,
      last: result.samples[result.samples.length - 1].value,
      speed: speed,
      numKeys: 0,
      hasExpression: false,
      expressionError: ''
    };
    try { summary.numKeys = prop.numKeys; } catch (eNk) {}
    try { summary.hasExpression = prop.expressionEnabled === true; } catch (eHx) {}
    try { summary.expressionError = String(prop.expressionError || ''); } catch (eXe) {}
    result.summary = summary;

    var msg = 'Probed "' + path + '" on "' + layer.name + '" at ' + ts.length + ' time(s)' +
      (useComp ? ' in COMP space (parent chain applied)' : '') + ': ' +
      (summary.changes ? 'value CHANGES over time, max delta ' + summary.maxDelta : 'value is STATIC (no change across samples)') +
      ' (' + summary.numKeys + ' key(s), expression ' + (summary.hasExpression ? 'on' : 'off') + ').';
    if (speed !== null) {
      msg += ' Speed at t=' + _r2(ts[0]) + 's: ' + speed + ' units/s (px, deg or % per second, measured over one frame) — compare speeds to judge "faster/slower"; sparse samples can alias fast periodic motion.';
    }
    if (autoSpaced && ts.length < 12) {
      msg += ' Samples are evenly spaced over the visible window: for anything that rotates or cycles faster than once per ' + _r2((ts[ts.length - 1] - ts[0]) / Math.max(1, ts.length - 1) * 2) + 's, pass explicit `times` a few frames apart.';
    }
    if (!anyVisible) {
      msg += ' WARNING: the layer is NOT visible at any sampled time (video switch, in/out window, opacity 0 or scale 0) — whatever it does is not seen.';
    }
    if (summary.expressionError) {
      msg += ' WARNING: expression error: ' + summary.expressionError.substr(0, 160);
    }
    result.ok = true;
    result.message = msg;
    return resultToJson(result);
  } catch (e) {
    result.message = 'probeMotion error: ' + e.toString();
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
function extensionsLlmChat_setPropertyValue (layerIndex, layerId, propertyPath, value, replaceKeyframes) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
    // Pre-flight type check for known paths so the agent gets a clear
    // diagnostic instead of a cryptic AE error.
    var typeErr = _validateValueForPath(propertyPath, value);
    if (typeErr) { result.message = typeErr; return resultToJson(result); }
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
    var spvRemapErr = _timeRemapBlocker(layer, prop);
    if (spvRemapErr) { result.message = spvRemapErr; return resultToJson(result); }
    // Eval corpus 2026-09-03 (stagger-new): the model built a correct
    // staggered Opacity animation, then "pinned" Opacity = 100 with this
    // tool on every card — which silently deleted every key. A static value
    // on an animated property is refused unless the caller says so.
    if (prop.numKeys > 0 && replaceKeyframes !== true) {
      result.error_code = 'PROPERTY_HAS_KEYFRAMES';
      result.numKeys = prop.numKeys;
      result.message = 'set_property_value refused: "' + propertyPath + '" on "' + layer.name + '" is ANIMATED (' + prop.numKeys + ' keyframes, ' + _r2(prop.keyTime(1)) + '–' + _r2(prop.keyTime(prop.numKeys)) + 's) — a static value would delete that animation. Nothing was changed. The value at any time comes from the keys: change the animation with set_keyframes_batch / add_keyframes (or leave it as it is).';
      return resultToJson(result);
    }
    _beginToolUndo('Agent: Set property value');
    var spvRemapNote = _ensureTimeRemapEnabled(layer, prop);
    // If property has keyframes, remove them first then set static value,
    // or use setValueAtTime at current comp time. This avoids the
    // "Can not call setValue() on a property with keyframes" error.
    if (prop.numKeys > 0) {
      // Remove all keyframes to set a clean static value
      for (var ki = prop.numKeys; ki >= 1; ki--) {
        prop.removeKey(ki);
      }
      result.keyframesRemoved = true;
    }
    prop.setValue(value);
    _endToolUndo();
    result.ok = true;
    var msg = 'Set "' + propertyPath + '" on "' + layer.name + '".';
    if (spvRemapNote) { result.timeRemapEnabled = true; msg += spvRemapNote; }
    if (result.keyframesRemoved) msg += ' (existing keyframes were removed to set static value)';
    // An enabled expression OVERRIDES the static value — the set "succeeds"
    // but nothing changes on screen. Without this warning the agent reports
    // success while the user sees no effect (found live 2026-08-16).
    var hasExpr = false;
    try { hasExpr = !!(prop.expressionEnabled && prop.expression && prop.expression.length > 0); } catch (eX) {}
    if (hasExpr) {
      result.expressionOverride = true;
      msg += ' WARNING: this property has an ENABLED EXPRESSION that overrides the static value — the change is NOT visible. Remove the expression (apply_expression with expression:"") or edit it instead.';
    }
    var psNote = _parentSpaceNote(layer, propertyPath);
    if (psNote) { result.parentSpace = true; msg += psNote; }
    var hiddenMsg = _hiddenLayerWarning(layer);
    if (hiddenMsg) { result.hiddenLayer = true; msg += hiddenMsg; }
    result.message = msg;
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
function extensionsLlmChat_addEffect (layerIndex, layerId, effectMatchName, effectName) {
  var result = { ok: false, message: '', effectIndex: null };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
    // Guard: a missing/empty effect_match_name otherwise reaches
    // addProperty(null) and AE throws a cryptic "Can not add a property with
    // name null" — unhelpful to the agent. Return a clean, actionable error.
    if (effectMatchName === null || effectMatchName === undefined) {
      result.message = 'add_effect: missing required `effect_match_name` (effect matchName or display name, e.g. "Gaussian Blur").';
      return resultToJson(result);
    }
    var fxName = String(effectMatchName).replace(/^\s+|\s+$/g, '');
    if (fxName === '') {
      result.message = 'add_effect: `effect_match_name` must be a non-empty string.';
      return resultToJson(result);
    }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer does not support effects.'; return resultToJson(result); }
    _beginToolUndo('Agent: Add effect');
    var fx = effects.addProperty(fxName);
    // Optional rename — expression-library rigs reference sliders by custom
    // name (e.g. effect("Wiggle Freq")("Slider")), so the name must be settable.
    if (fx && typeof effectName === 'string' && effectName.length > 0) {
      try { fx.name = effectName; } catch (eRename) {}
    }
    _endToolUndo();
    if (!fx) { result.message = 'Failed to add effect "' + effectMatchName + '".'; return resultToJson(result); }
    result.ok = true;
    result.effectIndex = fx.propertyIndex;
    // Include the effect's settable properties inline so the agent doesn't
    // need a follow-up get_effect_properties round trip before configuring it.
    result.properties = [];
    try {
      for (var pi = 1; pi <= fx.numProperties; pi++) {
        try {
          var p = fx.property(pi);
          if (!p || !(p instanceof Property)) continue;
          var pInfo = { index: pi, name: p.name };
          try { pInfo.value = p.value; } catch (eV) {}
          result.properties.push(pInfo);
        } catch (eP) {}
      }
    } catch (eProps) {}
    result.message = 'Added effect "' + fx.name + '" (index ' + fx.propertyIndex + ') to "' + layer.name + '". Settable properties included in `properties` — configure with set_effect_property without re-reading.';
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
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
function extensionsLlmChat_setEffectPropertyValue (layerIndex, layerId, effectIndex, propIndex, value, propName) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
    var effects = layer.property('ADBE Effect Parade');
    if (!effects) { result.message = 'Layer has no effects.'; return resultToJson(result); }
    var fx = effects.property(effectIndex);
    if (!fx) { result.message = 'Effect not found.'; return resultToJson(result); }

    var prop = null;
    var resolvedBy = '';
    // Prefer property_name when provided.
    if (propName && typeof propName === 'string' && propName.length > 0) {
      try { prop = fx.property(propName); } catch (eName) { prop = null; }
      if (prop && prop instanceof Property) {
        resolvedBy = 'name "' + propName + '"';
      } else {
        // Build hint of available property names for the LLM to retry.
        var available = [];
        try {
          for (var pi = 1; pi <= fx.numProperties; pi++) {
            try {
              var pTry = fx.property(pi);
              if (pTry && pTry instanceof Property) available.push(pTry.name);
            } catch (ePT) {}
          }
        } catch (eAll) {}
        result.message = 'Effect property name "' + propName + '" not found on "' + fx.name + '". Available: ' + available.join(', ');
        return resultToJson(result);
      }
    } else if (typeof propIndex === 'number' && propIndex >= 1) {
      try { prop = fx.property(propIndex); } catch (eIdx) { prop = null; }
      if (!prop || !(prop instanceof Property)) {
        result.message = 'Effect property not found at index ' + propIndex + '. Pass property_name instead (e.g. "Color", "Amount").';
        return resultToJson(result);
      }
      resolvedBy = 'index ' + propIndex;
    } else {
      result.message = 'set_effect_property requires either property_name or property_index.';
      return resultToJson(result);
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
    result.message = 'Set "' + prop.name + '" on effect "' + fx.name + '" (resolved by ' + resolvedBy + ').';
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
function extensionsLlmChat_precomposeLayers (layerIndices, compName, moveAttributes, layerIds) {
  var result = { ok: false, message: '', precompName: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    // Persistent ids are safer than indices (indices shift on reorder) —
    // resolve them to current indices when provided.
    if ((!(layerIndices instanceof Array) || layerIndices.length === 0) && layerIds instanceof Array && layerIds.length > 0) {
      layerIndices = [];
      for (var idI = 0; idI < layerIds.length; idI++) {
        var found = null;
        for (var li = 1; li <= ctx.comp.numLayers; li++) {
          if (ctx.comp.layer(li).id === layerIds[idI]) { found = li; break; }
        }
        if (found === null) {
          result.message = 'Layer with id ' + layerIds[idI] + ' not found in the active comp.';
          return resultToJson(result);
        }
        layerIndices.push(found);
      }
    }
    if (!(layerIndices instanceof Array) || layerIndices.length === 0) {
      result.message = 'No layer indices provided. Pass layer_indices (1-based) or layer_ids.'; return resultToJson(result);
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
    // Bug fix 2026-07-27: was `typeof settings.bgColor instanceof Array` (always false).
    if (settings.bgColor instanceof Array) comp.bgColor = settings.bgColor;
    if (typeof settings.motionBlur === 'boolean') comp.motionBlur = settings.motionBlur;
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
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    var lockMsg = _lockedRefusal(layer);
    if (lockMsg) { result.message = lockMsg; return resultToJson(result); }
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
/* ── Scene snapshot helpers (2026-09-02) ─────────────────────────────────
 * The comp summary is the agent's world model. Until now it carried names,
 * types and timing but no transform VALUES, no keyframe ranges and no layer
 * switches — the prompt told the model to "check `enabled` in the summary"
 * while no read tool exposed it. These helpers add that state (and, in
 * fingerprint mode, hashes the panel uses to diff before/after a run).
 */

// Round numbers (and arrays of numbers) to 2 decimals: enough for pixels,
// percent and degrees, and far cheaper in tokens than raw doubles.
function _r2 (v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (v instanceof Array) {
    var out = [];
    for (var i = 0; i < v.length; i++) out.push(_r2(v[i]));
    return out;
  }
  return v;
}

// djb2 string hash → base36. ES3-safe; only used for fingerprint diffs.
function _hashStr (s) {
  var h = 5381;
  var str = String(s == null ? '' : s);
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h.toString(36);
}

// Comp-space point of a layer's Position at time t, walking the parent chain
// (2D, Z rotation only — the same approximation the round-6 hunt probe used
// to verify orbits; scripting has no toComp()).
function _compSpacePosition (layer, t) {
  var v = layer.property('ADBE Transform Group').property('ADBE Position').valueAtTime(t, false);
  var x = v[0];
  var y = v[1];
  var P = layer.parent;
  var hops = 0;
  while (P && hops < 16) {
    var pt = P.property('ADBE Transform Group');
    var pp = pt.property('ADBE Position').valueAtTime(t, false);
    var pa = pt.property('ADBE Anchor Point').valueAtTime(t, false);
    var ps = pt.property('ADBE Scale').valueAtTime(t, false);
    var pr = pt.property('ADBE Rotate Z').valueAtTime(t, false);
    var sx = (x - pa[0]) * ps[0] / 100;
    var sy = (y - pa[1]) * ps[1] / 100;
    var rad = pr * Math.PI / 180;
    x = pp[0] + sx * Math.cos(rad) - sy * Math.sin(rad);
    y = pp[1] + sx * Math.sin(rad) + sy * Math.cos(rad);
    P = P.parent;
    hops++;
  }
  return [x, y];
}

// Transform properties reported in the snapshot: [jsonKey, matchName, toolPath].
var _SNAPSHOT_PROPS = [
  ['anchorPoint', 'ADBE Anchor Point', 'Transform>Anchor Point'],
  ['position', 'ADBE Position', 'Transform>Position'],
  ['scale', 'ADBE Scale', 'Transform>Scale'],
  ['rotation', 'ADBE Rotate Z', 'Transform>Rotation'],
  ['opacity', 'ADBE Opacity', 'Transform>Opacity']
];

// {numKeys, from, to} for an animated property; `sig` (hash of every key's
// time+value) only in fingerprint mode so the panel can detect value edits
// that keep the key count.
function _keyRangeInfo (prop, fingerprint) {
  var n = prop.numKeys;
  var o = { numKeys: n, from: _r2(prop.keyTime(1)), to: _r2(prop.keyTime(n)) };
  // First/last key VALUES: before the first key a property holds the first
  // key's value, after the last key the last one — the two numbers that
  // decide whether a layer is visible outside its keyed window.
  try {
    var fv = prop.keyValue(1); var lv = prop.keyValue(n);
    if (typeof fv === 'number' || fv instanceof Array) { o.firstValue = _r2(fv); o.lastValue = _r2(lv); }
  } catch (eFv) {}
  if (fingerprint) {
    var src = '';
    for (var k = 1; k <= n; k++) {
      var kv = null;
      try { kv = prop.keyValue(k); } catch (eKv) {}
      if (kv !== null && typeof kv === 'object' && !(kv instanceof Array)) {
        try { kv = String(kv.text); } catch (eTx) { kv = ''; }
      }
      src += _r2(prop.keyTime(k)) + ':' + (kv instanceof Array ? _r2(kv).join(',') : String(_r2(kv))) + ';';
    }
    o.sig = _hashStr(src);
  }
  return o;
}

// Hash of an effect's first-level property values (fingerprint mode): lets
// the diff see set_effect_property edits without listing every value.
function _effectSig (eff) {
  var src = '';
  try { src += eff.enabled === false ? 'off;' : 'on;'; } catch (eEn) {}
  try {
    for (var i = 1; i <= eff.numProperties; i++) {
      var p = null;
      try { p = eff.property(i); } catch (eP) {}
      if (!p || !(p instanceof Property)) continue;
      var v = null;
      try { v = p.value; } catch (eV) {}
      if (v !== null && typeof v === 'object' && !(v instanceof Array)) v = '';
      src += (v instanceof Array ? _r2(v).join(',') : String(_r2(v))) + ';';
      try { if (p.expressionEnabled) src += 'x' + _hashStr(p.expression) + ';'; } catch (eX) {}
    }
  } catch (eAll) {}
  return _hashStr(src);
}

function extensionsLlmChat_getDetailedCompSummary (filterOptions) {
  var result = {
    ok: false, message: '', compName: '', compId: null, width: 0, height: 0,
    duration: 0, frameRate: 0, time: 0, bgColor: null, numLayers: 0, layers: []
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
    result.compId = comp.id;
    result.time = _r2(comp.time);
    try { result.bgColor = _r2(comp.bgColor); } catch (eBg) {}
    // fingerprint: panel-only flag (never in the tool schema) — adds `sig`
    // hashes so before/after snapshots can be diffed without dumping values.
    var fingerprint = opts.fingerprint === true;

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
          try { if (layer.enabled === false) compactInfo.enabled = false; } catch (eEnc) {}
          try { if (layer.locked === true) compactInfo.locked = true; } catch (eLkc) {}
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
                if (eff) {
                  var effInfo = { index: fi, name: eff.name, matchName: eff.matchName || '' };
                  if (fingerprint) effInfo.sig = _effectSig(eff);
                  info.effects.push(effInfo);
                }
              } catch (eEff) {}
            }
          }
        } catch (eFx) {}

        // Layer switches the agent must respect before building on a layer.
        try { info.enabled = layer.enabled === true; } catch (eEn) {}
        try { info.locked = layer.locked === true; } catch (eLk) {}
        try { if (layer.solo === true) info.solo = true; } catch (eSo) {}
        try { if (layer.shy === true) info.shy = true; } catch (eSh) {}

        // Transform VALUES at comp time, keyframe ranges per animated property
        // and expressions (path, snippet, error) — the agent no longer has to
        // guess where things are or spend a round trip per property.
        var anim = null;
        var tr = null;
        try { tr = layer.property('ADBE Transform Group'); } catch (eTr) {}
        if (tr) {
          var tv = {};
          for (var sp = 0; sp < _SNAPSHOT_PROPS.length; sp++) {
            var spKey = _SNAPSHOT_PROPS[sp][0];
            var pr = null;
            try { pr = tr.property(_SNAPSHOT_PROPS[sp][1]); } catch (ePr) {}
            if (!pr) continue;
            try { tv[spKey] = _r2(pr.valueAtTime(comp.time, false)); } catch (eVal) {}
            try {
              if (pr.numKeys > 0) {
                if (!anim) anim = {};
                anim[spKey] = _keyRangeInfo(pr, fingerprint);
              }
            } catch (eKeys) {}
            try {
              if (pr.expressionEnabled) {
                info.hasExpressions = true;
                if (!info.expressions) info.expressions = [];
                var exprEntry = { path: _SNAPSHOT_PROPS[sp][2] };
                var exprText = String(pr.expression || '');
                exprEntry.snippet = exprText.length > 120 ? exprText.substr(0, 120) + '...' : exprText;
                if (fingerprint) exprEntry.sig = _hashStr(exprText);
                try {
                  var exprErr = pr.expressionError || '';
                  if (exprErr && exprErr.length > 0) exprEntry.error = String(exprErr).substr(0, 160);
                } catch (eErr) {}
                info.expressions.push(exprEntry);
              }
            } catch (eExp) {}
          }
          if (info.threeDLayer) {
            try { tv.xRotation = _r2(tr.property('ADBE Rotate X').valueAtTime(comp.time, false)); } catch (eRx) {}
            try { tv.yRotation = _r2(tr.property('ADBE Rotate Y').valueAtTime(comp.time, false)); } catch (eRy) {}
          }
          info.transform = tv;
          // Parented layers: Position is in PARENT space — report the comp-space
          // point too, so frame-relative math has a real reference.
          if (info.parentIndex !== null) {
            try { info.compPosition = _r2(_compSpacePosition(layer, comp.time)); } catch (eCp) {}
          }
        }
        if (layerType === 'text') {
          try {
            var tdProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
            var tdVal = tdProp.valueAtTime(comp.time, false);
            var txt = String(tdVal.text || '');
            info.text = txt.length > 80 ? txt.substr(0, 80) + '...' : txt;
            if (fingerprint) info.textSig = _hashStr(txt);
            if (tdProp.numKeys > 0) {
              if (!anim) anim = {};
              anim.sourceText = _keyRangeInfo(tdProp, fingerprint);
            }
            if (tdProp.expressionEnabled) {
              info.hasExpressions = true;
              if (!info.expressions) info.expressions = [];
              var tdExpr = String(tdProp.expression || '');
              var tdEntry = { path: 'Text>Source Text', snippet: tdExpr.length > 120 ? tdExpr.substr(0, 120) + '...' : tdExpr };
              if (fingerprint) tdEntry.sig = _hashStr(tdExpr);
              info.expressions.push(tdEntry);
            }
          } catch (eTd) {}
        }
        try {
          if (layer.canSetTimeRemapEnabled && layer.timeRemapEnabled) {
            info.timeRemapEnabled = true;
            var rp = layer.property('ADBE Time Remapping');
            if (rp && rp.numKeys > 0) {
              if (!anim) anim = {};
              anim.timeRemap = _keyRangeInfo(rp, fingerprint);
            }
          }
        } catch (eRm) {}
        if (anim) info.animated = anim;
        try {
          var mk = layer.property('ADBE Mask Parade');
          if (mk && mk.numProperties > 0) info.numMasks = mk.numProperties;
        } catch (eMk) {}

        result.layers.push(info);
        addedCount++;
      } catch (eLayer) {}
    }

    result.ok = true;
    var filterNote = '';
    if (filterType) filterNote += ' (type: ' + filterType + ')';
    if (filterName) filterNote += ' (name: "' + opts.nameContains + '")';
    if (compact) filterNote += ' [compact]';
    result.message = 'Summary of "' + comp.name + '": ' + result.layers.length + '/' + comp.numLayers + ' layers' + filterNote + '.' +
      (compact ? '' : ' Transform values are at t=' + result.time + 's; `animated` lists keyframe ranges per property.');
    return resultToJson(result);
  } catch (e) {
    result.message = 'getDetailedCompSummary error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Phase 1 — Shape content creation
// ============================================================================

/**
 * Add a rectangle to a shape layer.
 */
function extensionsLlmChat_addShapeRect (layerIndex, layerId, opts) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found. Hint: pass the layer_id returned by create_layer(layer_type:"shape"), or call get_detailed_comp_summary first.'; return resultToJson(result); }
    if (!(layer instanceof ShapeLayer)) {
      var t1 = _layerTypeString ? _layerTypeString(layer) : 'unknown';
      result.message = 'Layer "' + layer.name + '" is type "' + t1 + '", but add_shape_rectangle requires a shape layer. Use create_layer(layer_type:"shape") first, then call add_shape_rectangle with the new layer_id.';
      return resultToJson(result);
    }
    if (!opts) opts = {};

    _beginToolUndo('Agent: Add rectangle');
    var contents = layer.property('ADBE Root Vectors Group');
    var grp = contents.addProperty('ADBE Vector Group');
    var groupName = typeof opts.name === 'string' && opts.name.length ? opts.name : 'Rectangle';
    grp.name = groupName;

    var vectors = grp.property('ADBE Vectors Group');
    var rect = vectors.addProperty('ADBE Vector Shape - Rect');
    // Capture the name NOW — later addProperty(Fill/Stroke) calls invalidate
    // this reference (ExtendScript "Object is invalid").
    var rectName = rect.name;
    var rectSize = rect.property('ADBE Vector Rect Size');
    if (rectSize) rectSize.setValue([typeof opts.width === 'number' ? opts.width : 200, typeof opts.height === 'number' ? opts.height : 200]);
    var rectPos = rect.property('ADBE Vector Rect Position');
    if (rectPos && opts.position instanceof Array) rectPos.setValue(opts.position);
    var rectRound = rect.property('ADBE Vector Rect Roundness');
    if (rectRound && typeof opts.roundness === 'number') rectRound.setValue(opts.roundness);

    if (opts.fill_color instanceof Array && opts.fill_color.length >= 3) {
      var fill = vectors.addProperty('ADBE Vector Graphic - Fill');
      fill.property('ADBE Vector Fill Color').setValue(opts.fill_color);
      if (typeof opts.fill_opacity === 'number') fill.property('ADBE Vector Fill Opacity').setValue(opts.fill_opacity);
    }
    if (opts.stroke_color instanceof Array && opts.stroke_color.length >= 3) {
      var stroke = vectors.addProperty('ADBE Vector Graphic - Stroke');
      stroke.property('ADBE Vector Stroke Color').setValue(opts.stroke_color);
      if (typeof opts.stroke_width === 'number') stroke.property('ADBE Vector Stroke Width').setValue(opts.stroke_width);
    }
    _endToolUndo();
    result.ok = true;
    result.groupName = grp.name;
    // Ready-to-use property paths — agents kept guessing these wrong.
    var basePath = 'Contents>' + groupName + '>Contents>' + rectName;
    result.sizePath = basePath + '>Size';
    result.positionPath = basePath + '>Position';
    result.roundnessPath = basePath + '>Roundness';
    result.message = 'Added rectangle "' + grp.name + '" to shape layer "' + layer.name + '". Size property path: "' + result.sizePath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.ok = false;
    result.message = 'addShapeRect error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Add an ellipse to a shape layer.
 */
function extensionsLlmChat_addShapeEllipse (layerIndex, layerId, opts) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found. Hint: pass the layer_id returned by create_layer(layer_type:"shape"), or call get_detailed_comp_summary to find the right index.'; return resultToJson(result); }
    if (!(layer instanceof ShapeLayer)) {
      var typeHint = _layerTypeString ? _layerTypeString(layer) : 'unknown';
      result.message = 'Layer "' + layer.name + '" is type "' + typeHint + '", but add_shape_ellipse requires a shape layer. Solid/text/null/adjustment/camera/light layers cannot hold shape content. Use create_layer(layer_type:"shape") first, then call add_shape_ellipse with the new layer_id.';
      return resultToJson(result);
    }
    if (!opts) opts = {};

    _beginToolUndo('Agent: Add ellipse');
    var contents = layer.property('ADBE Root Vectors Group');
    var grp = contents.addProperty('ADBE Vector Group');
    var groupName = typeof opts.name === 'string' && opts.name.length ? opts.name : 'Ellipse';
    grp.name = groupName;

    var vectors = grp.property('ADBE Vectors Group');
    var ellipse = vectors.addProperty('ADBE Vector Shape - Ellipse');
    // Capture the name NOW — later addProperty(Fill/Stroke) calls invalidate
    // this reference (ExtendScript "Object is invalid").
    var ellipseName = ellipse.name;
    var eSize = ellipse.property('ADBE Vector Ellipse Size');
    if (eSize) eSize.setValue([typeof opts.width === 'number' ? opts.width : 200, typeof opts.height === 'number' ? opts.height : 200]);
    var ePos = ellipse.property('ADBE Vector Ellipse Position');
    if (ePos && opts.position instanceof Array) ePos.setValue(opts.position);

    if (opts.fill_color instanceof Array && opts.fill_color.length >= 3) {
      var fill = vectors.addProperty('ADBE Vector Graphic - Fill');
      fill.property('ADBE Vector Fill Color').setValue(opts.fill_color);
      if (typeof opts.fill_opacity === 'number') fill.property('ADBE Vector Fill Opacity').setValue(opts.fill_opacity);
    }
    if (opts.stroke_color instanceof Array && opts.stroke_color.length >= 3) {
      var stroke = vectors.addProperty('ADBE Vector Graphic - Stroke');
      stroke.property('ADBE Vector Stroke Color').setValue(opts.stroke_color);
      if (typeof opts.stroke_width === 'number') stroke.property('ADBE Vector Stroke Width').setValue(opts.stroke_width);
    }
    _endToolUndo();
    result.ok = true;
    result.groupName = grp.name;
    // Ready-to-use property paths — agents kept guessing these wrong.
    var basePathE = 'Contents>' + groupName + '>Contents>' + ellipseName;
    result.sizePath = basePathE + '>Size';
    result.positionPath = basePathE + '>Position';
    result.message = 'Added ellipse "' + grp.name + '" to shape layer "' + layer.name + '". Size property path: "' + result.sizePath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.ok = false;
    result.message = 'addShapeEllipse error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Add a custom path to a shape layer.
 */
function extensionsLlmChat_addShapePath (layerIndex, layerId, opts) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found. Hint: pass the layer_id returned by create_layer(layer_type:"shape").'; return resultToJson(result); }
    if (!(layer instanceof ShapeLayer)) {
      var t2 = _layerTypeString ? _layerTypeString(layer) : 'unknown';
      result.message = 'Layer "' + layer.name + '" is type "' + t2 + '", but add_shape_path requires a shape layer. Use create_layer(layer_type:"shape") first.';
      return resultToJson(result);
    }
    if (!opts) opts = {};
    if (!(opts.vertices instanceof Array) || opts.vertices.length < 2) {
      result.message = 'vertices must be an array of at least 2 [x,y] points.';
      return resultToJson(result);
    }

    _beginToolUndo('Agent: Add path');
    var contents = layer.property('ADBE Root Vectors Group');
    var grp = contents.addProperty('ADBE Vector Group');
    var groupName = typeof opts.name === 'string' && opts.name.length ? opts.name : 'Path';
    grp.name = groupName;

    var vectors = grp.property('ADBE Vectors Group');
    var pathGrp = vectors.addProperty('ADBE Vector Shape - Group');
    // Capture the name NOW — later addProperty(Fill/Stroke) calls invalidate
    // this reference (ExtendScript "Object is invalid").
    var pathGrpName = pathGrp.name;
    var pathProp = pathGrp.property('ADBE Vector Shape');

    var shapeObj = new Shape();
    shapeObj.vertices = opts.vertices;
    if (opts.in_tangents instanceof Array) shapeObj.inTangents = opts.in_tangents;
    if (opts.out_tangents instanceof Array) shapeObj.outTangents = opts.out_tangents;
    shapeObj.closed = opts.closed !== false;
    pathProp.setValue(shapeObj);

    if (opts.fill_color instanceof Array && opts.fill_color.length >= 3) {
      var fill = vectors.addProperty('ADBE Vector Graphic - Fill');
      fill.property('ADBE Vector Fill Color').setValue(opts.fill_color);
    }
    if (opts.stroke_color instanceof Array && opts.stroke_color.length >= 3) {
      var stroke = vectors.addProperty('ADBE Vector Graphic - Stroke');
      stroke.property('ADBE Vector Stroke Color').setValue(opts.stroke_color);
      if (typeof opts.stroke_width === 'number') stroke.property('ADBE Vector Stroke Width').setValue(opts.stroke_width);
    }
    _endToolUndo();
    result.ok = true;
    result.groupName = grp.name;
    result.pathPropertyPath = 'Contents>' + groupName + '>Contents>' + pathGrpName + '>Path';
    result.message = 'Added path "' + grp.name + '" with ' + opts.vertices.length + ' vertices to "' + layer.name + '". Path property path: "' + result.pathPropertyPath + '".';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.ok = false;
    result.message = 'addShapePath error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Phase 2 — 3D / Camera / Light
// ============================================================================

/**
 * Toggle 3D on a layer.
 */
function extensionsLlmChat_setLayer3D (layerIndex, layerId, enabled) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (layer instanceof CameraLayer || layer instanceof LightLayer) {
      result.message = 'Camera and light layers are always 3D.'; return resultToJson(result);
    }
    _beginToolUndo('Agent: Set 3D');
    layer.threeDLayer = !!enabled;
    _endToolUndo();
    result.ok = true;
    result.message = 'Layer "' + layer.name + '" 3D ' + (enabled ? 'enabled' : 'disabled') + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setLayer3D error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set camera-specific properties.
 */
function extensionsLlmChat_setCameraProperties (layerIndex, layerId, props) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (!(layer instanceof CameraLayer)) { result.message = 'Layer is not a camera.'; return resultToJson(result); }
    if (!props) props = {};

    _beginToolUndo('Agent: Camera props');
    var changed = [];
    var camOpts = layer.property('ADBE Camera Options Group');
    if (typeof props.zoom === 'number' && camOpts) {
      var z = camOpts.property('ADBE Camera Zoom');
      if (z) { z.setValue(props.zoom); changed.push('zoom=' + props.zoom); }
    }
    if (typeof props.focus_distance === 'number' && camOpts) {
      var fd = camOpts.property('ADBE Camera Focus Distance');
      if (fd) { fd.setValue(props.focus_distance); changed.push('focusDist=' + props.focus_distance); }
    }
    if (typeof props.aperture === 'number' && camOpts) {
      var ap = camOpts.property('ADBE Camera Aperture');
      if (ap) { ap.setValue(props.aperture); changed.push('aperture=' + props.aperture); }
    }
    if (typeof props.blur_level === 'number' && camOpts) {
      var bl = camOpts.property('ADBE Camera Blur Level');
      if (bl) { bl.setValue(props.blur_level); changed.push('blurLevel=' + props.blur_level); }
    }
    if (props.depth_of_field !== undefined && camOpts) {
      var dof = camOpts.property('ADBE Camera Depth of Field');
      if (dof) { dof.setValue(props.depth_of_field ? 1 : 0); changed.push('DOF=' + (props.depth_of_field ? 'on' : 'off')); }
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Camera "' + layer.name + '": ' + (changed.length ? changed.join(', ') : 'no changes') + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setCameraProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set light-specific properties.
 */
function extensionsLlmChat_setLightProperties (layerIndex, layerId, props) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (!(layer instanceof LightLayer)) { result.message = 'Layer is not a light.'; return resultToJson(result); }
    if (!props) props = {};

    _beginToolUndo('Agent: Light props');
    var changed = [];
    var lightOpts = layer.property('ADBE Light Options Group');
    if (typeof props.intensity === 'number' && lightOpts) {
      var inten = lightOpts.property('ADBE Light Intensity');
      if (inten) { inten.setValue(props.intensity); changed.push('intensity=' + props.intensity); }
    }
    if (props.color instanceof Array && props.color.length >= 3 && lightOpts) {
      var col = lightOpts.property('ADBE Light Color');
      if (col) { col.setValue(props.color); changed.push('color set'); }
    }
    if (typeof props.cone_angle === 'number' && lightOpts) {
      var ca = lightOpts.property('ADBE Light Cone Angle');
      if (ca) { ca.setValue(props.cone_angle); changed.push('coneAngle=' + props.cone_angle); }
    }
    if (typeof props.cone_feather === 'number' && lightOpts) {
      var cf = lightOpts.property('ADBE Light Cone Feather');
      if (cf) { cf.setValue(props.cone_feather); changed.push('coneFeather=' + props.cone_feather); }
    }
    _endToolUndo();
    result.ok = true;
    result.message = 'Light "' + layer.name + '": ' + (changed.length ? changed.join(', ') : 'no changes') + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setLightProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Phase 5 — Mask operations
// ============================================================================

/**
 * Add a mask to a layer. Creates a rectangular or elliptical mask by default.
 */
function extensionsLlmChat_addMask (layerIndex, layerId, opts) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (!opts) opts = {};

    _beginToolUndo('Agent: Add mask');
    var maskGroup = layer.property('ADBE Mask Parade');
    if (!maskGroup) { _endToolUndo(); result.message = 'Layer does not support masks.'; return resultToJson(result); }
    var newMask = maskGroup.addProperty('ADBE Mask Atom');

    // Set mode using MaskMode enum — raw integers cause "not of the correct type" in some AE versions
    var modeMap = {
      'add': MaskMode.ADD, 'subtract': MaskMode.SUBTRACT, 'intersect': MaskMode.INTERSECT,
      'lighten': MaskMode.LIGHTEN, 'darken': MaskMode.DARKEN, 'difference': MaskMode.DIFFERENCE
    };
    var modeVal = modeMap[String(opts.mode || 'add').toLowerCase()];
    if (modeVal === undefined) modeVal = MaskMode.ADD;
    var modeEnumToName = {};
    modeEnumToName[MaskMode.ADD] = 'add'; modeEnumToName[MaskMode.SUBTRACT] = 'subtract';
    modeEnumToName[MaskMode.INTERSECT] = 'intersect'; modeEnumToName[MaskMode.LIGHTEN] = 'lighten';
    modeEnumToName[MaskMode.DARKEN] = 'darken'; modeEnumToName[MaskMode.DIFFERENCE] = 'difference';
    var warnings = [];
    // Set mask mode: try direct maskMode attribute FIRST (most reliable),
    // then fallback to property setValue if attribute fails.
    var modeSet = false;
    try { newMask.maskMode = modeVal; modeSet = true; } catch (eAttr) {
      // Attribute failed, try property setValue as fallback
      var modeProp = null;
      try { modeProp = newMask.property('ADBE Mask Mode'); } catch (e) {}
      if (!modeProp) { try { modeProp = newMask.property('maskMode'); } catch (e) {} }
      if (!modeProp) { try { modeProp = newMask.property(1); } catch (e) {} }
      if (modeProp) {
        try { modeProp.setValue(modeVal); modeSet = true; } catch (eMode) {
          warnings.push('mode set failed: ' + eAttr.toString() + ' / ' + eMode.toString());
        }
      } else {
        warnings.push('mode set failed: maskMode attribute: ' + eAttr.toString() + ', no mode property found');
      }
    }

    // Set mask shape — default to layer-sized rectangle
    if (opts.vertices instanceof Array && opts.vertices.length >= 3) {
      var shapeObj = new Shape();
      shapeObj.vertices = opts.vertices;
      if (opts.in_tangents instanceof Array) shapeObj.inTangents = opts.in_tangents;
      if (opts.out_tangents instanceof Array) shapeObj.outTangents = opts.out_tangents;
      shapeObj.closed = opts.closed !== false;
      try { newMask.property('ADBE Mask Shape').setValue(shapeObj); } catch (eShape) {
        warnings.push('custom shape failed: ' + eShape.toString());
      }
    } else {
      // Default rectangular mask — use sourceRectAtTime for text/shape layers,
      // fall back to layer.width/height for solids/footage, then comp dimensions.
      var maskLeft = 0, maskTop = 0, maskW = 0, maskH = 0;
      var gotRect = false;
      // sourceRectAtTime works on TextLayer, ShapeLayer, and AVLayer with source —
      // it returns the visual bounding box in layer coordinates (crucial for text & shapes
      // where layer.width/height just returns the comp dimensions).
      try {
        var rect = layer.sourceRectAtTime(ctx.comp.time, false);
        if (rect && typeof rect.width === 'number' && rect.width > 0 && typeof rect.height === 'number' && rect.height > 0) {
          maskLeft = rect.left;
          maskTop = rect.top;
          maskW = rect.width;
          maskH = rect.height;
          gotRect = true;
        }
      } catch (eRect) { /* sourceRectAtTime not available — fall through */ }
      if (!gotRect) {
        try { maskW = layer.width; maskH = layer.height; } catch (eDim) { maskW = ctx.comp.width; maskH = ctx.comp.height; }
      }
      var inset = typeof opts.inset === 'number' ? opts.inset : 0;
      var defShape = new Shape();
      defShape.vertices = [
        [maskLeft + inset, maskTop + inset],
        [maskLeft + maskW - inset, maskTop + inset],
        [maskLeft + maskW - inset, maskTop + maskH - inset],
        [maskLeft + inset, maskTop + maskH - inset]
      ];
      defShape.closed = true;
      try { newMask.property('ADBE Mask Shape').setValue(defShape); } catch (eDefShape) {
        warnings.push('default shape failed: ' + eDefShape.toString());
      }
    }

    if (typeof opts.feather === 'number') {
      try { newMask.property('ADBE Mask Feather').setValue([opts.feather, opts.feather]); } catch (eF) {
        warnings.push('feather failed: ' + eF.toString());
      }
    }
    if (typeof opts.opacity === 'number') {
      try { newMask.property('ADBE Mask Opacity').setValue(opts.opacity); } catch (eO) {
        warnings.push('opacity failed: ' + eO.toString());
      }
    }
    if (typeof opts.expansion === 'number') {
      try { newMask.property('ADBE Mask Offset').setValue(opts.expansion); } catch (eE) {
        warnings.push('expansion failed: ' + eE.toString());
      }
    }

    // Set mask mode AFTER shape is set — on freshly created masks, maskMode attribute
    // is silently ignored if set before the shape. Re-apply mode here for reliability.
    if (modeVal !== MaskMode.ADD) {
      try { newMask.maskMode = modeVal; } catch (eMode2) {
        // Try property setValue as last resort
        try {
          var mp2 = newMask.property('ADBE Mask Mode');
          if (mp2) mp2.setValue(modeVal);
        } catch (eMode3) {
          warnings.push('post-shape mode set failed: ' + eMode3.toString());
        }
      }
    }

    // Read back actual mode to report truthfully
    var actualMode = 'unknown';
    try {
      // Read maskMode attribute first (most reliable)
      var readModeVal = newMask.maskMode;
      actualMode = modeEnumToName[readModeVal] || 'unknown';
    } catch (eRead) {
      try {
        var readModeProp = newMask.property('ADBE Mask Mode');
        if (readModeProp) actualMode = modeEnumToName[readModeProp.value] || 'unknown';
      } catch (eRead2) {}
    }

    _endToolUndo();
    result.ok = true;
    result.maskIndex = maskGroup.numProperties;
    result.actualMode = actualMode;
    var msg = 'Added mask #' + maskGroup.numProperties + ' to "' + layer.name + '" (mode: ' + actualMode + ').';
    if (warnings.length > 0) {
      result.warnings = warnings;
      msg += ' Warnings: ' + warnings.join('; ');
    }
    result.message = msg;
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addMask error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Set mask properties (feather, opacity, expansion, mode) on an existing mask.
 */
function extensionsLlmChat_setMaskProperties (layerIndex, layerId, maskIndex, props) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (!props) props = {};

    var maskGroup = layer.property('ADBE Mask Parade');
    if (!maskGroup || maskIndex < 1 || maskIndex > maskGroup.numProperties) {
      result.message = 'Mask #' + maskIndex + ' not found.'; return resultToJson(result);
    }
    var mask = maskGroup.property(maskIndex);

    _beginToolUndo('Agent: Set mask props');
    var changed = [];
    var warnings = [];
    if (typeof props.feather === 'number') {
      try { mask.property('ADBE Mask Feather').setValue([props.feather, props.feather]); changed.push('feather=' + props.feather); } catch (e1) { warnings.push('feather failed: ' + e1.toString()); }
    }
    if (typeof props.opacity === 'number') {
      try { mask.property('ADBE Mask Opacity').setValue(props.opacity); changed.push('opacity=' + props.opacity); } catch (e2) { warnings.push('opacity failed: ' + e2.toString()); }
    }
    if (typeof props.expansion === 'number') {
      try { mask.property('ADBE Mask Offset').setValue(props.expansion); changed.push('expansion=' + props.expansion); } catch (e3) { warnings.push('expansion failed: ' + e3.toString()); }
    }
    if (typeof props.mode === 'string') {
      var modeMap2 = {
        'add': MaskMode.ADD, 'subtract': MaskMode.SUBTRACT, 'intersect': MaskMode.INTERSECT,
        'lighten': MaskMode.LIGHTEN, 'darken': MaskMode.DARKEN, 'difference': MaskMode.DIFFERENCE
      };
      var mv = modeMap2[props.mode.toLowerCase()];
      if (mv !== undefined) {
        // Try direct maskMode attribute first (most reliable)
        var modeOk = false;
        try { mask.maskMode = mv; modeOk = true; } catch (eAttr) {
          var mp = null;
          try { mp = mask.property('ADBE Mask Mode'); } catch (e) {}
          if (!mp) { try { mp = mask.property('maskMode'); } catch (e) {} }
          if (!mp) { try { mp = mask.property(1); } catch (e) {} }
          if (mp) {
            try { mp.setValue(mv); modeOk = true; } catch (e4) { warnings.push('mode failed: ' + eAttr.toString() + ' / ' + e4.toString()); }
          } else {
            warnings.push('mode failed: ' + eAttr.toString());
          }
        }
        if (modeOk) changed.push('mode=' + props.mode);
      }
    }
    if (typeof props.inverted === 'boolean') {
      try { mask.property('ADBE Mask Inverted').setValue(props.inverted); changed.push('inverted=' + props.inverted); } catch (e5) { warnings.push('inverted failed: ' + e5.toString()); }
    }
    _endToolUndo();
    result.ok = true;
    var msg = 'Mask #' + maskIndex + ' on "' + layer.name + '": ' + (changed.length ? changed.join(', ') : 'no changes') + '.';
    if (warnings.length > 0) {
      result.warnings = warnings;
      msg += ' Warnings: ' + warnings.join('; ');
    }
    result.message = msg;
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setMaskProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Read all masks on a layer.
 */
function extensionsLlmChat_getMaskInfo (layerIndex, layerId) {
  var result = { ok: false, message: '', masks: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    var maskGroup = layer.property('ADBE Mask Parade');
    if (!maskGroup) { result.ok = true; result.message = 'Layer has no mask support.'; return resultToJson(result); }

    var modeReadNames = {};
    modeReadNames[MaskMode.ADD] = 'add'; modeReadNames[MaskMode.SUBTRACT] = 'subtract';
    modeReadNames[MaskMode.INTERSECT] = 'intersect'; modeReadNames[MaskMode.LIGHTEN] = 'lighten';
    modeReadNames[MaskMode.DARKEN] = 'darken'; modeReadNames[MaskMode.DIFFERENCE] = 'difference';
    for (var mi = 1; mi <= maskGroup.numProperties; mi++) {
      var m = maskGroup.property(mi);
      var info = { index: mi, name: '', mode: '', feather: 0, opacity: 100, expansion: 0, inverted: false, numVertices: 0 };
      try { info.name = m.name; } catch (e1) {}
      try { info.mode = modeReadNames[m.property('ADBE Mask Mode').value] || 'unknown'; } catch (e2) {}
      try { var fv = m.property('ADBE Mask Feather').value; info.feather = typeof fv === 'number' ? fv : fv[0]; } catch (e3) {}
      try { info.opacity = m.property('ADBE Mask Opacity').value; } catch (e4) {}
      try { info.expansion = m.property('ADBE Mask Offset').value; } catch (e5) {}
      try { info.inverted = m.property('ADBE Mask Inverted').value; } catch (e6) {}
      try { info.numVertices = m.property('ADBE Mask Shape').value.vertices.length; } catch (e7) {}
      result.masks.push(info);
    }
    result.ok = true;
    result.message = layer.name + ': ' + result.masks.length + ' mask(s).';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getMaskInfo error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Create Shapes from Text — converts a text layer into a shape layer
 * with vector outlines of each glyph. Uses app.executeCommand(3736)
 * ("Create Shapes from Text" in AE Layer menu).
 * The original text layer is preserved (hidden). A new shape layer is created.
 */
function extensionsLlmChat_createShapesFromText (layerIndex, layerId) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    // Verify it's a text layer
    if (!(layer instanceof TextLayer)) {
      result.message = 'Layer "' + layer.name + '" is not a text layer. Create Shapes from Text only works on text layers.';
      return resultToJson(result);
    }

    var layersBefore = ctx.comp.numLayers;
    var textLayerName = layer.name;

    // Snapshot existing layer ids so we can identify the newly created shape
    // layer by difference. AE inserts it directly ABOVE the source text layer,
    // NOT at the top of the stack — so a fixed layer(1) lookup misidentifies it
    // whenever the text layer isn't already topmost.
    var beforeIds = {};
    for (var bi = 1; bi <= ctx.comp.numLayers; bi++) {
      try { beforeIds['_' + ctx.comp.layer(bi).id] = true; } catch (eBid) {}
    }

    _beginToolUndo('Agent: Create shapes from text');

    // Select only this layer (required for menu commands)
    for (var i = 1; i <= ctx.comp.numLayers; i++) {
      ctx.comp.layer(i).selected = (i === layer.index);
    }

    // Execute "Create Shapes from Text" — creates a new shape layer above the text layer
    app.executeCommand(3736);

    var layersAfter = ctx.comp.numLayers;
    _endToolUndo();

    if (layersAfter > layersBefore) {
      // Identify the new shape layer by the id that wasn't present before.
      // It sits directly above the source text layer, not necessarily at index 1.
      var newLayer = null;
      for (var ai = 1; ai <= ctx.comp.numLayers; ai++) {
        var cand = ctx.comp.layer(ai);
        var cid = null;
        try { cid = cand.id; } catch (eCid) {}
        if (cid !== null && !beforeIds['_' + cid]) { newLayer = cand; break; }
      }
      // Fallback: AE places it directly above the (now shifted-down) text layer.
      if (!newLayer) newLayer = ctx.comp.layer(Math.max(1, layer.index - 1));
      result.ok = true;
      result.newLayerIndex = newLayer.index;
      try { result.newLayerId = newLayer.id; } catch (e) {}
      result.newLayerName = newLayer.name;
      result.message = 'Created shape layer "' + newLayer.name + '" from text outlines of "' + textLayerName + '". ' +
        'Original text layer is preserved (may be hidden). The shape layer contains vector paths for each glyph.';
    } else {
      result.ok = false;
      result.message = 'Create Shapes from Text command did not produce a new layer. ' +
        'Ensure the text layer "' + textLayerName + '" has visible text content and is not locked.';
    }
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'createShapesFromText error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Phase 6 — Markers
// ============================================================================

/**
 * Add a marker to a layer or the composition.
 * target: "layer" (default) or "comp"
 */
function extensionsLlmChat_addMarker (layerIndex, layerId, opts) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    if (!opts) opts = {};

    var time = typeof opts.time === 'number' ? opts.time : ctx.comp.time;
    var comment = typeof opts.comment === 'string' ? opts.comment : '';
    var markerVal = new MarkerValue(comment);
    if (typeof opts.duration === 'number' && opts.duration > 0) markerVal.duration = opts.duration;

    _beginToolUndo('Agent: Add marker');
    if (opts.target === 'comp') {
      ctx.comp.markerProperty.setValueAtTime(time, markerVal);
      _endToolUndo();
      result.ok = true;
      result.message = 'Added comp marker at t=' + time + 's: "' + comment + '".';
    } else {
      var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
      if (!layer) { _endToolUndo(); result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
      layer.marker.setValueAtTime(time, markerVal);
      _endToolUndo();
      result.ok = true;
      result.message = 'Added marker at t=' + time + 's on "' + layer.name + '": "' + comment + '".';
    }
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addMarker error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Read all markers from a layer or comp.
 */
function extensionsLlmChat_getMarkers (layerIndex, layerId, target) {
  var result = { ok: false, message: '', markers: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }

    var markerProp = null;
    var targetName = '';
    if (target === 'comp') {
      markerProp = ctx.comp.markerProperty;
      targetName = 'comp "' + ctx.comp.name + '"';
    } else {
      var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
      if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
      markerProp = layer.marker;
      targetName = 'layer "' + layer.name + '"';
    }

    for (var ki = 1; ki <= markerProp.numKeys; ki++) {
      var mv = markerProp.keyValue(ki);
      result.markers.push({
        index: ki,
        time: markerProp.keyTime(ki),
        comment: mv.comment || '',
        duration: mv.duration || 0
      });
    }
    result.ok = true;
    result.message = targetName + ': ' + result.markers.length + ' marker(s).';
    return resultToJson(result);
  } catch (e) {
    result.message = 'getMarkers error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Delete a marker by index.
 */
function extensionsLlmChat_deleteMarker (layerIndex, layerId, markerIndex, target) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }

    var markerProp = null;
    if (target === 'comp') {
      markerProp = ctx.comp.markerProperty;
    } else {
      var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
      if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
      markerProp = layer.marker;
    }

    if (markerIndex < 1 || markerIndex > markerProp.numKeys) {
      result.message = 'Marker index ' + markerIndex + ' out of range (1..' + markerProp.numKeys + ').';
      return resultToJson(result);
    }

    _beginToolUndo('Agent: Delete marker');
    markerProp.removeKey(markerIndex);
    _endToolUndo();
    result.ok = true;
    result.message = 'Deleted marker #' + markerIndex + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'deleteMarker error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Phase 7 — Import / Project items
// ============================================================================

/**
 * List all project items.
 */
function extensionsLlmChat_listProjectItems (opts) {
  var result = { ok: false, message: '', items: [] };
  try {
    if (!app.project) { result.message = 'No project open.'; return resultToJson(result); }
    if (!opts) opts = {};
    var maxItems = typeof opts.maxItems === 'number' ? opts.maxItems : 100;

    for (var i = 1; i <= app.project.numItems && result.items.length < maxItems; i++) {
      var item = null;
      try { item = app.project.item(i); } catch (eItem) { continue; }
      if (!item) continue;

      var info = { index: i, name: '', typeName: '', itemType: '' };
      try { info.name = item.name; } catch (e1) {}
      try { info.typeName = item.typeName; } catch (e2) {}

      if (item instanceof CompItem) {
        info.itemType = 'comp';
        try { info.width = item.width; info.height = item.height; info.duration = item.duration; info.frameRate = item.frameRate; } catch (e3) {}
      } else if (item instanceof FolderItem) {
        info.itemType = 'folder';
      } else if (item instanceof FootageItem) {
        info.itemType = 'footage';
        try { info.width = item.width; info.height = item.height; info.duration = item.duration || 0; } catch (e4) {}
        try { if (item.file) info.filePath = item.file.fsName; } catch (e5) {}
        try { info.hasVideo = item.hasVideo; info.hasAudio = item.hasAudio; } catch (e6) {}
      }
      result.items.push(info);
    }
    result.ok = true;
    result.message = result.items.length + ' project item(s) listed.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'listProjectItems error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Import a file into the project.
 */
function extensionsLlmChat_importFile (filePath) {
  var result = { ok: false, message: '', itemIndex: null, itemName: '' };
  try {
    if (!app.project) { result.message = 'No project open.'; return resultToJson(result); }
    if (typeof filePath !== 'string' || !filePath.length) { result.message = 'No file path.'; return resultToJson(result); }

    var f = new File(filePath);
    if (!f.exists) { result.message = 'File not found: ' + filePath; return resultToJson(result); }

    _beginToolUndo('Agent: Import file');
    var importOpts = new ImportOptions(f);
    var item = app.project.importFile(importOpts);
    _endToolUndo();

    if (!item) { result.message = 'Import returned null.'; return resultToJson(result); }
    result.ok = true;
    result.itemIndex = item.index;
    result.itemName = item.name;
    try { result.width = item.width; result.height = item.height; } catch (e2) {}
    result.message = 'Imported "' + item.name + '" (index ' + item.index + ').';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'importFile error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Add a project item to the active composition as a new layer.
 */
function extensionsLlmChat_addItemToComp (projectItemIndex) {
  var result = { ok: false, message: '', layerIndex: null, layerId: null };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    if (typeof projectItemIndex !== 'number' || projectItemIndex < 1 || projectItemIndex > app.project.numItems) {
      result.message = 'Invalid project item index: ' + projectItemIndex; return resultToJson(result);
    }
    var item = app.project.item(projectItemIndex);
    if (!item) { result.message = 'Project item not found.'; return resultToJson(result); }
    if (item instanceof FolderItem) { result.message = 'Cannot add a folder to a composition.'; return resultToJson(result); }

    _beginToolUndo('Agent: Add item to comp');
    var layer = ctx.comp.layers.add(item);
    _endToolUndo();

    result.ok = true;
    result.layerIndex = layer.index;
    result.layerId = layer.id;
    result.layerName = layer.name;
    result.message = 'Added "' + item.name + '" to "' + ctx.comp.name + '" at index ' + layer.index + '.';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'addItemToComp error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * List effects installed in this AE instance (built-in + third-party),
 * filtered by name/matchName substring and optional category.
 */
function extensionsLlmChat_listAvailableEffects (filter, category, maxResults) {
  var result = { ok: false, message: '' };
  try {
    var max = (typeof maxResults === 'number' && maxResults > 0) ? maxResults : 25;
    var f = (typeof filter === 'string' && filter.length) ? filter.toLowerCase() : null;
    var cat = (typeof category === 'string' && category.length) ? category.toLowerCase() : null;
    var list = [];
    var total = 0;
    var all = app.effects;
    for (var i = 0; i < all.length; i++) {
      var fx = all[i];
      if (!fx) continue;
      var dn = String(fx.displayName || '');
      var mn = String(fx.matchName || '');
      var cg = String(fx.category || '');
      if (cat && cg.toLowerCase().indexOf(cat) === -1) continue;
      if (f && dn.toLowerCase().indexOf(f) === -1 && mn.toLowerCase().indexOf(f) === -1) continue;
      total++;
      if (list.length < max) {
        list.push({ displayName: dn, matchName: mn, category: cg });
      }
    }
    result.ok = true;
    result.totalMatches = total;
    result.effects = list;
    result.message = 'Found ' + total + ' installed effect(s)' +
      (total > list.length ? ', returning first ' + list.length + ' — refine the filter for more specific results' : '') + '.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'Failed to list available effects: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Convert a panel-style property path ("Transform>Position",
 * "Effects>Slider Control>Slider", "Masks>Mask 1>Mask Expansion",
 * "Text>Source Text") into an expression reference fragment.
 * Returns null for unsupported paths.
 */
function _exprRefForPath (path) {
  var parts = path.split('>');
  function q (s) { return String(s).replace(/"/g, '\\"'); }
  if (parts[0] === 'Transform' && parts.length === 2) {
    var tmap = {
      'Position': 'transform.position',
      'Scale': 'transform.scale',
      'Rotation': 'transform.rotation',
      'Opacity': 'transform.opacity',
      'Anchor Point': 'transform.anchorPoint',
      'X Rotation': 'transform.xRotation',
      'Y Rotation': 'transform.yRotation',
      'Z Rotation': 'transform.zRotation'
    };
    return tmap[parts[1]] || null;
  }
  if (parts[0] === 'Effects' && parts.length === 3) {
    return 'effect("' + q(parts[1]) + '")("' + q(parts[2]) + '")';
  }
  if (parts[0] === 'Masks' && parts.length === 3) {
    var mmap = {
      'Mask Expansion': 'maskExpansion',
      'Mask Feather': 'maskFeather',
      'Mask Opacity': 'maskOpacity',
      'Mask Path': 'maskPath'
    };
    var mp = mmap[parts[2]];
    if (!mp) return null;
    return 'mask("' + q(parts[1]) + '").' + mp;
  }
  if (path === 'Text>Source Text') return 'text.sourceText';
  return null;
}

/**
 * Serialize a number or numeric array as an expression literal ("[10, 20]").
 * Returns null for anything else.
 */
function _exprNumLiteral (v) {
  if (typeof v === 'number' && isFinite(v)) return String(v);
  if (v instanceof Array) {
    var parts = [];
    for (var i = 0; i < v.length; i++) {
      if (typeof v[i] !== 'number' || !isFinite(v[i])) return null;
      parts.push(String(v[i]));
    }
    return '[' + parts.join(', ') + ']';
  }
  return null;
}

/**
 * Link a target property to a source property via a generated expression:
 *   thisComp.layer("Source").transform.position [* scale] [+ offset]
 * Verifies the source property exists, then delegates to
 * extensionsLlmChat_applyExpressionToTarget (error check + rollback +
 * evaluated-value readback). opts: { scale, offset }.
 */
function extensionsLlmChat_linkProperties (targetIndex, targetId, targetPath, sourceIndex, sourceId, sourcePath, opts) {
  var result = { ok: false, message: '' };
  try {
    if (!opts) opts = {};
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) {
      result.message = ctx.message || 'Please select a composition in the timeline and try again.';
      return resultToJson(result);
    }
    var srcLayer = _resolveLayer(ctx.comp, sourceIndex, sourceId);
    if (!srcLayer) {
      result.message = 'Source layer not found (index ' + sourceIndex + ', id ' + sourceId + ').';
      return resultToJson(result);
    }
    var srcProp = _resolveProperty(srcLayer, sourcePath);
    if (!srcProp) {
      result.message = 'Source property path "' + sourcePath + '" could not be resolved on layer "' + srcLayer.name + '".';
      return resultToJson(result);
    }
    var ref = _exprRefForPath(sourcePath);
    if (!ref) {
      result.message = 'Unsupported source property path for linking: "' + sourcePath + '". Supported: Transform>*, Effects>Name>Prop, Masks>Name>Prop, Text>Source Text.';
      return resultToJson(result);
    }
    var expr = 'thisComp.layer("' + String(srcLayer.name).replace(/"/g, '\\"') + '").' + ref;
    if (typeof opts.scale === 'number' && isFinite(opts.scale) && opts.scale !== 1) {
      expr = '(' + expr + ') * ' + opts.scale;
    }
    if (opts.offset !== null && opts.offset !== undefined) {
      var offLit = _exprNumLiteral(opts.offset);
      if (offLit === null) {
        result.message = 'Invalid offset for link_properties: expected a number or numeric array.';
        return resultToJson(result);
      }
      expr = expr + ' + ' + offLit;
    }
    // Delegate — returns a JSON string. Splice the generated expression in so
    // the agent sees exactly what was applied.
    var applied = extensionsLlmChat_applyExpressionToTarget(targetIndex, targetId, targetPath, expr);
    try {
      var exprJson = resultToJson({ expression: expr });
      if (typeof applied === 'string' && applied.charAt(0) === '{') {
        return exprJson.substring(0, exprJson.length - 1) + ',' + applied.substring(1);
      }
    } catch (eSplice) {}
    return applied;
  } catch (e) {
    result.message = 'linkProperties error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// JSON serializer for tool results (ExtendScript ES3 — no native JSON.stringify)
// ============================================================================

function resultToJson (obj) {
  function serializeValue (value) {
    if (value === null || value === undefined) {
      return 'null';
    }
    var t = typeof value;
    if (t === 'string') {
      // Escape control chars too — AE error strings contain raw \r\n, which
      // produced invalid JSON and made the panel drop the ok:false status.
      var s = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      s = s.replace(/[\u0000-\u001f]/g, function (ch) {
        var code = ch.charCodeAt(0).toString(16);
        while (code.length < 4) code = '0' + code;
        return '\\u' + code;
      });
      return '"' + s + '"';
    }
    if (t === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (t === 'number') {
      return value.toString();
    }
    if (value instanceof Array) {
      var items = [];
      for (var i = 0; i < value.length; i++) {
        items.push(serializeValue(value[i]));
      }
      return '[' + items.join(',') + ']';
    }
    var parts = [];
    for (var key in value) {
      if (!value.hasOwnProperty(key)) continue;
      parts.push('"' + key + '":' + serializeValue(value[key]));
    }
    return '{' + parts.join(',') + '}';
  }

  return serializeValue(obj);
}

/**
 * Determine the number of temporal ease dimensions for a property.
 * Reads existing ease from a key when available; falls back to value
 * inspection. Used by add_keyframes and set_keyframe_easing.
 */
function _getTemporalEaseDims (prop, keyIndex) {
  if (typeof keyIndex === 'number' && keyIndex >= 1 && keyIndex <= prop.numKeys) {
    try {
      var existing = prop.keyTemporalEase(keyIndex, false);
      if (existing instanceof Array && existing.length > 0) return existing.length;
    } catch (e1) {}
    try {
      var ex2 = prop.keyTemporalEase(keyIndex);
      if (ex2 instanceof Array && ex2.length > 0) return ex2.length;
    } catch (e2) {}
  }
  if (prop.numKeys >= 1) {
    var probe = (typeof keyIndex === 'number' && keyIndex >= 1) ? keyIndex : 1;
    try {
      var ex3 = prop.keyTemporalEase(probe);
      if (ex3 instanceof Array && ex3.length > 0) return ex3.length;
    } catch (e3) {}
  }
  try {
    var v = prop.value;
    if (v instanceof Array) return v.length;
  } catch (e4) {}
  return 1;
}

// ============================================================================
// Track matte / layer switches / time remap / split / open comp (2026-07-27)
// ============================================================================

/**
 * Set (or remove) a track matte on a layer.
 * Modern AE (23.0+): uses layer.setTrackMatte(matteLayer, type) — the matte can
 * be ANY layer. Legacy AE: falls back to layer.trackMatteType, which always
 * uses the layer directly above as the matte.
 * @param {string} matteType 'alpha'|'alpha_inverted'|'luma'|'luma_inverted'|'none'
 */
function extensionsLlmChat_setTrackMatte (layerIndex, layerId, matteType, matteLayerIndex, matteLayerId) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    var typeMap = {
      'alpha': TrackMatteType.ALPHA,
      'alpha_inverted': TrackMatteType.ALPHA_INVERTED,
      'luma': TrackMatteType.LUMA,
      'luma_inverted': TrackMatteType.LUMA_INVERTED,
      'none': TrackMatteType.NO_TRACK_MATTE
    };
    var typeKey = String(matteType || '').toLowerCase().replace(/[\s-]/g, '_');
    var typeVal = typeMap[typeKey];
    if (typeVal === undefined) {
      result.message = 'Unknown matte_type: "' + matteType + '". Supported: alpha, alpha_inverted, luma, luma_inverted, none.';
      return resultToJson(result);
    }

    var hasModernApi = (typeof layer.setTrackMatte === 'function');

    if (typeKey === 'none') {
      _beginToolUndo('Agent: Remove track matte');
      if (hasModernApi && typeof layer.removeTrackMatte === 'function') {
        layer.removeTrackMatte();
      } else {
        layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
      }
      _endToolUndo();
      result.ok = true;
      result.message = 'Track matte removed from "' + layer.name + '".';
      return resultToJson(result);
    }

    // Resolve the matte layer (optional in legacy mode — defaults to the layer above).
    var matteLayer = null;
    if (matteLayerIndex !== null && matteLayerIndex !== undefined || matteLayerId !== null && matteLayerId !== undefined) {
      matteLayer = _resolveLayer(ctx.comp, matteLayerIndex, matteLayerId);
      if (!matteLayer) { result.message = 'Matte layer not found (matte_layer_index=' + matteLayerIndex + ', matte_layer_id=' + matteLayerId + ').'; return resultToJson(result); }
      if (matteLayer.id === layer.id) { result.message = 'A layer cannot be its own track matte.'; return resultToJson(result); }
    }

    if (hasModernApi) {
      if (!matteLayer) {
        // Default to the layer directly above (classic behavior).
        if (layer.index <= 1) { result.message = 'No matte layer specified and no layer above "' + layer.name + '". Provide matte_layer_index or matte_layer_id.'; return resultToJson(result); }
        matteLayer = ctx.comp.layer(layer.index - 1);
      }
      _beginToolUndo('Agent: Set track matte');
      layer.setTrackMatte(matteLayer, typeVal);
      _endToolUndo();
      result.ok = true;
      result.message = 'Track matte on "' + layer.name + '": ' + typeKey + ' from "' + matteLayer.name + '".';
    } else {
      // Legacy API: matte is ALWAYS the layer directly above.
      if (matteLayer && matteLayer.index !== layer.index - 1) {
        result.message = 'This AE version only supports the layer directly above as matte. "' + matteLayer.name + '" is at index ' + matteLayer.index + ', but "' + layer.name + '" is at index ' + layer.index + '. Use reorder_layer to place the matte at index ' + (layer.index - 1) + ' first.';
        return resultToJson(result);
      }
      if (layer.index <= 1) { result.message = 'No layer above "' + layer.name + '" to use as matte.'; return resultToJson(result); }
      _beginToolUndo('Agent: Set track matte');
      layer.trackMatteType = typeVal;
      _endToolUndo();
      var above = ctx.comp.layer(layer.index - 1);
      result.ok = true;
      result.message = 'Track matte on "' + layer.name + '": ' + typeKey + ' from layer above ("' + above.name + '").';
    }
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setTrackMatte error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Toggle common layer switches in one call. Only keys present in `switches`
 * are touched. Lock ordering: unlocking happens FIRST (a locked layer rejects
 * changes), locking happens LAST.
 */
function extensionsLlmChat_setLayerSwitches (layerIndex, layerId, switches) {
  var result = { ok: false, message: '', changed: [], warnings: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (!switches || typeof switches !== 'object') {
      result.message = 'No switches provided. Supported: enabled, motion_blur, adjustment, shy, solo, locked, guide, collapse_transformation, effects_active, audio_enabled.';
      return resultToJson(result);
    }

    var propMap = {
      enabled: 'enabled',
      motion_blur: 'motionBlur',
      adjustment: 'adjustmentLayer',
      shy: 'shy',
      solo: 'solo',
      guide: 'guideLayer',
      collapse_transformation: 'collapseTransformation',
      effects_active: 'effectsActive',
      audio_enabled: 'audioEnabled'
    };

    _beginToolUndo('Agent: Layer switches');
    // Unlock first so other switches can be applied.
    if (switches.locked === false && layer.locked) {
      try { layer.locked = false; result.changed.push('locked=false'); } catch (eU) { result.warnings.push('locked: ' + eU.toString()); }
    }
    for (var key in propMap) {
      if (!propMap.hasOwnProperty(key)) continue;
      if (typeof switches[key] !== 'boolean') continue;
      var aeProp = propMap[key];
      try {
        layer[aeProp] = switches[key];
        result.changed.push(key + '=' + switches[key]);
      } catch (eSet) {
        result.warnings.push(key + ': ' + eSet.toString());
      }
    }
    if (switches.locked === true) {
      try { layer.locked = true; result.changed.push('locked=true'); } catch (eL) { result.warnings.push('locked: ' + eL.toString()); }
    }
    _endToolUndo();

    if (result.changed.length === 0 && result.warnings.length === 0) {
      result.message = 'No boolean switch values provided. Supported: enabled, motion_blur, adjustment, shy, solo, locked, guide, collapse_transformation, effects_active, audio_enabled.';
      return resultToJson(result);
    }
    result.ok = true;
    result.message = 'Layer "' + layer.name + '": ' + (result.changed.length ? result.changed.join(', ') : 'nothing changed') +
      (result.warnings.length ? '. Warnings: ' + result.warnings.join('; ') : '') +
      ((switches.motion_blur === true && !ctx.comp.motionBlur) ? '. NOTE: comp-level Motion Blur switch is OFF — enable it via set_comp_settings { motion_blur: true } or blur will not render.' : '');
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setLayerSwitches error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Enable/disable time remapping on a layer. After enabling, animate the
 * "Time Remap" property with the existing keyframe tools (property_path
 * "Time Remap") for freeze frames and speed ramps.
 */
function extensionsLlmChat_setTimeRemap (layerIndex, layerId, enabled) {
  var result = { ok: false, message: '', propertyPath: 'Time Remap', numKeys: 0 };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }

    var can = false;
    try { can = layer.canSetTimeRemapEnabled; } catch (eCan) { can = false; }
    if (!can) {
      result.message = 'Layer "' + layer.name + '" does not support time remapping (only footage and precomp layers do). Precompose it first if you need to retime a ' + _layerTypeString(layer) + '.';
      return resultToJson(result);
    }

    _beginToolUndo('Agent: Time remap');
    layer.timeRemapEnabled = !!enabled;
    _endToolUndo();

    result.ok = true;
    if (enabled) {
      var tr = null;
      try { tr = layer.property('ADBE Time Remapping'); } catch (eTr) { tr = null; }
      if (tr) { try { result.numKeys = tr.numKeys; } catch (eK) {} }
      result.message = 'Time remap enabled on "' + layer.name + '" (' + result.numKeys + ' initial keyframes). Animate property "Time Remap" (value = source time in seconds) with add_keyframes / set_keyframe_easing. For a freeze frame: two keyframes with the same value, or hold interpolation.';
    } else {
      result.message = 'Time remap disabled on "' + layer.name + '".';
    }
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'setTimeRemap error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Split a layer at a time: the original keeps [inPoint, time], a duplicate
 * (placed directly above) plays [time, outPoint]. Mirrors AE's Edit > Split
 * Layer, implemented deterministically via duplicate + trim.
 */
function extensionsLlmChat_splitLayer (layerIndex, layerId, time) {
  var result = { ok: false, message: '', firstPart: null, secondPart: null };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = _layerNotFoundMsg(layerId, layerIndex); return resultToJson(result); }
    if (typeof time !== 'number') { result.message = 'split_layer: missing required `time` (seconds).'; return resultToJson(result); }
    if (time <= layer.inPoint || time >= layer.outPoint) {
      result.message = 'Split time ' + time + 's is outside the layer\'s visible span (' + layer.inPoint + 's – ' + layer.outPoint + 's). Pick a time strictly inside.';
      return resultToJson(result);
    }

    _beginToolUndo('Agent: Split layer');
    var dup = layer.duplicate(); // lands directly above the original
    layer.outPoint = time;
    dup.inPoint = time;
    _endToolUndo();

    result.ok = true;
    result.firstPart = { layerIndex: layer.index, layerId: layer.id, layerName: layer.name, inPoint: layer.inPoint, outPoint: layer.outPoint };
    result.secondPart = { layerIndex: dup.index, layerId: dup.id, layerName: dup.name, inPoint: dup.inPoint, outPoint: dup.outPoint };
    result.message = 'Split "' + layer.name + '" at ' + time + 's. First part: "' + layer.name + '" (index ' + layer.index + ', until ' + time + 's). Second part: "' + dup.name + '" (index ' + dup.index + ', from ' + time + 's).';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'splitLayer error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Open a composition in the viewer and make it the active comp for all
 * subsequent tools. Find by comp_id (preferred, from list_project_items /
 * precompose_layers / create_comp results) or by exact name.
 */
function extensionsLlmChat_openComp (compId, compName) {
  var result = { ok: false, message: '', compId: null, compName: '', width: 0, height: 0, duration: 0, frameRate: 0, numLayers: 0 };
  try {
    if (!app || !app.project) { result.message = 'No active project.'; return resultToJson(result); }

    var comp = null;
    if (typeof compId === 'number') {
      var byId = null;
      try { byId = app.project.itemByID(compId); } catch (eId) { byId = null; }
      if (byId && (byId instanceof CompItem)) comp = byId;
      if (!comp) { result.message = 'No composition with id ' + compId + '. Use list_project_items to see available comps.'; return resultToJson(result); }
    } else if (typeof compName === 'string' && compName !== '') {
      var matches = [];
      for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if ((item instanceof CompItem) && item.name === compName) matches.push(item);
      }
      if (matches.length === 0) { result.message = 'No composition named "' + compName + '". Use list_project_items to see available comps.'; return resultToJson(result); }
      if (matches.length > 1) {
        // List the candidate ids right here — sending the model off to
        // list_project_items led to guessed (wrong) ids live in round-6.
        var _cands = [];
        for (var mi = 0; mi < matches.length; mi++) {
          _cands.push('id ' + matches[mi].id + ' (' + matches[mi].width + 'x' + matches[mi].height + ', ' + matches[mi].numLayers + ' layers, ' + matches[mi].duration.toFixed(2) + 's)');
        }
        result.message = matches.length + ' compositions are named "' + compName + '". Call open_comp again with one of these comp_id values: ' + _cands.join('; ') + '.';
        return resultToJson(result);
      }
      comp = matches[0];
    } else {
      result.message = 'open_comp: provide `comp_id` (preferred) or `comp_name`.';
      return resultToJson(result);
    }

    comp.openInViewer();

    result.ok = true;
    result.compId = comp.id;
    result.compName = comp.name;
    result.width = comp.width;
    result.height = comp.height;
    result.duration = comp.duration;
    result.frameRate = comp.frameRate;
    result.numLayers = comp.numLayers;
    result.message = 'Opened comp "' + comp.name + '" (id ' + comp.id + ', ' + comp.width + 'x' + comp.height + ', ' + comp.numLayers + ' layers, ' + comp.duration.toFixed(2) + 's @ ' + comp.frameRate + 'fps). It is now the active comp for all tools. Use get_detailed_comp_summary to inspect it.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'openComp error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Animated subtitles: comp-audio render (for Whisper) + cue keyframing
// ============================================================================

/**
 * Render the active comp's audio to a temp AIFF file via the render queue.
 * Uses the stock audio-only "AIFF 48kHz" output-module template (matched by
 * substring so localized/renamed variants still work). Other queued items are
 * temporarily un-queued so rq.render() renders only ours; the RQ item is
 * removed afterwards, leaving the project unchanged (read-only semantics).
 * opts: { startTime, endTime } (seconds, optional span inside the comp).
 * Returns { ok, audioPath, durationSec, startTime }.
 */
function extensionsLlmChat_renderCompAudio (opts) {
  var result = { ok: false, message: '', audioPath: '', durationSec: 0, startTime: 0 };
  var rqi = null;
  var restore = [];
  var rq = null;
  var dispStartRestore = null;
  var dispStartComp = null;
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    var o = opts || {};
    var start = (typeof o.startTime === 'number' && o.startTime >= 0) ? Math.min(o.startTime, comp.duration) : 0;
    var end = (typeof o.endTime === 'number' && o.endTime > start) ? Math.min(o.endTime, comp.duration) : comp.duration;
    if (end - start < 0.1) { result.message = 'Requested audio span is too short (' + (end - start).toFixed(3) + 's).'; return resultToJson(result); }

    // A non-zero displayStartTime (source-timecode comps) makes AE pop a
    // modal "frames outside of range" warning on our 0-based timeSpanStart.
    // beginSuppressDialogs does NOT catch it (verified live: scripting froze
    // until the user clicked OK). Zero it for the render, restore after —
    // it is display-only and does not shift scripting/keyframe times.
    try {
      if (comp.displayStartTime !== 0) {
        dispStartRestore = comp.displayStartTime;
        dispStartComp = comp;
        comp.displayStartTime = 0;
      }
    } catch (eDs) {}

    rq = app.project.renderQueue;
    rqi = rq.items.add(comp);
    var om = rqi.outputModule(1);
    var tpls = om.templates;
    var tplName = null;
    for (var t = 0; t < tpls.length; t++) {
      var nm = String(tpls[t]);
      if (nm.indexOf('_HIDDEN') === 0) continue;
      if (nm.toUpperCase().indexOf('AIFF') !== -1) { tplName = nm; break; }
    }
    if (!tplName) {
      try { rqi.remove(); } catch (eRm0) {}
      result.message = 'No AIFF audio output-module template found (render queue templates: ' + tpls.join(', ') + ').';
      return resultToJson(result);
    }
    om.applyTemplate(tplName);
    try {
      // NOTE: the setter takes 0-based comp time (verified live: 0 renders the
      // real audio; adding comp.displayStartTime rendered silence and Whisper
      // hallucinated). On comps with a non-zero displayStartTime AE still pops
      // a spurious "frames outside of range" warning against the DISPLAY range
      // — a modal that freezes scripting — hence the dialog suppression below.
      rqi.timeSpanStart = start;
      rqi.timeSpanDuration = end - start;
    } catch (eSpan) { /* full-comp fallback: span setters missing on old AE */ start = 0; end = comp.duration; }
    var outFile = new File(Folder.temp.fsName + '/ae-agent-audio-' + (new Date().getTime()) + '.aif');
    om.file = outFile;

    // Un-queue other items so rq.render() renders only ours.
    for (var i = 1; i <= rq.numItems; i++) {
      var it = rq.item(i);
      if (it === rqi) continue;
      try {
        if (it.status === RQItemStatus.QUEUED) { it.render = false; restore.push(i); }
      } catch (eQ) {}
    }
    // Belt and braces: suppress any render warning dialog — a modal here
    // freezes the synchronous render call past the panel-side timeout.
    var suppressed = false;
    try { app.beginSuppressDialogs(); suppressed = true; } catch (eSup) {}
    try {
      rq.render(); // synchronous
    } finally {
      if (suppressed) { try { app.endSuppressDialogs(false); } catch (eSup2) {} }
    }
    for (var r = 0; r < restore.length; r++) {
      try { rq.item(restore[r]).render = true; } catch (eR) {}
    }
    restore = [];
    try { rqi.remove(); } catch (eRm) {}
    rqi = null;
    if (dispStartRestore !== null) {
      try { dispStartComp.displayStartTime = dispStartRestore; } catch (eDs2) {}
      dispStartRestore = null;
    }
    if (!outFile.exists) {
      result.message = 'Audio render finished but produced no file (template "' + tplName + '").';
      return resultToJson(result);
    }
    result.ok = true;
    result.audioPath = outFile.fsName;
    result.durationSec = end - start;
    result.startTime = start;
    result.message = 'Rendered comp audio span ' + start.toFixed(2) + '-' + end.toFixed(2) + 's to AIFF (' + tplName + ').';
    return resultToJson(result);
  } catch (e) {
    // Best-effort restore of the queue on failure.
    try { for (var r2 = 0; r2 < restore.length; r2++) { rq.item(restore[r2]).render = true; } } catch (x1) {}
    try { if (rqi) rqi.remove(); } catch (x2) {}
    try { if (dispStartRestore !== null && dispStartComp) dispStartComp.displayStartTime = dispStartRestore; } catch (x3) {}
    result.message = 'renderCompAudio error: ' + e.toString();
    return resultToJson(result);
  }
}

/** Escape a string for embedding inside a double-quoted expression literal. */
function _exprQuote (s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Create an animated subtitle rig from pre-built cues.
 * cues: [{ startSec, endSec, text }] — text may contain \n (line breaks).
 * opts: {
 *   layerName ('Subtitles'), font (PostScript name), fontSize (px, default
 *   4.5% of comp height), fillColor ([r,g,b] 0..1), position
 *   ('bottom'|'center'|'top'), box (default true, false for karaoke),
 *   boxColor ([r,g,b]), boxOpacity (0..100, default 60),
 *   animation ('word_reveal'|'karaoke'|'none'),
 *   karaokeTracks ([{t,index,prefix,word}] from PURE_SUBTITLES.buildKaraokeTracks
 *   — required for animation 'karaoke'), highlightColor ([r,g,b] plate),
 *   highlightTextColor ([r,g,b] current word)
 * }
 * Rig: one text layer with Source Text HOLD keyframes (one per cue + empty-
 * text keys in gaps), a position expression that pins the text block edge so
 * 1- and 2-line cues sit consistently, an optional auto-sizing background box
 * (sourceRectAtTime expressions), and an optional word-by-word reveal
 * (text animator Opacity 0 + expression selector driven by cue keyframe times)
 * or a CapCut-style karaoke highlight (plate under the spoken word).
 */
/**
 * Installed fonts for the panel's font pickers.
 * app.fonts.allFonts (AE 24.0+) is an array of FAMILIES, each an array of
 * FontObjects — live-verified on AE 26.3 (148 families). Returned compactly
 * ({f: family, s: [[style, postScriptName], …]}) because the whole list goes
 * through evalScript as one JSON string.
 */
function extensionsLlmChat_listFonts () {
  var result = { ok: false, message: '', families: [] };
  try {
    if (typeof app.fonts === 'undefined' || !app.fonts.allFonts) {
      result.message = 'This After Effects build has no app.fonts API (needs AE 24.0+).';
      return resultToJson(result);
    }
    var all = app.fonts.allFonts;
    for (var i = 0; i < all.length; i++) {
      var fam = all[i];
      if (!fam || !fam.length) continue;
      var styles = [];
      for (var j = 0; j < fam.length; j++) {
        styles.push([String(fam[j].styleName), String(fam[j].postScriptName)]);
      }
      result.families.push({ f: String(fam[0].familyName), s: styles });
    }
    result.ok = true;
    result.message = 'Found ' + result.families.length + ' font families.';
    return resultToJson(result);
  } catch (e) {
    result.message = 'listFonts error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Pick a subtitle base name whose whole family ("X", "X Plate", "X Box",
 * "X Measure *") is still free in the comp. AE allows duplicate layer names
 * but `thisComp.layer("name")` returns the TOPMOST match — so a second rig
 * built over an existing one would silently drive its plate from the older
 * rig's measure layers. Iterating on colors/style is a normal workflow, so
 * the second rig becomes "Subtitles 2" instead.
 */
function _subtitlesFreeBaseName (comp, base) {
  var used = {};
  var i;
  for (i = 1; i <= comp.numLayers; i++) used[comp.layer(i).name] = true;
  function free (name) {
    return !used[name] && !used[name + ' Plate'] && !used[name + ' Box'] &&
      !used[name + ' Measure Prefix'] && !used[name + ' Measure Word'];
  }
  if (free(base)) return base;
  for (i = 2; i < 200; i++) {
    if (free(base + ' ' + i)) return base + ' ' + i;
  }
  return base + ' ' + (new Date()).getTime();
}

function extensionsLlmChat_createSubtitles (cues, opts) {
  var result = { ok: false, message: '', layerId: null, layerName: '', boxLayerId: null, plateLayerId: null, cueCount: 0, fontWarning: '' };
  var undoOpen = false;
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    if (!cues || !cues.length) { result.message = 'No cues provided.'; return resultToJson(result); }
    var o = opts || {};
    var layerName = (typeof o.layerName === 'string' && o.layerName !== '') ? o.layerName : 'Subtitles';
    // The name is embedded in expressions — keep it quote-safe and unique.
    layerName = layerName.replace(/["\\]/g, '');
    layerName = _subtitlesFreeBaseName(comp, layerName);

    // YouTube safe zones (2026). Vertical (Shorts, 9:16): the bottom ~25-35%
    // is covered by title/channel/music UI (grows to ~400px of 1920 with the
    // description expanded) and a right-side action column eats ~120-190px —
    // so subtitles sit at 70% height, capped to 80% width. Landscape (16:9):
    // the player control bar overlays the bottom ~12% — text block bottom at
    // 88%, width within the 90% title-safe area.
    var isVertical = comp.height > comp.width * 1.25;
    var safeWidthFrac = isVertical ? 0.80 : 0.90;
    var topEdgeY = Math.round(comp.height * (isVertical ? 0.15 : 0.08));
    var bottomEdgeY = Math.round(comp.height * (isVertical ? 0.70 : 0.88));

    _beginToolUndo('Agent: Create subtitles');
    undoOpen = true;

    var textLayer = comp.layers.addText('');
    textLayer.name = layerName;
    var textProp = textLayer.property('ADBE Text Properties').property('ADBE Text Document');

    // Base style on the live TextDocument (same pattern as setTextDocument /
    // createLayer Fix A: mutate value, then setValue).
    var doc = textProp.value;
    var requestedFont = (typeof o.font === 'string' && o.font !== '') ? o.font : null;
    if (requestedFont) { try { doc.font = requestedFont; } catch (eF) {} }
    var explicitFontSize = (typeof o.fontSize === 'number' && o.fontSize > 0);
    doc.fontSize = explicitFontSize ? o.fontSize : Math.round(comp.height * 0.045);
    doc.fillColor = (o.fillColor instanceof Array && o.fillColor.length === 3) ? o.fillColor : [1, 1, 1];
    try { doc.applyStroke = false; } catch (eSt) {}
    // The character panel's All Caps state is inherited by addText — reset it
    // (live bug: subtitles rendered ALL-CAPS from the user's panel state).
    try { doc.fontCapsOption = FontCapsOption.FONT_NORMAL_CAPS; } catch (eCaps) {}
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    textProp.setValue(doc);

    // Auto-fit the DEFAULT font size: glyph width varies wildly per font
    // (live bug: 19-char Cyrillic line = 2541px at 184px font in a 2160px
    // comp). Measure the widest cue line and shrink to fit 92% comp width.
    // An explicitly requested fontSize is respected as-is.
    if (!explicitFontSize) {
      var widestLine = '';
      for (var wi = 0; wi < cues.length; wi++) {
        var wLines = String(cues[wi].text == null ? '' : cues[wi].text).split('\n');
        for (var wj = 0; wj < wLines.length; wj++) {
          if (wLines[wj].length > widestLine.length) widestLine = wLines[wj];
        }
      }
      if (widestLine !== '') {
        var dMeasure = textProp.value;
        dMeasure.text = widestLine;
        textProp.setValue(dMeasure);
        var mRect = textLayer.sourceRectAtTime(0, false);
        var maxW = comp.width * safeWidthFrac;
        if (mRect.width > maxW && mRect.width > 0) {
          var dShrink = textProp.value;
          dShrink.fontSize = Math.max(10, Math.floor(dShrink.fontSize * maxW / mRect.width));
          textProp.setValue(dShrink);
        }
        var dClear = textProp.value;
        dClear.text = '';
        textProp.setValue(dClear);
      }
    }
    if (requestedFont) {
      try {
        if (textProp.value.font !== requestedFont) {
          result.fontWarning = 'Requested font "' + requestedFont + '" not found; AE substituted "' + textProp.value.font + '". Use a PostScript name (e.g. "ArialMT", "Arial-BoldMT").';
        }
      } catch (eFw) {}
    }

    // One HOLD keyframe per cue + empty-text keys in gaps. Mutating the
    // current value and setValueAtTime preserves styling; Source Text keys
    // are hold-interpolated by AE automatically.
    var GAP_EPS = 0.08;
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var d = textProp.value;
      d.text = String(cue.text == null ? '' : cue.text);
      textProp.setValueAtTime(cue.startSec, d);
      var nextStart = (i + 1 < cues.length) ? cues[i + 1].startSec : null;
      if (nextStart === null || nextStart - cue.endSec > GAP_EPS) {
        var dEmpty = textProp.value;
        dEmpty.text = '';
        textProp.setValueAtTime(cue.endSec, dEmpty);
      }
    }

    // Pin the text block edge via a position expression so 1- and 2-line
    // cues sit consistently (text position alone moves the BASELINE).
    var posName = (typeof o.position === 'string') ? o.position : 'bottom';
    var posExpr;
    var cw = 'thisComp.width/2';
    if (posName === 'top') {
      posExpr = 'var r = sourceRectAtTime(time, false);\n[' + cw + ', ' + topEdgeY + ' - r.top];';
    } else if (posName === 'center') {
      posExpr = 'var r = sourceRectAtTime(time, false);\n[' + cw + ', ' + Math.round(comp.height * 0.5) + ' - (r.top + r.height/2)];';
    } else {
      posExpr = 'var r = sourceRectAtTime(time, false);\n[' + cw + ', ' + bottomEdgeY + ' - (r.top + r.height)];';
    }
    var posProp = textLayer.property('ADBE Transform Group').property('ADBE Position');
    posProp.expression = posExpr;

    // Optional word-by-word reveal: animator Opacity 0 + expression selector.
    // Words inside the current cue fade in sequentially across the first 70%
    // of the cue duration; empty-text keys (gaps) show nothing anyway.
    var animation = (typeof o.animation === 'string') ? o.animation : 'word_reveal';
    if (animation === 'word_reveal') {
      var animators = textLayer.property('ADBE Text Properties').property('ADBE Text Animators');
      var animator = animators.addProperty('ADBE Text Animator');
      animator.name = 'Word Reveal';
      animator.property('ADBE Text Animator Properties').addProperty('ADBE Text Opacity');
      // addProperty may invalidate refs — re-resolve by name (learned bug #5).
      animator = animators.property('Word Reveal');
      animator.property('ADBE Text Animator Properties').property('ADBE Text Opacity').setValue(0);
      var selector = animator.property('ADBE Text Selectors').addProperty('ADBE Text Expressible Selector');
      selector = animators.property('Word Reveal').property('ADBE Text Selectors').property(1);
      try { selector.property('ADBE Text Range Units'); } catch (eU) {}
      // Based On = Words. Live-verified matchName on AE 2025 is
      // 'ADBE Text Range Type2'; keep a display-name fallback just in case.
      try { selector.property('ADBE Text Range Type2').setValue(3); } catch (eB) {
        try { selector.property('Based On').setValue(3); } catch (eB2) {}
      }
      var amountExpr =
        'var st = thisLayer.text.sourceText;\n' +
        'var amt = 0;\n' +
        'if (st.numKeys > 0) {\n' +
        '  var k = st.nearestKey(time).index;\n' +
        '  if (st.key(k).time > time) k--;\n' +
        '  if (k < 1) { amt = 100; } else {\n' +
        '    var cs = st.key(k).time;\n' +
        '    var ce = (k < st.numKeys) ? st.key(k + 1).time : thisLayer.outPoint;\n' +
        '    var reveal = Math.max(0.001, (ce - cs) * 0.7);\n' +
        '    var frac = (time - cs) / reveal;\n' +
        '    amt = ((textIndex - 0.99) / textTotal) <= frac ? 0 : 100;\n' +
        '  }\n' +
        '}\n' +
        'amt';
      // Live-verified matchName: 'ADBE Text Expressible Amount'. The
      // display-name fallback ('Amount') would break on localized AE.
      try {
        selector.property('ADBE Text Expressible Amount').expression = amountExpr;
      } catch (eA) {
        selector.property('Amount').expression = amountExpr;
      }
    }

    // CapCut-style karaoke: a colored plate travels under the word being
    // spoken and that word switches to the highlight color.
    // AE's sourceRectAtTime measures the WHOLE text block, so the per-word
    // rect is reconstructed from two hidden measure text layers that carry the
    // same style: one keyframed with "words up to and including the current"
    // (its width = distance from the line's left edge to the word's right
    // edge) and one with the current word alone (its width = plate width).
    // Cue selection is a single "Word Index" slider with hold keyframes, so
    // the whole rig is inspectable and hand-editable in the timeline.
    var plateLayer = null;
    var measurePrefix = null;
    var measureWord = null;
    if (animation === 'karaoke') {
      var tracks = (o.karaokeTracks instanceof Array) ? o.karaokeTracks : [];
      if (!tracks.length) {
        if (undoOpen) { _endToolUndo(); undoOpen = false; }
        result.message = 'createSubtitles: animation "karaoke" requires karaokeTracks (word timings).';
        return resultToJson(result);
      }
      var finalDoc = textProp.value;
      var fsz = finalDoc.fontSize || 40;

      // Word Index slider (hold keys): 1-based word ordinal in the current
      // cue, 0 while nothing is spoken.
      var idxFx = textLayer.property('ADBE Effect Parade').addProperty('ADBE Slider Control');
      idxFx.name = 'Word Index';
      idxFx = textLayer.property('ADBE Effect Parade').property('Word Index');
      var idxProp = idxFx.property('ADBE Slider Control-0001');
      var ti;
      for (ti = 0; ti < tracks.length; ti++) idxProp.setValueAtTime(tracks[ti].t, tracks[ti].index);
      for (ti = 1; ti <= idxProp.numKeys; ti++) {
        try { idxProp.setInterpolationTypeAtKey(ti, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (eHold) {}
      }

      // Highlight color animator on the spoken word.
      var kAnimators = textLayer.property('ADBE Text Properties').property('ADBE Text Animators');
      var kAnim = kAnimators.addProperty('ADBE Text Animator');
      kAnim.name = 'Word Highlight';
      kAnim.property('ADBE Text Animator Properties').addProperty('ADBE Text Fill Color');
      kAnim = kAnimators.property('Word Highlight');
      var hiText = (o.highlightTextColor instanceof Array && o.highlightTextColor.length === 3) ? o.highlightTextColor : [0.06, 0.06, 0.06];
      var hiProp = kAnim.property('ADBE Text Animator Properties').property('ADBE Text Fill Color');
      try { hiProp.setValue([hiText[0], hiText[1], hiText[2], 1]); } catch (eC3) { hiProp.setValue([hiText[0], hiText[1], hiText[2]]); }
      var kSel = kAnim.property('ADBE Text Selectors').addProperty('ADBE Text Expressible Selector');
      kSel = kAnimators.property('Word Highlight').property('ADBE Text Selectors').property(1);
      try { kSel.property('ADBE Text Range Type2').setValue(3); } catch (eKb) {
        try { kSel.property('Based On').setValue(3); } catch (eKb2) {}
      }
      // effect("Word Index")(1) — index form survives a localized AE UI.
      var kAmount = 'textIndex == thisLayer.effect("Word Index")(1) ? 100 : 0';
      try { kSel.property('ADBE Text Expressible Amount').expression = kAmount; } catch (eKa) {
        kSel.property('Amount').expression = kAmount;
      }

      // Hidden measure layers — same TextDocument, so glyph widths match.
      var mNames = [layerName + ' Measure Prefix', layerName + ' Measure Word'];
      var mLayers = [];
      // Reference band (ascender…descender) measured ONCE from a constant
      // string. Everything vertical is derived from it instead of from each
      // cue's own ink rect: a cue without descenders would otherwise sit
      // higher and its plate would look off-centre under the letters.
      // The string mixes Cyrillic and Latin ascenders/descenders so the band
      // is the font's real ascender…descender range in both scripts; a word
      // without ascenders therefore sits low in the plate ON PURPOSE, exactly
      // as it does in CapCut — the plate must not breathe with each word.
      var refTop = 0;
      var refHeight = 0;
      for (var mi = 0; mi < 2; mi++) {
        var mLayer = comp.layers.addText('');
        mLayer.name = mNames[mi];
        var mProp = mLayer.property('ADBE Text Properties').property('ADBE Text Document');
        mProp.setValue(finalDoc);
        if (mi === 0) {
          var refDoc = mProp.value;
          refDoc.text = '\u0431\u0434\u0440\u0443HXAyGg';
          mProp.setValue(refDoc);
          var refRect = mLayer.sourceRectAtTime(0, false);
          refTop = refRect.top;
          refHeight = refRect.height;
        }
        for (ti = 0; ti < tracks.length; ti++) {
          var md = mProp.value;
          md.text = String((mi === 0 ? tracks[ti].prefix : tracks[ti].word) || '');
          mProp.setValueAtTime(tracks[ti].t, md);
        }
        mLayer.enabled = false;
        mLayers.push(mLayer);
      }
      measurePrefix = mLayers[0];
      measureWord = mLayers[1];

      // Karaoke cues are single-line, so the text can be pinned by its
      // BASELINE (a plain value — position of point text IS the baseline
      // origin). The rect-based expression used elsewhere makes the line jump
      // vertically whenever a cue happens to have no descenders.
      if (refHeight > 0) {
        var baselineY;
        if (posName === 'top') {
          baselineY = topEdgeY - refTop;
        } else if (posName === 'center') {
          baselineY = Math.round(comp.height * 0.5) - (refTop + refHeight / 2);
        } else {
          baselineY = bottomEdgeY - (refTop + refHeight);
        }
        posProp.expression = '';
        posProp.setValue([comp.width / 2, baselineY]);
      }

      plateLayer = comp.layers.addShape();
      plateLayer.name = layerName + ' Plate';
      var pGrp = plateLayer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
      pGrp.name = 'Plate';
      pGrp.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Rect');
      pGrp.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');
      pGrp = plateLayer.property('ADBE Root Vectors Group').property('Plate');
      var hiPlate = (o.highlightColor instanceof Array && o.highlightColor.length === 3) ? o.highlightColor : [1, 0.84, 0];
      pGrp.property('ADBE Vectors Group').property('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue([hiPlate[0], hiPlate[1], hiPlate[2], 1]);
      var kPadX = Math.round(fsz * 0.25);
      var kPadY = Math.round(fsz * 0.12);
      // Constant plate geometry from the reference band (falls back to the
      // live rect only if the measurement failed).
      var kPlateH = (refHeight > 0) ? Math.round(refHeight + kPadY * 2) : 0;
      var kPlateY = (refHeight > 0) ? (refTop + refHeight / 2) : 0;
      var pRect = pGrp.property('ADBE Vectors Group').property('ADBE Vector Shape - Rect');
      // Square corners (user preference 2026-08-04) — set explicitly so a
      // non-zero shape default can never leak in.
      try { pRect.property('ADBE Vector Rect Roundness').setValue(0); } catch (eR) {}
      var qText = _exprQuote(layerName);
      var qPrefix = _exprQuote(mNames[0]);
      var qWord = _exprQuote(mNames[1]);
      // Only the width follows the spoken word; the height is the constant
      // reference band. Zero size while no word is spoken (measure text empty).
      var kHeightExpr = kPlateH > 0 ? String(kPlateH) : ('rt.height + ' + (kPadY * 2));
      var kYExpr = kPlateH > 0 ? String(kPlateY) : 'rt.top + rt.height / 2';
      pRect.property('ADBE Vector Rect Size').expression =
        'var e = [0, 0];\n' +
        'try {\n' +
        '  var rt = thisComp.layer("' + qText + '").sourceRectAtTime(time, false);\n' +
        '  var rw = thisComp.layer("' + qWord + '").sourceRectAtTime(time, false);\n' +
        '  if (rw.width > 0 && rt.width > 0) e = [rw.width + ' + (kPadX * 2) + ', ' + kHeightExpr + '];\n' +
        '} catch (err) {}\n' +
        'e';
      plateLayer.property('ADBE Transform Group').property('ADBE Position').expression =
        'var e = [-10000, -10000];\n' +
        'try {\n' +
        '  var T = thisComp.layer("' + qText + '");\n' +
        '  var rt = T.sourceRectAtTime(time, false);\n' +
        '  var rp = thisComp.layer("' + qPrefix + '").sourceRectAtTime(time, false);\n' +
        '  var rw = thisComp.layer("' + qWord + '").sourceRectAtTime(time, false);\n' +
        '  if (rw.width > 0 && rt.width > 0) e = T.toComp([rt.left + rp.width - rw.width / 2, ' + kYExpr + ']);\n' +
        '} catch (err) {}\n' +
        'e';
    }

    // Optional auto-sizing background box behind the text. Karaoke carries its
    // own plate, so a full-width box is opt-IN there.
    var boxLayer = null;
    var wantBox = (typeof o.box === 'boolean') ? o.box : (animation !== 'karaoke');
    if (wantBox) {
      boxLayer = comp.layers.addShape();
      boxLayer.name = layerName + ' Box';
      var rootVec = boxLayer.property('ADBE Root Vectors Group');
      var grp = rootVec.addProperty('ADBE Vector Group');
      grp.name = 'Box';
      grp.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Rect');
      grp.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');
      // Re-resolve after addProperty calls (sibling refs get invalidated).
      grp = boxLayer.property('ADBE Root Vectors Group').property('Box');
      var boxColor = (o.boxColor instanceof Array && o.boxColor.length === 3) ? o.boxColor : [0, 0, 0];
      grp.property('ADBE Vectors Group').property('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue([boxColor[0], boxColor[1], boxColor[2], 1]);
      // Read the FINAL size — `doc` predates the auto-fit shrink above, so
      // using it would pad a small text block as if it were huge.
      var boxFsz = textProp.value.fontSize || 40;
      var padX = Math.round(boxFsz * 0.6);
      var padY = Math.round(boxFsz * 0.4);
      var qName = _exprQuote(layerName);
      grp.property('ADBE Vectors Group').property('ADBE Vector Shape - Rect').property('ADBE Vector Rect Size').expression =
        'var e = [0, 0];\n' +
        'try {\n' +
        '  var r = thisComp.layer("' + qName + '").sourceRectAtTime(time, false);\n' +
        '  if (r.width > 0) e = [r.width + ' + (padX * 2) + ', r.height + ' + (padY * 2) + '];\n' +
        '} catch (err) {}\n' +
        'e';
      boxLayer.property('ADBE Transform Group').property('ADBE Position').expression =
        'var e = [-10000, -10000];\n' +
        'try {\n' +
        '  var L = thisComp.layer("' + qName + '");\n' +
        '  var r = L.sourceRectAtTime(time, false);\n' +
        '  if (r.width > 0) e = L.toComp([r.left + r.width / 2, r.top + r.height / 2]);\n' +
        '} catch (err) {}\n' +
        'e';
      var boxOpacity = (typeof o.boxOpacity === 'number') ? Math.max(0, Math.min(100, o.boxOpacity)) : 60;
      boxLayer.property('ADBE Transform Group').property('ADBE Opacity').setValue(boxOpacity);
    }

    // Stack: text on top, karaoke plate under it, background box under that,
    // hidden measure layers at the very bottom.
    if (plateLayer) plateLayer.moveAfter(textLayer);
    if (boxLayer) boxLayer.moveAfter(plateLayer ? plateLayer : textLayer);
    if (measurePrefix) measurePrefix.moveToEnd();
    if (measureWord) measureWord.moveToEnd();

    _endToolUndo();
    undoOpen = false;
    result.ok = true;
    result.layerId = textLayer.id;
    result.layerName = textLayer.name;
    result.boxLayerId = boxLayer ? boxLayer.id : null;
    result.cueCount = cues.length;
    result.plateLayerId = plateLayer ? plateLayer.id : null;
    result.message = 'Created subtitle rig "' + textLayer.name + '": ' + cues.length + ' cue(s) as Source Text hold keyframes' +
      (animation === 'word_reveal' ? ', word-by-word reveal animator' : '') +
      (animation === 'karaoke' ? ', CapCut-style karaoke highlight (plate "' + plateLayer.name + '" + 2 hidden measure layers)' : '') +
      (boxLayer ? ', auto-sizing background box ("' + boxLayer.name + '")' : '') +
      '. Position: ' + posName + '.' + (result.fontWarning ? ' WARNING: ' + result.fontWarning : '');
    return resultToJson(result);
  } catch (e) {
    if (undoOpen) { try { _endToolUndo(); } catch (x) {} }
    result.message = 'createSubtitles error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Read an existing subtitle rig back into cue data. The rig is fully
 * self-describing: cue text + times live in the Source Text hold keys, word
 * timings in the "Word Index" slider keys (word strings are the cue text
 * split on spaces — the slider value is the 1-based ordinal). No sidecar
 * storage, so this works even after a project save/reload or manual tweaks.
 * layerId null → auto-detect: exactly one non-measure text layer with
 * Source Text keyframes in the active comp, otherwise an error listing
 * candidates. Read-only.
 */
function extensionsLlmChat_readSubtitleRig (layerId) {
  var result = { ok: false, message: '', layerId: null, layerName: '', animation: 'none', cueCount: 0, cues: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    var layer = null;
    var i;
    if (layerId) {
      for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).id === layerId) { layer = comp.layer(i); break; }
      }
      if (!layer) { result.message = 'No layer with id ' + layerId + ' in comp "' + comp.name + '".'; return resultToJson(result); }
    } else {
      var candidates = [];
      for (i = 1; i <= comp.numLayers; i++) {
        var cand = comp.layer(i);
        if (!(cand instanceof TextLayer)) continue;
        if (/ Measure (Prefix|Word)$/.test(cand.name)) continue;
        try {
          var tpc = cand.property('ADBE Text Properties').property('ADBE Text Document');
          if (tpc && tpc.numKeys > 1) candidates.push(cand);
        } catch (eCand) {}
      }
      if (candidates.length === 0) {
        result.message = 'No subtitle rig found in "' + comp.name + '": no text layer with Source Text keyframes. Create one with create_subtitles first, or pass layer_id.';
        return resultToJson(result);
      }
      if (candidates.length > 1) {
        var names = [];
        for (i = 0; i < candidates.length; i++) names.push('"' + candidates[i].name + '" (layer_id ' + candidates[i].id + ')');
        result.message = 'Multiple subtitle rigs in "' + comp.name + '": ' + names.join(', ') + '. Call again with one of these layer_id values.';
        return resultToJson(result);
      }
      layer = candidates[0];
    }
    if (!(layer instanceof TextLayer)) {
      result.message = 'Layer "' + layer.name + '" is not a text layer — a subtitle rig is the TEXT layer created by create_subtitles.';
      return resultToJson(result);
    }
    var tp = layer.property('ADBE Text Properties').property('ADBE Text Document');
    if (!tp || tp.numKeys < 1) {
      result.message = 'Layer "' + layer.name + '" has no Source Text keyframes — not a subtitle rig created by create_subtitles.';
      return resultToJson(result);
    }
    var cues = [];
    var k;
    for (k = 1; k <= tp.numKeys; k++) {
      var txt = '';
      try { txt = String(tp.keyValue(k).text || ''); } catch (eTxt) { txt = ''; }
      txt = txt.replace(/\r\n?/g, '\n'); // AE stores line breaks as \r — normalize for the panel
      if (txt.replace(/\s+/g, '') === '') continue;
      var endT = (k < tp.numKeys) ? tp.keyTime(k + 1) : layer.outPoint;
      cues.push({
        startSec: Math.round(tp.keyTime(k) * 1000) / 1000,
        endSec: Math.round(endT * 1000) / 1000,
        text: txt
      });
    }
    if (!cues.length) {
      result.message = 'Layer "' + layer.name + '" has Source Text keys but no non-empty cue text.';
      return resultToJson(result);
    }
    var idxProp = null;
    try {
      var idxFx = layer.property('ADBE Effect Parade').property('Word Index');
      if (idxFx) idxProp = idxFx.property('ADBE Slider Control-0001');
    } catch (eIdx) {}
    var anim = 'none';
    if (idxProp && idxProp.numKeys > 0) {
      anim = 'karaoke';
    } else {
      try {
        if (layer.property('ADBE Text Properties').property('ADBE Text Animators').property('Word Reveal')) anim = 'word_reveal';
      } catch (eAnim) {}
    }
    if (anim === 'karaoke') {
      var events = [];
      for (k = 1; k <= idxProp.numKeys; k++) {
        events.push({ t: idxProp.keyTime(k), idx: Math.round(idxProp.keyValue(k)) });
      }
      for (i = 0; i < cues.length; i++) {
        var cue = cues[i];
        var parts = cue.text.replace(/[\r\n]+/g, ' ').split(' ');
        var wlist = [];
        var wi;
        for (wi = 0; wi < parts.length; wi++) { if (parts[wi] !== '') wlist.push(parts[wi]); }
        var words = [];
        for (var ei = 0; ei < events.length; ei++) {
          var ev = events[ei];
          if (ev.idx < 1) continue;
          if (ev.t < cue.startSec - 0.002 || ev.t >= cue.endSec - 0.0005) continue;
          var wEnd = (ei + 1 < events.length) ? Math.min(events[ei + 1].t, cue.endSec) : cue.endSec;
          words.push({
            w: (ev.idx <= wlist.length) ? wlist[ev.idx - 1] : '',
            s: Math.round(ev.t * 1000) / 1000,
            e: Math.round(wEnd * 1000) / 1000
          });
        }
        cue.words = words;
      }
    }
    result.ok = true;
    result.layerId = layer.id;
    result.layerName = layer.name;
    result.animation = anim;
    result.cueCount = cues.length;
    result.cues = cues;
    result.message = 'Read subtitle rig "' + layer.name + '": ' + cues.length + ' cue(s), animation "' + anim + '".';
    return resultToJson(result);
  } catch (e) {
    result.message = 'readSubtitleRig error: ' + e.toString();
    return resultToJson(result);
  }
}

/**
 * Rewrite the keyframes of an existing subtitle rig IN PLACE from updated
 * cues: Source Text keys on the text layer and, for karaoke, the Word Index
 * slider keys + both hidden measure layers' Source Text keys. Styling,
 * position, animators, plate/box layers and their expressions are untouched
 * (they reference layer NAMES, which do not change) — so an edit never
 * breaks the animation. One undo group.
 */
function extensionsLlmChat_rewriteSubtitleRig (layerId, cues, opts) {
  var result = { ok: false, message: '', layerId: null, cueCount: 0 };
  var undoOpen = false;
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    if (!cues || !cues.length) { result.message = 'No cues provided.'; return resultToJson(result); }
    var layer = null;
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).id === layerId) { layer = comp.layer(i); break; }
    }
    if (!layer) { result.message = 'No layer with id ' + layerId + ' in comp "' + comp.name + '".'; return resultToJson(result); }
    var lockedMsg = _lockedRefusal(layer);
    if (lockedMsg) { result.message = lockedMsg; return resultToJson(result); }
    if (!(layer instanceof TextLayer)) { result.message = 'Layer "' + layer.name + '" is not a text layer.'; return resultToJson(result); }
    var tp = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var o = opts || {};
    var tracks = (o.karaokeTracks instanceof Array) ? o.karaokeTracks : null;
    var idxProp = null;
    var mPrefixProp = null;
    var mWordProp = null;
    if (tracks) {
      try {
        var idxFx = layer.property('ADBE Effect Parade').property('Word Index');
        if (idxFx) idxProp = idxFx.property('ADBE Slider Control-0001');
      } catch (eIdx) {}
      var mPrefixName = layer.name + ' Measure Prefix';
      var mWordName = layer.name + ' Measure Word';
      for (i = 1; i <= comp.numLayers; i++) {
        var ml = comp.layer(i);
        if (ml.name === mPrefixName && ml instanceof TextLayer) {
          mPrefixProp = ml.property('ADBE Text Properties').property('ADBE Text Document');
        } else if (ml.name === mWordName && ml instanceof TextLayer) {
          mWordProp = ml.property('ADBE Text Properties').property('ADBE Text Document');
        }
      }
      if (!idxProp || !mPrefixProp || !mWordProp) {
        var missing = [];
        if (!idxProp) missing.push('"Word Index" slider effect');
        if (!mPrefixProp) missing.push('layer "' + mPrefixName + '"');
        if (!mWordProp) missing.push('layer "' + mWordName + '"');
        result.message = 'Karaoke rig incomplete — missing ' + missing.join(', ') +
          '. The rig was probably renamed or partially deleted; rebuild it with create_subtitles instead.';
        return resultToJson(result);
      }
    }

    _beginToolUndo('Agent: Update subtitles');
    undoOpen = true;

    while (tp.numKeys > 0) tp.removeKey(1);
    var GAP_EPS = 0.08;
    for (i = 0; i < cues.length; i++) {
      var cue = cues[i];
      var d = tp.value;
      d.text = String(cue.text == null ? '' : cue.text);
      tp.setValueAtTime(cue.startSec, d);
      var nextStart = (i + 1 < cues.length) ? cues[i + 1].startSec : null;
      if (nextStart === null || nextStart - cue.endSec > GAP_EPS) {
        var dEmpty = tp.value;
        dEmpty.text = '';
        tp.setValueAtTime(cue.endSec, dEmpty);
      }
    }

    if (tracks) {
      var ti;
      while (idxProp.numKeys > 0) idxProp.removeKey(1);
      for (ti = 0; ti < tracks.length; ti++) idxProp.setValueAtTime(tracks[ti].t, tracks[ti].index);
      for (ti = 1; ti <= idxProp.numKeys; ti++) {
        try { idxProp.setInterpolationTypeAtKey(ti, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD); } catch (eHold) {}
      }
      var mProps = [mPrefixProp, mWordProp];
      for (var mi = 0; mi < 2; mi++) {
        var mProp = mProps[mi];
        while (mProp.numKeys > 0) mProp.removeKey(1);
        for (ti = 0; ti < tracks.length; ti++) {
          var md = mProp.value;
          md.text = String((mi === 0 ? tracks[ti].prefix : tracks[ti].word) || '');
          mProp.setValueAtTime(tracks[ti].t, md);
        }
      }
    }

    _endToolUndo();
    undoOpen = false;
    result.ok = true;
    result.layerId = layer.id;
    result.cueCount = cues.length;
    result.message = 'Rewrote subtitle rig "' + layer.name + '" in place: ' + cues.length + ' cue(s)' +
      (tracks ? ' + karaoke word tracks (' + tracks.length + ' keys on slider and both measure layers)' : '') +
      '. Styling, position and animation untouched.';
    return resultToJson(result);
  } catch (e) {
    if (undoOpen) { try { _endToolUndo(); } catch (x) {} }
    result.message = 'rewriteSubtitleRig error: ' + e.toString();
    return resultToJson(result);
  }
}

// ============================================================================
// Capability handshake — lets the client detect a stale/incomplete host script
// ============================================================================

/* ── Motion recipes (2026-09-02) ─────────────────────────────────────────
 * Deterministic, self-verifying motion primitives. The eval corpus and six
 * hunt rounds showed the same request classes assembled by hand from 5–15
 * primitive calls — and failing on the same details every time: anchor not
 * centred before a scale-in, keys before the in-point, values in comp space
 * on a parented layer, a slide from an off-screen edge that never crosses
 * the frame edge, orbits whose radius drifts. One host call per recipe fixes
 * every one of those in code; parameters stay few and human ("from the
 * left", "1 second", "with overshoot").
 *
 * Every recipe: resolves layers (locked → refuse, hidden → warn), reads the
 * layer's in-point (never comp 0), writes keys with easing in one undo
 * group, and returns what it did in comp terms the model can report.
 */

// Round to 4 decimals for key times (frame-safe).
function _r4 (v) { return Math.round(v * 10000) / 10000; }

// Ease spec → KeyframeEase[] of the right dimensionality.
function _easeArr (prop, keyIdx, speed, influence) {
  var n = _getTemporalEaseDims(prop, keyIdx);
  var arr = [];
  for (var d = 0; d < n; d++) arr.push(new KeyframeEase(speed, _clampEaseInfluence(influence)));
  return arr;
}

// Two-key move with easy-ease (bezier, influence in %) — the recipe workhorse.
// overshoot > 0 adds a third key: the value passes the target by `overshoot`
// (fraction of the travel) and settles.
function _recipeKeys (prop, t0, v0, t1, v1, influence, overshoot) {
  var travel = null;
  if (typeof v0 === 'number') travel = v1 - v0;
  else { travel = []; for (var i = 0; i < v0.length; i++) travel.push(v1[i] - v0[i]); }
  var mid = null;
  if (overshoot > 0) {
    var tm = t0 + (t1 - t0) * 0.75;
    if (typeof v0 === 'number') mid = { t: tm, v: v0 + travel * (1 + overshoot) };
    else { var mv = []; for (var j = 0; j < v0.length; j++) mv.push(v0[j] + travel[j] * (1 + overshoot)); mid = { t: tm, v: mv }; }
  }
  var k0 = prop.addKey(t0); prop.setValueAtKey(k0, v0);
  var keys = [k0];
  if (mid) { var km = prop.addKey(mid.t); prop.setValueAtKey(km, mid.v); keys.push(km); }
  var k1 = prop.addKey(t1); prop.setValueAtKey(k1, v1);
  keys.push(k1);
  for (var q = 0; q < keys.length; q++) {
    try { prop.setInterpolationTypeAtKey(keys[q], KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER); } catch (eI) {}
    try {
      var infl = (q === 0 || q === keys.length - 1) ? influence : 50;
      prop.setTemporalEaseAtKey(keys[q], _easeArr(prop, keys[q], 0, infl), _easeArr(prop, keys[q], 0, infl));
    } catch (eE) {}
  }
  return keys.length;
}

// Comp-space point → the layer's Position space (parent chain inverted, 2D).
function _compToLayerSpace (layer, pt) {
  var chain = [];
  var P = layer.parent; var hops = 0;
  while (P && hops < 16) { chain.push(P); P = P.parent; hops++; }
  var x = pt[0]; var y = pt[1];
  for (var i = chain.length - 1; i >= 0; i--) {
    var tr = chain[i].property('ADBE Transform Group');
    var pp = tr.property('ADBE Position').value;
    var pa = tr.property('ADBE Anchor Point').value;
    var ps = tr.property('ADBE Scale').value;
    var pr = tr.property('ADBE Rotate Z').value * Math.PI / 180;
    var dx = x - pp[0]; var dy = y - pp[1];
    var rx = dx * Math.cos(-pr) - dy * Math.sin(-pr);
    var ry = dx * Math.sin(-pr) + dy * Math.cos(-pr);
    x = pa[0] + rx / (ps[0] / 100 || 1);
    y = pa[1] + ry / (ps[1] / 100 || 1);
  }
  return [x, y];
}

function _recipeClearKeys (prop) {
  try { while (prop.numKeys > 0) prop.removeKey(1); } catch (e) {}
}

/**
 * apply_motion_recipe host entry.
 * @param {string} recipe  pop_in | slide_in | fade | pulse | orbit | follow | shake
 * @param {number[]} layerIndices
 * @param {number[]} layerIds
 * @param {object} opts  recipe options (see registry description)
 */
function extensionsLlmChat_applyMotionRecipe (recipe, layerIndices, layerIds, opts) {
  var result = { ok: false, message: '', recipe: recipe, applied: [], skipped: [] };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var comp = ctx.comp;
    opts = opts || {};
    var known = { pop_in: 1, slide_in: 1, fade: 1, pulse: 1, orbit: 1, follow: 1, shake: 1 };
    if (!known[recipe]) { result.message = 'apply_motion_recipe: unknown recipe "' + recipe + '". Use pop_in, slide_in, fade, pulse, orbit, follow or shake.'; return resultToJson(result); }
    var layers = _resolveLayerList(comp, layerIndices, layerIds);
    if (!layers.length && recipe === 'shake') {
      // Whole-composition shake: a null controller parents every unparented
      // 2D content layer (cameras/lights/existing rigs skipped). One layer's
      // wiggle then moves the whole frame — the 2D equivalent of a shaking
      // camera, which would be inert here.
      _beginToolUndo('Agent: Camera shake rig');
      var rig = comp.layers.addNull();
      rig.name = 'Camera Shake';
      rig.property('ADBE Transform Group').property('ADBE Position').setValue([comp.width / 2, comp.height / 2]);
      rig.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([50, 50]);
      rig.moveToBeginning();
      var attached = [];
      for (var ri = 1; ri <= comp.numLayers; ri++) {
        var cl = comp.layer(ri);
        if (cl.id === rig.id) continue;
        try {
          if (cl instanceof CameraLayer || cl instanceof LightLayer) continue;
          if (cl.parent || cl.locked) continue;
          cl.parent = rig;
          attached.push(cl.name);
        } catch (eAt) {}
      }
      var rFreq = (typeof opts.frequency === 'number' && opts.frequency > 0) ? opts.frequency : 4;
      var rAmp = (typeof opts.amount === 'number') ? opts.amount : 20;
      var rRot = (typeof opts.rotation === 'number') ? opts.rotation : 1;
      rig.property('ADBE Transform Group').property('ADBE Position').expression = 'wiggle(' + rFreq + ', ' + rAmp + ')';
      if (rRot > 0) rig.property('ADBE Transform Group').property('ADBE Rotate Z').expression = 'wiggle(' + rFreq + ', ' + rRot + ')';
      // Slight scale-up so the frame edges never show while shaking.
      var over = 100 + Math.min(10, Math.ceil(rAmp / 8));
      rig.property('ADBE Transform Group').property('ADBE Scale').setValue([over, over]);
      _endToolUndo();
      result.ok = true;
      result.applied.push({ layer: rig.name, layerId: rig.id, attached: attached, frequency: rFreq, amount: rAmp, rotation: rRot, scale: over });
      result.message = 'Shake: built a "Camera Shake" null at the comp center (Position wiggle(' + rFreq + ', ' + rAmp + ')' + (rRot ? ', Rotation wiggle(' + rFreq + ', ' + rRot + ')' : '') + ', scale ' + over + '% so edges stay hidden) and parented ' + attached.length + ' layer(s) to it: ' + attached.join(', ') + '. Cameras are inert in 2D comps — this null IS the camera shake. Adjust intensity on the null.';
      return resultToJson(result);
    }
    if (!layers.length) { result.message = 'apply_motion_recipe: no resolvable layers — pass layer_ids (or layer_indices) from the comp summary.'; return resultToJson(result); }

    var duration = (typeof opts.duration === 'number' && opts.duration > 0) ? opts.duration : 0.6;
    var delay = (typeof opts.delay === 'number' && opts.delay >= 0) ? opts.delay : 0;
    var stagger = (typeof opts.stagger === 'number' && opts.stagger >= 0) ? opts.stagger : 0;
    var influence = (typeof opts.ease === 'number') ? opts.ease : 75;
    var overshoot = (typeof opts.overshoot === 'number') ? opts.overshoot : 0;
    var replace = opts.replace !== false;
    var direction = (typeof opts.direction === 'string') ? opts.direction : 'in';
    var frameDur = comp.frameDuration > 0 ? comp.frameDuration : (1 / 30);
    var warnings = [];
    var tag = { pop_in: 'Pop in', slide_in: 'Slide in', fade: 'Fade', pulse: 'Pulse', orbit: 'Orbit', follow: 'Follow', shake: 'Shake' }[recipe];

    // Orbit and follow need a reference layer.
    var refLayer = null;
    if (recipe === 'orbit' || recipe === 'follow') {
      refLayer = _resolveLayer(comp, (typeof opts.around_layer_index === 'number') ? opts.around_layer_index : null, (typeof opts.around_layer_id === 'number') ? opts.around_layer_id : null);
      if (!refLayer) { result.message = 'apply_motion_recipe(' + recipe + '): pass around_layer_id (the layer to orbit around / to follow).'; return resultToJson(result); }
    }

    _beginToolUndo('Agent: ' + tag);
    for (var li = 0; li < layers.length; li++) {
      var layer = layers[li];
      var lockMsg = _lockedRefusal(layer);
      if (lockMsg) { result.skipped.push({ layer: layer.name, reason: 'locked' }); continue; }
      if (refLayer && layer.id === refLayer.id) { result.skipped.push({ layer: layer.name, reason: 'is the reference layer' }); continue; }
      var tr = layer.property('ADBE Transform Group');
      var posP = tr.property('ADBE Position');
      var sclP = tr.property('ADBE Scale');
      var opP = tr.property('ADBE Opacity');
      var rotP = tr.property('ADBE Rotate Z');
      var anchorP = tr.property('ADBE Anchor Point');
      var t0 = layer.inPoint + delay + stagger * li;
      var t1 = t0 + duration;
      var info = { layer: layer.name, layerId: layer.id, start: _r4(t0), end: _r4(t1) };
      var hiddenMsg = _hiddenLayerWarning(layer);
      if (hiddenMsg) { info.hidden = true; warnings.push(hiddenMsg); }

      if (recipe === 'pop_in') {
        // Centre the anchor without moving the layer (a scale-in from a corner
        // is the classic pop-in failure), then Scale 0 → current with overshoot.
        try {
          var rect = layer.sourceRectAtTime(t0, false);
          var cx = rect.left + rect.width / 2; var cy = rect.top + rect.height / 2;
          var oa = anchorP.value; var sv0 = sclP.value;
          var dx = cx - oa[0]; var dy = cy - oa[1];
          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            if (anchorP.numKeys === 0 && posP.numKeys === 0) {
              anchorP.setValue([cx, cy]);
              var pv = posP.value;
              var rad = rotP.value * Math.PI / 180;
              var ox = dx * sv0[0] / 100; var oy = dy * sv0[1] / 100;
              var rx = ox * Math.cos(rad) - oy * Math.sin(rad); var ry = ox * Math.sin(rad) + oy * Math.cos(rad);
              if (pv.length === 3) posP.setValue([pv[0] + rx, pv[1] + ry, pv[2]]); else posP.setValue([pv[0] + rx, pv[1] + ry]);
              info.anchorCentered = true;
            }
          }
        } catch (eA) {}
        var target = sclP.value;
        if (replace) _recipeClearKeys(sclP);
        var zero = (target.length === 3) ? [0, 0, target[2]] : [0, 0];
        if (direction === 'out') { _recipeKeys(sclP, t0, target, t1, zero, influence, 0); }
        else { _recipeKeys(sclP, t0, zero, t1, target, influence, (overshoot > 0) ? overshoot : 0.1); }
        info.scale = (direction === 'out') ? 'to 0' : '0 → ' + Math.round(target[0]) + '%';
        info.keys = sclP.numKeys;
      } else if (recipe === 'slide_in') {
        // Start fully OUTSIDE the frame on the chosen side (comp space, via the
        // layer's own bounds) and land on the current position.
        var side = (typeof opts.from === 'string') ? opts.from : 'left';
        var cur = posP.value;
        var world = _compSpacePosition(layer, t0);
        var w = comp.width; var h = comp.height;
        var halfW = 0; var halfH = 0;
        try { var rr = layer.sourceRectAtTime(t0, false); var sc = sclP.value; halfW = Math.abs(rr.width * sc[0] / 100) / 2 + 20; halfH = Math.abs(rr.height * sc[1] / 100) / 2 + 20; } catch (eR) { halfW = 200; halfH = 200; }
        var offWorld;
        if (side === 'right') offWorld = [w + halfW, world[1]];
        else if (side === 'top') offWorld = [world[0], -halfH];
        else if (side === 'bottom') offWorld = [world[0], h + halfH];
        else offWorld = [-halfW, world[1]];
        var offLocal = _compToLayerSpace(layer, offWorld);
        var startVal = (cur.length === 3) ? [offLocal[0], offLocal[1], cur[2]] : [offLocal[0], offLocal[1]];
        var endVal = (cur.length === 3) ? [cur[0], cur[1], cur[2]] : [cur[0], cur[1]];
        if (replace) _recipeClearKeys(posP);
        if (direction === 'out') _recipeKeys(posP, t0, endVal, t1, startVal, influence, 0);
        else _recipeKeys(posP, t0, startVal, t1, endVal, influence, overshoot);
        info.from = side; info.offscreenComp = _r2(offWorld); info.landsAt = _r2(_compSpacePosition(layer, t1 + frameDur));
        info.keys = posP.numKeys;
        info.parent = layer.parent ? layer.parent.name : '';
      } else if (recipe === 'fade') {
        var opTarget = opP.value > 0 ? opP.value : 100;
        if (replace) _recipeClearKeys(opP);
        if (direction === 'out') {
          var tEnd = layer.outPoint; var tStart = tEnd - duration;
          if (tStart < layer.inPoint) tStart = layer.inPoint;
          _recipeKeys(opP, tStart, opTarget, tEnd, 0, influence, 0);
          info.start = _r4(tStart); info.end = _r4(tEnd); info.opacity = opTarget + ' → 0 (ends at out-point)';
        } else if (direction === 'both') {
          var tE = layer.outPoint; var tS = tE - duration;
          _recipeKeys(opP, t0, 0, t1, opTarget, influence, 0);
          if (tS > t1) { var kA = opP.addKey(tS); opP.setValueAtKey(kA, opTarget); var kB = opP.addKey(tE); opP.setValueAtKey(kB, 0); }
          info.opacity = '0 → ' + opTarget + ' → 0';
        } else {
          _recipeKeys(opP, t0, 0, t1, opTarget, influence, 0);
          info.opacity = '0 → ' + opTarget;
        }
        info.keys = opP.numKeys;
      } else if (recipe === 'pulse') {
        // Expression: smooth scale breathing around the current value.
        var period = (typeof opts.period === 'number' && opts.period > 0) ? opts.period : 1;
        var amount = (typeof opts.amount === 'number') ? opts.amount : 10;
        // `value` keeps whatever dimensionality Scale has (2D or 3D); adding a
        // scalar to an array is per-component in AE expressions.
        sclP.expression = 'var p = ' + period + '; var a = ' + amount + ';\n' +
          'var f = a * Math.sin((time - inPoint) * 2 * Math.PI / p);\n' +
          'value + f;';
        info.period = period; info.amount = amount; info.expression = 'Scale';
      } else if (recipe === 'orbit') {
        // Parent to a null at the reference layer's position that rotates; the
        // child sits at radius on the +X axis in the null's space. Radius stays
        // exact by construction, speed = one turn per `period` seconds.
        var periodO = (typeof opts.period === 'number' && opts.period > 0) ? opts.period : 4;
        var refWorld = _compSpacePosition(refLayer, comp.time);
        var childWorld = _compSpacePosition(layer, comp.time);
        var radius = (typeof opts.radius === 'number' && opts.radius > 0) ? opts.radius : Math.sqrt(Math.pow(childWorld[0] - refWorld[0], 2) + Math.pow(childWorld[1] - refWorld[1], 2));
        if (radius < 1) radius = 200;
        var ang0 = Math.atan2(childWorld[1] - refWorld[1], childWorld[0] - refWorld[0]) * 180 / Math.PI;
        var nul = comp.layers.addNull();
        nul.name = layer.name + ' Orbit';
        nul.moveBefore(layer);
        var np = nul.property('ADBE Transform Group');
        np.property('ADBE Position').setValue([refWorld[0], refWorld[1]]);
        np.property('ADBE Anchor Point').setValue([0, 0]);
        if (refLayer.parent || refLayer.property('ADBE Transform Group').property('ADBE Position').numKeys > 0 || refLayer.property('ADBE Transform Group').property('ADBE Position').expressionEnabled) {
          nul.parent = refLayer;
          np.property('ADBE Position').setValue([0, 0]);
          nul.parent = null;
          nul.parent = refLayer;
          var refA = refLayer.property('ADBE Transform Group').property('ADBE Anchor Point').value;
          np.property('ADBE Position').setValue([refA[0], refA[1]]);
        }
        np.property('ADBE Rotate Z').expression = 'var ang0 = ' + _r2(ang0) + '; ang0 + (time - inPoint) * 360 / ' + periodO + ';';
        _recipeClearKeys(posP);
        posP.expression = '';
        layer.parent = null;
        layer.parent = nul;
        posP.setValue(posP.value.length === 3 ? [radius, 0, 0] : [radius, 0]);
        info.radius = _r2(radius); info.period = periodO; info.orbitNull = nul.name; info.around = refLayer.name;
      } else if (recipe === 'follow') {
        var lag = (typeof opts.delay === 'number' && opts.delay > 0) ? opts.delay : 0.5;
        var offsetW = null;
        try { var a1 = _compSpacePosition(layer, comp.time); var b1 = _compSpacePosition(refLayer, comp.time); offsetW = [a1[0] - b1[0], a1[1] - b1[1]]; } catch (eO) { offsetW = [0, 0]; }
        if (layer.parent) { warnings.push(' NOTE: "' + layer.name + '" is parented — follow reads the leader in comp space, so its parent was cleared to keep the math honest.'); layer.parent = null; }
        _recipeClearKeys(posP);
        posP.expression = 'var L = thisComp.layer("' + refLayer.name.replace(/"/g, '\\"') + '");\n' +
          'var p = L.toComp(L.anchorPoint, time - ' + lag + ');\n' +
          '[p[0] + ' + _r2(offsetW[0]) + ', p[1] + ' + _r2(offsetW[1]) + ']';
        info.leader = refLayer.name; info.lag = lag; info.keepsOffset = _r2(offsetW);
      } else if (recipe === 'shake') {
        var freq = (typeof opts.frequency === 'number' && opts.frequency > 0) ? opts.frequency : 4;
        var amp = (typeof opts.amount === 'number') ? opts.amount : 20;
        var rotAmp = (typeof opts.rotation === 'number') ? opts.rotation : 1;
        posP.expression = 'wiggle(' + freq + ', ' + amp + ')';
        if (rotAmp > 0) rotP.expression = 'wiggle(' + freq + ', ' + rotAmp + ')';
        info.frequency = freq; info.amount = amp; info.rotation = rotAmp;
      }
      result.applied.push(info);
    }
    _endToolUndo();
    result.ok = result.applied.length > 0;
    var msg = tag + ': ' + result.applied.length + ' layer(s)';
    if (result.skipped.length) msg += ', ' + result.skipped.length + ' skipped (' + (function () { var a = []; for (var i = 0; i < result.skipped.length; i++) a.push(result.skipped[i].layer + ': ' + result.skipped[i].reason); return a.join('; '); })() + ')';
    if (result.applied.length) {
      var f = result.applied[0];
      if (recipe === 'pop_in' || recipe === 'slide_in' || recipe === 'fade') msg += '; keys from each layer\'s in-point' + (delay ? ' + ' + delay + 's' : '') + (stagger ? ', staggered by ' + stagger + 's' : '') + ', ' + duration + 's each, easy ease ' + influence + '%' + (overshoot ? ', overshoot ' + overshoot : '') + '. First: ' + f.layer + ' ' + f.start + '–' + f.end + 's.';
      if (recipe === 'slide_in') {
        msg += ' Start point is fully outside the frame on the ' + (f.from) + ' side (comp [' + f.offscreenComp.join(', ') + ']), landing at comp [' + f.landsAt.join(', ') + '].';
        // Eval corpus 2026-09-03: on a parented layer the model read the keys
        // back, saw values that are not comp coordinates, deleted them and
        // rewrote them by hand (wrong). Say where the numbers live.
        if (f.parent) msg += ' NOTE: "' + f.layer + '" is parented to "' + f.parent + '" — the keys are stored in PARENT space, so key VALUES differ from comp coordinates by design. Check the motion only with probe_motion(space:"comp"); do not delete or rewrite these keys from comp numbers.';
      }
      if (recipe === 'pulse') msg += '; Scale expression ±' + f.amount + '% every ' + f.period + 's (from each layer\'s in-point).';
      if (recipe === 'orbit') msg += '; each layer parented to a new rotating null at "' + f.around + '" (radius ' + f.radius + 'px, one turn per ' + f.period + 's). To change speed edit the null\'s Rotation expression; to change radius set the child\'s Position x.';
      if (recipe === 'follow') msg += '; Position expression follows "' + f.leader + '" with ' + f.lag + 's lag, keeping the current offset.';
      if (recipe === 'shake') msg += '; Position wiggle(' + f.frequency + ', ' + f.amount + ')' + (f.rotation ? ' + Rotation wiggle(' + f.frequency + ', ' + f.rotation + ')' : '') + '.';
    }
    for (var wi = 0; wi < warnings.length; wi++) msg += warnings[wi];
    result.message = result.ok ? msg : 'apply_motion_recipe: nothing applied — ' + msg;
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'applyMotionRecipe error: ' + e.toString();
    return resultToJson(result);
  }
}
function extensionsLlmChat_getCapabilities () {
  var result = { ok: true, version: '2026-04-30-chat-cleanup', helpers: {}, message: '' };
  var globalScope = (typeof $ !== 'undefined' && $.global) ? $.global : this;
  var probeList = [
    '_resolveLayer', '_resolveProperty', '_layerTypeString',
    '_getTemporalEaseDims', 'resultToJson',
    '_beginToolUndo', '_endToolUndo', '_validateValueForPath',
    '_PATH_VALUE_TYPES', '_KNOWN_PATHS',
    'extensionsLlmChat_resolveActiveComp',
    'extensionsLlmChat_getActiveCompNote',
    'extensionsLlmChat_getDetailedCompSummary',
    'extensionsLlmChat_getHostContext',
    'extensionsLlmChat_createLayer',
    'extensionsLlmChat_setPropertyValue',
    'extensionsLlmChat_addKeyframes',
    'extensionsLlmChat_setKeyframeEasing',
    'extensionsLlmChat_copyEase',
    'extensionsLlmChat_reverseKeyframes',
    'extensionsLlmChat_shiftKeyframes',
    'extensionsLlmChat_staggerLayers',
    'extensionsLlmChat_randomizeProperty',
    'extensionsLlmChat_moveAnchorPoint',
    'extensionsLlmChat_setEffectPropertyValue',
    'extensionsLlmChat_setTextDocument',
    'extensionsLlmChat_addEffect',
    'extensionsLlmChat_addMask',
    'extensionsLlmChat_saveCompFramePng',
    'extensionsLlmChat_setTrackMatte',
    'extensionsLlmChat_setLayerSwitches',
    'extensionsLlmChat_setTimeRemap',
    'extensionsLlmChat_splitLayer',
    'extensionsLlmChat_openComp',
    'extensionsLlmChat_renderCompAudio',
    'extensionsLlmChat_createSubtitles',
    'extensionsLlmChat_readSubtitleRig',
    'extensionsLlmChat_rewriteSubtitleRig',
    'extensionsLlmChat_probeMotion',
    '_compSpacePosition',
    '_firstKeyNote',
    '_opacityRampNote',
    'extensionsLlmChat_applyMotionRecipe'
  ];
  for (var i = 0; i < probeList.length; i++) {
    var name = probeList[i];
    var present = false;
    try {
      var ref = globalScope[name];
      // Functions evaluate as function; constants like _PATH_VALUE_TYPES as object.
      present = (typeof ref === 'function') || (typeof ref === 'object' && ref !== null);
    } catch (e) { present = false; }
    result.helpers[name] = present;
  }
  return resultToJson(result);
}

/**
 * Prune ~/AE-agent-captures so it stays bounded. Walks all dated subfolders,
 * collects every .png, sorts by modified date desc, deletes everything past
 * the keep limit. Empty dated folders are removed afterwards.
 */
function _pruneOldCaptures (rootFolder, keepCount) {
  if (!rootFolder || !rootFolder.exists) return;
  if (typeof keepCount !== 'number' || keepCount < 1) keepCount = 50;
  var allFiles = [];
  var subfolders;
  try { subfolders = rootFolder.getFiles(function (f) { return (f instanceof Folder); }); } catch (eS) { subfolders = []; }
  if (!(subfolders instanceof Array)) return;
  for (var s = 0; s < subfolders.length; s++) {
    var sub = subfolders[s];
    var pngs;
    try { pngs = sub.getFiles('*.png'); } catch (eP) { pngs = []; }
    if (pngs instanceof Array) {
      for (var p = 0; p < pngs.length; p++) {
        try { allFiles.push({ file: pngs[p], modified: pngs[p].modified }); } catch (eM) {}
      }
    }
  }
  if (allFiles.length <= keepCount) return;
  allFiles.sort(function (a, b) {
    var at = a.modified ? a.modified.getTime() : 0;
    var bt = b.modified ? b.modified.getTime() : 0;
    return bt - at;
  });
  for (var i = keepCount; i < allFiles.length; i++) {
    try { allFiles[i].file.remove(); } catch (eDel) {}
  }
  // Sweep empty dated subfolders.
  for (var k = 0; k < subfolders.length; k++) {
    var folder = subfolders[k];
    var remaining;
    try { remaining = folder.getFiles(); } catch (eR) { remaining = []; }
    if (remaining instanceof Array && remaining.length === 0) {
      try { folder.remove(); } catch (eRem) {}
    }
  }
}
