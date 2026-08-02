"use strict";

const APP_VERSION = "3.0";
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

/* ---------- Speicher: in-memory Vault (offen oder verschlüsselt) ---------- */
let VAULT = {};          // alle Daten im Arbeitsspeicher
let VAULT_CODE = null;   // gesetzt => wird verschlüsselt gespeichert
let vaultBereit = false; // erst true, wenn geladen – schützt vor Überschreiben mit Leerem
const DB = {
  get(key, def) { const v = VAULT[key]; return (v === undefined || v === null) ? def : v; },
  set(key, val) { VAULT[key] = val; persistiereVault(); },
};
function b64(u8) { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
function ub64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function leiteSchluessel(code, salt) {
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 150000, hash: "SHA-256" },
    mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function verschluessle(obj, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await leiteSchluessel(code, salt);
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(enc)) };
}
async function entschluessle(paket, code) {
  const key = await leiteSchluessel(code, ub64(paket.salt));
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ub64(paket.iv) }, key, ub64(paket.data));
  return JSON.parse(new TextDecoder().decode(dec));  // wirft bei falschem Code
}
let persistTimer = null;
function persistiereVault() {
  if (!vaultBereit) return;  // niemals vor dem Laden speichern
  if (VAULT_CODE) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      verschluessle(VAULT, VAULT_CODE).then(p => localStorage.setItem("sue_vault_enc", JSON.stringify(p))).catch(() => {});
    }, 60);
  } else {
    localStorage.setItem("sue_vault", JSON.stringify(VAULT));
  }
}
function ladePlainVault() {
  const plain = localStorage.getItem("sue_vault");
  if (plain) { try { return JSON.parse(plain); } catch (e) {} }
  // Migration aus einzelnen Keys älterer Versionen
  const v = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf("sue_") === 0 && k !== "sue_vault" && k !== "sue_vault_enc") {
      try { v[k.slice(4)] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
    }
  }
  return v;
}
function entries() { return DB.get("entries", []); }
function todos()   { return DB.get("todos", []); }
function spulen()  { return DB.get("spulen", []); }
function rezepte() { return DB.get("rezepte", []); }
function ruestungen() { return DB.get("ruestungen", []); }
function benutzerListe() { return DB.get("benutzer", []); }
function wer() { return DB.get("angemeldet", "") || ""; }

/* Erstmuster-Formulare des Drahtwerks. Je Formular die Werte, die der
   Maschinenbediener einstellt (im Blatt mit * gekennzeichnet). */
const FORMULARE = {
  "1350": {
    name: "Drahtzug 1350",
    beschreibung: "WPD-013 1350 · Niehoff MMH50 (z. B. Z68)",
    gruppen: [
      { gruppe: "Ablauf", felder: [
        { name: "Tänzer Ziehen", einheit: "bar/kg/mm" },
        { name: "Zugkraft Ablauf", einheit: "cN" },
      ] },
      { gruppe: "Ziehen", felder: [
        { name: "Ziehgeschwindigkeit", einheit: "m/s" },
        { name: "KSS-Ventil Konenbesprühung oben", einheit: "%" },
        { name: "KSS-Ventil Ziehsteinbesprühung oben", einheit: "%" },
        { name: "KSS-Ventil Konenbesprühung unten", einheit: "%" },
        { name: "KSS-Ventil Ziehsteinbesprühung unten", einheit: "%" },
        { name: "übersprungene Stufen", einheit: "" },
        { name: "Anzahl Drähte", einheit: "" },
        { name: "Enddurchmesser", einheit: "mm" },
        { name: "erster Dm schneller Teil", einheit: "mm" },
        { name: "letzter Dm langsamer Teil", einheit: "mm" },
        { name: "Schlupf", einheit: "%" },
      ] },
      { gruppe: "Glühe", felder: [
        { name: "Glühfaktor", einheit: "" },
        { name: "Glühspannung", einheit: "V" },
        { name: "Glühstrom", einheit: "A" },
        { name: "Luftdruck Glühe", einheit: "bar" },
        { name: "Ventilöffnung Druckluft", einheit: "%" },
        { name: "Trocknungssteine", einheit: "mm" },
        { name: "Kugelhahn Schutzgas", einheit: "%" },
        { name: "KSS-Ventil 1", einheit: "%" },
        { name: "KSS-Ventil 2", einheit: "%" },
        { name: "KSS-Ventil 3", einheit: "%" },
        { name: "KSS-Ventil 4", einheit: "%" },
      ] },
      { gruppe: "Spuler", felder: [
        { name: "Verlegung Hand/Automatik", einheit: "" },
        { name: "Spulengröße", einheit: "mm" },
        { name: "Tänzer Spuler", einheit: "g + mm" },
        { name: "Zugkraft Aufwickelspannung", einheit: "cN" },
        { name: "Verlegeschritt-Einstellung", einheit: "V + Sek" },
      ] },
    ],
  },
  "1341": {
    name: "Drahtzug 1341",
    beschreibung: "WPD-013 1341 · Niehoff M5",
    gruppen: [
      { gruppe: "Ablauf", felder: [
        { name: "Abwickelrichtung", einheit: "" },
        { name: "Tänzer Ziehen", einheit: "bar/kg/mm" },
        { name: "Zugkraft Ablauf", einheit: "cN" },
      ] },
      { gruppe: "Ziehen", felder: [
        { name: "Ziehgeschwindigkeit + Skala", einheit: "m/s" },
      ] },
      { gruppe: "Glühe", felder: [
        { name: "Glühfaktor", einheit: "" },
        { name: "Glühspannung", einheit: "V" },
        { name: "Glühstrom", einheit: "A" },
        { name: "Luftdruck Glühe", einheit: "bar" },
        { name: "Ventilöffnung Druckluft", einheit: "%" },
        { name: "Trocknungssteine", einheit: "mm" },
        { name: "Kugelhahn Dampf", einheit: "%" },
        { name: "KSS-Ventil Zulauf", einheit: "%" },
        { name: "KSS-Ventil Ablauf", einheit: "%" },
      ] },
      { gruppe: "Spuler", felder: [
        { name: "Verlegung Hand/Automatik", einheit: "" },
        { name: "Spulenkern-Einstellung", einheit: "mm" },
        { name: "Tänzer Spuler", einheit: "g + mm" },
        { name: "Zugkraft Aufwickelspannung", einheit: "cN" },
        { name: "Verlegeschritt-Einstellung", einheit: "Skala" },
        { name: "Verlegeschritt", einheit: "Sekunden" },
      ] },
    ],
  },
  "va013f3": {
    name: "Drahtzug allgemein",
    beschreibung: "VA-013F3 · älteres Formular",
    gruppen: [
      { gruppe: "Maschine", felder: [
        { name: "Geschwindigkeit Soll/Ist", einheit: "m/s" },
        { name: "Werkstoff Kontaktband", einheit: "Kupfer/Nickel" },
        { name: "Umlegung in der Maschine", einheit: "Anzahl" },
        { name: "Umlegung auf der Abzugscheibe", einheit: "Anzahl" },
      ] },
      { gruppe: "Glühe", felder: [
        { name: "Faktor (Glüh-/Bereichseinstellung)", einheit: "%" },
        { name: "Glühstrom", einheit: "A" },
        { name: "Glühspannung", einheit: "V" },
      ] },
      { gruppe: "Spuler", felder: [
        { name: "Zugspannung Spuler Soll/Ist", einheit: "cN" },
        { name: "Tänzer Gewichte Position/Skala", einheit: "mm" },
        { name: "Tänzer Luft", einheit: "bar" },
        { name: "Spulenkern Einstellung", einheit: "" },
        { name: "Verlegeschritt", einheit: "Sek" },
      ] },
      { gruppe: "Fettgehalt", felder: [
        { name: "Fettgehalt Modul 1", einheit: "%" },
        { name: "Fettgehalt Modul 2", einheit: "%" },
        { name: "Fettgehalt Modul 3", einheit: "%" },
        { name: "Fettgehalt Glühe", einheit: "%" },
      ] },
    ],
  },
};
const STANDARD_FORMULAR = "1350";
// Gruppen/Felder eines Formulars (unbekannte Kennung -> Standard)
function formularGruppen(id) { return (FORMULARE[id] || FORMULARE[STANDARD_FORMULAR]).gruppen; }
function formularFelder(id) { return formularGruppen(id).flatMap(g => g.felder); }
function formularName(id) { return (FORMULARE[id] || FORMULARE[STANDARD_FORMULAR]).name; }
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
const state = { view: "maschinen", maschine: null, overlay: null, rezept: null, rezeptForm: null, verlauf: null, vergleich: null };
let spModus = "summe";  // Berechnungsart der Vorzüge: "summe" | "kleinster"
let ruestSuche = "";    // Suchbegriff im Rüsten-Bereich
let spulenSuche = "";   // Suchbegriff für gespeicherte Berechnungen
let spAbzug = 0;        // Galvanik-Abzug je Vorzug in kg (0 / 5 / 7)
let spEditId = null;    // gesetzt, wenn eine gespeicherte Berechnung bearbeitet wird
const inhalt = document.getElementById("inhalt");
const titel = document.getElementById("kopf-titel");

