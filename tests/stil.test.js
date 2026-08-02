// Prüft das Stylesheet auf Fallen, die jsdom nicht sehen kann.
// Anlass: .punkt war doppelt vergeben (Statuspunkt 11x11 px UND Rüst-Zeile),
// wodurch die Rüst-Liste zusammenfiel und unleserlich wurde.
const fs = require("fs");
const path = require("path");
const { pruefer } = require("./helfer");

module.exports = async function () {
  const check = pruefer();
  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

  // 1) Keine Klasse zweimal als Basis-Regel (.name { ... })
  const zaehler = {};
  css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").forEach(block => {
    const sel = (block.split("{")[0] || "").trim();
    if (!sel) return;
    sel.split(",").forEach(s => {
      s = s.trim();
      if (/^\.[a-zA-Z][\w-]*$/.test(s)) zaehler[s] = (zaehler[s] || 0) + 1;
    });
  });
  const doppelt = Object.keys(zaehler).filter(k => zaehler[k] > 1);
  check("keine Klasse doppelt als Basis-Regel" + (doppelt.length ? " (" + doppelt.join(", ") + ")" : ""), doppelt.length === 0);

  // 2) Jede im Code verwendete Klasse hat auch eine Regel (Tippfehler-Schutz)
  const benutzt = new Set();
  (app + html).replace(/class="([^"$]*)"/g, (_, c) => {
    c.split(/\s+/).forEach(x => { if (x && !x.includes("{")) benutzt.add(x); });
    return "";
  });
  const definiert = new Set();
  css.replace(/\.([a-zA-Z][\w-]*)/g, (_, n) => { definiert.add(n); return ""; });
  // Klassen, die nur als Fundstelle für JavaScript dienen und bewusst kein Aussehen haben
  const nurMarker = new Set(["vz", "wiz-stamm", "wiz-eigen", "rz-soll", "p-ist-marker"]);
  const fehlend = [...benutzt].filter(k => !definiert.has(k) && !nurMarker.has(k));
  check("keine Klasse ohne Stil-Regel" + (fehlend.length ? " (" + fehlend.join(", ") + ")" : ""), fehlend.length === 0);

  // 3) Die Rüst-Zeile darf nicht die Maße des Statuspunkts erben
  check("Rüst-Zeile heißt .rpunkt (nicht .punkt)", app.indexOf('class="rpunkt ') !== -1 && app.indexOf('class="punkt ${st') === -1);
  check(".rpunkt setzt eigene Maße", /\.rpunkt\s*\{[^}]*width:\s*auto/.test(css));

  return check.ergebnis();
};
