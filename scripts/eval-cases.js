/**
 * Eval corpus — cases. Human-style Russian requests a motion designer would
 * actually type, each with a fixture (comp state before the request) and
 * semantic checks over the REAL comp state after the agent run. Checks test
 * the observable outcome (values at times, comp-space positions, names,
 * switches), never the method — keyframes and expressions are both fine.
 *
 * Runner: scripts/eval-corpus.js. Every case gets a fresh fixture, so cases
 * are independent and can be filtered with --only / --tag.
 *
 * Case shape:
 *   { id, tags, fixture, prompt | turns:[{prompt, checks}], sampleTimes?,
 *     preProbe? (ExtendScript run after the turn, before probing),
 *     checks(after, before, run) -> [{ name, pass, detail }] }
 */
'use strict'

// ── Fixtures (ExtendScript, ES3) ────────────────────────────────────────
// Each fixture runs inside the wiped eval comp. `resultToJson` is provided
// by the loaded host script.
const PRELUDE = `
  var c = app.project.activeItem;
  function circle (name, x, y, rgb, size) {
    var L = c.layers.addShape(); L.name = name;
    var g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var e = g.property('ADBE Vectors Group').addProperty('ADBE Vector Shape - Ellipse');
    e.property('ADBE Vector Ellipse Size').setValue([size, size]);
    var f = g.property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Fill');
    f.property('ADBE Vector Fill Color').setValue(rgb);
    L.property('ADBE Transform Group').property('ADBE Position').setValue([x, y]);
    return L;
  }
  function solid (name, rgb, w, h, x, y) {
    var L = c.layers.addSolid(rgb, name, w, h, 1);
    L.property('ADBE Transform Group').property('ADBE Position').setValue([x, y]);
    return L;
  }
  function pos (L) { return L.property('ADBE Transform Group').property('ADBE Position'); }
`

function fx (body) {
  return '(function(){ try { app.beginUndoGroup("eval-fixture"); ' + PRELUDE + body +
    ' app.endUndoGroup(); return resultToJson({ ok: true, numLayers: c.numLayers }); } catch (e) { app.endUndoGroup(); return resultToJson({ ok: false, message: String(e) }); } })()'
}

const fixtures = {
  // Three static colored circles side by side. Order top→bottom: C, B, A.
  shapes3: fx(`
    circle('Circle A', 560, 540, [0.9, 0.2, 0.2], 200);
    circle('Circle B', 960, 540, [0.2, 0.8, 0.3], 200);
    circle('Circle C', 1360, 540, [0.2, 0.4, 0.9], 200);
  `),
  // Same, but Circle A travels left→right over 0–2 s (linear keys).
  shapes3Moving: fx(`
    var A = circle('Circle A', 300, 540, [0.9, 0.2, 0.2], 200);
    circle('Circle B', 960, 540, [0.2, 0.8, 0.3], 200);
    circle('Circle C', 1360, 540, [0.2, 0.4, 0.9], 200);
    var p = pos(A); p.setValueAtTime(0, [300, 540]); p.setValueAtTime(2, [1600, 540]);
    for (var k = 1; k <= p.numKeys; k++) { p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR); }
  `),
  // Circle B carries a BROKEN expression (references a layer that does not exist).
  brokenExpr: fx(`
    circle('Circle A', 560, 540, [0.9, 0.2, 0.2], 200);
    var B = circle('Circle B', 960, 540, [0.2, 0.8, 0.3], 200);
    circle('Circle C', 1360, 540, [0.2, 0.4, 0.9], 200);
    pos(B).expression = 'var amp = thisComp.layer("Ctrl").effect("Amp")("Slider");\\nwiggle(2, amp)';
  `),
  // Four solid cards in a row. Top→bottom: Card 4, 3, 2, 1 (creation order).
  cards: fx(`
    for (var i = 1; i <= 4; i++) { solid('Card ' + i, [0.2 + 0.15 * i, 0.5, 0.9 - 0.15 * i], 360, 220, 300 + (i - 1) * 440, 540); }
  `),
  // Cards whose in-points differ (1.0 / 1.5 / 2.0 s) — entrance motion must start at each in-point.
  cardsLate: fx(`
    for (var i = 1; i <= 3; i++) { var L = solid('Card ' + i, [0.2 + 0.2 * i, 0.5, 0.9 - 0.2 * i], 360, 220, 400 + (i - 1) * 560, 540); L.inPoint = 0.5 + i * 0.5; }
  `),
  // Column: Card 4 at the top of the frame and of the stack, Card 1 at the
  // bottom — visual and timeline "top→bottom" agree and differ from name order.
  cardsColumn: fx(`
    for (var i = 1; i <= 4; i++) { solid('Card ' + i, [0.2 + 0.15 * i, 0.5, 0.9 - 0.15 * i], 520, 180, 960, 180 + (4 - i) * 240); }
  `),
  cardsHidden3: fx(`
    for (var i = 1; i <= 4; i++) { var L = solid('Card ' + i, [0.2 + 0.15 * i, 0.5, 0.9 - 0.15 * i], 360, 220, 300 + (i - 1) * 440, 540); if (i === 3) L.enabled = false; }
  `),
  cardsLocked2: fx(`
    for (var i = 1; i <= 4; i++) { var L = solid('Card ' + i, [0.2 + 0.15 * i, 0.5, 0.9 - 0.15 * i], 360, 220, 300 + (i - 1) * 440, 540); if (i === 2) L.locked = true; }
  `),
  // Cards already staggered by 0.3 s via in-points (Card 1 first).
  cardsStaggered: fx(`
    for (var i = 1; i <= 4; i++) { var L = solid('Card ' + i, [0.2 + 0.15 * i, 0.5, 0.9 - 0.15 * i], 360, 220, 300 + (i - 1) * 440, 540); L.inPoint = (i - 1) * 0.3; }
  `),
  // A child parented to a null that sits off-center: the parent-space trap.
  parented: fx(`
    var N = c.layers.addNull(); N.name = 'Anchor'; pos(N).setValue([1400, 300]);
    var K = circle('Child', 0, 0, [0.9, 0.6, 0.1], 160);
    K.parent = N; pos(K).setValue([0, 0]);
  `),
  // Planet at center; Orbit null rotates 90°/s; Moon parented at radius 300.
  orbit: fx(`
    circle('Planet', 960, 540, [0.2, 0.5, 0.9], 220);
    var O = c.layers.addNull(); O.name = 'Orbit'; pos(O).setValue([960, 540]);
    O.property('ADBE Transform Group').property('ADBE Rotate Z').expression = 'time * 90';
    var M = circle('Moon', 0, 0, [0.85, 0.85, 0.8], 70);
    M.parent = O; pos(M).setValue([300, 0]);
  `),
  // One text layer.
  text: fx(`
    var T = c.layers.addText('Hello'); T.name = 'Title';
    var doc = T.property('ADBE Text Properties').property('ADBE Text Document').value;
    doc.fontSize = 120; doc.fillColor = [1, 1, 1]; doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    T.property('ADBE Text Properties').property('ADBE Text Document').setValue(doc);
    pos(T).setValue([960, 540]);
  `)
}

