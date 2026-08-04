// Erstmuster-PDF: gültige Datei, richtige Werte, alle drei Formulare
const path = require("path");
const { pruefer } = require("./helfer");

module.exports = async function () {
  const check = pruefer();
  // Blob gibt es in Node nicht wie im Browser – für den Test genügt der Byte-Zugriff
  const echtesBlob = global.Blob;
  global.Blob = class { constructor(teile) { this.teile = teile; } };
  delete require.cache[require.resolve("../pdf.js")];
  const { erstmusterPdf, PDF_FORMULARE } = require("../pdf.js");

  const rezept = {
    kuerzel: "VSW", aufbau: "6x0,050", klartext: "versilbert weich",
    maschine: "Z68", beispiel_auftrag: "18034", formular: "1350",
    soll: { "Tänzer Ziehen": "1,9", "Zugkraft Ablauf": "400", "Ziehgeschwindigkeit": "16",
            "Glühfaktor": "1,15", "Spulengröße": "250" },
  };
  const bytes = erstmusterPdf(rezept, "güntzel", "03.08.2026").teile[0];
  const roh = Buffer.from(bytes).toString("latin1");

  check("PDF beginnt mit %PDF", roh.startsWith("%PDF-"));
  check("PDF endet mit %%EOF", roh.trim().endsWith("%%EOF"));
  check("PDF hat xref-Tabelle", roh.indexOf("\nxref\n") !== -1 && roh.indexOf("startxref") !== -1);
  check("PDF ist eine Seite", /\/Count 1\b/.test(roh));
  check("Schriften eingebettet", roh.indexOf("Helvetica") !== -1 && roh.indexOf("Helvetica-Bold") !== -1);

  // Inhalte müssen im Textstrom stehen
  const enthalten = t => roh.indexOf("(" + t + ")") !== -1;
  check("Kennung WPD-013 1350 im PDF", enthalten("WPD-013 1350"));
  check("Produktbezeichnung eingetragen", enthalten("VSW 6x0,050 versilbert weich"));
  check("Maschine eingetragen", enthalten("Z68"));
  check("Auftragsnummer eingetragen", enthalten("18034"));
  check("Sollwert 1,9 eingetragen", enthalten("1,9"));
  check("Sollwert 400 eingetragen", enthalten("400"));
  check("Sollwert 1,15 eingetragen", enthalten("1,15"));
  check("Sternchen-Hinweis im Fuß", roh.indexOf("Maschinenbediener einzustellen") !== -1);
  check("Umlaute als Latin-1 (Glühfaktor)", roh.indexOf("Gl\xfchfaktor") !== -1);
  check("Ersteller im Fuß eingetragen", enthalten("g\xfcntzel"));
  check("Datum im Fuß eingetragen", enthalten("03.08.2026"));
  check("Geprüft-von bleibt leer", roh.indexOf("(Gepr\xfcft von:)") !== -1);
  // ohne Angaben bleiben die Felder frei
  const ohne = Buffer.from(erstmusterPdf(rezept).teile[0]).toString("latin1");
  check("ohne Ersteller bleibt das Feld leer", ohne.indexOf("(g\xfcntzel)") === -1);

  // leeres Muster darf nicht abstürzen
  let leerOk = true;
  try { erstmusterPdf({ formular: "1350" }); } catch (e) { leerOk = false; }
  check("leeres Muster erzeugt trotzdem ein PDF", leerOk);

  // alle Formulare bauen und passen auf eine Seite
  Object.keys(PDF_FORMULARE).forEach(k => {
    const b = Buffer.from(erstmusterPdf({ formular: k, kuerzel: "X", soll: {} }).teile[0]).toString("latin1");
    check("Formular " + k + " erzeugt gültiges PDF", b.startsWith("%PDF-") && b.trim().endsWith("%%EOF"));
    check("Formular " + k + " passt auf eine Seite", /\/Count 1\b/.test(b));
  });

  // --- Anlage: Seite 2 mit Änderungen und Notlösungen ---
  const anlage = {
    stand: 4, versand: { stand: 3, datum: "28.07.2026 06:12", benutzer: "friedl" },
    aenderungen: [
      { name: "Glühfaktor", alt: "1,20", neu: "1,15", diff: "-0,05", einheit: "" },
      { name: "Glühspannung", alt: "400", neu: "395", diff: "-5", einheit: "V" },
    ],
    notloesungen: [
      { feld: "Zugkraft Aufwickelspannung", soll: "400", ist: "350", einheit: "cN",
        grund: "Spule lief unruhig", datum: "02.08.2026 21:40", benutzer: "friedl" },
      { feld: "Trocknungssteine", soll: "1,2", ist: "1,0", einheit: "mm",
        grund: "", datum: "29.07.2026 14:02", benutzer: "güntzel" },
    ],
  };
  const mA = Buffer.from(erstmusterPdf(rezept, "güntzel", "04.08.2026", anlage).teile[0]).toString("latin1");
  const inA = t => mA.indexOf("(" + t + ")") !== -1;
  check("Anlage erzeugt eine zweite Seite", /\/Count 2\b/.test(mA));
  check("Anlage hat Überschrift", mA.indexOf("ANLAGE ZUM ERSTMUSTER") !== -1);
  check("Anlage nennt beide Stände", mA.indexOf("zuletzt versendet Stand 3") !== -1);
  check("Block A mit alt und neu", inA("1,20") && inA("1,15") && inA("-0,05"));
  check("Block B mit Soll und gefahren", inA("350") && mA.indexOf("Notl\xf6sungen beim R\xfcsten") !== -1);
  check("Grund steht in der Anlage", mA.indexOf("Spule lief unruhig") !== -1);
  check("Notlösung ohne Grund nennt trotzdem Datum und Namen", mA.indexOf("29.07.2026 - g\xfcntzel") !== -1);
  check("Stand steht im Fuß von Seite 1", mA.indexOf("(Stand 4 vom 04.08.2026)") !== -1);
  check("Seitenzählung berücksichtigt die Anlage", mA.indexOf("(Seite 1 von 2)") !== -1);

  // ohne Änderungen und ohne Notlösungen bleibt es einseitig
  const ohneAnlage = Buffer.from(
    erstmusterPdf(rezept, "güntzel", "04.08.2026", { stand: 1, versand: null, aenderungen: [], notloesungen: [] }).teile[0]
  ).toString("latin1");
  check("leere Anlage hängt keine Seite an", /\/Count 1\b/.test(ohneAnlage));
  check("Stand steht trotzdem im Fuß", ohneAnlage.indexOf("(Stand 1 vom 04.08.2026)") !== -1);

  // unbekannte Formularkennung -> Standard statt Absturz
  const fallback = Buffer.from(erstmusterPdf({ formular: "gibtsnicht", soll: {} }).teile[0]).toString("latin1");
  check("unbekanntes Formular fällt auf 1350 zurück", fallback.indexOf("(WPD-013 1350)") !== -1);

  if (echtesBlob) global.Blob = echtesBlob; else delete global.Blob;
  return check.ergebnis();
};
