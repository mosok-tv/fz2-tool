"use strict";

const APP_VERSION = "4.11";
const REPORT_MAIL = "tigga232332@gmail.com";   // Sammeladresse für Wochenberichte
const WOCHE_MS = 7 * 24 * 3600 * 1000;

/* ---------- Feste Vorgaben (nicht ohne Rücksprache ändern) ---------- */
// Ausgangsliste – im Bereich „Mehr" kann jeder eigene Maschinen anlegen oder entfernen
const MASCHINEN_STANDARD = ["Z49", "Z67", "Z68", "Z78", "Z82", "Z83"];
const STATUS = {
  produktion: { label: "Produktion", farbe: "green" },
  umbau:      { label: "Umbau",      farbe: "yellow" },
  drahtriss:  { label: "Drahtriss",  farbe: "red" },
  reparatur:  { label: "Reparatur",  farbe: "blue" },
  abruesten:  { label: "Abrüsten",   farbe: "violet" },
};

// Schichten im Werk – aus der Uhrzeit bestimmt, beim Eintrag änderbar
const SCHICHTEN = [
  { id: "frueh", label: "Frühschicht", von: 6, bis: 14 },
  { id: "spaet", label: "Spätschicht", von: 14, bis: 22 },
  { id: "nacht", label: "Nachtschicht", von: 22, bis: 6 },
];
function schichtJetzt(stunde) {
  const h = (stunde === undefined) ? new Date().getHours() : stunde;
  if (h >= 6 && h < 14) return "frueh";
  if (h >= 14 && h < 22) return "spaet";
  return "nacht";
}
function schichtLabel(id) { const s = SCHICHTEN.find(x => x.id === id); return s ? s.label : ""; }

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
function notloesungen() { return DB.get("notloesungen", []); }
function papierkorb() { return DB.get("papierkorb", []); }
// Stand eines Erstmusters: jede gespeicherte Änderung legt einen alten Stand in die Historie
function standVon(r) { return ((r && r.historie && r.historie.length) || 0) + 1; }
function benutzerListe() { return DB.get("benutzer", []); }
function wer() { return DB.get("angemeldet", "") || ""; }
// Maschinenliste: selbst angelegt, sonst die Ausgangsliste
function maschinen() { const m = DB.get("maschinen", null); return Array.isArray(m) ? m : MASCHINEN_STANDARD.slice(); }
// Was gerade auf einer Maschine läuft: { "Z49": { kuerzel, aufbau, ... } }
function laufend() { const l = DB.get("laufend", null); return (l && typeof l === "object") ? l : {}; }

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
        { name: "Maschinentyp Ziehmaschine", einheit: "", angabe: 1, vorschlaege: ["NIEHOFF MMH50"] },
        { name: "KSS-Produkt Ziehmaschine", einheit: "", angabe: 1, vorschlaege: ["Zeller + Gmelin Multidraw Cu Sy Spezial"] },
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
        { name: "Maschinentyp Glühe", einheit: "", angabe: 1, vorschlaege: ["RM 121.1.R.08.400"] },
        { name: "KSS-Produkt Glühe", einheit: "", angabe: 1, vorschlaege: ["Bechem Unopol F811"] },
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
        { name: "Maschinentyp Spuler", einheit: "", angabe: 1, vorschlaege: ["SG 145.F.E"] },
        { name: "Verlegung Hand/Automatik", einheit: "", vorschlaege: ["Hand", "Automatik"] },
        { name: "Spulengröße", einheit: "mm", vorschlaege: ["250", "350", "560"] },
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
        { name: "Maschinentyp Ziehmaschine", einheit: "", angabe: 1, vorschlaege: ["NIEHOFF M5"] },
        { name: "KSS-Produkt Ziehmaschine", einheit: "", angabe: 1, vorschlaege: ["Zeller + Gmelin Multidraw Cu Sy Spezial"] },
        { name: "Ziehgeschwindigkeit + Skala", einheit: "m/s" },
      ] },
      { gruppe: "Glühe", felder: [
        { name: "Maschinentyp Glühe", einheit: "", angabe: 1, vorschlaege: ["Niehoff VG5"] },
        { name: "KSS-Produkt Glühe", einheit: "", angabe: 1, vorschlaege: ["Bechem Unopol F811"] },
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
        { name: "Maschinentyp Spuler", einheit: "", angabe: 1, vorschlaege: ["SG145.1.F.E"] },
        { name: "Verlegung Hand/Automatik", einheit: "", vorschlaege: ["Hand", "Automatik"] },
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
        { name: "Werkstoff Kontaktband", einheit: "", vorschlaege: ["Kupfer", "Nickel"] },
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

/* Die Zahlen, die an der Maschine sofort sichtbar sein sollen.
   In den drei Formularen heißen sie unterschiedlich – hier die Feldnamen dazu. */
const KENNWERTE = [
  { label: "Geschwindigkeit", felder: ["Ziehgeschwindigkeit", "Ziehgeschwindigkeit + Skala", "Geschwindigkeit Soll/Ist"] },
  { label: "Glühfaktor", felder: ["Glühfaktor", "Faktor (Glüh-/Bereichseinstellung)"] },
  { label: "Zugkraft Aufwickler", felder: ["Zugkraft Aufwickelspannung", "Zugspannung Spuler Soll/Ist"] },
];
function kennwerte(formular, ist) {
  ist = ist || {};
  const felder = formularFelder(formular);
  return KENNWERTE.map(k => {
    const name = k.felder.find(n => ist[n] && (ist[n].wert || ist[n].soll));
    if (!name) return null;
    const e = ist[name], f = felder.find(x => x.name === name) || {};
    return { label: k.label, wert: e.wert || e.soll, einheit: f.einheit || "", nurSoll: !e.wert };
  }).filter(Boolean);
}
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
// "04.08.2026 22:07" -> vergleichbare Zahl (0 wenn leer/unbekannt)
function zeitWert(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(String(s || ""));
  if (!m) return 0;
  return Number(m[3] + m[2] + m[1] + (m[4] || "00") + (m[5] || "00"));
}
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
const state = { view: "maschinen", maschine: null, overlay: null, rezept: null, rezeptForm: null, verlauf: null, vergleich: null, emDetail: null, rvergleich: null, abweichung: null, kontrolle: null };
let spModus = "summe";  // Berechnungsart der Vorzüge: "summe" | "kleinster"
let ruestSuche = "";    // Suchbegriff im Rüsten-Bereich
let emSuche = "";       // Suchbegriff im Erstmuster-Bereich
let spulenSuche = "";   // Suchbegriff für gespeicherte Berechnungen
let spAbzug = 0;        // Galvanik-Abzug je Vorzug in kg (0 / 5 / 7)
let spEditId = null;    // gesetzt, wenn eine gespeicherte Berechnung bearbeitet wird
const inhalt = document.getElementById("inhalt");
const titel = document.getElementById("kopf-titel");

function zeige(view) {
  state.view = view; state.overlay = null; state.maschine = null; state.rezept = null;
  state.rezeptForm = null; state.verlauf = null; state.vergleich = null; state.emDetail = null;
  state.rvergleich = null; state.abweichung = null; state.kontrolle = null;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("aktiv", t.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (state.overlay === "fehler") return renderFehler();
  if (state.abweichung) return renderAbweichung();       // direkt nach dem Rüsten
  if (state.kontrolle) return renderKontrolle();         // Werte mitten in der Schicht prüfen
  if (state.rvergleich) return renderRuestVergleich();   // aus jedem Bereich erreichbar
  if (state.view === "maschinen" && state.maschine) return renderMaschineDetail();
  if (state.view === "ruesten") {
    if (state.verlauf) return renderVerlauf();
    if (state.rezept) return renderRuestCheck();
    return renderRuesten();
  }
  if (state.view === "erstmuster") {
    if (state.rezeptForm) return renderRezeptForm();
    if (state.vergleich) return renderRezeptVergleich();
    if (state.emDetail) return renderErstmusterDetail();
    return renderErstmuster();
  }
  ({ maschinen: renderMaschinen, aufgaben: renderAufgaben, spulen: renderSpulen, mehr: renderMehr }[state.view] || renderMaschinen)();
}

/* ---------- Ansicht: Maschinen ---------- */
function letzterEintrag(m) {
  const alle = entries().filter(e => e.machine === m);
  return alle.length ? alle[alle.length - 1] : null;
}
function renderMaschinen() {
  titel.textContent = "Schichtübergabe";
  const liste = maschinen(), lauf = laufend();
  let kacheln = liste.map(m => {
    const e = letzterEintrag(m), farbe = e ? STATUS[e.status].farbe : "none";
    const txt = e ? STATUS[e.status].label : "kein Eintrag";
    const l = lauf[m];
    const draht = l ? `<small class="kachel-draht">${esc(drahtName(l))}</small>` : "";
    return `<button class="kopf-kachel bg-${farbe}" data-maschine="${m}">${esc(m)}<small>${esc(txt)}</small>${draht}</button>`;
  }).join("");
  if (!liste.length) kacheln = `<div class="leer" style="grid-column:1/-1">Noch keine Maschine angelegt – unter „Mehr" hinzufügen.</div>`;

  const mitNotiz = liste.map(letzterEintrag).filter(e => e && e.note);
  let status = mitNotiz.length
    ? mitNotiz.map(e => `<div class="eintrag"><b>${esc(e.machine)}</b> <span class="stat" style="color:var(--${STATUS[e.status].farbe})">${STATUS[e.status].label}</span> – ${esc(e.note)}<div class="meta">${e.created_at}${e.benutzer ? " · " + esc(e.benutzer) : ""}${e.schicht ? " · " + schichtLabel(e.schicht) : ""}</div></div>`).join("")
    : `<div class="leer">Keine Notizen vorhanden.</div>`;

  inhalt.innerHTML = `<div class="grid">${kacheln}</div>
    ${neuSeitHtml()}
    <div class="karte"><h2>Maschinen-Status</h2>${status}</div>`;
}

/* Was ist passiert, seit ich das letzte Mal geschaut habe?
   Genau das will man zu Schichtbeginn wissen – und nicht die ganze Liste. */
function gesehenStand() { return (DB.get("gesehen", {}) || {})[wer()] || 0; }
function neueEintraege() {
  const seit = gesehenStand();
  return entries().filter(e => zeitWert(e.created_at) > seit && e.benutzer !== wer());
}
function neuSeitHtml() {
  const neu = neueEintraege().slice().reverse();
  if (!gesehenStand()) {
    // beim allerersten Mal gibt es keinen sinnvollen Vergleichspunkt
    return `<div class="karte"><h2>Übergabe</h2>
      <div class="leer">Ab jetzt steht hier, was seit deiner letzten Schicht passiert ist.</div>
      <button class="btn btn-klein btn-grau" data-gesehen="1">Alles gelesen</button></div>`;
  }
  if (!neu.length) return `<div class="karte"><h2>Übergabe</h2>
    <div class="leer">Nichts Neues seit deiner letzten Schicht.</div></div>`;
  const liste = neu.map(e => `<div class="eintrag neu-eintrag">
    <div><b>${esc(e.machine)}</b> <span class="stat" style="color:var(--${STATUS[e.status].farbe})">${STATUS[e.status].label}</span>${e.note ? " – " + esc(e.note) : ""}</div>
    <div class="meta">${esc(e.created_at)}${e.schicht ? " · " + schichtLabel(e.schicht) : ""}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div>
  </div>`).join("");
  return `<div class="karte"><h2>Seit deiner letzten Schicht <span class="rz-fort">${neu.length}</span></h2>
    ${liste}
    <button class="btn" data-gesehen="1" style="margin-top:10px">Zur Kenntnis genommen</button></div>`;
}
function merkeGesehen() {
  const g = DB.get("gesehen", {}) || {};
  g[wer()] = zeitWert(jetzt());
  DB.set("gesehen", g);
  flash("Übergabe zur Kenntnis genommen."); render(); window.scrollTo(0, 0);
}

/* Passt eine gespeicherte Spulen-Berechnung zum laufenden Auftrag? Dann hier kurz zeigen. */
function berechnungZuAuftrag(auftrag) {
  const a = String(auftrag || "").trim().toLowerCase();
  if (!a) return null;
  const treffer = spulen().filter(s => String(s.auftrag || "").trim().toLowerCase() === a);
  return treffer.length ? treffer[treffer.length - 1] : null;
}
function berechnungZumAuftrag(auftrag) {
  const b = berechnungZuAuftrag(auftrag);
  if (!b) return "";
  return `<div class="lauf-auftrag">
    <b>${fmt(b.anzahl_spulen, 0)} Spulen</b> à ${fmt(b.gewicht_je_spule)} kg / ${fmt(b.laenge_je_spule, 0)} m
    ${b.geschwindigkeit ? " · je Spule " + hm(b.laenge_je_spule / b.geschwindigkeit) : ""}
    <div class="meta">aus der Berechnung zu Auftrag ${esc(b.auftrag)}</div>
  </div>`;
}

/* Kurzname des laufenden Drahts, z. B. „VSW 6×0,050" */
function drahtName(l) { return [l.kuerzel, l.aufbau].filter(Boolean).join(" ") || l.klartext || "gerüstet"; }

function renderMaschineDetail() {
  const m = state.maschine;
  titel.innerHTML = `${m}`;
  const hist = entries().filter(e => e.machine === m).slice().reverse();
  let histHtml = hist.length
    ? hist.map(e => `<div class="eintrag"><span class="punkt d-${STATUS[e.status].farbe}"></span><span class="stat">${STATUS[e.status].label}</span>${e.note ? " – " + esc(e.note) : ""}<div class="meta">${e.created_at}${e.schicht ? " · " + schichtLabel(e.schicht) : ""}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div></div>`).join("")
    : `<div class="leer">Noch kein Eintrag.</div>`;

  let optionen = Object.keys(STATUS).map(k =>
    `<button type="button" class="status-opt" data-status="${k}"><span class="punkt d-${STATUS[k].farbe}"></span>${STATUS[k].label}</button>`).join("");

  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-zurueck="1">‹ Zurück</button>
    ${laufendHtml(m)}
    <div class="karte" style="margin-top:12px">
      <h2>Neuer Eintrag für ${m}</h2>
      <div class="label">Status</div>
      <div class="status-wahl">${optionen}</div>
      <div class="label">Schicht</div>
      <select id="eintrag-schicht">${SCHICHTEN.map(s =>
        `<option value="${s.id}"${s.id === schichtJetzt() ? " selected" : ""}>${s.label}</option>`).join("")}</select>
      <div class="label">Notiz (optional)</div>
      <textarea id="notiz" placeholder="z. B. Drahtriss an Kopf 3"></textarea>
      <button class="btn" data-speichern-eintrag="1" style="margin-top:12px">Eintrag speichern</button>
    </div>
    <div class="karte"><h2>Verlauf</h2>${histHtml}</div>`;
}

/* Karte „Derzeit laufend" – kommt vom Abschluss einer Rüstung, kein Verlauf.
   Absichtlich kurz: nur der Draht und die drei Zahlen, die an der Maschine zählen. */
function laufendHtml(m) {
  const l = laufend()[m];
  if (!l) return `<div class="karte laufend leer-lauf" style="margin-top:12px">
    <div class="lauf-kopf">Derzeit laufend</div>
    <div class="leer">Nichts gerüstet. Nach „Rüstung abschließen" im Bereich Rüsten steht hier, was läuft.</div></div>`;
  const werte = kennwerte(l.formular, l.ist).map(k =>
    `<div class="v-zeile"><span>${esc(k.label)}</span><span><b>${esc(k.wert)}</b>${k.einheit ? ` <span class="einheit">${esc(k.einheit)}</span>` : ""}${k.nurSoll ? ' <span class="meta">(Soll)</span>' : ""}</span></div>`).join("");
  const vergleichbar = ruestungenVon(l.rezept_id).length > 1;
  return `
    <div class="karte laufend" style="margin-top:12px">
      <div class="lauf-kopf">Derzeit laufend</div>
      <div class="lauf-draht">${esc(drahtName(l))}</div>
      ${l.klartext || l.auftrag ? `<div class="lauf-text">${esc([l.klartext, l.auftrag ? "Auftrag " + l.auftrag : ""].filter(Boolean).join(" · "))}</div>` : ""}
      <div class="meta">${esc(formularName(l.formular))} · gerüstet ${esc(l.seit || "")}${l.benutzer ? " · " + esc(l.benutzer) : ""}</div>
      ${werte ? `<div class="lauf-werte">${werte}</div>` : ""}
      ${l.geprueft ? `<div class="meta">zuletzt geprüft ${esc(l.geprueft)}${l.geprueft_von ? " · " + esc(l.geprueft_von) : ""}</div>` : ""}
      ${berechnungZumAuftrag(l.auftrag)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-klein" data-kontrolle="${esc(m)}">Werte prüfen</button>
        ${vergleichbar ? `<button class="btn btn-klein btn-grau" data-rvergleich="${esc(l.rezept_id)}">Werte vergleichen</button>` : ""}
        <button class="btn btn-klein btn-grau" data-laufend-ende="${esc(m)}">Läuft nicht mehr</button>
      </div>
    </div>`;
}

/* ---------- Ansicht: Aufgaben ---------- */
function heuteIso() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function isoDeutsch(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? m[3] + "." + m[2] + "." + m[1] : ""; }
// „überfällig", „heute", „morgen" oder das Datum – so sieht man auf einen Blick, was drängt
function faelligText(t) {
  if (!t.faellig) return "";
  const heute = heuteIso();
  if (t.faellig < heute) return `<span class="faellig ueber">überfällig seit ${isoDeutsch(t.faellig)}</span>`;
  if (t.faellig === heute) return `<span class="faellig heute">heute fällig</span>`;
  const morgen = new Date(Date.now() + 86400000);
  const mIso = morgen.getFullYear() + "-" + String(morgen.getMonth() + 1).padStart(2, "0") + "-" + String(morgen.getDate()).padStart(2, "0");
  if (t.faellig === mIso) return `<span class="faellig">morgen fällig</span>`;
  return `<span class="faellig">bis ${isoDeutsch(t.faellig)}</span>`;
}
function renderAufgaben() {
  titel.textContent = "Aufgaben";
  // offen vor erledigt, dann wichtig, dann nach Termin – ohne Termin ans Ende
  const items = todos().slice().sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    if (!!a.wichtig !== !!b.wichtig) return a.wichtig ? -1 : 1;
    const fa = a.faellig || "9999-99-99", fb = b.faellig || "9999-99-99";
    if (fa !== fb) return fa < fb ? -1 : 1;
    return zeitWert(b.created_at) - zeitWert(a.created_at);
  });
  const liste = items.length ? items.map(t => `
    <div class="eintrag${!t.done && t.faellig && t.faellig < heuteIso() ? " ueberfaellig" : ""}">
      <div class="${t.done ? "durchgestrichen" : ""}">${t.wichtig && !t.done ? '<span class="wichtig-stern">★</span> ' : ""}${t.machine ? "<b>" + esc(t.machine) + ":</b> " : ""}${esc(t.text)}</div>
      ${!t.done ? faelligText(t) : ""}
      <div class="meta">${t.created_at}${t.benutzer ? " · " + esc(t.benutzer) : ""}${t.done && t.done_at ? " · ✓ erledigt " + t.done_at + (t.done_von ? " von " + esc(t.done_von) : "") : ""}</div>
      <button class="btn btn-klein ${t.done ? "btn-grau" : ""}" data-toggle-todo="${t.id}" style="margin-top:6px">${t.done ? "wieder offen" : "✓ erledigt"}</button>
      <button class="btn btn-klein btn-rot" data-del-todo="${t.id}" style="margin-top:6px;margin-left:6px">Löschen</button>
    </div>`).join("") : `<div class="leer">Nichts offen. 🎉</div>`;

  const maschinenOpts = maschinen().map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
  const offen = todos().filter(t => !t.done);
  const ueber = offen.filter(t => t.faellig && t.faellig < heuteIso()).length;
  inhalt.innerHTML = `
    <div class="karte">
      <div class="label">Neue Aufgabe</div>
      <input type="text" id="todo-text" placeholder="Was ist zu tun?">
      <div class="zwei" style="margin-top:8px">
        <div><div class="label">Maschine (optional)</div>
          <select id="todo-maschine"><option value="">Allgemein</option>${maschinenOpts}</select></div>
        <div><div class="label">Bis wann (optional)</div>
          <input type="date" id="todo-faellig"></div>
      </div>
      <label class="ankreuz"><input type="checkbox" id="todo-wichtig"> Wichtig – nach oben stellen</label>
      <button class="btn" data-add-todo="1" style="margin-top:12px">Hinzufügen</button>
    </div>
    ${ueber ? `<div class="karte"><p class="hinweis warnung" style="margin:0">${ueber} ${ueber === 1 ? "Aufgabe ist" : "Aufgaben sind"} überfällig.</p></div>` : ""}
    <div class="karte"><h2>Liste</h2>${liste}</div>`;
}

/* ---------- Ansicht: Spulen-Berechnung ---------- */
function spulenListeHtml() {
  const q = spulenSuche.trim().toLowerCase();
  const gefiltert = spulen().slice().reverse().filter(e => !q ||
    [e.auftrag, e.benutzer, e.created_at].join(" ").toLowerCase().indexOf(q) !== -1);
  if (!gefiltert.length) return `<div class="leer">${spulenSuche ? "Keine Berechnung gefunden." : "Noch keine Berechnung gespeichert."}</div>`;
  const lauf = laufend();
  return gefiltert.map(e => `
    <div class="eintrag">
      <div><b>${e.auftrag ? "Auftrag " + esc(e.auftrag) : "(ohne Auftragsnummer)"}</b>
        ${e.auftrag ? Object.keys(lauf).filter(m => String(lauf[m].auftrag || "").trim() === String(e.auftrag).trim())
          .map(m => `<span class="em-badge ok">läuft auf ${esc(m)}</span>`).join("") : ""}</div>
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
    </div>
    <div class="karte"><h2>Welchen Draht legst du auf?</h2>
      <p class="hinweis" style="margin-top:0">Muster antippen – dann Werte der Reihe nach einstellen und abhaken.</p>
      <div id="ruest-liste">${ruestListeHtml()}</div></div>`;
}

/* ---------- Erstmuster: anlegen, bearbeiten, versenden ---------- */
// Zeigt auf einen Blick, ob im Büro noch ein älteres Blatt liegt
function versandBadge(r) {
  const stand = standVon(r), v = r.versand;
  if (!v) return `<span class="em-badge neu">noch nie versendet</span>`;
  if (v.stand < stand) return `<span class="em-badge alt">Stand ${stand} — versendet war Stand ${v.stand}</span>`;
  return `<span class="em-badge ok">Stand ${stand} versendet ${esc(String(v.datum).split(" ")[0])}</span>`;
}
function emListeHtml() {
  const q = emSuche.trim().toLowerCase();
  const rz = rezepte().slice().reverse().filter(r => !q ||
    [r.kuerzel, r.aufbau, r.klartext, r.maschine, r.beispiel_auftrag].join(" ").toLowerCase().indexOf(q) !== -1);
  if (!rz.length) return `<div class="leer">${emSuche ? "Kein Erstmuster gefunden." : "Noch kein Erstmuster angelegt."}</div>`;
  return rz.map(r => {
    return `<div class="eintrag rz-eintrag" data-em="${r.id}">
      <div><b>${esc(r.kuerzel)}</b> · ${esc(r.aufbau)} ${versandBadge(r)}</div>
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}${r.beispiel_auftrag ? " · Auftrag " + esc(r.beispiel_auftrag) : ""} · ${esc(formularName(r.formular))}</div>
    </div>`;
  }).join("");
}
function renderErstmuster() {
  titel.textContent = "Erstmuster";
  inhalt.innerHTML = `
    <div class="karte">
      <input type="text" id="em-suche" placeholder="Suchen: Kürzel, Aufbau, Maschine, Auftrag …" value="${esc(emSuche)}">
      <button class="btn" data-rezept-neu="1" style="margin-top:10px">+ Neues Erstmuster</button>
    </div>
    <div class="karte"><h2>Erstmuster</h2><div id="em-liste">${emListeHtml()}</div></div>`;
}
function renderErstmusterDetail() {
  const r = rezepte().find(x => x.id === state.emDetail);
  if (!r) { state.emDetail = null; return render(); }
  titel.textContent = r.kuerzel + " " + r.aufbau;
  const soll = r.soll || {};
  const felder = formularFelder(r.formular).filter(f => !f.angabe && soll[f.name]);
  const angaben = formularFelder(r.formular).filter(f => f.angabe && soll[f.name]);
  const werte = felder.length
    ? felder.map(f => `<div class="zeile"><span>${esc(f.name)}</span><span><span class="w">${esc(soll[f.name])}</span>${f.einheit ? `<span class="einheit">${esc(f.einheit)}</span>` : ""}</span></div>`).join("")
    : `<div class="leer">Noch keine Werte eingetragen.</div>`;
  const anlage = anlageDaten(r);
  const nl = anlage.notloesungen;
  const nlHtml = nl.length ? nl.map(n => `
    <div class="eintrag">
      <div><b>${esc(n.feld)}</b>${n.einheit ? ` <span class="einheit">${esc(n.einheit)}</span>` : ""}</div>
      <div style="font-size:.92rem">Soll <span class="alt-wert">${esc(n.soll)}</span> · gefahren <b>${esc(n.ist)}</b></div>
      ${n.grund ? `<div style="font-size:.9rem">${esc(n.grund)}</div>` : `<div class="meta">kein Grund angegeben</div>`}
      <div class="meta">${n.maschine ? esc(n.maschine) + " · " : ""}${esc(n.datum)}${n.benutzer ? " · " + esc(n.benutzer) : ""}</div>
      <button class="btn btn-klein btn-grau" data-nl-erledigt="${n.id}" style="margin-top:6px">Erledigt – nicht mehr melden</button>
    </div>`).join("") : `<div class="leer">Keine offenen Notlösungen.</div>`;

  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-em-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}${r.beispiel_auftrag ? " · Auftrag " + esc(r.beispiel_auftrag) : ""}</div>
      <div style="margin-top:6px"><b>Formular:</b> ${esc(formularName(r.formular))}</div>
      <div style="margin-top:6px">${versandBadge(r)}</div>
      <div class="meta">angelegt ${esc(r.created_at || "")}${r.geaendert_am && r.geaendert_am !== r.created_at ? " · geändert " + esc(r.geaendert_am) : ""}${r.benutzer ? " · " + esc(r.benutzer) : ""}</div>
    </div>
    ${(anlage.aenderungen.length || nl.length) ? `<div class="karte">
      <h2>Kommt beim Versand auf Seite 2</h2>
      <p class="hinweis" style="margin-top:0">${anlage.aenderungen.length} geänderte ${anlage.aenderungen.length === 1 ? "Wert" : "Werte"}${anlage.versand ? " seit Stand " + anlage.versand.stand : ""} · ${nl.length} ${nl.length === 1 ? "Notlösung" : "Notlösungen"}</p>
      ${anlage.aenderungen.map(a => `<div class="v-zeile"><span>${esc(a.name)}</span><span><span class="alt-wert">${esc(a.alt || "–")}</span> → <b>${esc(a.neu || "–")}</b>${a.diff ? ` <span class="meta">${esc(a.diff)}</span>` : ""}</span></div>`).join("")}
    </div>` : ""}
    <div class="karte"><h2>Eingetragene Werte</h2>${werte}
      ${angaben.length ? `<p class="hinweis">Angaben wie Maschinentyp und KSS-Produkt stehen im PDF (${angaben.length} Stück).</p>` : ""}
    </div>
    ${r.blatt ? `<div class="karte"><h2>Blatt vom Papier</h2>
      <p class="hinweis" style="margin-top:0">Vorlage zum Nachschlagen. Geht nicht mit dem Erstmuster raus – das PDF wird aus den Werten oben gebaut.</p>
      <img src="${r.blatt}" alt="Blatt" class="pk-bild">
      <div class="meta">fotografiert ${esc(r.blatt_am || "")}${r.blatt_von ? " · " + esc(r.blatt_von) : ""}</div>
    </div>` : ""}
    <div class="karte"><h2>Prüfkarte</h2>
      <p class="hinweis" style="margin-top:0">Das Formular verlangt die Prüfkarte als Beilage. Fotografiert geht sie als eigene Seite mit dem PDF raus.</p>
      ${r.pruefkarte
        ? `<img src="${r.pruefkarte}" alt="Prüfkarte" class="pk-bild">
           <div class="meta">angehängt ${esc(r.pruefkarte_am || "")}${r.pruefkarte_von ? " · " + esc(r.pruefkarte_von) : ""}</div>
           <button class="btn btn-klein btn-rot" data-pk-weg="${r.id}" style="margin-top:8px">Foto entfernen</button>`
        : fotoWahl("pk", `data-id="${r.id}"`)}
    </div>
    <div class="karte"><h2>Notlösungen</h2>
      <p class="hinweis" style="margin-top:0">Beim Rüsten anders gefahren, Sollwert blieb. Stehen auf Seite 2, bis das Erstmuster einmal versendet wurde.</p>
      ${nlHtml}
    </div>
    <div class="karte" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-klein" data-rezept-bearbeiten="${r.id}">Bearbeiten</button>
      <button class="btn btn-klein btn-grau" data-vergleich="${r.id}">Änderungen</button>
      <button class="btn btn-klein" data-erstmuster="${r.id}">Erstmuster senden</button>
      <button class="btn btn-klein btn-rot" data-em-loeschen="${r.id}">Löschen</button>
    </div>`;
}

/* ---------- Vom Blatt übernehmen ----------
   Das Erkennen macht das Gerät selbst: Foto in der Fotos-App öffnen, Text
   markieren, kopieren. Die App bekommt nur den fertigen Text und ordnet ihn den
   Feldern des Formulars zu – nichts geht dafür nach außen, und übernommen wird
   nur, was der Nutzer bestätigt. Der erkannte Text ist unsauber (Handschrift,
   fehlende Umlaute, verrutschte Zeilen), deshalb wird verglichen, wie viele
   Wörter eines Feldnamens in einer Zeile vorkommen. */
const BLATT_FUELL = ["und", "der", "die", "das", "von", "auf", "fur", "im", "in", "bzw"];
const BLATT_STAMM = { kuerzel: "Kurzbezeichnung", aufbau: "Aufbau", klartext: "Klartext",
                      maschine: "Maschine", beispiel_auftrag: "Auftrag" };

// Kleinschreibung ohne Umlaute; Komma und Punkt bleiben, sonst zerfallen Zahlen wie 1,15
function blattNorm(s) {
  return String(s == null ? "" : s).toLowerCase()
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z0-9,.]+/g, " ").replace(/\s+/g, " ").trim();
}
// Die Wörter eines Feldnamens, an denen eine Zeile erkannt wird
function blattWorte(name) {
  return blattNorm(name).split(" ").filter(w => w && BLATT_FUELL.indexOf(w) === -1 && (w.length >= 3 || /^\d+$/.test(w)));
}
// Zahlen zählen nur als ganzes Wort (sonst steckt die "1" aus "KSS-Ventil 1" in jeder 1,15)
function blattEnthaelt(zeile, wort) {
  return /^\d+$/.test(wort) ? zeile.split(" ").indexOf(wort) !== -1 : zeile.indexOf(wort) !== -1;
}
// Zeile ohne den Feldnamen – nur das erste Vorkommen je Wort, damit "Verlegung Hand/Automatik: Automatik" den Wert behält
function blattRest(zeile, name) {
  let n = blattNorm(zeile);
  blattWorte(name).forEach(w => {
    const i = n.indexOf(w);
    if (i !== -1) n = n.slice(0, i) + " " + n.slice(i + w.length);
  });
  return n.replace(/\s+/g, " ").trim();
}
function blattZahl(s) {
  const m = String(s).match(/\d+(?:[.,]\d+)?/g);
  return m ? m[m.length - 1].replace(".", ",") : null;
}
// Wert einer Zeile: erst die bekannten Vorschläge (Hand/Automatik/Kupfer…), dann die Zahl
function blattWert(zeile, feld) {
  const rest = blattRest(zeile, feld.name);
  if (!rest) return null;
  const treffer = (feld.vorschlaege || []).find(v => blattNorm(v) && rest.indexOf(blattNorm(v)) !== -1);
  if (treffer) return treffer;
  return blattZahl(rest);
}
// Kurzbezeichnung, Aufbau, Klartext, Maschine, Auftrag aus dem ganzen Text
function blattStamm(zeilen) {
  const roh = zeilen.join("\n"), n = " " + blattNorm(roh) + " ", gefunden = {};
  const m = maschinen().find(x => blattNorm(x) && n.indexOf(" " + blattNorm(x) + " ") !== -1);
  if (m) gefunden.maschine = m;
  const a = roh.match(/(\d{1,3})\s*[x×*]\s*(\d+[.,]\d+)/);
  if (a) {
    gefunden.aufbau = a[1] + "x" + a[2].replace(".", ",");
    // In der Produktzeile steht davor die Kurzbezeichnung, dahinter der Klartext
    const zeile = zeilen.find(z => z.indexOf(a[0]) !== -1) || "";
    const teile = zeile.split(a[0]);
    const vor = (teile[0] || "").trim().split(/\s+/).filter(Boolean);
    const kurz = vor[vor.length - 1];
    if (kurz && /^[A-ZÄÖÜ0-9-]{2,8}$/.test(kurz)) gefunden.kuerzel = kurz;
    const nach = (teile[1] || "").replace(/^[\s:.-]+/, "").trim();
    if (nach && /[a-zäöü]{3}/.test(nach) && nach.length <= 40) gefunden.klartext = nach;
  }
  const auf = roh.match(/auftrag\D{0,15}(\d{4,8})/i);
  if (auf) gefunden.beispiel_auftrag = auf[1];
  return gefunden;
}

/* Ordnet den Text den Feldern zu. Liefert Treffer zum Bestätigen und die Zeilen,
   mit denen die App nichts anfangen konnte – damit nichts still verloren geht. */
function leseBlatt(text, formularId, werte, stamm) {
  const zeilen = String(text == null ? "" : text).split(/\r?\n/).map(z => z.trim()).filter(Boolean);
  const felder = formularFelder(formularId).map(f => {
    const worte = blattWorte(f.name);
    return { feld: f, worte: worte, langes: worte.some(w => w.length >= 5) };
  });
  const besteZeile = {};        // Feldname -> { wert, punkte, zeilen: [Index] }
  const benutzt = {};
  zeilen.forEach((z, i) => {
    const n = blattNorm(z);
    let best = null;
    felder.forEach(k => {
      if (!k.worte.length) return;
      const treffend = k.worte.filter(w => blattEnthaelt(n, w));
      if (!treffend.length) return;
      const punkte = treffend.length / k.worte.length;
      // Ein langes Wort muss dabei sein, sonst passt jede Zeile auf jedes Feld
      if (punkte < 0.6 || (k.langes && !treffend.some(w => w.length >= 5))) return;
      if (!best || punkte > best.punkte) best = { feld: k.feld, punkte: punkte };
    });
    if (!best) return;
    let wert = blattWert(z, best.feld), quelle = [i];
    // Steht der Wert allein in der nächsten Zeile, gehört er trotzdem dazu
    if (!wert && zeilen[i + 1] && /^[\d.,\s]+$/.test(zeilen[i + 1])) {
      wert = blattZahl(zeilen[i + 1]);
      if (wert) quelle = [i, i + 1];
    }
    if (!wert) return;
    const alt = besteZeile[best.feld.name];
    if (alt && alt.punkte >= best.punkte) return;
    besteZeile[best.feld.name] = { wert: wert, punkte: best.punkte, zeilen: quelle };
    quelle.forEach(x => { benutzt[x] = 1; });
  });

  const treffer = [];
  const st = blattStamm(zeilen);
  // Zeilen, aus denen die Stammdaten stammen, gelten ebenfalls als zugeordnet
  zeilen.forEach((z, i) => {
    const n = blattNorm(z);
    if (Object.keys(st).some(k => blattNorm(st[k]) && n.indexOf(blattNorm(st[k])) !== -1)) benutzt[i] = 1;
  });
  Object.keys(BLATT_STAMM).forEach(k => {
    if (!st[k]) return;
    treffer.push({ art: "stamm", schluessel: k, label: BLATT_STAMM[k], einheit: "",
                   wert: st[k], alt: ((stamm || {})[k] || "") });
  });
  formularFelder(formularId).forEach(f => {
    const t = besteZeile[f.name];
    if (!t) return;
    treffer.push({ art: "feld", schluessel: f.name, label: f.name, einheit: f.einheit || "",
                   wert: t.wert, alt: ((werte || {})[f.name] || "") });
  });
  return { treffer: treffer, rest: zeilen.filter((z, i) => !benutzt[i]) };
}

/* Assistent zum Anlegen/Ändern eines Musters – Schritt für Schritt, Werte antippen statt tippen */
let wiz = null;   // { phase: "start"|"vorlage"|"blatt"|"schritte", schritt, werte:{}, stamm:{} }

function wizStart(id) {
  if (id === "neu") {
    wiz = { phase: "start", schritt: 0, werte: {}, stamm: {}, formular: STANDARD_FORMULAR, blatt: "" };
  } else {
    const r = rezepte().find(x => x.id === id) || {};
    wiz = { phase: "schritte", schritt: 0, werte: Object.assign({}, r.soll || {}),
      formular: r.formular || STANDARD_FORMULAR, blatt: r.blatt || "",
      stamm: { kuerzel: r.kuerzel || "", aufbau: r.aufbau || "", klartext: r.klartext || "",
               maschine: r.maschine || "", beispiel_auftrag: r.beispiel_auftrag || "" } };
  }
}

function renderRezeptForm() {
  if (!wiz) wizStart(state.rezeptForm);
  if (wiz.phase === "start") return renderWizStart();
  if (wiz.phase === "vorlage") return renderWizVorlage();
  if (wiz.phase === "blatt") return renderWizBlatt();
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
      <button class="grossbtn" data-wiz-blatt="1">Vom Blatt abfotografieren
        <small>Foto vom Papier – die App trägt die erkannten Werte ein.</small></button>
      <button class="grossbtn" data-wiz-leer="1">Ganz neu anlegen
        <small>${gibtVorlagen ? "Nur nötig, wenn es nichts Ähnliches gibt." : "Das erste Muster anlegen."}</small></button>
    </div>`;
}

/* Foto vom Papier-Blatt und der davon erkannte Text */
function renderWizBlatt() {
  titel.textContent = "Vom Blatt übernehmen";
  const erg = wiz.blattErg;
  const trefferHtml = !erg ? "" : (erg.treffer.length
    ? erg.treffer.map((t, i) => `<label class="bl-zeile">
        <input type="checkbox" class="bl-an" data-i="${i}" checked>
        <span class="bl-feld">
          <span class="bl-name">${esc(t.label)}${t.einheit ? ` <span class="weinheit">(${esc(t.einheit)})</span>` : ""}
            ${t.alt && t.alt !== t.wert ? `<span class="meta">bisher ${esc(t.alt)}</span>` : ""}</span>
          <input type="text" class="bl-wert" data-i="${i}" value="${esc(t.wert)}">
        </span>
      </label>`).join("")
    : `<div class="leer">Aus diesem Text ließ sich nichts zuordnen. Prüfe, ob wirklich der Text vom Blatt eingefügt wurde.</div>`);

  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-wiz-blatt-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>1. Foto vom Blatt</h2>
      <p class="hinweis" style="margin-top:0">Das Foto bleibt beim Muster – du hast das Blatt dann in jedem Schritt daneben.</p>
      ${wiz.blatt
        ? `<img src="${wiz.blatt}" alt="Blatt" class="blatt-bild gross">
           <button class="btn btn-klein btn-rot" data-blatt-weg="1" style="margin-top:8px">Foto entfernen</button>`
        : fotoWahl("blatt")}
    </div>
    <div class="karte">
      <h2>2. Text vom Blatt einfügen</h2>
      <p class="hinweis" style="margin-top:0">Foto in der Fotos-App öffnen, den Text im Bild markieren, kopieren – und hier einfügen.
        Erkennen macht das Gerät selbst, es geht nichts nach außen. Bei Handschrift klappt es nur, wenn sie sauber ist – der Rest wird getippt.</p>
      <textarea id="blatt-text" rows="6" placeholder="Text hier einfügen">${esc(wiz.blattText || "")}</textarea>
      <button class="btn" data-blatt-lesen="1" style="margin-top:8px">Werte heraussuchen</button>
    </div>
    ${erg ? `<div class="karte">
      <h2>${erg.treffer.length} ${erg.treffer.length === 1 ? "Wert" : "Werte"} gefunden</h2>
      <p class="hinweis" style="margin-top:0">Nichts wird übernommen, was du nicht bestätigst. Haken weg = weglassen, Wert kannst du gleich richtigstellen.</p>
      ${trefferHtml}
      ${erg.treffer.length ? `<button class="btn btn-gruen" data-blatt-uebernehmen="1" style="margin-top:12px">Übernehmen und durchgehen</button>` : ""}
    </div>` : ""}
    ${erg && erg.rest.length ? `<div class="karte">
      <h2>Nicht zugeordnet</h2>
      <p class="hinweis" style="margin-top:0">Diese Zeilen passten zu keinem Feld. Was davon gebraucht wird, trägst du in den Schritten von Hand ein.</p>
      <div class="bl-rest">${erg.rest.map(z => esc(z)).join("<br>")}</div>
    </div>` : ""}
    ${!erg ? `<div class="karte">
      <p class="hinweis" style="margin-top:0">Ohne Text geht es auch: weiter zu den Schritten und alles antippen.</p>
      <button class="btn btn-grau" data-blatt-ohne="1">Weiter ohne Text</button>
    </div>` : ""}`;
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
      const vorschlaege = vorhandeneWerte(f);
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
  // Das fotografierte Blatt bleibt in jedem Schritt oben stehen
  const blattKarte = wiz.blatt
    ? `<div class="karte blatt-karte">
         <img src="${wiz.blatt}" alt="Blatt" class="blatt-bild ${wiz.blattGross ? "gross" : ""}" data-blatt-gross="1">
         <div class="blatt-zeile"><span class="meta">Blatt vom Papier · antippen zum Vergrößern</span>
           <button class="btn btn-klein btn-grau" data-wiz-blatt="1">Text übernehmen</button></div>
       </div>`
    : `<div class="karte blatt-karte">
         <div class="blatt-zeile"><span class="meta">Werte stehen auf Papier?</span>
           <button class="btn btn-klein btn-grau" data-wiz-blatt="1">Vom Blatt abfotografieren</button></div>
       </div>`;
  inhalt.innerHTML = `
    ${blattKarte}
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
/* Übernimmt nur die angehakten Zeilen – und danach geht es durch alle Schritte,
   damit jeder Wert noch einmal vor Augen kommt. */
function blattUebernehmen() {
  const erg = wiz.blattErg;
  if (!erg) return;
  let n = 0;
  erg.treffer.forEach((t, i) => {
    const an = document.querySelector('.bl-an[data-i="' + i + '"]');
    if (!an || !an.checked) return;
    const feld = document.querySelector('.bl-wert[data-i="' + i + '"]');
    const wert = String(feld ? feld.value : t.wert).trim();
    if (!wert) return;
    if (t.art === "stamm") wiz.stamm[t.schluessel] = wert;
    else wiz.werte[t.schluessel] = wert;
    n++;
  });
  wiz.blattErg = null; wiz.blattText = "";
  wiz.phase = "schritte"; wiz.schritt = 0;
  flash(n === 1 ? "1 Wert übernommen – bitte durchgehen." : n + " Werte übernommen – bitte durchgehen.");
  render(); window.scrollTo(0, 0);
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
  const felder = formularFelder(r.formular).filter(f => !f.angabe && soll[f.name] != null && soll[f.name] !== "");
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
    <div class="karte">
      <div class="label">Auf welcher Maschine läuft der Draht?</div>
      <select id="ruest-maschine">
        <option value="">– keine Maschine –</option>
        ${maschinen().map(m => `<option value="${esc(m)}"${m === r.maschine ? " selected" : ""}>${esc(m)}</option>`).join("")}
      </select>
      <p class="hinweis">Nach dem Abschließen steht der Draht bei dieser Maschine unter „Derzeit laufend".</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-klein btn-grau" data-verlauf="${r.id}">Rüst-Verlauf</button>
        ${g > 0 ? `<button class="btn btn-klein" data-ruest-abschluss="${r.id}">Rüstung abschließen</button>` : ""}
      </div>
    </div>
    <p class="hinweis">Werte ändern oder das Blatt versenden: im Bereich Erstmuster.</p>`;
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
    return `<div class="eintrag"><div><b>${e.datum}</b>${e.maschine ? " · " + esc(e.maschine) : ""}${e.benutzer ? " · " + esc(e.benutzer) : ""} <span class="rz-vers">${e.art === "kontrolle" ? "Kontrolle" : "Rüstung"}</span></div>${zeilen || '<div class="meta">keine Ist-Werte notiert</div>'}</div>`;
  }).join("") : `<div class="leer">Noch keine abgeschlossene Rüstung.</div>`;
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-verlauf-zurueck="${r ? r.id : ''}">‹ Zurück</button>
    <div class="karte" style="margin-top:12px"><h2>${r ? esc(r.kuerzel + " " + r.aufbau) : "Verlauf"} – frühere Rüstungen</h2>
      ${eintraege.length > 1 ? `<button class="btn btn-klein" data-rvergleich="${esc(state.verlauf)}" style="margin-bottom:10px">Werte vergleichen</button>` : ""}
      ${liste}</div>`;
}

/* ---------- Rüstungen vergleichen: was war beim letzten Mal anders? ---------- */
function ruestungenVon(rezeptId) { return rezeptId ? ruestungen().filter(x => x.rezept_id === rezeptId) : []; }
function istZahl(s) { return /^[+-]?\d+([.,]\d+)?$/.test(String(s).trim()); }
// Nachkommastellen so, wie sie eingetippt wurden – die Differenz soll gleich aussehen
function nachkomma(a, b) {
  const n = s => { const m = String(s).match(/[,.](\d+)$/); return m ? m[1].length : 0; };
  return Math.max(n(a), n(b));
}
function wertVon(ist, name) { const e = (ist || {})[name]; return e ? (e.wert || e.soll || "") : ""; }

// Vergleicht zwei abgeschlossene Rüstungen Feld für Feld (in der Reihenfolge des Formulars)
function vergleicheRuestungen(formular, alt, neu) {
  const felder = formularFelder(formular);
  const namen = felder.map(f => f.name);
  Object.keys(neu.ist || {}).concat(Object.keys(alt.ist || {}))
    .forEach(n => { if (namen.indexOf(n) === -1) namen.push(n); });
  return namen.map(n => {
    const a = wertVon(alt.ist, n), b = wertVon(neu.ist, n);
    if (!a && !b) return null;
    const f = felder.find(x => x.name === n) || {};
    const z = { name: n, alt: a, neu: b, einheit: f.einheit || "", geaendert: a !== b, diff: "", rauf: false };
    if (z.geaendert && a && b && istZahl(a) && istZahl(b)) {
      const d = zahl(b) - zahl(a);
      z.rauf = d > 0;
      z.diff = (d > 0 ? "+" : "−") + fmt(Math.abs(d), nachkomma(a, b));
    }
    return z;
  }).filter(Boolean);
}

// Unterschiede zweier Soll-Stände desselben Musters (für die PDF-Anlage)
function diffSollWerte(altSoll, neuSoll, formular) {
  const felder = formularFelder(formular);
  const namen = felder.map(f => f.name);
  Object.keys(neuSoll || {}).concat(Object.keys(altSoll || {}))
    .forEach(n => { if (namen.indexOf(n) === -1) namen.push(n); });
  return namen.map(n => {
    const a = (altSoll || {})[n] || "", b = (neuSoll || {})[n] || "";
    if (a === b) return null;
    const f = felder.find(x => x.name === n) || {};
    let diff = "";
    if (a && b && istZahl(a) && istZahl(b)) {
      const d = zahl(b) - zahl(a);
      diff = (d > 0 ? "+" : "-") + fmt(Math.abs(d), nachkomma(a, b));
    }
    return { name: n, alt: a, neu: b, diff: diff, einheit: f.einheit || "" };
  }).filter(Boolean);
}

/* Anlage fürs PDF: Änderungen seit dem zuletzt versendeten Stand + offene Notlösungen */
function anlageDaten(r) {
  const stand = standVon(r), v = r.versand || null;
  let aenderungen = [];
  if (v && v.stand < stand) {
    const alt = (r.historie || [])[v.stand - 1];   // historie[n-1] ist der Soll-Stand n
    if (alt) aenderungen = diffSollWerte(alt.soll, r.soll, r.formular);
  }
  const offen = notloesungen().filter(n => n.rezept_id === r.id && !n.erledigt && !n.versendet_am);
  return { stand: stand, versand: v, aenderungen: aenderungen, notloesungen: offen };
}

/* ---------- Kontrolle mitten in der Schicht: läuft die Maschine noch nach Muster? ---------- */
function renderKontrolle() {
  const m = state.kontrolle;
  const l = laufend()[m];
  if (!l) { state.kontrolle = null; return render(); }
  titel.textContent = m + " prüfen";
  const r = rezepte().find(x => x.id === l.rezept_id);
  const soll = (r && r.soll) || {};
  const felder = formularFelder((r && r.formular) || l.formular)
    .filter(f => !f.angabe && (soll[f.name] || (l.ist && l.ist[f.name])));
  const zeilen = felder.map(f => {
    const sollWert = soll[f.name] || ((l.ist && l.ist[f.name] && l.ist[f.name].soll) || "");
    const zuletzt = (l.ist && l.ist[f.name] && l.ist[f.name].wert) || "";
    return `<div class="rpunkt">
      <div class="p-body">
        <div class="p-kopf">
          <span class="p-name">${esc(f.name)}</span>
          <span class="p-soll">Soll <b>${esc(sollWert)}</b>${f.einheit ? ` <span class="p-einheit">${esc(f.einheit)}</span>` : ""}</span>
        </div>
        <input type="text" class="p-ist" data-kist="${esc(f.name)}" placeholder="${zuletzt ? "zuletzt " + esc(zuletzt) : "abgelesener Wert"}">
      </div>
    </div>`;
  }).join("");
  inhalt.innerHTML = `
    <button class="btn btn-grau btn-klein" data-kontrolle-zurueck="1">‹ Zurück</button>
    <div class="karte" style="margin-top:12px">
      <h2>${esc(drahtName(l))} auf ${esc(m)}</h2>
      <p class="hinweis" style="margin-top:0">Abgelesene Werte eintragen – nur ausgefüllte zählen. Weicht etwas ab, fragt die App danach wie beim Rüsten.</p>
    </div>
    <div class="karte"><h2>Werte an der Maschine</h2>
      ${zeilen || '<div class="leer">Für diesen Draht sind keine Werte hinterlegt.</div>'}</div>
    <div class="karte"><button class="btn" data-kontrolle-speichern="${esc(m)}">Kontrolle speichern</button></div>`;
}

function speichereKontrolle(m) {
  const lauf = laufend(), l = lauf[m];
  if (!l) return;
  const r = rezepte().find(x => x.id === l.rezept_id);
  const soll = (r && r.soll) || {};
  const felder = formularFelder((r && r.formular) || l.formular);
  const ist = {}, abweichungen = [];
  let gezaehlt = 0;
  document.querySelectorAll("[data-kist]").forEach(el => {
    const name = el.dataset.kist, wert = el.value.trim();
    if (!wert) return;
    gezaehlt++;
    const f = felder.find(x => x.name === name) || {};
    const sollWert = String(soll[name] || ((l.ist && l.ist[name] && l.ist[name].soll) || ""));
    ist[name] = { soll: sollWert, wert: wert, erledigt: true };
    if (sollWert && wert !== sollWert) {
      abweichungen.push({ name: name, soll: sollWert, ist: wert, einheit: f.einheit || "", grund: "" });
    }
  });
  if (!gezaehlt) return flash("Bitte mindestens einen Wert eintragen.");
  const zeit = jetzt();
  const rl = ruestungen();
  rl.push({ id: neueId(), art: "kontrolle", rezept_id: l.rezept_id, kuerzel: l.kuerzel,
            maschine: m, benutzer: wer(), datum: zeit, ist: ist });
  DB.set("ruestungen", rl);
  // die laufende Maschine zeigt ab jetzt die gerade abgelesenen Werte
  Object.keys(ist).forEach(k => { if (!l.ist) l.ist = {}; l.ist[k] = ist[k]; });
  l.geprueft = zeit; l.geprueft_von = wer();
  DB.set("laufend", lauf);
  state.kontrolle = null;
  if (abweichungen.length && l.rezept_id) {
    state.abweichung = { rezept_id: l.rezept_id, maschine: m, felder: abweichungen, phase: "frage" };
    flash(abweichungen.length + (abweichungen.length === 1 ? " Wert weicht ab." : " Werte weichen ab."));
  } else {
    flash("Kontrolle gespeichert – alles wie im Muster.");
  }
  render(); window.scrollTo(0, 0);
}

/* ---------- Nach dem Rüsten: Abweichung übernehmen oder als Notlösung festhalten ---------- */
function renderAbweichung() {
  const a = state.abweichung;
  const r = rezepte().find(x => x.id === a.rezept_id);
  if (!r) { state.abweichung = null; return render(); }
  titel.textContent = a.phase === "grund" ? "Notlösung festhalten" : "Abweichungen";
  const anz = a.felder.length;
  const zeilen = a.felder.map((f, i) => `
    <div class="abw-zeile">
      <div class="abw-kopf">
        <span class="abw-name">${esc(f.name)}${f.einheit ? ` <span class="einheit">${esc(f.einheit)}</span>` : ""}</span>
        <span class="abw-werte"><span class="alt-wert">${esc(f.soll)}</span> → <b>${esc(f.ist)}</b></span>
      </div>
      ${a.phase === "grund" ? `<input type="text" class="abw-grund" data-grund="${i}" value="${esc(f.grund || "")}" placeholder="Warum? (steht später im Erstmuster)">` : ""}
    </div>`).join("");

  inhalt.innerHTML = a.phase === "grund"
    ? `<div class="karte">
        <h2>Notlösung festhalten</h2>
        <p class="hinweis" style="margin-top:0">Der Sollwert im Erstmuster bleibt, wie er ist. Die Abweichung steht künftig auf Seite 2 des Erstmusters.</p>
        ${zeilen}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-klein" data-abw-speichern="1">Speichern</button>
          <button class="btn btn-klein btn-grau" data-abw-ohne-grund="1">Ohne Grund speichern</button>
        </div>
      </div>`
    : `<div class="karte">
        <h2>${anz} ${anz === 1 ? "Wert war" : "Werte waren"} anders als im Erstmuster</h2>
        <p class="hinweis" style="margin-top:0">${esc(r.kuerzel + " " + r.aufbau)} · Stand ${standVon(r)} – sollen die gerüsteten Werte der neue Stand werden?</p>
        ${zeilen}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-klein btn-gruen" data-abw-uebernehmen="1">Ja, als neuen Stand übernehmen</button>
          <button class="btn btn-klein btn-grau" data-abw-notloesung="1">Nein, war nur diesmal so</button>
        </div>
      </div>`;
}

function uebernehmeAbweichungen() {
  const a = state.abweichung, list = rezepte(), r = list.find(x => x.id === a.rezept_id);
  if (!r) { state.abweichung = null; return render(); }
  const alt = { soll: Object.assign({}, r.soll), kuerzel: r.kuerzel, aufbau: r.aufbau, klartext: r.klartext,
                maschine: r.maschine, beispiel_auftrag: r.beispiel_auftrag, formular: r.formular };
  if (!r.historie) r.historie = [];
  r.historie.push(Object.assign({}, alt, { stand_vom: r.geaendert_am || r.created_at, geaendert_von: r.geaendert_von || r.benutzer || "" }));
  if (!r.soll) r.soll = {};
  a.felder.forEach(f => { r.soll[f.name] = f.ist; });
  r.geaendert_am = jetzt(); r.geaendert_von = wer();
  DB.set("rezepte", list);
  state.abweichung = null;
  flash("Neuer Stand " + standVon(r) + " gespeichert."); render(); window.scrollTo(0, 0);
}

function speichereNotloesungen(mitGrund) {
  const a = state.abweichung, list = notloesungen();
  a.felder.forEach(f => {
    list.push({ id: neueId(), rezept_id: a.rezept_id, maschine: a.maschine || "",
                feld: f.name, soll: f.soll, ist: f.ist,
                einheit: f.einheit || "", grund: mitGrund ? String(f.grund || "").trim() : "",
                datum: jetzt(), benutzer: wer(), erledigt: false, versendet_am: null });
  });
  DB.set("notloesungen", list);
  state.abweichung = null;
  flash(a.felder.length === 1 ? "Notlösung festgehalten." : a.felder.length + " Notlösungen festgehalten.");
  render(); window.scrollTo(0, 0);
}

function renderRuestVergleich() {
  const rv = state.rvergleich;
  const r = rezepte().find(x => x.id === rv.rezept_id);
  const chrono = ruestungenVon(rv.rezept_id);
  const liste = chrono.slice().reverse();   // neueste zuerst
  const nr = id => chrono.findIndex(x => x.id === id) + 1;
  titel.textContent = "Was hat sich geändert?";
  const zurueck = `<button class="btn btn-grau btn-klein" data-rv-zurueck="1">‹ Zurück</button>`;
  if (liste.length < 2) {
    inhalt.innerHTML = `${zurueck}
      <div class="karte" style="margin-top:12px"><div class="leer">Zum Vergleichen braucht es mindestens zwei abgeschlossene Rüstungen von diesem Muster.</div></div>`;
    return;
  }
  if (!liste.some(x => x.id === rv.a)) rv.a = liste[0].id;
  if (!liste.some(x => x.id === rv.b) || rv.b === rv.a) rv.b = (liste.find(x => x.id !== rv.a) || liste[1]).id;
  const neu = liste.find(x => x.id === rv.a), alt = liste.find(x => x.id === rv.b);
  // Nummer davor: zwei Rüstungen in derselben Minute wären sonst nicht zu unterscheiden
  const opt = (gewaehlt) => liste.map((x, i) =>
    `<option value="${esc(x.id)}"${x.id === gewaehlt ? " selected" : ""}>Nr. ${nr(x.id)}${i === 0 ? " (neueste)" : ""} · ${x.art === "kontrolle" ? "Kontrolle" : "Rüstung"} · ${esc(x.datum)}${x.benutzer ? " · " + esc(x.benutzer) : ""}</option>`).join("");

  const zeilen = vergleicheRuestungen(r ? r.formular : null, alt, neu);
  const geaendert = zeilen.filter(z => z.geaendert), gleich = zeilen.filter(z => !z.geaendert);
  const zeileHtml = z => `
    <div class="rv-zeile${z.geaendert ? "" : " gleich"}">
      <span class="rv-name">${esc(z.name)}${z.einheit ? ` <span class="einheit">${esc(z.einheit)}</span>` : ""}</span>
      <span class="rv-werte">${z.geaendert
        ? `<span class="alt-wert">${esc(z.alt || "–")}</span> → <b>${esc(z.neu || "–")}</b>`
        : `<b>${esc(z.neu || "–")}</b>`}</span>
      ${z.diff ? `<span class="rv-diff ${z.rauf ? "rauf" : "runter"}">${z.rauf ? "▲" : "▼"} ${esc(z.diff)}${z.einheit ? " " + esc(z.einheit) : ""}</span>`
        : z.geaendert ? `<span class="rv-diff neutral">geändert</span>` : `<span class="rv-diff neutral">gleich</span>`}
    </div>`;

  inhalt.innerHTML = `${zurueck}
    <div class="karte" style="margin-top:12px">
      <h2>${esc(r ? r.kuerzel + " " + r.aufbau : "Muster")}</h2>
      <div class="zwei">
        <div><div class="label">Diese Rüstung</div><select id="rv-a">${opt(rv.a)}</select></div>
        <div><div class="label">verglichen mit</div><select id="rv-b">${opt(rv.b)}</select></div>
      </div>
    </div>
    <div class="karte">
      <h2>Geändert (${geaendert.length} von ${zeilen.length})</h2>
      ${geaendert.length ? geaendert.map(zeileHtml).join("") : `<div class="leer">Nichts geändert – beide Rüstungen sind gleich eingestellt.</div>`}
    </div>
    <div class="karte">
      <button class="btn btn-grau btn-klein" data-rv-alle="1">${rv.alle ? "Unveränderte ausblenden" : "Auch die " + gleich.length + " unveränderten zeigen"}</button>
      ${rv.alle ? `<div style="margin-top:10px">${gleich.map(zeileHtml).join("") || '<div class="leer">Keine.</div>'}</div>` : ""}
    </div>`;
}

// Auswahlknöpfe eines Feldes: bisher benutzte Werte (häufigste zuerst),
// danach die üblichen Vorschläge, die noch nicht dabei sind.
function vorhandeneWerte(feld) {
  const name = (typeof feld === "string") ? feld : feld.name;
  const zaehler = {};
  rezepte().forEach(r => {
    const v = (r.soll || {})[name];
    if (v) zaehler[v] = (zaehler[v] || 0) + 1;
    (r.historie || []).forEach(h => { const hv = (h.soll || {})[name]; if (hv) zaehler[hv] = (zaehler[hv] || 0) + 1; });
  });
  const benutzt = Object.keys(zaehler).sort((a, b) => zaehler[b] - zaehler[a]);
  const vorschlaege = (typeof feld === "object" && feld.vorschlaege) ? feld.vorschlaege : [];
  return benutzt.concat(vorschlaege.filter(v => benutzt.indexOf(v) === -1)).slice(0, 6);
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
      // Das Blattfoto steht nicht in der Historie, muss aber auch allein gespeichert werden
      if ((wiz.blatt || "") !== (r.blatt || "")) {
        if (wiz.blatt) { r.blatt = wiz.blatt; r.blatt_am = jetzt(); r.blatt_von = wer(); }
        else { delete r.blatt; delete r.blatt_am; delete r.blatt_von; }
        r.geaendert_am = jetzt(); r.geaendert_von = wer();
      }
    }
  } else {
    const neu = { id: neueId(), ...daten, ruest_status: {}, historie: [], benutzer: wer(), created_at: jetzt(), geaendert_am: jetzt() };
    if (wiz.blatt) { neu.blatt = wiz.blatt; neu.blatt_am = jetzt(); neu.blatt_von = wer(); }
    list.push(neu);
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
  const wahl = document.getElementById("ruest-maschine");
  const maschine = wahl ? wahl.value : (r.maschine || "");
  const soll = r.soll || {}, status = r.ruest_status || {};
  const ist = {}, abweichungen = [];
  formularFelder(r.formular).filter(f => !f.angabe && soll[f.name] != null && soll[f.name] !== "").forEach(f => {
    const st = status[f.name] || {};
    ist[f.name] = { soll: soll[f.name], wert: st.ist || "", erledigt: !!st.erledigt };
    const gefahren = String(st.ist || "").trim();
    if (gefahren && gefahren !== String(soll[f.name]).trim()) {
      abweichungen.push({ name: f.name, soll: String(soll[f.name]), ist: gefahren, einheit: f.einheit || "", grund: "" });
    }
  });
  const zeit = jetzt();
  const rl = ruestungen();
  rl.push({ id: neueId(), rezept_id: id, kuerzel: r.kuerzel, maschine: maschine, benutzer: wer(), datum: zeit, ist: ist });
  DB.set("ruestungen", rl);
  r.ruest_status = {};  // für die nächste Rüstung zurücksetzen
  DB.set("rezepte", list);
  if (maschine) {
    // ersetzt, was vorher auf der Maschine lief – das hier ist der aktuelle Stand, kein Verlauf
    const lauf = laufend();
    lauf[maschine] = { rezept_id: id, kuerzel: r.kuerzel, aufbau: r.aufbau, klartext: r.klartext,
                       auftrag: r.beispiel_auftrag || "", formular: r.formular,
                       ist: ist, seit: zeit, benutzer: wer() };
    DB.set("laufend", lauf);
  }
  flash(maschine ? "Gerüstet – läuft jetzt auf " + maschine + "." : "Rüstung im Verlauf gespeichert.");
  // Wich ein Wert vom Erstmuster ab? Dann gleich klären, ob das der neue Stand ist
  if (abweichungen.length) state.abweichung = { rezept_id: id, maschine: maschine, felder: abweichungen, phase: "frage" };
  render(); window.scrollTo(0, 0);
}

/* ---------- Erstmuster als PDF verschicken ---------- */
async function sendeErstmuster(id) {
  const r = rezepte().find(x => x.id === id);
  if (!r) return;
  let blob;
  const heute = jetzt().split(" ")[0];   // nur das Datum, ohne Uhrzeit
  const anlage = anlageDaten(r);
  try { blob = erstmusterPdf(r, wer(), heute, anlage); }
  catch (e) { logFehler("PDF", e.message, e.stack); return flash("PDF konnte nicht erstellt werden."); }

  const name = "Erstmuster_" + (r.kuerzel || "Muster").replace(/[^\wäöüÄÖÜß-]/g, "") +
    (r.aufbau ? "_" + r.aufbau.replace(/[^\w,-]/g, "") : "") +
    "_Stand" + anlage.stand + "_" + heute.split(".").reverse().join("-") + ".pdf";
  const datei = new File([blob], name, { type: "application/pdf" });
  const text = "Erstmuster " + [r.kuerzel, r.aufbau, r.klartext].filter(Boolean).join(" ")
    + (r.maschine ? " · " + r.maschine : "")
    + (r.beispiel_auftrag ? " · Auftrag " + r.beispiel_auftrag : "")
    + "\nFormular: " + formularName(r.formular) + " · Stand " + anlage.stand
    + (anlage.aenderungen.length || anlage.notloesungen.length
        ? "\nSeite 2: " + anlage.aenderungen.length + " geänderte Werte, " + anlage.notloesungen.length + " Notlösungen" : "")
    + "\nErstellt: " + jetzt() + " von " + (wer() || "-");

  if (navigator.canShare && navigator.canShare({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: name, text: text }); merkeVersand(r.id, anlage); return; }
    catch (e) { if (e && e.name === "AbortError") return; }   // Nutzer hat abgebrochen
  }
  // Kein Teilen möglich -> Datei ablegen, damit sie von Hand angehängt werden kann
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  merkeVersand(r.id, anlage);
  flash("PDF gespeichert – von dort an die Mail anhängen.");
}

