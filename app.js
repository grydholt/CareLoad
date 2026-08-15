/*
 * CareLoad prototype — views, state and rendering.
 *
 * Everything is in-memory: page reload resets to the mock data.
 * The only data source is window.CareLoadMock (see mock-data.js),
 * which is the single file meant to be replaced by real API calls.
 */
(function () {
  'use strict';

  var MOCK = window.CareLoadMock;
  var MS_DAY = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------
  // Danish labels
  // ---------------------------------------------------------------------
  var DAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
  var DAYS_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
  var MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni',
    'juli', 'august', 'september', 'oktober', 'november', 'december'];
  var TYPE_LABELS = { oneoff: 'Enkelt', recurring: 'Gentaget', appointment: 'Aftale', watch: 'Husk' };
  var STATUS_LABELS = { pending: 'Afventer', done: 'Færdig', missed: 'Forsinket' };
  // Fixed category order used by the "I dag" view and the detail sheet.
  var CATEGORIES = [
    { id: 'medicin', label: 'Medicin' },
    { id: 'telefonopkald', label: 'Telefonopkald' },
    { id: 'aftale', label: 'Aftale' },
    { id: 'planlæg', label: 'Planlæg' },
    { id: 'køb', label: 'Køb' },
    { id: 'andet', label: 'Andet' }
  ];
  var CATEGORY_LABELS = {};
  CATEGORIES.forEach(function (c) { CATEGORY_LABELS[c.id] = c.label; });
  function categoryOf(t) { return CATEGORY_LABELS[t.category] ? t.category : 'andet'; }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    tasks: MOCK.tasks.map(function (t) { return Object.assign({}, t); }),
    view: 'kalender',
    calMode: 'dag', // Kalender subview: 'dag' | 'uge' | 'maaned'
    viewingAs: 'all', // 'all' or a member id; a member id filters every view
    dayAnchor: startOfDay(new Date()),
    weekStart: startOfWeek(new Date()),
    monthAnchor: firstOfMonth(new Date()),
    openSheet: null,   // null | 'detail' | 'new'
    detailId: null,
    // Week-view category toggles. Medicin is off by default so the
    // many daily medication instances don't drown out the rest.
    weekCats: {}
  };
  CATEGORIES.forEach(function (c) { state.weekCats[c.id] = c.id !== 'medicin'; });
  var newTaskCounter = 0;

  var memberById = {};
  MOCK.members.forEach(function (m) { memberById[m.id] = m; });

  // The tasks every view works from: all of them, or only the selected
  // carer's when a specific person is chosen in the header switcher.
  function visibleTasks() {
    if (state.viewingAs === 'all') return state.tasks;
    return state.tasks.filter(function (t) { return t.assignee === state.viewingAs; });
  }

  // ---------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  function startOfWeek(date) {
    var d = startOfDay(date);
    return addDays(d, -((d.getDay() + 6) % 7));
  }
  function firstOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseLocal(s) {
    if (!s) return null;
    var parts = s.split('T');
    var dp = parts[0].split('-').map(Number);
    if (parts.length === 1) return new Date(dp[0], dp[1] - 1, dp[2]);
    var tp = parts[1].split(':').map(Number);
    return new Date(dp[0], dp[1] - 1, dp[2], tp[0], tp[1]);
  }
  function isDateOnly(s) { return typeof s === 'string' && s.length === 10; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function isToday(d) { return sameDay(d, new Date()); }
  function isoWeek(d) {
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3);
    var firstThursday = new Date(date.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
    return 1 + Math.round((date - firstThursday) / (7 * MS_DAY));
  }

  function fmtTime(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDate(d) { return d.getDate() + '. ' + MONTHS[d.getMonth()]; }
  function fmtDateFull(d) { return DAYS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + '. ' + MONTHS[d.getMonth()]; }
  function weekLabel(ws) {
    var we = addDays(ws, 6);
    var range;
    if (ws.getMonth() === we.getMonth()) {
      range = ws.getDate() + '.–' + we.getDate() + '. ' + MONTHS[ws.getMonth()];
    } else {
      range = ws.getDate() + '. ' + MONTHS[ws.getMonth()] + ' – ' + we.getDate() + '. ' + MONTHS[we.getMonth()];
    }
    return 'Uge ' + isoWeek(ws) + ' · ' + range + ' ' + we.getFullYear();
  }

  // When (which day) does a task belong to? null for undated watch items.
  function taskDate(t) { return t.start ? parseLocal(t.start) : null; }

  function taskTimeText(t) {
    if (!t.start) return 'Ingen fast dato';
    if (isDateOnly(t.start)) return 'Senest ' + fmtDateFull(parseLocal(t.start));
    var s = parseLocal(t.start);
    var text = fmtDateFull(s) + ' · ' + fmtTime(s);
    if (t.end) text += '–' + fmtTime(parseLocal(t.end));
    return text;
  }

  // ---------------------------------------------------------------------
  // Small rendering helpers
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function memberStyle(id) {
    var m = memberById[id];
    if (!m) return '';
    return '--mc:' + m.color + ';--mt:' + m.tint + ';';
  }
  function avatar(id) {
    return '<span class="avatar" style="' + memberStyle(id) + '" aria-hidden="true">' + esc(id) + '</span>';
  }
  function otherMember(id) {
    var other = MOCK.members.find(function (m) { return m.id !== id; });
    return other ? other.id : id;
  }
  function statusMarker(t) {
    if (t.status === 'done') return '<span class="check" aria-hidden="true">✓</span>';
    if (t.status === 'missed') return '<span class="badge-missed">! Forsinket</span>';
    return '';
  }

  function taskCard(t, opts) {
    opts = opts || {};
    var classes = ['task', 'status-' + t.status];
    if (t.taskType === 'watch') classes.push('watch');
    if (t.assignee === state.viewingAs) classes.push('mine');
    var timeText = '';
    if (opts.showTime !== false && t.start && !isDateOnly(t.start)) {
      timeText = '<span class="task-time">' + fmtTime(parseLocal(t.start)) + '</span>';
    }
    return '<button type="button" class="' + classes.join(' ') + '" style="' + memberStyle(t.assignee) + '"' +
      ' data-action="open-task" data-id="' + esc(t.id) + '"' +
      ' aria-label="' + esc(t.title) + ', ' + esc(memberById[t.assignee] ? memberById[t.assignee].name : t.assignee) +
      ', ' + esc(STATUS_LABELS[t.status]) + '">' +
      timeText +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      statusMarker(t) +
      avatar(t.assignee) +
      '</button>';
  }

  // ---------------------------------------------------------------------
  // View: Uge (week)
  // ---------------------------------------------------------------------
  function weekNav() {
    return '<div class="week-nav">' +
      '<button type="button" class="btn-icon" data-action="prev-week" aria-label="Forrige uge">‹</button>' +
      '<h2 class="week-label">' + esc(weekLabel(state.weekStart)) + '</h2>' +
      '<button type="button" class="btn-icon" data-action="next-week" aria-label="Næste uge">›</button>' +
      '<button type="button" class="btn btn-small" data-action="today">I dag</button>' +
      '</div>';
  }

  // Dated watch items appear on their due day like other tasks
  // (the dedicated "Husk" shelf is gone); undated ones only in "I dag".
  function tasksOnDay(day) {
    return visibleTasks()
      .filter(function (t) {
        var d = taskDate(t);
        return d && sameDay(d, day);
      })
      .sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  }

  function categoryPills() {
    var pills = CATEGORIES.map(function (c) {
      return '<button type="button" class="pill" aria-pressed="' + (state.weekCats[c.id] ? 'true' : 'false') + '"' +
        ' data-action="toggle-cat" data-cat="' + esc(c.id) + '">' + esc(c.label) + '</button>';
    }).join('');
    return '<div class="cat-pills" role="group" aria-label="Kategorier">' + pills + '</div>';
  }

  function renderWeek() {
    var days = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(state.weekStart, i);
      var list = tasksOnDay(day).filter(function (t) {
        return state.weekCats[categoryOf(t)];
      });
      var cards = list.length
        ? list.map(function (t) { return taskCard(t); }).join('')
        : '<p class="empty-day">Ingen opgaver</p>';
      days += '<section class="day' + (isToday(day) ? ' today' : '') + '">' +
        '<h3 class="day-head"><span class="day-name">' + DAYS[i] + '</span>' +
        '<span class="day-date">' + day.getDate() + '.</span>' +
        (isToday(day) ? '<span class="today-tag">i dag</span>' : '') +
        '</h3><div class="day-tasks">' + cards + '</div></section>';
    }
    return weekNav() + categoryPills() + '<div class="week-days">' + days + '</div>';
  }

  // ---------------------------------------------------------------------
  // Kalender subview: Dag (one day's tasks grouped by category)
  // ---------------------------------------------------------------------
  function renderDay() {
    var day = state.dayAnchor;
    // The day's dated tasks, plus undated watch items when looking at
    // today ("keep in mind" has no due date, so it belongs to now).
    var list = tasksOnDay(day);
    if (isToday(day)) {
      list = visibleTasks().filter(function (t) { return !t.start; }).concat(list);
    }
    var groups = CATEGORIES.map(function (c) {
      var items = list.filter(function (t) { return categoryOf(t) === c.id; });
      if (!items.length) return ''; // skip empty categories
      return '<section class="cat-group">' +
        '<h3 class="cat-head">' + esc(c.label) + ' <span class="count">' + items.length + '</span></h3>' +
        items.map(function (t) { return taskCard(t); }).join('') +
        '</section>';
    }).join('');

    var body = groups ||
      '<div class="empty-state"><p>Ingen opgaver denne dag' +
      (state.viewingAs !== 'all' ? ' for ' + esc(state.viewingAs) : '') + '.</p></div>';

    var label = fmtDateFull(day) +
      (isToday(day) ? ' <span class="today-tag">i dag</span>' : '');

    return '<div class="week-nav">' +
      '<button type="button" class="btn-icon" data-action="prev-day" aria-label="Forrige dag">‹</button>' +
      '<h2 class="week-label day-label">' + label + '</h2>' +
      '<button type="button" class="btn-icon" data-action="next-day" aria-label="Næste dag">›</button>' +
      '<button type="button" class="btn btn-small" data-action="today">I dag</button>' +
      '</div>' +
      '<div class="today-groups">' + body + '</div>';
  }

  // ---------------------------------------------------------------------
  // View: Kalender (sub-menu bar switching between Dag / Uge / Måned)
  // ---------------------------------------------------------------------
  var CAL_MODES = [
    { id: 'dag', label: 'Dag' },
    { id: 'uge', label: 'Uge' },
    { id: 'maaned', label: 'Måned' }
  ];

  function renderKalender() {
    var subtabs = CAL_MODES.map(function (m) {
      return '<button type="button" class="pill subtab" aria-pressed="' + (state.calMode === m.id ? 'true' : 'false') + '"' +
        ' data-action="set-calmode" data-mode="' + m.id + '">' + m.label + '</button>';
    }).join('');
    var body = state.calMode === 'dag' ? renderDay()
      : state.calMode === 'uge' ? renderWeek()
      : renderMonth();
    return '<div class="subtabs" role="group" aria-label="Kalendervisning">' + subtabs + '</div>' + body;
  }

  // ---------------------------------------------------------------------
  // View: Indstillinger (settings)
  // ---------------------------------------------------------------------
  function renderSettings() {
    var pills = [{ id: 'all', label: 'Alle' }].concat(MOCK.members).map(function (m) {
      return '<button type="button" class="pill" aria-pressed="' + (state.viewingAs === m.id ? 'true' : 'false') + '"' +
        ' data-action="set-viewas" data-id="' + esc(m.id) + '">' +
        esc(m.label || m.name) + '</button>';
    }).join('');
    return '<h2 class="view-title">Indstillinger</h2>' +
      '<section class="settings-group">' +
      '<h3 class="cat-head">Vis opgaver for</h3>' +
      '<div class="cat-pills" role="group" aria-label="Vis opgaver for">' + pills + '</div>' +
      '<p class="view-sub">Valget filtrerer alle visninger til den valgte person.</p>' +
      '</section>' +
      '<section class="settings-group">' +
      '<h3 class="cat-head">Om prototypen</h3>' +
      '<p class="view-sub">Alle opgaver er testdata. Ændringer gemmes ikke og nulstilles, når siden genindlæses.</p>' +
      '</section>';
  }

  // ---------------------------------------------------------------------
  // View: Person (per-member workload for the selected week)
  // ---------------------------------------------------------------------
  function tasksInWeek() {
    var ws = state.weekStart;
    var we = addDays(ws, 7);
    return visibleTasks().filter(function (t) {
      var d = taskDate(t);
      return d && d >= ws && d < we;
    });
  }

  function renderPerson() {
    var weekTasks = tasksInWeek();
    var shownMembers = state.viewingAs === 'all'
      ? MOCK.members
      : MOCK.members.filter(function (m) { return m.id === state.viewingAs; });
    var summary = shownMembers.map(function (m) {
      var n = weekTasks.filter(function (t) { return t.assignee === m.id; }).length;
      return '<span class="summary-part" style="' + memberStyle(m.id) + '">' + avatar(m.id) + ' ' + n + ' opgaver</span>';
    }).join('');

    var cards = shownMembers.map(function (m) {
      var mine = weekTasks
        .filter(function (t) { return t.assignee === m.id; })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      var groups = ['pending', 'missed', 'done'].map(function (status) {
        var items = mine.filter(function (t) { return t.status === status; });
        var rows = items.length
          ? items.map(function (t) {
              var d = parseLocal(t.start);
              var when = DAYS_SHORT[(d.getDay() + 6) % 7] + (isDateOnly(t.start) ? '' : ' ' + fmtTime(d));
              return '<li><button type="button" class="person-row status-' + t.status + '"' +
                ' data-action="open-task" data-id="' + esc(t.id) + '">' +
                '<span class="row-when">' + when + '</span>' +
                '<span class="task-title">' + esc(t.title) + '</span>' +
                statusMarker(t) + '</button></li>';
            }).join('')
          : '<li class="empty-row">Ingen</li>';
        return '<section class="person-group group-' + status + '">' +
          '<h4>' + STATUS_LABELS[status] + ' <span class="count">' + items.length + '</span></h4>' +
          '<ul>' + rows + '</ul></section>';
      }).join('');
      var isMe = m.id === state.viewingAs;
      return '<article class="person-card' + (isMe ? ' mine' : '') + '" style="' + memberStyle(m.id) + '">' +
        '<header class="person-head">' + avatar(m.id) +
        '<h3>' + esc(m.name) + (isMe ? ' <span class="me-tag">dig</span>' : '') + '</h3>' +
        '<span class="person-total">' + mine.length + ' opgaver i alt</span></header>' +
        groups + '</article>';
    }).join('');

    return weekNav() +
      '<p class="week-summary">Denne uge: ' + summary + '</p>' +
      '<div class="person-cards">' + cards + '</div>';
  }

  // ---------------------------------------------------------------------
  // View: Forsinket (missed list)
  // ---------------------------------------------------------------------
  function renderMissed() {
    var missed = visibleTasks()
      .filter(function (t) { return t.status === 'missed'; })
      .sort(function (a, b) {
        var da = a.start || '';
        var db = b.start || '';
        return da < db ? -1 : da > db ? 1 : 0;
      });
    if (!missed.length) {
      return '<div class="empty-state"><p>Ingenting er forsinket. Godt gået!</p></div>';
    }
    var rows = missed.map(function (t) {
      var when = t.start ? (isDateOnly(t.start) ? 'Skulle være gjort senest ' + fmtDate(parseLocal(t.start))
        : 'Skulle være gjort ' + fmtDate(parseLocal(t.start)) + ' kl. ' + fmtTime(parseLocal(t.start))) : '';
      var other = otherMember(t.assignee);
      return '<li class="missed-item" style="' + memberStyle(t.assignee) + '">' +
        '<button type="button" class="missed-main" data-action="open-task" data-id="' + esc(t.id) + '">' +
        avatar(t.assignee) +
        '<span class="missed-text"><span class="task-title">' + esc(t.title) + '</span>' +
        '<span class="missed-when">' + esc(when) + '</span></span></button>' +
        '<span class="missed-actions">' +
        '<button type="button" class="btn btn-small" data-action="done" data-id="' + esc(t.id) + '">Færdig</button>' +
        '<button type="button" class="btn btn-small" data-action="reassign" data-id="' + esc(t.id) + '" data-to="' + esc(other) + '">Giv videre til ' + esc(other) + '</button>' +
        '</span></li>';
    }).join('');
    return '<h2 class="view-title">Forsinkede opgaver</h2>' +
      '<p class="view-sub">Ældste først – marker som færdig, eller giv videre.</p>' +
      '<ul class="missed-list">' + rows + '</ul>';
  }

  // ---------------------------------------------------------------------
  // View: Måned (month)
  // ---------------------------------------------------------------------
  function renderMonth() {
    var anchor = state.monthAnchor;
    var gridStart = startOfWeek(anchor);
    var lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    var byDay = {};
    visibleTasks().forEach(function (t) {
      var d = taskDate(t);
      if (!d) return;
      var k = dateKey(d);
      (byDay[k] = byDay[k] || []).push(t);
    });

    var heads = DAYS_SHORT.map(function (d) { return '<span class="month-dow">' + d + '</span>'; }).join('');
    var cells = '';
    for (var d = gridStart; ; d = addDays(d, 1)) {
      if (d > lastOfMonth && (d.getDay() + 6) % 7 === 0) break;
      var inMonth = d.getMonth() === anchor.getMonth();
      var list = byDay[dateKey(d)] || [];
      var dots = list.slice(0, 6).map(function (t) {
        return '<span class="dot' + (t.status === 'done' ? ' dot-done' : '') + '" style="' + memberStyle(t.assignee) + '"></span>';
      }).join('');
      var more = list.length > 6 ? '<span class="dot-more">+' + (list.length - 6) + '</span>' : '';
      cells += '<button type="button" class="month-cell' + (inMonth ? '' : ' outside') + (isToday(d) ? ' today' : '') + '"' +
        ' data-action="pick-day" data-date="' + dateKey(d) + '"' +
        ' aria-label="' + esc(fmtDateFull(d)) + ', ' + list.length + ' opgaver">' +
        '<span class="month-daynum">' + d.getDate() + '</span>' +
        '<span class="dots">' + dots + more + '</span></button>';
    }

    return '<div class="week-nav">' +
      '<button type="button" class="btn-icon" data-action="prev-month" aria-label="Forrige måned">‹</button>' +
      '<h2 class="week-label">' + MONTHS[anchor.getMonth()] + ' ' + anchor.getFullYear() + '</h2>' +
      '<button type="button" class="btn-icon" data-action="next-month" aria-label="Næste måned">›</button>' +
      '</div>' +
      '<p class="view-sub">Tryk på en dag for at se den i dagsvisningen.</p>' +
      '<div class="month-grid"><div class="month-head">' + heads + '</div><div class="month-cells">' + cells + '</div></div>';
  }

  // ---------------------------------------------------------------------
  // Detail sheet
  // ---------------------------------------------------------------------
  function renderDetail(t) {
    var m = memberById[t.assignee];
    var other = otherMember(t.assignee);
    var meta = [];
    meta.push('<p class="detail-meta"><strong>Type:</strong> ' + TYPE_LABELS[t.taskType] +
      (t.recurrenceLabel ? ' · ' + esc(t.recurrenceLabel) : '') + '</p>');
    meta.push('<p class="detail-meta"><strong>Kategori:</strong> ' + CATEGORY_LABELS[categoryOf(t)] + '</p>');
    meta.push('<p class="detail-meta"><strong>Hvornår:</strong> ' + esc(taskTimeText(t)) + '</p>');
    if (t.location) meta.push('<p class="detail-meta"><strong>Sted:</strong> ' + esc(t.location) + '</p>');
    if (t.notes) meta.push('<p class="detail-meta"><strong>Noter:</strong> ' + esc(t.notes) + '</p>');

    var actions = '';
    if (t.status !== 'done') {
      actions += '<button type="button" class="btn btn-primary" data-action="done" data-id="' + esc(t.id) + '">Færdig</button>';
    }
    if (t.status !== 'pending') {
      actions += '<button type="button" class="btn" data-action="reopen" data-id="' + esc(t.id) + '">Genåbn</button>';
    }
    actions += '<button type="button" class="btn" data-action="reassign" data-id="' + esc(t.id) + '" data-to="' + esc(other) + '">Giv videre til ' + esc(other) + '</button>';
    actions += '<button type="button" class="btn btn-danger" data-action="delete" data-id="' + esc(t.id) + '">Slet</button>';

    return '<div class="sheet-head">' +
      '<h2 id="detail-title" class="sheet-title">' + esc(t.title) + '</h2>' +
      '<button type="button" class="btn-icon" data-action="close-sheet" aria-label="Luk">✕</button></div>' +
      '<p class="detail-owner" style="' + memberStyle(t.assignee) + '">' + avatar(t.assignee) +
      ' Ansvarlig: <strong>' + esc(m ? m.name : t.assignee) + '</strong>' +
      ' <span class="status-pill status-' + t.status + '">' + STATUS_LABELS[t.status] + '</span></p>' +
      meta.join('') +
      '<div class="sheet-actions">' + actions + '</div>';
  }

  // ---------------------------------------------------------------------
  // Sheets (open/close)
  // ---------------------------------------------------------------------
  var backdrop = document.getElementById('backdrop');
  var detailSheet = document.getElementById('detail-sheet');
  var newSheet = document.getElementById('new-sheet');
  var newForm = document.getElementById('new-task-form');

  function openDetail(id) {
    state.detailId = id;
    state.openSheet = 'detail';
    syncSheets();
  }
  function openNew() {
    state.openSheet = 'new';
    newForm.reset();
    document.getElementById('nt-assignee').value =
      state.viewingAs !== 'all' ? state.viewingAs : MOCK.members[0].id;
    document.getElementById('nt-date').value = dateKey(new Date());
    document.getElementById('nt-time').value = '12:00';
    document.getElementById('new-form-error').hidden = true;
    updateNewFormVisibility();
    syncSheets();
    document.getElementById('nt-title').focus();
  }
  function closeSheet() {
    state.openSheet = null;
    state.detailId = null;
    syncSheets();
  }
  function syncSheets() {
    var open = state.openSheet;
    backdrop.hidden = !open;
    detailSheet.hidden = open !== 'detail';
    newSheet.hidden = open !== 'new';
    document.body.classList.toggle('sheet-open', !!open);
    if (open === 'detail') {
      var t = findTask(state.detailId);
      if (t) {
        document.getElementById('detail-content').innerHTML = renderDetail(t);
      } else {
        closeSheet();
      }
    }
  }

  // ---------------------------------------------------------------------
  // New task form
  // ---------------------------------------------------------------------
  function updateNewFormVisibility() {
    var type = newForm.elements.taskType.value;
    var recurrence = newForm.elements.recurrence.value;
    document.getElementById('row-time').hidden = type === 'watch';
    document.getElementById('row-recurrence').hidden = type !== 'recurring';
    document.getElementById('row-weekdays').hidden = type !== 'recurring' || recurrence !== 'weekly';
    document.getElementById('row-location').hidden = type !== 'appointment';
    document.getElementById('hint-watch-date').hidden = type !== 'watch';
  }

  function submitNewTask() {
    var errorEl = document.getElementById('new-form-error');
    var title = newForm.elements.title.value.trim();
    var type = newForm.elements.taskType.value;
    var assignee = newForm.elements.assignee.value;
    var dateVal = newForm.elements.date.value;
    var timeVal = newForm.elements.time.value || '12:00';

    function fail(msg) { errorEl.textContent = msg; errorEl.hidden = false; }

    if (!title) return fail('Skriv en titel til opgaven.');
    if (!assignee) return fail('Vælg hvem der er ansvarlig.');
    if (type !== 'watch' && !dateVal) return fail('Vælg en dato.');

    var base = {
      taskType: type,
      assignee: assignee,
      status: 'pending',
      category: newForm.elements.category.value,
      location: type === 'appointment' ? (newForm.elements.location.value.trim() || null) : null,
      notes: newForm.elements.notes.value.trim(),
      recurrenceLabel: null
    };

    function makeId() { return 'n-' + (++newTaskCounter); }
    function instance(dayKeyStr) {
      var startStr, endStr = null;
      if (type === 'watch') {
        startStr = dayKeyStr || null;
      } else {
        startStr = dayKeyStr + 'T' + timeVal;
        var s = parseLocal(startStr);
        var e = new Date(s.getTime() + (type === 'appointment' ? 60 : 30) * 60000);
        endStr = dateKey(e) + 'T' + fmtTime(e);
      }
      return Object.assign({ id: makeId(), title: title, start: startStr, end: endStr }, base);
    }

    var created = [];
    if (type === 'recurring') {
      var preset = newForm.elements.recurrence.value;
      var chosen = [];
      if (preset === 'weekly') {
        newForm.querySelectorAll('input[name="weekday"]:checked').forEach(function (cb) {
          chosen.push(Number(cb.value));
        });
        if (!chosen.length) return fail('Vælg mindst én ugedag.');
      }
      var labels = { daily: 'Hver dag', weekdays: 'Hverdage' };
      base.recurrenceLabel = preset === 'weekly'
        ? 'Ugentligt: ' + chosen.map(function (i) { return DAYS_SHORT[i]; }).join(', ')
        : labels[preset];

      // Generate concrete instances across the visible mock window,
      // starting no earlier than the chosen date.
      var from = parseLocal(dateVal);
      if (from < MOCK.WINDOW_START) from = MOCK.WINDOW_START;
      for (var d = from; d <= MOCK.WINDOW_END; d = addDays(d, 1)) {
        var dow = (d.getDay() + 6) % 7;
        if (preset === 'weekdays' && dow > 4) continue;
        if (preset === 'weekly' && chosen.indexOf(dow) === -1) continue;
        created.push(instance(dateKey(d)));
      }
      if (!created.length) return fail('Ingen dage matcher inden for den viste periode.');
    } else {
      created.push(instance(dateVal || null));
    }

    created.forEach(function (t) { state.tasks.push(t); });

    // Jump to the calendar so the new task is visible.
    var firstDated = created.find(function (t) { return t.start; });
    if (firstDated) {
      var d0 = parseLocal(firstDated.start);
      state.dayAnchor = startOfDay(d0);
      state.weekStart = startOfWeek(d0);
      state.monthAnchor = firstOfMonth(d0);
    } else {
      state.dayAnchor = startOfDay(new Date());
      state.calMode = 'dag'; // undated watch items show under today
    }
    state.view = 'kalender';
    closeSheet();
    render();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  function findTask(id) {
    return state.tasks.find(function (t) { return t.id === id; }) || null;
  }

  var actions = {
    'switch-view': function (el) { state.view = el.dataset.view; render(); },
    'set-calmode': function (el) { state.calMode = el.dataset.mode; render(); },
    'prev-day': function () { state.dayAnchor = addDays(state.dayAnchor, -1); render(); },
    'next-day': function () { state.dayAnchor = addDays(state.dayAnchor, 1); render(); },
    'prev-week': function () { state.weekStart = addDays(state.weekStart, -7); render(); },
    'next-week': function () { state.weekStart = addDays(state.weekStart, 7); render(); },
    'today': function () {
      state.dayAnchor = startOfDay(new Date());
      state.weekStart = startOfWeek(new Date());
      state.monthAnchor = firstOfMonth(new Date());
      render();
    },
    'prev-month': function () {
      state.monthAnchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() - 1, 1);
      render();
    },
    'next-month': function () {
      state.monthAnchor = new Date(state.monthAnchor.getFullYear(), state.monthAnchor.getMonth() + 1, 1);
      render();
    },
    'pick-day': function (el) {
      var d = parseLocal(el.dataset.date);
      state.dayAnchor = startOfDay(d);
      state.weekStart = startOfWeek(d);
      state.calMode = 'dag';
      state.view = 'kalender';
      render();
    },
    'toggle-cat': function (el) {
      var id = el.dataset.cat;
      state.weekCats[id] = !state.weekCats[id];
      render();
    },
    'set-viewas': function (el) {
      state.viewingAs = el.dataset.id;
      render(); // every view filters to the selected carer
    },
    'open-task': function (el) { openDetail(el.dataset.id); },
    'open-new': function () { openNew(); },
    'close-sheet': function () { closeSheet(); },
    'done': function (el) {
      var t = findTask(el.dataset.id);
      if (t) t.status = 'done';
      render();
      if (state.openSheet === 'detail') syncSheets();
    },
    'reopen': function (el) {
      var t = findTask(el.dataset.id);
      if (t) t.status = 'pending';
      render();
      if (state.openSheet === 'detail') syncSheets();
    },
    'reassign': function (el) {
      var t = findTask(el.dataset.id);
      if (t) t.assignee = el.dataset.to || otherMember(t.assignee);
      render();
      if (state.openSheet === 'detail') syncSheets();
    },
    'delete': function (el) {
      var id = el.dataset.id;
      state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
      closeSheet();
      render();
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var handler = actions[el.dataset.action];
    if (handler) handler(el);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.openSheet) closeSheet();
  });

  newForm.addEventListener('submit', function (e) {
    e.preventDefault();
    submitNewTask();
  });
  newForm.addEventListener('change', function (e) {
    if (e.target.name === 'taskType' || e.target.name === 'recurrence') updateNewFormVisibility();
    // Choosing the appointment type suggests the matching category.
    if (e.target.name === 'taskType' && e.target.value === 'appointment') {
      newForm.elements.category.value = 'aftale';
    }
  });

  // ---------------------------------------------------------------------
  // Header setup + main render
  // ---------------------------------------------------------------------
  function populateSelect(select) {
    select.innerHTML = MOCK.members.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
    }).join('');
  }
  populateSelect(document.getElementById('nt-assignee'));

  var VIEWS = {
    kalender: renderKalender,
    person: renderPerson,
    forsinket: renderMissed,
    indstillinger: renderSettings
  };

  function render() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      var active = tab.dataset.view === state.view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });
    var missedCount = visibleTasks().filter(function (t) { return t.status === 'missed'; }).length;
    var countEl = document.getElementById('missed-count');
    countEl.textContent = missedCount;
    countEl.hidden = missedCount === 0;

    document.getElementById('app').innerHTML = VIEWS[state.view]();
  }

  render();
})();
