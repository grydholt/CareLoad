/*
 * CareLoad prototype — mock data.
 *
 * This is the ONLY file meant to be replaced by real API calls later.
 * It exposes a single global, window.CareLoadMock, with:
 *   members      — the two carers (J and S) with their fixed colors
 *   tasks        — pre-generated task instances for ~5 weeks around today
 *   WINDOW_START — first day (Date) of the generated window
 *   WINDOW_END   — last day (Date, inclusive) of the generated window
 *
 * Recurrence is NOT expanded with RRULEs: every recurring task is
 * pre-generated as concrete daily instances by the generator below,
 * so the app can treat each task as a standalone instance.
 *
 * Every task carries a category, one of:
 *   medicin | telefonopkald | aftale | planlæg | køb | andet
 *
 * The care recipient is referred to as "E" in titles/notes. E is not a
 * member and cannot be assigned tasks.
 */
(function () {
  'use strict';

  var MS_DAY = 24 * 60 * 60 * 1000;

  function startOfWeek(date) {
    // Monday-based week start.
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var shift = (d.getDay() + 6) % 7;
    return new Date(d.getTime() - shift * MS_DAY);
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function dateTimeStr(d, h, m) {
    return dateStr(d) + 'T' + pad(h) + ':' + pad(m);
  }

  var NOW = new Date();
  var THIS_MONDAY = startOfWeek(NOW);

  // 5-week window: 2 weeks back, current week, 2 weeks ahead.
  var WINDOW_START = addDays(THIS_MONDAY, -14);
  var WINDOW_END = addDays(THIS_MONDAY, 20); // inclusive

  // Two carers. Colors are a warm ochre and an indigo — chosen to stay
  // distinguishable under the common color-vision deficiencies
  // (they differ along the blue/yellow axis and in lightness).
  var members = [
    { id: 'J', name: 'J', color: '#96590f', tint: '#f5e6cd' },
    { id: 'S', name: 'S', color: '#4c5da3', tint: '#e3e7f7' }
  ];

  var tasks = [];
  var nextId = 1;

  function push(t) {
    tasks.push(Object.assign({
      id: 't-' + String(nextId++).padStart(3, '0'),
      location: null,
      notes: '',
      recurrenceLabel: null,
      category: 'andet'
    }, t));
  }

  // --- Status: past items are mostly done, a handful missed -------------
  var statusSeed = 0;
  function statusFor(endDate) {
    if (!endDate || endDate >= NOW) return 'pending';
    statusSeed++;
    // Deterministic pseudo-random: roughly 1 in 13 past items is missed.
    return (statusSeed * 7919) % 13 === 0 ? 'missed' : 'done';
  }

  // --- Assignment: roughly even overall, but the CURRENT week is
  // deliberately uneven (~70/30 toward J) so the by-person view
  // visibly earns its keep. ---------------------------------------------
  var UNEVEN_PATTERN = ['J', 'J', 'S', 'J', 'J', 'J', 'S', 'J', 'J', 'S'];
  var unevenIdx = 0;
  function assigneeFor(day, slot) {
    if (day >= THIS_MONDAY && day < addDays(THIS_MONDAY, 7)) {
      return UNEVEN_PATTERN[unevenIdx++ % UNEVEN_PATTERN.length];
    }
    var dow = (day.getDay() + 6) % 7;
    return (dow + slot) % 2 === 0 ? 'J' : 'S';
  }

  // --- Daily recurring: medication and ointment ("salve") ---------------
  var DAILY = [
    { title: 'Morgenmedicin til E', h: 8, m: 0 },
    { title: 'Salve på E’s ben (morgen)', h: 9, m: 0 },
    { title: 'Middagsmedicin til E', h: 13, m: 0 },
    { title: 'Aftenmedicin til E', h: 20, m: 0 },
    { title: 'Salve på E’s ben (aften)', h: 21, m: 0 }
  ];

  for (var i = 0; ; i++) {
    var day = addDays(WINDOW_START, i);
    if (day > WINDOW_END) break;
    for (var slot = 0; slot < DAILY.length; slot++) {
      var item = DAILY[slot];
      var end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), item.h, item.m + 15);
      push({
        title: item.title,
        taskType: 'recurring',
        assignee: assigneeFor(day, slot),
        status: statusFor(end),
        start: dateTimeStr(day, item.h, item.m),
        end: dateTimeStr(day, item.h, item.m + 15),
        recurrenceLabel: 'Hver dag',
        category: 'medicin'
      });
    }
  }

  // --- Hospital appointments (sparse, ~1–2 per week) ---------------------
  function appointment(day, h, m, durMin, title, location, recurrenceLabel, slot) {
    if (day < WINDOW_START || day > WINDOW_END) return;
    var endMin = m + durMin;
    var eh = h + Math.floor(endMin / 60);
    var em = endMin % 60;
    var end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
    push({
      title: title,
      taskType: 'appointment',
      assignee: assigneeFor(day, slot),
      status: statusFor(end),
      start: dateTimeStr(day, h, m),
      end: dateTimeStr(day, eh, em),
      location: location,
      recurrenceLabel: recurrenceLabel || null,
      category: 'aftale'
    });
  }

  // Weekly: DAF outpatient clinic every Tuesday.
  for (var w = 0; w < 5; w++) {
    appointment(addDays(WINDOW_START, w * 7 + 1), 10, 30, 45,
      'Kontrol i DAF ambulatorium', 'Rigshospitalet, DAF ambulatorium', 'Hver tirsdag', w);
  }
  // Every other Monday: blood samples.
  for (var b = 0; b < 5; b += 2) {
    appointment(addDays(WINDOW_START, b * 7), 8, 15, 30,
      'Blodprøver med E', 'Herlev Hospital, Klinisk Biokemisk Afdeling', 'Hver anden mandag', b + 1);
  }
  // Single appointments.
  appointment(addDays(THIS_MONDAY, -5), 11, 0, 60,
    'Endokrinolog – halvårskontrol', 'Herlev Hospital, Endokrinologisk Ambulatorium', null, 0);
  appointment(addDays(THIS_MONDAY, 10), 14, 0, 45,
    'Øjenlæge – årskontrol', 'Øjenklinikken, Frederiksberggade 2', null, 1);
  appointment(addDays(THIS_MONDAY, 18), 9, 30, 45,
    'Nyremedicinsk kontrol', 'Rigshospitalet, Nefrologisk Klinik', null, 0);

  // --- One-off errands ----------------------------------------------------
  function oneoff(day, h, m, title, opts) {
    if (day < WINDOW_START || day > WINDOW_END) return;
    var end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m + 30);
    push(Object.assign({
      title: title,
      taskType: 'oneoff',
      assignee: assigneeFor(day, 3),
      status: statusFor(end),
      start: dateTimeStr(day, h, m),
      end: dateTimeStr(day, h, m + 30)
    }, opts || {}));
  }

  oneoff(addDays(WINDOW_START, 3), 16, 0, 'Hent recept på apoteket', { category: 'køb' });
  // Guaranteed "missed" example from last week, so the Forsinket view
  // always has a clear, recognizable entry.
  oneoff(addDays(THIS_MONDAY, -4), 16, 0, 'Hent recept på apoteket', { status: 'missed', assignee: 'S', category: 'køb' });
  oneoff(addDays(THIS_MONDAY, 11), 16, 0, 'Hent recept på apoteket', { category: 'køb' });
  oneoff(addDays(THIS_MONDAY, -9), 10, 0, 'Bestil ny recept hos egen læge', { category: 'telefonopkald' });
  oneoff(addDays(THIS_MONDAY, 4), 15, 0, 'Køb hudplejemidler til E', { category: 'køb' });
  oneoff(addDays(THIS_MONDAY, 9), 13, 30, 'Ring til hjemmeplejen om aflastning', { category: 'telefonopkald' });

  // Today-anchored extras, so the "I dag" view always shows a spread
  // of categories regardless of which weekday it is.
  var TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
  oneoff(TODAY, 11, 30, 'Ring til apoteket om E’s recept', { category: 'telefonopkald' });
  oneoff(TODAY, 15, 0, 'Køb ind til E', { category: 'køb' });
  oneoff(TODAY, 17, 0, 'Planlæg næste uges kørsel til aftaler', { category: 'planlæg' });

  // --- Watch items: exactly two generic placeholders ----------------------
  push({
    title: 'Hold øje med E’s appetit',
    taskType: 'watch',
    assignee: 'J',
    status: 'pending',
    start: null,
    end: null,
    notes: 'Skriv ned, hvis E spiser tydeligt mindre end normalt.',
    category: 'andet'
  });
  push({
    title: 'Følg op på henvisning',
    taskType: 'watch',
    assignee: 'S',
    status: 'pending',
    start: dateStr(addDays(THIS_MONDAY, 9)), // date-only: watch item with a due date
    end: null,
    notes: 'Henvisningen til fysioterapi – ring hvis der stadig intet svar er.',
    category: 'telefonopkald'
  });

  window.CareLoadMock = {
    members: members,
    tasks: tasks,
    WINDOW_START: WINDOW_START,
    WINDOW_END: WINDOW_END
  };
})();