/* Festhalten, welcher Stand rausging – damit die Liste zeigt, wo ein altes Blatt liegt.
   Gemeldete Notlösungen sind erledigt; kommen sie wieder vor, werden sie neu erfasst. */
function merkeVersand(id, anlage) {
  const list = rezepte(), r = list.find(x => x.id === id);
  if (!r) return;
  const zeit = jetzt();
  r.versand = { stand: anlage.stand, datum: zeit, benutzer: wer() };
  DB.set("rezepte", list);
  if (anlage.notloesungen.length) {
    const ids = anlage.notloesungen.map(n => n.id);
    const nl = notloesungen();
    nl.forEach(n => { if (ids.indexOf(n.id) !== -1) n.versendet_am = zeit; });
    DB.set("notloesungen", nl);
  }
  render();
}

/* ---------- Suche über alles ---------- */
let alleSuche = "";
function sucheAlles(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return null;
  const passt = (...teile) => teile.filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
  return {
    erstmuster: rezepte().filter(r => passt(r.kuerzel, r.aufbau, r.klartext, r.maschine, r.beispiel_auftrag)),
    spulen: spulen().filter(s => passt(s.auftrag, s.benutzer)),
    aufgaben: todos().filter(t => passt(t.text, t.machine)),
    notizen: entries().filter(e => passt(e.note, e.machine, e.benutzer)),
    notloesungen: notloesungen().filter(n => passt(n.feld, n.grund, n.maschine)),
  };
}
function sucheHtml() {
  const t = sucheAlles(alleSuche);
  if (!t) return `<div class="leer">Mindestens zwei Zeichen eingeben.</div>`;
  const gesamt = Object.keys(t).reduce((n, k) => n + t[k].length, 0);
  if (!gesamt) return `<div class="leer">Nichts gefunden.</div>`;
  const block = (titel, eintraege, zeile) => eintraege.length
    ? `<div class="such-gruppe">${titel} <span class="rz-fort">${eintraege.length}</span></div>${eintraege.slice(0, 8).map(zeile).join("")}`
    : "";
  return block("Erstmuster", t.erstmuster, r => `<div class="eintrag such-treffer" data-such-em="${r.id}">
      <b>${esc(r.kuerzel)}</b> ${esc(r.aufbau)}<div class="meta">${esc(r.klartext || "")}${r.maschine ? " · " + esc(r.maschine) : ""}${r.beispiel_auftrag ? " · Auftrag " + esc(r.beispiel_auftrag) : ""}</div></div>`)
    + block("Berechnungen", t.spulen, s => `<div class="eintrag such-treffer" data-such-spule="1">
      <b>${s.auftrag ? "Auftrag " + esc(s.auftrag) : "Berechnung"}</b><div class="meta">${fmt(s.endgewicht)} kg · ${s.created_at}</div></div>`)
    + block("Aufgaben", t.aufgaben, x => `<div class="eintrag such-treffer" data-such-aufgabe="1">
      ${x.machine ? "<b>" + esc(x.machine) + ":</b> " : ""}${esc(x.text)}<div class="meta">${x.done ? "erledigt" : "offen"} · ${x.created_at}</div></div>`)
    + block("Notizen", t.notizen, e => `<div class="eintrag such-treffer" data-such-maschine="${esc(e.machine)}">
      <b>${esc(e.machine)}</b> ${esc(e.note || STATUS[e.status].label)}<div class="meta">${e.created_at}${e.benutzer ? " · " + esc(e.benutzer) : ""}</div></div>`)
    + block("Notlösungen", t.notloesungen, n => `<div class="eintrag such-treffer" data-such-em="${n.rezept_id}">
      <b>${esc(n.feld)}</b> Soll ${esc(n.soll)} · gefahren ${esc(n.ist)}<div class="meta">${n.maschine ? esc(n.maschine) + " · " : ""}${esc(n.datum)}</div></div>`);
}