function zeige(view) {
  state.view = view; state.overlay = null; state.maschine = null; state.rezept = null; state.rezeptForm = null; state.verlauf = null; state.vergleich = null;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("aktiv", t.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (state.overlay === "fehler") return renderFehler();
  if (state.view === "maschinen" && state.maschine) return renderMaschineDetail();
  if (state.view === "ruesten") {
    if (state.rezeptForm) return renderRezeptForm();
    if (state.vergleich) return renderRezeptVergleich();
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
    ? mitNotiz.map(e => `<div class="eintrag"><b>${e.machine}</b> <span class="stat" style="color:var(--${STATUS[e.status].farbe})">${STATUS[e.status].label}</span> – ${esc(e.note)}<div class="meta">${e.created_at}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div></div>`).join("")
    : `<div class="leer">Keine Notizen vorhanden.</div>`;

  inhalt.innerHTML = `<div class="grid">${kacheln}</div>
    <div class="karte"><h2>Maschinen-Status</h2>${status}</div>`;
}

function renderMaschineDetail() {
  const m = state.maschine;
  titel.innerHTML = `${m}`;
  const hist = entries().filter(e => e.machine === m).slice().reverse();
  let histHtml = hist.length
    ? hist.map(e => `<div class="eintrag"><span class="punkt d-${STATUS[e.status].farbe}"></span><span class="stat">${STATUS[e.status].label}</span>${e.note ? " – " + esc(e.note) : ""}<div class="meta">${e.created_at}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div></div>`).join("")
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
      <div class="meta">${t.created_at}${t.benutzer ? " · " + esc(t.benutzer) : ""}${t.done && t.done_at ? " · ✓ erledigt " + t.done_at + (t.done_von ? " von " + esc(t.done_von) : "") : ""}</div>
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
function spulenListeHtml() {
  const q = spulenSuche.trim().toLowerCase();
  const gefiltert = spulen().slice().reverse().filter(e => !q ||
    [e.auftrag, e.benutzer, e.created_at].join(" ").toLowerCase().indexOf(q) !== -1);
  if (!gefiltert.length) return `<div class="leer">${spulenSuche ? "Keine Berechnung gefunden." : "Noch keine Berechnung gespeichert."}</div>`;
  return gefiltert.map(e => `
    <div class="eintrag">
      <div><b>${e.auftrag ? "Auftrag " + esc(e.auftrag) : "(ohne Auftragsnummer)"}</b></div>
      <div style="font-size:.92rem">${e.anzahl_vz} VZ ${e.modus === "kleinster" ? "(vom kleinsten)" : "(zusammen)"} = <b>${fmt(e.gesamtmasse)} kg</b> · Faktor ${fmt(e.faktor, 0)} %
        → Endgewicht <b>${fmt(e.endgewicht)} kg</b> / <b>${fmt(e.endlaenge_m, 0)} m</b><br>
        ${e.anzahl_spulen} Fertigspulen → je <b>${fmt(e.gewicht_je_spule)} kg</b> / <b>${fmt(e.laenge_je_spule, 0)} m</b>
        ${e.geschwindigkeit ? "<br>Bei " + fmt(e.geschwindigkeit, 1) + " m/s → Laufzeit gesamt <b>" + hm(e.endlaenge_m / e.geschwindigkeit) + "</b> · je Spule <b>" + hm(e.laenge_je_spule / e.geschwindigkeit) + "</b>" : ""}
      </div>
      ${e.auftragsmenge ? `<div style="font-size:.92rem;color:${e.endgewicht >= e.auftragsmenge ? "var(--green)" : "var(--red)"}">
        ${e.endgewicht >= e.auftragsmenge ? "✓ reicht" : "✕ reicht nicht"} für ${fmt(e.auftragsmenge)} kg Auftrag
        (${e.endgewicht >= e.auftragsmenge ? "Reserve" : "fehlen"} ${fmt(Math.abs(e.endgewicht - e.auftragsmenge))} kg)</div>` : ""}
      <div class="meta">G = ${fmt(e.metergewicht, 4)} kg/km${e.abzug_je_vz ? " · Abzug " + fmt(e.abzug_je_vz, 0) + " kg/VZ" : ""} · ${e.created_at}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div>
      <button class="btn btn-klein" data-edit-spule="${e.id}" style="margin-top:6px">Bearbeiten</button>
      <button class="btn btn-klein btn-rot" data-del-spule="${e.id}" style="margin-top:6px;margin-left:6px">Löschen</button>
    </div>`).join("");
}

function renderSpulen() {
  titel.textContent = "Spulen-Berechnung";
  const vzFelder = Array.from({ length: 8 }, (_, i) =>
    `<div><div class="label">VZ ${i + 1}</div><input type="text" class="vz num" inputmode="decimal" placeholder="kg"></div>`).join("");
  const liste = spulenListeHtml();

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
      <h2>Abzug bei Galvanik-Vorzug</h2>
      <p class="hinweis" style="margin-top:0">Bei Korb- oder Spulenvorzug aus der Nickel- oder Silbergalvanik wird je Vorzug ein fester Wert abgezogen.</p>
      <div class="modus" style="grid-template-columns:repeat(3,1fr)">
        <button type="button" data-abzug="0" class="${spAbzug === 0 ? "aktiv" : ""}">kein Abzug<small>normal</small></button>
        <button type="button" data-abzug="5" class="${spAbzug === 5 ? "aktiv" : ""}">Ø 1,56<small>−5 kg je VZ</small></button>
        <button type="button" data-abzug="7" class="${spAbzug === 7 ? "aktiv" : ""}">Ø 2,10<small>−7 kg je VZ</small></button>
      </div>
      <div class="hinweis" id="sp-abzug-hint"></div>
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
      <div class="label" style="margin-top:10px">Auftragsmenge (kg) <span style="color:var(--grau)">(optional – prüft, ob der Vorzug reicht)</span></div>
      <div class="schmal"><input type="text" id="sp-auftragsmenge" class="num" inputmode="decimal" placeholder="z. B. 348"></div>
    </div>
    <div class="karte" id="sp-ampel-karte" style="display:none">
      <div id="sp-ampel"></div>
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
    <div class="karte"><h2>Gespeicherte Berechnungen</h2>
      <input type="text" id="spulen-suche" placeholder="Auftragsnummer suchen …" value="${esc(spulenSuche)}">
      <div id="spulen-liste" style="margin-top:10px">${liste}</div></div>`;
  spRechne();
}

function spVal(id) { const el = document.getElementById(id); return el ? zahl(el.value) : 0; }
function spRechne() {
  if (!document.getElementById("sp-summe")) return;   // Maske nicht auf dem Bildschirm
  const G = spVal("sp-g"), nSpulen = spVal("sp-nspulen"), v = spVal("sp-v");
  let faktor = spVal("sp-faktor"); if (faktor <= 0) faktor = 100;  // leer/0 = kein Abzug
  document.getElementById("sp-g-hint").textContent = G > 0 ? `1 km wiegt ${fmt(G, 4)} kg · 1 kg = ${fmt(1000 / G, 1)} m` : "Wert von der Prüfkarte eintragen (Spalte G, kg/km).";
  const vzRoh = [];
  document.querySelectorAll(".vz").forEach(el => { const w = zahl(el.value); if (w > 0) vzRoh.push(w); });
  const aktiv = vzRoh.length;
  const summeRoh = vzRoh.reduce((a, b) => a + b, 0);
  // Galvanik-Abzug wird je Vorzug abgezogen (laut Schulungsblatt Drahtwerk Waidhaus)
  const vzWerte = vzRoh.map(w => Math.max(0, w - spAbzug));
  const summe = vzWerte.reduce((a, b) => a + b, 0);
  const kleinster = aktiv ? Math.min(...vzWerte) : 0;
  const massKleinster = kleinster * aktiv;
  const abzugHint = document.getElementById("sp-abzug-hint");
  if (abzugHint) abzugHint.textContent = (spAbzug > 0 && aktiv)
    ? `${aktiv} Vorzüge × ${spAbzug} kg = ${fmt(spAbzug * aktiv, 0)} kg Abzug · ${fmt(summeRoh)} kg → ${fmt(summe)} kg`
    : "";
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

  // Reicht der Vorzug für den Auftrag? (Schulungsblatt: genau das wird oft nicht geprüft)
  const auftragsmenge = spVal("sp-auftragsmenge");
  const karte = document.getElementById("sp-ampel-karte");
  const ampel = document.getElementById("sp-ampel");
  if (karte && ampel) {
    if (auftragsmenge > 0 && eg > 0) {
      const diff = eg - auftragsmenge;
      const reicht = diff >= 0;
      ampel.innerHTML = `
        <div class="ampel ${reicht ? "gut" : "schlecht"}">
          <div class="ampel-titel">${reicht ? "✓ Vorzug reicht aus" : "✕ Vorzug reicht NICHT"}</div>
          <div class="ampel-zahl">${reicht ? "Reserve" : "Es fehlen"} ${fmt(Math.abs(diff))} kg</div>
          <div class="ampel-zeile">Auftragsmenge <b>${fmt(auftragsmenge)} kg</b> · machbar <b>${fmt(eg)} kg</b>
            (${nSpulen > 0 ? fmt(nSpulen, 0) + " Spulen × " + fmt(sKg) + " kg" : "–"})</div>
        </div>`;
      karte.style.display = "";
    } else {
      karte.style.display = "none";
    }
  }
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
  const vzNetto = vz.map(w => Math.max(0, w - spAbzug));   // Galvanik-Abzug je Vorzug
  const summe = vzNetto.reduce((a, b) => a + b, 0);
  const gesamt = spModus === "kleinster" ? Math.min(...vzNetto) * vzNetto.length : summe;
  const eg = gesamt * faktor / 100;
  const auftragsmenge = spVal("sp-auftragsmenge");
  const eintrag = {
    id: neueId(), auftrag: document.getElementById("sp-auftrag").value.trim().slice(0, 50),
    metergewicht: G, vz_gewichte: vz, anzahl_vz: vz.length, gesamtmasse: gesamt,
    modus: spModus, summe_alle: summe, faktor: faktor,
    abzug_je_vz: spAbzug, auftragsmenge: auftragsmenge > 0 ? auftragsmenge : null,
    endgewicht: eg, endlaenge_m: eg / G * 1000, anzahl_spulen: nSpulen,
    gewicht_je_spule: eg / nSpulen, laenge_je_spule: eg / nSpulen / G * 1000,
    geschwindigkeit: v > 0 ? v : null, benutzer: wer(), created_at: jetzt(),
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
  document.getElementById("sp-auftragsmenge").value = e.auftragsmenge ? deStr(e.auftragsmenge) : "";
  spAbzug = e.abzug_je_vz || 0;
  document.querySelectorAll("[data-abzug]").forEach(b => b.classList.toggle("aktiv", parseFloat(b.dataset.abzug) === spAbzug));
  const felder = document.querySelectorAll(".vz");
  felder.forEach((el, i) => el.value = (e.vz_gewichte && e.vz_gewichte[i] != null) ? deStr(e.vz_gewichte[i]) : "");
  document.querySelectorAll(".modus button").forEach(b => b.classList.toggle("aktiv", b.dataset.modus === spModus));
  spRechne();
  window.scrollTo(0, 0);
  flash("Werte geladen – ändern und erneut speichern.");
}

/* ---------- Ansicht: Rüsten (Draht-Rezepte + Checkliste) ---------- */
function ruestListeHtml() {
  const q = ruestSuche.trim().toLowerCase();
  const rz = rezepte().slice().reverse().filter(r => !q ||
    [r.kuerzel, r.aufbau, r.klartext, r.maschine, r.beispiel_auftrag].join(" ").toLowerCase().indexOf(q) !== -1);
  if (!rz.length) return `<div class="leer">${ruestSuche ? "Kein Muster gefunden." : "Noch kein Draht-Rezept angelegt."}</div>`;
  return rz.map(r => {
    const soll = r.soll || {}, status = r.ruest_status || {};
    const g = Object.keys(soll).filter(k => soll[k] !== "").length;
    const ok = Object.values(status).filter(s => s && s.erledigt).length;
    const badge = ok > 0 ? `<span class="rz-fort">${ok}/${g} gerüstet</span>` : "";
    const vers = (r.historie && r.historie.length) ? `<span class="rz-vers">${r.historie.length + 1} Stände</span>` : "";
    return `<div class="eintrag rz-eintrag" data-rezept="${r.id}">
      <div><b>${esc(r.kuerzel)}</b> · ${esc(r.aufbau)} ${badge} ${vers}</div>
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}${r.beispiel_auftrag ? " · Auftrag " + esc(r.beispiel_auftrag) : ""} · ${esc(formularName(r.formular))}</div>
    </div>`;
  }).join("");
}
function renderRuesten() {
  titel.textContent = "Rüsten";
  inhalt.innerHTML = `
    <div class="karte">
      <input type="text" id="ruest-suche" placeholder="Suchen: Kürzel, Aufbau, Maschine, Auftrag …" value="${esc(ruestSuche)}">
      <button class="btn" data-rezept-neu="1" style="margin-top:10px">+ Neues Draht-Rezept</button>
    </div>
    <div class="karte"><h2>Muster</h2><div id="ruest-liste">${ruestListeHtml()}</div></div>`;
}

/* Assistent zum Anlegen/Ändern eines Musters – Schritt für Schritt, Werte antippen statt tippen */
let wiz = null;   // { phase: "start"|"vorlage"|"schritte", schritt, werte:{}, stamm:{} }

function wizStart(id) {
  if (id === "neu") {
    wiz = { phase: "start", schritt: 0, werte: {}, stamm: {}, formular: STANDARD_FORMULAR };
  } else {
    const r = rezepte().find(x => x.id === id) || {};
    wiz = { phase: "schritte", schritt: 0, werte: Object.assign({}, r.soll || {}),
      formular: r.formular || STANDARD_FORMULAR,
      stamm: { kuerzel: r.kuerzel || "", aufbau: r.aufbau || "", klartext: r.klartext || "",
               maschine: r.maschine || "", beispiel_auftrag: r.beispiel_auftrag || "" } };
  }
}

function renderRezeptForm() {
  if (!wiz) wizStart(state.rezeptForm);
  if (wiz.phase === "start") return renderWizStart();
  if (wiz.phase === "vorlage") return renderWizVorlage();
  return renderWizSchritt();
}

function renderWizStart() {
  titel.textContent = "Neues Muster";
  const gibtVorlagen = rezepte().length > 0;
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-rezept-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>Wie möchtest du anfangen?</h2>
      ${gibtVorlagen ? `<button class="grossbtn" data-wiz-vorlage="1">Wie ein vorhandenes Muster
        <small>Alles wird übernommen – du änderst nur, was anders ist.</small></button>` : ""}
      <button class="grossbtn" data-wiz-leer="1">Ganz neu anlegen
        <small>${gibtVorlagen ? "Nur nötig, wenn es nichts Ähnliches gibt." : "Das erste Muster anlegen."}</small></button>
    </div>`;
}

function renderWizVorlage() {
  titel.textContent = "Vorlage wählen";
  const liste = rezepte().slice().reverse().map(r =>
    `<button class="grossbtn" data-wiz-kopie="${r.id}">${esc(r.kuerzel)} · ${esc(r.aufbau)}
      <small>${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}</small></button>`).join("");
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-wiz-zurueck-start="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px"><h2>Welches Muster ist ähnlich?</h2>${liste}</div>`;
}

function renderWizSchritt() {
  const gruppen = formularGruppen(wiz.formular);
  const gesamt = gruppen.length + 1;   // Schritt 0 = Draht-Typ, dann die Gruppen
  const s = wiz.schritt;
  titel.textContent = state.rezeptForm === "neu" ? "Neues Muster" : "Muster ändern";
  const punkte = Array.from({ length: gesamt }, (_, i) => `<div class="wpunkt ${i <= s ? "an" : ""}"></div>`).join("");
  const kopf = `<div class="wschritte">${punkte}</div>
    <div class="wschritt-text">Schritt ${s + 1} von ${gesamt}</div>`;

  let inhaltHtml, gruppenName;
  if (s === 0) {
    gruppenName = "Draht-Typ";
    const st = wiz.stamm;
    inhaltHtml = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Kurzbezeichnung</label><input type="text" class="wiz-stamm" data-stamm="kuerzel" value="${esc(st.kuerzel)}" placeholder="z. B. VSW"></div>
        <div><label>Aufbau</label><input type="text" class="wiz-stamm" data-stamm="aufbau" value="${esc(st.aufbau)}" placeholder="z. B. 6×0,050"></div>
      </div>
      <label>Klartext</label><input type="text" class="wiz-stamm" data-stamm="klartext" value="${esc(st.klartext)}" placeholder="z. B. versilbert weich">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Maschine</label><input type="text" class="wiz-stamm" data-stamm="maschine" value="${esc(st.maschine)}" placeholder="z. B. Z49"></div>
        <div><label>Auftrag</label><input type="text" class="wiz-stamm" data-stamm="beispiel_auftrag" value="${esc(st.beispiel_auftrag)}"></div>
      </div>
      <div class="label" style="margin-top:12px">Erstmuster-Formular</div>
      <p class="hinweis" style="margin-top:0">Bestimmt, welche Werte in den nächsten Schritten abgefragt werden.</p>
      ${Object.keys(FORMULARE).map(k => `<button type="button" class="formwahl ${wiz.formular === k ? "aktiv" : ""}" data-formular="${k}">
        ${esc(FORMULARE[k].name)}<small>${esc(FORMULARE[k].beschreibung)}</small></button>`).join("")}`;
  } else {
    const g = gruppen[s - 1];
    gruppenName = g.gruppe;
    inhaltHtml = g.felder.map((f, idx) => {
      const gewaehlt = wiz.werte[f.name] || "";
      const vorschlaege = vorhandeneWerte(f.name);
      const chips = vorschlaege.map(w =>
        `<button type="button" class="wchip ${gewaehlt === w ? "aktiv" : ""}" data-wiz-wert="${esc(f.name)}" data-wert="${esc(w)}">${esc(w)}</button>`).join("");
      const eigener = (gewaehlt && vorschlaege.indexOf(gewaehlt) === -1) ? gewaehlt : "";
      return `<div class="wfeld">
        <div class="wfrage">${esc(f.name)} ${f.einheit ? `<span class="weinheit">(${f.einheit})</span>` : ""}</div>
        <div class="wchips">${chips}<button type="button" class="wchip anderer" data-wiz-eigen="${idx}">anderer Wert…</button></div>
        <div class="weigen ${eigener ? "zeigen" : ""}" id="weigen-${idx}">
          <input type="text" inputmode="decimal" class="wiz-eigen" data-feld="${esc(f.name)}" value="${esc(eigener)}" placeholder="Wert eintippen">
        </div>
      </div>`;
    }).join("");
  }

  const letzter = (s === gesamt - 1);
  inhalt.innerHTML = `
    <div class="karte">
      ${kopf}
      <h2>${esc(gruppenName)}</h2>
      ${inhaltHtml}
      <div class="wnav">
        <button class="btn btn-grau" data-wiz-zurueck="1">Zurück</button>
        <button class="btn ${letzter ? "btn-gruen" : ""}" data-wiz-weiter="1">${letzter ? "Fertig" : "Weiter"}</button>
      </div>
    </div>`;
}

function wizWeiter() {
  const gesamt = formularGruppen(wiz.formular).length + 1;
  if (wiz.schritt < gesamt - 1) { wiz.schritt++; render(); window.scrollTo(0, 0); }
  else speichereRezept();
}
function wizZurueck() {
  if (wiz.schritt > 0) { wiz.schritt--; render(); window.scrollTo(0, 0); }
  else if (state.rezeptForm === "neu") { wiz.phase = "start"; render(); window.scrollTo(0, 0); }
  else { wiz = null; state.rezeptForm = null; render(); window.scrollTo(0, 0); }
}

function renderRuestCheck() {
  const r = rezepte().find(x => x.id === state.rezept);
  if (!r) { state.rezept = null; return render(); }
  titel.textContent = r.kuerzel + " " + r.aufbau;
  const soll = r.soll || {}, status = r.ruest_status || {};
  const felder = formularFelder(r.formular).filter(f => soll[f.name] != null && soll[f.name] !== "");
  const g = felder.length, ok = felder.filter(f => status[f.name] && status[f.name].erledigt).length;
  const punkte = felder.map(f => {
    const st = status[f.name] || {};
    return `<div class="rpunkt ${st.erledigt ? "ok" : ""}" data-check="${esc(f.name)}">
      <div class="p-box">${st.erledigt ? "✓" : ""}</div>
      <div class="p-body">
        <div class="p-kopf">
          <span class="p-name">${esc(f.name)}</span>
          <span class="p-soll">Soll <b>${esc(soll[f.name])}</b>${f.einheit ? ` <span class="p-einheit">${esc(f.einheit)}</span>` : ""}</span>
        </div>
        <input type="text" class="p-ist" data-ist="${esc(f.name)}" value="${st.ist != null ? esc(st.ist) : ""}" placeholder="Ist-Wert eintragen (optional)">
      </div>
    </div>`;
  }).join("");
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-rezept-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""} · ${esc(formularName(r.formular))}</div>
      <div class="fortschritt"><span class="fz">${ok} / ${g} eingestellt</span><div class="balken"><div style="width:${g ? ok / g * 100 : 0}%"></div></div></div>
      ${g > 0 && g === ok ? '<div class="rz-fertig">✓ Alles eingestellt – Maschine ist gerüstet</div>' : ""}
    </div>
    <div class="karte"><h2>Einzustellende Werte</h2>
      ${punkte || '<div class="leer">Keine Werte hinterlegt. Rezept bearbeiten und Sollwerte eintragen.</div>'}</div>
    <div class="karte" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-klein" data-rezept-bearbeiten="${r.id}">Rezept bearbeiten</button>
      <button class="btn btn-klein btn-grau" data-vergleich="${r.id}">Änderungen</button>
      <button class="btn btn-klein btn-grau" data-verlauf="${r.id}">Rüst-Verlauf</button>
      <button class="btn btn-klein" data-erstmuster="${r.id}">Erstmuster senden</button>
      ${g > 0 ? `<button class="btn btn-klein" data-ruest-abschluss="${r.id}">Rüstung abschließen</button>` : ""}
    </div>`;
}

function renderVerlauf() {
  const r = rezepte().find(x => x.id === state.verlauf);
  titel.textContent = "Verlauf";
  const eintraege = ruestungen().filter(x => x.rezept_id === state.verlauf).slice().reverse();
  const liste = eintraege.length ? eintraege.map(e => {
    const zeilen = formularFelder(r && r.formular).filter(f => e.ist && e.ist[f.name]).map(f => {
      const i = e.ist[f.name];
      return `<div class="v-zeile"><span>${esc(f.name)}</span><span>Soll ${esc(i.soll || "–")} · Ist <b>${esc(i.wert || "–")}</b></span></div>`;
    }).join("");
    return `<div class="eintrag"><div><b>${e.datum}</b>${e.maschine ? " · " + esc(e.maschine) : ""}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div>${zeilen || '<div class="meta">keine Ist-Werte notiert</div>'}</div>`;
  }).join("") : `<div class="leer">Noch keine abgeschlossene Rüstung.</div>`;
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-verlauf-zurueck="${r ? r.id : ''}">‹ Zurück</button>
    <div class="karte" style="margin-top:12px"><h2>${r ? esc(r.kuerzel + " " + r.aufbau) : "Verlauf"} – frühere Rüstungen</h2>${liste}</div>`;
}

