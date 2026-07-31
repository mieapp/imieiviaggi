// I miei viaggi - Export PDF
// Richiede jsPDF caricato globalmente PRIMA di questo modulo (window.jspdf.jsPDF)
// Adattato da "Diario di viaggio": dati letti da IndexedDB (js/db-locale.js)
// invece che da Firestore; niente più sezione partecipanti in copertina;
// "orario" è ora un ISO string locale invece di un Timestamp Firestore.

import { ottieniTappePerGiorno } from "./db-locale.js";

const LARGHEZZA = 210;
const ALTEZZA = 297;
const MARGINE = 18;
const LARGHEZZA_UTILE = LARGHEZZA - MARGINE * 2;

const COLORI = {
  bluPetrolio: [27, 46, 53],
  ambra: [201, 123, 61],
  testoSecondario: [92, 90, 80],
  testoTerziario: [139, 133, 119],
  bordoMappa: [216, 208, 188]
};

// Palette per i colori per giorno (stessa logica della vista d'insieme dell'app)
const PALETTE_GIORNI = [
  [201, 123, 61], [92, 122, 110], [139, 58, 58], [62, 107, 139],
  [139, 110, 62], [110, 62, 139], [62, 139, 110], [139, 62, 110],
  [110, 139, 62], [62, 90, 139]
];

function formattaDataIT(iso) {
  if (!iso) return "";
  const [anno, mese, giorno] = iso.split('-');
  return `${giorno}-${mese}-${anno}`;
}

