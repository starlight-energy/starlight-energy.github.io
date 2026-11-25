(function () {
  var CLAVE = "starlight_pedido_v1";

  function cargar() {
    try {
      var d = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      return (d && typeof d === "object") ? d : {};
    } catch (e) { return {}; }
  }

  function guardar(c) {
    try { localStorage.setItem(CLAVE, JSON.stringify(c)); } catch (e) {}
    actualizarInsignia();
  }

  function ponerOferta(it, datos) {
    if (typeof datos.precioNormal === "number" && isFinite(datos.precioNormal)) it.precioNormal = datos.precioNormal;
    else delete it.precioNormal;
    if (typeof datos.finOferta === "number" && isFinite(datos.finOferta)) it.finOferta = datos.finOferta;
    else delete it.finOferta;
  }

  function agregar(id, datos, cant) {
    var c = cargar();
    cant = Math.max(1, parseInt(cant, 10) || 1);
    if (c[id]) {
      c[id].cantidad += cant;
      c[id].precio = datos.precio;
    } else {
      c[id] = {
        nombre: datos.nombre,
        articulo: datos.articulo || "la",
        precio: (datos.precio == null ? null : datos.precio),
        cantidad: cant
      };
    }
    ponerOferta(c[id], datos);
    if (datos.tope != null && c[id].cantidad > datos.tope) c[id].cantidad = datos.tope;
    guardar(c);
    return c[id].cantidad;
  }

  function fijarCantidad(id, cant) {
    var c = cargar();
    if (!c[id]) return;
    cant = parseInt(cant, 10);
    if (!cant || cant < 1) { delete c[id]; }
    else { c[id].cantidad = cant; }
    guardar(c);
  }

  function quitar(id) { var c = cargar(); delete c[id]; guardar(c); }

  function contar() {
    var c = cargar(), n = 0;
    for (var k in c) if (c.hasOwnProperty(k)) n += c[k].cantidad;
    return n;
  }

  function items() {
    var c = cargar(), arr = [], ahora = Date.now();
    for (var k in c) if (c.hasOwnProperty(k)) {
      var precio = c[k].precio, normal = c[k].precioNormal, fin = c[k].finOferta, antes = null;
      var vencida = typeof fin === "number" && ahora >= fin;
      if (vencida && typeof normal === "number") precio = normal;
      if (!vencida && typeof normal === "number" && typeof precio === "number" && normal > precio) antes = normal;
      arr.push({ id: k, nombre: c[k].nombre, articulo: c[k].articulo, precio: precio, cantidad: c[k].cantidad, antes: antes });
    }
    return arr;
  }

  function csvFila(linea) {
    var c = [], campo = "", dentro = false;
    for (var i = 0; i < linea.length; i++) {
      var ch = linea[i];
      if (ch === '"') { dentro = !dentro; }
      else if (ch === ',' && !dentro) { c.push(campo); campo = ""; }
      else { campo += ch; }
    }
    c.push(campo);
    return c;
  }

  function csvDoc(texto) {
    var filas = [], fila = [], campo = "", dentro = false;

    function terminarFila() {
      fila.push(campo);
      if (!(fila.length === 1 && !String(fila[0]).trim())) filas.push(fila);
      fila = [];
      campo = "";
    }

    texto = String(texto == null ? "" : texto);
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (ch === '"') {
        if (dentro && texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentro = !dentro;
        }
      } else if (ch === "," && !dentro) {
        fila.push(campo);
        campo = "";
      } else if (ch === "\n" && !dentro) {
        terminarFila();
      } else if (ch === "\r" && !dentro && texto[i + 1] === "\n") {
        terminarFila();
        i++;
      } else {
        campo += ch;
      }
    }
    if (dentro) throw new Error("CSV inválido");
    if (fila.length || campo) terminarFila();
    return filas;
  }

  function precioNum(txt) {
    txt = String(txt == null ? "" : txt).trim();
    if (!txt || !/^[\d.,\s]+$/.test(txt)) return null;
    var s = txt.replace(/\s/g, "").replace(/,/g, "");
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function leerHoja(url, porFila, alTerminar, siFalla, opciones) {
    if (!url) { if (siFalla) siFalla(); return; }
    fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP");
        return r.text();
      })
      .then(function (csv) {
        if (!String(csv).trim()) throw new Error("CSV vacío");
        var filas = csvDoc(csv);
        if (!filas.length) throw new Error("CSV vacío");
        var esperado = opciones && Array.isArray(opciones.encabezado) ? opciones.encabezado : null;
        if (esperado) {
          var real = filas[0];
          for (var i = 0; i < esperado.length; i++) {
            if (String(real[i] == null ? "" : real[i]).trim().toLowerCase() !== String(esperado[i]).trim().toLowerCase()) {
              throw new Error("Encabezado inválido");
            }
          }
          for (var j = 1; j < filas.length; j++) {
            if (filas[j].length < esperado.length) throw new Error("Fila incompleta");
          }
        }
        // Quien llama recibe también el encabezado, para buscar columnas por
        // nombre (la columna `viene` va al final y puede no existir todavía).
        var encabezado = filas[0];
        filas.slice(1).forEach(function (fila) { porFila(fila, encabezado); });
        if (alTerminar) alTerminar(encabezado);
      })
      .catch(function () { if (siFalla) siFalla(); });
  }

  // --- Columnas por nombre -------------------------------------------------
  // id, producto, precio y stock los valida leerHoja en las posiciones 0-3.
  // El resto se busca por su nombre en el encabezado y, si el encabezado no
  // lo tiene (o es una caché vieja sin encabezado), en su posición de siempre.

  function nombreColumna(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  function indiceColumna(encabezado, nombre) {
    if (!Array.isArray(encabezado)) return -1;
    var buscado = nombreColumna(nombre);
    for (var i = 0; i < encabezado.length; i++) {
      if (nombreColumna(encabezado[i]) === buscado) return i;
    }
    return -1;
  }

  function celda(fila, encabezado, nombre, posicion) {
    var i = indiceColumna(encabezado, nombre);
    if (i < 0) i = (typeof posicion === "number") ? posicion : -1;
    if (i < 0 || !fila || fila[i] == null) return "";
    return String(fila[i]);
  }

  function esOculto(fila, encabezado) {
    return celda(fila, encabezado, "visible", 10).trim().toLowerCase() === "no";
  }

  // `viene` solo existe por nombre: sin la columna (CSV o caché viejos) es "no".
  function viene(fila, encabezado) {
    var v = celda(fila, encabezado, "viene").trim().toLowerCase();
    if (v.normalize) v = v.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return v === "si";
  }

  // --- Textos del agotado y de "Avisarme" (D6, D30, D42, D43) --------------
  var TEXTOS = {
    agotado: "Agotado por el momento",
    agotadoViene: "Agotado · vienen en camino",
    invitacion: "Deje su número de WhatsApp y le escribimos en cuanto llegue:",
    invitacionViene: "Vienen en camino. Deje su número de WhatsApp y le avisamos cuando lleguen:",
    boton: "Avisarme",
    anotando: "Anotando…",
    anotado: "✓ Anotado. Le avisamos por WhatsApp cuando lleguen.",
    fallo: "No se pudo anotar. Revise su conexión y toque «Avisarme» otra vez.",
    fueraViene: "Agotado · vienen en camino. No entra en este pedido: le avisamos por WhatsApp cuando lleguen.",
    fuera: "Agotado por el momento. No entra en este pedido.",
    otroNumero: "¿Otro número? Anotar de nuevo"
  };

  function textoYaAnotado(fin) {
    return "✓ Ya está anotado con el número terminado en " + fin + ". Le avisamos cuando lleguen.";
  }

  // Insignia del catálogo. Desde la caché nunca dice "vienen en camino" (D44):
  // esa promesa solo vale con la lista recién leída.
  function estadoStock(stock, vieneSi, desdeCache) {
    if (typeof stock !== "number" || isNaN(stock)) return null;
    if (stock <= 0) {
      return (vieneSi && !desdeCache)
        ? { texto: TEXTOS.agotadoViene, clase: "viene" }
        : { texto: TEXTOS.agotado, clase: "agotado" };
    }
    if (stock <= 3) return { texto: "¡Quedan solo " + stock + "!", clase: "pocas" };
    return { texto: "Disponible", clase: "disponible" };
  }

  function insignia(fila, encabezado, desdeCache) {
    var stock = parseInt(String(fila && fila[3] != null ? fila[3] : "").trim(), 10);
    return estadoStock(stock, viene(fila, encabezado), desdeCache);
  }

  // --- Caché del catálogo: {fecha, encabezado, filas} -----------------------
  var CLAVE_CATALOGO = "starlight_catalogo_v1";

  function leerCacheCatalogo() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(CLAVE_CATALOGO)); } catch (e) { return null; }
    if (Array.isArray(d)) return { fecha: null, encabezado: null, filas: d };
    if (d && Array.isArray(d.filas)) {
      return {
        fecha: d.fecha,
        encabezado: Array.isArray(d.encabezado) ? d.encabezado : null,
        filas: d.filas
      };
    }
    return null;
  }

  function guardarCacheCatalogo(filas, encabezado) {
    try {
      localStorage.setItem(CLAVE_CATALOGO, JSON.stringify({
        fecha: Date.now(),
        encabezado: Array.isArray(encabezado) ? encabezado : null,
        filas: filas
      }));
    } catch (e) {}
  }

  function textoListaGuardada(fecha, ahora) {
    if (typeof fecha !== "number" || !isFinite(fecha)) return "Lista guardada; puede haber cambiado.";
    if (typeof ahora !== "number") ahora = Date.now();
    var horas = Math.max(0, Math.floor((ahora - fecha) / 3600000));
    var cuando = horas < 1 ? "menos de 1 hora"
      : horas === 1 ? "1 hora"
      : horas < 48 ? horas + " horas"
      : Math.floor(horas / 24) + " días";
    return "Lista guardada de hace " + cuando + "; puede haber cambiado.";
  }

  // --- "Avisarme" (D43) -----------------------------------------------------
  function claveAviso(id) { return "starlight_aviso_" + id; }

  // Lo anotado se recuerda DIAS_AVISO días. Pasado eso (o sin fecha válida) el
  // formulario vuelve: la fila Pendiente pudo cumplirse (Avisado) sin que el
  // cliente abriera el sitio con stock, o la tienda pudo no anotarla (con
  // no-cors una negativa parece un éxito), y "Ya está anotado" sin fila en la
  // tienda es una promesa falsa. Anotarse otra vez no duplica: la tienda (D43)
  // no agrega otra fila Pendiente con el mismo producto y el mismo teléfono.
  var DIAS_AVISO = 30;

  // Devuelve los 2 últimos dígitos del número anotado para ese producto, o null.
  // `ahora` es opcional (pruebas).
  function avisoGuardado(id, ahora) {
    try {
      var guardado = localStorage.getItem(claveAviso(id));
      if (guardado == null) return null;
      var d = JSON.parse(guardado);
      var fin = d && typeof d === "object" ? String(d.fin == null ? "" : d.fin) : "";
      if (typeof ahora !== "number") ahora = Date.now();
      var edad = (d && typeof d.fecha === "number" && isFinite(d.fecha)) ? ahora - d.fecha : NaN;
      if (/^\d{2}$/.test(fin) && edad >= 0 && edad < DIAS_AVISO * 86400000) return fin;
    } catch (e) {}
    olvidarAviso(id);
    return null;
  }

  function recordarAviso(id, telefono) {
    var fin = String(telefono || "").replace(/\D/g, "").slice(-2);
    try { localStorage.setItem(claveAviso(id), JSON.stringify({ fin: fin, fecha: Date.now() })); } catch (e) {}
  }

  // Cuando la lista recién leída trae stock, el aviso ya se cumplió: se olvida
  // para que un agotado futuro no diga "Ya está anotado" sin fila Pendiente.
  function olvidarAviso(id) {
    try { if (localStorage.getItem(claveAviso(id)) != null) localStorage.removeItem(claveAviso(id)); } catch (e) {}
  }

  // Con mode "no-cors" la respuesta es opaca: solo se detecta la falla de red.
  // En los datos móviles de Cuba la conexión a menudo se cuelga en vez de
  // fallar, y fetch puede quedar minutos sin contestar: pasados SEGUNDOS_AVISO
  // se da por fallido para que el cliente vea el texto rojo y pueda reintentar.
  // La petición no se cancela (keepalive): si llega tarde, la tienda (D43)
  // descarta la fila repetida.
  var SEGUNDOS_AVISO = 25;

  function enviarAviso(url, datos) {
    if (!url) return Promise.resolve(false);
    var envio;
    try {
      envio = fetch(url, {
        method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "aviso", id: datos.id, producto: datos.producto, telefono: datos.telefono })
      }).then(function () { return true; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
    return new Promise(function (listo) {
      var reloj = setTimeout(function () { listo(false); }, SEGUNDOS_AVISO * 1000);
      envio.then(function (ok) { clearTimeout(reloj); listo(ok); });
    });
  }

  function nuevo(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  // Pinta "Avisarme" dentro de `cont`: el formulario, o "Ya está anotado" si
  // este teléfono lo anotó hace menos de DIAS_AVISO días.
  // op: {id, nombre, viene, url}
  function pintarAviso(cont, op) {
    var caja = nuevo("div", "aviso-tel");
    cont.appendChild(caja);
    var fin = avisoGuardado(op.id);
    if (fin) pintarYaAnotado(caja, op, fin);
    else pintarFormularioAviso(caja, op);
    return caja;
  }

  // Debajo, "¿Otro número? Anotar de nuevo" olvida lo recordado y devuelve el
  // formulario en la misma caja: el cliente siempre puede corregir un número
  // mal escrito o anotarse otra vez.
  function pintarYaAnotado(caja, op, fin) {
    caja.appendChild(nuevo("span", "aviso-ok", textoYaAnotado(fin)));
    var otro = nuevo("button", "aviso-otro", TEXTOS.otroNumero);
    otro.type = "button";
    otro.addEventListener("click", function () {
      olvidarAviso(op.id);
      caja.textContent = "";
      pintarFormularioAviso(caja, op).focus();
    });
    caja.appendChild(otro);
  }

  // Devuelve el campo del teléfono.
  function pintarFormularioAviso(caja, op) {
    caja.appendChild(nuevo("span", "aviso-txt", op.viene ? TEXTOS.invitacionViene : TEXTOS.invitacion));
    var fila = nuevo("div", "aviso-fila");
    var inp = nuevo("input");
    inp.type = "tel";
    inp.setAttribute("inputmode", "tel");
    inp.setAttribute("placeholder", "Su número de WhatsApp");
    inp.setAttribute("aria-label", "Su número de WhatsApp");
    var boton = nuevo("button", "btn btn-azul btn-aviso", TEXTOS.boton);
    boton.type = "button";
    fila.appendChild(inp);
    fila.appendChild(boton);
    caja.appendChild(fila);
    var error = nuevo("span", "aviso-error", TEXTOS.fallo);
    error.hidden = true;
    caja.appendChild(error);

    boton.addEventListener("click", function () {
      if (boton.disabled) return;
      var tel = (inp.value || "").replace(/[^\d+]/g, "");
      if (tel.replace(/\D/g, "").length < 8) {
        inp.classList.add("error-campo");
        inp.focus();
        return;
      }
      inp.classList.remove("error-campo");
      error.hidden = true;
      boton.disabled = true;
      boton.textContent = TEXTOS.anotando;
      enviarAviso(op.url, { id: op.id, producto: op.nombre, telefono: tel }).then(function (ok) {
        if (ok) {
          recordarAviso(op.id, tel);
          caja.textContent = "";
          caja.appendChild(nuevo("span", "aviso-ok", TEXTOS.anotado));
        } else {
          boton.disabled = false;
          boton.textContent = TEXTOS.boton;
          error.hidden = false;
        }
      });
    });
    return inp;
  }

  // --- Pedido (D42 y contrato v39 §1.3) -------------------------------------
  // `info` = {id: {stock, viene}} de la hoja recién leída. Sin dato de stock
  // (la hoja no cargó o el producto no está) el artículo entra, como hoy.
  function partirPedido(lista, info) {
    var entran = [], fuera = [];
    (lista || []).forEach(function (it) {
      var inf = info && info[it.id];
      if (inf && typeof inf.stock === "number" && inf.stock <= 0) {
        fuera.push({ id: it.id, nombre: it.nombre, articulo: it.articulo, precio: it.precio, cantidad: it.cantidad, viene: !!inf.viene });
      } else {
        entran.push(it);
      }
    });
    return { entran: entran, fuera: fuera };
  }

  function sumar(lista) {
    var sub = 0, hayWA = false;
    (lista || []).forEach(function (it) {
      if (it.precio == null) hayWA = true;
      else sub += it.precio * it.cantidad;
    });
    return { sub: sub, hayWA: hayWA };
  }

  // Cada ítem lleva el precio que vio el cliente (2 decimales) o null si es
  // "precio por WhatsApp"; la tienda lo guarda en Pedidos!L (`_precios`).
  function itemsParaEnviar(lista) {
    return (lista || []).map(function (it) {
      var p = it.precio;
      return {
        id: it.id, nombre: it.nombre, cantidad: it.cantidad,
        precio: (typeof p === "number" && isFinite(p)) ? Math.round(p * 100) / 100 : null
      };
    });
  }

  function usd(n) { return (Math.round(n * 100) / 100).toLocaleString("en-US") + " USD"; }

  function textoLineaPedido(it) {
    if (it.precio == null) return "• " + it.cantidad + "× " + it.nombre + " — precio por WhatsApp";
    if (typeof it.antes === "number") return "• " + it.cantidad + "× " + it.nombre + " — " + usd(it.precio) + " c/u (oferta, antes " + usd(it.antes) + ") = " + usd(it.precio * it.cantidad);
    return "• " + it.cantidad + "× " + it.nombre + " — " + usd(it.precio) + " c/u = " + usd(it.precio * it.cantidad);
  }

  var ZONA_OFERTAS = "America/Havana";
  var PRECIO_MAXIMO_RAZONABLE = 5000;

  function desfaseZona(ms) {
    ms = Math.round(ms / 1000) * 1000;
    var v = {};
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA_OFERTAS, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(ms)).forEach(function (p) { v[p.type] = p.value; });
    var hora = Number(v.hour) === 24 ? 0 : Number(v.hour);
    var reloj = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), hora, Number(v.minute), Number(v.second));
    var d = reloj - ms;
    if (isNaN(d)) throw new Error("zona");
    return d;
  }

  function partesFecha(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto == null ? "" : texto));
    if (!m) return null;
    var a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
    var f = new Date(Date.UTC(a, mes - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
    return { a: a, m: mes, d: d, dia: f.getUTCDay() };
  }

  function finOferta(texto) {
    var p = partesFecha(texto);
    if (!p) return null;
    try {
      var g = Date.UTC(p.a, p.m - 1, p.d + 1, 0, 0, 0);
      var x = g - desfaseZona(g);
      var y = g - desfaseZona(x);
      var c = [x, y].sort(function (a, b) { return a - b; });
      for (var i = 0; i < c.length; i++) {
        if (c[i] + desfaseZona(c[i]) >= g) return c[i];
      }
      return c[c.length - 1];
    } catch (e) {
      return new Date(p.a, p.m - 1, p.d + 1, 0, 0, 0).getTime();
    }
  }

  var DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function fechaFinTexto(texto) {
    var p = partesFecha(String(texto == null ? "" : texto).trim());
    return p ? DIAS[p.dia] + " " + p.d + " de " + MESES[p.m - 1] : "";
  }

  function dosCifras(n) { return (n < 10 ? "0" : "") + n; }

  function cuentaRegresiva(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (!isFinite(s)) s = 0;
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    s = s % 60;
    var reloj = dosCifras(h) + ":" + dosCifras(m) + ":" + dosCifras(s);
    return d >= 1 ? d + "d " + reloj : reloj;
  }

  function sinOferta(fila) {
    var precio = null, texto = "";
    try { precio = precioNum(fila[2]); texto = String(fila[2] == null ? "" : fila[2]).trim(); } catch (e) {}
    return { etiqueta: "", precio: precio, precioTexto: texto, antes: null, tachado: false, finMs: null, finTexto: "", activa: false, termino: false };
  }

  function ofertaDe(fila, enc, ahora) {
    try {
      if (typeof ahora !== "number") ahora = Date.now();
      var base = sinOferta(fila);
      var etiqueta = celda(fila, enc, "oferta", 11).trim();
      if (!etiqueta) return base;
      var antes = precioNum(celda(fila, enc, "precio_antes"));
      if (antes !== null && !(antes > 0 && antes <= PRECIO_MAXIMO_RAZONABLE)) antes = null;
      var finTexto = celda(fila, enc, "oferta_fin").trim();
      var finMs = finOferta(finTexto);
      var tope = celda(fila, enc, "oferta_tope").trim();
      var stock = parseInt(String(fila[3] == null ? "" : fila[3]).trim(), 10);
      var porTope = /^\d+$/.test(tope) && !isNaN(stock) && stock <= Number(tope);
      var precioHoja = base.precio;
      if ((finMs !== null && ahora >= finMs) || porTope) {
        var vuelve = antes !== null && precioHoja !== null && antes > precioHoja;
        return { etiqueta: "", precio: vuelve ? antes : precioHoja, precioTexto: vuelve ? String(antes) : base.precioTexto, antes: null, tachado: false, finMs: null, finTexto: "", activa: false, termino: true };
      }
      return { etiqueta: etiqueta, precio: precioHoja, precioTexto: base.precioTexto, antes: antes, tachado: antes !== null && precioHoja !== null && antes > precioHoja, finMs: finMs, finTexto: finMs !== null ? finTexto : "", activa: true, termino: false };
    } catch (e) {
      return sinOferta(fila);
    }
  }

  function bannerOfertas(filas, enc, ahora) {
    try {
      if (typeof ahora !== "number") ahora = Date.now();
      var cuenta = {}, orden = [], activas = [];
      (filas || []).forEach(function (c) {
        var id = String(c && c[0] != null ? c[0] : "").trim().toLowerCase();
        if (!id || esOculto(c, enc)) return;
        var o = ofertaDe(c, enc, ahora);
        if (!o.activa || o.finMs === null) return;
        activas.push({ id: id, o: o });
        if (!cuenta[o.etiqueta]) { cuenta[o.etiqueta] = { n: 0, fin: o.finMs }; orden.push(o.etiqueta); }
        cuenta[o.etiqueta].n++;
        cuenta[o.etiqueta].fin = Math.min(cuenta[o.etiqueta].fin, o.finMs);
      });
      if (!activas.length) return null;
      var mejor = orden[0];
      orden.forEach(function (e) {
        var a = cuenta[e], m = cuenta[mejor];
        if (a.n > m.n || (a.n === m.n && a.fin < m.fin)) mejor = e;
      });
      var b = null;
      activas.forEach(function (x) {
        var o = x.o;
        if (o.etiqueta !== mejor) return;
        if (!b) b = { titulo: mejor, n: 0, conTachado: 0, ahorroMax: 0, finMs: o.finMs, finTexto: o.finTexto, primerId: x.id };
        b.n++;
        if (o.tachado) {
          b.conTachado++;
          b.ahorroMax = Math.max(b.ahorroMax, Math.round((o.antes - o.precio) * 100) / 100);
        }
        if (o.finMs < b.finMs) { b.finMs = o.finMs; b.finTexto = o.finTexto; }
      });
      return b;
    } catch (e) {
      return null;
    }
  }

  function textoCartel(b) {
    var linea = b.conTachado > 0
      ? (b.n === 1 ? "1 producto rebajado" : b.n + " productos rebajados")
      : (b.n === 1 ? "1 producto en oferta" : b.n + " productos en oferta");
    if (b.ahorroMax >= 1) linea += " · hasta " + usd(b.ahorroMax).replace(" USD", "") + " USD menos";
    return linea;
  }

  function textoFinLector(finTexto) {
    var f = fechaFinTexto(finTexto);
    return f ? "La oferta termina el " + f + " a las 11:59 p. m., hora de Cuba." : "";
  }

  function pintarCartel(el, b, href) {
    try {
      if (!el) return;
      if (!b) { el.hidden = true; el.textContent = ""; el.removeAttribute("data-clave"); return; }
      var clave = JSON.stringify([b.titulo, b.n, b.conTachado, b.ahorroMax, b.finMs, href]);
      if (el.getAttribute("data-clave") === clave && !el.hidden) return;
      el.setAttribute("data-clave", clave);
      el.textContent = "";
      el.appendChild(nuevo("h2", "", "🔥 " + b.titulo));
      el.appendChild(nuevo("p", "cartel-linea", textoCartel(b)));
      var p = nuevo("p", "cartel-cuenta");
      var t = nuevo("span", "", "Termina en ");
      t.setAttribute("aria-hidden", "true");
      var cuenta = nuevo("span", "cuenta", cuentaRegresiva(b.finMs - Date.now()));
      cuenta.setAttribute("data-fin-ms", String(b.finMs));
      cuenta.setAttribute("aria-hidden", "true");
      p.appendChild(t);
      p.appendChild(cuenta);
      p.appendChild(nuevo("span", "solo-lector", textoFinLector(b.finTexto)));
      el.appendChild(p);
      var a = nuevo("a", "", "Ver ofertas →");
      a.href = href;
      el.appendChild(a);
      el.hidden = false;
    } catch (e) {
      try { el.hidden = true; } catch (e2) {}
    }
  }

  var relojId = null, alVencerLista = [], avisados = {};

  function finesActuales() {
    var fines = [];
    try {
      document.querySelectorAll("[data-fin-ms]").forEach(function (el) {
        var f = Number(el.getAttribute("data-fin-ms"));
        if (isFinite(f) && f > 0) fines.push({ fin: f, el: el });
      });
    } catch (e) {}
    try {
      var c = cargar();
      for (var k in c) if (c.hasOwnProperty(k) && typeof c[k].finOferta === "number") fines.push({ fin: c[k].finOferta, el: null });
    } catch (e) {}
    return fines;
  }

  function ticReloj() {
    try {
      if (document.hidden) return;
      var ahora = Date.now(), vencidos = [];
      finesActuales().forEach(function (x) {
        if (x.el) x.el.textContent = cuentaRegresiva(x.fin - ahora);
        if (x.fin <= ahora && !avisados[x.fin]) { avisados[x.fin] = true; vencidos.push(x.fin); }
      });
      vencidos.forEach(function () {
        alVencerLista.forEach(function (f) { try { f(); } catch (e) {} });
      });
    } catch (e) {}
  }

  function relojOfertas(alVencer) {
    try {
      if (typeof alVencer === "function") alVencerLista.push(alVencer);
      if (relojId !== null) return;
      var ahora = Date.now();
      finesActuales().forEach(function (x) { if (x.fin <= ahora) avisados[x.fin] = true; });
      relojId = setInterval(ticReloj, 1000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) ticReloj(); });
    } catch (e) {}
  }

  function actualizarInsignia() {
    var n = contar();
    document.querySelectorAll("[data-carrito-cuenta]").forEach(function (el) {
      el.textContent = n;
    });
    document.querySelectorAll("[data-carrito-flotante]").forEach(function (el) {
      el.style.display = n > 0 ? "" : "none";
    });
  }

  window.Carrito = {
    cargar: cargar, guardar: guardar, agregar: agregar,
    fijarCantidad: fijarCantidad, quitar: quitar,
    contar: contar, items: items, actualizarInsignia: actualizarInsignia,
    csvFila: csvFila, csvDoc: csvDoc, precioNum: precioNum, leerHoja: leerHoja,
    esOculto: esOculto, indiceColumna: indiceColumna, celda: celda, viene: viene,
    TEXTOS: TEXTOS, textoYaAnotado: textoYaAnotado,
    estadoStock: estadoStock, insignia: insignia,
    leerCacheCatalogo: leerCacheCatalogo, guardarCacheCatalogo: guardarCacheCatalogo,
    textoListaGuardada: textoListaGuardada,
    avisoGuardado: avisoGuardado, recordarAviso: recordarAviso, olvidarAviso: olvidarAviso,
    enviarAviso: enviarAviso, pintarAviso: pintarAviso,
    DIAS_AVISO: DIAS_AVISO, SEGUNDOS_AVISO: SEGUNDOS_AVISO,
    partirPedido: partirPedido, sumar: sumar, itemsParaEnviar: itemsParaEnviar,
    usd: usd, textoLineaPedido: textoLineaPedido,
    ZONA_OFERTAS: ZONA_OFERTAS, finOferta: finOferta, fechaFinTexto: fechaFinTexto, cuentaRegresiva: cuentaRegresiva,
    ofertaDe: ofertaDe, bannerOfertas: bannerOfertas, textoCartel: textoCartel, textoFinLector: textoFinLector,
    pintarCartel: pintarCartel, relojOfertas: relojOfertas, ticReloj: ticReloj
  };

  document.addEventListener("DOMContentLoaded", actualizarInsignia);
})();
