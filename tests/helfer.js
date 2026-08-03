// Gemeinsame Test-Hilfen: App in jsdom starten, anmelden, prüfen
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { webcrypto } = require("crypto");

const APP = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
const pdfjs = fs.readFileSync(path.join(APP, "pdf.js"), "utf8");
const appjs = fs.readFileSync(path.join(APP, "app.js"), "utf8");

const warte = ms => new Promise(r => setTimeout(r, ms));

// vault: Inhalt des Speichers; roh: zusätzliche localStorage-Schlüssel
function starteApp(vault, roh) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const w = dom.window;
  Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true, writable: true });
  // jsdom stellt diese Browser-Bausteine nicht bereit
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.btoa = s => Buffer.from(s, "binary").toString("base64");
  w.atob = s => Buffer.from(s, "base64").toString("binary");
  w.scrollTo = () => {}; w.confirm = () => true; w.alert = () => {}; w.prompt = () => "";
  if (vault) w.localStorage.setItem("sue_vault", JSON.stringify(vault));
  if (roh) Object.keys(roh).forEach(k => w.localStorage.setItem(k, roh[k]));
  // jsdom kapselt jeden eval-Aufruf; im Browser teilen sich die Skripte den
  // Namensraum – daher zusammen ausführen, damit app.js pdf.js sieht
  w.eval(pdfjs + "\n" + appjs);
  return w;
}

// startet und meldet sich als güntzel an (Benutzer werden beim ersten Start angelegt)
async function appMitLogin() {
  const w = starteApp();
  const d = w.document;
  await warte(80);
  if (!d.getElementById("login").hidden) {
    d.getElementById("login-name").value = "güntzel";
    d.getElementById("login-pw").value = "1234";
    d.getElementById("login-ok").click();
    await warte(100);
  }
  return w;
}

function pruefer() {
  let ok = 0, fail = 0;
  const check = (name, bedingung) => {
    if (bedingung) { ok++; console.log("  ✓", name); }
    else { fail++; console.log("  ✗ FEHLER:", name); }
  };
  check.ergebnis = () => ({ ok, fail });
  return check;
}

// Werkzeuge, die an ein Fenster gebunden sind
function werkzeuge(w) {
  const d = w.document;
  return {
    d,
    setVal: (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); },
    tab: v => d.querySelector(`.tab[data-view="${v}"]`).click(),
    // liest einen Schlüssel aus dem gespeicherten Vault
    S: k => {
      const v = w.localStorage.getItem("sue_vault");
      if (!v) return null;
      const o = JSON.parse(v);
      return (k in o) ? o[k] : null;
    },
  };
}

module.exports = { APP, starteApp, appMitLogin, pruefer, werkzeuge, warte };