// ── Check helpers ───────────────────────────────────────────────────────
function byName (state, re) {
  return (state && state.layers || []).find(l => re.test(l.name)) || null
}
function ck (name, pass, detail) { return { name, pass: !!pass, detail: detail === undefined ? '' : String(detail) } }
function near (a, b, tol) { return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol }
function dist (p, q) { return (p && q) ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity }
function fmt (v) { return JSON.stringify(v) }
function sameWorld (l1, l2, tol) {
  if (!l1 || !l2 || !l1.at || !l2.at) return false
  return l1.at.world.every((p, i) => dist(p, l2.at.world[i]) <= tol)
}
function scalar (v) { return Array.isArray(v) ? v[0] : v }
function hasExprErrors (state) {
  return (state.layers || []).filter(l => ['position', 'scale', 'rotation', 'opacity', 'anchorPoint'].some(k => l[k] && l[k].exprError) || l.textExprError)
}
/** Appearance time: in-point if > 0, else first key of opacity/scale (whichever is earliest), else 0. */
/**
 * When does a layer first become visible? In-point, the first VISIBLE
 * opacity/scale key (a leading invisible key — e.g. "0 at t=0 hold, 100 at
 * 0.4" — is the correct way to hide a card until 0.4 s and must not count as
 * appearing at 0; eval corpus 2026-09-03 stagger-new judged a right answer
 * wrong this way), or the first position key (a slide-in from off-screen).
 * A visible FIRST key means the layer shows from its in-point (AE holds the
 * first key's value before it).
 */
function appearanceTime (l) {
  const cands = []
  const inPt = l.inPoint > 0.01 ? l.inPoint : 0
  if (inPt) cands.push(inPt)
  const visible = (k, v) => k === 'opacity' ? v > 0.5 : (Array.isArray(v) ? Math.abs(v[0]) > 0.5 && Math.abs(v[1]) > 0.5 : v > 0.5)
  for (const k of ['opacity', 'scale']) {
    const p = l[k]
    if (!p || p.numKeys <= 0) continue
    if (Array.isArray(p.keys) && p.keys.length) {
      if (visible(k, p.keys[0].v)) { cands.push(Math.max(inPt, 0)); continue }
      const j = p.keys.findIndex(key => visible(k, key.v))
      if (j > 0) {
        // A fade starts to show at the invisible key it ramps from; a HOLD
        // key keeps the layer hidden until the visible key itself.
        cands.push(p.keys[j - 1].hold ? p.keys[j].t : p.keys[j - 1].t)
        continue
      }
    }
    if (typeof p.firstKeyTime === 'number') cands.push(p.firstKeyTime)
  }
  if (l.position && l.position.numKeys > 0 && typeof l.position.firstKeyTime === 'number') cands.push(l.position.firstKeyTime)
  return cands.length ? Math.min(...cands) : 0
}
function angleDeg (p, center) { return Math.atan2(p[1] - center[1], p[0] - center[0]) * 180 / Math.PI }
function angleDelta (a, b) { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d }
function mentions (text, re) { return re.test(String(text || '')) }
/** The model's final message alone (without the prepended plan) — what text checks must judge. */
function outcome (run) { return (run && typeof run.outcome === 'string' && run.outcome) ? run.outcome : (run && run.content) || '' }

