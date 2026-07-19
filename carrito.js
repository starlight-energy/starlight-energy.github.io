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

  function precioNum(txt) {
    txt = String(txt == null ? "" : txt).trim();
    if (!txt || !/^[\d.,\s]+$/.test(txt)) return null;
    var s = txt.replace(/\s/g, "").replace(/,/g, "");
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function leerHoja(url, porFila, alTerminar, siFalla) {
    if (!url) { if (siFalla) siFalla(); return; }
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.text(); })
      .then(function (csv) {
        csv.split(/\r?\n/).slice(1).forEach(function (linea) {
          if (!linea.trim()) return;
          porFila(csvFila(linea));
        });
        if (alTerminar) alTerminar();
      })
      .catch(function () { if (siFalla) siFalla(); });
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
    csvFila: csvFila, precioNum: precioNum, leerHoja: leerHoja
  };

  document.addEventListener("DOMContentLoaded", actualizarInsignia);
})();
