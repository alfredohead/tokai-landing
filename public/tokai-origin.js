/*
 * Captura de origen del visitante (atribución de leads del chatbot).
 * Se incluye en el home y en todas las páginas de guías.
 * Guarda utm_source/utm_medium/utm_campaign + document.referrer en
 * sessionStorage SOLO en la primera visita de la sesión (no se
 * sobreescribe en navegaciones internas posteriores), para que el
 * primer canal de contacto quede registrado aunque el usuario llegue
 * al chat desde otra página del sitio.
 */
(function () {
  var KEY = 'tokai_lead_origin';

  function clip(v) {
    return (v || '').toString().trim().slice(0, 80);
  }

  try {
    if (!sessionStorage.getItem(KEY)) {
      var params = new URLSearchParams(window.location.search || '');
      var origin = {
        utm_source: clip(params.get('utm_source')),
        utm_medium: clip(params.get('utm_medium')),
        utm_campaign: clip(params.get('utm_campaign')),
        referrer: clip(document.referrer),
      };
      sessionStorage.setItem(KEY, JSON.stringify(origin));
    }
  } catch (e) {
    // sessionStorage no disponible (modo privado, iframe de terceros, etc.): sin bloquear la página.
  }

  window.getTokaiOrigin = function () {
    try {
      var raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };
})();
