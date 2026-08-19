// Kernfunktionen der App: Anmeldung, Maschinen, Aufgaben, Spulen, Rüsten, Fehler
const { appMitLogin, pruefer, werkzeuge, warte } = require("./helfer");

module.exports = async function () {
  const check = pruefer();
  const w = await appMitLogin();
  const { d, setVal, tab, S } = werkzeuge(w);

  check("Anmeldung erfolgreich", d.getElementById("login").hidden === true);
  check("Benutzer güntzel + friedl angelegt", (S("benutzer") || []).length === 2);
  check("Passwörter nicht im Klartext", JSON.stringify(S("benutzer")).indexOf("1234") === -1);

  // --- Maschinen ---
  check("6 Maschinen-Kacheln", d.querySelectorAll(".kopf-kachel").length === 6);
  d.querySelector('[data-maschine="Z49"]').click();
  check("5 Status-Optionen", d.querySelectorAll(".status-opt").length === 5);
  d.querySelector('[data-status="drahtriss"]').click();
  d.getElementById("notiz").value = "Riss an Kopf 3";
  d.querySelector("[data-speichern-eintrag]").click();
  check("Eintrag gespeichert", S("entries")[0].machine === "Z49" && S("entries")[0].status === "drahtriss");
  check("Eintrag trägt den Benutzer", S("entries")[0].benutzer === "güntzel");
  check("Eintrag bekommt eine Schicht", ["frueh", "spaet", "nacht"].indexOf(S("entries")[0].schicht) !== -1);
  tab("maschinen");
  check("Übergabe-Karte beim ersten Mal", d.getElementById("inhalt").textContent.indexOf("Ab jetzt steht hier") !== -1);
  d.querySelector("[data-gesehen]").click();
  check("gelesen wird je Benutzer gemerkt", (S("gesehen") || {})["güntzel"] > 0);
  check("eigene Einträge gelten nicht als neu",
    d.getElementById("inhalt").textContent.indexOf("Nichts Neues seit deiner letzten Schicht") !== -1);
  tab("maschinen");
  check("Kachel Z49 jetzt rot", d.querySelector('[data-maschine="Z49"]').classList.contains("bg-red"));

  // --- Aufgaben ---
  tab("aufgaben");
  d.getElementById("todo-text").value = "Öl nachfüllen";
  d.getElementById("todo-maschine").value = "Z67";
  d.querySelector("[data-add-todo]").click();
  check("Aufgabe gespeichert", S("todos")[0].text === "Öl nachfüllen" && S("todos")[0].machine === "Z67");
  d.getElementById("todo-text").value = "Ziehsteine tauschen";
  d.getElementById("todo-faellig").value = "2020-01-01";      // absichtlich in der Vergangenheit
  d.getElementById("todo-wichtig").checked = true;
  d.querySelector("[data-add-todo]").click();
  const wichtige = S("todos").find(t => t.text === "Ziehsteine tauschen");
  check("Termin gespeichert", wichtige.faellig === "2020-01-01" && wichtige.wichtig === true);
  check("überfällige Aufgabe steht oben",
    d.querySelectorAll(".eintrag")[0].textContent.indexOf("Ziehsteine tauschen") !== -1);
  check("überfällig wird benannt", d.querySelector(".faellig.ueber") !== null);
  check("Warnung nennt die Zahl", d.getElementById("inhalt").textContent.indexOf("1 Aufgabe ist überfällig") !== -1);
  d.querySelector('[data-del-todo="' + wichtige.id + '"]').click();
  d.querySelector("[data-toggle-todo]").click();
  check("Aufgabe abgehakt mit Name", S("todos")[0].done === true && S("todos")[0].done_von === "güntzel");

  // --- Spulen: Beispiel aus dem Schulungsblatt Drahtwerk Waidhaus ---
  // 335 kg Vorzug, 7 Spulen, Faktor 95 %, G = 0,5201 kg/km, Auftrag 348 kg
  tab("spulen");
  d.querySelectorAll(".vz").forEach(el => setVal(el, ""));
  setVal(d.querySelectorAll(".vz")[0], "335");
  setVal(d.getElementById("sp-g"), "0,5201");
  setVal(d.getElementById("sp-faktor"), "95");
  setVal(d.getElementById("sp-nspulen"), "7");
  check("Schulung: Endgewicht 318,25 kg", d.getElementById("sp-eg").textContent === "318,25");
  check("Schulung: 45,46 kg je Spule", d.getElementById("sp-skg").textContent === "45,46");
  setVal(d.getElementById("sp-auftragsmenge"), "348");
  check("Ampel: Vorzug reicht NICHT", d.getElementById("sp-ampel").innerHTML.indexOf("reicht NICHT") !== -1);
  check("Ampel nennt Fehlmenge 29,75 kg", d.getElementById("sp-ampel").innerHTML.indexOf("29,75") !== -1);
  setVal(d.getElementById("sp-auftragsmenge"), "300");
  check("Ampel: reicht aus bei 300 kg", d.getElementById("sp-ampel").innerHTML.indexOf("reicht aus") !== -1);
  setVal(d.getElementById("sp-auftragsmenge"), "");

  // Galvanik-Abzug je Vorzug
  d.querySelectorAll(".vz").forEach(el => setVal(el, ""));
  [50, 50, 50].forEach((v, i) => setVal(d.querySelectorAll(".vz")[i], String(v)));
  setVal(d.getElementById("sp-faktor"), "100");
  setVal(d.getElementById("sp-nspulen"), "1");
  check("ohne Abzug: 150 kg", d.getElementById("sp-summe").textContent === "150,00");
  d.querySelector('[data-abzug="5"]').click();
  check("Abzug 5 kg je VZ (3 VZ): 135 kg", d.getElementById("sp-summe").textContent === "135,00");
  d.querySelector('[data-abzug="7"]').click();
  check("Abzug 7 kg je VZ (3 VZ): 129 kg", d.getElementById("sp-summe").textContent === "129,00");
  d.querySelector('[data-abzug="0"]').click();

  // Vorzug-Modus, Faktor leer, Umrechner, G-Ermittlung
  d.querySelectorAll(".vz").forEach(el => setVal(el, ""));
  [54, 53, 53, 54, 53, 53].forEach((v, i) => setVal(d.querySelectorAll(".vz")[i], String(v)));
  setVal(d.getElementById("sp-g"), "0,9642");
  setVal(d.getElementById("sp-faktor"), "98");
  setVal(d.getElementById("sp-nspulen"), "20");
  setVal(d.getElementById("sp-v"), "20");
  check("Summe 320,00 kg", d.getElementById("sp-summe").textContent === "320,00");
  check("Endgewicht 313,60 kg", d.getElementById("sp-eg").textContent === "313,60");
  check("15,68 kg je Spule", d.getElementById("sp-skg").textContent === "15,68");
  check("16.262 m je Spule", d.getElementById("sp-sm").textContent === "16.262");
  check("Laufzeit je Spule 0 h 14 min", d.getElementById("sp-lzs").textContent === "0 h 14 min");
  check("Vergleich: vom kleinsten = 318,00", d.getElementById("w-kleinster").textContent === "318,00");
  d.querySelector('[data-modus="kleinster"]').click();
  check("Modus kleinster: 311,64 kg", d.getElementById("sp-eg").textContent === "311,64");
  d.querySelector('[data-modus="summe"]').click();
  setVal(d.getElementById("sp-faktor"), "");
  check("Faktor leer zählt als 100 %", d.getElementById("sp-eg").textContent === "320,00");
  setVal(d.getElementById("sp-faktor"), "98");
  setVal(d.getElementById("g-kg"), "15,68");
  setVal(d.getElementById("g-m"), "16262");
  check("G aus Spule = 0,9642", d.getElementById("g-out").textContent === "0,9642");
  setVal(d.getElementById("u-kg"), "15,68");
  check("Umrechner 15,68 kg -> 16.262 m", d.getElementById("u-kg-out").textContent === "16.262");

  // Speichern, Suche, Bearbeiten
  setVal(d.getElementById("sp-auftrag"), "18034");
  d.querySelector("[data-save-spule]").click();
  check("Berechnung gespeichert", S("spulen").length === 1 && S("spulen")[0].auftrag === "18034");
  const suche = d.getElementById("spulen-suche");
  setVal(suche, "18034");
  check("Suche findet Auftrag", d.getElementById("spulen-liste").innerHTML.indexOf("18034") !== -1);
  setVal(suche, "99999");
  check("Suche ohne Treffer", d.getElementById("spulen-liste").innerHTML.indexOf("Keine Berechnung gefunden") !== -1);
  setVal(suche, "");
  d.querySelector("[data-edit-spule]").click();
  check("Bearbeiten lädt Auftrag zurück", d.getElementById("sp-auftrag").value === "18034");
  d.querySelector("[data-save-spule]").click();
  check("Bearbeiten erzeugt keine Dublette", S("spulen").length === 1);

  // --- Erstmuster: Assistent; Rüsten: Checkliste ---
  tab("erstmuster");
  d.querySelector("[data-rezept-neu]").click();
  d.querySelector("[data-wiz-leer]").click();
  check("Assistent: 5 Schritte", d.querySelectorAll(".wpunkt").length === 5);
  const stamm = o => Object.keys(o).forEach(k => {
    const el = d.querySelector(`.wiz-stamm[data-stamm="${k}"]`);
    if (el) setVal(el, o[k]);
  });
  const wizWert = (feld, wert) => {
    const chip = d.querySelector(`[data-wiz-wert="${feld}"][data-wert="${wert}"]`);
    if (chip) return chip.click();
    const inp = d.querySelector(`.wiz-eigen[data-feld="${feld}"]`);
    if (inp) setVal(inp, wert);
  };
  const weiter = () => d.querySelector("[data-wiz-weiter]").click();
  stamm({ kuerzel: "VSW", aufbau: "6x0,050", klartext: "versilbert weich", maschine: "Z49", beispiel_auftrag: "18034" });
  weiter(); weiter();                       // -> Ziehen
  wizWert("Ziehgeschwindigkeit", "18");
  weiter();                                 // -> Glühe
  wizWert("Glühfaktor", "1,20");
  weiter(); weiter();                       // Spuler, Fertig
  check("Muster gespeichert", S("rezepte").length === 1 && S("rezepte")[0].kuerzel === "VSW");
  check("Muster trägt Benutzer", S("rezepte")[0].benutzer === "güntzel");

  setVal(d.getElementById("em-suche"), "VSW");
  check("Erstmuster-Suche findet VSW", d.getElementById("em-liste").innerHTML.indexOf("VSW") !== -1);
  setVal(d.getElementById("em-suche"), "");
  check("Erstmuster-Bereich hat Neu-Knopf", d.querySelector("[data-rezept-neu]") !== null);

  tab("ruesten");
  check("Rüsten hat keinen Neu-Knopf", d.querySelector("[data-rezept-neu]") === null);
  setVal(d.getElementById("ruest-suche"), "VSW");
  check("Rüst-Suche findet VSW", d.getElementById("ruest-liste").innerHTML.indexOf("VSW") !== -1);
  setVal(d.getElementById("ruest-suche"), "");
  d.querySelector("[data-rezept]").click();
  check("Checkliste zeigt 2 Punkte", d.querySelectorAll(".rpunkt").length === 2);
  check("Zeile hat Name, Soll und Ist-Feld",
    d.querySelector(".rpunkt .p-name") && d.querySelector(".rpunkt .p-soll b") && d.querySelector(".rpunkt .p-body .p-ist"));
  d.querySelector(".rpunkt").click();
  check("Punkt abgehakt", Object.values(S("rezepte")[0].ruest_status).some(s => s.erledigt));
  const ist = d.querySelector(".p-ist");
  setVal(ist, "17,5");
  check("Ist-Wert gespeichert", JSON.stringify(S("rezepte")[0].ruest_status).indexOf("17,5") !== -1);
  check("Maschinen-Auswahl steht auf Z49", d.getElementById("ruest-maschine").value === "Z49");
  d.querySelector("[data-ruest-abschluss]").click();
  check("Rüstung im Verlauf", S("ruestungen").length === 1 && S("ruestungen")[0].benutzer === "güntzel");

  // --- Abweichung: Ist 17,5 statt Soll 18 -> Notlösung mit Grund ---
  check("Abweichung wird abgefragt", d.querySelectorAll(".abw-zeile").length === 1);
  check("nur der abweichende Wert steht drin",
    d.querySelector(".abw-zeile").textContent.indexOf("Ziehgeschwindigkeit") !== -1);
  check("gleicher Wert wird nicht gemeldet",
    d.getElementById("inhalt").textContent.indexOf("Glühfaktor") === -1);
  d.querySelector("[data-abw-notloesung]").click();
  setVal(d.querySelector('[data-grund="0"]'), "Draht riss bei 18");
  d.querySelector("[data-abw-speichern]").click();
  check("Notlösung gespeichert", S("notloesungen").length === 1
    && S("notloesungen")[0].ist === "17,5" && S("notloesungen")[0].soll === "18");
  check("Grund gespeichert", S("notloesungen")[0].grund === "Draht riss bei 18");
  check("Notlösung merkt sich die Maschine", S("notloesungen")[0].maschine === "Z49");
  check("Sollwert bleibt unverändert", S("rezepte")[0].soll["Ziehgeschwindigkeit"] === "18");
  check("Notlösung erzeugt keinen neuen Stand", (S("rezepte")[0].historie || []).length === 0);

  tab("ruesten");
  d.querySelector("[data-rezept]").click();
  check("Rüst-Checkliste ohne Bearbeiten", d.querySelector("[data-rezept-bearbeiten]") === null);
  check("Rüst-Checkliste ohne PDF-Versand", d.querySelector("[data-erstmuster]") === null);
  // falsches Muster erwischt: Zurück muss wieder zur Liste führen
  d.querySelector("[data-rezept-zurueck]").click();
  check("Zurück führt zur Muster-Liste", d.getElementById("ruest-liste") !== null
    && d.querySelector(".rpunkt") === null);
  d.querySelector("[data-rezept]").click();

  // --- Derzeit laufend: Ergebnis der Rüstung landet bei der Maschine ---
  check("Z49 als laufend vermerkt", S("laufend").Z49 && S("laufend").Z49.kuerzel === "VSW");
  check("laufend merkt sich die Werte", S("laufend").Z49.ist["Ziehgeschwindigkeit"].wert === "17,5");
  tab("maschinen");
  check("Kachel Z49 zeigt den laufenden Draht",
    d.querySelector('[data-maschine="Z49"]').textContent.indexOf("VSW") !== -1);
  check("andere Kachel zeigt keinen Draht",
    d.querySelector('[data-maschine="Z67"]').textContent.indexOf("VSW") === -1);
  d.querySelector('[data-maschine="Z49"]').click();
  check("Maschine zeigt Derzeit laufend", d.querySelector(".karte.laufend .lauf-draht") !== null
    && d.querySelector(".lauf-draht").textContent.indexOf("VSW") !== -1);
  check("laufend steht über dem Verlauf",
    d.getElementById("inhalt").innerHTML.indexOf("Derzeit laufend")
      < d.getElementById("inhalt").innerHTML.indexOf("<h2>Verlauf</h2>"));
  d.querySelector("[data-laufend-ende]").click();
  check("laufend beendet", !S("laufend").Z49);
  check("Rüst-Verlauf bleibt erhalten", S("ruestungen").length === 1);
  d.querySelector("[data-zurueck]").click();

  // --- Eigene Maschinen anlegen und entfernen ---
  tab("mehr");
  setVal(d.getElementById("nm-name"), "Z90");
  d.querySelector("[data-maschine-neu]").click();
  check("Maschine Z90 angelegt", S("maschinen").indexOf("Z90") !== -1);
  setVal(d.getElementById("nm-name"), "z90");
  d.querySelector("[data-maschine-neu]").click();
  check("gleicher Name wird abgelehnt", S("maschinen").filter(m => m.toLowerCase() === "z90").length === 1);
  tab("maschinen");
  check("7 Kacheln mit Z90", d.querySelectorAll(".kopf-kachel").length === 7
    && d.querySelector('[data-maschine="Z90"]') !== null);
  d.querySelector('[data-maschine="Z90"]').click();
  d.querySelector('[data-status="produktion"]').click();
  d.querySelector("[data-speichern-eintrag]").click();
  check("eigene Maschine kann Einträge", S("entries").some(e => e.machine === "Z90"));
  tab("aufgaben");
  check("eigene Maschine in der Aufgaben-Auswahl",
    d.getElementById("todo-maschine").innerHTML.indexOf("Z90") !== -1);
  tab("mehr");
  d.querySelector('[data-maschine-loeschen="Z90"]').click();
  check("Maschine entfernt", S("maschinen").indexOf("Z90") === -1);
  check("Einträge bleiben nach dem Entfernen", S("entries").some(e => e.machine === "Z90"));

  // --- Zweite Rüstung: laufende Kennwerte und Vergleich ---
  tab("ruesten");
  d.querySelector("[data-rezept]").click();
  d.querySelectorAll(".rpunkt").forEach(p => p.click());
  setVal(d.querySelectorAll(".p-ist")[0], "18,5");   // Geschwindigkeit rauf
  setVal(d.querySelectorAll(".p-ist")[1], "1,20");   // Glühfaktor gleich wie beim ersten Mal
  d.querySelector("[data-ruest-abschluss]").click();
  check("zweite Rüstung gespeichert", S("ruestungen").length === 2);
  d.querySelector("[data-abw-notloesung]").click();
  d.querySelector("[data-abw-ohne-grund]").click();
  check("Notlösung ohne Grund geht auch", S("notloesungen").length === 2 && S("notloesungen")[1].grund === "");

  tab("maschinen");
  d.querySelector('[data-maschine="Z49"]').click();
  const karte = d.querySelector(".karte.laufend");
  check("Laufend zeigt nur die Kennwerte", karte.querySelectorAll(".v-zeile").length === 2);
  check("Laufend nennt Geschwindigkeit und Glühfaktor",
    karte.textContent.indexOf("Geschwindigkeit") !== -1 && karte.textContent.indexOf("Glühfaktor") !== -1);
  check("Laufend zeigt den Ist-Wert", karte.textContent.indexOf("18,5") !== -1);
  check("Laufend nennt nicht den langen Feldnamen", karte.textContent.indexOf("Ziehgeschwindigkeit") === -1);

  d.querySelector("[data-rvergleich]").click();
  const rv = () => d.getElementById("inhalt");
  check("Vergleich offen", d.querySelectorAll(".rv-zeile").length >= 1);
  const geaendert = Array.from(d.querySelectorAll(".rv-zeile")).map(z => z.textContent);
  check("nur der geänderte Wert steht oben", geaendert.length === 1
    && geaendert[0].indexOf("Ziehgeschwindigkeit") !== -1);
  check("alt -> neu wird gezeigt", geaendert[0].indexOf("17,5") !== -1 && geaendert[0].indexOf("18,5") !== -1);
  check("Differenz +1 mit Einheit", geaendert[0].replace(/\s+/g, " ").indexOf("+1,0 m/s") !== -1);
  check("Anstieg ist grün markiert", d.querySelector(".rv-diff.rauf") !== null);
  check("Zähler 1 von 2", rv().innerHTML.indexOf("Geändert (1 von 2)") !== -1);
  d.querySelector("[data-rv-alle]").click();
  check("unveränderte einblendbar", d.querySelectorAll(".rv-zeile.gleich").length === 1
    && d.querySelector(".rv-zeile.gleich").textContent.indexOf("Glühfaktor") !== -1);
  d.querySelector("[data-rv-zurueck]").click();
  check("zurück zur Maschine", d.querySelector(".karte.laufend") !== null);
  d.querySelector("[data-zurueck]").click();

  // Änderung erzeugt eine Version – jetzt über den Erstmuster-Bereich
  tab("erstmuster");
  d.querySelector("[data-em]").click();
  check("Erstmuster-Detail zeigt Werte", d.getElementById("inhalt").innerHTML.indexOf("Eingetragene Werte") !== -1);
  d.querySelector("[data-rezept-bearbeiten]").click();
  weiter(); weiter();
  wizWert("Ziehgeschwindigkeit", "20");
  weiter(); weiter(); weiter();
  check("Änderung erzeugt Historie", (S("rezepte")[0].historie || []).length === 1);
  check("Historie bewahrt alten Wert", S("rezepte")[0].historie[0].soll["Ziehgeschwindigkeit"] === "18");
  d.querySelector("[data-vergleich]").click();
  check("Vergleich zeigt alt -> neu", d.getElementById("inhalt").innerHTML.indexOf("18") !== -1
    && d.getElementById("inhalt").innerHTML.indexOf("20") !== -1);

  // --- Stand, Versand und Übernahme einer Abweichung ---
  tab("erstmuster");
  check("Liste zeigt: noch nie versendet",
    d.getElementById("em-liste").innerHTML.indexOf("noch nie versendet") !== -1);
  d.querySelector("[data-em]").click();
  check("Detail kündigt Seite 2 an",
    d.getElementById("inhalt").textContent.indexOf("Kommt beim Versand auf Seite 2") !== -1);
  check("beide Notlösungen offen", d.querySelectorAll("[data-nl-erledigt]").length === 2);
  d.querySelector("[data-nl-erledigt]").click();
  check("erledigte Notlösung verschwindet", d.querySelectorAll("[data-nl-erledigt]").length === 1);

  // Versand: ohne navigator.share landet das PDF als Download – dafür fehlt jsdom nur die URL
  w.URL.createObjectURL = () => "blob:test";
  w.URL.revokeObjectURL = () => {};
  d.querySelector("[data-erstmuster]").click();
  check("Versand merkt sich den Stand", S("rezepte")[0].versand.stand === 2);
  check("gemeldete Notlösung ist versendet",
    S("notloesungen").filter(n => n.versendet_am).length === 1);
  tab("erstmuster");
  check("Liste zeigt den versendeten Stand",
    d.getElementById("em-liste").innerHTML.indexOf("Stand 2 versendet") !== -1);
  d.querySelector("[data-em]").click();
  check("nach dem Versand keine offene Notlösung mehr", d.querySelector("[data-nl-erledigt]") === null);

  // dritte Rüstung: Abweichung diesmal übernehmen -> neuer Stand
  tab("ruesten");
  d.querySelector("[data-rezept]").click();
  setVal(d.querySelectorAll(".p-ist")[0], "21");    // Soll steht auf 20
  d.querySelector("[data-ruest-abschluss]").click();
  check("Abweichung nach der dritten Rüstung", d.querySelectorAll(".abw-zeile").length === 1);
  d.querySelector("[data-abw-uebernehmen]").click();
  check("Sollwert übernommen", S("rezepte")[0].soll["Ziehgeschwindigkeit"] === "21");
  check("Übernahme erzeugt einen Stand", (S("rezepte")[0].historie || []).length === 2);
  check("keine neue Notlösung", S("notloesungen").length === 2);
  tab("erstmuster");
  check("Liste warnt vor dem alten Blatt",
    d.getElementById("em-liste").innerHTML.indexOf("versendet war Stand 2") !== -1);
  d.querySelector("[data-em]").click();
  // --- Papierkorb: Gelöschtes lässt sich zurückholen ---
  tab("aufgaben");
  const pkVorher = (S("papierkorb") || []).length, todosVorher = S("todos").length;
  d.querySelector('[data-del-todo="' + S("todos")[0].id + '"]').click();
  check("Aufgabe gelöscht", S("todos").length === todosVorher - 1);
  const pk = S("papierkorb");
  check("Aufgabe liegt im Papierkorb", pk.length === pkVorher + 1
    && pk[pk.length - 1].art === "todos" && pk[pk.length - 1].titel === "Öl nachfüllen");
  tab("mehr");
  d.querySelector('[data-pk-zurueck="' + pk[pk.length - 1].id + '"]').click();
  check("Aufgabe zurückgeholt", S("todos").some(t => t.text === "Öl nachfüllen"));
  check("Papierkorb-Eintrag verbraucht", S("papierkorb").length === pkVorher);

  // --- Zwei Geräte: Sicherung zusammenführen statt überschreiben ---
  const fremd = {
    version: 1,
    entries: [
      { id: "fremd-1", machine: "Z67", status: "umbau", note: "von friedl", benutzer: "friedl", created_at: "31.12.2026 06:10" },
      { id: "fremd-alt", machine: "Z68", status: "umbau", note: "uralt von friedl", benutzer: "friedl", created_at: "01.01.2020 06:10" },
    ],
    rezepte: [{ id: "fremd-r", kuerzel: "CuSn", aufbau: "12×0,040", formular: "1350", soll: {},
                historie: [], benutzer: "friedl", created_at: "05.08.2026 06:00", geaendert_am: "05.08.2026 06:00" }],
    maschinen: ["Z49", "Z95"],
    todos: [], spulen: [], ruestungen: [], notloesungen: [],
  };
  const eigeneEintraege = S("entries").length, eigeneMuster = S("rezepte").length;
  w.eval("0");   // nur damit klar ist: der Import läuft über die Oberfläche
  const datei = new w.File([JSON.stringify(fremd)], "sicherung.json", { type: "application/json" });
  const feld = d.getElementById("import-file");
  Object.defineProperty(feld, "files", { value: [datei], configurable: true });
  d.querySelector("[data-import]").click();
  await warte(120);
  check("fremde Einträge kommen dazu", S("entries").length === eigeneEintraege + 2
    && S("entries").some(e => e.note === "von friedl"));
  check("eigene Einträge bleiben", S("entries").length > 1);
  check("fremdes Muster kommt dazu", S("rezepte").length === eigeneMuster + 1);
  check("eigenes Muster unverändert", S("rezepte").some(r => r.kuerzel === "VSW"
    && r.soll["Ziehgeschwindigkeit"] === "21"));
  check("neue Maschine übernommen", S("maschinen").indexOf("Z95") !== -1);
  check("vorhandene Maschine nicht doppelt", S("maschinen").filter(m => m === "Z49").length === 1);

  // dieselbe Datei nochmal einlesen ändert nichts
  const standVorher = JSON.stringify(S("entries"));
  Object.defineProperty(feld, "files", { value: [datei], configurable: true });
  d.querySelector("[data-import]").click();
  await warte(120);
  check("zweiter Import erzeugt keine Dubletten", JSON.stringify(S("entries")) === standVorher);

  // --- Übergabe: was seit der letzten Schicht dazukam ---
  tab("maschinen");
  check("neuer fremder Eintrag steht unter Neu", d.querySelectorAll(".neu-eintrag").length === 1
    && d.querySelector(".neu-eintrag").textContent.indexOf("von friedl") !== -1);
  check("alter fremder Eintrag gilt nicht als neu",
    !Array.from(d.querySelectorAll(".neu-eintrag")).some(x => x.textContent.indexOf("uralt") !== -1));
  check("Zähler stimmt", d.getElementById("inhalt").textContent.indexOf("Seit deiner letzten Schicht") !== -1);

  tab("erstmuster");
  d.querySelector('[data-em="' + S("rezepte").find(r => r.kuerzel === "VSW").id + '"]').click();
  check("Seite 2 zeigt die Änderung seit dem Versand",
    d.getElementById("inhalt").textContent.indexOf("Kommt beim Versand auf Seite 2") !== -1
    && d.getElementById("inhalt").innerHTML.indexOf("21") !== -1);

  // --- Erstmuster-Formulare: Auswahl bestimmt die abgefragten Werte ---
  tab("erstmuster");
  d.querySelector("[data-rezept-neu]").click();
  d.querySelector("[data-wiz-leer]").click();
  check("drei Formulare zur Auswahl", d.querySelectorAll(".formwahl").length === 3);
  check("Standard ist 1350", d.querySelector('.formwahl[data-formular="1350"]').classList.contains("aktiv"));
  // 1341 hat nur einen Ziehen-Wert, 1350 hat elf
  weiter(); weiter();
  const felder1350 = d.querySelectorAll(".wfeld").length;
  d.querySelector("[data-wiz-zurueck]").click();
  d.querySelector("[data-wiz-zurueck]").click();
  d.querySelector('.formwahl[data-formular="1341"]').click();
  check("Formular 1341 ausgewählt", d.querySelector('.formwahl[data-formular="1341"]').classList.contains("aktiv"));
  weiter(); weiter();
  check("1341 fragt weniger Ziehen-Werte ab als 1350", d.querySelectorAll(".wfeld").length < felder1350);
  check("1341 fragt Ziehgeschwindigkeit + Skala", d.getElementById("inhalt").innerHTML.indexOf("Ziehgeschwindigkeit + Skala") !== -1);
  // VA-Formular hat eigene Felder (Fettgehalt)
  d.querySelector("[data-wiz-zurueck]").click();
  d.querySelector("[data-wiz-zurueck]").click();
  d.querySelector('.formwahl[data-formular="va013f3"]').click();
  stamm({ kuerzel: "TEST-VA", aufbau: "1x0,40" });
  weiter();
  check("VA: erste Gruppe heißt Maschine", d.getElementById("inhalt").innerHTML.indexOf("Maschine</h2>") !== -1);
  weiter(); weiter(); weiter();
  check("VA: letzte Gruppe ist Fettgehalt", d.getElementById("inhalt").innerHTML.indexOf("Fettgehalt Modul 1") !== -1);
  weiter();   // speichern
  const va = S("rezepte").find(r => r.kuerzel === "TEST-VA");
  check("Formular wird mitgespeichert", va && va.formular === "va013f3");
  check("Liste zeigt den Formularnamen", d.getElementById("inhalt").innerHTML.indexOf("Drahtzug allgemein") !== -1);

  // --- Vorschlagsknöpfe: übliche Werte, aber alles überschreibbar ---
  tab("erstmuster");
  d.querySelector("[data-rezept-neu]").click();
  d.querySelector("[data-wiz-leer]").click();
  stamm({ kuerzel: "DROP", aufbau: "1x1" });
  weiter(); weiter(); weiter(); weiter();      // -> Spuler
  check("Verlegung: Knopf Hand vorhanden", d.querySelector('[data-wiz-wert="Verlegung Hand/Automatik"][data-wert="Hand"]') !== null);
  check("Verlegung: Knopf Automatik vorhanden", d.querySelector('[data-wiz-wert="Verlegung Hand/Automatik"][data-wert="Automatik"]') !== null);
  check("Spulengröße: 250/350/560 als Knöpfe", d.querySelector('[data-wiz-wert="Spulengröße"][data-wert="350"]') !== null);
  check("Maschinentyp Spuler ist ein Feld (nicht fest)", d.querySelector('[data-wiz-wert="Maschinentyp Spuler"]') !== null);
  d.querySelector('[data-wiz-wert="Verlegung Hand/Automatik"][data-wert="Automatik"]').click();
  weiter();                                     // speichern
  const drop = S("rezepte").find(r => r.kuerzel === "DROP");
  check("Auswahl wurde gespeichert", drop && drop.soll["Verlegung Hand/Automatik"] === "Automatik");

  // Angaben wie Maschinentyp stehen nicht in der Rüst-Checkliste
  d.querySelector("[data-em]").click();              // neuestes Muster (DROP) öffnen
  d.querySelector("[data-rezept-bearbeiten]").click();
  weiter(); weiter(); weiter();                 // Draht-Typ -> Ablauf -> Ziehen -> Glühe
  const kssKnopf = d.querySelector('[data-wiz-wert="KSS-Produkt Glühe"]');
  check("KSS-Produkt Glühe hat den üblichen Wert als Knopf", kssKnopf !== null && kssKnopf.dataset.wert.indexOf("Bechem") !== -1);
  kssKnopf.click();
  weiter(); weiter();                           // Spuler, dann Fertig
  const drop2 = S("rezepte").find(r => r.kuerzel === "DROP");
  check("KSS-Produkt gespeichert", drop2.soll["KSS-Produkt Glühe"].indexOf("Bechem") !== -1);
  // Checkliste liegt im Rüsten-Bereich
  tab("ruesten");
  d.querySelector("[data-rezept]").click();
  const namen = Array.from(d.querySelectorAll(".rpunkt .p-name")).map(e => e.textContent);
  check("Checkliste zeigt Einstellwert (Verlegung)", namen.indexOf("Verlegung Hand/Automatik") !== -1);
  check("Checkliste zeigt keine Angaben (KSS-Produkt)", namen.indexOf("KSS-Produkt Glühe") === -1);

  // --- Vom Blatt: erkannter Text wird den Feldern zugeordnet ---
  tab("erstmuster");
  d.querySelector("[data-rezept-neu]").click();
  check("Start bietet das Blatt an", d.querySelector("[data-wiz-blatt]") !== null);
  d.querySelector("[data-wiz-blatt]").click();
  check("Blatt-Seite hat Foto und Textfeld",
    d.getElementById("foto-blatt-kamera") !== null && d.getElementById("blatt-text") !== null);
  // Bild darf auch aus der Fotos-App kommen: dieses Feld zwingt nicht zur Kamera
  check("Blatt: Foto vom Handy ist wählbar",
    d.getElementById("foto-blatt-datei") !== null &&
    !d.getElementById("foto-blatt-datei").hasAttribute("capture") &&
    d.getElementById("foto-blatt-kamera").getAttribute("capture") === "environment");
  check("Blatt: beide Knöpfe zeigen auf ihr Feld",
    d.querySelector('[data-foto-quelle="foto-blatt-kamera"]') !== null &&
    d.querySelector('[data-foto-quelle="foto-blatt-datei"]') !== null);
  // der Knopf muss das Dateifeld auch wirklich öffnen
  let geoeffnet = [];
  ["foto-blatt-kamera", "foto-blatt-datei"].forEach(id => {
    d.getElementById(id).addEventListener("click", ev => { geoeffnet.push(id); ev.preventDefault(); });
    d.querySelector(`[data-foto-quelle="${id}"]`).click();
  });
  check("Blatt: Knopf öffnet Kamera bzw. Fotoauswahl",
    geoeffnet.length === 2 && geoeffnet[0] === "foto-blatt-kamera" && geoeffnet[1] === "foto-blatt-datei");
  // so unsauber, wie die Texterkennung vom Papier liefert
  setVal(d.getElementById("blatt-text"), [
    "Erstmusterprüfung Feinzug 2",
    "BLT 6x0,050 versilbert weich",
    "Maschine Z49",
    "Auftrag 18034",
    "Ziehgeschwindigkeit 16",
    "Glühfaktor 1,15",
    "Glühspannung",
    "22",
    "KSS-Ventil 2 45",
    "Verlegung Hand/Automatik: Automatik",
    "Spulengröße 350",
    "gez. Müller 12.08.",
  ].join("\n"));
  d.querySelector("[data-blatt-lesen]").click();
  const blZeile = name => Array.from(d.querySelectorAll(".bl-zeile"))
    .find(z => z.querySelector(".bl-name").textContent.trim().indexOf(name) === 0);
  const blWert = name => { const z = blZeile(name); return z ? z.querySelector(".bl-wert").value : null; };
  check("Blatt: Kurzbezeichnung und Aufbau erkannt", blWert("Kurzbezeichnung") === "BLT" && blWert("Aufbau") === "6x0,050");
  check("Blatt: Maschine und Auftrag erkannt", blWert("Maschine") === "Z49" && blWert("Auftrag") === "18034");
  check("Blatt: Zahlenwerte erkannt", blWert("Ziehgeschwindigkeit") === "16" && blWert("Glühfaktor") === "1,15");
  check("Blatt: Wert in der nächsten Zeile gehört dazu", blWert("Glühspannung") === "22");
  check("Blatt: KSS-Ventil 2 trifft nicht KSS-Ventil 1", blWert("KSS-Ventil 2") === "45" && blZeile("KSS-Ventil 1") == null);
  check("Blatt: Auswahlwert statt Zahl", blWert("Verlegung Hand/Automatik") === "Automatik");
  check("Blatt: nichts wird ohne Haken übernommen",
    Array.from(d.querySelectorAll(".bl-an")).every(a => a.checked));
  check("Blatt: unpassende Zeile geht nicht verloren",
    d.querySelector(".bl-rest").textContent.indexOf("Müller") !== -1);
  // Spulengröße abwählen: sie darf dann nicht im Muster landen
  blZeile("Spulengröße").querySelector(".bl-an").checked = false;
  d.querySelector("[data-blatt-uebernehmen]").click();
  check("Blatt: Übernehmen führt in die Schritte", d.querySelectorAll(".wpunkt").length === 5);
  check("Blatt: Stammdaten stehen im Schritt", d.querySelector('.wiz-stamm[data-stamm="kuerzel"]').value === "BLT");
  weiter(); weiter(); weiter(); weiter(); weiter();
  const blt = S("rezepte").find(r => r.kuerzel === "BLT");
  check("Blatt: Muster gespeichert", !!blt && blt.aufbau === "6x0,050" && blt.maschine === "Z49");
  check("Blatt: Werte gespeichert",
    blt.soll["Ziehgeschwindigkeit"] === "16" && blt.soll["Glühfaktor"] === "1,15" && blt.soll["KSS-Ventil 2"] === "45");
  check("Blatt: Abgewähltes bleibt leer", !blt.soll["Spulengröße"]);
  check("Blatt: Auftrag übernommen", blt.beispiel_auftrag === "18034");

  // --- Erstmuster senden: Knopf sitzt im Erstmuster-Bereich ---
  tab("erstmuster");
  d.querySelector("[data-em]").click();
  const senden = d.querySelector("[data-erstmuster]");
  check("Knopf 'Erstmuster senden' in der Erstmuster-Ansicht", senden !== null && senden.textContent.indexOf("Erstmuster") !== -1);
  check("Prüfkarte: Kamera und Foto vom Handy stehen zur Wahl",
    d.getElementById("foto-pk-kamera") !== null &&
    !d.getElementById("foto-pk-datei").hasAttribute("capture") &&
    d.getElementById("foto-pk-datei").dataset.id === d.getElementById("foto-pk-kamera").dataset.id);
  let pkAuf = false;
  d.getElementById("foto-pk-datei").addEventListener("click", ev => { pkAuf = true; ev.preventDefault(); });
  d.querySelector('[data-foto-quelle="foto-pk-datei"]').click();
  check("Prüfkarte: Knopf öffnet die Fotoauswahl", pkAuf);
  let geteilt = null;
  w.navigator.canShare = () => true;
  w.navigator.share = o => { geteilt = o; return Promise.resolve(); };
  senden.click();
  await warte(150);
  check("Klick erzeugt ein PDF und öffnet das Teilen", geteilt !== null);
  check("PDF hat sinnvollen Dateinamen", geteilt && /^Erstmuster_.*\.pdf$/.test(geteilt.files[0].name));
  check("Datei ist als PDF gekennzeichnet", geteilt && geteilt.files[0].type === "application/pdf");
  check("Begleittext nennt Muster und Formular", geteilt
    && geteilt.text.indexOf("Erstmuster") !== -1 && geteilt.text.indexOf("Formular:") !== -1);

  // --- Fehler melden: automatische Erfassung, kein Absturz beim Tippen ---
  tab("spulen");
  setVal(d.getElementById("sp-g"), "1,15");
  // Fehlerliste leeren, um sauber zu messen
  const v = JSON.parse(w.localStorage.getItem("sue_vault")); v.fehler = [];
  w.localStorage.setItem("sue_vault", JSON.stringify(v));
  d.getElementById("fehler-knopf").click();
  check("Fehler-Ansicht offen", d.getElementById("kopf-titel").textContent === "Fehler melden");
  check("erfasst Ansicht und Eingaben", d.getElementById("inhalt").innerHTML.indexOf("Automatisch erfasst") !== -1
    && d.getElementById("inhalt").innerHTML.indexOf("1,15") !== -1);
  check("drei Versandwege", d.querySelector("[data-fehler-senden]") && d.querySelector("[data-fehler-teilen]") && d.querySelector("[data-fehler-kopieren]"));
  const ft = d.getElementById("f-text");
  "Testeingabe".split("").forEach(c => { ft.value += c; ft.dispatchEvent(new w.Event("input", { bubbles: true })); });
  await warte(30);
  check("Tippen im Fehler-Formular erzeugt keine Programmfehler", (S("fehler") || []).length === 0);
  // Kopieren
  let kopiert = null;
  w.navigator.clipboard = { writeText: t => { kopiert = t; return Promise.resolve(); } };
  d.querySelector("[data-fehler-kopieren]").click();
  await warte(30);
  check("Bericht enthält Zieladresse und Benutzer",
    kopiert && kopiert.indexOf("tigga232332@gmail.com") !== -1 && kopiert.indexOf("güntzel") !== -1);
  tab("aufgaben");
  check("Tab-Wechsel verlässt Fehler-Ansicht", d.getElementById("kopf-titel").textContent === "Aufgaben");

  // --- Kontrolle mitten in der Schicht ---
  tab("maschinen");
  d.querySelector('[data-maschine="Z49"]').click();
  const nlVorher = S("notloesungen").length, ruestVorher = S("ruestungen").length;
  d.querySelector("[data-kontrolle]").click();
  check("Kontroll-Maske zeigt die Soll-Werte", d.querySelectorAll("[data-kist]").length >= 1
    && d.getElementById("inhalt").textContent.indexOf("VSW") !== -1);
  setVal(d.querySelector('[data-kist="Ziehgeschwindigkeit"]'), "19");   // Soll steht auf 21
  d.querySelector("[data-kontrolle-speichern]").click();
  check("Kontrolle im Verlauf", S("ruestungen").length === ruestVorher + 1
    && S("ruestungen")[S("ruestungen").length - 1].art === "kontrolle");
  check("Kontrolle merkt sich die Maschine", S("ruestungen")[S("ruestungen").length - 1].maschine === "Z49");
  check("Abweichung wird auch bei der Kontrolle abgefragt", d.querySelectorAll(".abw-zeile").length === 1);
  d.querySelector("[data-abw-notloesung]").click();
  d.querySelector("[data-abw-ohne-grund]").click();
  check("Notlösung aus der Kontrolle gespeichert", S("notloesungen").length === nlVorher + 1
    && S("notloesungen")[S("notloesungen").length - 1].maschine === "Z49");
  check("laufende Maschine zeigt den geprüften Wert", S("laufend").Z49.ist["Ziehgeschwindigkeit"].wert === "19");
  check("Prüfzeitpunkt vermerkt", !!S("laufend").Z49.geprueft);
  check("Karte nennt die letzte Prüfung",
    d.querySelector(".karte.laufend").textContent.indexOf("zuletzt geprüft") !== -1);

  // --- Auftrag verbindet Berechnung, Maschine und laufenden Draht ---
  check("laufende Maschine zeigt die Berechnung zum Auftrag",
    d.querySelector(".lauf-auftrag") !== null
    && d.querySelector(".lauf-auftrag").textContent.indexOf("20 Spulen") !== -1);
  tab("spulen");
  check("Berechnung zeigt, auf welcher Maschine der Auftrag läuft",
    d.getElementById("spulen-liste").innerHTML.indexOf("läuft auf Z49") !== -1);

  // --- Suche über alles ---
  tab("mehr");
  setVal(d.getElementById("alle-suche"), "1");
  check("zu kurze Suche wird abgefangen",
    d.getElementById("such-ergebnis").textContent.indexOf("zwei Zeichen") !== -1);
  setVal(d.getElementById("alle-suche"), "18034");
  const treffer = d.getElementById("such-ergebnis");
  check("Suche findet das Erstmuster", treffer.innerHTML.indexOf("VSW") !== -1);
  check("Suche findet die Berechnung", treffer.textContent.indexOf("Auftrag 18034") !== -1);
  setVal(d.getElementById("alle-suche"), "Ziehgeschwindigkeit");
  check("Suche findet Notlösungen",
    d.getElementById("such-ergebnis").textContent.indexOf("Notlösungen") !== -1);
  setVal(d.getElementById("alle-suche"), "Riss an Kopf");
  check("Suche findet Notizen", d.getElementById("such-ergebnis").textContent.indexOf("Notizen") !== -1);
  d.querySelector("[data-such-maschine]").click();
  check("Treffer springt zur Maschine", d.getElementById("kopf-titel").textContent === "Z49");
  tab("mehr");
  setVal(d.getElementById("alle-suche"), "gibtsnichtxyz");
  check("Suche ohne Treffer sagt das",
    d.getElementById("such-ergebnis").textContent.indexOf("Nichts gefunden") !== -1);

  return check.ergebnis();
};