// Werte, die für dieses Feld schon benutzt wurden – häufigste zuerst (für die Auswahlknöpfe)
function vorhandeneWerte(feldName) {
  const zaehler = {};
  rezepte().forEach(r => {
    const v = (r.soll || {})[feldName];
    if (v) zaehler[v] = (zaehler[v] || 0) + 1;
    (r.historie || []).forEach(h => { const hv = (h.soll || {})[feldName]; if (hv) zaehler[hv] = (zaehler[hv] || 0) + 1; });
  });
  return Object.keys(zaehler).sort((a, b) => zaehler[b] - zaehler[a]).slice(0, 6);
}

function diffFelder(alt, neu) {
  const meta = [["kuerzel", "Kürzel"], ["aufbau", "Aufbau"], ["klartext", "Klartext"], ["maschine", "Maschine"], ["beispiel_auftrag", "Auftrag"], ["formular", "Formular"]];
  const aend = [];
  meta.forEach(mm => { const f = mm[0]; if ((alt[f] || "") !== (neu[f] || "")) aend.push({ feld: mm[1], alt: alt[f] || "–", neu: neu[f] || "–" }); });
  const keys = Array.from(new Set(Object.keys(alt.soll || {}).concat(Object.keys(neu.soll || {}))));
  keys.forEach(k => { const a = (alt.soll || {})[k] || "", n = (neu.soll || {})[k] || ""; if (a !== n) aend.push({ feld: k, alt: a || "–", neu: n || "–" }); });
  return aend;
}
function renderRezeptVergleich() {
  const r = rezepte().find(x => x.id === state.vergleich);
  if (!r) { state.vergleich = null; return render(); }
  titel.textContent = "Änderungen";
  const historie = r.historie || [];
  const aktuell = { soll: r.soll, kuerzel: r.kuerzel, aufbau: r.aufbau, klartext: r.klartext, maschine: r.maschine, beispiel_auftrag: r.beispiel_auftrag, stand_vom: r.geaendert_am || r.created_at, geaendert_von: r.geaendert_von || r.benutzer || '', istAktuell: true };
  const staende = historie.concat([aktuell]);
  let html;
  if (staende.length < 2) {
    html = `<div class="leer">Noch keine Änderung – nur der ursprüngliche Stand vom ${esc(aktuell.stand_vom)}.</div>`;
  } else {
    const bloecke = [];
    for (let i = staende.length - 1; i >= 1; i--) {
      const neu = staende[i], alt = staende[i - 1];
      const aend = diffFelder(alt, neu);
      const zeilen = aend.map(a => `<div class="v-zeile"><span>${esc(a.feld)}</span><span><span class="alt-wert">${esc(a.alt)}</span> → <b>${esc(a.neu)}</b></span></div>`).join("");
      bloecke.push(`<div class="eintrag"><div><b>Geändert am ${esc(neu.stand_vom || "?")}</b>${neu.geaendert_von ? " · " + esc(neu.geaendert_von) : ""}${neu.istAktuell ? " · aktueller Stand" : ""}</div>${zeilen || '<div class="meta">keine Wertänderung</div>'}</div>`);
    }
    html = bloecke.join("");
  }
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-vergleich-zurueck="${r.id}">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>${esc(r.kuerzel + " " + r.aufbau)} – Änderungsverlauf</h2>
      <p class="hinweis" style="margin-top:0">${staende.length} ${staende.length === 1 ? "Stand" : "Stände"} gespeichert. Jeder Block zeigt, was sich geändert hat.</p>
      ${html}
    </div>`;
}

function speichereRezept() {
  const st = wiz.stamm;
  const kuerzel = (st.kuerzel || "").trim(), aufbau = (st.aufbau || "").trim();
  if (!kuerzel && !aufbau) {
    wiz.schritt = 0; render(); window.scrollTo(0, 0);
    return flash("Bitte Kurzbezeichnung oder Aufbau angeben.");
  }
  const soll = {};
  Object.keys(wiz.werte).forEach(k => { const v = String(wiz.werte[k] || "").trim(); if (v) soll[k] = v; });
  const daten = {
    kuerzel: kuerzel, aufbau: aufbau, formular: wiz.formular || STANDARD_FORMULAR,
    klartext: (st.klartext || "").trim(),
    maschine: (st.maschine || "").trim(),
    beispiel_auftrag: (st.beispiel_auftrag || "").trim(),
    soll: soll,
  };
  const list = rezepte();
  const id = state.rezeptForm;
  if (id !== "neu") {
    const r = list.find(x => x.id === id);
    if (r) {
      const alt = { soll: r.soll, kuerzel: r.kuerzel, aufbau: r.aufbau, klartext: r.klartext, maschine: r.maschine, beispiel_auftrag: r.beispiel_auftrag, formular: r.formular };
      const neu = { soll: daten.soll, kuerzel: daten.kuerzel, aufbau: daten.aufbau, klartext: daten.klartext, maschine: daten.maschine, beispiel_auftrag: daten.beispiel_auftrag, formular: daten.formular };
      if (JSON.stringify(alt) !== JSON.stringify(neu)) {
        // nur bei echter Änderung: alten Stand in die Historie sichern
        if (!r.historie) r.historie = [];
        r.historie.push(Object.assign({}, alt, { stand_vom: r.geaendert_am || r.created_at, geaendert_von: r.geaendert_von || r.benutzer || '' }));
        Object.assign(r, daten);
        r.geaendert_am = jetzt(); r.geaendert_von = wer();
      }
    }
  } else {
    list.push({ id: neueId(), ...daten, ruest_status: {}, historie: [], benutzer: wer(), created_at: jetzt(), geaendert_am: jetzt() });
  }
  DB.set("rezepte", list);
  state.rezeptForm = null; wiz = null;
  flash("Muster gespeichert."); render(); window.scrollTo(0, 0);
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
  formularFelder(r.formular).filter(f => soll[f.name] != null && soll[f.name] !== "").forEach(f => {
    const st = status[f.name] || {};
    ist[f.name] = { soll: soll[f.name], wert: st.ist || "", erledigt: !!st.erledigt };
  });
  const rl = ruestungen();
  rl.push({ id: neueId(), rezept_id: id, kuerzel: r.kuerzel, maschine: r.maschine, benutzer: wer(), datum: jetzt(), ist: ist });
  DB.set("ruestungen", rl);
  r.ruest_status = {};  // für die nächste Rüstung zurücksetzen
  DB.set("rezepte", list);
  flash("Rüstung im Verlauf gespeichert."); render(); window.scrollTo(0, 0);
}

/* ---------- Erstmuster als PDF verschicken ---------- */
async function sendeErstmuster(id) {
  const r = rezepte().find(x => x.id === id);
  if (!r) return;
  let blob;
  try { blob = erstmusterPdf(r); }
  catch (e) { logFehler("PDF", e.message, e.stack); return flash("PDF konnte nicht erstellt werden."); }

  const name = "Erstmuster_" + (r.kuerzel || "Muster").replace(/[^\wäöüÄÖÜß-]/g, "") +
    (r.aufbau ? "_" + r.aufbau.replace(/[^\w,-]/g, "") : "") + ".pdf";
  const datei = new File([blob], name, { type: "application/pdf" });
  const text = "Erstmuster " + [r.kuerzel, r.aufbau, r.klartext].filter(Boolean).join(" ")
    + (r.maschine ? " · " + r.maschine : "")
    + (r.beispiel_auftrag ? " · Auftrag " + r.beispiel_auftrag : "")
    + "\nFormular: " + formularName(r.formular) + "\nErstellt: " + jetzt() + " von " + (wer() || "-");

  if (navigator.canShare && navigator.canShare({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: name, text: text }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }   // Nutzer hat abgebrochen
  }
  // Kein Teilen möglich -> Datei ablegen, damit sie von Hand angehängt werden kann
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  flash("PDF gespeichert – von dort an die Mail anhängen.");
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
      <h2>Benutzer</h2>
      <p class="hinweis" style="margin-top:0">Angemeldet als <b>${esc(wer() || "–")}</b>. Jeder Eintrag wird mit dem Namen vermerkt.</p>
      <button class="btn btn-grau" data-abmelden="1">Abmelden</button>
      <div class="label" style="margin-top:14px">Vorhandene Benutzer</div>
      ${benutzerListe().map(b => `<div class="eintrag" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${esc(b.name)}${b.name === wer() ? " <span class=\"meta\">(du)</span>" : ""}</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-klein btn-grau" data-pw-aendern="${esc(b.name)}">Passwort</button>
          ${b.name === wer() ? "" : `<button class="btn btn-klein btn-rot" data-benutzer-loeschen="${esc(b.name)}">Löschen</button>`}
        </span></div>`).join("")}
      <div class="label" style="margin-top:14px">Neuen Benutzer anlegen</div>
      <input type="text" id="nb-name" placeholder="Name" autocapitalize="none">
      <input type="password" id="nb-pw" placeholder="Passwort" style="margin-top:8px">
      <button class="btn" data-benutzer-neu="1" style="margin-top:10px">Benutzer anlegen</button>
    </div>
    <div class="karte">
      <h2>Darstellung</h2>
      <p class="hinweis" style="margin-top:0">Größere Schrift und größere Knöpfe – gut für die Halle.</p>
      <button class="btn ${DB.get("grossschrift", false) ? "" : "btn-grau"}" data-grossschrift="1">
        Große Schrift: ${DB.get("grossschrift", false) ? "AN" : "AUS"}</button>
    </div>
    <div class="karte">
      <h2>Verschlüsselung &amp; Code</h2>
      ${VAULT_CODE
        ? `<p class="hinweis" style="margin-top:0">✓ Die Daten sind <b>verschlüsselt</b>. Beim Öffnen muss der Code eingegeben werden – ohne ihn sind die Daten nicht lesbar.</p>
           <button class="btn btn-grau" data-code-aendern="1">Code ändern</button>
           <button class="btn btn-grau btn-klein" data-code-entfernen="1" style="margin-top:8px">Verschlüsselung entfernen</button>`
        : `<p class="hinweis" style="margin-top:0">Die Daten liegen aktuell <b>unverschlüsselt</b> auf dem Gerät. Mit einem Code werden sie verschlüsselt – niemand ohne Code kommt dann heran.</p>
           <input type="password" id="code-neu" inputmode="numeric" maxlength="12" placeholder="Code festlegen (Zahlen)">
           <button class="btn" data-code-setzen="1" style="margin-top:10px">Verschlüsselung aktivieren</button>
           <p class="hinweis">Vorher unbedingt eine Sicherung machen und den Code sicher notieren – Code weg = Daten weg.</p>`}
    </div>
    <div class="karte">
      <h2>Was wurde geändert</h2>
      <p class="hinweis" style="margin-top:0">Aktuelle Version <b>${APP_VERSION}</b> · Updates werden automatisch eingespielt.</p>
      ${Object.keys(CHANGELOG).map(v => `<div class="eintrag">
        <div><b>Version ${esc(v)}</b>${v === APP_VERSION ? ' <span class="rz-fort">aktuell</span>' : ""}</div>
        <ul style="margin:6px 0 0;padding-left:20px;font-size:.88rem">${CHANGELOG[v].map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>`).join("")}
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
  if (!confirm("Verschlüsselung aktivieren?\n\nWICHTIG: Ohne diesen Code sind die Daten NICHT mehr lesbar. Notiere ihn sicher und mach vorher eine Sicherung (Datei-Sicherung oben).")) return;
  VAULT_CODE = code;
  localStorage.setItem("sue_vault_enc", JSON.stringify(await verschluessle(VAULT, code)));
  raeumeAltePlainKeys();
  flash("Verschlüsselung aktiv."); render();
}
async function codeAendern() {
  const code = (prompt("Neuer Code (mind. 4 Zeichen):") || "").trim();
  if (!code) return;
  if (code.length < 4) return flash("Bitte mindestens 4 Zeichen.");
  VAULT_CODE = code;
  localStorage.setItem("sue_vault_enc", JSON.stringify(await verschluessle(VAULT, code)));
  flash("Code geändert.");
}
async function codeEntfernen() {
  if (!confirm("Verschlüsselung entfernen? Die Daten liegen dann unverschlüsselt auf dem Gerät.")) return;
  VAULT_CODE = null;
  localStorage.removeItem("sue_vault_enc");
  localStorage.setItem("sue_vault", JSON.stringify(VAULT));
  flash("Verschlüsselung entfernt."); render();
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
      <h2>Fehler melden</h2>
      <p class="hinweis" style="margin-top:0">Nur kurz beschreiben, was nicht stimmt – alles andere hat die App schon automatisch erfasst.</p>
      <textarea id="f-text" placeholder="z. B. Endgewicht war falsch, nachdem ich VZ 3 gelöscht habe"></textarea>
      <div class="label">Bildschirmfoto anhängen (empfohlen)</div>
      <p class="hinweis" style="margin-top:0">Am iPhone: Seitentaste + Lauter gleichzeitig drücken, dann hier auswählen.</p>
      <input type="file" id="f-foto" accept="image/*">
      <button class="btn" data-fehler-senden="1" style="margin-top:12px">Per E-Mail senden</button>
      <p class="hinweis">Die Mail an ${esc(REPORT_MAIL)} wird fertig ausgefüllt geöffnet – nur noch auf Senden tippen.</p>
      <div class="label" style="margin-top:12px">Kein Mailprogramm? Dann so:</div>
      <button class="btn btn-grau btn-klein" data-fehler-teilen="1">Teilen (WhatsApp, Signal …)</button>
      <button class="btn btn-grau btn-klein" data-fehler-kopieren="1" style="margin-left:6px">Text kopieren</button>
    </div>
    <div class="karte">
      <h2>Automatisch erfasst</h2>
      <p class="hinweis" style="margin-top:0">Das schickt die App von selbst mit – du musst nichts eintragen.</p>
      <div class="eintrag">
        <div><b>Bildschirm:</b> ${bildschirmSchnappschuss ? esc(bildschirmSchnappschuss.titel) : "–"}</div>
        <div class="meta">${bildschirmSchnappschuss ? esc(bildschirmSchnappschuss.ansicht) : ""}</div>
      </div>
      ${bildschirmSchnappschuss && bildschirmSchnappschuss.eingaben.length
        ? `<div class="eintrag"><div><b>Eingaben:</b></div><div class="meta">${esc(bildschirmSchnappschuss.eingaben.join(" · "))}</div></div>` : ""}
      <div class="eintrag"><div><b>Benutzer:</b> ${esc(wer() || "–")} · <b>Version:</b> ${APP_VERSION}</div></div>
      <div class="eintrag"><div><b>Erfasste Programmfehler:</b> ${fehler.length}</div></div>
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

function berichtText(beschreibung) {
  const s = bildschirmSchnappschuss;
  const f = DB.get("fehler", []);
  let t = "FEHLERMELDUNG – Schichtübergabe (fz2-tool)\n";
  t += "================================\n";
  t += "Beschreibung: " + (beschreibung || "(keine)") + "\n\n";
  t += "Benutzer: " + (wer() || "–") + "\n";
  t += "Zeit: " + jetzt() + "\n";
  t += "App-Version: " + APP_VERSION + "\n";
  if (s) {
    t += "\n--- Bildschirm beim Fehler ---\n";
    t += "Ansicht: " + s.titel + " (" + s.ansicht + ")\n";
    if (s.eingaben.length) t += "Eingaben: " + s.eingaben.join(" | ") + "\n";
    t += "\nAngezeigter Inhalt:\n" + s.sichtbar + "\n";
  }
  if (f.length) {
    t += "\n--- Automatisch erfasste Programmfehler (" + f.length + ") ---\n";
    f.slice(-8).forEach((x, i) => { t += (i + 1) + ") " + x.zeit + " [" + x.ansicht + "] " + x.art + ": " + String(x.nachricht).slice(0, 200) + "\n"; });
  }
  t += "\n--- Gerät ---\n" + (navigator.userAgent || "") + "\n";
  t += "Daten: " + entries().length + " Maschinen-Einträge, " + todos().length + " Aufgaben, "
     + spulen().length + " Berechnungen, " + rezepte().length + " Muster\n";
  return t;
}

// Teilen: geht auch ohne Mailkonto (WhatsApp, Signal, Notizen …)
async function teileFehlerbericht() {
  const beschreibung = document.getElementById("f-text").value.trim();
  if (!beschreibung) return flash("Bitte kurz beschreiben, was nicht stimmt.");
  const text = "An: " + REPORT_MAIL + "\n\n" + berichtText(beschreibung);
  const fInput = document.getElementById("f-foto");
  try {
    if (fInput.files && fInput.files[0] && navigator.canShare) {
      const dataUrl = await verkleinereFoto(fInput.files[0]);
      const bin = atob(dataUrl.split(",")[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bild = new File([arr], "bildschirm.jpg", { type: "image/jpeg" });
      if (navigator.canShare({ files: [bild] })) {
        await navigator.share({ files: [bild], text: text, title: "Fehler fz2-tool" });
        return;
      }
    }
    if (navigator.share) { await navigator.share({ text: text, title: "Fehler fz2-tool" }); return; }
  } catch (e) { return; }   // Nutzer hat abgebrochen
  kopiereFehlerbericht();    // Teilen nicht verfügbar -> kopieren
}

// Kopieren: letzter Rettungsanker, Text landet in der Zwischenablage
async function kopiereFehlerbericht() {
  const beschreibung = document.getElementById("f-text").value.trim();
  if (!beschreibung) return flash("Bitte kurz beschreiben, was nicht stimmt.");
  const text = "An: " + REPORT_MAIL + "\n\n" + berichtText(beschreibung);
  try {
    await navigator.clipboard.writeText(text);
    flash("Text kopiert – irgendwo einfügen und an " + REPORT_MAIL + " schicken.");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); flash("Text kopiert."); }
    catch (e2) { flash("Kopieren nicht möglich – bitte E-Mail oder Teilen nutzen."); }
    ta.remove();
  }
}

async function sendeFehlerbericht() {
  const beschreibung = document.getElementById("f-text").value.trim();
  if (!beschreibung) return flash("Bitte kurz beschreiben, was nicht stimmt.");
  const fInput = document.getElementById("f-foto");
  const text = berichtText(beschreibung);
  const betreff = "Fehler fz2-tool – " + (wer() || "?") + " – " + jetzt();

  // Mit Foto: über Teilen (Mail auswählen), damit das Bild mitgeht
  if (fInput.files && fInput.files[0]) {
    try {
      const dataUrl = await verkleinereFoto(fInput.files[0]);
      const bin = atob(dataUrl.split(",")[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bild = new File([arr], "bildschirm.jpg", { type: "image/jpeg" });
      const txt = new File([new Blob([text], { type: "text/plain" })], "fehlerbericht.txt", { type: "text/plain" });
      if (navigator.canShare && navigator.canShare({ files: [bild, txt] })) {
        await navigator.share({ files: [bild, txt], title: betreff, text: text });
        flash("Bitte im Teilen-Menü „Mail“ wählen und an " + REPORT_MAIL + " senden.");
        return;
      }
    } catch (e) { /* Teilen abgebrochen oder nicht möglich -> unten weiter */ }
  }
  // Ohne Foto (oder wenn Teilen nicht geht): fertige Mail öffnen
  location.href = "mailto:" + REPORT_MAIL + "?subject=" + encodeURIComponent(betreff) + "&body=" + encodeURIComponent(text);
  flash("E-Mail wird geöffnet – nur noch auf Senden tippen.");
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
  const el = e.target.closest("[data-maschine],[data-zurueck],[data-status],[data-speichern-eintrag],[data-add-todo],[data-toggle-todo],[data-del-todo],[data-modus],[data-abzug],[data-save-spule],[data-edit-spule],[data-del-spule],[data-g-uebernehmen],[data-rezept-neu],[data-rezept],[data-rezept-zurueck],[data-rezept-speichern],[data-rezept-bearbeiten],[data-formular],[data-wiz-vorlage],[data-wiz-leer],[data-wiz-kopie],[data-wiz-zurueck-start],[data-wiz-weiter],[data-wiz-zurueck],[data-wiz-wert],[data-wiz-eigen],[data-verlauf],[data-verlauf-zurueck],[data-vergleich],[data-vergleich-zurueck],[data-check],[data-ruest-abschluss],[data-erstmuster],[data-export],[data-import],[data-fehler-zurueck],[data-fehler-senden],[data-fehler-teilen],[data-fehler-kopieren],[data-fehler-loeschen],[data-wochenbericht],[data-code-setzen],[data-code-aendern],[data-code-entfernen],[data-grossschrift],[data-abmelden],[data-benutzer-neu],[data-pw-aendern],[data-benutzer-loeschen]");
  if (!el) return;
  if (el.dataset.maschine) { state.maschine = el.dataset.maschine; render(); window.scrollTo(0, 0); }
  else if (el.dataset.zurueck) { state.maschine = null; render(); }
  else if (el.dataset.status) { document.querySelectorAll(".status-opt").forEach(o => o.classList.remove("aktiv")); el.classList.add("aktiv", "bg-" + STATUS[el.dataset.status].farbe); el.dataset._sel = "1"; }
  else if (el.dataset.speichernEintrag) speichereEintrag();
  else if (el.dataset.addTodo) addTodo();
  else if (el.dataset.toggleTodo) toggleTodo(el.dataset.toggleTodo);
  else if (el.dataset.delTodo) delTodo(el.dataset.delTodo);
  else if (el.dataset.abzug !== undefined) {
    spAbzug = parseFloat(el.dataset.abzug) || 0;
    document.querySelectorAll("[data-abzug]").forEach(b => b.classList.toggle("aktiv", b === el));
    spRechne();
  }
  else if (el.dataset.modus) {
    spModus = el.dataset.modus;
    document.querySelectorAll(".modus button").forEach(b => b.classList.toggle("aktiv", b === el));
    spRechne();
  }
  else if (el.dataset.saveSpule) speichereSpule();
  else if (el.dataset.editSpule) editSpule(el.dataset.editSpule);
  else if (el.dataset.delSpule) delSpule(el.dataset.delSpule);
  else if (el.dataset.rezeptNeu) { state.rezeptForm = "neu"; wizStart("neu"); render(); window.scrollTo(0, 0); }
  else if (el.dataset.wizVorlage) { wiz.phase = "vorlage"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.wizLeer) { wiz.phase = "schritte"; wiz.schritt = 0; render(); window.scrollTo(0, 0); }
  else if (el.dataset.wizZurueckStart) { wiz.phase = "start"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.wizKopie) {
    const q = rezepte().find(x => x.id === el.dataset.wizKopie);
    if (q) {
      wiz.werte = Object.assign({}, q.soll || {});
      wiz.formular = q.formular || STANDARD_FORMULAR;
      wiz.stamm = { kuerzel: q.kuerzel || "", aufbau: q.aufbau || "", klartext: q.klartext || "",
                    maschine: q.maschine || "", beispiel_auftrag: "" };  // Auftrag bewusst leer
    }
    wiz.phase = "schritte"; wiz.schritt = 0; render(); window.scrollTo(0, 0);
  }
  else if (el.dataset.formular) { wiz.formular = el.dataset.formular; render(); }
  else if (el.dataset.wizWeiter) wizWeiter();
  else if (el.dataset.wizZurueck) wizZurueck();
  else if (el.dataset.wizWert) {
    const feld = el.dataset.wizWert;
    wiz.werte[feld] = (wiz.werte[feld] === el.dataset.wert) ? "" : el.dataset.wert;  // nochmal tippen = abwählen
    render();
  }
  else if (el.dataset.wizEigen) {
    const box = document.getElementById("weigen-" + el.dataset.wizEigen);
    if (box) { box.classList.add("zeigen"); const i = box.querySelector("input"); if (i) i.focus(); }
  }
  else if (el.dataset.rezept) { state.rezept = el.dataset.rezept; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezeptZurueck) { state.rezeptForm = null; wiz = null; state.rezept = null; state.verlauf = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezeptSpeichern) speichereRezept();
  else if (el.dataset.rezeptBearbeiten) { state.rezeptForm = el.dataset.rezeptBearbeiten; wizStart(el.dataset.rezeptBearbeiten); render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlauf) { state.verlauf = el.dataset.verlauf; state.rezept = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlaufZurueck) { state.verlauf = null; state.rezept = el.dataset.verlaufZurueck; render(); window.scrollTo(0, 0); }
  else if (el.dataset.vergleich) { state.vergleich = el.dataset.vergleich; state.rezept = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.vergleichZurueck) { state.vergleich = null; state.rezept = el.dataset.vergleichZurueck; render(); window.scrollTo(0, 0); }
  else if (el.dataset.check) { if (!e.target.classList.contains("p-ist")) toggleCheck(el.dataset.check); }
  else if (el.dataset.ruestAbschluss) ruestAbschluss(el.dataset.ruestAbschluss);
  else if (el.dataset.erstmuster) sendeErstmuster(el.dataset.erstmuster);
  else if (el.dataset.gUebernehmen) { const g = gErmittelt(); if (g > 0) { document.getElementById("sp-g").value = fmt(g, 4); spRechne(); flash("G übernommen: " + fmt(g, 4) + " kg/km"); } else flash("Erst Gewicht und Länge der Spule eingeben."); }
  else if (el.dataset.export) exportData();
  else if (el.dataset.import) importData();
  else if (el.dataset.abmelden) abmelden();
  else if (el.dataset.benutzerNeu) {
    const n = document.getElementById("nb-name").value.trim();
    const p = document.getElementById("nb-pw").value;
    if (!n || p.length < 3) { flash("Name und Passwort (mind. 3 Zeichen) angeben."); return; }
    legeBenutzerAn(n, p).then(erfolg => { flash(erfolg ? "Benutzer angelegt." : "Name existiert schon."); render(); });
  }
  else if (el.dataset.pwAendern) {
    const p = (prompt("Neues Passwort für " + el.dataset.pwAendern + ":") || "").trim();
    if (p.length < 3) return flash("Mindestens 3 Zeichen.");
    legeBenutzerAn(el.dataset.pwAendern, p, true).then(() => flash("Passwort geändert."));
  }
  else if (el.dataset.benutzerLoeschen) {
    if (!confirm("Benutzer " + el.dataset.benutzerLoeschen + " löschen?")) return;
    DB.set("benutzer", benutzerListe().filter(b => b.name !== el.dataset.benutzerLoeschen));
    flash("Benutzer gelöscht."); render();
  }
  else if (el.dataset.grossschrift) {
    const an = !DB.get("grossschrift", false);
    DB.set("grossschrift", an);
    document.body.classList.toggle("gross", an);
    render();
  }
  else if (el.dataset.codeSetzen) codeSetzen();
  else if (el.dataset.codeAendern) codeAendern();
  else if (el.dataset.codeEntfernen) codeEntfernen();
  else if (el.dataset.fehlerZurueck) { state.overlay = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.fehlerSenden) sendeFehlerbericht();
  else if (el.dataset.fehlerTeilen) teileFehlerbericht();
  else if (el.dataset.fehlerKopieren) kopiereFehlerbericht();
  else if (el.dataset.fehlerLoeschen) { if (confirm("Fehlerliste leeren?")) { DB.set("fehler", []); aktualisiereFehlerBadge(); render(); } }
  else if (el.dataset.wochenbericht) wochenberichtMail();
});
let bildschirmSchnappschuss = null;   // was beim Drücken auf „Fehler" zu sehen war
document.getElementById("fehler-knopf").addEventListener("click", () => {
  try {
    bildschirmSchnappschuss = {
      ansicht: state.view + (state.maschine ? " / " + state.maschine : "") + (state.rezept ? " / Muster" : "") + (state.rezeptForm ? " / Muster anlegen" : ""),
      titel: titel.textContent,
      sichtbar: (inhalt.innerText || "").replace(/\n{2,}/g, "\n").trim().slice(0, 1200),
      eingaben: Array.from(inhalt.querySelectorAll("input, select, textarea"))
        .filter(i => i.value && i.type !== "password" && i.type !== "file")
        .map(i => (i.dataset.feld || i.dataset.stamm || i.id || i.name || "Feld") + " = " + i.value).slice(0, 30),
      zeit: jetzt(),
    };
  } catch (e) { bildschirmSchnappschuss = null; }
  state.overlay = "fehler"; render(); window.scrollTo(0, 0);
});
document.getElementById("wochen-banner").addEventListener("click", wochenberichtMail);
document.addEventListener("input", e => {
  if (e.target.id === "spulen-suche") { spulenSuche = e.target.value; const l = document.getElementById("spulen-liste"); if (l) l.innerHTML = spulenListeHtml(); return; }
  if (e.target.id === "ruest-suche") { ruestSuche = e.target.value; const l = document.getElementById("ruest-liste"); if (l) l.innerHTML = ruestListeHtml(); return; }
  if (e.target.dataset && e.target.dataset.stamm && wiz) { wiz.stamm[e.target.dataset.stamm] = e.target.value; return; }
  if (e.target.classList && e.target.classList.contains("wiz-eigen") && wiz) { wiz.werte[e.target.dataset.feld] = e.target.value; return; }
  if (e.target.dataset && e.target.dataset.ist) { setzeIst(e.target.dataset.ist, e.target.value); return; }
  // nur rechnen, wenn die Spulen-Maske wirklich auf dem Bildschirm ist
  // (sonst z. B. beim Tippen im Fehler-Formular über der Spulen-Ansicht)
  if (!state.overlay && e.target.closest("#inhalt") && state.view === "spulen") spRechne();
});

function gewaehlterStatus() { const a = document.querySelector(".status-opt.aktiv"); return a ? a.dataset.status : null; }
function speichereEintrag() {
  const st = gewaehlterStatus();
  if (!st) return flash("Bitte einen Status wählen.");
  const note = document.getElementById("notiz").value.trim();
  const list = entries();
  list.push({ id: neueId(), machine: state.maschine, status: st, note: note, benutzer: wer(), created_at: jetzt() });
  DB.set("entries", list); flash("Eintrag gespeichert."); render(); window.scrollTo(0, 0);
}
function addTodo() {
  const text = document.getElementById("todo-text").value.trim();
  if (!text) return flash("Bitte einen Text eingeben.");
  const machine = document.getElementById("todo-maschine").value;
  const list = todos();
  list.push({ id: neueId(), text: text, machine: machine || null, done: false, benutzer: wer(), created_at: jetzt() });
  DB.set("todos", list); render();
}
function toggleTodo(id) {
  const list = todos(); const t = list.find(x => x.id === id); if (!t) return;
  t.done = !t.done; t.done_at = t.done ? jetzt() : null; t.done_von = t.done ? wer() : null; DB.set("todos", list); render();
}
function delTodo(id) { if (!confirm("Aufgabe löschen?")) return; DB.set("todos", todos().filter(t => t.id !== id)); render(); }
function delSpule(id) { if (!confirm("Berechnung löschen?")) return; DB.set("spulen", spulen().filter(s => s.id !== id)); render(); }

/* ---------- Was ist neu (Änderungen je Version) ---------- */
const CHANGELOG = {
  "3.0": [
    "Erstmuster als PDF im Originallayout – ausgefüllt und versendbar",
    "Knopf Erstmuster senden beim Muster; geht per Mail, WhatsApp oder als Datei",
  ],
  "2.9": [
    "Drei Erstmuster-Formulare wählbar: 1350, 1341 und das ältere VA-013F3",
    "Je Formular werden die passenden Einstellwerte abgefragt",
    "Formular steht beim Muster und lässt sich später ändern",
  ],
  "2.8": [
    "Behoben: Rüst-Liste war unleserlich – Zeilen lagen übereinander",
  ],
  "2.7": [
    "Updates spielen sich jetzt von selbst ein – kein Antippen mehr nötig",
    "Wird gerade getippt, wartet die App, damit nichts verloren geht",
    "Unter Mehr steht, was in jeder Version geändert wurde",
  ],
  "2.6": [
    "Neu: Auftragsmenge eingeben – die App prüft, ob der Vorzug reicht",
    "Neu: Galvanik-Abzug je Vorzug (Ø 1,56 = 5 kg, Ø 2,10 = 7 kg)",
    "Rechnet nach dem Schulungsblatt Fertigware Gewicht richtig rechnen",
  ],
  "2.5": [
    "Rüst-Liste: Sollwert größer, Ist-Feld über die ganze Breite",
    "Fehlerliste wird nach einem Update automatisch geleert",
  ],
  "2.4": [
    "Behoben: beim Schreiben im Fehler-Formular lief im Hintergrund ein Fehler mit",
  ],
  "2.3": [
    "Fehlerbericht: zusätzlich Teilen (WhatsApp usw.) und Text kopieren",
    "So kommt der Bericht auch ohne Mailprogramm an",
  ],
  "2.2": [
    "Spulen: Suchfeld für die Auftragsnummer",
    "Behoben: nach dem Fehler-Knopf blieb man beim Tab-Wechsel hängen",
  ],
  "2.1": [
    "Android: eigener Knopf zum Installieren auf dem Startbildschirm",
  ],
  "2.0": [
    "Eigene Benutzer mit Passwort – jeder Eintrag zeigt, wer ihn gemacht hat",
    "Anmelden/Abmelden, Benutzer verwalten unter Mehr",
    "Fehler melden: App erfasst Bildschirm, Eingaben und Fehler automatisch",
    "Fehlerbericht geht mit einem Tipp per E-Mail raus",
  ],
  "1.9": [
    "Muster anlegen jetzt Schritt für Schritt statt langem Formular",
    "Werte antippen statt eintippen – bisher benutzte Werte als große Knöpfe",
    "Neues Muster kann von einem vorhandenen übernommen werden",
    "Große Schrift umschaltbar (unter Mehr)",
  ],
  "1.8": [
    "Rüsten: Suche über alle Muster (Kürzel, Aufbau, Maschine, Auftrag)",
    "Änderungen an Mustern werden als Verlauf gespeichert (nichts geht verloren)",
    "Änderungsvergleich: sehen, was sich wann geändert hat (alt → neu)",
  ],
  "1.7": [
    "Echte Verschlüsselung: mit Code werden alle Daten verschlüsselt gespeichert",
    "Ohne Code sind die Daten nicht lesbar – auch bei Gerätezugriff",
    "Wichtig: Code sicher notieren und Sicherung machen (Code weg = Daten weg)",
  ],
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
  if (!ersterStart) {
    // Nach einem Update sind die alten Meldungen erledigt – Liste leeren,
    // damit der Fehler-Knopf nur noch bei wirklich Neuem rot wird.
    DB.set("fehler", []);
    aktualisiereFehlerBadge();
  }
  const neu = CHANGELOG[APP_VERSION];
  if (ersterStart || !neu || !neu.length) return;  // beim allerersten Öffnen nichts zeigen
  document.getElementById("update-titel").textContent = "Aktualisiert auf Version " + APP_VERSION;
  document.getElementById("update-liste").innerHTML = neu.map(x => "<li>" + esc(x) + "</li>").join("");
  document.getElementById("update-dialog").hidden = false;
}
document.getElementById("update-ok").addEventListener("click", () => {
  document.getElementById("update-dialog").hidden = true;
});

/* ---------- Installieren-Angebot (Android/Chrome) ---------- */
let installEreignis = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();               // eigenen Knopf statt Chrome-Leiste zeigen
  installEreignis = e;
  document.getElementById("install-banner").classList.add("zeigen");
});
document.getElementById("install-banner").addEventListener("click", async () => {
  if (!installEreignis) return;
  installEreignis.prompt();
  try { await installEreignis.userChoice; } catch (e) { /* abgebrochen */ }
  installEreignis = null;
  document.getElementById("install-banner").classList.remove("zeigen");
});
window.addEventListener("appinstalled", () => {
  document.getElementById("install-banner").classList.remove("zeigen");
  flash("App ist installiert – ab jetzt über das Symbol starten.");
});

/* ---------- Service Worker + Auto-Update ---------- */
/* Updates werden automatisch eingespielt. Nur wenn gerade getippt wird oder
   ein Vorgang läuft, wartet die App – sonst gingen Eingaben verloren. */
let wartendeReg = null, updateSeit = 0;
function updateStoertGerade() {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;  // jemand tippt
  if (typeof wiz !== "undefined" && wiz) return true;                   // Muster-Assistent offen
  if (state.overlay === "fehler") return true;                          // Fehlerbericht offen
  return false;
}
function updateAnwendenWennMoeglich() {
  if (!wartendeReg || !wartendeReg.waiting) return;
  if (updateStoertGerade()) {
    // nach einer Weile wenigstens einen Knopf anbieten
    if (Date.now() - updateSeit > 90000) {
      const b = document.getElementById("update-banner");
      b.textContent = "● Update bereit – zum Übernehmen tippen";
      b.classList.add("zeigen");
      b.onclick = () => { b.textContent = "Wird aktualisiert …"; wartendeReg.waiting.postMessage({ type: "SKIP_WAITING" }); };
    }
    return;
  }
  wartendeReg.waiting.postMessage({ type: "SKIP_WAITING" });   // -> controllerchange -> reload
}
function updateGemerkt(reg) {
  wartendeReg = reg; updateSeit = Date.now();
  updateAnwendenWennMoeglich();
}
if ("serviceWorker" in navigator) {
  let neugeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!neugeladen) { neugeladen = true; location.reload(); }  // neue Version aktiv -> neu laden
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      if (reg.waiting && navigator.serviceWorker.controller) updateGemerkt(reg);
      reg.addEventListener("updatefound", () => {
        const neu = reg.installing;
        if (neu) neu.addEventListener("statechange", () => {
          if (neu.state === "installed" && navigator.serviceWorker.controller) updateGemerkt(reg);
        });
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);   // halbstündlich nachsehen
      setInterval(updateAnwendenWennMoeglich, 5000);                     // sobald es passt, einspielen
      document.addEventListener("visibilitychange", () => {             // beim Zurückkommen sofort prüfen
        if (!document.hidden) { reg.update().catch(() => {}); updateAnwendenWennMoeglich(); }
      });
    }).catch(() => {});
  });
}

/* ---------- Zugangssperre ---------- */
async function pinHash(code) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fz2-salt:" + code));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
/* ---------- Benutzer / Anmeldung ---------- */
async function legeBenutzerAn(name, passwort, ersetzen) {
  const list = benutzerListe();
  const vorhanden = list.find(b => b.name.toLowerCase() === name.toLowerCase());
  const hash = await pinHash(name.toLowerCase() + ":" + passwort);
  if (vorhanden) { if (!ersetzen) return false; vorhanden.pw = hash; }
  else list.push({ name: name, pw: hash });
  DB.set("benutzer", list);
  return true;
}
async function seedBenutzer() {
  if (benutzerListe().length) return;
  await legeBenutzerAn("güntzel", "1234");
  await legeBenutzerAn("friedl", "1234");
}
async function anmelden() {
  const name = document.getElementById("login-name").value.trim();
  const pw = document.getElementById("login-pw").value;
  const b = benutzerListe().find(x => x.name.toLowerCase() === name.toLowerCase());
  if (b && await pinHash(b.name.toLowerCase() + ":" + pw) === b.pw) {
    DB.set("angemeldet", b.name);
    document.getElementById("login").hidden = true;
    document.getElementById("login-pw").value = "";
    document.getElementById("login-fehler").textContent = "";
    appLosgehen();
  } else {
    document.getElementById("login-fehler").textContent = "Benutzer oder Passwort falsch.";
    document.getElementById("login-pw").value = "";
  }
}
function abmelden() {
  DB.set("angemeldet", "");
  document.getElementById("login").hidden = false;
  document.getElementById("login-name").value = "";
  document.getElementById("login-pw").value = "";
  document.getElementById("login-name").focus();
}
document.getElementById("login-ok").addEventListener("click", anmelden);
document.getElementById("login-pw").addEventListener("keydown", e => { if (e.key === "Enter") anmelden(); });

function appLosgehen() {
  document.body.classList.toggle("gross", DB.get("grossschrift", false));
  zeige("maschinen");
  aktualisiereFehlerBadge();
  pruefeWochenbericht();
  zeigeWasNeu();
}
async function starteApp() {
  await seedBenutzer();
  if (benutzerListe().length && !wer()) {
    document.getElementById("login").hidden = false;
    document.getElementById("login-name").focus();
    return;   // erst anmelden
  }
  appLosgehen();
}
function raeumeAltePlainKeys() {
  const weg = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf("sue_") === 0 && k !== "sue_vault_enc") weg.push(k);
  }
  weg.forEach(k => localStorage.removeItem(k));
}
async function entsperren() {
  const code = document.getElementById("sperre-code").value;
  if (!code) return;
  const encRaw = localStorage.getItem("sue_vault_enc");
  try {
    if (encRaw) {
      VAULT = await entschluessle(JSON.parse(encRaw), code);   // wirft bei falschem Code
      VAULT_CODE = code; vaultBereit = true;
    } else {
      // Übergang von der alten Code-Sperre: Code prüfen, dann Daten verschlüsseln
      const plain = ladePlainVault();
      if (plain.pin_hash && await pinHash(code) !== plain.pin_hash) throw new Error("falsch");
      delete plain.pin_hash;
      VAULT = plain; VAULT_CODE = code; vaultBereit = true;
      localStorage.setItem("sue_vault_enc", JSON.stringify(await verschluessle(VAULT, code)));
      raeumeAltePlainKeys();
    }
    document.getElementById("sperre").hidden = true;
    document.getElementById("sperre-code").value = "";
    document.getElementById("sperre-fehler").textContent = "";
    starteApp();
  } catch (e) {
    document.getElementById("sperre-fehler").textContent = "Falscher Code.";
    document.getElementById("sperre-code").value = "";
    document.getElementById("sperre-code").focus();
  }
}
function pruefeSperre() {
  const enc = localStorage.getItem("sue_vault_enc");
  const plain = ladePlainVault();
  if (enc || plain.pin_hash) {
    document.getElementById("sperre").hidden = false;
    document.getElementById("sperre-code").focus();
  } else {
    VAULT = plain; vaultBereit = true;
    starteApp();  // offen: keine Verschlüsselung
  }
}
document.getElementById("sperre-ok").addEventListener("click", entsperren);
document.getElementById("sperre-code").addEventListener("keydown", e => { if (e.key === "Enter") entsperren(); });

/* ---------- Start ---------- */
pruefeSperre();