// "orario" è un ISO string locale (vedi js/db-locale.js), non più un Timestamp Firestore
function formattaOra(orarioISO) {
  if (!orarioISO) return "--:--";
  return new Date(orarioISO).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function millisOrario(orarioISO) {
  return orarioISO ? new Date(orarioISO).getTime() : 0;
}

function hexARgb(hex) {
  const pulito = (hex || "#8B8577").replace("#", "");
  const bigint = parseInt(pulito, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

export async function esportaPDF(viaggioId, datiViaggio, giorniViaggio, onProgresso) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // --- Recupero tutte le tappe, organizzate per giorno (serve sia per la mappa che per le pagine giorno) ---
  const tappePerGiorno = [];
  for (let i = 0; i < giorniViaggio.length; i++) {
    if (onProgresso) onProgresso(`Carico le tappe del giorno ${i + 1} di ${giorniViaggio.length}...`);
    const giorno = giorniViaggio[i];
    const tappeGiorno = await ottieniTappePerGiorno(viaggioId, giorno);
    tappePerGiorno.push({
      giorno,
      indice: i + 1,
      tappe: tappeGiorno
    });
  }

  const tutteLeTappe = tappePerGiorno.flatMap(s => s.tappe.map(t => ({ ...t, _giornoIndice: s.indice })));

  // --- Copertina (con mappa reale sotto nome/date) ---
  if (onProgresso) onProgresso("Preparo la copertina...");
  await disegnaCopertina(doc, datiViaggio, tutteLeTappe, onProgresso);

  // --- Tappe, una sezione per giorno, senza interruzioni di pagina forzate
  //     tra un giorno e l'altro (solo quando lo spazio finisce davvero) ---
  let yCorrente = null;
  tappePerGiorno.forEach(sezione => {
    if (sezione.tappe.length === 0) return; // salta i giorni senza tappe registrate
    if (yCorrente === null) {
      doc.addPage();
      yCorrente = MARGINE;
    }
    yCorrente = disegnaGiorno(doc, sezione, yCorrente);
  });

  if (onProgresso) onProgresso("Preparo il riepilogo...");
  const riepilogo = calcolaRiepilogo(tutteLeTappe, giorniViaggio);
  disegnaRiepilogo(doc, riepilogo);

  if (onProgresso) onProgresso("Genero il file...");

  const nomeFile = (datiViaggio.nome || "viaggio").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const nomeFileCompleto = `viaggio-${nomeFile}.pdf`;

  const blobPDF = doc.output("blob");
  const filePDF = new File([blobPDF], nomeFileCompleto, { type: "application/pdf" });

  // Non condividiamo/scarichiamo direttamente da qui: la generazione (che include
  // il recupero della mappa reale) richiede qualche secondo, e a quel punto
  // il browser non considera più valido il gesto dell'utente per aprire il
  // pannello di condivisione nativo. Restituiamo il file pronto, e sarà un
  // secondo click (gesto nuovo e valido) a innescare condivisione/download.
  return { file: filePDF, nomeFile: nomeFileCompleto, nomeViaggio: datiViaggio.nome };
}

export async function condividiOScaricaPDF(filePDF, nomeFileCompleto, nomeViaggio) {
  if (navigator.canShare && navigator.canShare({ files: [filePDF] })) {
    try {
      await navigator.share({
        files: [filePDF],
        title: nomeViaggio || "I miei viaggi",
        text: `I miei viaggi: ${nomeViaggio || ""}`
      });
      return;
    } catch (err) {
      console.warn("Condivisione non completata, scarico normalmente:", err);
    }
  }

  const url = URL.createObjectURL(filePDF);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeFileCompleto;
  link.click();
  URL.revokeObjectURL(url);
}

async function disegnaCopertina(doc, dati, tutteLeTappe, onProgresso) {
  let yTesto = 60;

  if (dati.immagineCopertina) {
    try {
      const altezzaImg = LARGHEZZA_UTILE * (475 / 960);
      doc.addImage(dati.immagineCopertina, "JPEG", MARGINE, 40, LARGHEZZA_UTILE, altezzaImg);
      yTesto = 40 + altezzaImg + 20;
    } catch (err) {
      console.warn("Copertina non incorporabile nel PDF:", err);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text(dati.nome || "Viaggio", MARGINE, yTesto, { maxWidth: LARGHEZZA_UTILE });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(...COLORI.testoSecondario);
  doc.text(`${formattaDataIT(dati.dataInizio)}  -  ${formattaDataIT(dati.dataFine)}`, MARGINE, yTesto + 10);

  const mappaY = yTesto + 22;
  await disegnaMappaReale(doc, tutteLeTappe, mappaY, onProgresso);
}

// --- Mappa reale (Geoapify Static Maps API) con marker e percorso colorati per giorno ---
//
// IMPORTANTE: questa chiave è un SEGNAPOSTO. Prima del primo deploy va sostituita
// con una chiave Geoapify dedicata e separata da quella di Diario di viaggio
// (decisione 31/07/2026, vedi sezione 4 della spec), con restrizione referrer
// sul dominio GitHub Pages di questo progetto.
const GEOAPIFY_API_KEY = "INSERIRE_QUI_LA_NUOVA_CHIAVE_GEOAPIFY_DEDICATA";

function coloreAUrl(colorArray) {
  const hex = colorArray.map(c => c.toString(16).padStart(2, "0")).join("");
  return `%23${hex}`;
}

function blobABase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function disegnaMappaReale(doc, tutteLeTappe, mappaY, onProgresso) {
  const altezzaMappa = 95;
  const tappeConPosizione = tutteLeTappe.filter(t => t.posizione && typeof t.posizione.lat === "number");

  if (tappeConPosizione.length === 0) return;

  try {
    if (onProgresso) onProgresso("Genero la mappa del percorso...");

    // Pallini delle tappe: marker piccoli colorati per giorno (il tentativo di
    // renderli "vuoti"/trasparenti via geometrie circle ha causato un errore
    // 400 dall'API, causa non isolabile senza accesso diretto per il test;
    // torniamo al parametro marker, già confermato funzionante)
    const marker = tappeConPosizione.map(t => {
      const colore = coloreAUrl(PALETTE_GIORNI[(t._giornoIndice - 1) % PALETTE_GIORNI.length]);
      return `lonlat:${t.posizione.lng},${t.posizione.lat};color:${colore};size:10;type:circle`;
    }).join("%7C");

    // Percorso: una polilinea colorata per ogni giorno, più connettori tratteggiati
    // tra l'ultima tappa di un giorno e la prima del successivo (per mostrare
    // anche gli spostamenti da una città all'altra)
    const perGiorno = {};
    tappeConPosizione.forEach(t => {
      if (!perGiorno[t._giornoIndice]) perGiorno[t._giornoIndice] = [];
      perGiorno[t._giornoIndice].push(t);
    });

    const segmentiGeometria = [];
    Object.keys(perGiorno).forEach(idx => {
      const punti = perGiorno[idx];
      if (punti.length > 1) {
        const coord = punti.map(t => `${t.posizione.lng},${t.posizione.lat}`).join(",");
        const colore = coloreAUrl(PALETTE_GIORNI[(idx - 1) % PALETTE_GIORNI.length]);
        segmentiGeometria.push(`polyline:${coord};linecolor:${colore};linewidth:3`);
      }
    });

    const tappeOrdinate = [...tappeConPosizione].sort((a, b) => millisOrario(a.orario) - millisOrario(b.orario));
    for (let i = 0; i < tappeOrdinate.length - 1; i++) {
      if (tappeOrdinate[i]._giornoIndice !== tappeOrdinate[i + 1]._giornoIndice) {
        const colore = coloreAUrl(PALETTE_GIORNI[(tappeOrdinate[i]._giornoIndice - 1) % PALETTE_GIORNI.length]);
        const a = tappeOrdinate[i].posizione, b = tappeOrdinate[i + 1].posizione;
        segmentiGeometria.push(`polyline:${a.lng},${a.lat},${b.lng},${b.lat};linecolor:${colore};linewidth:2;linestyle:dashed`);
      }
    }

    const larghezzaPx = 900;
    const altezzaPx = Math.round(larghezzaPx * (altezzaMappa / LARGHEZZA_UTILE));

    const url = `https://maps.geoapify.com/v1/staticmap?style=osm-carto&width=${larghezzaPx}&height=${altezzaPx}&format=png&marker=${marker}&geometry=${segmentiGeometria.join("%7C")}&apiKey=${GEOAPIFY_API_KEY}`;

    const risposta = await fetch(url);
    if (!risposta.ok) throw new Error(`Geoapify ha risposto con stato ${risposta.status}`);
    const blob = await risposta.blob();
    const base64 = await blobABase64(blob);

    doc.addImage(base64, "PNG", MARGINE, mappaY, LARGHEZZA_UTILE, altezzaMappa);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORI.testoTerziario);
    doc.text("Cartina: \u00A9 OpenStreetMap contributors \u00B7 powered by Geoapify", MARGINE, mappaY + altezzaMappa + 4);
  } catch (err) {
    console.warn("Mappa reale non generata:", err);
    // Non blocchiamo l'intero PDF se la mappa fallisce: si procede senza.
  }
}

// --- Riepilogo del viaggio (km, giorni, città visitate) ---

function distanzaKm(pos1, pos2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (pos2.lat - pos1.lat) * rad;
  const dLon = (pos2.lng - pos1.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(pos1.lat * rad) * Math.cos(pos2.lat * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcolaRiepilogo(tutteLeTappe, giorniViaggio) {
  const tappeConPosizione = tutteLeTappe.filter(t => t.posizione && typeof t.posizione.lat === "number");

  let kmTotali = 0;
  const tratte = [];
  for (let i = 1; i < tappeConPosizione.length; i++) {
    const km = distanzaKm(tappeConPosizione[i - 1].posizione, tappeConPosizione[i].posizione);
    kmTotali += km;
    tratte.push({ da: tappeConPosizione[i - 1].titolo, a: tappeConPosizione[i].titolo, km });
  }

  // Raggruppamento per città: stessa logica del tab in viaggio.html, con stima
  // dalla tappa nota più vicina in ordine cronologico per quelle senza localita
  const tappe = tutteLeTappe.map((t, indice) => ({
    ...t,
    _indice: indice,
    _citta: t.localita && t.localita.citta ? t.localita.citta : null,
    _paese: t.localita && t.localita.paese ? t.localita.paese : null,
    _stimata: false
  }));

  tappe.forEach((t) => {
    if (t._citta) return;
    for (let distanza = 1; distanza < tappe.length; distanza++) {
      const prima = tappe[t._indice - distanza];
      const dopo = tappe[t._indice + distanza];
      const candidata = (prima && prima._citta) ? prima : ((dopo && dopo._citta) ? dopo : null);
      if (candidata) {
        t._citta = candidata._citta;
        t._paese = candidata._paese;
        t._stimata = true;
        break;
      }
    }
  });

  const gruppi = new Map();
  tappe.forEach((t) => {
    const chiave = t._citta ? `${t._citta}|${t._paese || ''}` : '__non_identificata__';
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, { citta: t._citta, paese: t._paese, giorni: new Set(), tappe: [] });
    }
    const g = gruppi.get(chiave);
    g.giorni.add(t.data);
    g.tappe.push({ titolo: t.titolo, stimata: t._stimata });
  });

  const chiaviOrdinate = Array.from(gruppi.keys()).sort((chiaveA, chiaveB) => {
    if (chiaveA === '__non_identificata__') return 1;
    if (chiaveB === '__non_identificata__') return -1;
    return 0;
  });

  return {
    kmTotali,
    tratte,
    giorniTotali: giorniViaggio.length,
    citta: chiaviOrdinate.map(chiave => ({ chiave, ...gruppi.get(chiave) }))
  };
}

function disegnaRiepilogo(doc, riepilogo) {
  doc.addPage();
  let y = MARGINE + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text("Riepilogo del viaggio", MARGINE, y);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text(`${Math.round(riepilogo.kmTotali)} km totali`, MARGINE, y);
  doc.text(`${riepilogo.giorniTotali} ${riepilogo.giorniTotali === 1 ? 'giorno' : 'giorni'} di viaggio`, LARGHEZZA - MARGINE, y, { align: "right" });
  y += 10;

  if (riepilogo.tratte.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORI.bluPetrolio);
    doc.text("Km per tratta", MARGINE, y);
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    riepilogo.tratte.forEach(tr => {
      if (y > ALTEZZA - MARGINE) { doc.addPage(); y = MARGINE; }
      doc.setTextColor(...COLORI.testoSecondario);
      const testoTratta = `${tr.da} \u2192 ${tr.a}`;
      const righe = doc.splitTextToSize(testoTratta, LARGHEZZA_UTILE - 25);
      doc.text(righe, MARGINE, y);
      doc.setTextColor(...COLORI.testoTerziario);
      doc.text(`${Math.round(tr.km)} km`, LARGHEZZA - MARGINE, y, { align: "right" });
      y += righe.length * 4.5 + 2;
    });
    y += 6;
  }

  if (y > ALTEZZA - 40) { doc.addPage(); y = MARGINE; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text("Città visitate", MARGINE, y);
  y += 8;

  riepilogo.citta.forEach(g => {
    if (y > ALTEZZA - 30) { doc.addPage(); y = MARGINE; }

    const nomeLocalita = g.chiave === '__non_identificata__'
      ? "Località non identificata"
      : `${g.citta}${g.paese ? ', ' + g.paese : ''}`;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORI.bluPetrolio);
    doc.text(nomeLocalita, MARGINE, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COLORI.testoTerziario);
    doc.text(`${g.giorni.size} ${g.giorni.size === 1 ? 'giorno' : 'giorni'}`, LARGHEZZA - MARGINE, y, { align: "right" });
    y += 6;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORI.testoSecondario);
    g.tappe.forEach(t => {
      if (y > ALTEZZA - MARGINE) { doc.addPage(); y = MARGINE; }
      const testo = `\u00B7 ${t.titolo}${t.stimata ? ' (posizione stimata)' : ''}`;
      const righe = doc.splitTextToSize(testo, LARGHEZZA_UTILE - 6);
      doc.text(righe, MARGINE + 4, y);
      y += righe.length * 4.5;
    });
    y += 6;
  });
}

function disegnaGiorno(doc, sezione, yIniziale) {
  let y = yIniziale;

  // Spazio minimo per intestazione giorno + almeno una tappa: altrimenti pagina nuova
  if (y > ALTEZZA - 70) {
    doc.addPage();
    y = MARGINE;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text(`Giorno ${sezione.indice} - ${formattaDataIT(sezione.giorno)}`, MARGINE, y);
  y += 10;

  sezione.tappe.forEach(t => {
    // Se non c'è abbastanza spazio per la tappa, nuova pagina
    if (y > ALTEZZA - 55) {
      doc.addPage();
      y = MARGINE;
    }

    const haFoto = !!t.foto;
    const rientroTitolo = 6; // spazio riservato al pallino colorato prima del titolo
    const larghezzaTesto = (haFoto ? LARGHEZZA_UTILE - 30 : LARGHEZZA_UTILE) - rientroTitolo;

    // Pallino colorato al posto dell'emoji (i font base di jsPDF non supportano le emoji)
    const [r, g, b] = hexARgb(t.tipoColore);
    doc.setFillColor(r, g, b);
    doc.circle(MARGINE + 1.5, y - 1.3, 1.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...COLORI.bluPetrolio);
    const righeTitolo = doc.splitTextToSize(t.titolo || "", larghezzaTesto);
    doc.text(righeTitolo, MARGINE + rientroTitolo, y, { maxWidth: larghezzaTesto });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...COLORI.testoTerziario);
    doc.text(formattaOra(t.orario), LARGHEZZA - MARGINE, y, { align: "right" });

    let yRiga = y + righeTitolo.length * 5.5 + 3;

    if (t.nota) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLORI.testoSecondario);
      const righeNota = doc.splitTextToSize(t.nota, haFoto ? LARGHEZZA_UTILE - 30 : LARGHEZZA_UTILE);
      doc.text(righeNota, MARGINE, yRiga);
      yRiga += righeNota.length * 5;
    }

    if (haFoto) {
      try {
        doc.addImage(t.foto, "JPEG", LARGHEZZA - MARGINE - 26, y + 2, 26, 26);
      } catch (err) {
        console.warn("Foto tappa non incorporabile nel PDF:", err);
      }
      yRiga = Math.max(yRiga, y + 2 + 26 + 4);
    }

    y = yRiga + 12;

    // Linea separatrice sottile tra una tappa e l'altra
    doc.setDrawColor(216, 208, 188);
    doc.setLineWidth(0.2);
    doc.line(MARGINE, y - 6, LARGHEZZA - MARGINE, y - 6);
  });

  return y;
}
