"use strict";
/* Erzeugt das Erstmuster-Formular als echtes PDF – ohne fremde Bibliotheken,
   damit die App offline bleibt und keine Daten nach außen gehen.
   Aufbau nach den Werksblättern WPD-013 1350 / 1341 und VA-013F3. */

/* ---------- kleiner PDF-Schreiber (A4 hoch, Helvetica) ---------- */
function PdfDoc() {
  this.seiten = [];      // je Seite ein Array von Anweisungen (Strings)
  this.aktuell = null;
  this.neueSeite();
}
PdfDoc.SEITE_B = 595.28;   // A4 in Punkt
PdfDoc.SEITE_H = 841.89;

PdfDoc.prototype.neueSeite = function () { this.aktuell = []; this.seiten.push(this.aktuell); };

// PDF rechnet von unten links, wir denken von oben links
function y(oben) { return PdfDoc.SEITE_H - oben; }

function pdfText(s) {
  return String(s == null ? "" : s)
    .replace(/[„“”]/g, '"').replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-").replace(/×/g, "x").replace(/·/g, "-")
    .replace(/[≥≤]/g, "").replace(/µ/g, "u").replace(/²/g, "2").replace(/³/g, "3")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

PdfDoc.prototype.text = function (s, x, oben, groesse, fett, farbe) {
  if (s === "" || s == null) return;
  const f = fett ? "/F2" : "/F1";
  const c = farbe || [0, 0, 0];
  this.aktuell.push(`${c[0]} ${c[1]} ${c[2]} rg BT ${f} ${groesse} Tf ${x.toFixed(2)} ${y(oben).toFixed(2)} Td (${pdfText(s)}) Tj ET`);
};
PdfDoc.prototype.linie = function (x1, o1, x2, o2, dicke) {
  this.aktuell.push(`0 0 0 RG ${(dicke || 0.5).toFixed(2)} w ${x1.toFixed(2)} ${y(o1).toFixed(2)} m ${x2.toFixed(2)} ${y(o2).toFixed(2)} l S`);
};
PdfDoc.prototype.rechteck = function (x, oben, b, h, fuellung) {
  if (fuellung) {
    this.aktuell.push(`${fuellung[0]} ${fuellung[1]} ${fuellung[2]} rg ${x.toFixed(2)} ${y(oben + h).toFixed(2)} ${b.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  this.aktuell.push(`0 0 0 RG 0.5 w ${x.toFixed(2)} ${y(oben + h).toFixed(2)} ${b.toFixed(2)} ${h.toFixed(2)} re S`);
};

// Breite eines Textes grob schätzen (Helvetica), um zu lange Texte zu kürzen
function breite(s, groesse) { return String(s).length * groesse * 0.47; }
PdfDoc.prototype.textGekuerzt = function (s, x, oben, groesse, maxB, fett) {
  let t = String(s == null ? "" : s);
  while (t.length > 3 && breite(t, groesse) > maxB) t = t.slice(0, -1);
  if (t !== String(s == null ? "" : s)) t = t.slice(0, -1) + "…";
  this.text(t.replace(/…/g, "..."), x, oben, groesse, fett);
};

PdfDoc.prototype.bauen = function () {
  const objekte = [];
  const seitenIds = this.seiten.map((_, i) => 4 + i * 2);   // Seite, dann Inhalt
  objekte[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objekte[2] = `<</Type/Pages/Kids[${seitenIds.map(id => id + " 0 R").join(" ")}]/Count ${this.seiten.length}>>`;
  objekte[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>";
  const fett = 3 + this.seiten.length * 2 + 1;
  this.seiten.forEach((inhalt, i) => {
    const seiteId = seitenIds[i], inhaltId = seiteId + 1;
    objekte[seiteId] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PdfDoc.SEITE_B} ${PdfDoc.SEITE_H}]`
      + `/Resources<</Font<</F1 3 0 R/F2 ${fett} 0 R>>>>/Contents ${inhaltId} 0 R>>`;
    const strom = inhalt.join("\n");
    objekte[inhaltId] = `<</Length ${strom.length}>>\nstream\n${strom}\nendstream`;
  });
  objekte[fett] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>";

  let pdf = "%PDF-1.4\n";
  const positionen = [];
  for (let i = 1; i < objekte.length; i++) {
    if (!objekte[i]) continue;
    positionen[i] = pdf.length;
    pdf += `${i} 0 obj\n${objekte[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  const anzahl = objekte.length;
  pdf += `xref\n0 ${anzahl}\n0000000000 65535 f \n`;
  for (let i = 1; i < anzahl; i++) {
    pdf += objekte[i] ? String(positionen[i]).padStart(10, "0") + " 00000 n \n" : "0000000000 65535 f \n";
  }
  pdf += `trailer\n<</Size ${anzahl}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

  // als Bytes (Latin-1), damit Umlaute richtig ankommen
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
};

/* ---------- Aufbau der Werksblätter (Zeilen wie im Original) ----------
   nr    = Nummer im Blatt, "" bei Fließtext
   text  = Beschriftung
   feld  = Name des gespeicherten Einstellwerts (leer = Feld bleibt frei)
   eh    = Einheit rechts
   stern = vom Maschinenbediener einzustellen (im Blatt mit *)              */
const PDF_FORMULARE = {
  "1350": {
    titel: "Erstmusterfertigung\nDrahtzug 1350", kennung: "WPD-013 1350", rev: "Rev. 2 vom 25.08.2023",
    gruppe: "1350",
    abschnitte: [
      { nr: "1", titel: "Produktdaten", zeilen: [
        { nr: "", text: "Gemäß Prüfkarte (Prüfkarte ist grundsätzlich dem Erstmusterformular beizufügen)" } ] },
      { nr: "2", titel: "Vormaterial", zeilen: [
        { nr: "2.1", text: "Vormaterial-Nr. (Zukauf)" },
        { nr: "2.2", text: "Vormaterial-Bezeichnung (Zukauf)" },
        { nr: "2.3", text: "Vormaterial-Charge (Zukauf)" },
        { nr: "2.4", text: "Vorgänger-Arbeitsplan-Nr." },
        { nr: "2.5", text: "Vorgänger-Bezeichnung (Dm, Besch., Festigkeit)" },
        { nr: "2.6", text: "Input-Spule (ID. Nr. + Kurzbezeichnung)" } ] },
      { nr: "3", titel: "Fertigungsparameter Ablauf", zeilen: [
        { nr: "3.1", text: "Bezeichnung Ablauf (Angetriebener Ablauf, mech. Ablauf, Korb // + Sp. ID)" },
        { nr: "3.2", stern: 1, text: "Tänzer-Einstellung (Druck, Gewicht, Abstand)", feld: "Tänzer Ziehen", eh: "bar/kg/mm" },
        { nr: "3.3", stern: 1, text: "Zugkraft + Messmittel", feld: "Zugkraft Ablauf", eh: "cN" } ] },
      { nr: "4", titel: "Fertigungsparameter Ziehmaschine", zeilen: [
        { nr: "4.1", text: "Maschinentyp Ziehmaschine", feld: "Maschinentyp Ziehmaschine", fest: "NIEHOFF MMH50" },
        { nr: "4.2", text: "Maschinennummer", festMaschine: 1 },
        { nr: "4.3", text: "Ziehsteinsatz-Nr." },
        { nr: "", text: "Ziehstufen / Durchmesser: siehe beigefügte Prüfkarte" },
        { nr: "4.4", stern: 1, text: "Ziehgeschwindigkeit", feld: "Ziehgeschwindigkeit", eh: "m/s" },
        { nr: "4.5", text: "KSS-Produkt Ziehmaschine", feld: "KSS-Produkt Ziehmaschine", fest: "Zeller + Gmelin Multidraw Cu Sy Spezial" },
        { nr: "4.6", text: "KSS-Ansatzdatum (Neu/Teil/%/Datum)" },
        { nr: "4.7", text: "Konzentration + Messmittel", eh: "%" },
        { nr: "4.8", text: "Temperatur", eh: "°C" },
        { nr: "4.9", text: "pH-Wert" },
        { nr: "4.10", text: "Leitfähigkeit", eh: "uS" },
        { nr: "4.11", stern: 1, text: "KSS-Ventil Konenbesprühung oben", feld: "KSS-Ventil Konenbesprühung oben", eh: "%" },
        { nr: "4.12", stern: 1, text: "KSS-Ventil Ziehsteinbesprühung oben", feld: "KSS-Ventil Ziehsteinbesprühung oben", eh: "%" },
        { nr: "4.13", stern: 1, text: "KSS-Ventil Konenbesprühung unten", feld: "KSS-Ventil Konenbesprühung unten", eh: "%" },
        { nr: "4.14", stern: 1, text: "KSS-Ventil Ziehsteinbesprühung unten", feld: "KSS-Ventil Ziehsteinbesprühung unten", eh: "%" },
        { nr: "4.15", stern: 1, text: 'Eingabe "übersprungene Stufen"', feld: "übersprungene Stufen" },
        { nr: "4.16", stern: 1, text: 'Eingabe "Anzahl Drähte"', feld: "Anzahl Drähte" },
        { nr: "4.17", stern: 1, text: 'Eingabe "Enddurchmesser"', feld: "Enddurchmesser", eh: "mm" },
        { nr: "4.18", stern: 1, text: 'Eingabe "erster Dm schneller Teil"', feld: "erster Dm schneller Teil", eh: "mm" },
        { nr: "4.19", stern: 1, text: 'Eingabe "letzter Dm langsamer Teil"', feld: "letzter Dm langsamer Teil", eh: "mm" },
        { nr: "4.20", stern: 1, text: 'Eingabe "Schlupf"', feld: "Schlupf", eh: "%" } ] },
      { nr: "5", titel: "Fertigungsparameter Glühe", zeilen: [
        { nr: "5.1", text: "Maschinentyp Glühe", feld: "Maschinentyp Glühe", fest: "RM 121.1.R.08.400" },
        { nr: "5.2", stern: 1, text: "Glühfaktor (nur Richtwert!)", feld: "Glühfaktor" },
        { nr: "5.3", stern: 1, text: "Glühspannung", feld: "Glühspannung", eh: "V" },
        { nr: "5.4", stern: 1, text: "Glühstrom", feld: "Glühstrom", eh: "A" },
        { nr: "5.5", text: "Werkstoff Kontaktrohre" },
        { nr: "5.6", stern: 1, text: "Luftdruck Glühe", feld: "Luftdruck Glühe", eh: "bar" },
        { nr: "5.7", stern: 1, text: "Ventilöffnung Druckluft", feld: "Ventilöffnung Druckluft", eh: "%" },
        { nr: "5.8", stern: 1, text: "Trocknungssteine (Ein +0,3 mm / Aus +0,10 mm)", feld: "Trocknungssteine", eh: "mm" },
        { nr: "5.9", stern: 1, text: "Kugelhahn Schutzgas", feld: "Kugelhahn Schutzgas", eh: "%" },
        { nr: "5.10", text: "Durchfluss Stickstoff", eh: "l/min" },
        { nr: "5.11", text: "Druck Stickstoff", eh: "bar" },
        { nr: "5.12", stern: 1, text: "KSS-Ventil 1", feld: "KSS-Ventil 1", eh: "%" },
        { nr: "5.13", stern: 1, text: "KSS-Ventil 2", feld: "KSS-Ventil 2", eh: "%" },
        { nr: "5.14", stern: 1, text: "KSS-Ventil 3", feld: "KSS-Ventil 3", eh: "%" },
        { nr: "5.15", stern: 1, text: "KSS-Ventil 4", feld: "KSS-Ventil 4", eh: "%" },
        { nr: "5.16", text: "KSS-Produkt Glühe", feld: "KSS-Produkt Glühe", fest: "Bechem Unopol F811" },
        { nr: "5.17", text: "KSS-Ansatzdatum (Neu//Teil//%//Datum)" },
        { nr: "5.18", text: "Konzentration + Messmittel", eh: "%" },
        { nr: "5.19", text: "Temperatur", eh: "°C" },
        { nr: "5.20", text: "pH-Wert" },
        { nr: "5.21", text: "Leitfähigkeit", eh: "uS" } ] },
      { nr: "6", titel: "Fertigungsparameter Spuler", zeilen: [
        { nr: "6.1", text: "Maschinentyp Spuler", feld: "Maschinentyp Spuler", fest: "SG 145.F.E" },
        { nr: "6.2", stern: 1, text: "Einstellung Verlegung Hand/Automatik (Schaltschrank)", feld: "Verlegung Hand/Automatik" },
        { nr: "6.3", stern: 1, text: "Spulengrößen-Einstellung (Sp. 250/350/560)", feld: "Spulengröße", eh: "mm" },
        { nr: "6.4", stern: 1, text: "Tänzer-Einstellung (Gewicht, Abstand)", feld: "Tänzer Spuler", eh: "g + mm" },
        { nr: "6.5", stern: 1, text: "Zugkraft Aufwickelspannung + Messgerät", feld: "Zugkraft Aufwickelspannung", eh: "cN" },
        { nr: "6.6", stern: 1, text: "Verlegeschritt-Einstellung (Skala, Schaltschrank)", feld: "Verlegeschritt-Einstellung", eh: "V + Sek." } ] },
    ],
  },
  "1341": {
    titel: "Erstmusterfertigung\nDrahtzug 1341", kennung: "WPD-013 1341", rev: "Rev. 0 vom 17.02.2023",
    gruppe: "1341",
    abschnitte: [
      { nr: "1", titel: "Produktdaten", zeilen: [
        { nr: "", text: "Gemäß Prüfkarte (Prüfkarte ist grundsätzlich dem Erstmusterformular beizufügen)" } ] },
      { nr: "2", titel: "Vormaterial", zeilen: [
        { nr: "2.1", text: "Vormaterial-Nr. (Zukauf)", fest: "10000" },
        { nr: "2.2", text: "Vormaterial-Bezeichnung (Zukauf)", fest: "Cu ETP 1 Gießwalzdraht 8mm" },
        { nr: "2.3", text: "Vormaterial-Charge (Zukauf)" },
        { nr: "2.4", text: "Vorgänger-Arbeitsplan-Nr." },
        { nr: "2.5", text: "Vorgänger-Bezeichnung (Dm, Besch., Festigkeit)" },
        { nr: "2.6", text: "Input-Spule (Nr. + Kurzbezeichnung)" } ] },
      { nr: "3", titel: "Fertigungsparameter Ablauf", zeilen: [
        { nr: "3.1", text: "Bezeichnung Ablauf (Angetriebener Ablauf, mech. Ablauf, Korb // + Sp. ID)" },
        { nr: "3.2", stern: 1, text: "Abwickelrichtung (bei Draufsicht)", feld: "Abwickelrichtung" },
        { nr: "3.3", stern: 1, text: "Tänzer-Einstellung (Druck, Gewicht, Abstand)", feld: "Tänzer Ziehen", eh: "bar/kg/mm" },
        { nr: "3.4", stern: 1, text: "Zugkraft + Messmittel", feld: "Zugkraft Ablauf", eh: "cN" } ] },
      { nr: "4", titel: "Fertigungsparameter Ziehmaschine", zeilen: [
        { nr: "4.1", text: "Maschinentyp Ziehmaschine", feld: "Maschinentyp Ziehmaschine", fest: "NIEHOFF M5" },
        { nr: "4.2", text: "Maschinennummer", festMaschine: 1 },
        { nr: "4.3", text: "Ziehsteinsatz-Nr." },
        { nr: "", text: "Ziehstufen / Durchmesser: siehe beigefügte Prüfkarte" },
        { nr: "4.4", stern: 1, text: "Ziehgeschwindigkeit + Skala", feld: "Ziehgeschwindigkeit + Skala", eh: "m/s + Skala" },
        { nr: "4.5", text: "KSS-Produkt Ziehmaschine", feld: "KSS-Produkt Ziehmaschine", fest: "Zeller + Gmelin Multidraw Cu Sy Spezial" },
        { nr: "4.6", text: "KSS-Ansatzdatum (Neu/Teil/%/Datum)" },
        { nr: "4.7", text: "Konzentration + Messmittel", eh: "%" },
        { nr: "4.8", text: "Temperatur", eh: "°C" },
        { nr: "4.9", text: "pH-Wert" },
        { nr: "4.10", text: "Leitfähigkeit", eh: "uS" } ] },
      { nr: "5", titel: "Fertigungsparameter Glühe", zeilen: [
        { nr: "5.1", text: "Maschinentyp Glühe", feld: "Maschinentyp Glühe", fest: "Niehoff VG5" },
        { nr: "5.2", stern: 1, text: "Glühfaktor (nur Richtwert!)", feld: "Glühfaktor" },
        { nr: "5.3", stern: 1, text: "Glühspannung", feld: "Glühspannung", eh: "V" },
        { nr: "5.4", stern: 1, text: "Glühstrom", feld: "Glühstrom", eh: "A" },
        { nr: "5.5", text: "Werkstoff Kontaktbänder" },
        { nr: "5.6", stern: 1, text: "Luftdruck Glühe", feld: "Luftdruck Glühe", eh: "bar" },
        { nr: "5.7", stern: 1, text: "Ventilöffnung Druckluft", feld: "Ventilöffnung Druckluft", eh: "%" },
        { nr: "5.8", stern: 1, text: "Trocknungssteine (Ein +0,3 mm / Aus +0,10 mm)", feld: "Trocknungssteine", eh: "mm" },
        { nr: "5.9", stern: 1, text: "Kugelhahn Dampf", feld: "Kugelhahn Dampf", eh: "%" },
        { nr: "5.10", stern: 1, text: "KSS-Ventil Zulauf", feld: "KSS-Ventil Zulauf", eh: "%" },
        { nr: "5.11", stern: 1, text: "KSS-Ventil Ablauf", feld: "KSS-Ventil Ablauf", eh: "%" },
        { nr: "5.12", text: "KSS-Produkt Glühe", feld: "KSS-Produkt Glühe", fest: "Bechem Unopol F811" },
        { nr: "5.13", text: "KSS-Ansatzdatum (Neu//Teil//%//Datum)" },
        { nr: "5.14", text: "Konzentration + Messmittel", eh: "%" },
        { nr: "5.15", text: "Temperatur", eh: "°C" },
        { nr: "5.16", text: "pH-Wert" },
        { nr: "5.17", text: "Leitfähigkeit", eh: "uS" } ] },
      { nr: "6", titel: "Fertigungsparameter Spuler", zeilen: [
        { nr: "6.1", text: "Maschinentyp Spuler", feld: "Maschinentyp Spuler", fest: "SG145.1.F.E" },
        { nr: "6.2", stern: 1, text: "Einstellung Verlegung Hand/Automatik", feld: "Verlegung Hand/Automatik" },
        { nr: "6.3", stern: 1, text: "Spulenkern-Einstellung", feld: "Spulenkern-Einstellung", eh: "mm" },
        { nr: "6.4", text: "Output Spule", eh: "ID + Kurzbez." },
        { nr: "6.5", stern: 1, text: "Tänzer-Einstellung (Gewicht, Abstand)", feld: "Tänzer Spuler", eh: "g + mm" },
        { nr: "6.6", stern: 1, text: "Zugkraft Aufwickelspannung + Messgerät", feld: "Zugkraft Aufwickelspannung", eh: "cN" },
        { nr: "6.7", stern: 1, text: "Verlegeschritt-Einstellung (Skala)", feld: "Verlegeschritt-Einstellung" },
        { nr: "6.8", text: "Verlegeschritt", feld: "Verlegeschritt", eh: "Sekunden" } ] },
    ],
  },
  "va013f3": {
    titel: "Erstmusterfertigung\nDrahtzug", kennung: "VA-013F3", rev: "Rev. 4 vom 18.09.2020",
    gruppe: "",
    abschnitte: [
      { nr: "1", titel: "Produktdaten", zeilen: [
        { nr: "", text: "Gemäß Prüfkarte (Prüfkarte ist grundsätzlich dem Erstmusterformular beizufügen)" } ] },
      { nr: "2", titel: "Vormaterial Spule / Korb", zeilen: [
        { nr: "2.1", text: "Input / Output" } ] },
      { nr: "3", titel: "Arbeitsplatzdaten", zeilen: [
        { nr: "3.1", text: "Maschinennummer", festMaschine: 1 } ] },
      { nr: "4", titel: "Fertigungsparameter", zeilen: [
        { nr: "4.1", text: "Ausmacher / Satzkarte Nr." },
        { nr: "4.2", text: "Geschwindigkeit SOLL / IST", feld: "Geschwindigkeit Soll/Ist", eh: "m/s" },
        { nr: "4.3", text: "Werkstoff Kontaktband (Kupfer / Nickel)", feld: "Werkstoff Kontaktband" },
        { nr: "4.4", text: "Faktor (Glüh-/bereichseinstellung)", feld: "Faktor (Glüh-/Bereichseinstellung)", eh: "%" },
        { nr: "4.5", text: "Glühstrom", feld: "Glühstrom", eh: "A" },
        { nr: "4.6", text: "Glühspannung", feld: "Glühspannung", eh: "V" },
        { nr: "4.7", text: "Zugspannung Spuler (SOLL / IST)", feld: "Zugspannung Spuler Soll/Ist", eh: "cN" },
        { nr: "4.8", text: "Tänzer Gewichte Position / Skala", feld: "Tänzer Gewichte Position/Skala", eh: "mm" },
        { nr: "4.8.1", text: "Tänzer Luft", feld: "Tänzer Luft", eh: "bar" },
        { nr: "4.9", text: "Spulenkern Einstellung", feld: "Spulenkern Einstellung" },
        { nr: "4.10", text: "Umlegung in der Maschine", feld: "Umlegung in der Maschine", eh: "Anzahl" },
        { nr: "4.11", text: "Umlegung auf der Abzugscheibe", feld: "Umlegung auf der Abzugscheibe", eh: "Anzahl" },
        { nr: "4.12", text: "Fettgehalt Modul 1 (Anzeige im Refraktometer)", feld: "Fettgehalt Modul 1", eh: "%" },
        { nr: "4.13", text: "Fettgehalt Modul 2 (Anzeige im Refraktometer)", feld: "Fettgehalt Modul 2", eh: "%" },
        { nr: "4.14", text: "Fettgehalt Modul 3 (Anzeige im Refraktometer)", feld: "Fettgehalt Modul 3", eh: "%" },
        { nr: "4.15", text: "Fettgehalt Glühe (Anzeige im Refraktometer)", feld: "Fettgehalt Glühe", eh: "%" },
        { nr: "4.16", text: "Verlegeschritt", feld: "Verlegeschritt", eh: "Sek." } ] },
    ],
  },
};

/* ---------- Formular zeichnen ---------- */
const GRAU = [0.82, 0.82, 0.82], HELLGRAU = [0.93, 0.93, 0.93];
const RAND = 30, BREITE = PdfDoc.SEITE_B - 2 * RAND;
const SP_NR = RAND + 4, SP_TEXT = RAND + 32, SP_WERT = RAND + 348, SP_EH = RAND + BREITE - 52;
const ZH = 10.2;   // Zeilenhöhe (so passt das Blatt auf eine Seite)

function kopfZeichnen(doc, form, r, seite, seiten) {
  let o = RAND;
  // Kopfkasten: Werk | Titel | Kennung
  doc.rechteck(RAND, o, BREITE, 46);
  doc.linie(RAND + 120, o, RAND + 120, o + 46);
  doc.linie(RAND + BREITE - 150, o, RAND + BREITE - 150, o + 46);
  doc.text("Drahtwerk Waidhaus", RAND + 12, o + 28, 10, true);
  const zeilen = form.titel.split("\n");
  doc.text(zeilen[0], RAND + 200, o + 19, 12, true);
  if (zeilen[1]) doc.text(zeilen[1], RAND + 235, o + 34, 12, true);
  doc.text(form.kennung, RAND + BREITE - 142, o + 14, 9);
  doc.text("Seite " + seite + " von " + seiten, RAND + BREITE - 142, o + 29, 9);
  doc.text(form.rev, RAND + BREITE - 142, o + 42, 9);
  o += 46;

  // Kunde / AP-Nr. / Auftrags-Nr.
  doc.rechteck(RAND, o, BREITE, ZH + 3);
  doc.linie(RAND + 200, o, RAND + 200, o + ZH + 3);
  doc.linie(RAND + BREITE - 170, o, RAND + BREITE - 170, o + ZH + 3);
  doc.text("Kunde:", SP_NR, o + 10, 8, true);
  doc.text("AP-Nr. u. AG:", RAND + 206, o + 10, 8, true);
  doc.text("Auftrags-Nr.", RAND + BREITE - 164, o + 10, 8, true);
  doc.text(r.beispiel_auftrag || "", RAND + BREITE - 100, o + 10, 9);
  o += ZH + 3;

  // Produktbezeichnung / Maschinengruppe
  doc.rechteck(RAND, o, BREITE, ZH + 3);
  doc.linie(RAND + 330, o, RAND + 330, o + ZH + 3);
  doc.text("Produktbezeichnung:", SP_NR, o + 10, 8, true);
  const bez = [r.kuerzel, r.aufbau, r.klartext].filter(Boolean).join(" ");
  doc.text(bez, RAND + 110, o + 10, 9);
  doc.text("Maschinengruppe:" + (form.gruppe || ""), RAND + 336, o + 10, 8, true);
  doc.text(r.maschine || "", RAND + 450, o + 10, 9);
  return o + ZH + 3;
}

function fussZeichnen(doc, o, ersteller, datum) {
  doc.rechteck(RAND, o, BREITE, 22);
  doc.text("Bemerkung:", SP_NR, o + 12, 8, true);
  o += 22;
  doc.rechteck(RAND, o, BREITE, 26);
  doc.linie(RAND + 180, o, RAND + 180, o + 26);
  doc.linie(RAND + 360, o, RAND + 360, o + 26);
  doc.text("Erstellt von:", SP_NR, o + 11, 8);
  doc.text("Datum:", SP_NR, o + 22, 8);
  // wer das Erstmuster erzeugt hat, wird eingetragen; geprüft wird von jemand anderem
  if (ersteller) doc.text(ersteller, SP_NR + 58, o + 11, 8.5, true);
  if (datum) doc.text(datum, SP_NR + 58, o + 22, 8.5, true);
  doc.text("Geprüft von:", RAND + 186, o + 11, 8);
  doc.text("Datum:", RAND + 186, o + 22, 8);
  doc.text("* vom Maschinenbediener einzustellen", RAND + 366, o + 11, 8);
  return o + 26;
}

function erstmusterPdf(rezept, ersteller, datum) {
  const form = PDF_FORMULARE[rezept.formular] || PDF_FORMULARE["1350"];
  const soll = rezept.soll || {};

  // Zeilen einsammeln (Abschnittsköpfe zählen mit)
  const alle = [];
  form.abschnitte.forEach(a => {
    alle.push({ kopf: 1, nr: a.nr, text: a.titel });
    a.zeilen.forEach(z => alle.push(z));
  });

  // auf Seiten verteilen
  const kopfH = 46 + 2 * (ZH + 3), fussH = 48;
  const platz = PdfDoc.SEITE_H - RAND - kopfH - fussH - RAND;
  const proSeite = Math.floor(platz / ZH);
  const seiten = Math.max(1, Math.ceil(alle.length / proSeite));

  const doc = new PdfDoc();
  for (let s = 0; s < seiten; s++) {
    if (s > 0) doc.neueSeite();
    let o = kopfZeichnen(doc, form, rezept, s + 1, seiten);
    const teil = alle.slice(s * proSeite, (s + 1) * proSeite);
    teil.forEach(z => {
      if (z.kopf) {
        doc.rechteck(RAND, o, BREITE, ZH, GRAU);
        doc.text(z.nr, SP_NR, o + 7.4, 7.2, true);
        doc.text(z.text, SP_TEXT, o + 7.4, 7.2, true);
      } else {
        doc.rechteck(RAND, o, BREITE, ZH);
        doc.linie(SP_WERT - 6, o, SP_WERT - 6, o + ZH);
        doc.linie(SP_EH - 6, o, SP_EH - 6, o + ZH);
        doc.text(z.nr + (z.stern ? "*" : ""), SP_NR, o + 7.4, 6.6);
        doc.textGekuerzt(z.text, SP_TEXT, o + 7.4, 6.6, SP_WERT - SP_TEXT - 10);
        // Wert: gespeicherter Einstellwert, feste Angabe oder Maschine
        let wert = "";
        if (z.feld && soll[z.feld]) wert = soll[z.feld];
        else if (z.festMaschine) wert = rezept.maschine || "";
        else if (z.fest) wert = z.fest;
        // ohne Einheit darf der Wert bis zum Rand laufen
        const maxWert = (z.eh ? SP_EH : RAND + BREITE) - SP_WERT - 10;
        if (wert) doc.textGekuerzt(wert, SP_WERT, o + 7.4, 7.2, maxWert, !!z.feld);
        doc.text(z.eh || "", SP_EH, o + 7.4, 6.3);
      }
      o += ZH;
    });
    if (s === seiten - 1) fussZeichnen(doc, o, ersteller, datum);
  }
  return doc.bauen();
}

if (typeof module !== "undefined") module.exports = { erstmusterPdf, PDF_FORMULARE, PdfDoc };