const MUTATING_TOOLS_HINT = /^(get_|list_|search_|probe_|transcribe_|capture_)/

// ── Cases ───────────────────────────────────────────────────────────────
const cases = [
  {
    id: 'fade-in', tags: ['basic', 'keyframes', 'constraints'], fixture: 'shapes3',
    prompt: 'Сделай, чтобы Circle B плавно появлялся за первые 0.5 секунды. Остальные круги не трогай.',
    sampleTimes: [0, 0.25, 0.6, 2],
    checks: (a, b) => {
      const B = byName(a, /Circle B/); const A = byName(a, /Circle A/); const C = byName(a, /Circle C/)
      const op = B && B.at.opacity
      return [
        ck('Circle B starts invisible (opacity ≤ 5 at t=0)', op && op[0] <= 5, 'opacity=' + fmt(op)),
        ck('Circle B fully visible by 0.6 s (≥ 90)', op && op[2] >= 90 && op[3] >= 95, 'opacity=' + fmt(op)),
        ck('Circle A and C untouched (opacity 100, no new keys/expr)', A && C && A.at.opacity.every(v => v >= 99) && C.at.opacity.every(v => v >= 99) && A.opacity.numKeys === 0 && C.opacity.numKeys === 0 && !A.opacity.expr && !C.opacity.expr,
          'A=' + fmt(A && A.at.opacity) + ' C=' + fmt(C && C.at.opacity))
      ]
    }
  },
  {
    id: 'move-right', tags: ['basic', 'values'], fixture: 'shapes3',
    prompt: 'Подвинь Circle A правее на 200 пикселей.',
    checks: (a, b) => {
      const A = byName(a, /Circle A/); const A0 = byName(b, /Circle A/)
      const p = A && A.at.world[1]; const p0 = A0 && A0.at.world[1]
      return [
        ck('Circle A moved +200 px in x (comp space)', p && p0 && near(p[0], p0[0] + 200, 6) && near(p[1], p0[1], 6), 'before=' + fmt(p0) + ' after=' + fmt(p)),
        ck('Circle B and C did not move', sameWorld(byName(a, /Circle B/), byName(b, /Circle B/), 2) && sameWorld(byName(a, /Circle C/), byName(b, /Circle C/), 2))
      ]
    }
  },
  {
    id: 'shrink', tags: ['basic', 'values'], fixture: 'shapes3',
    prompt: 'Уменьши Circle C до 60 процентов.',
    checks: (a) => {
      const C = byName(a, /Circle C/); const A = byName(a, /Circle A/); const B = byName(a, /Circle B/)
      const s = C && C.at.scale[2]
      return [
        ck('Circle C scale ≈ 60% (at t=1)', s && near(s[0], 60, 2) && near(s[1], 60, 2), 'scale=' + fmt(s)),
        ck('Circle A and B keep scale 100', A && B && near(scalar(A.at.scale[2]), 100, 1) && near(scalar(B.at.scale[2]), 100, 1))
      ]
    }
  },
  {
    id: 'spin', tags: ['basic', 'motion'], fixture: 'shapes3',
    prompt: 'Пусть Circle B крутится: один полный оборот за 2 секунды.',
    sampleTimes: [0, 1, 2, 4],
    checks: (a) => {
      const B = byName(a, /Circle B/); const r = B && B.at.rotation
      const full = r && Math.abs(r[2] - r[0]); const half = r && Math.abs(r[1] - r[0])
      return [
        ck('Circle B turns ~360° between t=0 and t=2', r && near(full, 360, 40), 'rotation=' + fmt(r)),
        ck('… and ~180° by t=1 (continuous spin)', r && near(half, 180, 40), 'rotation=' + fmt(r)),
        ck('spin continues after 2 s (t=4 ≠ t=2)', r && Math.abs(r[3] - r[2]) > 90, 'rotation=' + fmt(r))
      ]
    }
  },
  {
    id: 'pulse', tags: ['basic', 'motion'], fixture: 'shapes3',
    prompt: 'Circle A должен пульсировать: плавно увеличиваться и уменьшаться примерно раз в секунду, всё время.',
    sampleTimes: [0, 0.25, 0.5, 0.75, 1, 1.5, 2.25, 4.1],
    checks: (a) => {
      const A = byName(a, /Circle A/); const s = A ? A.at.scale.map(scalar) : null
      const mx = s && Math.max(...s); const mn = s && Math.min(...s)
      return [
        ck('Circle A scale varies over time (range ≥ 5)', s && mx - mn >= 5, 'scale=' + fmt(s)),
        ck('… within a sane range (40–170)', s && mn >= 40 && mx <= 170, 'scale=' + fmt(s)),
        ck('… still varies late in the comp (t=2.25 vs 4.1 vs neighbours)', s && (Math.abs(s[7] - s[6]) > 1 || Math.abs(s[6] - s[5]) > 1), 'scale=' + fmt(s))
      ]
    }
  },
  {
    id: 'hidden-target', tags: ['guard', 'constraints'], fixture: 'cardsHidden3',
    prompt: 'Увеличь Card 3 в полтора раза.',
    checks: (a, b, run) => {
      const L = byName(a, /^Card 3$/); const s = L && L.at.scale[2]
      const told = mentions(outcome(run), /скрыт|выключ|отключ|невидим|не видн|видимост|hidden|disabled|eyeball|video switch|enabled/i)
      return [
        ck('Card 3 scale ≈ 150%', s && near(s[0], 150, 3) && near(s[1], 150, 3), 'scale=' + fmt(s)),
        ck('hidden layer either enabled or reported as hidden', L && (L.enabled === true || told), 'enabled=' + (L && L.enabled) + ' told=' + told)
      ]
    }
  },
  {
    id: 'locked-target', tags: ['guard', 'constraints'], fixture: 'cardsLocked2',
    prompt: 'Сдвинь Card 2 на 100 пикселей вниз.',
    checks: (a, b, run) => {
      const L = byName(a, /^Card 2$/); const L0 = byName(b, /^Card 2$/)
      const text = outcome(run)
      const moved = !(L && L0 && sameWorld(L, L0, 1))
      const told = mentions(text, /заблок|блокир|lock|замок|разблок/i)
      const saidUnlocked = mentions(text, /разблок|unlock|снял[аи]? блок|сня[лт][аи]? замок/i)
      // The prompt allows either path: leave it and explain, or unlock AND say so.
      return [
        ck('answer mentions the lock', told, text.slice(0, 160)),
        ck('not moved silently: moved only with an explicit unlock notice', !moved || saidUnlocked, 'moved=' + moved + ' saidUnlocked=' + saidUnlocked + ' before=' + fmt(L0 && L0.at.world[1]) + ' after=' + fmt(L && L.at.world[1])),
        ck('lock not silently dropped: still locked, or the answer says it was unlocked', (L && L.locked === true) || saidUnlocked, 'locked=' + (L && L.locked))
      ]
    }
  },
  {
    id: 'parent-space-center', tags: ['values', 'parenting'], fixture: 'parented',
    prompt: 'Поставь Child точно в центр кадра.',
    checks: (a) => {
      const K = byName(a, /^Child$/); const p = K && K.at.world[1]
      return [ck('Child sits at comp center [960,540] in COMP space', p && dist(p, [960, 540]) <= 6, 'world=' + fmt(p) + ' local=' + fmt(K && K.position && K.position.value))]
    }
  },
  {
    id: 'already-staggered', tags: ['guard', 'timing'], fixture: 'cardsStaggered',
    prompt: 'Сделай, чтобы карточки появлялись по очереди с задержкой 0.3 секунды между ними.',
    checks: (a, b, run) => {
      const cards = (a.layers || []).filter(l => /^Card \d$/.test(l.name)).sort((x, y) => x.name.localeCompare(y.name))
      const times = cards.map(appearanceTime)
      const gaps = times.slice(1).map((t, i) => t - times[i])
      const notDoubled = times.length === 4 && Math.max(...times) <= 1.0 && gaps.every(g => near(g, 0.3, 0.08))
      const inPoints = cards.map(l => +l.inPoint.toFixed(2))
      const inPointsKept = inPoints.length === 4 && inPoints.every((t, i) => near(t, i * 0.3, 0.02))
      const untouched = /No changes detected/.test(run.diffText || '')
      const acknowledged = mentions(outcome(run), /уже|already|как есть|не требу|без изменени|оставил/i)
      // Appearance animation (if any) must start AT each card's in-point, not stack on top of it.
      const alignedFades = cards.every(l => !(l.opacity && l.opacity.numKeys > 0) || near(l.opacity.firstKeyTime, l.inPoint, 0.05))
      return [
        ck('stagger not doubled: still 0.3 s gaps, last starts ≤ 1.0 s', notDoubled, 'appearance=' + fmt(times.map(t => +t.toFixed(2)))),
        ck('existing in-point stagger kept (0/0.3/0.6/0.9)', inPointsKept, 'inPoints=' + fmt(inPoints)),
        ck('either reported as already staggered (nothing changed) or only added fades aligned to the in-points', (untouched && acknowledged) || (!untouched && alignedFades), 'untouched=' + untouched + ' acknowledged=' + acknowledged + ' alignedFades=' + alignedFades)
      ]
    }
  },
  {
    id: 'constraint-preserve', tags: ['constraints', 'values'], fixture: 'shapes3Moving',
    prompt: 'Сделай Circle A вдвое меньше, но его анимацию движения не ломай.',
    sampleTimes: [0, 1, 2],
    checks: (a) => {
      const A = byName(a, /Circle A/); const s = A && A.at.scale[1]
      const travel = A && dist(A.at.world[0], A.at.world[2])
      return [
        ck('Circle A scale ≈ 50%', s && near(s[0], 50, 3), 'scale=' + fmt(s)),
        ck('position animation preserved (≥ 2 keys, still travels ≥ 1000 px over 0–2 s)', A && A.position.numKeys >= 2 && travel >= 1000, 'keys=' + (A && A.position.numKeys) + ' travel=' + Math.round(travel || 0))
      ]
    }
  },
  {
    id: 'fix-broken-expr', tags: ['expressions', 'repair'], fixture: 'brokenExpr',
    prompt: 'У Circle B ошибка выражения (жёлтая полоска). Почини так, чтобы он всё так же слегка покачивался.',
    sampleTimes: [0, 0.5, 1, 1.5],
    checks: (a) => {
      const B = byName(a, /Circle B/)
      const move = B ? Math.max(...B.at.world.map((p, i) => B.at.world.slice(i + 1).reduce((m, q) => Math.max(m, dist(p, q)), 0))) : 0
      return [
        ck('Circle B still moves (wiggle-like motion > 3 px)', move > 3, 'maxPairwise=' + move.toFixed(1) + ' expr=' + (B && B.position.expr))
      ]
    }
  },
  {
    id: 'orbit-faster', tags: ['motion', 'parenting'], fixture: 'orbit',
    prompt: 'Луна крутится вокруг планеты слишком медленно, ускорь её в три раза.',
    sampleTimes: [0, 0.5, 1],
    checks: (a) => {
      const M = byName(a, /^Moon$/); const w = M && M.at.world
      const center = [960, 540]
      const radii = w ? w.map(p => dist(p, center)) : []
      const dA = w ? Math.abs(angleDelta(angleDeg(w[0], center), angleDeg(w[1], center))) : 0
      return [
        ck('Moon keeps a ~constant radius around the planet', radii.length === 3 && Math.max(...radii) / Math.max(1, Math.min(...radii)) < 1.5 && Math.min(...radii) > 100, 'radii=' + fmt(radii.map(Math.round))),
        ck('angular speed ≈ 3× (≈135° per 0.5 s, was 45°)', near(dA, 135, 40), 'deltaAngle(0→0.5s)=' + dA.toFixed(1))
      ]
    }
  },
  {
    id: 'text-change', tags: ['text', 'basic'], fixture: 'text',
    prompt: 'Поменяй текст на "Привет, мир" и сделай его красным.',
    checks: (a) => {
      const T = byName(a, /^Title$/) || (a.layers || []).find(l => l.type === 'text')
      const txt = T && String(T.textAt && T.textAt[1] || '').replace(/^\s+|\s+$/g, '')
      const fc = T && T.textFill
      return [
        ck('text is exactly «Привет, мир»', txt === 'Привет, мир', 'text=' + fmt(txt)),
        ck('fill is red', fc && fc[0] > 0.7 && fc[1] < 0.35 && fc[2] < 0.35, 'fill=' + fmt(fc))
      ]
    }
  },
  {
    id: 'typewriter', tags: ['text', 'motion'], fixture: 'text',
    prompt: 'Сделай, чтобы текст печатался по буквам за 2 секунды.',
    sampleTimes: [0.3, 2.5],
    checks: (a) => {
      const T = (a.layers || []).find(l => l.type === 'text')
      const early = T && T.textAt ? T.textAt[0].length : null; const late = T && T.textAt ? T.textAt[1].length : null
      const viaExpr = early !== null && late !== null && early < late
      const viaAnimator = T && T.textAnimators > 0
      return [ck('typewriter reveal exists (source-text expression grows OR a text animator was added)', viaExpr || viaAnimator, 'early=' + early + ' late=' + late + ' animators=' + (T && T.textAnimators))]
    }
  },
  {
    id: 'slider-rig', tags: ['rig', 'expressions'], fixture: 'shapes3',
    prompt: 'Добавь контроллер со слайдером Speed, и пусть Circle C крутится со скоростью из этого слайдера.',
    sampleTimes: [0, 2],
    // Sliders often default to 0 — give every slider a non-zero value before probing.
    preProbe: `(function(){ var c = app.project.activeItem; var n = 0; for (var i = 1; i <= c.numLayers; i++) { var fx = c.layer(i).property('ADBE Effect Parade'); if (!fx) continue; for (var j = 1; j <= fx.numProperties; j++) { var e = fx.property(j); if (e.matchName === 'ADBE Slider Control') { try { if (e.property(1).value === 0) { e.property(1).setValue(90); n++; } } catch (er) {} } } } return resultToJson({ ok: true, set: n }); })()`,
    checks: (a) => {
      const ctrl = (a.layers || []).find(l => (l.effects || []).some(e => e.matchName === 'ADBE Slider Control'))
      const C = byName(a, /Circle C/); const r = C && C.at.rotation
      return [
        ck('a layer carries a Slider Control', !!ctrl, ctrl ? ctrl.name + ' ' + fmt(ctrl.effects.map(e => e.name)) : 'none'),
        ck('Circle C rotation expression references the slider', C && /effect|Slider|Speed/i.test(C.rotation.expr || ''), 'expr=' + (C && C.rotation.expr)),
        ck('Circle C actually rotates with a non-zero slider', r && Math.abs(r[1] - r[0]) > 20, 'rotation=' + fmt(r))
      ]
    }
  },
  {
    id: 'delete-rename', tags: ['layer-mgmt'], fixture: 'cards',
    prompt: 'Удали Card 4, а Card 1 переименуй в Hero.',
    checks: (a) => {
      const names = (a.layers || []).map(l => l.name)
      return [
        ck('Card 4 deleted, Card 1 → Hero, 3 layers remain', names.length === 3 && !names.includes('Card 4') && !names.includes('Card 1') && names.includes('Hero') && names.includes('Card 2') && names.includes('Card 3'), fmt(names))
      ]
    }
  },
  {
    id: 'stagger-new', tags: ['timing', 'batch'], fixture: 'cardsColumn',
    prompt: 'Пусть карточки появляются одна за другой, каждая на 0.4 секунды позже предыдущей, сверху вниз.',
    checks: (a) => {
      const cards = (a.layers || []).filter(l => /^Card \d$/.test(l.name)) // index order = top→bottom
      const times = cards.map(appearanceTime)
      const gaps = times.slice(1).map((t, i) => t - times[i])
      return [
        ck('top→bottom (Card 4 first, visually and in the stack) appearance times increase by ~0.4 s', times.length === 4 && gaps.every(g => near(g, 0.4, 0.12)), 'topToBottom=' + fmt(cards.map(l => l.name)) + ' appearance=' + fmt(times.map(t => +t.toFixed(2))))
      ]
    }
  },
  {
    id: 'bg-solid-behind', tags: ['layer-mgmt', 'basic'], fixture: 'shapes3',
    prompt: 'Добавь тёмно-синий фон на всю композицию.',
    checks: (a, b) => {
      const beforeIds = new Set((b.layers || []).map(l => l.id))
      const added = (a.layers || []).filter(l => !beforeIds.has(l.id))
      const bg = added[0]
      const col = bg && (bg.solidColor || bg.fillColor)
      return [
        ck('exactly one new layer', added.length === 1, 'added=' + fmt(added.map(l => l.name))),
        ck('new layer is at the bottom of the stack', bg && bg.index === a.layers.length, 'index=' + (bg && bg.index) + '/' + a.layers.length),
        ck('it covers the comp and is dark blue', bg && bg.width >= 1900 && bg.height >= 1060 && col && col[2] > col[0] && col[2] > col[1] && col[2] < 0.6, 'size=' + (bg && bg.width + 'x' + bg.height) + ' color=' + fmt(col))
      ]
    }
  },
  {
    id: 'follow-delay', tags: ['motion', 'expressions'], fixture: 'shapes3Moving',
    prompt: 'Пусть Circle B повторяет движение Circle A с задержкой полсекунды.',
    sampleTimes: [0.5, 1, 1.5],
    checks: (a) => {
      const A = byName(a, /Circle A/); const B = byName(a, /Circle B/)
      const ok = A && B && dist(B.at.world[1], A.at.world[0]) <= 40 && dist(B.at.world[2], A.at.world[1]) <= 40
      return [ck('B(t) ≈ A(t − 0.5 s) at t=1.0 and 1.5', ok, 'A=' + fmt(A && A.at.world.map(p => p.map(Math.round))) + ' B=' + fmt(B && B.at.world.map(p => p.map(Math.round))))]
    }
  },
  {
    id: 'explicit-mapping', tags: ['timing', 'constraints'], fixture: 'cards',
    prompt: 'Card 1 должна быть видна с 0 по 1 секунду, Card 2 с 1 по 2, Card 3 с 2 по 3, Card 4 с 3 по 4.',
    // Mid-window sample times: 0.5 / 1.5 / 2.5 / 3.5 s — a card must be fully
    // visible at its own mid-time and invisible at the others (in/out trim OR
    // hold-keyed opacity both pass; linear opacity ramps do not).
    sampleTimes: [0.5, 1.5, 2.5, 3.5],
    checks: (a) => {
      const mids = [0.5, 1.5, 2.5, 3.5]
      const res = [1, 2, 3, 4].map(n => {
        const L = byName(a, new RegExp('^Card ' + n + '$'))
        if (!L) return { n, ok: false, detail: 'missing' }
        const vis = mids.map((t, i) => L.enabled && t >= L.inPoint && t < L.outPoint && L.at.opacity[i] >= 90)
        const ok = vis.every((v, i) => v === (i === n - 1))
        return { n, ok, detail: 'io=' + fmt([+L.inPoint.toFixed(2), +L.outPoint.toFixed(2)]) + ' opacity@mid=' + fmt(L.at.opacity) }
      })
      return [ck('each card is visible only in its named window (by NAME, not stack order; trim or hold keys)', res.every(r => r.ok), fmt(res.map(r => 'Card ' + r.n + ': ' + r.detail)))]
    }
  },
  {
    id: 'popin-late', tags: ['recipe', 'timing', 'motion'], fixture: 'cardsLate',
    prompt: 'Сделай pop-in для всех карточек: каждая выскакивает из нуля до своего размера с лёгким перелётом, когда появляется.',
    sampleTimes: [1.0, 1.5, 2.0, 2.5, 3.5],
    checks: (a, b, run) => {
      const cards = (a.layers || []).filter(l => /^Card \d$/.test(l.name))
      const res = cards.map(l => {
        const s0 = scalar(l.scale && l.scale.value)
        const firstAt = l.scale && l.scale.numKeys >= 2 ? l.scale.firstKeyTime : null
        const startsAtIn = firstAt !== null && near(firstAt, l.inPoint, 0.05)
        const fromZero = l.scale && l.scale.numKeys >= 2 && scalar(l.at.scale[[1.0, 1.5, 2.0].indexOf(+l.inPoint.toFixed(2))]) <= 5
        const endsFull = scalar(l.at.scale[4]) >= 95 && scalar(l.at.scale[4]) <= 105
        return { n: l.name, startsAtIn, fromZero, endsFull, firstAt, in: l.inPoint, at: l.at.scale.map(scalar) }
      })
      const recipeUsed = (run.toolCallLog || []).some(e => e.name === 'apply_motion_recipe' && e.status === 'ok')
      return [
        ck('every card scales from 0 starting AT its own in-point (1.0 / 1.5 / 2.0 s)', res.length === 3 && res.every(r => r.startsAtIn && r.fromZero), fmt(res.map(r => r.n + ' in=' + r.in + ' firstKey=' + r.firstAt + ' scale@in=' + r.at[[1.0, 1.5, 2.0].indexOf(+r.in.toFixed(2))]))),
        ck('every card settles at ~100% by 3.5 s', res.every(r => r.endsFull), fmt(res.map(r => r.n + ':' + r.at[4]))),
        ck('info: apply_motion_recipe used', true, 'recipeUsed=' + recipeUsed)
      ]
    }
  },
  {
    id: 'slide-from-right', tags: ['recipe', 'motion', 'parenting'], fixture: 'parented',
    prompt: 'Пусть Child выезжает справа из-за кадра на своё место за 0.8 секунды.',
    sampleTimes: [0, 0.4, 0.8, 1.0],
    checks: (a, b, run) => {
      const K = byName(a, /^Child$/); const K0 = byName(b, /^Child$/)
      const w = K && K.at.world
      const startOff = w && w[0][0] >= 1920
      const landed = w && K0 && dist(w[3], K0.at.world[0]) <= 6
      const recipeUsed = (run.toolCallLog || []).some(e => e.name === 'apply_motion_recipe' && e.status === 'ok')
      return [
        ck('Child starts fully outside the frame on the RIGHT (comp x ≥ 1920 at t=0)', startOff, 'world@0=' + fmt(w && w[0])),
        ck('… and lands exactly on its original position by 1.0 s (comp space, parent honoured)', landed, 'world@1.0=' + fmt(w && w[3]) + ' original=' + fmt(K0 && K0.at.world[0])),
        ck('info: apply_motion_recipe used', true, 'recipeUsed=' + recipeUsed)
      ]
    }
  },
  {
    id: 'orbit-new', tags: ['recipe', 'motion', 'parenting'], fixture: 'shapes3',
    prompt: 'Пусть Circle C крутится вокруг Circle B по кругу, один оборот за 2 секунды, на текущем расстоянии.',
    sampleTimes: [0, 0.5, 1, 1.5, 2],
    checks: (a, b, run) => {
      const C = byName(a, /Circle C/); const B = byName(a, /Circle B/)
      const center = B ? B.at.world[0] : [960, 540]
      const w = C && C.at.world
      const radii = w ? w.map(pt => dist(pt, center)) : []
      const ang = (pt) => angleDeg(pt, center)
      const turned = w ? Math.abs(angleDelta(ang(w[0]), ang(w[2]))) : 0
      const backHome = w ? dist(w[0], w[4]) <= 15 : false
      const recipeUsed = (run.toolCallLog || []).some(e => e.name === 'apply_motion_recipe' && e.status === 'ok')
      return [
        ck('constant radius ≈ 400 px (initial distance) around Circle B', radii.length === 5 && radii.every(r => near(r, 400, 25)), 'radii=' + fmt(radii.map(Math.round))),
        ck('half a turn by 1 s and back to start by 2 s', near(turned, 180, 30) && backHome, 'turned(0→1s)=' + turned.toFixed(0) + ' backHome=' + backHome),
        ck('info: apply_motion_recipe used', true, 'recipeUsed=' + recipeUsed)
      ]
    }
  },
  {
    // Change journal (2026-09-03): the follow-up must edit the rig the agent
    // built one turn earlier — not build a second one. The turn-2 prompt is
    // ambiguous on its own; the journal says what "the rotation" is.
    id: 'orbit-then-faster', tags: ['journal', 'recipe', 'motion', 'parenting'], fixture: 'shapes3',
    sampleTimes: [0, 0.5, 1, 1.5, 2],
    turns: (() => {
      let layersAfter1 = -1; let nullsAfter1 = -1
      const T = [0, 0.5, 1, 1.5, 2]
      const orbitChecks = (a, label, halfIdx, homeIdx) => {
        const C = byName(a, /Circle C/); const B = byName(a, /Circle B/)
        const center = B ? B.at.world[0] : [960, 540]
        const w = C && C.at.world
        const radii = w ? w.map(pt => dist(pt, center)) : []
        const ang = (pt) => angleDeg(pt, center)
        const turned = w ? Math.abs(angleDelta(ang(w[0]), ang(w[halfIdx]))) : 0
        const backHome = w ? dist(w[0], w[homeIdx]) <= 15 : false
        return [
          ck(label + ': constant radius ≈ 400 px around Circle B', radii.length === 5 && radii.every(r => near(r, 400, 25)), 'radii=' + fmt(radii.map(Math.round))),
          ck(label + ': half a turn by ' + T[halfIdx] + ' s and back to start by ' + T[homeIdx] + ' s', near(turned, 180, 30) && backHome, 'turned=' + turned.toFixed(0) + ' backHome=' + backHome)
        ]
      }
      return [
        {
          prompt: 'Пусть Circle C крутится вокруг Circle B по кругу, один оборот за 2 секунды, на текущем расстоянии.',
          checks: (a) => {
            layersAfter1 = (a.layers || []).length
            nullsAfter1 = (a.layers || []).filter(l => l.nullLayer).length
            return orbitChecks(a, 'turn 1 (period 2 s)', 2, 4)
          }
        },
        {
          prompt: 'Ускорь вращение в два раза.',
          checks: (a, b, run) => {
            const layers = a.layers || []
            const nulls = layers.filter(l => l.nullLayer).length
            const names = (run.toolCallLog || []).map(e => e.name + (e.status === 'ok' ? '' : '!'))
            return orbitChecks(a, 'turn 2 (period 1 s)', 1, 2).concat([
              ck('follow-up edited the existing rig: no layers added or removed', layersAfter1 >= 0 && layers.length === layersAfter1, 'layers ' + layersAfter1 + ' → ' + layers.length),
              ck('no second orbit null', nullsAfter1 >= 0 && nulls === nullsAfter1, 'nulls ' + nullsAfter1 + ' → ' + nulls),
              ck('info: turn-2 tools', true, fmt(names))
            ])
          }
        }
      ]
    })()
  },
  {
    id: 'cam-shake', tags: ['recipe', 'motion', 'expressions'], fixture: 'shapes3',
    prompt: 'Добавь лёгкую тряску камеры на всю композицию.',
    sampleTimes: [0, 0.1, 0.2, 0.3],
    checks: (a, b, run) => {
      const beforeIds = new Set((b.layers || []).map(l => l.id))
      const moving = (a.layers || []).filter(l => l.at.world.some((p, i) => i > 0 && dist(p, l.at.world[0]) > 1))
      const circles = (a.layers || []).filter(l => /Circle/.test(l.name))
      const circlesShake = circles.every(l => l.at.world.some((p, i) => i > 0 && dist(p, l.at.world[0]) > 1))
      const sane = moving.every(l => l.at.world.every(p => dist(p, l.at.world[0]) < 150))
      const newLayers = (a.layers || []).filter(l => !beforeIds.has(l.id))
      const madeCamera = newLayers.some(l => l.type === 'camera')
      const flipped3d = circles.filter(l => l.threeD === true)
      const recipeUsed = (run.toolCallLog || []).some(e => e.name === 'apply_motion_recipe' && e.status === 'ok')
      return [
        ck('every circle visibly shakes in comp space (its own motion, a parent null or an adjustment rig — not a camera: the comp is 2D)', circles.length === 3 && circlesShake, fmt(circles.map(l => l.name + ':' + Math.round(l.at.world.reduce((m, p) => Math.max(m, dist(p, l.at.world[0])), 0)))) + ' newLayers=' + fmt(newLayers.map(l => l.name + '/' + l.type))),
        ck('no camera created and no layer switched to 3D just for the shake', !madeCamera && flipped3d.length === 0, 'camera=' + madeCamera + ' flippedTo3D=' + fmt(flipped3d.map(l => l.name))),
        ck('shake is subtle (< 150 px)', sane),
        ck('info: apply_motion_recipe used', true, 'recipeUsed=' + recipeUsed)
      ]
    }
  },
  {
    id: 'question-only', tags: ['guard', 'no-tools'], fixture: 'shapes3',
    prompt: 'Что делает выражение wiggle(2, 30)? Ничего не меняй, просто объясни.',
    checks: (a, b, run) => {
      const mutating = (run.toolCallLog || []).filter(e => !MUTATING_TOOLS_HINT.test(e.name))
      return [
        ck('no mutating tool calls', mutating.length === 0, fmt(mutating.map(e => e.name))),
        ck('comp unchanged (scene diff empty)', /No changes detected/.test(run.diffText || ''), String(run.diffText || '').slice(0, 120)),
        ck('answer explains frequency/amplitude', mentions(outcome(run), /частот|амплитуд|раз в секунду|frequency|amplitude/i), String(outcome(run)).slice(0, 160))
      ]
    }
  }
]

module.exports = { cases, fixtures }
