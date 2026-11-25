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

  // 5) Columnas por nombre: encabezado real de la hoja (14 columnas) con y
  //    sin la columna `viene` al final (contrato v39 §2 S-R2/S-R3).
  const REAL = "id,producto,precio,stock,categoria,articulo,capacidad,specs,titulo,texto,visible,oferta,oferta_fin,oferta_tope";
  const encReal = REAL.split(",");
  const encViene = encReal.concat("viene");
  const OPC = { encabezado: ["id", "producto", "precio", "stock"] };

  function leerConEncabezado(csv) {
    const r = { filas: [], encFila: [], encFin: undefined, fallo: false };
    global.fetch = respuesta(csv);
    return new Promise((fin) => {
      C.leerHoja("https://hoja", (c, enc) => { r.filas.push(c); r.encFila.push(enc); },
        (enc) => { r.encFin = enc; fin(r); }, () => { r.fallo = true; fin(r); }, OPC);
    });
  }
  const porId = (r, id) => r.filas.find((c) => c[0] === id);

  exigir(C.indiceColumna(encViene, "viene") === 14, "indiceColumna: viene no está en la columna 15");
  exigir(C.indiceColumna(encReal, "viene") === -1, "indiceColumna: encontró viene en el encabezado de 14");
  exigir(C.indiceColumna([" ID ", "Viene "], "viene") === 1, "indiceColumna: no ignora mayúsculas ni espacios");
  exigir(C.indiceColumna(null, "viene") === -1, "indiceColumna: sin encabezado debe dar -1");

  const csvViene = [
    REAL + ",viene",
    "delta2,EcoFlow Delta 2,650,0,Energía,la,1024 Wh,a | b,,,,,,,sí",
    "river2,EcoFlow River 2 Pro,500,0,Energía,la,768 Wh,,,,,,,,",
    "sumry,Inversor Sumry,380,2,Energía,el,4000 W,,,,,Rebaja,,,sí",
    "delta3,EcoFlow Delta 3,700,9,Energía,la,,,,,,,,,sí",
    "oculto,Producto oculto,100,0,Energía,el,,,,,no,,,,sí"
  ].join("\n");
  let hoja = await leerConEncabezado(csvViene);
  exigir(!hoja.fallo && hoja.filas.length === 5, `leerHoja con viene: ${JSON.stringify(hoja)}`);
  exigir(hoja.encFila.every((e) => JSON.stringify(e) === JSON.stringify(encViene)), "leerHoja: porFila no recibió el encabezado");
  exigir(JSON.stringify(hoja.encFin) === JSON.stringify(encViene), "leerHoja: alTerminar no recibió el encabezado");

  const insigniaEs = (fila, enc, cache, texto, clase, msg) => {
    const got = C.insignia(fila, enc, cache);
    exigir(got && got.texto === texto && got.clase === clase, `${msg}: ${JSON.stringify(got)}`);
  };
  insigniaEs(porId(hoja, "delta2"), hoja.encFin, false, "Agotado · vienen en camino", "viene", "stock 0 + viene=sí");
  insigniaEs(porId(hoja, "river2"), hoja.encFin, false, "Agotado por el momento", "agotado", "stock 0 + viene vacío");
  insigniaEs(porId(hoja, "sumry"), hoja.encFin, false, "¡Quedan solo 2!", "pocas", "stock 2 + viene=sí");
  insigniaEs(porId(hoja, "delta3"), hoja.encFin, false, "Disponible", "disponible", "stock 9 + viene=sí");
  exigir(C.esOculto(porId(hoja, "oculto"), hoja.encFin), "un producto oculto con viene=sí sigue oculto");
  exigir(!C.esOculto(porId(hoja, "delta2"), hoja.encFin), "delta2 no debe estar oculto");
  exigir(C.celda(porId(hoja, "sumry"), hoja.encFin, "oferta", 11) === "Rebaja", "oferta por nombre");
  exigir(C.celda(porId(hoja, "delta2"), hoja.encFin, "capacidad", 6) === "1024 Wh", "capacidad por nombre");
  exigir(C.estadoStock(NaN, true, false) === null, "estadoStock: stock ilegible no decide la insignia");
  insigniaEs(["x", "X", "1", "-2"].concat(Array(10).fill(""), "sí"), encViene, false, "Agotado · vienen en camino", "viene", "stock negativo + viene");

  // CSV viejo, sin la columna viene: exactamente como hoy.
  const csvViejo = [REAL,
    "delta2,EcoFlow Delta 2,650,0,Energía,la,1024 Wh,,,,,Oferta vieja,,",
    "oculto,Producto oculto,100,3,Energía,el,,,,,no,,,"
  ].join("\n");
  hoja = await leerConEncabezado(csvViejo);
  exigir(!hoja.fallo && hoja.filas.length === 2 && hoja.encFin.length === 14, `leerHoja con CSV viejo: ${JSON.stringify(hoja)}`);
  exigir(!C.viene(porId(hoja, "delta2"), hoja.encFin), "CSV viejo: viene debe ser no");
  insigniaEs(porId(hoja, "delta2"), hoja.encFin, false, "Agotado por el momento", "agotado", "CSV viejo, stock 0");
  exigir(C.celda(porId(hoja, "delta2"), hoja.encFin, "oferta", 11) === "Oferta vieja", "CSV viejo: oferta");
  exigir(C.esOculto(porId(hoja, "oculto"), hoja.encFin) && C.esOculto(porId(hoja, "oculto")), "CSV viejo: oculto por nombre y por posición");

  // Si `viene` cayera antes de K, leer `visible` por nombre sigue ocultando
  // lo oculto (por posición lo publicaría: riesgo C17 del contrato).
  const encMal = encReal.slice(0, 4).concat("viene", encReal.slice(4));
  const filaMal = ["oculto", "Oculto", "100", "0", "sí", "Energía", "el", "", "", "", "", "no", "", "", ""];
  exigir(C.esOculto(filaMal, encMal), "visible por nombre con viene fuera de lugar");
  exigir(C.viene(filaMal, encMal), "viene por nombre fuera de lugar");

  const valoresViene = [["sí", true], ["SÍ", true], [" si ", true], ["sí", true], ["Sí ", true],
    ["no", false], ["", false], ["x", false], [undefined, false]];
  for (const [v, esperado] of valoresViene) {
    const fila = ["delta2", "D", "1", "0"].concat(Array(10).fill(""), v);
    exigir(C.viene(fila, encViene) === esperado, `viene(${JSON.stringify(v)}) debía ser ${esperado}`);
  }
  exigir(C.celda(["a"], null, "viene") === "" && C.celda(["a", "b"], null, "producto", 1) === "b", "celda: sin encabezado usa la posición o vacío");
  console.log("✓ columnas por nombre: encabezado real con y sin viene, insignia y ocultos");

  // 6) Caché del catálogo {fecha, encabezado, filas} (D44)
  const memoria = {};
  const almacen = {
    getItem: (k) => (k in memoria ? memoria[k] : null),
    setItem: (k, v) => { memoria[k] = String(v); },
    removeItem: (k) => { delete memoria[k]; }
  };
  global.localStorage = almacen;
  const filasCache = [["delta2", "EcoFlow Delta 2", "650", "0"].concat(Array(10).fill(""), "sí")];
  C.guardarCacheCatalogo(filasCache, encViene);
  const crudo = JSON.parse(memoria.starlight_catalogo_v1);
  exigir(typeof crudo.fecha === "number" && JSON.stringify(crudo.encabezado) === JSON.stringify(encViene) && crudo.filas.length === 1,
    `guardarCacheCatalogo: ${memoria.starlight_catalogo_v1}`);
  let cache = C.leerCacheCatalogo();
  exigir(cache && JSON.stringify(cache.encabezado) === JSON.stringify(encViene), "leerCacheCatalogo: perdió el encabezado");
  insigniaEs(cache.filas[0], cache.encabezado, true, "Agotado por el momento", "agotado", "desde la caché nunca dice vienen en camino");

  memoria.starlight_catalogo_v1 = JSON.stringify({ fecha: 123, filas: [["delta2", "D", "650", "0", "", "", "", "", "", "", "no"]] });
  cache = C.leerCacheCatalogo();
  exigir(cache && cache.encabezado === null && cache.fecha === 123 && cache.filas.length === 1, `caché sin encabezado: ${JSON.stringify(cache)}`);
  exigir(C.esOculto(cache.filas[0], cache.encabezado), "caché sin encabezado: oculto por posición");
  insigniaEs(cache.filas[0], cache.encabezado, true, "Agotado por el momento", "agotado", "caché sin encabezado");

  memoria.starlight_catalogo_v1 = JSON.stringify([["delta2", "D", "650", "5"]]);
  cache = C.leerCacheCatalogo();
  exigir(cache && cache.fecha === null && cache.encabezado === null && cache.filas.length === 1, "caché con formato de arreglo");
  memoria.starlight_catalogo_v1 = "{roto";
  exigir(C.leerCacheCatalogo() === null, "caché corrupta debe dar null");
  delete memoria.starlight_catalogo_v1;
  exigir(C.leerCacheCatalogo() === null, "sin caché debe dar null");

  global.localStorage = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => { throw new Error("bloqueado"); } };
  exigir(C.leerCacheCatalogo() === null, "localStorage bloqueado: leer");
  C.guardarCacheCatalogo(filasCache, encViene);
  global.localStorage = almacen;

  const H = 3600000, ahora = 1760000000000;
  const casosLista = [
    [ahora - 5 * H, "Lista guardada de hace 5 horas; puede haber cambiado."],
    [ahora - 5 * H - 59 * 60000, "Lista guardada de hace 5 horas; puede haber cambiado."],
    [ahora - 30 * 60000, "Lista guardada de hace menos de 1 hora; puede haber cambiado."],
    [ahora - H, "Lista guardada de hace 1 hora; puede haber cambiado."],
    [ahora - 47 * H, "Lista guardada de hace 47 horas; puede haber cambiado."],
    [ahora - 72 * H, "Lista guardada de hace 3 días; puede haber cambiado."],
    [ahora + H, "Lista guardada de hace menos de 1 hora; puede haber cambiado."],
    [null, "Lista guardada; puede haber cambiado."]
  ];
  for (const [fecha, esperado] of casosLista) {
    const got = C.textoListaGuardada(fecha, ahora);
    exigir(got === esperado, `textoListaGuardada(${fecha}) = ${got}`);
  }
  console.log(`✓ caché del catálogo: con y sin encabezado, nunca promete desde la caché, ${casosLista.length} avisos de antigüedad`);

  // 7) Pedido: lo agotado no entra (D42) y cada ítem lleva su precio (§1.3)
  const carrito = [
    { id: "delta2", nombre: "EcoFlow Delta 2", articulo: "la", precio: 650, cantidad: 1 },
    { id: "river2", nombre: "EcoFlow River 2 Pro", articulo: "la", precio: 500, cantidad: 2 },
    { id: "sumry", nombre: "Inversor Sumry", articulo: "el", precio: 380, cantidad: 1 },
    { id: "mc4", nombre: "Conectores MC4", articulo: "los", precio: null, cantidad: 3 },
    { id: "luzsolar", nombre: "Lámpara solar", articulo: "la", precio: 25, cantidad: 1 }
  ];
  const info = { delta2: { stock: 0, viene: true }, river2: { stock: 0, viene: false }, sumry: { stock: 5, viene: false }, mc4: { stock: null, viene: false } };
  const partes = C.partirPedido(carrito, info);
  exigir(partes.entran.map((i) => i.id).join() === "sumry,mc4,luzsolar", `partirPedido entran: ${partes.entran.map((i) => i.id)}`);
  exigir(JSON.stringify(partes.fuera.map((i) => [i.id, i.viene])) === JSON.stringify([["delta2", true], ["river2", false]]), `partirPedido fuera: ${JSON.stringify(partes.fuera)}`);
  const suma = C.sumar(partes.entran);
  exigir(suma.sub === 405 && suma.hayWA === true, `sumar sin agotados: ${JSON.stringify(suma)}`);
  const enviados = C.itemsParaEnviar(partes.entran);
  exigir(JSON.stringify(enviados) === JSON.stringify([
    { id: "sumry", nombre: "Inversor Sumry", cantidad: 1, precio: 380 },
    { id: "mc4", nombre: "Conectores MC4", cantidad: 3, precio: null },
    { id: "luzsolar", nombre: "Lámpara solar", cantidad: 1, precio: 25 }
  ]), `itemsParaEnviar: ${JSON.stringify(enviados)}`);
  exigir(enviados.every((it) => "precio" in it), "itemsParaEnviar: falta la clave precio");
  exigir(C.itemsParaEnviar([{ id: "mc4", nombre: "MC4", cantidad: 1, precio: 1.5 }, { id: "a", nombre: "A", cantidad: 1, precio: 99.999 }]).map((i) => i.precio).join() === "1.5,100", "itemsParaEnviar: 2 decimales");
  exigir(C.partirPedido(carrito, {}).entran.length === 5, "sin hoja, todo entra en el pedido");
  exigir(C.partirPedido(carrito, { delta2: { stock: -1 } }).fuera.length === 1, "stock negativo no entra");
  exigir(C.TEXTOS.fueraViene === "Agotado · vienen en camino. No entra en este pedido: le avisamos por WhatsApp cuando lleguen.", "texto D42 (viene)");
  exigir(C.TEXTOS.fuera === "Agotado por el momento. No entra en este pedido.", "texto D42 (no viene)");
  console.log("✓ pedido: lo agotado queda fuera del mensaje y del total; cada ítem manda su precio");

  // 8) "Avisarme" (D43), con un DOM mínimo de mentira
  class Nodo {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase(); this.children = []; this._texto = "";
      this.className = ""; this.atributos = {}; this.oyentes = {};
      this.disabled = false; this.hidden = false; this.value = ""; this.type = ""; this.style = {}; this.enfocado = false;
      const yo = this;
      this.classList = {
        add: (c) => { if (!yo.classList.contains(c)) yo.className = (yo.className + " " + c).trim(); },
        remove: (c) => { yo.className = yo.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
        contains: (c) => yo.className.split(/\s+/).includes(c)
      };
    }
    get textContent() { return this._texto + this.children.map((c) => c.textContent).join(""); }
    set textContent(v) { this.children = []; this._texto = String(v); }
    appendChild(n) { this.children.push(n); return n; }
    setAttribute(k, v) { this.atributos[k] = String(v); }
    addEventListener(t, f) { (this.oyentes[t] = this.oyentes[t] || []).push(f); }
    click() { (this.oyentes.click || []).forEach((f) => f({})); }
    focus() { this.enfocado = true; }
  }
  global.document.createElement = (t) => new Nodo(t);
  const buscar = (raiz, pred, acc = []) => { for (const h of raiz.children) { if (pred(h)) acc.push(h); buscar(h, pred, acc); } return acc; };
  const clase = (raiz, c) => buscar(raiz, (n) => n.classList.contains(c))[0];
  const etiqueta = (raiz, t) => buscar(raiz, (n) => n.tagName === t)[0];
  const esperar = () => new Promise((r) => setImmediate(r));
  const URL_AVISO = "https://exec";

  function diferido() { let ok, mal; const p = new Promise((a, b) => { ok = a; mal = b; }); return { p, ok, mal }; }
  let llamadas = [];
  function fetchFalso(resultado) {
    return (url, op) => { llamadas.push({ url, op }); return resultado(); };
  }

  // Formulario de un agotado que viene
  for (const k of Object.keys(memoria)) delete memoria[k];
  let cont = new Nodo("div");
  C.pintarAviso(cont, { id: "delta2", nombre: "EcoFlow Delta 2", viene: true, url: URL_AVISO });
  exigir(clase(cont, "aviso-txt").textContent === "Vienen en camino. Deje su número de WhatsApp y le avisamos cuando lleguen:", "Avisarme: invitación cuando viene");
  let boton = clase(cont, "btn-aviso"), campo = etiqueta(cont, "INPUT"), error = clase(cont, "aviso-error");
  exigir(boton.textContent === "Avisarme" && !boton.disabled && campo.type === "tel" && error.hidden, "Avisarme: estado inicial");

  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "river2", nombre: "River", viene: false, url: URL_AVISO });
  exigir(clase(cont, "aviso-txt").textContent === "Deje su número de WhatsApp y le escribimos en cuanto llegue:", "Avisarme: invitación de siempre");

  // Número corto: no se envía nada
  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "delta2", nombre: "EcoFlow Delta 2", viene: true, url: URL_AVISO });
  boton = clase(cont, "btn-aviso"); campo = etiqueta(cont, "INPUT"); error = clase(cont, "aviso-error");
  llamadas = [];
  global.fetch = fetchFalso(() => Promise.resolve({}));
  campo.value = "5355";
  boton.click();
  exigir(llamadas.length === 0 && campo.classList.contains("error-campo") && campo.enfocado, "Avisarme: un número corto no se envía");

  // Envío que sale: "Anotando…" mientras espera, después la confirmación
  let espera = diferido();
  global.fetch = fetchFalso(() => espera.p);
  campo.value = "+53 5512 3476";
  boton.click();
  exigir(boton.disabled && boton.textContent === "Anotando…" && !campo.classList.contains("error-campo"), "Avisarme: Anotando… desactivado");
  boton.click();
  exigir(llamadas.length === 1, "Avisarme: un segundo toque mientras anota no envía otra vez");
  const cuerpo = JSON.parse(llamadas[0].op.body);
  exigir(llamadas[0].url === URL_AVISO && llamadas[0].op.mode === "no-cors" && llamadas[0].op.method === "POST", "Avisarme: petición no-cors POST");
  exigir(JSON.stringify(cuerpo) === JSON.stringify({ accion: "aviso", id: "delta2", producto: "EcoFlow Delta 2", telefono: "+5355123476" }), `Avisarme: cuerpo ${llamadas[0].op.body}`);
  exigir(memoria.starlight_aviso_delta2 === undefined, "Avisarme: no recuerda antes de saber que salió");
  espera.ok({ type: "opaque" });
  await esperar();
  exigir(cont.textContent === "✓ Anotado. Le avisamos por WhatsApp cuando lleguen." && clase(cont, "aviso-ok"), `Avisarme: confirmación ${cont.textContent}`);
  exigir(C.avisoGuardado("delta2") === "76", `Avisarme: recordado ${memoria.starlight_aviso_delta2}`);

  // Próxima visita: ya está anotado, sin formulario, con la salida "¿Otro número?"
  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "delta2", nombre: "EcoFlow Delta 2", viene: true, url: URL_AVISO });
  exigir(clase(cont, "aviso-ok").textContent === "✓ Ya está anotado con el número terminado en 76. Le avisamos cuando lleguen." && !etiqueta(cont, "INPUT"), `Avisarme: próxima visita ${cont.textContent}`);
  let otro = clase(cont, "aviso-otro");
  exigir(otro && otro.tagName === "BUTTON" && otro.type === "button" && otro.textContent === "¿Otro número? Anotar de nuevo", `Avisarme: falta «¿Otro número?» ${cont.textContent}`);
  C.olvidarAviso("delta2");
  exigir(C.avisoGuardado("delta2") === null, "olvidarAviso: debía borrar el aviso");

  // "¿Otro número?": olvida lo recordado y devuelve el formulario en la MISMA
  // caja (lo que la página puso después, como «Compartir» o «Quitar», no se mueve)
  C.recordarAviso("delta2", "+53 5512 3476");
  cont = new Nodo("div");
  const cajaAviso = C.pintarAviso(cont, { id: "delta2", nombre: "EcoFlow Delta 2", viene: true, url: URL_AVISO });
  const despues = cont.appendChild(new Nodo("button"));
  clase(cont, "aviso-otro").click();
  exigir(memoria.starlight_aviso_delta2 === undefined && C.avisoGuardado("delta2") === null, "¿Otro número?: debía olvidar el aviso");
  exigir(cont.children.length === 2 && cont.children[0] === cajaAviso && cont.children[1] === despues, "¿Otro número?: el formulario debe volver en la misma caja");
  campo = etiqueta(cont, "INPUT"); boton = clase(cont, "btn-aviso");
  exigir(campo && campo.enfocado && boton && !clase(cont, "aviso-ok") && !clase(cont, "aviso-otro"), "¿Otro número?: formulario de vuelta con el campo enfocado");
  exigir(clase(cont, "aviso-txt").textContent === "Vienen en camino. Deje su número de WhatsApp y le avisamos cuando lleguen:", "¿Otro número?: invitación de vuelta");
  global.fetch = fetchFalso(() => Promise.resolve({}));
  llamadas = [];
  campo.value = "53 5599 8811";
  boton.click();
  await esperar();
  exigir(llamadas.length === 1 && JSON.parse(llamadas[0].op.body).telefono === "5355998811", "¿Otro número?: manda el número nuevo");
  exigir(C.avisoGuardado("delta2") === "11" && clase(cont, "aviso-ok").textContent === "✓ Anotado. Le avisamos por WhatsApp cuando lleguen.", "¿Otro número?: recuerda el número nuevo");

  // Lo anotado se recuerda DIAS_AVISO días; después vuelve el formulario
  const DIA = 86400000, hoy = Date.now();
  exigir(C.DIAS_AVISO === 30, `DIAS_AVISO: ${C.DIAS_AVISO}`);
  memoria.starlight_aviso_delta2 = JSON.stringify({ fin: "76", fecha: hoy - 29 * DIA });
  exigir(C.avisoGuardado("delta2", hoy) === "76", "avisoGuardado: a los 29 días sigue anotado");
  exigir(C.avisoGuardado("delta2", hoy + DIA - 1) === "76", "avisoGuardado: hasta el último instante del día 30");
  exigir(C.avisoGuardado("delta2", hoy + DIA) === null && memoria.starlight_aviso_delta2 === undefined, "avisoGuardado: a los 30 días se olvida y borra la clave");
  memoria.starlight_aviso_delta2 = JSON.stringify({ fin: "76", fecha: hoy - 45 * DIA });
  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "delta2", nombre: "EcoFlow Delta 2", viene: true, url: URL_AVISO });
  exigir(etiqueta(cont, "INPUT") && clase(cont, "btn-aviso") && !clase(cont, "aviso-ok") && memoria.starlight_aviso_delta2 === undefined,
    `Avisarme: un aviso de hace 45 días muestra el formulario ${cont.textContent}`);
  for (const [valor, msg] of [
    [{ fin: "76" }, "sin fecha"],
    [{ fin: "76", fecha: "2026-10-01" }, "fecha de texto"],
    [{ fin: "76", fecha: hoy + 2 * DIA }, "fecha en el futuro (reloj cambiado)"],
    [{ fin: "7", fecha: hoy }, "fin de un dígito"],
    ["76", "valor que no es objeto"],
    [null, "null"]
  ]) {
    memoria.starlight_aviso_delta2 = JSON.stringify(valor);
    exigir(C.avisoGuardado("delta2", hoy) === null && memoria.starlight_aviso_delta2 === undefined, `avisoGuardado: ${msg} debía olvidarse`);
  }
  C.recordarAviso("delta2", "5355123476");
  exigir(C.avisoGuardado("delta2") === "76", "recordarAviso + avisoGuardado: recién anotado");
  C.olvidarAviso("delta2");

  // Falla de red: texto rojo, botón de vuelta y nada recordado; reintento sale
  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "river2", nombre: "River", viene: false, url: URL_AVISO });
  boton = clase(cont, "btn-aviso"); campo = etiqueta(cont, "INPUT"); error = clase(cont, "aviso-error");
  global.fetch = fetchFalso(() => Promise.reject(new TypeError("Failed to fetch")));
  campo.value = "53551234";
  boton.click();
  await esperar();
  exigir(!error.hidden && error.textContent === "No se pudo anotar. Revise su conexión y toque «Avisarme» otra vez.", "Avisarme: texto de la falla");
  exigir(!boton.disabled && boton.textContent === "Avisarme" && C.avisoGuardado("river2") === null, "Avisarme: tras la falla se puede reintentar y no se recuerda");
  global.fetch = fetchFalso(() => Promise.resolve({}));
  boton.click();
  exigir(error.hidden, "Avisarme: al reintentar se esconde el error");
  await esperar();
  exigir(cont.textContent === "✓ Anotado. Le avisamos por WhatsApp cuando lleguen." && C.avisoGuardado("river2") === "34", "Avisarme: el reintento anota");

  // Conexión colgada (datos móviles de Cuba): pasados SEGUNDOS_AVISO se da por
  // fallida, el cliente ve el texto rojo y puede reintentar. Relojes de mentira.
  C.olvidarAviso("river2");
  const relojReal = { set: global.setTimeout, clear: global.clearTimeout };
  let relojes = [], limpiados = [];
  global.setTimeout = (f, ms) => { relojes.push({ f, ms }); return relojes.length; };
  global.clearTimeout = (n) => { limpiados.push(n); };
  exigir(C.SEGUNDOS_AVISO >= 20 && C.SEGUNDOS_AVISO <= 25, `SEGUNDOS_AVISO: ${C.SEGUNDOS_AVISO}`);

  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "river2", nombre: "River", viene: false, url: URL_AVISO });
  boton = clase(cont, "btn-aviso"); campo = etiqueta(cont, "INPUT"); error = clase(cont, "aviso-error");
  const colgada = diferido();
  llamadas = [];
  global.fetch = fetchFalso(() => colgada.p);
  campo.value = "53551234";
  boton.click();
  await esperar();
  exigir(relojes.length === 1 && relojes[0].ms === C.SEGUNDOS_AVISO * 1000, `enviarAviso: reloj de espera ${JSON.stringify(relojes.map((r) => r.ms))}`);
  exigir(boton.disabled && boton.textContent === "Anotando…" && error.hidden, "Avisarme: colgada, sigue Anotando… antes del plazo");
  relojes[0].f();
  await esperar();
  exigir(!error.hidden && error.textContent === "No se pudo anotar. Revise su conexión y toque «Avisarme» otra vez.", "Avisarme: colgada, al vencer el plazo sale el texto rojo");
  exigir(!boton.disabled && boton.textContent === "Avisarme" && C.avisoGuardado("river2") === null, "Avisarme: colgada, se puede reintentar y no se recuerda");
  exigir(llamadas.length === 1 && llamadas[0].op.keepalive === true, "Avisarme: la petición colgada no se cancela (keepalive)");
  // Si la colgada llega tarde, no cambia nada en pantalla (la tienda descarta la repetida)
  colgada.ok({ type: "opaque" });
  await esperar();
  exigir(!error.hidden && !boton.disabled && C.avisoGuardado("river2") === null && !clase(cont, "aviso-ok"), "Avisarme: un éxito tardío no pisa el texto rojo");
  // El reintento sale y el reloj se desarma al contestar
  global.fetch = fetchFalso(() => Promise.resolve({}));
  boton.click();
  await esperar();
  exigir(llamadas.length === 2 && relojes.length === 2 && limpiados.includes(2), `Avisarme: el reloj del reintento no se desarmó (${JSON.stringify(limpiados)})`);
  exigir(clase(cont, "aviso-ok").textContent === "✓ Anotado. Le avisamos por WhatsApp cuando lleguen." && C.avisoGuardado("river2") === "34", "Avisarme: colgada, el reintento anota");
  // Una falla de red que llega antes del plazo también desarma el reloj
  relojes = []; limpiados = [];
  global.fetch = fetchFalso(() => Promise.reject(new TypeError("Failed to fetch")));
  exigir(await C.enviarAviso(URL_AVISO, { id: "x" }) === false && relojes.length === 1 && limpiados.includes(1), "enviarAviso: la falla de red desarma el reloj");
  global.setTimeout = relojReal.set;
  global.clearTimeout = relojReal.clear;

  // fetch que lanza al llamarlo, o sin URL: también es falla
  global.fetch = () => { throw new Error("sin fetch"); };
  exigir(await C.enviarAviso(URL_AVISO, { id: "x" }) === false, "enviarAviso: un fetch que lanza es falla");
  exigir(await C.enviarAviso("", { id: "x" }) === false, "enviarAviso: sin URL es falla");

  // localStorage bloqueado: el formulario sale y la confirmación también
  global.localStorage = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } };
  cont = new Nodo("div");
  C.pintarAviso(cont, { id: "sumry", nombre: "Sumry", viene: true, url: URL_AVISO });
  boton = clase(cont, "btn-aviso"); campo = etiqueta(cont, "INPUT");
  global.fetch = fetchFalso(() => Promise.resolve({}));
  campo.value = "53551234";
  boton.click();
  await esperar();
  exigir(cont.textContent === "✓ Anotado. Le avisamos por WhatsApp cuando lleguen.", "Avisarme: sin localStorage confirma igual");
  C.olvidarAviso("sumry");
  global.localStorage = almacen;
  memoria.starlight_aviso_sumry = "{roto";
  exigir(C.avisoGuardado("sumry") === null, "avisoGuardado: un valor roto muestra el formulario");
  console.log("✓ Avisarme: invitación, Anotando…, confirmación, falla de red, plazo de espera, recuerdo por producto con vencimiento y «¿Otro número?»");

  // 9) Cableado de las páginas con las ayudas de carrito.js
  const leer = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");
  const pedidoHtml = leer("pedido.html"), catalogoHtml = leer("catalogo.html"), indexHtml = leer("index.html");
  exigir(/items:\s*Carrito\.itemsParaEnviar\(items\)/.test(pedidoHtml) && /var items=partir\(\)\.entran;/.test(pedidoHtml), "pedido.html: el envío no usa lo que entra");
  exigir(/Carrito\.sumar\(partir\(\)\.entran\)/.test(pedidoHtml), "pedido.html: el total no usa lo que entra");
  exigir(/viene:Carrito\.viene\(c, enc\)/.test(pedidoHtml), "pedido.html: no lee viene por nombre");
  // El renglón del agotado promete el aviso: el campo siempre lleva la invitación
  // que dice que hay que dejar el número (también cuando viene).
  exigir(/Carrito\.pintarAviso\(cuerpo, \{id:it\.id, nombre:it\.nombre, viene:it\.viene, url:PEDIDOS_URL\}\)/.test(pedidoHtml) && !/texto\s*:/.test(pedidoHtml.match(/Carrito\.pintarAviso\([^)]*\)/)[0]),
    "pedido.html: el renglón agotado debe pintar Avisarme con su invitación");
  exigir(/Carrito\.guardarCacheCatalogo\(filas, enc\)/.test(catalogoHtml) && /finalizar\(c, cached\.encabezado, true\)/.test(catalogoHtml), "catalogo.html: la caché no guarda o no usa el encabezado");
  exigir(/finalizar\(c, enc, false\)/.test(catalogoHtml) && /Carrito\.pintarAviso\(/.test(catalogoHtml), "catalogo.html: insignia o Avisarme sin cablear");
  exigir(indexHtml.includes("Le avisamos por WhatsApp cuando lleguen."), "index.html: la pregunta frecuente no dice la frase de D30");
  const versiones = (re) => ["index.html", "catalogo.html", "pedido.html"].map((f) => (leer(f).match(re) || [])[1]);
  const vCarrito = versiones(/carrito\.js\?v=(\d+)/), vEstilos = versiones(/estilos\.css\?v=(\d+)/).concat((leer("404.html").match(/estilos\.css\?v=(\d+)/) || [])[1]);
  exigir(new Set(vCarrito).size === 1 && vCarrito[0], `versiones de carrito.js distintas: ${vCarrito}`);
  exigir(new Set(vEstilos).size === 1 && vEstilos[0], `versiones de estilos.css distintas: ${vEstilos}`);
  console.log(`✓ páginas cableadas (carrito.js?v=${vCarrito[0]}, estilos.css?v=${vEstilos[0]})`);

  // 10) Ofertas v51: fin a la hora de Cuba, cuenta regresiva, precio vigente, cartel y carrito
  const Z = (iso) => Date.parse(iso);
  const vectoresFin = [["2026-11-30", Z("2026-12-01T05:00:00Z")], ["2027-03-13", Z("2027-03-14T05:00:00Z")], ["2027-11-06", Z("2027-11-07T04:00:00Z")],
    ["30/11/2026", null], ["2026-11-31", null], ["", null], ["2026-11-30T00:00", null], ["2026-02-30", null], [null, null]];
  for (const [txt, esperado] of vectoresFin) exigir(C.finOferta(txt) === esperado, `finOferta(${JSON.stringify(txt)}) = ${C.finOferta(txt)}`);
  exigir(C.ZONA_OFERTAS === "America/Havana", "ZONA_OFERTAS");
  const IntlReal = global.Intl.DateTimeFormat;
  global.Intl.DateTimeFormat = function () { throw new Error("sin zonas"); };
  exigir(C.finOferta("2026-11-30") === new Date(2026, 11, 1, 0, 0, 0).getTime(), "finOferta: sin Intl usa la medianoche del teléfono");
  global.Intl.DateTimeFormat = IntlReal;
  console.log(`✓ finOferta: ${vectoresFin.length} vectores y sin Intl`);

  const vectoresCuenta = [[(5 * 86400 + 4 * 3600 + 12 * 60 + 9) * 1000, "5d 04:12:09"], [6.5 * 86400000, "6d 12:00:00"], [1000, "00:00:01"],
    [999, "00:00:00"], [0, "00:00:00"], [-5000, "00:00:00"], [NaN, "00:00:00"], [86399000, "23:59:59"], [86400000, "1d 00:00:00"]];
  for (const [ms, esperado] of vectoresCuenta) exigir(C.cuentaRegresiva(ms) === esperado, `cuentaRegresiva(${ms}) = ${C.cuentaRegresiva(ms)}`);
  exigir(C.fechaFinTexto("2026-11-30") === "lunes 30 de noviembre" && C.fechaFinTexto("2026-11-29") === "domingo 29 de noviembre" && C.fechaFinTexto("x") === "", "fechaFinTexto");
  console.log("✓ cuentaRegresiva y fechaFinTexto");

  const ENC51 = encViene.concat("precio_antes");
  const fila51 = (id, precio, stock, extra) => {
    const f = [id, "P " + id, precio, String(stock)].concat(Array(11).fill(""), "");
    const e = extra || {};
    if ("visible" in e) f[10] = e.visible;
    if ("oferta" in e) f[11] = e.oferta;
    if ("fin" in e) f[12] = e.fin;
    if ("tope" in e) f[13] = e.tope;
    if ("antes" in e) f[15] = e.antes;
    return f;
  };
  const ANTES_FIN = Z("2026-11-30T23:59:59-05:00"), FIN = Z("2026-12-01T05:00:00Z");
  const of = (fila, enc, ahora) => C.ofertaDe(fila, enc, ahora === undefined ? ANTES_FIN : ahora);
  let o = of(fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30", antes: "330" }), ENC51);
  exigir(o.activa && o.tachado && o.precio === 310 && o.antes === 330 && o.finMs === FIN && o.etiqueta === "Black Friday" && !o.termino && o.finTexto === "2026-11-30", `ofertaDe vigente: ${JSON.stringify(o)}`);
  o = of(fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30", antes: "330" }), ENC51, FIN);
  exigir(!o.activa && o.termino && !o.tachado && o.etiqueta === "" && o.precio === 330 && o.precioTexto === "330" && o.finMs === null, `ofertaDe vencida vuelve a antes: ${JSON.stringify(o)}`);
  o = of(fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30" }), ENC51, FIN);
  exigir(o.termino && o.precio === 310 && o.etiqueta === "", "vencida sin antes: precio de la hoja");
  const csvViejo15 = fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30" }).slice(0, 15);
  o = of(csvViejo15, encViene);
  exigir(o.activa && !o.tachado && o.antes === null && o.finMs === FIN && o.precio === 310, `CSV viejo de 15 columnas: ${JSON.stringify(o)}`);
  o = of(fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30", antes: "330" }), null);
  exigir(o.activa && o.etiqueta === "Black Friday" && !o.tachado && o.finMs === null, `caché sin encabezado: ${JSON.stringify(o)}`);
  o = of(fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "", antes: "330" }), ENC51, FIN + 86400000 * 30);
  exigir(o.activa && o.tachado && o.finMs === null, "fin vacío: oferta sin fin, con tachado, sin cuenta");
  for (const malo of ["11/30/2026", "30/11/2026", "2026-11-31", "algo"]) {
    o = of(fila51("sumry", "310", 5, { oferta: "BF", fin: malo, antes: "330" }), ENC51, FIN);
    exigir(o.activa && o.finMs === null && o.tachado, `fin inválido ${malo}`);
  }
  o = of(fila51("sumry", "310", 5, { oferta: "BF", fin: "2026-11-30" }), ENC51);
  exigir(o.activa && !o.tachado && o.antes === null, "sin precio_antes: solo etiqueta");
  o = of(fila51("sumry", "310", 5, { oferta: "BF", fin: "2026-11-30", antes: "310" }), ENC51);
  exigir(o.activa && !o.tachado && o.finMs === FIN, "antes <= precio: sin tachado, con cuenta");
  for (const raro of ["330,50", "6000", "0"]) {
    o = of(fila51("sumry", "310", 5, { oferta: "BF", fin: "2026-11-30", antes: raro }), ENC51);
    exigir(o.activa && !o.tachado && o.antes === null, `precio_antes raro ${raro}: solo etiqueta`);
    o = of(fila51("sumry", "310", 5, { oferta: "BF", fin: "2026-11-30", antes: raro }), ENC51, FIN);
    exigir(o.termino && o.precio === 310 && o.precioTexto === "310", `precio_antes raro ${raro}: al terminar queda el de la hoja, como el servidor`);
  }
  o = of(fila51("sumry", "Consultar", 5, { oferta: "BF", fin: "2026-11-30", antes: "330" }), ENC51);
  exigir(o.activa && !o.tachado && o.precio === null && o.precioTexto === "Consultar", "precio Consultar: sin tachado");
  o = of(fila51("sumry", "Consultar", 5, { oferta: "BF", fin: "2026-11-30", antes: "330" }), ENC51, FIN);
  exigir(o.termino && o.precio === null && o.precioTexto === "Consultar", "vencida con Consultar se respeta");
  o = of(fila51("sumry", "310", 5, { oferta: "", fin: "2026-11-30", antes: "330" }), ENC51);
  exigir(!o.activa && !o.termino && o.precio === 310 && o.antes === null, "sin etiqueta con antes: sin oferta");
  o = of(fila51("sumry", "310", 3, { oferta: "BF", fin: "2026-11-30", tope: "3", antes: "330" }), ENC51);
  exigir(o.termino && o.precio === 330, "tope alcanzado: terminó");
  o = of(fila51("sumry", "310", 4, { oferta: "BF", fin: "2026-11-30", tope: "3", antes: "330" }), ENC51);
  exigir(o.activa, "tope no alcanzado: sigue");
  o = C.ofertaDe(null, ENC51, ANTES_FIN);
  exigir(!o.activa && o.precio === null, "fila nula: sin oferta");
  const basura = new Proxy([], { get: (t, k) => { if (k === "2") return "310"; if (k === "0" || k === "length") throw new Error("basura"); return undefined; } });
  o = C.ofertaDe(basura, ENC51, ANTES_FIN);
  exigir(!o.activa && o.precio === 310, `fila basura que lanza: ${JSON.stringify(o)}`);
  console.log("✓ ofertaDe: la tabla de degradación entera");

  const filasB = [
    fila51("sumry", "310", 5, { oferta: "Black Friday", fin: "2026-11-30", antes: "330" }),
    fila51("bat1", "500", 0, { oferta: "Black Friday", fin: "2026-11-30", antes: "520" }),
    fila51("bat2", "480", 2, { oferta: "Black Friday", fin: "2026-11-30", antes: "530" }),
    fila51("oculto", "100", 2, { visible: "no", oferta: "Otra", fin: "2026-11-25", antes: "900" }),
    fila51("x", "50", 2, { oferta: "Otra", fin: "2026-11-28", antes: "55" }),
    fila51("sinfecha", "50", 2, { oferta: "Sin fecha", antes: "60" }),
    fila51("", "50", 2, { oferta: "Vacía", fin: "2026-11-27" })
  ];
  let b = C.bannerOfertas(filasB, ENC51, Z("2026-11-24T12:00:00-05:00"));
  exigir(b && b.titulo === "Black Friday" && b.n === 3 && b.conTachado === 3 && b.ahorroMax === 50 && b.finMs === FIN && b.primerId === "sumry" && b.finTexto === "2026-11-30", `bannerOfertas: solo cuenta la etiqueta del título: ${JSON.stringify(b)}`);
  b = C.bannerOfertas([fila51("g", "5", 2, { oferta: "Envío gratis", fin: "2026-11-26" })].concat(filasB.slice(0, 3)), ENC51, Z("2026-11-24T12:00:00-05:00"));
  exigir(b.titulo === "Black Friday" && b.n === 3 && b.finMs === FIN && b.primerId === "sumry", `otra etiqueta con fin más temprano no cambia la cuenta: ${JSON.stringify(b)}`);
  b = C.bannerOfertas([fila51("a", "10", 2, { oferta: "Uno", fin: "2026-11-30" }), fila51("b", "10", 2, { oferta: "Dos", fin: "2026-11-28" })], ENC51, ANTES_FIN - 3 * 86400000);
  exigir(b.titulo === "Dos" && b.n === 1 && b.conTachado === 0 && b.ahorroMax === 0 && b.primerId === "b", `empate por fin: ${JSON.stringify(b)}`);
  b = C.bannerOfertas([fila51("a", "10", 2, { oferta: "Uno", fin: "2026-11-30" }), fila51("b", "10", 2, { oferta: "Dos", fin: "2026-11-30" })], ENC51, ANTES_FIN);
  exigir(b.titulo === "Uno", "empate total: el primero");
  exigir(C.bannerOfertas([fila51("a", "10", 2, { oferta: "Uno" })], ENC51, ANTES_FIN) === null, "sin fechas: sin cartel");
  exigir(C.bannerOfertas(filasB, ENC51, FIN) === null, "después del fin: sin cartel");
  exigir(C.bannerOfertas(null, ENC51) === null && C.bannerOfertas([basura], ENC51) === null, "basura: sin cartel");
  exigir(C.textoCartel({ n: 4, conTachado: 4, ahorroMax: 50 }) === "4 productos rebajados · hasta 50 USD menos", "T2+T3b");
  exigir(C.textoCartel({ n: 1, conTachado: 1, ahorroMax: 20 }) === "1 producto rebajado · hasta 20 USD menos", "T2 singular");
  exigir(C.textoCartel({ n: 2, conTachado: 0, ahorroMax: 0 }) === "2 productos en oferta" && C.textoCartel({ n: 1, conTachado: 0, ahorroMax: 0 }) === "1 producto en oferta", "T3");
  exigir(C.textoFinLector("2026-11-30") === "La oferta termina el lunes 30 de noviembre a las 11:59 p. m., hora de Cuba.", "T5");
  console.log("✓ bannerOfertas: ocultos fuera, mayoría, empates, fin más temprano y ahorro");

  for (const k of Object.keys(memoria)) delete memoria[k];
  global.localStorage = almacen;
  const DateReal = Date;
  let reloj = ANTES_FIN;
  global.Date = class extends DateReal { constructor(...a) { if (a.length) super(...a); else super(reloj); } static now() { return reloj; } };
  C.agregar("sumry", { nombre: "Inversor Sumry", articulo: "el", precio: 310, precioNormal: 330, finOferta: FIN }, 2);
  C.agregar("viejo", { nombre: "Viejo", articulo: "el", precio: 100 }, 1);
  let its = C.items();
  exigir(its[0].precio === 310 && its[0].antes === 330 && its[1].antes === null && its[1].precio === 100, `items antes del fin: ${JSON.stringify(its)}`);
  exigir(C.sumar(its).sub === 720 && C.itemsParaEnviar(its)[0].precio === 310, "sumar/enviar antes del fin");
  exigir(C.textoLineaPedido(its[0]) === "• 2× Inversor Sumry — 310 USD c/u (oferta, antes 330 USD) = 620 USD", `T8: ${C.textoLineaPedido(its[0])}`);
  exigir(C.textoLineaPedido(its[1]) === "• 1× Viejo — 100 USD c/u = 100 USD", "renglón de siempre");
  exigir(C.textoLineaPedido({ nombre: "MC4", cantidad: 3, precio: null }) === "• 3× MC4 — precio por WhatsApp", "renglón sin precio");
  reloj = FIN;
  its = C.items();
  exigir(its[0].precio === 330 && its[0].antes === null, `items después del fin: ${JSON.stringify(its)}`);
  exigir(C.sumar(its).sub === 760 && C.itemsParaEnviar(its)[0].precio === 330 && C.textoLineaPedido(its[0]) === "• 2× Inversor Sumry — 330 USD c/u = 660 USD", "después del fin todo en 330");
  C.agregar("sumry", { nombre: "Inversor Sumry", articulo: "el", precio: 330 }, 1);
  const crudoCarrito = JSON.parse(memoria.starlight_pedido_v1);
  exigir(!("precioNormal" in crudoCarrito.sumry) && !("finOferta" in crudoCarrito.sumry) && crudoCarrito.sumry.cantidad === 3, "agregar sin oferta borra los campos");
  memoria.starlight_pedido_v1 = JSON.stringify({ delta2: { nombre: "D", articulo: "la", precio: 650, cantidad: 1 } });
  exigir(JSON.stringify(C.items()) === JSON.stringify([{ id: "delta2", nombre: "D", articulo: "la", precio: 650, cantidad: 1, antes: null }]), "carrito viejo sin campos");
  exigir(C.usd(1200) === "1,200 USD" && C.usd(99.999) === "100 USD", "usd");
  console.log("✓ carrito: precio vigente antes y después del fin, T8, carrito viejo");

  const intervalos = [];
  const oyentesDoc = [];
  const setIntervalReal = global.setInterval;
  global.setInterval = (f, ms) => { intervalos.push({ f, ms }); return intervalos.length; };
  global.document.addEventListener = (tipo, f) => oyentesDoc.push({ tipo, f });
  const spanCuenta = { atributos: { "data-fin-ms": String(FIN + 3000) }, getAttribute(k) { return this.atributos[k]; }, textContent: "" };
  global.document.querySelectorAll = (sel) => (sel === "[data-fin-ms]" ? [spanCuenta] : []);
  memoria.starlight_pedido_v1 = JSON.stringify({ sumry: { nombre: "S", articulo: "el", precio: 310, precioNormal: 330, finOferta: FIN + 5000, cantidad: 1 } });
  let vencidos = 0;
  reloj = FIN;
  C.relojOfertas(() => { vencidos++; });
  C.relojOfertas(() => { vencidos += 10; });
  exigir(intervalos.length === 1 && intervalos[0].ms === 1000 && oyentesDoc.filter((x) => x.tipo === "visibilitychange").length === 1, "un solo reloj por página");
  intervalos[0].f();
  exigir(spanCuenta.textContent === "00:00:03" && vencidos === 0, `tic: ${spanCuenta.textContent}`);
  reloj = FIN + 3000;
  global.document.hidden = true;
  intervalos[0].f();
  exigir(spanCuenta.textContent === "00:00:03" && vencidos === 0, "pestaña oculta: no hace nada");
  global.document.hidden = false;
  oyentesDoc.find((x) => x.tipo === "visibilitychange").f();
  exigir(spanCuenta.textContent === "00:00:00" && vencidos === 11, `al volver: tic inmediato y aviso (${vencidos})`);
  intervalos[0].f();
  exigir(vencidos === 11, "cada fin se avisa una vez");
  reloj = FIN + 5000;
  intervalos[0].f();
  exigir(vencidos === 22, "el fin del carrito también avisa");
  global.setInterval = setIntervalReal;
  global.Date = DateReal;
  global.document.querySelectorAll = () => [];
  console.log("✓ relojOfertas: uno por página, pestaña oculta, aviso una vez por fin, también el del carrito");

  const cartelDoc = new Nodo("section");
  cartelDoc.removeAttribute = (k) => { delete cartelDoc.atributos[k]; };
  cartelDoc.getAttribute = (k) => (k in cartelDoc.atributos ? cartelDoc.atributos[k] : null);
  cartelDoc.hidden = true;
  const bc = C.bannerOfertas(filasB, ENC51, Z("2026-11-24T12:00:00-05:00"));
  C.pintarCartel(cartelDoc, bc, "catalogo.html#sumry");
  exigir(!cartelDoc.hidden && cartelDoc.children[0].textContent === "🔥 Black Friday" && cartelDoc.children[1].textContent === "3 productos rebajados · hasta 50 USD menos", `cartel: ${cartelDoc.textContent}`);
  const fila3 = cartelDoc.children[2];
  exigir(fila3.children[0].atributos["aria-hidden"] === "true" && fila3.children[0].textContent === "Termina en " && fila3.children[1].atributos["data-fin-ms"] === String(bc.finMs) && fila3.children[1].atributos["aria-hidden"] === "true" && fila3.children[2].className === "solo-lector", "cartel: la cuenta no se anuncia y el lector oye T5");
  exigir(cartelDoc.children[3].textContent === "Ver ofertas →" && cartelDoc.children[3].href === "catalogo.html#sumry", "cartel: botón T22");
  const primerHijo = cartelDoc.children[0];
  C.pintarCartel(cartelDoc, bc, "catalogo.html#sumry");
  exigir(cartelDoc.children[0] === primerHijo, "cartel: sin cambios no se vuelve a pintar (el lector no lo repite)");
  C.pintarCartel(cartelDoc, null, "x");
  exigir(cartelDoc.hidden && cartelDoc.children.length === 0, "cartel: sin oferta se oculta");
  console.log("✓ pintarCartel: T1, T2/T3b, T4, T5, T22, accesible y sin repintar");

  const css = leer("estilos.css");
  exigir(/prefers-reduced-motion:\s*reduce/.test(css) && /\.solo-lector\{/.test(css) && /\.cartel-oferta\[hidden\]\{display:none\}/.test(css) && /tabular-nums/.test(css), "estilos.css: movimiento reducido, solo-lector, hidden y números fijos");
  exigir(/--oferta-fondo:#111111;/.test(css) && /--oferta-rojo:#c62828;/.test(css) && /--oferta-oro:#f5b301;/.test(css), "estilos.css: colores del cartel");
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contraste = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  [["#ffffff", "#111111"], ["#f5b301", "#111111"], ["#ffffff", "#c62828"], ["#111111", "#f5b301"]].forEach(([a, b2]) => exigir(contraste(a, b2) >= 4.5, `contraste ${a}/${b2}: ${contraste(a, b2)}`));
  exigir(/id="cartel-oferta"[^>]*aria-live="polite"/.test(indexHtml) && /id="cartel-oferta"/.test(catalogoHtml) && !/cartel-oferta/.test(pedidoHtml) && !/cartel-oferta/.test(leer("404.html")), "el cartel va en inicio y catálogo, no en pedido ni en la 404");
  exigir(vCarrito[0] === "6" && vEstilos[0] === "7", `versiones v51: ${vCarrito[0]} ${vEstilos[0]}`);
  exigir(/Carrito\.textoLineaPedido\(it\)/.test(pedidoHtml) && /Carrito\.ofertaDe\(c, enc, Date\.now\(\)\)/.test(pedidoHtml) && /Carrito\.relojOfertas\(/.test(pedidoHtml), "pedido.html: usa ofertaDe, textoLineaPedido y el reloj");
  exigir(/Carrito\.ofertaDe\(c, enc, Date\.now\(\)\)/.test(catalogoHtml) && /precioNormal:precioNormal, finOferta:finOferta/.test(catalogoHtml) && /Carrito\.relojOfertas\(alVencer\)/.test(catalogoHtml), "catalogo.html: usa ofertaDe, guarda precio normal y fin, y el reloj");
  exigir(!/c\[11\]/.test(indexHtml) && /construirPrevia\(c, enc\)/.test(indexHtml), "index.html: la oferta por nombre, no por posición");
  const codigoSitio = ["carrito.js", "index.html", "catalogo.html", "pedido.html"].map(leer).join("\n");
  exigir(!/-05:00|5 \* 3600|18000000/.test(codigoSitio) && (codigoSitio.match(/America\/Havana/g) || []).length === 1, "sin desfases fijos; la zona en un solo lugar");
  const catHtml = leer("catalogo.html");
  exigir(catHtml.indexOf("Carrito.leerCacheCatalogo()") > -1 && catHtml.indexOf("cartelCache") > -1 && catHtml.indexOf("cartelCache") < catHtml.indexOf('estado.textContent = "Cargando productos…"'), "catálogo: el cartel se pinta desde la caché antes de leer la hoja (no salta)");
  exigir(/prefers-reduced-motion: reduce\)\{html\{scroll-behavior:auto\}/.test(css) && /\.producto\{[^}]*scroll-margin-top:72px/.test(css), "estilos.css: sin desplazamiento animado con movimiento reducido y el producto no queda bajo el nav");
  console.log("✓ páginas v51: cartel, colores con contraste, versiones y cableado de ofertas");

  console.log("TODO OK");
})();
