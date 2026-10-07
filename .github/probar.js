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

  console.log("TODO OK");
})();
