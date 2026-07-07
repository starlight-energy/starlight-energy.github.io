/* ============================================================
   Carrito de pedidos de Starlight Solutions
   Se guarda en el navegador del cliente (localStorage), así no
   se pierde si recarga la página. Lo usan catalogo.html (para
   agregar) y pedido.html (para revisar y enviar por WhatsApp).
   ============================================================ */
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

  // datos = { nombre, articulo:"el"|"la", precio:Number|null, tope:Number|null }
  function agregar(id, datos, cant) {
    var c = cargar();
    cant = Math.max(1, parseInt(cant, 10) || 1);
    if (c[id]) {
      c[id].cantidad += cant;
      c[id].precio = datos.precio;          // refresca el precio por si cambió
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

  // Pinta el contador y muestra/oculta el botón flotante "Ver mi pedido"
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
    contar: contar, items: items, actualizarInsignia: actualizarInsignia
  };

  document.addEventListener("DOMContentLoaded", actualizarInsignia);
})();
