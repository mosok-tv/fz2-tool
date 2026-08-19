// Prüft, dass jeder Knopf auch am Handler hängt.
// Anlass: der Klick-Handler sucht sein Element über eine feste Selektor-Liste
// (closest("[data-a],[data-b],...")). Stand ein neues data-Attribut nicht drin,
// war der Knopf stumm – ohne Fehlermeldung, ohne dass ein Test es merkte.
const fs = require("fs");
const path = require("path");
const { pruefer } = require("./helfer");

module.exports = async function () {
  const check = pruefer();
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  const klick = app.match(/document\.addEventListener\("click"[\s\S]*?closest\("([^"]+)"\)/);
  const liste = (klick[1].match(/\[data-([a-z-]+)\]/g) || []).map(s => s.slice(6, -1));
  const inListe = new Set(liste.map(camel));

  // Zweige der else-if-Kette im Klick-Handler
  const von = app.indexOf('document.addEventListener("click"');
  const bis = app.indexOf('document.addEventListener("input"');
  const zweige = new Set();
  app.slice(von, bis).replace(/el\.dataset\.([A-Za-z]+)/g, (_, n) => { zweige.add(n); return ""; });

  // 1) Kein Eintrag ohne Zweig: der Klick träfe ins Leere
  const ohneZweig = liste.filter(n => !zweige.has(camel(n)));
  check("jeder Selektor im Klick-Handler hat einen Zweig" + (ohneZweig.length ? " (" + ohneZweig.join(", ") + ")" : ""),
    ohneZweig.length === 0);

  // 2) Kein Eintrag doppelt
  const doppelt = liste.filter((n, i) => liste.indexOf(n) !== i);
  check("kein Selektor doppelt in der Liste" + (doppelt.length ? " (" + doppelt.join(", ") + ")" : ""),
    doppelt.length === 0);

  // 3) Jeder Zweig braucht auch Markup, sonst ist er tot
  const markup = new Set();
  (app + html).replace(/data-([a-z][a-z-]*)=/g, (_, n) => { markup.add(camel(n)); return ""; });
  const ohneMarkup = [...zweige].filter(n => !markup.has(n));
  check("jeder Zweig hat auch ein Element im Markup" + (ohneMarkup.length ? " (" + ohneMarkup.join(", ") + ")" : ""),
    ohneMarkup.length === 0);

  // 4) Attribute, die auf Knöpfen sitzen, müssen in der Liste stehen.
  //    Attribute an Eingabefeldern und Zeilen laufen über input/change und sind hier außen vor.
  const knopfAttribute = new Set();
  app.replace(/<button[^>]*>/g, tag => {
    tag.replace(/data-([a-z][a-z-]*)=/g, (_, n) => { knopfAttribute.add(n); return ""; });
    return "";
  });
  // data-wert und data-i stehen zusätzlich am selben Knopf, gelesen wird der Nachbar-Schlüssel
  const zusatz = new Set(["wert", "i", "id"]);
  const stumm = [...knopfAttribute].filter(n => !inListe.has(camel(n)) && !zusatz.has(n));
  check("kein Knopf ohne Eintrag in der Selektor-Liste" + (stumm.length ? " (data-" + stumm.join(", data-") + ")" : ""),
    stumm.length === 0);

  return check.ergebnis();
};
