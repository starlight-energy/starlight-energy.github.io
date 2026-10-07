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
    var c = cargar(), arr = [];
    for (var k in c) if (c.hasOwnProperty(k)) {
      arr.push({ id: k, nombre: c[k].nombre, articulo: c[k].articulo, precio: c[k].precio, cantidad: c[k].cantidad });
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
    fuera: "Agotado por el momento. No entra en este pedido."
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

  // Devuelve los 2 últimos dígitos del número anotado para ese producto, o null.
  function avisoGuardado(id) {
    try {
      var d = JSON.parse(localStorage.getItem(claveAviso(id)));
      var fin = d && typeof d === "object" ? String(d.fin == null ? "" : d.fin) : "";
      return /^\d{2}$/.test(fin) ? fin : null;
    } catch (e) { return null; }
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
  function enviarAviso(url, datos) {
    if (!url) return Promise.resolve(false);
    try {
      return fetch(url, {
        method: "POST", mode: "no-cors", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion: "aviso", id: datos.id, producto: datos.producto, telefono: datos.telefono })
      }).then(function () { return true; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function nuevo(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  // Pinta el formulario "Avisarme" dentro de `cont`.
  // op: {id, nombre, viene, url, texto (false = sin la frase de invitación)}
  function pintarAviso(cont, op) {
    var caja = nuevo("div", "aviso-tel");
    cont.appendChild(caja);

    var fin = avisoGuardado(op.id);
    if (fin) {
      caja.appendChild(nuevo("span", "aviso-ok", textoYaAnotado(fin)));
      return caja;
    }

    if (op.texto !== false) {
      caja.appendChild(nuevo("span", "aviso-txt", op.viene ? TEXTOS.invitacionViene : TEXTOS.invitacion));
    }
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
    return caja;
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
    partirPedido: partirPedido, sumar: sumar, itemsParaEnviar: itemsParaEnviar
  };

  document.addEventListener("DOMContentLoaded", actualizarInsignia);
})();
