"use strict";

const APP_VERSION = "1.6";
const REPORT_MAIL = "tigga232332@gmail.com";   // Sammeladresse für Wochenberichte
const WOCHE_MS = 7 * 24 * 3600 * 1000;

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
function rezepte() { return DB.get("rezepte", []); }
function ruestungen() { return DB.get("ruestungen", []); }

// Einzustellende Werte (die *-Felder aus dem Erstmuster), nach Bereich gruppiert
const EINSTELLFELDER = [
  { gruppe: "Ablauf", felder: [
    { name: "Abwickelrichtung", einheit: "" },
    { name: "Tänzer Ziehen", einheit: "bar/kg/mm" },
    { name: "Zugkraft Ablauf", einheit: "cN" },
  ] },
  { gruppe: "Ziehen", felder: [
    { name: "Ziehgeschwindigkeit", einheit: "m/s" },
    { name: "Anzahl Drähte", einheit: "" },
    { name: "Enddurchmesser", einheit: "mm" },
    { name: "erster Dm schneller Teil", einheit: "mm" },
    { name: "letzter Dm langsamer Teil", einheit: "mm" },
    { name: "Schlupf", einheit: "%" },
    { name: "übersprungene Stufen", einheit: "" },
  ] },
  { gruppe: "Glühe", felder: [
    { name: "Glühfaktor", einheit: "" },
    { name: "Glühspannung", einheit: "V" },
    { name: "Glühstrom", einheit: "A" },
    { name: "Luftdruck Glühe", einheit: "bar" },
    { name: "Ventilöffnung Druckluft", einheit: "%" },
    { name: "Kugelhahn Schutzgas", einheit: "%" },
  ] },
  { gruppe: "Spuler", felder: [
    { name: "Spulengröße", einheit: "mm" },
    { name: "Tänzer Spuler", einheit: "g/mm" },
    { name: "Zugkraft Aufwickelspannung", einheit: "cN" },
    { name: "Verlegeschritt", einheit: "V/Sek" },
  ] },
];
const ALLE_FELDER = EINSTELLFELDER.flatMap(g => g.felder);
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
const state = { view: "maschinen", maschine: null, overlay: null, rezept: null, rezeptForm: null, verlauf: null };
let spModus = "summe";  // Berechnungsart der Vorzüge: "summe" | "kleinster"
let spEditId = null;    // gesetzt, wenn eine gespeicherte Berechnung bearbeitet wird
const inhalt = document.getElementById("inhalt");
const titel = document.getElementById("kopf-titel");

