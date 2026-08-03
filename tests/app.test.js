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
  tab("maschinen");
  check("Kachel Z49 jetzt rot", d.querySelector('[data-maschine="Z49"]').classList.contains("bg-red"));

  // --- Aufgaben ---
  tab("aufgaben");
  d.getElementById("todo-text").value = "Öl nachfüllen";
  d.getElementById("todo-maschine").value = "Z67";
  d.querySelector("[data-add-todo]").click();
  check("Aufgabe gespeichert", S("todos")[0].text === "Öl nachfüllen" && S("todos")[0].machine === "Z67");
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

  // --- Rüsten: Assistent, Checkliste, Versionierung ---
  tab("ruesten");
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
  stamm({ kuerzel: "VSW", aufbau: "6x0,050", klartext: "versilbert weich", maschine: "Z49" });
  weiter(); weiter();                       // -> Ziehen
  wizWert("Ziehgeschwindigkeit", "18");
  weiter(); weiter(); weiter();             // Glühe, Spuler, Fertig
  check("Muster gespeichert", S("rezepte").length === 1 && S("rezepte")[0].kuerzel === "VSW");
  check("Muster trägt Benutzer", S("rezepte")[0].benutzer === "güntzel");

  setVal(d.getElementById("ruest-suche"), "VSW");
  check("Muster-Suche findet VSW", d.getElementById("ruest-liste").innerHTML.indexOf("VSW") !== -1);
  setVal(d.getElementById("ruest-suche"), "");

  d.querySelector("[data-rezept]").click();
  check("Checkliste zeigt 1 Punkt", d.querySelectorAll(".rpunkt").length === 1);
  check("Zeile hat Name, Soll und Ist-Feld",
    d.querySelector(".rpunkt .p-name") && d.querySelector(".rpunkt .p-soll b") && d.querySelector(".rpunkt .p-body .p-ist"));
  d.querySelector(".rpunkt").click();
  check("Punkt abgehakt", Object.values(S("rezepte")[0].ruest_status).some(s => s.erledigt));
  const ist = d.querySelector(".p-ist");
  setVal(ist, "17,5");
  check("Ist-Wert gespeichert", JSON.stringify(S("rezepte")[0].ruest_status).indexOf("17,5") !== -1);
  d.querySelector("[data-ruest-abschluss]").click();
  check("Rüstung im Verlauf", S("ruestungen").length === 1 && S("ruestungen")[0].benutzer === "güntzel");

  // Änderung erzeugt eine Version (Checkliste ist nach dem Abschluss weiter offen)
  d.querySelector("[data-rezept-bearbeiten]").click();
  weiter(); weiter();
  wizWert("Ziehgeschwindigkeit", "20");
  weiter(); weiter(); weiter();
  check("Änderung erzeugt Historie", (S("rezepte")[0].historie || []).length === 1);
  check("Historie bewahrt alten Wert", S("rezepte")[0].historie[0].soll["Ziehgeschwindigkeit"] === "18");
  d.querySelector("[data-vergleich]").click();
  check("Vergleich zeigt alt -> neu", d.getElementById("inhalt").innerHTML.indexOf("18") !== -1
    && d.getElementById("inhalt").innerHTML.indexOf("20") !== -1);

  // --- Erstmuster-Formulare: Auswahl bestimmt die abgefragten Werte ---
  tab("ruesten");
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

  // --- Erstmuster senden: Knopf vorhanden und erzeugt ein PDF zum Teilen ---
  tab("ruesten");
  d.querySelector("[data-rezept]").click();
  const senden = d.querySelector("[data-erstmuster]");
  check("Knopf 'Erstmuster senden' in der Muster-Ansicht", senden !== null && senden.textContent.indexOf("Erstmuster") !== -1);
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

  return check.ergebnis();
};
