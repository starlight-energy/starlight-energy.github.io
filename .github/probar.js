// Pruebas del sitio Starlight: sintaxis de los scripts de cada página
// y lógica de las ayudas compartidas de carrito.js.
// Se ejecutan en cada push con GitHub Actions (.github/workflows/pruebas.yml)
// o a mano con:  node .github/probar.js
const fs = require("fs");
const path = require("path");
const RAIZ = path.join(__dirname, "..");

// 1) Sintaxis de los bloques <script> internos de cada página
for (const f of ["index.html", "catalogo.html", "pedido.html", "404.html"]) {
  const html = fs.readFileSync(path.join(RAIZ, f), "utf8");
  const bloques = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  bloques.forEach((m, i) => {
    try { new Function(m[1]); }
    catch (e) { console.error(`✗ ${f} bloque ${i + 1}: ${e.message}`); process.exit(1); }
  });
  console.log(`✓ ${f}: ${bloques.length} bloque(s) de script con sintaxis válida`);
}

// 2) carrito.js: cargar con suplentes del navegador y probar las ayudas
global.window = {};
global.document = { addEventListener: function () {} };
global.localStorage = { getItem: () => null, setItem: () => {} };
require(path.join(RAIZ, "carrito.js"));
const C = global.window.Carrito;

const casosPrecio = [
  ["650", 650], ["650.50", 650.5], ["1,200", 1200], ["1.200", 1200],
  ["1.234.500", 1234500], ["4.5", 4.5], [" 700 ", 700],
  ["Consultar", null], ["", null], ["650 USD", null], [null, null]
];
for (const [entrada, esperado] of casosPrecio) {
  const got = C.precioNum(entrada);
  if (got !== esperado) { console.error(`✗ precioNum(${JSON.stringify(entrada)}) = ${got}, esperaba ${esperado}`); process.exit(1); }
}
console.log(`✓ precioNum: ${casosPrecio.length} casos correctos`);

const casosCsv = [
  ['a,"b,c",d', ["a", "b,c", "d"]],
  ['delta2,EcoFlow Delta 2,"1,200",5', ["delta2", "EcoFlow Delta 2", "1,200", "5"]],
  ['x,,z', ["x", "", "z"]]
];
for (const [linea, esperado] of casosCsv) {
  const got = C.csvFila(linea);
  if (JSON.stringify(got) !== JSON.stringify(esperado)) { console.error(`✗ csvFila(${linea}) = ${JSON.stringify(got)}`); process.exit(1); }
}
console.log(`✓ csvFila: ${casosCsv.length} casos correctos`);

// 3) El carrito respeta el tope de stock al agregar
const guardado = {};
global.localStorage = {
  getItem: (k) => guardado[k] || null,
  setItem: (k, v) => { guardado[k] = v; }
};
global.document.querySelectorAll = () => [];
C.agregar("delta2", { nombre: "EcoFlow Delta 2", articulo: "la", precio: 650, tope: 3 }, 5);
const item = C.items()[0];
if (!item || item.cantidad !== 3) { console.error(`✗ tope de stock: cantidad = ${item && item.cantidad}, esperaba 3`); process.exit(1); }
console.log("✓ carrito: el tope de stock limita la cantidad al agregar");

console.log("TODO OK");
