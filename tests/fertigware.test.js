// Fertigware (Blatt WPD-005F1): Vorzüge einbauen, Spulen eintragen, Übersicht, PDF, Sicherung
const { starteApp, appMitLogin, pruefer, werkzeuge, warte } = require("./helfer");

module.exports = async function () {
  const check = pruefer();

  // angemeldet starten, Z83 läuft mit Auftrag 18034
  const w0 = await appMitLogin();
  const vault = JSON.parse(w0.localStorage.getItem("sue_vault"));
  vault.laufend = { Z83: { kuerzel: "VSW", aufbau: "6x0,050", klartext: "versilbert weich", auftrag: "18034", seit: "20.09.2026 06:00", benutzer: "güntzel" } };
  const w = starteApp(vault);
  await warte(80);
  const { d, S } = werkzeuge(w);
  const oeffne = m => { d.querySelector(`[data-maschine="${m}"]`).click(); };
  const feld = (id, v) => { d.getElementById(id).value = v; };

  oeffne("Z83");
  const karte = () => d.querySelector(".fw-karte");
  check("Fertigware-Karte an der Maschine", karte() !== null);
  check("Karte zeigt den Auftrag", karte().textContent.indexOf("Auftrag 18034") !== -1);
  check("ohne Linien keine Linie-Spalte", karte().innerHTML.indexOf("<th>Linie</th>") === -1);

  // Linien einstellen: Z83 mit 6 Linien
  const sel = d.querySelector("[data-fw-linien]");
  sel.value = "6"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  check("Linienzahl gespeichert", S("linien").Z83 === 6);

  // Vorzug auf Linie 1 und 2
  const vorzug = (linie, korb, coil, kg) => {
    d.querySelector("[data-vorzug-neu]").click();
    d.getElementById("fw-linie").value = String(linie);
    feld("fw-korb", korb); feld("fw-coil", coil); feld("fw-kg", kg);
    d.querySelector("[data-fw-vorzug-speichern]").click();
  };
  d.querySelector("[data-vorzug-neu]").click();
  check("Vorzug-Maske hat Linienauswahl 1–6", d.getElementById("fw-linie").options.length === 6);
  d.querySelector("[data-fw-abbruch]").click();
  vorzug(1, "K12", "650123", "412");
  vorzug(2, "K13", "650124", "398,5");
  check("zwei Vorzüge gespeichert", S("vorzuege").length === 2);
  check("Vorzug trägt Auftrag und Benutzer", S("vorzuege")[0].auftrag === "18034" && S("vorzuege")[0].benutzer === "güntzel");
  check("Kachel zeigt 2 Vorzüge drin", karte().querySelectorAll(".kachel b")[1].textContent === "2");
  check("Input-Summe 811 kg", karte().querySelectorAll(".kachel b")[2].textContent === "811");
  check("Linie-Spalte bei 6 Linien", karte().innerHTML.indexOf("<th>Linie</th>") !== -1);

  // Wechsel auf Linie 1: alter Vorzug gilt als ausgebaut, bleibt aber gespeichert
  vorzug(1, "K20", "650200", "405");
  const alt = S("vorzuege").find(v => v.coil === "650123");
  check("alter Vorzug auf Linie 1 ausgebaut", !!alt.aus_at);
  check("weiter nur 2 Vorzüge drin", karte().querySelectorAll(".kachel b")[1].textContent === "2");
  check("gewechselter Coil wird angezeigt", karte().textContent.indexOf("650200") !== -1 && karte().textContent.indexOf("650123") === -1);

  // Pflichtfeld: ohne Gewicht wird nichts gespeichert
  d.querySelector("[data-vorzug-neu]").click();
  feld("fw-coil", "999"); feld("fw-kg", "");
  d.querySelector("[data-fw-vorzug-speichern]").click();
  check("Vorzug ohne kg abgelehnt", S("vorzuege").length === 3);
  d.querySelector("[data-fw-abbruch]").click();

  // Spulen: Nummer wird vorgeschlagen
  d.querySelector("[data-spule-fertig]").click();
  check("erste Spule schlägt Nr. 1 vor", d.getElementById("fw-nr").value === "1");
  feld("fw-laenge", "73.400"); feld("fw-gewicht", "268,53");
  d.querySelector("[data-fw-spule-speichern]").click();
  const s1 = S("fertigspulen")[0];
  check("Spule gespeichert", S("fertigspulen").length === 1 && s1.nr === "1");
  check("Länge 73.400 als 73400 m", s1.laenge_m === 73400);
  check("Gewicht 268,53 kg", s1.gewicht_kg === 268.53);
  check("Produkt aus dem laufenden Draht", s1.produkt === "VSW 6x0,050 versilbert weich");
  d.querySelector("[data-spule-fertig]").click();
  check("zweite Spule schlägt Nr. 2 vor", d.getElementById("fw-nr").value === "2");
  feld("fw-nr", "Sp.2"); feld("fw-gewicht", "270");
  d.querySelector("[data-fw-spule-speichern]").click();
  check("„Sp.2\" als Nr. 2 gespeichert", S("fertigspulen")[1].nr === "2");
  check("Länge darf fehlen", S("fertigspulen")[1].laenge_m === null);
  check("Kachel zeigt 2 Spulen fertig", karte().querySelectorAll(".kachel b")[0].textContent === "2");

  d.querySelector("[data-spule-fertig]").click();
  feld("fw-gewicht", "");
  d.querySelector("[data-fw-spule-speichern]").click();
  check("Spule ohne Gewicht abgelehnt", S("fertigspulen").length === 2);
  d.querySelector("[data-fw-abbruch]").click();

  // Löschen landet im Papierkorb
  d.querySelectorAll("[data-fw-spule-weg]")[1].click();
  check("Spule gelöscht", S("fertigspulen").length === 1);
  check("Spule im Papierkorb", S("papierkorb").some(x => x.art === "fertigspulen" && x.daten.nr === "2"));

  // Eingaben werden maskiert
  d.querySelector("[data-vorzug-neu]").click();
  d.getElementById("fw-linie").value = "3";
  feld("fw-korb", "<img src=x onerror=alert(1)>"); feld("fw-coil", "<b>x</b>"); feld("fw-kg", "10");
  d.querySelector("[data-fw-vorzug-speichern]").click();
  check("Korb-Nr. wird maskiert", karte().querySelector("img") === null && karte().querySelector("td b") === null);

  // Übersicht im Bereich Spulen
  werkzeuge(w).tab("spulen");
  const zeile = d.querySelector('[data-fw-zur-maschine="Z83"]');
  check("Übersicht zeigt Z83", zeile !== null && zeile.textContent.indexOf("Auftrag 18034") !== -1);
  check("Übersicht zählt 1 Spule", zeile.textContent.indexOf("1 Spulen") !== -1);
  zeile.click();
  check("Übersicht springt zur Maschine", karte() !== null && d.getElementById("kopf-titel").textContent === "Z83");

  // PDF teilen
  let geteilt = null;
  w.navigator.canShare = () => true;
  w.navigator.share = o => { geteilt = o; return Promise.resolve(); };
  d.querySelector('[data-fw-pdf="Z83"]').click();
  await warte(150);
  check("PDF wird geteilt", geteilt && geteilt.files && geteilt.files[0].name === "Fertigware_Z83_18034.pdf");

  // Sicherung enthält die neuen Daten
  let text = null;
  w.navigator.share = o => { const r = new w.FileReader(); r.onload = () => { text = r.result; }; r.readAsText(o.files[0]); return Promise.resolve(); };
  werkzeuge(w).tab("mehr");
  d.querySelector("[data-export]").click();
  await warte(150);
  const daten = text ? JSON.parse(text) : {};
  check("Sicherung enthält Vorzüge, Spulen und Linien",
    Array.isArray(daten.vorzuege) && daten.vorzuege.length === 4 && daten.fertigspulen.length === 1 && daten.linien.Z83 === 6);

  // Einzelzieh-Maschine: keine Linienauswahl
  werkzeuge(w).tab("maschinen");
  oeffne("Z67");
  d.querySelector("[data-vorzug-neu]").click();
  check("Z67 ohne Linienauswahl", d.getElementById("fw-linie") === null);
  feld("fw-coil", "7001"); feld("fw-kg", "500");
  d.querySelector("[data-fw-vorzug-speichern]").click();
  check("Z67-Vorzug auf Linie 1", S("vorzuege").some(v => v.machine === "Z67" && v.linie === 1));
  check("Z67 ohne Auftrag beschriftet", karte().textContent.indexOf("ohne Auftragsnummer") !== -1);

  // --- PDF im Aufbau von WPD-005F1 ---
  const echtesBlob = global.Blob;
  global.Blob = class { constructor(teile) { this.teile = teile; } };
  delete require.cache[require.resolve("../pdf.js")];
  const { fertigwarePdf } = require("../pdf.js");
  const vz = [{ linie: 1, korb: "K12", coil: "650123", kg: 412, ein_at: "20.09.2026 06:10", benutzer: "güntzel" },
              { linie: 2, korb: "K13", coil: "650124", kg: 398.5, ein_at: "20.09.2026 06:12", benutzer: "güntzel" }];
  const sp = [{ nr: "1", laenge_m: 73400, gewicht_kg: 268.53, created_at: "21.09.2026 14:02", benutzer: "friedl" }];
  const roh = Buffer.from(fertigwarePdf({ maschine: "Z83", auftrag: "18034", produkt: "VSW 6x0,050" }, vz, sp, "güntzel", "25.09.2026 10:00").teile[0]).toString("latin1");
  const drin = t => roh.indexOf("(" + t + ")") !== -1;
  check("PDF gültig", roh.startsWith("%PDF-") && roh.trim().endsWith("%%EOF"));
  check("PDF: Kennung und Revision", drin("WPD-005F1") && drin("Rev. 6 vom 28.06.2023"));
  check("PDF: Titel", drin("Eingesetzte Fertigware DZ"));
  check("PDF: Maschine, Produkt, Auftrag", drin("Z83") && drin("VSW 6x0,050") && drin("18034"));
  check("PDF: Spalten Input/Output/Abholung", drin("Input") && drin("Output") && drin("Abholung"));
  check("PDF: Coil und Korb", drin("650123") && drin("K13"));
  check("PDF: Spule mit Länge und Gewicht", drin("Sp. 1") && drin("73.400") && drin("268,53"));
  check("PDF: Datum aus der Spule", drin("21.09.2026"));
  check("PDF: kg mit Nachkommastelle 398,5", drin("398,5") && drin("412"));
  check("PDF: Summe Input 810,5 kg", drin("810,5"));
  check("PDF: Kopf Spulen-/Korb-Nr. ungekürzt", drin("Spulen-/Korb-Nr."));
  check("PDF: eine Seite", /\/Count 1\b/.test(roh));
  const viele = Array.from({ length: 60 }, (_, i) => ({ nr: String(i + 1), gewicht_kg: 250, created_at: "21.09.2026 14:02" }));
  const roh2 = Buffer.from(fertigwarePdf({ maschine: "Z83", auftrag: "1" }, [], viele, "", "").teile[0]).toString("latin1");
  check("PDF: 60 Spulen ergeben zwei Seiten", /\/Count 2\b/.test(roh2) && roh2.indexOf("(Seite 2 von 2)") !== -1);
  check("PDF: Summe 15.000 kg", roh2.indexOf("(15.000,00)") !== -1);
  global.Blob = echtesBlob;

  return check.ergebnis();
};
