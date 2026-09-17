(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Konfigurasjon: enhetstyper, størrelser og omregningsfaktor til
  // "antall 0,5 L øl (4,7 %)" — dette er referanseenheten appen bruker.
  //
  // Øl og vin regnes proporsjonalt ut fra volum (samme alkoholprosent
  // innad i typen). Drink og shot er satt til 1,0 (samme konvensjon som
  // "en alkoholenhet" i norske retningslinjer: ca. 1 pils = 1 glass vin
  // = 1 drink = 1 dram). Juster ITEMS under om du vil ha andre faktorer.
  // ---------------------------------------------------------------------
  var ITEMS = [
    { id: "ol_033", group: "ol", label: "0,33 L", icon: "🍺", factor: 0.66 },
    { id: "ol_04", group: "ol", label: "0,4 L", icon: "🍺", factor: 0.8 },
    { id: "ol_05", group: "ol", label: "0,5 L", icon: "🍺", factor: 1.0 },
    { id: "vin_25", group: "vin", label: "2,5 dl", icon: "🍷", factor: 1.0 },
    { id: "vin_75", group: "vin", label: "7,5 dl", icon: "🍷", factor: 3.0 },
    { id: "drink", group: "drink", label: "Drink", icon: "🍹", factor: 1.0 },
    { id: "shot", group: "shot", label: "Shot (4 cl)", icon: "🥃", factor: 1.0 }
  ];

  var GROUP_ORDER = ["ol", "vin", "drink", "shot"];

  var STORAGE_KEY = "enhetsteller_v1";
  var DEVICE_KEY = "enhetsteller_device_id";
  var NAME_KEY = "enhetsteller_name";

  // ---------------------------------------------------------------------
  // Anonym enhets-ID: genereres én gang og lagres lokalt. Serveren bruker
  // denne til å skille data mellom ulike personer/telefoner — ingen
  // pålogging. Slettes lokal nettleserdata, mister man koblingen til det
  // som ligger lagret på serveren fra før (ny, tom ID genereres).
  // ---------------------------------------------------------------------
  function makeFallbackId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : makeFallbackId();
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return makeFallbackId();
    }
  }

  var deviceId = getDeviceId();

  // ---------------------------------------------------------------------
  // Datalag: localStorage brukes som en lokal, øyeblikkelig og
  // offline-vennlig kopi. Den ekte kilden til sannhet er Postgres-
  // databasen på serveren (se server.js) — appen henter derfra ved
  // oppstart og skriver dit i bakgrunnen ved hver endring.
  // Struktur: { "YYYY-MM-DD": { ol_033: 2, vin_25: 1, ... } }
  // ---------------------------------------------------------------------
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("Kunne ikke lese lagrede data, starter tomt.", e);
      return {};
    }
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Kunne ikke lagre data.", e);
    }
  }

  function syncFromServer() {
    return fetch("/api/entries?device=" + encodeURIComponent(deviceId))
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (serverData) {
        data = serverData || {};
        saveData(data);
        return true;
      })
      .catch(function (e) {
        console.warn("Kunne ikke hente data fra serveren, bruker lokal kopi.", e);
        return false;
      });
  }

  function pushToServer(dateKey, itemId, count) {
    fetch("/api/entries", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: deviceId, date: dateKey, itemId: itemId, count: count })
    }).catch(function (e) {
      console.warn("Kunne ikke lagre til serveren (lagret lokalt i mellomtiden).", e);
    });
  }

  var data = loadData();

  // ---------------------------------------------------------------------
  // Navn (for resultattavlen) — samme mønster som enheter: lokal kopi for
  // øyeblikkelig visning, servert lagres i players-tabellen.
  // ---------------------------------------------------------------------
  function getLocalName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function setLocalName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch (e) {
      console.warn("Kunne ikke lagre navn lokalt.", e);
    }
  }

  function fetchNameFromServer() {
    return fetch("/api/player?device=" + encodeURIComponent(deviceId))
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (body) {
        if (body && body.name) {
          setLocalName(body.name);
          return body.name;
        }
        return getLocalName();
      })
      .catch(function (e) {
        console.warn("Kunne ikke hente navn fra serveren, bruker lokal kopi.", e);
        return getLocalName();
      });
  }

  function saveNameToServer(name) {
    return fetch("/api/player", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: deviceId, name: name })
    }).then(function (res) {
      if (!res.ok) throw new Error("status " + res.status);
      return true;
    });
  }

  function fetchScoreboard() {
    return fetch("/api/scoreboard")
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .catch(function (e) {
        console.warn("Kunne ikke hente resultattavlen.", e);
        return null;
      });
  }

  function todayKey() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function getDayRecord(key) {
    return data[key] || {};
  }

  function setCount(key, itemId, value) {
    if (!data[key]) data[key] = {};
    if (value <= 0) {
      delete data[key][itemId];
      if (Object.keys(data[key]).length === 0) delete data[key];
    } else {
      data[key][itemId] = value;
    }
    saveData(data);
    pushToServer(key, itemId, Math.max(0, value));
  }

  function changeCount(key, itemId, delta) {
    var rec = getDayRecord(key);
    var current = rec[itemId] || 0;
    var next = Math.max(0, current + delta);
    setCount(key, itemId, next);
  }

  function dayTotals(rec) {
    var count = 0;
    var units = 0;
    ITEMS.forEach(function (item) {
      var n = rec[item.id] || 0;
      count += n;
      units += n * item.factor;
    });
    return { count: count, units: units };
  }

  function formatUnits(n) {
    // Vis maks 1 desimal, uten unødvendig ",0"
    var rounded = Math.round(n * 10) / 10;
    return rounded % 1 === 0 ? String(rounded) : String(rounded).replace(".", ",");
  }

  // ---------------------------------------------------------------------
  // Dato-formatering (norsk)
  // ---------------------------------------------------------------------
  var MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
  var WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];

  function parseKey(key) {
    var parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatLongDate(key) {
    var d = parseKey(key);
    var s = WEEKDAYS[d.getDay()] + " " + d.getDate() + ". " + MONTHS[d.getMonth()] + " " + d.getFullYear();
    return capitalize(s);
  }

  function formatDayHeading(key) {
    var tKey = todayKey();
    if (key === tKey) return "I dag";
    var yest = new Date();
    yest.setDate(yest.getDate() - 1);
    var yKey = yest.getFullYear() + "-" + String(yest.getMonth() + 1).padStart(2, "0") + "-" + String(yest.getDate()).padStart(2, "0");
    if (key === yKey) return "I går";
    return formatLongDate(key);
  }

  // ---------------------------------------------------------------------
  // Rendering: "I dag"
  // ---------------------------------------------------------------------
  var rowsContainers = {};
  GROUP_ORDER.forEach(function (g) {
    rowsContainers[g] = document.getElementById("rows-" + g);
  });

  function buildTodayRows() {
    GROUP_ORDER.forEach(function (g) {
      rowsContainers[g].innerHTML = "";
    });

    ITEMS.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "row";
      row.dataset.item = item.id;

      var icon = document.createElement("div");
      icon.className = "row-icon";
      icon.textContent = item.icon;

      var label = document.createElement("div");
      label.className = "row-label";
      label.textContent = item.label;

      var controls = document.createElement("div");
      controls.className = "row-controls";

      var minus = document.createElement("button");
      minus.className = "stepper-btn minus";
      minus.type = "button";
      minus.textContent = "–";
      minus.setAttribute("aria-label", "Trekk fra " + item.label);

      var countEl = document.createElement("span");
      countEl.className = "row-count";
      countEl.textContent = "0";

      var plus = document.createElement("button");
      plus.className = "stepper-btn plus";
      plus.type = "button";
      plus.textContent = "+";
      plus.setAttribute("aria-label", "Legg til " + item.label);

      minus.addEventListener("click", function () {
        changeCount(todayKey(), item.id, -1);
        renderToday();
      });
      plus.addEventListener("click", function () {
        changeCount(todayKey(), item.id, 1);
        renderToday();
      });

      controls.appendChild(minus);
      controls.appendChild(countEl);
      controls.appendChild(plus);

      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(controls);

      rowsContainers[item.group].appendChild(row);
    });
  }

  function renderToday() {
    var key = todayKey();
    var rec = getDayRecord(key);

    ITEMS.forEach(function (item) {
      var row = document.querySelector('.row[data-item="' + item.id + '"]');
      if (!row) return;
      var n = rec[item.id] || 0;
      row.querySelector(".row-count").textContent = n;
      var minusBtn = row.querySelector(".minus");
      minusBtn.disabled = n <= 0;
    });

    var totals = dayTotals(rec);
    document.getElementById("todayCount").textContent = totals.count;
    document.getElementById("todayUnits").textContent = formatUnits(totals.units);

    document.getElementById("dateLabel").textContent = formatLongDate(key);
  }

  // ---------------------------------------------------------------------
  // Rendering: "Oversikt"
  // ---------------------------------------------------------------------
  function renderOverview() {
    var keys = Object.keys(data).sort().reverse();
    var historyEl = document.getElementById("history");
    var emptyEl = document.getElementById("emptyHistory");
    historyEl.innerHTML = "";

    var grandCount = 0;
    var grandUnits = 0;

    keys.forEach(function (key) {
      var rec = data[key];
      var totals = dayTotals(rec);
      grandCount += totals.count;
      grandUnits += totals.units;

      var card = document.createElement("div");
      card.className = "day-card";

      var head = document.createElement("div");
      head.className = "day-card-head";

      var dateEl = document.createElement("div");
      dateEl.className = "day-date";
      dateEl.textContent = formatDayHeading(key);

      var unitsEl = document.createElement("div");
      unitsEl.className = "day-units";
      unitsEl.textContent = "≈ " + formatUnits(totals.units) + " × 0,5L øl";

      head.appendChild(dateEl);
      head.appendChild(unitsEl);

      var itemsEl = document.createElement("div");
      itemsEl.className = "day-items";

      ITEMS.forEach(function (item) {
        var n = rec[item.id] || 0;
        if (n <= 0) return;
        var pill = document.createElement("span");
        pill.className = "day-item-pill";
        pill.innerHTML = item.icon + " " + item.label + " &times; <b>" + n + "</b>";
        itemsEl.appendChild(pill);
      });

      card.appendChild(head);
      card.appendChild(itemsEl);
      historyEl.appendChild(card);
    });

    document.getElementById("grandCount").textContent = grandCount;
    document.getElementById("grandUnits").textContent = formatUnits(grandUnits);
    document.getElementById("dayCountLabel").textContent = keys.length + (keys.length === 1 ? " dag" : " dager");

    emptyEl.classList.toggle("hidden", keys.length > 0);
    historyEl.classList.toggle("hidden", keys.length === 0);
  }

  // ---------------------------------------------------------------------
  // Rendering: "Resultattavle" (side 3)
  // ---------------------------------------------------------------------
  var nameInput = document.getElementById("nameInput");
  var saveNameBtn = document.getElementById("saveNameBtn");
  var nameStatus = document.getElementById("nameStatus");

  function renderScoreboard() {
    nameInput.value = getLocalName();

    var listEl = document.getElementById("scoreboard");
    var emptyEl = document.getElementById("emptyScoreboard");
    var myName = getLocalName().trim().toLowerCase();

    fetchScoreboard().then(function (rows) {
      if (!rows) {
        listEl.innerHTML = "";
        listEl.classList.add("hidden");
        emptyEl.textContent = "Fikk ikke hentet resultattavlen akkurat nå. Prøv igjen senere.";
        emptyEl.classList.remove("hidden");
        return;
      }

      listEl.innerHTML = "";

      if (rows.length === 0) {
        listEl.classList.add("hidden");
        emptyEl.textContent = "Ingen har lagt inn navnet sitt ennå. Skriv inn navnet ditt over for å komme på resultattavlen.";
        emptyEl.classList.remove("hidden");
        return;
      }

      listEl.classList.remove("hidden");
      emptyEl.classList.add("hidden");

      rows.forEach(function (row, i) {
        var rowEl = document.createElement("div");
        rowEl.className = "score-row";
        if (row.name && row.name.trim().toLowerCase() === myName) {
          rowEl.classList.add("is-me");
        }

        var rankEl = document.createElement("div");
        rankEl.className = "score-rank";
        rankEl.textContent = String(i + 1) + ".";

        var nameEl = document.createElement("div");
        nameEl.className = "score-name";
        nameEl.textContent = row.name;

        var unitsEl = document.createElement("div");
        unitsEl.className = "score-units";
        unitsEl.textContent = formatUnits(row.totalUnits) + " × 0,5L øl";

        rowEl.appendChild(rankEl);
        rowEl.appendChild(nameEl);
        rowEl.appendChild(unitsEl);
        listEl.appendChild(rowEl);
      });
    });
  }

  saveNameBtn.addEventListener("click", function () {
    var name = nameInput.value.trim();
    if (!name) {
      nameStatus.textContent = "Skriv inn et navn først.";
      return;
    }
    setLocalName(name);
    nameStatus.textContent = "Lagrer …";
    saveNameToServer(name)
      .then(function () {
        nameStatus.textContent = "Lagret!";
        renderScoreboard();
      })
      .catch(function (e) {
        console.warn("Kunne ikke lagre navn til serveren.", e);
        nameStatus.textContent = "Lagret lokalt, men fikk ikke sendt til serveren. Prøv igjen senere.";
      });
  });

  // ---------------------------------------------------------------------
  // Faner
  // ---------------------------------------------------------------------
  var tabs = document.querySelectorAll(".tab");
  var viewToday = document.getElementById("view-today");
  var viewOverview = document.getElementById("view-overview");
  var viewScoreboard = document.getElementById("view-scoreboard");
  var pageTitle = document.getElementById("pageTitle");
  var dateLabel = document.getElementById("dateLabel");

  function activateTab(name) {
    tabs.forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    viewToday.classList.add("hidden");
    viewOverview.classList.add("hidden");
    viewScoreboard.classList.add("hidden");
    dateLabel.classList.add("hidden");

    if (name === "today") {
      viewToday.classList.remove("hidden");
      pageTitle.textContent = "I dag";
      dateLabel.classList.remove("hidden");
      renderToday();
    } else if (name === "overview") {
      viewOverview.classList.remove("hidden");
      pageTitle.textContent = "Oversikt";
      renderOverview();
    } else {
      viewScoreboard.classList.remove("hidden");
      pageTitle.textContent = "Resultattavle";
      renderScoreboard();
    }
  }

  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      activateTab(t.dataset.tab);
    });
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  buildTodayRows();
  activateTab("today"); // rask, øyeblikkelig visning fra lokal kopi

  // Hent siste data fra serveren (Postgres) og oppdater visningen når den kommer.
  syncFromServer().then(function () {
    var activeTab = document.querySelector(".tab.active").dataset.tab;
    activateTab(activeTab);
  });
  fetchNameFromServer();

  // Re-render "I dag" hvis appen har ligget åpen over midnatt / blitt hentet frem igjen
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      var activeTab = document.querySelector(".tab.active").dataset.tab;
      activateTab(activeTab);
    }
  });

  // ---------------------------------------------------------------------
  // Service worker (for offline-bruk etter første åpning)
  // ---------------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        console.warn("Service worker-registrering feilet:", e);
      });
    });
  }
})();
