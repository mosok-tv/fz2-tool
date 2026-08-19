// Verschlüsselung, Sperre, Anmeldung
const { starteApp, pruefer, werkzeuge, warte } = require("./helfer");
const { webcrypto } = require("crypto");

const warteBis = async (fn, max = 80) => { for (let i = 0; i < max; i++) { if (fn()) return true; await warte(25); } return false; };
const lsDump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };

async function login(w, name = "güntzel") {
  const d = w.document;
  await warte(80);
  if (!d.getElementById("login").hidden) {
    d.getElementById("login-name").value = name;
    d.getElementById("login-pw").value = "1234";
    d.getElementById("login-ok").click();
    await warte(100);
  }
}

module.exports = async function () {
  const check = pruefer();

  // --- Krypto-Grundlagen: verschlüsseln, entschlüsseln, falscher Code ---
  const enc = new TextEncoder();
  async function key(code, salt) {
    const mat = await webcrypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
    return webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      mat, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  const salt = webcrypto.getRandomValues(new Uint8Array(16)), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const k = await key("1234", salt);
  const geheim = JSON.stringify({ notiz: "GEHEIM Drahtriss" });
  const chiffre = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(geheim));
  const klar = new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, k, chiffre));
  check("Krypto: entschlüsselt == original", klar === geheim);
  let scheiterte = false;
  try { await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, await key("9999", salt), chiffre); }
  catch (e) { scheiterte = true; }
  check("Krypto: falscher Code scheitert", scheiterte);

  // --- Verschlüsselung in der App ---
  let w = starteApp(); let d = w.document;
  await login(w);
  d.querySelector('[data-maschine="Z49"]').click();
  d.querySelector('[data-status="drahtriss"]').click();
  d.getElementById("notiz").value = "GEHEIM Kopf 3";
  d.querySelector("[data-speichern-eintrag]").click();
  d.querySelector('.tab[data-view="mehr"]').click();
  d.getElementById("code-neu").value = "1234";
  d.querySelector("[data-code-setzen]").click();
  await warteBis(() => w.localStorage.getItem("sue_vault_enc"));
  check("Code setzen verschlüsselt den Speicher", !!w.localStorage.getItem("sue_vault_enc"));
  check("unverschlüsselter Speicher entfernt", !w.localStorage.getItem("sue_vault"));
  check("kein Klartext mehr auffindbar", JSON.stringify(lsDump(w)).indexOf("GEHEIM") === -1);
  const verschluesselt = lsDump(w);

  // --- Neustart: Sperre, falscher und richtiger Code ---
  w = starteApp(null, verschluesselt); d = w.document;
  await warte(60);
  check("Neustart: Sperrbildschirm", d.getElementById("sperre").hidden === false);
  check("Neustart: App blockiert", d.getElementById("inhalt").innerHTML.indexOf("Maschinen-Status") === -1);
  d.getElementById("sperre-code").value = "0000";
  d.getElementById("sperre-ok").click();
  await warte(200);
  check("falscher Code bleibt gesperrt", d.getElementById("sperre").hidden === false);
  d.getElementById("sperre-code").value = "1234";
  d.getElementById("sperre-ok").click();
  await warteBis(() => d.getElementById("sperre").hidden === true);
  check("richtiger Code entsperrt", d.getElementById("sperre").hidden === true);
  await login(w);
  check("Daten nach Entschlüsselung wieder da", d.getElementById("inhalt").innerHTML.indexOf("GEHEIM Kopf 3") !== -1);

  // --- Durchprobieren wird ausgebremst ---
  w = starteApp(null, verschluesselt); d = w.document;
  await warte(60);
  for (let i = 0; i < 4; i++) {
    d.getElementById("sperre-code").value = "0000";
    d.getElementById("sperre-ok").click();
    await warte(150);
  }
  check("nach 4 Fehlversuchen noch offen", d.getElementById("sperre-ok").disabled === false);
  check("Restversuche werden genannt", d.getElementById("sperre-fehler").textContent.indexOf("Noch 1 Versuch") !== -1);
  d.getElementById("sperre-code").value = "0000";
  d.getElementById("sperre-ok").click();
  await warte(200);
  check("nach 5 Fehlversuchen gesperrt", d.getElementById("sperre-ok").disabled === true);
  check("Wartezeit wird angezeigt", d.getElementById("sperre-fehler").textContent.indexOf("Fehlversuche") !== -1);
  check("Zähler überlebt den Neustart", w.localStorage.getItem("dz_sperre_fehl") === "5");
  // auch mit richtigem Code kommt jetzt niemand rein
  d.getElementById("sperre-code").value = "1234";
  d.getElementById("sperre-ok").click();
  await warte(200);
  check("richtiger Code hilft während der Wartezeit nicht", d.getElementById("sperre").hidden === false);
  // Wartezeit abgelaufen -> der Knopf geht von selbst wieder auf
  w.localStorage.setItem("dz_sperre_bis", "0");
  await warteBis(() => d.getElementById("sperre-ok").disabled === false, 80);
  check("Knopf geht nach Ablauf von selbst wieder auf", d.getElementById("sperre-ok").disabled === false);
  d.getElementById("sperre-code").value = "1234";
  d.getElementById("sperre-ok").click();
  await warteBis(() => d.getElementById("sperre").hidden === true);
  check("nach der Wartezeit entsperrt der richtige Code", d.getElementById("sperre").hidden === true);
  check("Zähler nach Erfolg zurückgesetzt", !w.localStorage.getItem("dz_sperre_fehl"));

  // --- Code merken: die App entsperrt sich beim Start selbst ---
  w = starteApp(null, verschluesselt); d = w.document;
  await warte(60);
  check("Sperrbildschirm hat den Merken-Haken", !!d.getElementById("sperre-merken"));
  d.getElementById("sperre-merken").checked = true;
  d.getElementById("sperre-code").value = "1234";
  d.getElementById("sperre-ok").click();
  await warteBis(() => d.getElementById("sperre").hidden === true);
  check("Code wird gemerkt", w.localStorage.getItem("dz_code_gemerkt") === "1234");
  const gemerkt = lsDump(w);
  check("Daten bleiben trotzdem verschlüsselt", !!gemerkt["sue_vault_enc"] && !gemerkt["sue_vault"]);

  w = starteApp(null, gemerkt); d = w.document;
  await warteBis(() => d.getElementById("sperre").hidden === true);
  check("Neustart: kein Sperrbildschirm mehr", d.getElementById("sperre").hidden === true);
  await login(w);
  check("Neustart: Daten sind da", d.getElementById("inhalt").innerHTML.indexOf("GEHEIM Kopf 3") !== -1);

  // Schalter unter Mehr legt die Abfrage wieder an
  d.querySelector('.tab[data-view="mehr"]').click();
  check("Schalter zeigt AUS", d.querySelector("[data-code-fragen]").textContent.indexOf("AUS") !== -1);
  d.querySelector("[data-code-fragen]").click();
  await warte(60);
  check("Schalter löscht den gemerkten Code", !w.localStorage.getItem("dz_code_gemerkt"));
  check("Schalter zeigt wieder AN", d.querySelector("[data-code-fragen]").textContent.indexOf("AN") !== -1);
  const wiederFragen = lsDump(w);
  w = starteApp(null, wiederFragen); d = w.document;
  await warte(80);
  check("danach fragt der Start wieder nach dem Code", d.getElementById("sperre").hidden === false);

  // passt der gemerkte Code nicht mehr, wird trotzdem gefragt statt abgestürzt
  const falschGemerkt = Object.assign({}, gemerkt, { dz_code_gemerkt: "0000" });
  w = starteApp(null, falschGemerkt); d = w.document;
  await warte(150);
  check("falscher gemerkter Code führt zurück zur Abfrage", d.getElementById("sperre").hidden === false);
  check("falscher gemerkter Code wird verworfen", !w.localStorage.getItem("dz_code_gemerkt"));

  // --- Anmeldung ---
  w = starteApp({ benutzer: [{ name: "friedl", pw: "x" }], angemeldet: "" }); d = w.document;
  await warte(120);
  check("nicht angemeldet: Login sichtbar", d.getElementById("login").hidden === false);
  check("nicht angemeldet: App blockiert", d.getElementById("inhalt").innerHTML.indexOf("Maschinen-Status") === -1);

  // friedl kann sich anmelden
  w = starteApp(); d = w.document;
  await warte(120);
  d.getElementById("login-name").value = "friedl";
  d.getElementById("login-pw").value = "falsch";
  d.getElementById("login-ok").click();
  await warte(100);
  check("falsches Passwort abgewiesen", d.getElementById("login").hidden === false);
  d.getElementById("login-pw").value = "1234";
  d.getElementById("login-ok").click();
  await warte(100);
  const { S } = werkzeuge(w);
  check("friedl/1234 meldet sich an", d.getElementById("login").hidden === true && S("angemeldet") === "friedl");

  // --- Fremde Sicherungsdatei darf keinen Code einschleusen ---
  // Eine .json zum "Zusammenführen" kommt von außen. Landet ihr Inhalt ungeprüft
  // im HTML, führt das Öffnen einer Kachel fremden Code aus.
  w = starteApp({ maschinen: ['x" data-boese="ja', "<img src=x onerror=1>"] }); d = w.document;
  await login(w);
  await warte(120);
  check("Maschinenname bricht nicht aus dem Attribut aus",
    d.querySelector('[data-boese="ja"]') === null);
  check("Maschinenname wird nicht als HTML gedeutet",
    d.querySelector(".kopf-kachel img") === null);

  // Detailansicht: hier stand der Name früher ungeprüft per innerHTML
  const kachel = d.querySelector(".kopf-kachel");
  kachel.click();
  await warte(80);
  check("Maschinen-Überschrift deutet HTML nicht",
    d.getElementById("kopf-titel").querySelector("*") === null &&
    d.getElementById("kopf-titel").textContent.indexOf('data-boese') !== -1);

  // Importfilter: solche Namen sollen gar nicht erst gespeichert werden.
  // Läuft über die echte Oberfläche – Datei wählen, „Zusammenführen" drücken.
  w = starteApp({ maschinen: ["Z49"] }); d = w.document;
  await login(w);
  await warte(120);
  d.querySelector('.tab[data-view="mehr"]').click();
  await warte(60);
  const datei = new w.File(
    [JSON.stringify({ maschinen: ["<svg onload=1>", "  Z68  ", "x".repeat(40)] })],
    "sicherung.json", { type: "application/json" });
  const feld = d.getElementById("import-file");
  Object.defineProperty(feld, "files", { value: [datei], configurable: true });
  d.querySelector("[data-import]").click();
  const { S: S2 } = werkzeuge(w);
  await warteBis(() => (S2("maschinen") || []).length > 1);
  const nachImport = S2("maschinen");
  check("Import entfernt gefährliche Zeichen aus Maschinennamen",
    nachImport.every(m => !/[<>"'&]/.test(m)));
  check("Import kürzt zu lange Maschinennamen auf 20 Zeichen",
    nachImport.every(m => m.length <= 20));
  check("harmloser Maschinenname kommt sauber durch", nachImport.indexOf("Z68") !== -1);

  // --- Bild aus fremder Datei darf kein Attribut aufbrechen ---
  w = starteApp({ rezepte: [{ id: "r1", nummer: "1350", kuerzel: "VSW",
    blatt: 'x" onerror="boese()', geaendert_am: "01.01.2026 08:00" }] }); d = w.document;
  await login(w);
  await warte(120);
  d.querySelector('.tab[data-view="erstmuster"]').click();
  await warte(60);
  d.querySelector('[data-em]').click();
  await warte(80);
  const bild = d.querySelector(".pk-bild");
  check("gefälschte Bildquelle wird verworfen",
    !bild || (!bild.hasAttribute("onerror") && bild.getAttribute("src") === ""));

  // echtes Bild muss weiterhin durchkommen
  w = starteApp({ rezepte: [{ id: "r1", nummer: "1350", kuerzel: "VSW",
    blatt: "data:image/jpeg;base64,AAAA", geaendert_am: "01.01.2026 08:00" }] }); d = w.document;
  await login(w);
  await warte(120);
  d.querySelector('.tab[data-view="erstmuster"]').click();
  await warte(60);
  d.querySelector('[data-em]').click();
  await warte(80);
  check("echtes Foto wird weiterhin angezeigt",
    d.querySelector(".pk-bild").getAttribute("src") === "data:image/jpeg;base64,AAAA");

  // --- Voller Gerätespeicher darf nicht stillschweigend Daten verschlucken ---
  // Sonst steht "gespeichert" auf dem Schirm und beim nächsten Start ist die Schicht weg.
  w = starteApp(); d = w.document;
  await login(w);
  await warte(120);
  let gewarnt = "";
  w.alert = t => { gewarnt = String(t); };
  const echtesSetItem = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (k, v) {
    if (k === "sue_vault") { const e = new Error("voll"); e.name = "QuotaExceededError"; throw e; }
    return echtesSetItem.call(this, k, v);
  };
  d.querySelector('[data-maschine="Z49"]').click();
  await warte(60);
  d.querySelector('[data-status="drahtriss"]').click();
  d.getElementById("notiz").value = "Speicher voll Test";
  d.querySelector("[data-speichern-eintrag]").click();
  await warte(150);
  w.Storage.prototype.setItem = echtesSetItem;
  check("voller Speicher wird dem Nutzer gemeldet", gewarnt.indexOf("NICHT gespeichert") !== -1);
  d.querySelector('.tab[data-view="maschinen"]').click();
  await warte(80);
  check("App läuft nach vollem Speicher weiter", d.querySelector(".kopf-kachel") !== null);

  return check.ergebnis();
};
