"use strict";

const APP_VERSION = "1.2";

/* ---------- Feste Vorgaben (nicht ohne Rücksprache ändern) ---------- */
const MASCHINEN = ["Z49", "Z67", "Z68", "Z78", "Z82", "Z83"];
const STATUS = {
  produktion: { label: "Produktion", farbe: "green" },
  umbau:      { label: "Umbau",      farbe: "yellow" },
  drahtriss:  { label: "Drahtriss",  farbe: "red" },
  reparatur:  { label: "Reparatur",  farbe: "blue" },
  abruesten:  { label: "Abrüsten",   farbe: "violet" },
};

/* ---------- Speicher (intern im Gerät, localStorage) ---------- */
const DB = {
  get(key, def) { try { const v = JSON.parse(localStorage.getItem("sue_" + key)); return v === null ? def : v; } catch (e) { return def; } },
  set(key, val) { localStorage.setItem("sue_" + key, JSON.stringify(val)); },
};
function entries() { return DB.get("entries", []); }
function todos()   { return DB.get("todos", []); }
function spulen()  { return DB.get("spulen", []); }
function neueId()  { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)); }

/* ---------- Hilfsfunktionen ---------- */
function jetzt() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function zahl(s) {
  if (s == null) return 0;
  s = String(s).trim().replace(/\s/g, ""); if (s === "") return 0;
  if (s.indexOf(",") !== -1) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function fmt(n, nk) { if (nk === undefined) nk = 2; return n.toLocaleString("de-DE", { minimumFractionDigits: nk, maximumFractionDigits: nk }); }
function hm(sek) { if (!sek || sek <= 0) return "–"; const min = Math.round(sek / 60), h = Math.floor(min / 60), m = min % 60; return h + " h " + String(m).padStart(2, "0") + " min"; }
function flash(text) {
  const alt = document.querySelector(".flash"); if (alt) alt.remove();
  const el = document.createElement("div"); el.className = "flash"; el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
}

/* ---------- Fehler automatisch erfassen ---------- */
function logFehler(art, nachricht, extra) {
  try {
    const list = DB.get("fehler", []);
    list.push({
      zeit: jetzt(), art: art,
      nachricht: String(nachricht == null ? "" : nachricht).slice(0, 500),
      extra: extra ? String(extra).slice(0, 1500) : "",
      ansicht: (typeof state !== "undefined" && state) ? state.view : "?",
    });
    while (list.length > 40) list.shift();
    DB.set("fehler", list);
    aktualisiereFehlerBadge();
  } catch (e) { /* Fehler-Logger darf selbst nie crashen */ }
}
function aktualisiereFehlerBadge() {
  const k = document.getElementById("fehler-knopf");
  if (k) k.classList.toggle("hat-fehler", DB.get("fehler", []).length > 0);
}
window.addEventListener("error", e => logFehler("Programmfehler", e.message, (e.filename || "") + ":" + (e.lineno || "") + (e.error && e.error.stack ? "\n" + e.error.stack : "")));
window.addEventListener("unhandledrejection", e => logFehler("Programmfehler", (e.reason && e.reason.message) || e.reason, e.reason && e.reason.stack));

/* ---------- Router ---------- */
const state = { view: "maschinen", maschine: null, overlay: null };
let spModus = "summe";  // Berechnungsart der Vorzüge: "summe" | "kleinster"
const inhalt = document.getElementById("inhalt");
const titel = document.getElementById("kopf-titel");

function zeige(view) {
  state.view = view; state.maschine = null;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("aktiv", t.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (state.overlay === "fehler") return renderFehler();
  if (state.view === "maschinen" && state.maschine) return renderMaschineDetail();
  ({ maschinen: renderMaschinen, aufgaben: renderAufgaben, spulen: renderSpulen, mehr: renderMehr }[state.view] || renderMaschinen)();
}

/* ---------- Ansicht: Maschinen ---------- */
function letzterEintrag(m) {
  const alle = entries().filter(e => e.machine === m);
  return alle.length ? alle[alle.length - 1] : null;
}
function renderMaschinen() {
  titel.textContent = "Maschinen";
  let kacheln = MASCHINEN.map(m => {
    const e = letzterEintrag(m), farbe = e ? STATUS[e.status].farbe : "none";
    const txt = e ? STATUS[e.status].label : "kein Eintrag";
    return `<button class="kopf-kachel bg-${farbe}" data-maschine="${m}">${m}<small>${esc(txt)}</small></button>`;
  }).join("");

  const mitNotiz = MASCHINEN.map(letzterEintrag).filter(e => e && e.note);
  let status = mitNotiz.length
    ? mitNotiz.map(e => `<div class="eintrag"><b>${e.machine}</b> <span class="stat" style="color:var(--${STATUS[e.status].farbe})">${STATUS[e.status].label}</span> – ${esc(e.note)}<div class="meta">${e.created_at}</div></div>`).join("")
    : `<div class="leer">Keine Notizen vorhanden.</div>`;

  inhalt.innerHTML = `<div class="grid">${kacheln}</div>
    <div class="karte"><h2>Maschinen-Status</h2>${status}</div>`;
}

function renderMaschineDetail() {
  const m = state.maschine;
  titel.innerHTML = `${m}`;
  const hist = entries().filter(e => e.machine === m).slice().reverse();
  let histHtml = hist.length
    ? hist.map(e => `<div class="eintrag"><span class="punkt d-${STATUS[e.status].farbe}"></span><span class="stat">${STATUS[e.status].label}</span>${e.note ? " – " + esc(e.note) : ""}<div class="meta">${e.created_at}</div></div>`).join("")
    : `<div class="leer">Noch kein Eintrag.</div>`;

  let optionen = Object.keys(STATUS).map(k =>
    `<button type="button" class="status-opt" data-status="${k}"><span class="punkt d-${STATUS[k].farbe}"></span>${STATUS[k].label}</button>`).join("");

  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>Neuer Eintrag für ${m}</h2>
      <div class="label">Status</div>
      <div class="status-wahl">${optionen}</div>
      <div class="label">Notiz (optional)</div>
      <textarea id="notiz" placeholder="z. B. Drahtriss an Kopf 3"></textarea>
      <button class="btn" data-speichern-eintrag="1" style="margin-top:12px">Eintrag speichern</button>
    </div>
    <div class="karte"><h2>Verlauf</h2>${histHtml}</div>`;
}

/* ---------- Ansicht: Aufgaben ---------- */
function renderAufgaben() {
  titel.textContent = "Aufgaben";
  const items = todos().slice().sort((a, b) => (a.done - b.done)).reverse();
  const liste = items.length ? items.map(t => `
    <div class="eintrag">
      <div class="${t.done ? "durchgestrichen" : ""}">${t.machine ? "<b>" + t.machine + ":</b> " : ""}${esc(t.text)}</div>
      <div class="meta">${t.created_at}${t.done && t.done_at ? " · ✓ erledigt " + t.done_at : ""}</div>
      <button class="btn btn-klein ${t.done ? "btn-grau" : ""}" data-toggle-todo="${t.id}" style="margin-top:6px">${t.done ? "wieder offen" : "✓ erledigt"}</button>
      <button class="btn btn-klein btn-rot" data-del-todo="${t.id}" style="margin-top:6px;margin-left:6px">Löschen</button>
    </div>`).join("") : `<div class="leer">Nichts offen. 🎉</div>`;

  const maschinenOpts = MASCHINEN.map(m => `<option value="${m}">${m}</option>`).join("");
  inhalt.innerHTML = `
    <div class="karte">
      <div class="label">Neue Aufgabe</div>
      <input type="text" id="todo-text" placeholder="Was ist zu tun?">
      <div class="label">Maschine (optional)</div>
      <select id="todo-maschine"><option value="">Allgemein</option>${maschinenOpts}</select>
      <button class="btn" data-add-todo="1" style="margin-top:12px">Hinzufügen</button>
    </div>
    <div class="karte"><h2>Liste</h2>${liste}</div>`;
}

/* ---------- Ansicht: Spulen-Berechnung ---------- */
function renderSpulen() {
  titel.textContent = "Spulen-Berechnung";
  const vzFelder = Array.from({ length: 8 }, (_, i) =>
    `<div><div class="label">VZ ${i + 1}</div><input type="text" class="vz num" inputmode="decimal" placeholder="kg"></div>`).join("");
  const liste = spulen().slice().reverse().map(e => `
    <div class="eintrag">
      <div><b>${e.auftrag ? "Auftrag " + esc(e.auftrag) : "(ohne Auftragsnummer)"}</b></div>
      <div style="font-size:.92rem">${e.anzahl_vz} VZ ${e.modus === "kleinster" ? "(vom kleinsten)" : "(zusammen)"} = <b>${fmt(e.gesamtmasse)} kg</b> · Faktor ${fmt(e.faktor, 0)} %
        → Endgewicht <b>${fmt(e.endgewicht)} kg</b> / <b>${fmt(e.endlaenge_m, 0)} m</b><br>
        ${e.anzahl_spulen} Fertigspulen → je <b>${fmt(e.gewicht_je_spule)} kg</b> / <b>${fmt(e.laenge_je_spule, 0)} m</b>
        ${e.geschwindigkeit ? "<br>Bei " + fmt(e.geschwindigkeit, 1) + " m/s → Laufzeit gesamt <b>" + hm(e.endlaenge_m / e.geschwindigkeit) + "</b> · je Spule <b>" + hm(e.laenge_je_spule / e.geschwindigkeit) + "</b>" : ""}
      </div>
      <div class="meta">G = ${fmt(e.metergewicht, 4)} kg/km · ${e.created_at}</div>
      <button class="btn btn-klein btn-rot" data-del-spule="${e.id}" style="margin-top:6px">Löschen</button>
    </div>`).join("") || `<div class="leer">Noch keine Berechnung gespeichert.</div>`;

  inhalt.innerHTML = `
    <div class="karte">
      <div class="label">Auftragsnummer (optional)</div>
      <input type="text" id="sp-auftrag" placeholder="z. B. 18034" maxlength="50">
      <div class="label">Metergewicht G (kg/km) – von der QS-Prüfkarte</div>
      <div class="schmal"><input type="text" id="sp-g" class="num" inputmode="decimal" placeholder="z. B. 1,15"></div>
      <div class="hinweis" id="sp-g-hint"></div>
    </div>
    <div class="karte">
      <h2>G aus vorhandener Spule ermitteln</h2>
      <div class="hinweis" style="margin-top:0">Kennst du das Metergewicht nicht? Gewicht und Länge einer fertigen Spule eingeben – G wird berechnet und kann oben übernommen werden.</div>
      <div class="zwei">
        <div><div class="label">Gewicht der Spule (kg)</div><input type="text" id="g-kg" class="num" inputmode="decimal" placeholder="kg"></div>
        <div><div class="label">Länge der Spule (m)</div><input type="text" id="g-m" class="num" inputmode="decimal" placeholder="m"></div>
      </div>
      <div class="zeile" style="margin-top:6px"><span>Metergewicht G</span><span><span class="w" id="g-out">–</span><span class="einheit">kg/km</span></span></div>
      <button class="btn btn-grau" data-g-uebernehmen="1" style="margin-top:8px">Als Metergewicht G übernehmen</button>
    </div>
    <div class="karte">
      <h2>Vorzüge – Gewicht je Spule (kg)</h2>
      <div class="vz-grid">${vzFelder}</div>
      <div class="hinweis">Nur ausgefüllte Felder zählen – bei 6 Vorzügen einfach 2 leer lassen.</div>
      <div class="zeile" style="border-bottom:none;margin-top:8px"><span>Summe der Vorzüge <span id="sp-anzahl" style="color:var(--grau)"></span></span><span><span class="w" id="sp-summe">0</span><span class="einheit">kg</span></span></div>
    </div>
    <div class="karte">
      <h2>Berechnungsart der Vorzüge</h2>
      <div class="modus">
        <button type="button" data-modus="summe" class="${spModus === 'summe' ? 'aktiv' : ''}">Alle zusammen<small>Summe aller Vorzüge</small></button>
        <button type="button" data-modus="kleinster" class="${spModus === 'kleinster' ? 'aktiv' : ''}">Vom kleinsten<small>kleinster × Anzahl</small></button>
      </div>
      <div class="vergleich">
        <div id="v-summe">Alle zusammen<span class="gross" id="w-summe">0</span></div>
        <div id="v-kleinster">Vom kleinsten<span class="gross" id="w-kleinster">0</span></div>
      </div>
      <div class="hinweis" id="modus-hinweis"></div>
    </div>
    <div class="karte">
      <div style="display:flex;gap:12px;align-items:flex-end">
        <div style="max-width:110px"><div class="label">Faktor</div><input type="text" id="sp-faktor" class="num" inputmode="decimal" value="98"></div>
        <div style="font-size:1.1rem;color:#45525d;padding-bottom:12px">%</div>
        <div style="max-width:150px"><div class="label">Anzahl Fertigspulen</div><input type="text" id="sp-nspulen" class="num" inputmode="numeric" placeholder="z. B. 20"></div>
      </div>
      <div class="label" style="margin-top:10px">Geschwindigkeit (m/s) <span style="color:var(--grau)">(optional – für Laufzeit)</span></div>
      <div class="schmal"><input type="text" id="sp-v" class="num" inputmode="decimal" placeholder="z. B. 20"></div>
    </div>
    <div class="karte erg">
      <h2>Ergebnis</h2>
      <div class="zeile haupt"><span>Endgewicht (× Faktor)</span><span><span class="w" id="sp-eg">0</span><span class="einheit">kg</span></span></div>
      <div class="zeile"><span>Endlänge gesamt</span><span><span class="w" id="sp-el">0</span><span class="einheit">m</span></span></div>
      <div class="zeile"><span>Gewicht je Fertigspule</span><span><span class="w" id="sp-skg">0</span><span class="einheit">kg</span></span></div>
      <div class="zeile"><span>Länge je Fertigspule</span><span><span class="w" id="sp-sm">0</span><span class="einheit">m</span></span></div>
      <div class="zeile"><span>Laufzeit gesamt</span><span class="w" id="sp-lzg">–</span></div>
      <div class="zeile"><span>Laufzeit je Fertigspule</span><span class="w" id="sp-lzs">–</span></div>
    </div>
    <div class="karte"><button class="btn" data-save-spule="1">Berechnung speichern</button></div>
    <div class="karte">
      <h2>Einzelne Spule umrechnen (kg ⇄ m)</h2>
      <div class="hinweis" style="margin-top:0">Rechnet mit dem Metergewicht G von oben.</div>
      <div class="zwei">
        <div><div class="label">Ich habe das Gewicht (kg)</div><input type="text" id="u-kg" class="num" inputmode="decimal" placeholder="kg">
          <div class="zeile" style="border-bottom:none"><span>Länge</span><span><span class="w" id="u-kg-out">–</span><span class="einheit">m</span></span></div></div>
        <div><div class="label">Ich habe die Länge (m)</div><input type="text" id="u-m" class="num" inputmode="decimal" placeholder="m">
          <div class="zeile" style="border-bottom:none"><span>Gewicht</span><span><span class="w" id="u-m-out">–</span><span class="einheit">kg</span></span></div></div>
      </div>
    </div>
    <div class="karte"><h2>Gespeicherte Berechnungen</h2>${liste}</div>`;
  spRechne();
}

function spVal(id) { return zahl(document.getElementById(id).value); }
function spRechne() {
  const G = spVal("sp-g"), faktor = spVal("sp-faktor"), nSpulen = spVal("sp-nspulen"), v = spVal("sp-v");
  document.getElementById("sp-g-hint").textContent = G > 0 ? `1 km wiegt ${fmt(G, 4)} kg · 1 kg = ${fmt(1000 / G, 1)} m` : "Wert von der Prüfkarte eintragen (Spalte G, kg/km).";
  const vzWerte = [];
  document.querySelectorAll(".vz").forEach(el => { const w = zahl(el.value); if (w > 0) vzWerte.push(w); });
  const aktiv = vzWerte.length;
  const summe = vzWerte.reduce((a, b) => a + b, 0);
  const kleinster = aktiv ? Math.min(...vzWerte) : 0;
  const massKleinster = kleinster * aktiv;
  document.getElementById("sp-summe").textContent = fmt(summe);
  document.getElementById("sp-anzahl").textContent = aktiv ? `(${aktiv} aktiv)` : "";
  // Vergleich der beiden Berechnungsarten
  document.getElementById("w-summe").textContent = fmt(summe);
  document.getElementById("w-kleinster").textContent = fmt(massKleinster);
  document.getElementById("v-summe").classList.toggle("benutzt", spModus === "summe");
  document.getElementById("v-kleinster").classList.toggle("benutzt", spModus === "kleinster");
  document.getElementById("modus-hinweis").textContent = spModus === "kleinster"
    ? `Verwendet: kleinster Vorzug (${fmt(kleinster)} kg) × ${aktiv} = ${fmt(massKleinster)} kg. Rest bleibt übrig: ${fmt(summe - massKleinster)} kg.`
    : `Verwendet: Summe aller ${aktiv} Vorzüge = ${fmt(summe)} kg.`;
  const gesamt = spModus === "kleinster" ? massKleinster : summe;
  const eg = gesamt * (faktor / 100), el = G > 0 ? eg / G * 1000 : 0;
  document.getElementById("sp-eg").textContent = fmt(eg);
  document.getElementById("sp-el").textContent = fmt(el, 0);
  const sKg = nSpulen > 0 ? eg / nSpulen : 0, sM = (nSpulen > 0 && G > 0) ? sKg / G * 1000 : 0;
  document.getElementById("sp-skg").textContent = fmt(sKg);
  document.getElementById("sp-sm").textContent = fmt(sM, 0);
  document.getElementById("sp-lzg").textContent = v > 0 ? hm(el / v) : "–";
  document.getElementById("sp-lzs").textContent = v > 0 ? hm(sM / v) : "–";
  const uKg = spVal("u-kg"), uM = spVal("u-m");
  document.getElementById("u-kg-out").textContent = G > 0 ? fmt(uKg / G * 1000, 0) : "–";
  document.getElementById("u-m-out").textContent = G > 0 ? fmt(uM / 1000 * G) : "–";
  // G aus vorhandener Spule: G = Gewicht(kg) / Länge(km) = kg / (m/1000)
  const gKg = spVal("g-kg"), gM = spVal("g-m");
  document.getElementById("g-out").textContent = (gKg > 0 && gM > 0) ? fmt(gKg / (gM / 1000), 4) : "–";
}
function gErmittelt() { const gKg = spVal("g-kg"), gM = spVal("g-m"); return (gKg > 0 && gM > 0) ? gKg / (gM / 1000) : 0; }

function speichereSpule() {
  const G = spVal("sp-g"), faktor = spVal("sp-faktor");
  let nSpulen = Math.floor(spVal("sp-nspulen"));
  const vz = Array.from(document.querySelectorAll(".vz")).map(el => zahl(el.value)).filter(w => w > 0);
  const v = spVal("sp-v");
  if (G <= 0) return flash("Metergewicht (kg/km) fehlt.");
  if (!vz.length) return flash("Mindestens ein Vorzug-Gewicht angeben.");
  if (faktor <= 0) return flash("Faktor muss größer als 0 sein.");
  if (nSpulen < 1) return flash("Anzahl Fertigspulen muss mindestens 1 sein.");
  const summe = vz.reduce((a, b) => a + b, 0);
  const gesamt = spModus === "kleinster" ? Math.min(...vz) * vz.length : summe;
  const eg = gesamt * faktor / 100;
  const eintrag = {
    id: neueId(), auftrag: document.getElementById("sp-auftrag").value.trim().slice(0, 50),
    metergewicht: G, vz_gewichte: vz, anzahl_vz: vz.length, gesamtmasse: gesamt,
    modus: spModus, summe_alle: summe, faktor: faktor,
    endgewicht: eg, endlaenge_m: eg / G * 1000, anzahl_spulen: nSpulen,
    gewicht_je_spule: eg / nSpulen, laenge_je_spule: eg / nSpulen / G * 1000,
    geschwindigkeit: v > 0 ? v : null, created_at: jetzt(),
  };
  const list = spulen(); list.push(eintrag); DB.set("spulen", list);
  flash("Berechnung gespeichert."); render();
}

/* ---------- Ansicht: Mehr / Sicherung ---------- */
function renderMehr() {
  titel.textContent = "Mehr";
  const anz = { m: entries().length, a: todos().length, s: spulen().length };
  inhalt.innerHTML = `
    <div class="karte">
      <h2>Datensicherung</h2>
      <p class="hinweis" style="margin-top:0">Gespeichert im Gerät: ${anz.m} Maschinen-Einträge, ${anz.a} Aufgaben, ${anz.s} Spulen-Berechnungen.</p>
      <p class="hinweis">Erstelle regelmäßig eine Sicherung – so gehen deine Daten nie verloren, auch wenn das iPhone die App-Daten mal aufräumt.</p>
      <button class="btn" data-export="1">Sicherung erstellen / teilen</button>
      <div class="label" style="margin-top:14px">Sicherung wiederherstellen</div>
      <input type="file" id="import-file" accept="application/json,.json">
      <button class="btn btn-grau" data-import="1" style="margin-top:10px">Aus Datei einlesen</button>
    </div>
    <div class="karte">
      <h2>Info</h2>
      <p class="hinweis" style="margin-top:0">Schichtübergabe Feinzug 2 – läuft offline auf dem Gerät, alle Daten bleiben lokal.
      Maschinen und Ampel-Status sind fest vorgegeben (Z49–Z83; grün=Produktion, gelb=Umbau, rot=Drahtriss, blau=Reparatur, violett=Abrüsten).</p>
    </div>`;
}

function exportData() {
  const daten = { version: 1, exportiert: jetzt(), entries: entries(), todos: todos(), spulen: spulen() };
  const text = JSON.stringify(daten, null, 2);
  const name = "schichtuebergabe-sicherung.json";
  const blob = new Blob([text], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Schichtübergabe-Sicherung" }).catch(() => {});
  } else {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); flash("Sicherung heruntergeladen.");
  }
}
function importData() {
  const f = document.getElementById("import-file").files[0];
  if (!f) return flash("Bitte zuerst eine Datei wählen.");
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== "object") throw new Error();
      if (Array.isArray(d.entries)) DB.set("entries", d.entries);
      if (Array.isArray(d.todos)) DB.set("todos", d.todos);
      if (Array.isArray(d.spulen)) DB.set("spulen", d.spulen);
      flash("Sicherung eingelesen."); render();
    } catch (e) { flash("Datei nicht lesbar."); }
  };
  r.readAsText(f);
}

/* ---------- Fehler melden ---------- */
function renderFehler() {
  titel.textContent = "Fehler melden";
  const fehler = DB.get("fehler", []);
  const auto = fehler.length
    ? fehler.slice().reverse().map(f => `<div class="eintrag"><b>${esc(f.art)}:</b> ${esc(f.nachricht)}<div class="meta">${f.zeit} · Ansicht „${esc(f.ansicht)}"</div></div>`).join("")
    : `<div class="leer">Bisher kein automatischer Fehler erfasst. 👍</div>`;
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-fehler-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>Fehler beschreiben</h2>
      <p class="hinweis" style="margin-top:0">Was ist passiert? Was hast du gedrückt, was war falsch?</p>
      <textarea id="f-text" placeholder="z. B. Endgewicht war falsch, nachdem ich VZ 3 gelöscht habe"></textarea>
      <div class="label">Foto anhängen (optional)</div>
      <input type="file" id="f-foto" accept="image/*">
      <button class="btn" data-fehler-senden="1" style="margin-top:12px">Fehlerbericht erstellen &amp; teilen</button>
      <p class="hinweis">Es entsteht eine Datei. Schick sie per Teilen (Mail, AirDrop, in „Dateien" speichern) – die kann ich dann auslesen.</p>
    </div>
    <div class="karte">
      <h2>Automatisch erfasste Fehler</h2>${auto}
      ${fehler.length ? '<button class="btn btn-grau btn-klein" data-fehler-loeschen="1" style="margin-top:10px">Liste leeren</button>' : ""}
    </div>`;
}

function verkleinereFoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1200; let w = img.width, h = img.height;
      if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { resolve(c.toDataURL("image/jpeg", 0.7)); } catch (e) { reject(e); }
    };
    img.onerror = reject; img.src = url;
  });
}

async function sendeFehlerbericht() {
  const text = document.getElementById("f-text").value.trim();
  const fInput = document.getElementById("f-foto");
  let foto = null;
  if (fInput.files && fInput.files[0]) {
    try { foto = await verkleinereFoto(fInput.files[0]); } catch (e) { flash("Foto konnte nicht gelesen werden – Bericht ohne Foto."); }
  }
  const bericht = {
    typ: "fehlerbericht", app: "fz2-tool", version: APP_VERSION, zeit: jetzt(),
    beschreibung: text,
    geraet: {
      ua: navigator.userAgent, plattform: navigator.platform || "",
      screen: (typeof screen !== "undefined" ? screen.width + "x" + screen.height : ""),
      standalone: !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)),
      sprache: navigator.language,
    },
    auto_fehler: DB.get("fehler", []),
    daten_umfang: { maschinen_eintraege: entries().length, aufgaben: todos().length, spulen: spulen().length },
    foto: foto,
  };
  const blob = new Blob([JSON.stringify(bericht, null, 2)], { type: "application/json" });
  const name = "fehlerbericht-" + jetzt().replace(/[.: ]/g, "-") + ".json";
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Fehlerbericht fz2-tool" }); }
    catch (e) { /* Nutzer hat Teilen abgebrochen */ }
  } else {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); flash("Fehlerbericht gespeichert.");
  }
}

/* ---------- Ereignisse (Delegation) ---------- */
document.getElementById("tabs").addEventListener("click", e => {
  const t = e.target.closest(".tab"); if (t) zeige(t.dataset.view);
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-maschine],[data-zurueck],[data-status],[data-speichern-eintrag],[data-add-todo],[data-toggle-todo],[data-del-todo],[data-modus],[data-save-spule],[data-del-spule],[data-g-uebernehmen],[data-export],[data-import],[data-fehler-zurueck],[data-fehler-senden],[data-fehler-loeschen]");
  if (!el) return;
  if (el.dataset.maschine) { state.maschine = el.dataset.maschine; render(); window.scrollTo(0, 0); }
  else if (el.dataset.zurueck) { state.maschine = null; render(); }
  else if (el.dataset.status) { document.querySelectorAll(".status-opt").forEach(o => o.classList.remove("aktiv")); el.classList.add("aktiv", "bg-" + STATUS[el.dataset.status].farbe); el.dataset._sel = "1"; }
  else if (el.dataset.speichernEintrag) speichereEintrag();
  else if (el.dataset.addTodo) addTodo();
  else if (el.dataset.toggleTodo) toggleTodo(el.dataset.toggleTodo);
  else if (el.dataset.delTodo) delTodo(el.dataset.delTodo);
  else if (el.dataset.modus) {
    spModus = el.dataset.modus;
    document.querySelectorAll(".modus button").forEach(b => b.classList.toggle("aktiv", b === el));
    spRechne();
  }
  else if (el.dataset.saveSpule) speichereSpule();
  else if (el.dataset.delSpule) delSpule(el.dataset.delSpule);
  else if (el.dataset.gUebernehmen) { const g = gErmittelt(); if (g > 0) { document.getElementById("sp-g").value = fmt(g, 4); spRechne(); flash("G übernommen: " + fmt(g, 4) + " kg/km"); } else flash("Erst Gewicht und Länge der Spule eingeben."); }
  else if (el.dataset.export) exportData();
  else if (el.dataset.import) importData();
  else if (el.dataset.fehlerZurueck) { state.overlay = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.fehlerSenden) sendeFehlerbericht();
  else if (el.dataset.fehlerLoeschen) { if (confirm("Fehlerliste leeren?")) { DB.set("fehler", []); aktualisiereFehlerBadge(); render(); } }
});
document.getElementById("fehler-knopf").addEventListener("click", () => { state.overlay = "fehler"; render(); window.scrollTo(0, 0); });
document.addEventListener("input", e => { if (e.target.closest("#inhalt") && state.view === "spulen") spRechne(); });

function gewaehlterStatus() { const a = document.querySelector(".status-opt.aktiv"); return a ? a.dataset.status : null; }
function speichereEintrag() {
  const st = gewaehlterStatus();
  if (!st) return flash("Bitte einen Status wählen.");
  const note = document.getElementById("notiz").value.trim();
  const list = entries();
  list.push({ id: neueId(), machine: state.maschine, status: st, note: note, created_at: jetzt() });
  DB.set("entries", list); flash("Eintrag gespeichert."); render(); window.scrollTo(0, 0);
}
function addTodo() {
  const text = document.getElementById("todo-text").value.trim();
  if (!text) return flash("Bitte einen Text eingeben.");
  const machine = document.getElementById("todo-maschine").value;
  const list = todos();
  list.push({ id: neueId(), text: text, machine: machine || null, done: false, created_at: jetzt() });
  DB.set("todos", list); render();
}
function toggleTodo(id) {
  const list = todos(); const t = list.find(x => x.id === id); if (!t) return;
  t.done = !t.done; t.done_at = t.done ? jetzt() : null; DB.set("todos", list); render();
}
function delTodo(id) { if (!confirm("Aufgabe löschen?")) return; DB.set("todos", todos().filter(t => t.id !== id)); render(); }
function delSpule(id) { if (!confirm("Berechnung löschen?")) return; DB.set("spulen", spulen().filter(s => s.id !== id)); render(); }

/* ---------- Service Worker (Offline) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

/* ---------- Start ---------- */
zeige("maschinen");
aktualisiereFehlerBadge();