/* ---------- Ansicht: Mehr / Sicherung ---------- */
function renderMehr() {
  titel.textContent = "Mehr";
  const anz = { m: entries().length, a: todos().length, s: spulen().length };
  inhalt.innerHTML = `
    <div class="karte">
      <h2>Alles durchsuchen</h2>
      <p class="hinweis" style="margin-top:0">Sucht in Erstmustern, Berechnungen, Aufgaben, Notizen und Notlösungen.</p>
      <input type="text" id="alle-suche" placeholder="Auftrag, Kürzel, Maschine, Wort …" value="${esc(alleSuche)}">
      <div id="such-ergebnis" style="margin-top:10px">${alleSuche ? sucheHtml() : ""}</div>
    </div>
    <div class="karte">
      <h2>Datensicherung</h2>
      <p class="hinweis" style="margin-top:0">Gespeichert im Gerät: ${anz.m} Maschinen-Einträge, ${anz.a} Aufgaben, ${anz.s} Spulen-Berechnungen.</p>
      <p class="hinweis ${sicherungFaellig() ? "warnung" : ""}">Letzte Sicherung: <b>${letzteSicherung() ? new Date(letzteSicherung()).toLocaleDateString("de-DE") : "noch keine"}</b>${sicherungFaellig() ? " – fällig!" : ""}<br>
        iOS räumt App-Daten von selbst auf, wenn die App länger nicht benutzt wird. Ohne Sicherung sind die Erstmuster dann weg.</p>
      <button class="btn" data-export="1">Sicherung erstellen / teilen</button>
      <div class="label" style="margin-top:14px">Sicherung einlesen</div>
      <input type="file" id="import-file" accept="application/json,.json">
      <button class="btn" data-import="1" style="margin-top:10px">Zusammenführen</button>
      <p class="hinweis">Für den Abgleich zweier Geräte: fehlende Einträge kommen dazu, bei doppelten gewinnt der neuere. Nichts geht verloren.</p>
      <button class="btn btn-grau btn-klein" data-import-ersetzen="1" style="margin-top:8px">Stattdessen alles ersetzen</button>
    </div>
    ${papierkorb().length ? `<div class="karte">
      <h2>Papierkorb</h2>
      <p class="hinweis" style="margin-top:0">Gelöschtes bleibt ${PAPIERKORB_TAGE} Tage liegen und lässt sich zurückholen.</p>
      ${papierkorb().slice().reverse().map(x => `<div class="eintrag" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span><b>${esc(x.titel || "Eintrag")}</b><div class="meta">${esc(PK_ARTEN[x.art] || x.art)} · gelöscht ${esc(x.datum)}${x.benutzer ? " · " + esc(x.benutzer) : ""}</div></span>
        <button class="btn btn-klein" data-pk-zurueck="${x.id}">Zurückholen</button>
      </div>`).join("")}
    </div>` : ""}
    <div class="karte">
      <h2>Maschinen</h2>
      <p class="hinweis" style="margin-top:0">Diese Maschinen erscheinen als Kacheln in der Schichtübergabe – mit Status, Notizen, Aufgaben und „Derzeit laufend".</p>
      ${maschinen().map(m => `<div class="eintrag" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span><b>${esc(m)}</b>${laufend()[m] ? ` <span class="meta">läuft: ${esc(drahtName(laufend()[m]))}</span>` : ""}</span>
        <button class="btn btn-klein btn-rot" data-maschine-loeschen="${esc(m)}">Entfernen</button>
      </div>`).join("") || `<div class="leer">Noch keine Maschine angelegt.</div>`}
      <div class="label" style="margin-top:14px">Neue Maschine</div>
      <input type="text" id="nm-name" placeholder="z. B. Z49" maxlength="20">
      <button class="btn" data-maschine-neu="1" style="margin-top:10px">Maschine anlegen</button>
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
        ? `<p class="hinweis" style="margin-top:0">✓ Die Daten sind <b>verschlüsselt</b> – ohne den Code sind sie nicht lesbar.</p>
           <button class="btn ${codeGemerkt() ? "btn-grau" : ""}" data-code-fragen="1">
             Beim Öffnen nach dem Code fragen: ${codeGemerkt() ? "AUS" : "AN"}</button>
           <p class="hinweis${codeGemerkt() ? " warnung" : ""}">${codeGemerkt()
             ? "Die App öffnet sich sofort. Der Code liegt dafür im Gerät – wer das entsperrte Gerät in der Hand hat, sieht alle Erstmuster. Es schützt dann nur noch der Code des Geräts."
             : "Der Code wird bei jedem Öffnen abgefragt."}</p>
           <button class="btn btn-grau" data-code-aendern="1" style="margin-top:8px">Code ändern</button>
           <button class="btn btn-grau btn-klein" data-code-entfernen="1" style="margin-top:8px">Verschlüsselung entfernen</button>`
        : `<p class="hinweis warnung" style="margin-top:0">Die Daten liegen aktuell <b>unverschlüsselt</b> auf dem Gerät. Wer das entsperrte Handy in die Hand bekommt, liest alle Erstmuster mit. Mit einem Code werden sie verschlüsselt.</p>
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
      <p class="hinweis" style="margin-top:0"><b>Drahtzug</b> – Feinzug 2. Läuft offline auf dem Gerät, alle Daten bleiben lokal.
      Maschinen legst du selbst an; die Ampel-Status sind fest vorgegeben (grün=Produktion, gelb=Umbau, rot=Drahtriss, blau=Reparatur, violett=Abrüsten).</p>
    </div>`;
}

async function codeSetzen() {
  const code = document.getElementById("code-neu").value.trim();
  if (code.length < 4) return flash("Bitte mindestens 4 Zeichen.");
  if (!confirm("Verschlüsselung aktivieren?\n\nWICHTIG: Ohne diesen Code sind die Daten NICHT mehr lesbar. Notiere ihn sicher und mach vorher eine Sicherung (Datei-Sicherung oben).")) return;
  VAULT_CODE = code;
  localStorage.setItem("sue_vault_enc", JSON.stringify(await verschluessle(VAULT, code)));
  raeumeAltePlainKeys();
  DB.set("verschl_abgelehnt", false);
  pruefeHinweisBanner();
  flash("Verschlüsselung aktiv."); render();
}
async function codeAendern() {
  const code = (prompt("Neuer Code (mind. 4 Zeichen):") || "").trim();
  if (!code) return;
  if (code.length < 4) return flash("Bitte mindestens 4 Zeichen.");
  VAULT_CODE = code;
  localStorage.setItem("sue_vault_enc", JSON.stringify(await verschluessle(VAULT, code)));
  if (codeGemerkt()) merkeCode(code);   // sonst sperrt sich die App beim nächsten Start aus
  flash("Code geändert.");
}
/* Schalter: fragt die App beim Öffnen nach dem Code oder nicht */
function codeFragenUmschalten() {
  if (codeGemerkt()) {
    vergissCode();
    flash("Der Code wird beim Öffnen wieder abgefragt.");
  } else {
    if (!confirm("Beim Öffnen nicht mehr nach dem Code fragen?\n\nDer Code wird dafür im Gerät gespeichert. Wer das entsperrte Gerät in die Hand bekommt, sieht dann alle Erstmuster – geschützt bist du nur noch durch den Code des Geräts selbst.")) return;
    merkeCode(VAULT_CODE);
    flash("Die App öffnet sich künftig ohne Code.");
  }
  render();
}
async function codeEntfernen() {
  if (!confirm("Verschlüsselung entfernen? Die Daten liegen dann unverschlüsselt auf dem Gerät.")) return;
  VAULT_CODE = null;
  vergissCode();
  localStorage.removeItem("sue_vault_enc");
  localStorage.setItem("sue_vault", JSON.stringify(VAULT));
  pruefeHinweisBanner();
  flash("Verschlüsselung entfernt."); render();
}

/* ---------- Papierkorb: Gelöschtes 30 Tage aufheben ---------- */
const PAPIERKORB_TAGE = 30;
const PK_ARTEN = { rezepte: "Erstmuster", todos: "Aufgabe", spulen: "Berechnung" };
function inDenPapierkorb(art, eintrag, titel) {
  const pk = papierkorb();
  pk.push({ id: neueId(), art: art, titel: titel, daten: eintrag, datum: jetzt(), benutzer: wer() });
  DB.set("papierkorb", pk);
}
function raeumePapierkorb() {
  const grenze = Date.now() - PAPIERKORB_TAGE * 24 * 3600 * 1000;
  const pk = papierkorb();
  const bleibt = pk.filter(x => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(x.datum || ""));
    if (!m) return true;                                   // ohne Datum lieber behalten
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime() >= grenze;
  });
  if (bleibt.length !== pk.length) DB.set("papierkorb", bleibt);
}
function stelleWiederHer(id) {
  const pk = papierkorb(), x = pk.find(e => e.id === id);
  if (!x) return;
  const liste = DB.get(x.art, []);
  if (!liste.some(e => e.id === (x.daten && x.daten.id))) liste.push(x.daten);
  DB.set(x.art, liste);
  DB.set("papierkorb", pk.filter(e => e.id !== id));
  flash((PK_ARTEN[x.art] || "Eintrag") + " wiederhergestellt."); render();
}

/* ---------- Sicherung ---------- */
function letzteSicherung() { return DB.get("sicherung_ts", null); }
function sicherungFaellig() {
  const ts = letzteSicherung();
  const hatDaten = entries().length + todos().length + spulen().length + rezepte().length > 0;
  if (!hatDaten) return false;
  return ts == null || (Date.now() - ts >= WOCHE_MS);
}
// Ein Banner für beides – Sicherung geht vor, weil dabei Daten verloren gehen können
function pruefeHinweisBanner() {
  const b = document.getElementById("hinweis-banner");
  if (!b) return;
  if (sicherungFaellig()) {
    b.textContent = "⬇ Sicherung fällig – " + (letzteSicherung() ? "die letzte ist über eine Woche her." : "es gibt noch keine.") + " Zum Sichern tippen.";
    b.dataset.tun = "sicherung"; b.classList.add("zeigen");
  } else if (!VAULT_CODE && !DB.get("verschl_abgelehnt", false)) {
    b.textContent = "🔒 Die Daten liegen unverschlüsselt im Gerät. Zum Einrichten tippen.";
    b.dataset.tun = "code"; b.classList.add("zeigen");
  } else {
    b.classList.remove("zeigen");
  }
}

/* ---------- Sicherungen zusammenführen (zwei Geräte, ein Datenstand) ---------- */
function letzteAenderung(x) {
  return Math.max(zeitWert(x.geaendert_am), zeitWert(x.versendet_am), zeitWert(x.done_at),
                  zeitWert(x.datum), zeitWert(x.created_at), zeitWert(x.seit));
}
function mischeListe(vorhanden, importiert) {
  const map = {}, reihe = [];
  (vorhanden || []).forEach(x => { if (x && x.id) { if (!map[x.id]) reihe.push(x.id); map[x.id] = x; } });
  let neu = 0, aktualisiert = 0;
  (importiert || []).forEach(x => {
    if (!x || !x.id) return;
    const alt = map[x.id];
    if (!alt) { map[x.id] = x; reihe.push(x.id); neu++; }
    else if (letzteAenderung(x) > letzteAenderung(alt)) { map[x.id] = x; aktualisiert++; }
  });
  return { liste: reihe.map(id => map[id]), neu: neu, aktualisiert: aktualisiert };
}
function fuehreZusammen(d) {
  let neu = 0, akt = 0;
  ["entries", "todos", "spulen", "rezepte", "ruestungen", "notloesungen"].forEach(k => {
    if (!Array.isArray(d[k])) return;
    const r = mischeListe(DB.get(k, []), d[k]);
    DB.set(k, r.liste); neu += r.neu; akt += r.aktualisiert;
  });
  if (Array.isArray(d.maschinen)) {
    const m = maschinen().slice();
    d.maschinen.forEach(x => { if (typeof x === "string" && !m.some(v => v.toLowerCase() === x.toLowerCase())) { m.push(x); neu++; } });
    DB.set("maschinen", m);
  }
  if (d.laufend && typeof d.laufend === "object") {
    const l = laufend();
    Object.keys(d.laufend).forEach(m => {
      const fremd = d.laufend[m];
      if (!l[m] || zeitWert(fremd.seit) > zeitWert(l[m].seit)) { l[m] = fremd; akt++; }
    });
    DB.set("laufend", l);
  }
  return { neu: neu, aktualisiert: akt };
}

function exportData() {
  const daten = { version: 1, exportiert: jetzt(), entries: entries(), todos: todos(), spulen: spulen(),
                  rezepte: rezepte(), ruestungen: ruestungen(), maschinen: maschinen(), laufend: laufend(),
                  notloesungen: notloesungen() };
  const text = JSON.stringify(daten, null, 2);
  const name = "drahtzug-sicherung-" + jetzt().split(" ")[0].split(".").reverse().join("-") + ".json";
  DB.set("sicherung_ts", Date.now());
  pruefeHinweisBanner();
  const blob = new Blob([text], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "Schichtübergabe-Sicherung" }).catch(() => {});
  } else {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); flash("Sicherung heruntergeladen.");
  }
}
// ersetzen = alles überschreiben (echte Wiederherstellung),
// sonst zusammenführen: fehlende Einträge dazu, neuere gewinnen
function importData(ersetzen) {
  const f = document.getElementById("import-file").files[0];
  if (!f) return flash("Bitte zuerst eine Datei wählen.");
  if (ersetzen && !confirm('Alles ersetzen?\n\nDie Daten auf diesem Gerät werden durch die Datei ersetzt. Zum Abgleich zweier Geräte lieber „Zusammenführen" nehmen.')) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== "object") throw new Error();
      if (ersetzen) {
        ["entries", "todos", "spulen", "rezepte", "ruestungen", "maschinen", "notloesungen"]
          .forEach(k => { if (Array.isArray(d[k])) DB.set(k, d[k]); });
        if (d.laufend && typeof d.laufend === "object") DB.set("laufend", d.laufend);
        flash("Sicherung eingelesen.");
      } else {
        const e = fuehreZusammen(d);
        flash(e.neu + " neu, " + e.aktualisiert + " aktualisiert.");
      }
      render();
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

/* Zwei Wege zum Bild: frisch fotografieren oder eines nehmen, das schon auf dem Handy liegt.
   Aussuchen macht das Betriebssystem in seinem eigenen Fenster – die App bekommt nur das eine
   gewählte Bild, nie einen Zugriff auf die Fotomediathek. */
function fotoWahl(ziel, extra) {
  const zu = extra || "";
  return `<input type="file" class="fotoweg" id="foto-${ziel}-kamera" data-foto-ziel="${ziel}" accept="image/*" capture="environment" ${zu}>
    <input type="file" class="fotoweg" id="foto-${ziel}-datei" data-foto-ziel="${ziel}" accept="image/*" ${zu}>
    <div class="fotowahl">
      <button class="btn btn-klein" data-foto-quelle="foto-${ziel}-kamera">Jetzt fotografieren</button>
      <button class="btn btn-klein btn-grau" data-foto-quelle="foto-${ziel}-datei">Vom Handy wählen</button>
    </div>
    <p class="hinweis">Die App bekommt nur das eine Bild, das du aussuchst – auf deine Fotos hat sie keinen Zugriff.</p>`;
}

function verkleinereFoto(file, maxKante, guete) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = maxKante || 1200; let w = img.width, h = img.height;
      if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { resolve(c.toDataURL("image/jpeg", guete || 0.7)); } catch (e) { reject(e); }
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
  const el = e.target.closest("[data-maschine],[data-zurueck],[data-status],[data-speichern-eintrag],[data-add-todo],[data-toggle-todo],[data-del-todo],[data-modus],[data-abzug],[data-save-spule],[data-edit-spule],[data-del-spule],[data-g-uebernehmen],[data-rezept-neu],[data-rezept],[data-em],[data-em-zurueck],[data-em-loeschen],[data-rezept-zurueck],[data-rezept-bearbeiten],[data-formular],[data-wiz-vorlage],[data-wiz-leer],[data-wiz-kopie],[data-wiz-zurueck-start],[data-wiz-blatt],[data-wiz-blatt-zurueck],[data-foto-quelle],[data-blatt-weg],[data-blatt-gross],[data-blatt-lesen],[data-blatt-uebernehmen],[data-blatt-ohne],[data-wiz-weiter],[data-wiz-zurueck],[data-wiz-wert],[data-wiz-eigen],[data-verlauf],[data-verlauf-zurueck],[data-vergleich],[data-vergleich-zurueck],[data-check],[data-ruest-abschluss],[data-erstmuster],[data-export],[data-import],[data-fehler-zurueck],[data-fehler-senden],[data-fehler-teilen],[data-fehler-kopieren],[data-fehler-loeschen],[data-wochenbericht],[data-code-setzen],[data-code-aendern],[data-code-entfernen],[data-code-fragen],[data-grossschrift],[data-abmelden],[data-benutzer-neu],[data-pw-aendern],[data-benutzer-loeschen],[data-maschine-neu],[data-maschine-loeschen],[data-laufend-ende],[data-rvergleich],[data-rv-zurueck],[data-rv-alle],[data-abw-uebernehmen],[data-abw-notloesung],[data-abw-speichern],[data-abw-ohne-grund],[data-nl-erledigt],[data-import-ersetzen],[data-pk-zurueck],[data-gesehen],[data-kontrolle],[data-kontrolle-zurueck],[data-kontrolle-speichern],[data-pk-weg],[data-such-em],[data-such-spule],[data-such-aufgabe],[data-such-maschine]");
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
  else if (el.dataset.rezeptNeu) { zeige("erstmuster"); state.rezeptForm = "neu"; wizStart("neu"); render(); window.scrollTo(0, 0); }
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
  else if (el.dataset.wizBlatt) { wiz.vorBlatt = wiz.phase; wiz.phase = "blatt"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.wizBlattZurueck) { wiz.phase = wiz.vorBlatt || "start"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.blattOhne) { wiz.phase = "schritte"; wiz.schritt = 0; render(); window.scrollTo(0, 0); }
  else if (el.dataset.fotoQuelle) {
    const i = document.getElementById(el.dataset.fotoQuelle);
    if (i) i.click();  // öffnet Kamera bzw. Auswahlfenster des Handys
  }
  else if (el.dataset.blattWeg) { wiz.blatt = ""; render(); }
  else if (el.dataset.blattGross) { wiz.blattGross = !wiz.blattGross; render(); }
  else if (el.dataset.blattLesen) {
    const t = (document.getElementById("blatt-text").value || "").trim();
    if (!t) return flash("Bitte zuerst den Text einfügen.");
    wiz.blattText = t;
    wiz.blattErg = leseBlatt(t, wiz.formular, wiz.werte, wiz.stamm);
    render(); window.scrollTo(0, 0);
  }
  else if (el.dataset.blattUebernehmen) blattUebernehmen();
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
  else if (el.dataset.em) { state.emDetail = el.dataset.em; render(); window.scrollTo(0, 0); }
  else if (el.dataset.emZurueck) { state.emDetail = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.emLoeschen) {
    if (!confirm("Erstmuster löschen?\n\nEs liegt " + PAPIERKORB_TAGE + " Tage im Papierkorb (unter Mehr) und kann von dort zurückgeholt werden.")) return;
    const r = rezepte().find(x => x.id === el.dataset.emLoeschen);
    if (r) inDenPapierkorb("rezepte", r, r.kuerzel + " " + r.aufbau);
    DB.set("rezepte", rezepte().filter(r => r.id !== el.dataset.emLoeschen));
    state.emDetail = null; flash("Erstmuster gelöscht."); render(); window.scrollTo(0, 0);
  }
  // gilt für den Assistenten und für die Rüst-Checkliste – beide zurück zur Liste
  else if (el.dataset.rezeptZurueck) { state.rezeptForm = null; wiz = null; state.verlauf = null; state.rezept = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rezeptBearbeiten) { state.rezeptForm = el.dataset.rezeptBearbeiten; state.emDetail = el.dataset.rezeptBearbeiten; wizStart(el.dataset.rezeptBearbeiten); render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlauf) { state.verlauf = el.dataset.verlauf; state.rezept = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.verlaufZurueck) { state.verlauf = null; state.rezept = el.dataset.verlaufZurueck; render(); window.scrollTo(0, 0); }
  else if (el.dataset.vergleich) { state.vergleich = el.dataset.vergleich; state.rezept = null; state.emDetail = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.vergleichZurueck) {
    state.vergleich = null;
    if (state.view === "erstmuster") state.emDetail = el.dataset.vergleichZurueck;
    else state.rezept = el.dataset.vergleichZurueck;
    render(); window.scrollTo(0, 0);
  }
  else if (el.dataset.check) { if (!e.target.classList.contains("p-ist")) toggleCheck(el.dataset.check); }
  else if (el.dataset.ruestAbschluss) ruestAbschluss(el.dataset.ruestAbschluss);
  else if (el.dataset.erstmuster) sendeErstmuster(el.dataset.erstmuster);
  else if (el.dataset.gUebernehmen) { const g = gErmittelt(); if (g > 0) { document.getElementById("sp-g").value = fmt(g, 4); spRechne(); flash("G übernommen: " + fmt(g, 4) + " kg/km"); } else flash("Erst Gewicht und Länge der Spule eingeben."); }
  else if (el.dataset.export) exportData();
  else if (el.dataset.import) importData(false);
  else if (el.dataset.importErsetzen) importData(true);
  else if (el.dataset.pkZurueck) stelleWiederHer(el.dataset.pkZurueck);
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
  else if (el.dataset.maschineNeu) {
    const feld = document.getElementById("nm-name");
    const n = feld.value.trim().slice(0, 20);
    if (!n) return flash("Bitte einen Namen eingeben.");
    const list = maschinen();
    if (list.some(m => m.toLowerCase() === n.toLowerCase())) return flash("Diese Maschine gibt es schon.");
    list.push(n); DB.set("maschinen", list);
    feld.value = ""; flash("Maschine " + n + " angelegt."); render();
  }
  else if (el.dataset.maschineLoeschen) {
    const n = el.dataset.maschineLoeschen;
    if (!confirm("Maschine " + n + " entfernen?\n\nDie Kachel verschwindet. Bisherige Einträge und Aufgaben bleiben gespeichert.")) return;
    DB.set("maschinen", maschinen().filter(m => m !== n));
    const lauf = laufend(); if (lauf[n]) { delete lauf[n]; DB.set("laufend", lauf); }
    flash("Maschine entfernt."); render();
  }
  else if (el.dataset.pkWeg) {
    if (!confirm("Foto der Prüfkarte entfernen?")) return;
    const list = rezepte(), r = list.find(x => x.id === el.dataset.pkWeg);
    if (r) { delete r.pruefkarte; delete r.pruefkarte_am; delete r.pruefkarte_von; DB.set("rezepte", list); }
    flash("Foto entfernt."); render();
  }
  else if (el.dataset.suchEm) { zeige("erstmuster"); state.emDetail = el.dataset.suchEm; render(); window.scrollTo(0, 0); }
  else if (el.dataset.suchSpule) zeige("spulen");
  else if (el.dataset.suchAufgabe) zeige("aufgaben");
  else if (el.dataset.suchMaschine) { zeige("maschinen"); state.maschine = el.dataset.suchMaschine; render(); window.scrollTo(0, 0); }
  else if (el.dataset.gesehen) merkeGesehen();
  else if (el.dataset.kontrolle) { state.kontrolle = el.dataset.kontrolle; render(); window.scrollTo(0, 0); }
  else if (el.dataset.kontrolleZurueck) { state.kontrolle = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.kontrolleSpeichern) speichereKontrolle(el.dataset.kontrolleSpeichern);
  else if (el.dataset.abwUebernehmen) uebernehmeAbweichungen();
  else if (el.dataset.abwNotloesung) { state.abweichung.phase = "grund"; render(); window.scrollTo(0, 0); }
  else if (el.dataset.abwSpeichern) speichereNotloesungen(true);
  else if (el.dataset.abwOhneGrund) speichereNotloesungen(false);
  else if (el.dataset.nlErledigt) {
    const nl = notloesungen();
    const n = nl.find(x => x.id === el.dataset.nlErledigt);
    if (n) { n.erledigt = true; DB.set("notloesungen", nl); }
    flash("Notlösung als erledigt vermerkt."); render();
  }
  else if (el.dataset.rvergleich) { state.rvergleich = { rezept_id: el.dataset.rvergleich, a: null, b: null, alle: false }; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rvZurueck) { state.rvergleich = null; render(); window.scrollTo(0, 0); }
  else if (el.dataset.rvAlle) { state.rvergleich.alle = !state.rvergleich.alle; render(); }
  else if (el.dataset.laufendEnde) {
    const n = el.dataset.laufendEnde;
    if (!confirm("Läuft auf " + n + " nicht mehr?\n\nDie Rüstung bleibt im Rüst-Verlauf erhalten.")) return;
    const lauf = laufend(); delete lauf[n]; DB.set("laufend", lauf);
    flash("Eintrag entfernt."); render();
  }
  else if (el.dataset.grossschrift) {
    const an = !DB.get("grossschrift", false);
    DB.set("grossschrift", an);
    document.body.classList.toggle("gross", an);
    render();
  }
  else if (el.dataset.codeSetzen) codeSetzen();
  else if (el.dataset.codeAendern) codeAendern();
  else if (el.dataset.codeFragen) codeFragenUmschalten();
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
document.getElementById("hinweis-banner").addEventListener("click", e => {
  if (e.currentTarget.dataset.tun === "sicherung") return exportData();
  zeige("mehr");
  const k = document.getElementById("code-neu");
  if (k) { k.scrollIntoView(); k.focus(); }
});
document.addEventListener("input", e => {
  if ((e.target.id === "rv-a" || e.target.id === "rv-b") && state.rvergleich) {
    state.rvergleich[e.target.id === "rv-a" ? "a" : "b"] = e.target.value;
    render(); return;
  }
  if (e.target.id === "alle-suche") {
    alleSuche = e.target.value;
    const z = document.getElementById("such-ergebnis"); if (z) z.innerHTML = alleSuche ? sucheHtml() : "";
    return;
  }
  if (e.target.id === "spulen-suche") { spulenSuche = e.target.value; const l = document.getElementById("spulen-liste"); if (l) l.innerHTML = spulenListeHtml(); return; }
  if (e.target.id === "ruest-suche") { ruestSuche = e.target.value; const l = document.getElementById("ruest-liste"); if (l) l.innerHTML = ruestListeHtml(); return; }
  if (e.target.id === "em-suche") { emSuche = e.target.value; const l = document.getElementById("em-liste"); if (l) l.innerHTML = emListeHtml(); return; }
  if (e.target.dataset && e.target.dataset.grund !== undefined && state.abweichung) {
    const f = state.abweichung.felder[parseInt(e.target.dataset.grund, 10)];
    if (f) f.grund = e.target.value;
    return;
  }
  if (e.target.dataset && e.target.dataset.stamm && wiz) { wiz.stamm[e.target.dataset.stamm] = e.target.value; return; }
  if (e.target.classList && e.target.classList.contains("wiz-eigen") && wiz) { wiz.werte[e.target.dataset.feld] = e.target.value; return; }
  if (e.target.dataset && e.target.dataset.ist) { setzeIst(e.target.dataset.ist, e.target.value); return; }
  // nur rechnen, wenn die Spulen-Maske wirklich auf dem Bildschirm ist
  // (sonst z. B. beim Tippen im Fehler-Formular über der Spulen-Ansicht)
  if (!state.overlay && e.target.closest("#inhalt") && state.view === "spulen") spRechne();
});

// Bild ist ausgesucht (egal ob Kamera oder Fotos-App) – gleich übernehmen, ohne zweiten Knopf
document.addEventListener("change", e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.fotoZiel) return;
  const f = el.files && el.files[0];
  el.value = "";  // damit dasselbe Bild später wieder gewählt werden kann
  if (!f) return;
  const ziel = el.dataset.fotoZiel, id = el.dataset.id;
  // etwas größer und schärfer als beim Fehlerbild – auf Blatt und Prüfkarte steht Kleingedrucktes
  verkleinereFoto(f, 1600, 0.72).then(dataUrl => {
    if (ziel === "blatt") {
      if (!wiz) return;
      wiz.blatt = dataUrl; flash("Foto übernommen.");
    } else {
      const list = rezepte(), r = list.find(x => x.id === id);
      if (!r) return;
      r.pruefkarte = dataUrl; r.pruefkarte_am = jetzt(); r.pruefkarte_von = wer();
      DB.set("rezepte", list);
      flash("Prüfkarte angehängt.");
    }
    render();
  }).catch(() => flash("Foto konnte nicht gelesen werden."));
});

function gewaehlterStatus() { const a = document.querySelector(".status-opt.aktiv"); return a ? a.dataset.status : null; }
function speichereEintrag() {
  const st = gewaehlterStatus();
  if (!st) return flash("Bitte einen Status wählen.");
  const note = document.getElementById("notiz").value.trim();
  const list = entries();
  const sw = document.getElementById("eintrag-schicht");
  list.push({ id: neueId(), machine: state.maschine, status: st, note: note,
              schicht: sw ? sw.value : schichtJetzt(), benutzer: wer(), created_at: jetzt() });
  DB.set("entries", list); flash("Eintrag gespeichert."); render(); window.scrollTo(0, 0);
}
function addTodo() {
  const text = document.getElementById("todo-text").value.trim();
  if (!text) return flash("Bitte einen Text eingeben.");
  const machine = document.getElementById("todo-maschine").value;
  const faellig = document.getElementById("todo-faellig").value || null;
  const wichtig = document.getElementById("todo-wichtig").checked;
  const list = todos();
  list.push({ id: neueId(), text: text, machine: machine || null, faellig: faellig, wichtig: wichtig,
              done: false, benutzer: wer(), created_at: jetzt() });
  DB.set("todos", list); render();
}
function toggleTodo(id) {
  const list = todos(); const t = list.find(x => x.id === id); if (!t) return;
  t.done = !t.done; t.done_at = t.done ? jetzt() : null; t.done_von = t.done ? wer() : null; DB.set("todos", list); render();
}
function delTodo(id) {
  if (!confirm("Aufgabe löschen?")) return;
  const t = todos().find(x => x.id === id);
  if (t) inDenPapierkorb("todos", t, t.text);
  DB.set("todos", todos().filter(x => x.id !== id)); render();
}
function delSpule(id) {
  if (!confirm("Berechnung löschen?")) return;
  const s = spulen().find(x => x.id === id);
  if (s) inDenPapierkorb("spulen", s, s.auftrag ? "Auftrag " + s.auftrag : "Berechnung vom " + s.created_at);
  DB.set("spulen", spulen().filter(x => x.id !== id)); render();
}

/* ---------- Was ist neu (Änderungen je Version) ---------- */
const CHANGELOG = {
  "4.11": [
    "Die zwei Foto-Knöpfe bei Blatt und Prüfkarte gingen nicht – jetzt öffnen sie Kamera bzw. Fotoauswahl",
  ],
  "4.10": [
    "Blatt und Prüfkarte: Foto neu aufnehmen oder eines nehmen, das schon auf dem Handy liegt",
    "Bild wird sofort übernommen – der zweite Knopf entfällt",
  ],
  "4.9": [
    "Erstmuster vom Papier: Blatt fotografieren – das Foto bleibt beim Muster",
    "Erkannten Text vom Blatt einfügen – die App trägt die Werte zum Bestätigen ein",
  ],
  "4.8": [
    "Der Code muss nicht mehr bei jedem Öffnen eingegeben werden – Schalter unter Mehr",
  ],
  "4.7": [
    "Prüfkarte fotografieren – geht als eigene Seite mit dem Erstmuster raus",
    "Die laufende Maschine zeigt die Spulen-Berechnung zum Auftrag",
    "Berechnungen zeigen, auf welcher Maschine der Auftrag läuft",
    "Neu unter Mehr: eine Suche über alle Bereiche",
  ],
  "4.6": [
    "Übergabe zeigt, was seit deiner letzten Schicht dazukam",
    "Einträge bekommen die Schicht (Früh/Spät/Nacht)",
    "Aufgaben mit Termin und Wichtig-Kennzeichen, Überfälliges steht oben",
    "Neu: Werte prüfen an der laufenden Maschine – Abweichungen wie beim Rüsten",
  ],
  "4.5": [
    "Papierkorb: Gelöschtes bleibt 30 Tage liegen und lässt sich zurückholen",
    "Sicherungen lassen sich zusammenführen – zwei Geräte, ein Datenstand",
    "Erinnerung, wenn die letzte Sicherung über eine Woche her ist",
    "Nach fünf falschen Code-Eingaben muss man warten",
    "Die App bittet iOS, die Daten nicht wegzuräumen",
  ],
  "4.4": [
    "Notlösungen zeigen jetzt die Maschine – in der App und im PDF",
    "Behoben: Zurück in der Rüst-Checkliste ging nicht zurück zur Liste",
  ],
  "4.3": [
    "Nach dem Rüsten fragt die App bei Abweichungen: neuer Stand oder Notlösung",
    "Notlösungen werden mit Grund festgehalten",
    "Jedes Erstmuster hat eine Stand-Nummer; die Liste zeigt, welcher Stand versendet wurde",
    "Das PDF bekommt Seite 2 mit Änderungen und Notlösungen",
    "Dateiname enthält Stand und Datum",
  ],
  "4.2": [
    "Derzeit laufend zeigt nur noch Draht, Geschwindigkeit, Glühfaktor und Zugkraft Aufwickler",
    "Neu: Rüstungen desselben Musters vergleichen",
    "Der Vergleich zeigt, um wieviel ein Wert rauf oder runter ging (z. B. Glühfaktor −0,05)",
    "Unveränderte Werte lassen sich einblenden",
  ],
  "4.1": [
    "Maschinen kann man unter Mehr selbst anlegen und entfernen",
    "Beim Abschließen einer Rüstung wird die Maschine gewählt",
    'Auf der Maschine steht dann „Derzeit laufend": welcher Draht mit welchen Werten',
    "Die Kachel in der Schichtübergabe zeigt den laufenden Draht mit an",
  ],
  "4.0": [
    "Die App heißt jetzt Drahtzug",
    "Maschinen heißt jetzt Schichtübergabe",
    "Neuer Bereich Erstmuster: anlegen, bearbeiten, Änderungen, PDF senden",
    "Rüsten ist nur noch fürs Einrichten – Checkliste abarbeiten und abschließen",
  ],
  "3.2": [
    "Verlegung Hand/Automatik als Auswahl, ebenso Spulengröße und Kontaktband",
    "Maschinentypen und KSS-Produkte sind jetzt änderbar – üblicher Wert als Knopf",
    "Diese Angaben stehen im PDF, aber nicht in der Rüst-Checkliste",
  ],
  "3.1": [
    "Erstmuster-PDF: Ersteller und Datum werden automatisch eingetragen",
  ],
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
/* Code merken: die App entsperrt sich beim Start selbst. Dafür liegt der Code im
   Gerät – geschützt ist die App ab da nur noch durch den Code des Geräts selbst.
   Bewusst so gewollt; der Tresor bleibt verschlüsselt, der Schalter lässt sich
   jederzeit wieder umlegen, ohne den Code neu zu setzen. */
function codeGemerkt() { return localStorage.getItem("dz_code_gemerkt"); }
function merkeCode(code) { localStorage.setItem("dz_code_gemerkt", code); }
function vergissCode() { localStorage.removeItem("dz_code_gemerkt"); }

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
  // iOS räumt Web-Apps auf, die länger nicht benutzt werden – das hier bittet um Bestandsschutz
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  raeumePapierkorb();
  zeige("maschinen");
  aktualisiereFehlerBadge();
  pruefeWochenbericht();
  pruefeHinweisBanner();
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
/* Nach mehreren Fehlversuchen warten lassen – sonst probiert jemand den Code durch.
   Zähler liegt außerhalb des Tresors, der ist zu dem Zeitpunkt ja noch zu. */
const SPERRE_AB = 5;
function sperrRest() {
  const bis = parseInt(localStorage.getItem("dz_sperre_bis") || "0", 10);
  return Math.max(0, Math.ceil((bis - Date.now()) / 1000));
}
let sperrTimer = null;
function zeigeSperrWartezeit() {
  const rest = sperrRest(), f = document.getElementById("sperre-fehler"), ok = document.getElementById("sperre-ok");
  clearTimeout(sperrTimer);
  if (rest > 0) {
    f.textContent = "Zu viele Fehlversuche – noch " + (rest >= 60 ? Math.ceil(rest / 60) + " Minuten" : rest + " Sekunden") + " warten.";
    ok.disabled = true;
    sperrTimer = setTimeout(zeigeSperrWartezeit, 1000);
  } else {
    ok.disabled = false;
    if (f.textContent.indexOf("Fehlversuche") !== -1) f.textContent = "";
  }
}
async function entsperren() {
  if (sperrRest() > 0) return zeigeSperrWartezeit();
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
    localStorage.removeItem("dz_sperre_fehl"); localStorage.removeItem("dz_sperre_bis");
    const merken = document.getElementById("sperre-merken");
    if (merken && merken.checked) merkeCode(code);
    document.getElementById("sperre").hidden = true;
    document.getElementById("sperre-code").value = "";
    document.getElementById("sperre-fehler").textContent = "";
    starteApp();
  } catch (e) {
    const fehl = (parseInt(localStorage.getItem("dz_sperre_fehl") || "0", 10)) + 1;
    localStorage.setItem("dz_sperre_fehl", String(fehl));
    document.getElementById("sperre-code").value = "";
    if (fehl >= SPERRE_AB) {
      // 1, 2, 4, 8 … Minuten, höchstens eine Viertelstunde
      const min = Math.min(15, Math.pow(2, fehl - SPERRE_AB));
      localStorage.setItem("dz_sperre_bis", String(Date.now() + min * 60000));
      zeigeSperrWartezeit();
    } else {
      document.getElementById("sperre-fehler").textContent =
        "Falscher Code. Noch " + (SPERRE_AB - fehl) + " Versuch" + (SPERRE_AB - fehl === 1 ? "" : "e") + ".";
      document.getElementById("sperre-code").focus();
    }
  }
}
async function pruefeSperre() {
  const enc = localStorage.getItem("sue_vault_enc");
  const plain = ladePlainVault();
  if (enc || plain.pin_hash) {
    const gemerkt = enc && codeGemerkt();
    if (gemerkt) {
      try {
        VAULT = await entschluessle(JSON.parse(enc), gemerkt);
        VAULT_CODE = gemerkt; vaultBereit = true;
        starteApp();
        return;
      } catch (e) { vergissCode(); }   // Code passt nicht mehr – dann doch fragen
    }
    document.getElementById("sperre").hidden = false;
    document.getElementById("sperre-code").focus();
    zeigeSperrWartezeit();
  } else {
    VAULT = plain; vaultBereit = true;
    starteApp();  // offen: keine Verschlüsselung
  }
}
document.getElementById("sperre-ok").addEventListener("click", entsperren);
document.getElementById("sperre-code").addEventListener("keydown", e => { if (e.key === "Enter") entsperren(); });

/* ---------- Start ---------- */
pruefeSperre();
