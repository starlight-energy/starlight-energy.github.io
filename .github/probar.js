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

// Un producto se oculta SOLO si la columna 11 dice "no" (con o sin
// espacios/mayúsculas); vacía, ausente o cualquier otro texto = visible.
const casosOculto = [
  [["delta2", "P", "1", "2", "", "", "", "", "", "", "no"], true],
  [["delta2", "P", "1", "2", "", "", "", "", "", "", " NO "], true],
  [["delta2", "P", "1", "2", "", "", "", "", "", "", ""], false],
  [["delta2", "P", "1", "2"], false],
  [["delta2", "P", "1", "2", "", "", "", "", "", "", "si"], false]
];
for (const [fila, esperado] of casosOculto) {
  const got = C.esOculto(fila);
  if (got !== esperado) { console.error(`✗ esOculto(col11=${JSON.stringify(fila[10])}) = ${got}, esperaba ${esperado}`); process.exit(1); }
}
console.log(`✓ esOculto: ${casosOculto.length} casos correctos`);

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

// 4) leerHoja: entrega filas respetando comillas, y degrada bien si falla
(async () => {
  const encabezado = { encabezado: ["id", "producto", "precio", "stock"] };

  function ejecutarHoja(fetchActual, opciones, url = "https://hoja") {
    const resultado = { filas: [], termino: false, fallo: false };
    global.fetch = fetchActual;
    return new Promise((fin) => {
      C.leerHoja(url, (c) => resultado.filas.push(c), () => {
        resultado.termino = true;
        fin(resultado);
      }, () => {
        resultado.fallo = true;
        fin(resultado);
      }, opciones);
    });
  }

  function respuesta(csv, ok = true) {
    return () => Promise.resolve({ ok, text: () => Promise.resolve(csv) });
  }

  function exigir(condicion, mensaje) {
    if (!condicion) { console.error("✗ " + mensaje); process.exit(1); }
  }

  exigir(typeof C.csvDoc === "function", "csvDoc no está expuesto");

  let resultado = await ejecutarHoja(respuesta('id,producto,precio,stock\ndelta2,"EcoFlow, Delta 2",650,5\n\n'));
  exigir(resultado.termino && !resultado.fallo && resultado.filas.length === 1 && resultado.filas[0][1] === "EcoFlow, Delta 2", `leerHoja retrocompatible: ${JSON.stringify(resultado)}`);

  resultado = await ejecutarHoja(() => Promise.reject(new Error("sin conexión")));
  exigir(resultado.fallo && resultado.filas.length === 0, "leerHoja: sin conexión no llamó siFalla sin emitir filas");

  resultado = await ejecutarHoja(respuesta(""), undefined, "");
  exigir(resultado.fallo && resultado.filas.length === 0, "leerHoja: con url vacía no llamó siFalla sin emitir filas");

  resultado = await ejecutarHoja(respuesta("error", false), encabezado);
  exigir(resultado.fallo && !resultado.termino && resultado.filas.length === 0, "leerHoja: HTTP 500 no falló atómicamente");

  resultado = await ejecutarHoja(respuesta("zona,costo\nCentro,200"), encabezado);
  exigir(resultado.fallo && resultado.filas.length === 0, "leerHoja: aceptó un encabezado equivocado");

  resultado = await ejecutarHoja(respuesta("id,producto,precio,stock\ndelta2,Delta 2,650,5\nriver2,River 2,500"), encabezado);
  exigir(resultado.fallo && resultado.filas.length === 0, "leerHoja: emitió filas antes de detectar una fila incompleta");

  resultado = await ejecutarHoja(respuesta('id,producto,precio,stock\ndelta2,"EcoFlow ""Delta"" 2",650,5'), encabezado);
  exigir(resultado.termino && resultado.filas.length === 1 && resultado.filas[0][1] === 'EcoFlow "Delta" 2', `leerHoja: comillas escapadas incorrectas ${JSON.stringify(resultado.filas)}`);

  resultado = await ejecutarHoja(respuesta('id,producto,precio,stock\ndelta2,"EcoFlow\nDelta 2",650,5'), encabezado);
  exigir(resultado.termino && resultado.filas.length === 1 && resultado.filas[0][1] === "EcoFlow\nDelta 2", `leerHoja: celda multilínea incorrecta ${JSON.stringify(resultado.filas)}`);

  resultado = await ejecutarHoja(respuesta(""), encabezado);
  exigir(resultado.fallo && resultado.filas.length === 0, "leerHoja: el cuerpo vacío no llamó siFalla");

  resultado = await ejecutarHoja(respuesta("id,producto,precio,stock,detalle\ndelta2,Delta 2,650,5,Nuevo"), encabezado);
  exigir(resultado.termino && !resultado.fallo && resultado.filas.length === 1 && resultado.filas[0].length === 5, "leerHoja: rechazó columnas extra");

  console.log("✓ leerHoja: parseo documental, validación y emisión atómica");
  console.log("TODO OK");
})();
