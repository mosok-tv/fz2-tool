"use strict";
/* Erzeugt das Erstmuster-Formular als echtes PDF – ohne fremde Bibliotheken,
   damit die App offline bleibt und keine Daten nach außen gehen.
   Aufbau nach den Werksblättern WPD-013 1350 / 1341 und VA-013F3. */

/* ---------- kleiner PDF-Schreiber (A4 hoch, Helvetica) ---------- */
function PdfDoc() {
  this.seiten = [];      // je Seite ein Array von Anweisungen (Strings)
  this.bilder = [];      // eingebettete JPEGs (Prüfkarten-Fotos)
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

/* JPEG unverändert einbetten (DCTDecode) – Maße stehen im SOF-Abschnitt der Datei */
function jpegMasse(bin) {
  let i = 2;
  while (i + 9 < bin.length) {
    if (bin.charCodeAt(i) !== 0xFF) { i++; continue; }
    const marker = bin.charCodeAt(i + 1);
    const istSOF = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (istSOF) {
      return { hoehe: (bin.charCodeAt(i + 5) << 8) | bin.charCodeAt(i + 6),
               breite: (bin.charCodeAt(i + 7) << 8) | bin.charCodeAt(i + 8),
               kanaele: bin.charCodeAt(i + 9) };
    }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    i += 2 + ((bin.charCodeAt(i + 2) << 8) | bin.charCodeAt(i + 3));
  }
  return null;
}
// dataUrl: "data:image/jpeg;base64,..." -> gibt den Index des Bildes zurück (oder -1)
PdfDoc.prototype.bildLaden = function (dataUrl) {
  try {
    const roh = String(dataUrl).split(",")[1];
    if (!roh) return -1;
    const bin = (typeof atob === "function") ? atob(roh) : Buffer.from(roh, "base64").toString("latin1");
    const m = jpegMasse(bin);
    if (!m || !m.breite || !m.hoehe) return -1;
    this.bilder.push({ daten: bin, breite: m.breite, hoehe: m.hoehe, grau: m.kanaele === 1 });
    return this.bilder.length - 1;
  } catch (e) { return -1; }
};
// zeichnet das Bild in den Kasten (x, oben, b, h) und behält dabei die Seitenverhältnisse
PdfDoc.prototype.bild = function (index, x, oben, maxB, maxH) {
  const b = this.bilder[index];
  if (!b) return;
  const s = Math.min(maxB / b.breite, maxH / b.hoehe);
  const bb = b.breite * s, hh = b.hoehe * s;
  const px = x + (maxB - bb) / 2, po = oben + (maxH - hh) / 2;
  this.aktuell.push(`q ${bb.toFixed(2)} 0 0 ${hh.toFixed(2)} ${px.toFixed(2)} ${y(po + hh).toFixed(2)} cm /Im${index} Do Q`);
};

PdfDoc.prototype.bauen = function () {
  const objekte = [];
  const seitenIds = this.seiten.map((_, i) => 4 + i * 2);   // Seite, dann Inhalt
  objekte[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objekte[2] = `<</Type/Pages/Kids[${seitenIds.map(id => id + " 0 R").join(" ")}]/Count ${this.seiten.length}>>`;
  objekte[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>";
  const fett = 3 + this.seiten.length * 2 + 1;
  const bildStart = fett + 1;
  const xobj = this.bilder.length
    ? "/XObject<<" + this.bilder.map((_, i) => `/Im${i} ${bildStart + i} 0 R`).join("") + ">>" : "";
  this.seiten.forEach((inhalt, i) => {
    const seiteId = seitenIds[i], inhaltId = seiteId + 1;
    objekte[seiteId] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PdfDoc.SEITE_B} ${PdfDoc.SEITE_H}]`
      + `/Resources<</Font<</F1 3 0 R/F2 ${fett} 0 R>>${xobj}>>/Contents ${inhaltId} 0 R>>`;
    const strom = inhalt.join("\n");
    objekte[inhaltId] = `<</Length ${strom.length}>>\nstream\n${strom}\nendstream`;
  });
  objekte[fett] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>";
  this.bilder.forEach((b, i) => {
    objekte[bildStart + i] = `<</Type/XObject/Subtype/Image/Width ${b.breite}/Height ${b.hoehe}`
      + `/ColorSpace/Device${b.grau ? "Gray" : "RGB"}/BitsPerComponent 8/Filter/DCTDecode/Length ${b.daten.length}>>`
      + `\nstream\n${b.daten}\nendstream`;
  });

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

function fussZeichnen(doc, o, ersteller, datum, stand) {
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
  // Stand: damit im Büro erkennbar ist, welches Blatt das neuere ist
  if (stand) doc.text("Stand " + stand + (datum ? " vom " + datum : ""), RAND + 366, o + 22, 8, true);
  return o + 26;
}

/* ---------- Anlage: was sich geändert hat und was notgedrungen anders lief ---------- */
const AN_ALT = RAND + 300, AN_NEU = RAND + 372, AN_DIFF = RAND + 444;

function anlageZeile(doc, o, spalten, fett, hoehe) {
  const h = hoehe || ZH + 1;
  doc.rechteck(RAND, o, BREITE, h);
  doc.linie(AN_ALT - 8, o, AN_ALT - 8, o + h);
  doc.linie(AN_NEU - 8, o, AN_NEU - 8, o + h);
  if (spalten[3] !== undefined) doc.linie(AN_DIFF - 8, o, AN_DIFF - 8, o + h);
  doc.textGekuerzt(spalten[0], SP_TEXT, o + 7.6, 7, AN_ALT - SP_TEXT - 14, fett);
  doc.textGekuerzt(spalten[1], AN_ALT, o + 7.6, 7.2, 64, fett);
  doc.textGekuerzt(spalten[2], AN_NEU, o + 7.6, 7.2, 64, fett);
  if (spalten[3] !== undefined) doc.textGekuerzt(spalten[3], AN_DIFF, o + 7.6, 7.2, RAND + BREITE - AN_DIFF - 6, true);
  return o + h;
}

function anlageZeichnen(doc, form, r, anlage, seite, seiten, ersteller, datum) {
  let o = kopfZeichnen(doc, form, r, seite, seiten);
  o += 8;
  doc.text("ANLAGE ZUM ERSTMUSTER - ÄNDERUNGEN UND ABWEICHUNGEN", SP_NR, o + 8, 9.5, true);
  o += 14;
  const v = anlage.versand;
  doc.text("Stand " + anlage.stand + (datum ? " vom " + datum : "")
    + (v ? " - zuletzt versendet Stand " + v.stand + " am " + String(v.datum).split(" ")[0] : " - erstmalig versendet"),
    SP_NR, o + 8, 7.6);
  o += 18;

  const aend = anlage.aenderungen || [], notl = anlage.notloesungen || [];
  if (aend.length) {
    doc.text("A  Geänderte Sollwerte" + (v ? " gegenüber Stand " + v.stand : ""), SP_NR, o + 8, 8, true);
    o += 12;
    o = anlageZeile(doc, o, ["Wert", "alt", "neu", "Differenz"], true);
    aend.forEach(a => {
      o = anlageZeile(doc, o, [a.name + (a.einheit ? " (" + a.einheit + ")" : ""), a.alt || "-", a.neu || "-", a.diff || "geändert"]);
    });
    o += 14;
  }
  if (notl.length) {
    doc.text("B  Notlösungen beim Rüsten - Sollwert blieb unverändert", SP_NR, o + 8, 8, true);
    o += 12;
    o = anlageZeile(doc, o, ["Wert", "Soll", "gefahren"], true);
    notl.forEach(n => {
      const zusatz = [n.maschine, String(n.datum).split(" ")[0], n.benutzer, n.grund].filter(Boolean).join(" - ");
      const h = zusatz ? ZH + 11 : ZH + 1;
      const start = o;
      o = anlageZeile(doc, o, [n.feld + (n.einheit ? " (" + n.einheit + ")" : ""), n.soll || "-", n.ist || "-"], false, h);
      if (zusatz) doc.textGekuerzt(zusatz, SP_TEXT + 6, start + 17.5, 6.4, AN_ALT - SP_TEXT - 20);
    });
    o += 14;
  }
  doc.text("Erstellt " + (datum || "") + (ersteller ? " von " + ersteller : "")
    + " - " + aend.length + " geänderte Werte, " + notl.length + " Notlösungen", SP_NR, o + 8, 7.2);
}

function erstmusterPdf(rezept, ersteller, datum, anlage) {
  const form = PDF_FORMULARE[rezept.formular] || PDF_FORMULARE["1350"];
  const soll = rezept.soll || {};
  const hatAnlage = !!(anlage && (((anlage.aenderungen || []).length) || ((anlage.notloesungen || []).length)));

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
  // Das Formular verlangt die Prüfkarte als Beilage – wenn eine fotografiert wurde, hängt sie hinten an
  const karteIdx = rezept.pruefkarte ? doc.bildLaden(rezept.pruefkarte) : -1;
  const hatKarte = karteIdx >= 0;
  const gesamt = seiten + (hatAnlage ? 1 : 0) + (hatKarte ? 1 : 0);
  for (let s = 0; s < seiten; s++) {
    if (s > 0) doc.neueSeite();
    let o = kopfZeichnen(doc, form, rezept, s + 1, gesamt);
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
    if (s === seiten - 1) fussZeichnen(doc, o, ersteller, datum, anlage && anlage.stand);
  }
  if (hatAnlage) {
    doc.neueSeite();
    anlageZeichnen(doc, form, rezept, anlage, seiten + 1, gesamt, ersteller, datum);
  }
  if (hatKarte) {
    doc.neueSeite();
    let o = kopfZeichnen(doc, form, rezept, gesamt, gesamt);
    o += 8;
    doc.text("ANLAGE - PRÜFKARTE", SP_NR, o + 8, 9.5, true);
    o += 16;
    doc.bild(karteIdx, RAND, o, BREITE, PdfDoc.SEITE_H - o - RAND - 14);
    doc.text("Foto der Prüfkarte, aufgenommen in der App am " + (rezept.pruefkarte_am || "-"),
      SP_NR, PdfDoc.SEITE_H - RAND - 4, 7);
  }
  return doc.bauen();
}

/* ---------- Blatt WPD-005F1 „Eingesetzte Fertigware DZ" ----------
   Zeile i trägt Vorzug i (Input) und Spule i (Output) – wie auf dem Papier.
   Die Abholung macht das Lager: die Spalten bleiben leer zum Ausfüllen von Hand. */
const FW_FORM = { titel: "Eingesetzte Fertigware DZ", kennung: "WPD-005F1", rev: "Rev. 6 vom 28.06.2023" };
const FW_SP = [48, 44, 28, 60, 52, 40, 40, 52, 52, 40];  // letzte Spalte (Gesamtgewicht) nimmt den Rest
FW_SP.push(BREITE - FW_SP.reduce((s, b) => s + b, 0));
const FW_X = FW_SP.reduce((xs, b) => { xs.push(xs[xs.length - 1] + b); return xs; }, [RAND]);
const FW_ZH = 16;   // Platz zum Nachtragen von Hand

function fwZahl(n, nk) {
  const v = Number(n);
  if (!isFinite(v) || n === null || n === "") return "";
  const t = v.toFixed(nk).split(".");
  return t[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (t[1] ? "," + t[1] : "");
}
// kg der Vorzüge: Nachkommastellen nur, wenn eingegeben (398,5 bleibt 398,5)
function fwKg(n) { return fwZahl(n, 2).replace(/,00$/, "").replace(/(,\d)0$/, "$1"); }

function fwZeile(doc, o, h, werte, rechts, fett, fuellung) {
  doc.rechteck(RAND, o, BREITE, h, fuellung);
  for (let i = 1; i < FW_SP.length; i++) doc.linie(FW_X[i], o, FW_X[i], o + h);
  werte.forEach((w, i) => {
    if (w === "" || w == null) return;
    const g = 7.4, maxB = FW_SP[i] - 6;
    const s = String(w);
    const x = rechts[i] ? Math.max(FW_X[i] + 3, FW_X[i + 1] - 3 - breite(s, g)) : FW_X[i] + 3;
    doc.textGekuerzt(s, x, o + h / 2 + 2.6, g, maxB, fett);
  });
  return o + h;
}

function fwKopf(doc, info, seite, seiten) {
  let o = RAND;
  doc.rechteck(RAND, o, BREITE, 46);
  doc.linie(RAND + 120, o, RAND + 120, o + 46);
  doc.linie(RAND + BREITE - 150, o, RAND + BREITE - 150, o + 46);
  doc.text("Drahtwerk Waidhaus", RAND + 12, o + 28, 10, true);
  doc.text(FW_FORM.titel, RAND + 150, o + 28, 13, true);
  doc.text(FW_FORM.kennung, RAND + BREITE - 142, o + 14, 9);
  doc.text("Seite " + seite + " von " + seiten, RAND + BREITE - 142, o + 29, 9);
  doc.text(FW_FORM.rev, RAND + BREITE - 142, o + 42, 9);
  o += 46;
  // Maschine | Produkt | Auftrags Nr.
  const h = ZH + 6;
  doc.rechteck(RAND, o, BREITE, h);
  doc.linie(RAND + 120, o, RAND + 120, o + h);
  doc.linie(RAND + BREITE - 150, o, RAND + BREITE - 150, o + h);
  doc.text("Maschine:", SP_NR, o + 11, 8, true);
  doc.textGekuerzt(info.maschine || "", SP_NR + 46, o + 11, 9, 66, true);
  doc.text("Produkt:", RAND + 126, o + 11, 8, true);
  doc.textGekuerzt(info.produkt || "", RAND + 166, o + 11, 8.5, BREITE - 150 - 176);
  doc.text("Auftrags Nr.:", RAND + BREITE - 144, o + 11, 8, true);
  doc.textGekuerzt(info.auftrag || "", RAND + BREITE - 86, o + 11, 9, 80, true);
  o += h + 6;
  // Gruppenköpfe: Datum und Pers.-Nr. gehen über beide Kopfzeilen
  const gh = 12, kh = 14;
  doc.rechteck(RAND, o, BREITE, gh + kh);
  doc.rechteck(FW_X[2], o, FW_X[6] - FW_X[2], gh, GRAU);
  doc.rechteck(FW_X[6], o, FW_X[9] - FW_X[6], gh, GRAU);
  doc.rechteck(FW_X[9], o, FW_X[11] - FW_X[9], gh, GRAU);
  doc.text("Input", FW_X[2] + (FW_X[6] - FW_X[2]) / 2 - 10, o + 9, 8, true);
  doc.text("Output", FW_X[6] + (FW_X[9] - FW_X[6]) / 2 - 13, o + 9, 8, true);
  doc.text("Abholung", FW_X[9] + (FW_X[11] - FW_X[9]) / 2 - 17, o + 9, 8, true);
  doc.linie(FW_X[1], o, FW_X[1], o + gh + kh);
  doc.linie(FW_X[2], o, FW_X[2], o + gh + kh);
  const koepfe = ["Datum", "Pers. Nr.", "Linie", "Spulen-/Korb-Nr.", "Coilnr.", "kg", "Spulen-Nr.", "Länge [m]", "Gewicht [kg]", "Anzahl", "Gesamtgewicht"];
  doc.rechteck(FW_X[2], o + gh, BREITE - (FW_X[2] - RAND), kh, HELLGRAU);
  for (let i = 3; i < FW_SP.length; i++) doc.linie(FW_X[i], o + gh, FW_X[i], o + gh + kh);
  koepfe.forEach((k, i) => doc.textGekuerzt(k, FW_X[i] + 3, o + (i < 2 ? 16 : gh + 10), 6.8, FW_SP[i] - 5, true));
  return o + gh + kh;
}

// info = { maschine, auftrag, produkt }, vorzuege/spulen = Datensätze aus der App
function fertigwarePdf(info, vorzuege, spulen, ersteller, datum) {
  const vz = (vorzuege || []).slice(), sp = (spulen || []).slice();
  const tag = s => String(s || "").split(" ")[0];
  const zeilen = [];
  for (let i = 0; i < Math.max(vz.length, sp.length); i++) {
    const v = vz[i] || {}, s = sp[i] || {};
    zeilen.push([tag(s.created_at || v.ein_at), s.benutzer || v.benutzer || "",
      v.linie != null ? v.linie : "", v.korb || "", v.coil || "", fwKg(v.kg),
      s.nr ? "Sp. " + s.nr : "", fwZahl(s.laenge_m, 0), fwZahl(s.gewicht_kg, 2), "", ""]);
  }
  const rechts = [0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1];
  const kopfH = 46 + ZH + 6 + 6 + 26, fussH = FW_ZH + 22;
  const proSeite = Math.floor((PdfDoc.SEITE_H - 2 * RAND - kopfH - fussH) / FW_ZH);
  const seiten = Math.max(1, Math.ceil(zeilen.length / proSeite));
  const sumKg = vz.reduce((a, v) => a + (Number(v.kg) || 0), 0);
  const sumL = sp.reduce((a, s) => a + (Number(s.laenge_m) || 0), 0);
  const sumG = sp.reduce((a, s) => a + (Number(s.gewicht_kg) || 0), 0);

  const doc = new PdfDoc();
  for (let s = 0; s < seiten; s++) {
    if (s > 0) doc.neueSeite();
    let o = fwKopf(doc, info, s + 1, seiten);
    const teil = zeilen.slice(s * proSeite, (s + 1) * proSeite);
    // leere Zeilen bis zum Seitenende – das Papier wird von Hand weitergeführt
    while (teil.length < proSeite) teil.push([]);
    teil.forEach(z => { o = fwZeile(doc, o, FW_ZH, z, rechts); });
    if (s === seiten - 1) {
      o = fwZeile(doc, o, FW_ZH, ["Summe", "", "", "", vz.length + " Vorzüge", fwKg(sumKg),
        sp.length + " Sp.", fwZahl(sumL, 0), fwZahl(sumG, 2), "", ""], rechts, true, HELLGRAU);
    }
    doc.text("Erstellt mit der App Drahtzug" + (datum ? " am " + datum : "") + (ersteller ? " von " + ersteller : "")
      + " - Abholung trägt das Lager ein.", SP_NR, PdfDoc.SEITE_H - RAND - 4, 7);
  }
  return doc.bauen();
}

if (typeof module !== "undefined") module.exports = { erstmusterPdf, fertigwarePdf, PDF_FORMULARE, PdfDoc, anlageZeichnen };