function zeige(view) {
  state.view = view; state.maschine = null; state.rezept = null; state.rezeptForm = null; state.verlauf = null;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("aktiv", t.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (state.overlay === "fehler") return renderFehler();
  if (state.view === "maschinen" && state.maschine) return renderMaschineDetail();
  if (state.view === "ruesten") {
    if (state.rezeptForm) return renderRezeptForm();
    if (state.verlauf) return renderVerlauf();
    if (state.rezept) return renderRuestCheck();
    return renderRuesten();
  }
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
      <button class="btn btn-klein" data-edit-spule="${e.id}" style="margin-top:6px">Bearbeiten</button>
      <button class="btn btn-klein btn-rot" data-del-spule="${e.id}" style="margin-top:6px;margin-left:6px">Löschen</button>
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
  const G = spVal("sp-g"), nSpulen = spVal("sp-nspulen"), v = spVal("sp-v");
  let faktor = spVal("sp-faktor"); if (faktor <= 0) faktor = 100;  // leer/0 = kein Abzug
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
  const G = spVal("sp-g");
  let faktor = spVal("sp-faktor"); if (faktor <= 0) faktor = 100;  // leer/0 = kein Abzug
  let nSpulen = Math.floor(spVal("sp-nspulen"));
  const vz = Array.from(document.querySelectorAll(".vz")).map(el => zahl(el.value)).filter(w => w > 0);
  const v = spVal("sp-v");
  if (G <= 0) return flash("Metergewicht (kg/km) fehlt.");
  if (!vz.length) return flash("Mindestens ein Vorzug-Gewicht angeben.");
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
  let list = spulen();
  if (spEditId) { list = list.filter(s => s.id !== spEditId); spEditId = null; }  // Bearbeitung ersetzt den alten Eintrag
  list.push(eintrag); DB.set("spulen", list);
  flash("Berechnung gespeichert."); render(); window.scrollTo(0, 0);
}

function deStr(n) { return String(n).replace(".", ","); }

function editSpule(id) {
  const e = spulen().find(s => s.id === id);
  if (!e) return;
  spEditId = id;
  spModus = e.modus || "summe";
  document.getElementById("sp-auftrag").value = e.auftrag || "";
  document.getElementById("sp-g").value = deStr(e.metergewicht);
  document.getElementById("sp-faktor").value = deStr(e.faktor);
  document.getElementById("sp-nspulen").value = String(e.anzahl_spulen);
  document.getElementById("sp-v").value = e.geschwindigkeit ? deStr(e.geschwindigkeit) : "";
  const felder = document.querySelectorAll(".vz");
  felder.forEach((el, i) => el.value = (e.vz_gewichte && e.vz_gewichte[i] != null) ? deStr(e.vz_gewichte[i]) : "");
  document.querySelectorAll(".modus button").forEach(b => b.classList.toggle("aktiv", b.dataset.modus === spModus));
  spRechne();
  window.scrollTo(0, 0);
  flash("Werte geladen – ändern und erneut speichern.");
}

/* ---------- Ansicht: Rüsten (Draht-Rezepte + Checkliste) ---------- */
function renderRuesten() {
  titel.textContent = "Rüsten";
  const rz = rezepte();
  const liste = rz.length ? rz.slice().reverse().map(r => {
    const soll = r.soll || {}, status = r.ruest_status || {};
    const g = Object.keys(soll).filter(k => soll[k] !== "").length;
    const ok = Object.values(status).filter(s => s && s.erledigt).length;
    const badge = ok > 0 ? `<span class="rz-fort">${ok}/${g} gerüstet</span>` : "";
    return `<div class="eintrag rz-eintrag" data-rezept="${r.id}">
      <div><b>${esc(r.kuerzel)}</b> · ${esc(r.aufbau)} ${badge}</div>
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}</div>
    </div>`;
  }).join("") : `<div class="leer">Noch kein Draht-Rezept angelegt.</div>`;
  inhalt.innerHTML = `
    <div class="karte">
      <p class="hinweis" style="margin-top:0">Draht-Typ wählen, um die Maschine einzurichten und die Werte abzuhaken – oder ein neues Rezept anlegen.</p>
      <button class="btn" data-rezept-neu="1">+ Neues Draht-Rezept</button>
    </div>
    <div class="karte"><h2>Draht-Rezepte</h2>${liste}</div>`;
}

function renderRezeptForm() {
  const id = state.rezeptForm;
  const r = (id !== "neu") ? rezepte().find(x => x.id === id) : null;
  titel.textContent = r ? "Rezept bearbeiten" : "Neues Rezept";
  const gv = f => (r && r.soll && r.soll[f.name] != null) ? esc(r.soll[f.name]) : "";
  const felderHtml = EINSTELLFELDER.map(grp => `
    <div class="rz-gruppe">${grp.gruppe}</div>
    ${grp.felder.map(f => `<div class="rz-feld"><label>${esc(f.name)}${f.einheit ? ` <span style="color:var(--grau)">(${f.einheit})</span>` : ""}</label>
      <input type="text" class="rz-soll" data-feld="${esc(f.name)}" value="${gv(f)}" placeholder="Sollwert"></div>`).join("")}`).join("");
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-rezept-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>Draht-Typ</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Kurzbezeichnung</label><input type="text" id="rz-kuerzel" value="${r ? esc(r.kuerzel) : ""}" placeholder="z. B. VSW"></div>
        <div><label>Aufbau</label><input type="text" id="rz-aufbau" value="${r ? esc(r.aufbau) : ""}" placeholder="z. B. 6×0,050"></div>
      </div>
      <label>Klartext</label><input type="text" id="rz-klartext" value="${r ? esc(r.klartext || "") : ""}" placeholder="z. B. versilbert weich">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Maschine</label><input type="text" id="rz-maschine" value="${r ? esc(r.maschine || "") : ""}" placeholder="z. B. Z49"></div>
        <div><label>Beispiel-Auftrag</label><input type="text" id="rz-auftrag" value="${r ? esc(r.beispiel_auftrag || "") : ""}"></div>
      </div>
    </div>
    <div class="karte">
      <h2>Einzustellende Werte</h2>
      <p class="hinweis" style="margin-top:0">Nur ausfüllen, was relevant ist – leere Felder erscheinen nicht in der Checkliste.</p>
      ${felderHtml}
    </div>
    <div class="karte"><button class="btn" data-rezept-speichern="1">Rezept speichern</button></div>`;
}

function renderRuestCheck() {
  const r = rezepte().find(x => x.id === state.rezept);
  if (!r) { state.rezept = null; return render(); }
  titel.textContent = r.kuerzel + " " + r.aufbau;
  const soll = r.soll || {}, status = r.ruest_status || {};
  const felder = ALLE_FELDER.filter(f => soll[f.name] != null && soll[f.name] !== "");
  const g = felder.length, ok = felder.filter(f => status[f.name] && status[f.name].erledigt).length;
  const punkte = felder.map(f => {
    const st = status[f.name] || {};
    return `<div class="punkt ${st.erledigt ? "ok" : ""}" data-check="${esc(f.name)}">
      <div class="p-box">${st.erledigt ? "✓" : ""}</div>
      <div class="p-txt"><div class="p-name">${esc(f.name)}</div>
        <input type="text" class="p-ist" data-ist="${esc(f.name)}" value="${st.ist != null ? esc(st.ist) : ""}" placeholder="Ist-Wert (optional)"></div>
      <div class="p-soll">Soll<br><b>${esc(soll[f.name])}</b> <span style="font-size:.72rem;color:var(--grau)">${f.einheit}</span></div>
    </div>`;
  }).join("");
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-rezept-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}</div>
      <div class="fortschritt"><span class="fz">${ok} / ${g} eingestellt</span><div class="balken"><div style="width:${g ? ok / g * 100 : 0}%"></div></div></div>
      ${g > 0 && g === ok ? '<div class="rz-fertig">✓ Alles eingestellt – Maschine ist gerüstet</div>' : ""}
    </div>
    <div class="karte"><h2>Einzustellende Werte</h2>
      ${punkte || '<div class="leer">Keine Werte hinterlegt. Rezept bearbeiten und Sollwerte eintragen.</div>'}</div>
    <div class="karte" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-klein" data-rezept-bearbeiten="${r.id}">Rezept bearbeiten</button>
      <button class="btn btn-klein btn-grau" data-verlauf="${r.id}">Verlauf</button>
      ${g > 0 ? `<button class="btn btn-klein" data-ruest-abschluss="${r.id}">Rüstung abschließen</button>` : ""}
    </div>`;
}

function renderVerlauf() {
  const r = rezepte().find(x => x.id === state.verlauf);
  titel.textContent = "Verlauf";
  const eintraege = ruestungen().filter(x => x.rezept_id === state.verlauf).slice().reverse();
  const liste = eintraege.length ? eintraege.map(e => {
    const zeilen = ALLE_FELDER.filter(f => e.ist && e.ist[f.name]).map(f => {
      const i = e.ist[f.name];
      return `<div class="v-zeile"><span>${esc(f.name)}</span><span>Soll ${esc(i.soll || "–")} · Ist <b>${esc(i.wert || "–")}</b></span></div>`;
    }).join("");
    return `<div class="eintrag"><div><b>${e.datum}</b>${e.maschine ? " · " + esc(e.maschine) : ""}</div>${zeilen || '<div class="meta">keine Ist-Werte notiert</div>'}</div>`;
  }).join("") : `<div class="leer">Noch keine abgeschlossene Rüstung.</div>`;
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-verlauf-zurueck="${r ? r.id : ''}">‹ Zurück</button>
    <div class="karte" style="margin-top:12px"><h2>${r ? esc(r.kuerzel + " " + r.aufbau) : "Verlauf"} – frühere Rüstungen</h2>${liste}</div>`;
}

function speichereRezept() {
  const kuerzel = document.getElementById("rz-kuerzel").value.trim();
  const aufbau = document.getElementById("rz-aufbau").value.trim();
  if (!kuerzel && !aufbau) return flash("Kurzbezeichnung oder Aufbau angeben.");
  const soll = {};
  document.querySelectorAll(".rz-soll").forEach(el => { const v = el.value.trim(); if (v) soll[el.dataset.feld] = v; });
  const daten = {
    kuerzel: kuerzel, aufbau: aufbau,
    klartext: document.getElementById("rz-klartext").value.trim(),
    maschine: document.getElementById("rz-maschine").value.trim(),
    beispiel_auftrag: document.getElementById("rz-auftrag").value.trim(),
    soll: soll,
  };
  const list = rezepte();
  const id = state.rezeptForm;
  if (id !== "neu") {
    const r = list.find(x => x.id === id);
    if (r) { Object.assign(r, daten); }
  } else {
    list.push({ id: neueId(), ...daten, ruest_status: {}, created_at: jetzt() });
  }
  DB.set("rezepte", list);
  state.rezeptForm = null;
  flash("Rezept gespeichert."); render(); window.scrollTo(0, 0);
}

function toggleCheck(feld) {
  const list = rezepte(), r = list.find(x => x.id === state.rezept);
  if (!r) return;
  if (!r.ruest_status) r.ruest_status = {};
  const st = r.ruest_status[feld] || {};
  st.erledigt = !st.erledigt;
  r.ruest_status[feld] = st;
  DB.set("rezepte", list);
  render();
}
function setzeIst(feld, wert) {
  const list = rezepte(), r = list.find(x => x.id === state.rezept);
  if (!r) return;
  if (!r.ruest_status) r.ruest_status = {};
  const st = r.ruest_status[feld] || {};
  st.ist = wert;
  r.ruest_status[feld] = st;
  DB.set("rezepte", list);  // ohne render – Feld behält Fokus
}
function ruestAbschluss(id) {
  const list = rezepte(), r = list.find(x => x.id === id);
  if (!r) return;
  const soll = r.soll || {}, status = r.ruest_status || {};
  const ist = {};
  ALLE_FELDER.filter(f => soll[f.name] != null && soll[f.name] !== "").forEach(f => {
    const st = status[f.name] || {};
    ist[f.name] = { soll: soll[f.name], wert: st.ist || "", erledigt: !!st.erledigt };
  });
  const rl = ruestungen();
  rl.push({ id: neueId(), rezept_id: id, kuerzel: r.kuerzel, maschine: r.maschine, datum: jetzt(), ist: ist });
  DB.set("ruestungen", rl);
  r.ruest_status = {};  // für die nächste Rüstung zurücksetzen
  DB.set("rezepte", list);
  flash("Rüstung im Verlauf gespeichert."); render(); window.scrollTo(0, 0);
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
      <h2>Zugangscode</h2>
      ${DB.get("pin_hash", null)
        ? `<p class="hinweis" style="margin-top:0">Die App ist mit einem Code gesperrt. Beim Öffnen muss er eingegeben werden.</p>
           <button class="btn btn-grau" data-code-aendern="1">Code ändern</button>
           <button class="btn btn-grau btn-klein" data-code-entfernen="1" style="margin-top:8px">Code entfernen</button>`
        : `<p class="hinweis" style="margin-top:0">Noch kein Code. Mit einem Code sieht niemand die Daten, der das Gerät in die Hand bekommt.</p>
           <input type="password" id="code-neu" inputmode="numeric" maxlength="12" placeholder="Neuer Code (Zahlen)">
           <button class="btn" data-code-setzen="1" style="margin-top:10px">Code festlegen</button>`}
    </div>
    <div class="karte">
      <h2>Info</h2>
      <p class="hinweis" style="margin-top:0">Schichtübergabe Feinzug 2 – läuft offline auf dem Gerät, alle Daten bleiben lokal.
      Maschinen und Ampel-Status sind fest vorgegeben (Z49–Z83; grün=Produktion, gelb=Umbau, rot=Drahtriss, blau=Reparatur, violett=Abrüsten).</p>
    </div>`;
}

async function codeSetzen() {
  const code = document.getElementById("code-neu").value.trim();
  if (code.length < 4) return flash("Bitte mindestens 4 Zeichen.");
  DB.set("pin_hash", await pinHash(code));
  flash("Code gesetzt – ab dem nächsten Start aktiv."); render();
}
async function codeAendern() {
  const code = (prompt("Neuen Code eingeben (mind. 4 Zeichen):") || "").trim();
  if (!code) return;
  if (code.length < 4) return flash("Bitte mindestens 4 Zeichen.");
  DB.set("pin_hash", await pinHash(code));
  flash("Code geändert.");
}
function codeEntfernen() {
  if (!confirm("Zugangscode entfernen? Die App ist dann ohne Code offen.")) return;
  localStorage.removeItem("sue_pin_hash");
  flash("Code entfernt."); render();
}

function exportData() {
  const daten = { version: 1, exportiert: jetzt(), entries: entries(), todos: todos(), spulen: spulen(), rezepte: rezepte(), ruestungen: ruestungen() };
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
      if (Array.isArray(d.rezepte)) DB.set("rezepte", d.rezepte);
      if (Array.isArray(d.ruestungen)) DB.set("ruestungen", d.ruestungen);
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
      ${fehler.length ? '<button class="btn" data-wochenbericht="1" style="margin-top:10px">Wochenbericht per Mail senden</button><p class="hinweis">Fasst die erfassten Meldungen zusammen und öffnet eine fertige E-Mail – nur noch absenden.</p><button class="btn btn-grau btn-klein" data-fehler-loeschen="1" style="margin-top:4px">Liste leeren</button>' : ""}
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

/* ---------- Wochenbericht (automatische Sammlung) ---------- */
function pruefeWochenbericht() {
  const banner = document.getElementById("wochen-banner");
  let last = DB.get("report_last_ts", null);
  if (last == null) { last = Date.now(); DB.set("report_last_ts", last); }  // Woche ab erster Nutzung
  const anzahl = DB.get("fehler", []).length;
  const faellig = (Date.now() - last >= WOCHE_MS) && anzahl > 0;
  banner.classList.toggle("zeigen", faellig);
  if (faellig) banner.textContent = "⚠ Wochenbericht fällig – " + anzahl + " Meldung(en). Zum Senden tippen.";
}

function wochenberichtMail() {
  const fehler = DB.get("fehler", []);
  let body = "Wochenbericht fz2-tool (Version " + APP_VERSION + ")\n";
  body += "Erstellt: " + jetzt() + "\n";
  body += "Gerät: " + (navigator.userAgent || "") + "\n";
  body += "Daten: " + entries().length + " Maschinen-Einträge, " + todos().length + " Aufgaben, " + spulen().length + " Berechnungen\n\n";
  if (!fehler.length) {
    body += "Keine automatischen Meldungen in diesem Zeitraum.\n";
  } else {
    body += fehler.length + " automatisch erfasste Meldung(en):\n";
    fehler.slice(-15).forEach((f, i) => {
      body += (i + 1) + ") " + f.zeit + " [" + f.ansicht + "] " + f.art + ": " + String(f.nachricht).slice(0, 150) + "\n";
    });
  }
  DB.set("report_last_ts", Date.now());
  pruefeWochenbericht();
  flash("E-Mail wird geöffnet – bitte absenden.");
  location.href = "mailto:" + REPORT_MAIL + "?subject=" + encodeURIComponent("Wochenbericht fz2-tool " + jetzt())
    + "&body=" + encodeURIComponent(body);
}

/* ---------- Ereignisse (Delegation) ---------- */
document.getElementById("tabs").addEventListener("click", e => {
  const t = e.target.closest(".tab"); if (t) zeige(t.dataset.view);
});
document.addEventListener("click", e => {
  const el = e.target.closest("[data-maschine],[data-zurueck],[data-status],[data-speichern-eintrag],[data-add-todo],[data-toggle-todo],[data-del-todo],[data-modus],[data-save-spule],[data-edit-spule],[data-del-spule],[data-g-uebernehmen],[data-rezept-neu],[data-rezept],[data-rezept-zurueck],[data-rezept-speichern],[data-rezept-bearbeiten],[data-verlauf],[data-verlauf-zurueck],[data-check],[data-ruest-abschluss],[data-export],[data-import],[data-fehler-zurueck],[data-fehler-senden],[data-fehler-loeschen],[data-wochenbericht],[data-code-setzen],[data-code-aendern],[data-code-entfernen]");
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
  else if (el.dataset.editSpule) editSpule(el.dataset.editSpule);
  else if (el.dataset.delSpule) delSpule(el.dataset.delSpule);
  else if (el.dataset.rezeptNeu) { state.rezeptForm = "neu"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezept) { state.rezept = el.dataset.rezept; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezeptZurueck) { state.rezeptForm = null; state.rezept = null; state.verlauf = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezeptSpeichern) speichereRezept();
  else if (el.dataset.rezeptBearbeiten) { state.rezeptForm = el.dataset.rezeptBearbeiten; render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlauf) { state.verlauf = el.dataset.verlauf; state.rezept = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlaufZurueck) { state.verlauf = null; state.rezept = el.dataset.verlaufZurueck; render(); window.scrollTo(0, 0); }
  else if (el.dataset.check) { if (!e.target.classList.contains("p-ist")) toggleCheck(el.dataset.check); }
  else if (el.dataset.ruestAbschluss) ruestAbschluss(el.dataset.ruestAbschluss);
  else if (el.dataset.gUebernehmen) { const g = gErmittelt(); if (g > 0) { document.getElementById("sp-g").value = fmt(g, 4); spRechne(); flash("G übernommen: " + fmt(g, 4) + " kg/km"); } else flash("Erst Gewicht und Länge der Spule eingeben."); }
  else if (el.dataset.export) exportData();
  else if (el.dataset.import) importData();
  else if (el.dataset.codeSetzen) codeSetzen();
  else if (el.dataset.codeAendern) codeAendern();
  else if (el.dataset.codeEntfernen) codeEntfernen();
  else if (el.dataset.fehlerZurueck) { state.overlay = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.fehlerSenden) sendeFehlerbericht();
  else if (el.dataset.fehlerLoeschen) { if (confirm("Fehlerliste leeren?")) { DB.set("fehler", []); aktualisiereFehlerBadge(); render(); } }
  else if (el.dataset.wochenbericht) wochenberichtMail();
});
document.getElementById("fehler-knopf").addEventListener("click", () => { state.overlay = "fehler"; render(); window.scrollTo(0, 0); });
document.getElementById("wochen-banner").addEventListener("click", wochenberichtMail);
document.addEventListener("input", e => {
  if (e.target.dataset && e.target.dataset.ist) { setzeIst(e.target.dataset.ist, e.target.value); return; }
  if (e.target.closest("#inhalt") && state.view === "spulen") spRechne();
});

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

/* ---------- Was ist neu (Änderungen je Version) ---------- */
const CHANGELOG = {
  "1.6": [
    "Zugangscode: App kann mit einem Code gesperrt werden (unter Mehr)",
    "Schützt die Daten, wenn das Gerät in fremde Hände gerät",
  ],
  "1.5": [
    "Neuer Bereich Rüsten: Draht-Rezepte je Typ (z. B. VSW 6×0,050)",
    "Beim Einrichten: einzustellende Werte abhaken (grün) und Ist-Wert eintragen",
    "Verlauf früherer Rüstungen zum Vergleichen",
  ],
  "1.4": [
    "Auto-Update: die App meldet selbst, wenn eine neue Version da ist",
    "Übersicht der Neuerungen nach jedem Update",
  ],
  "1.3": [
    "Vorzüge umschaltbar: alle zusammen oder vom kleinsten",
    "Faktor darf leer bleiben (zählt dann als 100 %)",
    "Gespeicherte Berechnungen bearbeiten und neu rechnen",
    "Automatischer Wochenbericht, wenn Fehler aufgelaufen sind",
  ],
};

function zeigeWasNeu() {
  const gesehen = DB.get("version_gesehen", null);
  if (gesehen === APP_VERSION) return;
  const ersterStart = (gesehen === null);
  DB.set("version_gesehen", APP_VERSION);
  const neu = CHANGELOG[APP_VERSION];
  if (ersterStart || !neu || !neu.length) return;  // beim allerersten Öffnen nichts zeigen
  document.getElementById("update-titel").textContent = "Aktualisiert auf Version " + APP_VERSION;
  document.getElementById("update-liste").innerHTML = neu.map(x => "<li>" + esc(x) + "</li>").join("");
  document.getElementById("update-dialog").hidden = false;
}
document.getElementById("update-ok").addEventListener("click", () => {
  document.getElementById("update-dialog").hidden = true;
});

/* ---------- Service Worker + Auto-Update ---------- */
function zeigeUpdateBanner(reg) {
  const b = document.getElementById("update-banner");
  b.textContent = "● Neue Version verfügbar – zum Aktualisieren tippen";
  b.classList.add("zeigen");
  b.onclick = () => {
    b.textContent = "Wird aktualisiert …";
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  };
}
if ("serviceWorker" in navigator) {
  let neugeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!neugeladen) { neugeladen = true; location.reload(); }  // neue Version aktiv -> neu laden
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) zeigeUpdateBanner(reg);
      reg.addEventListener("updatefound", () => {
        const neu = reg.installing;
        if (neu) neu.addEventListener("statechange", () => {
          if (neu.state === "installed" && navigator.serviceWorker.controller) zeigeUpdateBanner(reg);
        });
      });
      // stündlich auf neue Version prüfen, solange die App offen ist
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  });
}

/* ---------- Zugangssperre ---------- */
async function pinHash(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fz2-salt:" + code));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function starteApp() {
  zeige("maschinen");
  aktualisiereFehlerBadge();
  pruefeWochenbericht();
  zeigeWasNeu();
}
async function entsperren() {
  const code = document.getElementById("sperre-code").value;
  const hash = DB.get("pin_hash", null);
  if (code && await pinHash(code) === hash) {
    document.getElementById("sperre").hidden = true;
    document.getElementById("sperre-code").value = "";
    starteApp();
  } else {
    document.getElementById("sperre-fehler").textContent = "Falscher Code.";
    document.getElementById("sperre-code").value = "";
    document.getElementById("sperre-code").focus();
  }
}
function pruefeSperre() {
  if (DB.get("pin_hash", null)) {
    const s = document.getElementById("sperre");
    s.hidden = false;
    document.getElementById("sperre-code").focus();
  } else {
    starteApp();  // kein Code eingerichtet -> direkt starten
  }
}
document.getElementById("sperre-ok").addEventListener("click", entsperren);
document.getElementById("sperre-code").addEventListener("keydown", e => { if (e.key === "Enter") entsperren(); });

/* ---------- Start ---------- */
pruefeSperre();
