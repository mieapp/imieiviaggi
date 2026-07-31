// I miei viaggi - Export PDF Itinerario (mini-guida da Wikivoyage)
// Documento standalone, separato dal PDF del diario di viaggio.
// Richiede jsPDF caricato globalmente (window.jspdf.jsPDF)

const LARGHEZZA = 210;
const MARGINE = 18;
const LARGHEZZA_UTILE = LARGHEZZA - MARGINE * 2;
const ALTEZZA = 297;

const COLORI = {
  bluPetrolio: [27, 46, 53],
  ambra: [201, 123, 61],
  testoSecondario: [92, 90, 80],
  testoTerziario: [139, 133, 119]
};

const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function formattaGiornoMese(iso) {
  const [, mese, giorno] = iso.split('-').map(Number);
  return `${giorno} ${MESI_IT[mese - 1]}`;
}

function formattaDataLocale(data) {
  const anno = data.getFullYear();
  const mese = String(data.getMonth() + 1).padStart(2, '0');
  const giorno = String(data.getDate()).padStart(2, '0');
  return `${anno}-${mese}-${giorno}`;
}

function aggiungiGiorniData(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return formattaDataLocale(d);
}

export function esportaItinerario(soggiorno, modalita, nomeViaggio) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGINE;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...COLORI.bluPetrolio);
  doc.text(soggiorno.citta, MARGINE, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...COLORI.testoSecondario);
  doc.text(modalita === "tutto" ? "Guida completa" : "Itinerario suggerito", MARGINE, y + 15);
  y += 28;

  function scriviBlocco(titolo, elementi) {
    if (!elementi || elementi.length === 0) return;
    if (y > ALTEZZA - 40) { doc.addPage(); y = MARGINE; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...COLORI.ambra);
    doc.text(titolo, MARGINE, y);
    y += 8;

    elementi.forEach(el => {
      if (y > ALTEZZA - 30) { doc.addPage(); y = MARGINE; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...COLORI.bluPetrolio);
      doc.text(el.nome, MARGINE, y);
      y += 5.5;

      if (el.descrizione) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...COLORI.testoSecondario);
        const righe = doc.splitTextToSize(el.descrizione, LARGHEZZA_UTILE);
        doc.text(righe, MARGINE, y);
        y += righe.length * 5;
      }
      y += 5;
    });
    y += 4;
  }

  if (modalita === "tutto") {
    soggiorno.tutto.sezioni.forEach(s => {
      if (y > ALTEZZA - 40) { doc.addPage(); y = MARGINE; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...COLORI.ambra);
      doc.text(s.titolo, MARGINE, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...COLORI.testoSecondario);
      const righe = doc.splitTextToSize(s.testo, LARGHEZZA_UTILE);
      righe.forEach(riga => {
        if (y > ALTEZZA - 20) { doc.addPage(); y = MARGINE; }
        doc.text(riga, MARGINE, y);
        y += 5;
      });
      y += 8;
    });
  } else {
    soggiorno.suggerito.giorni.forEach((g, i) => {
      if (y > ALTEZZA - 40) { doc.addPage(); y = MARGINE; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...COLORI.bluPetrolio);
      doc.text(formattaGiornoMese(aggiungiGiorniData(soggiorno.giornoInizio, i)), MARGINE, y);
      y += 9;
      scriviBlocco("Cosa vedere", g.vedere);
    });
  }

  const fonte = modalita === "tutto" ? soggiorno.tutto.fonte : soggiorno.suggerito.fonte;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORI.testoTerziario);
  doc.text(`Contenuti da Wikivoyage (CC BY-SA) - pagina "${fonte}"`, MARGINE, ALTEZZA - 10);

  const nomeFile = `itinerario-${soggiorno.citta.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  const blobPDF = doc.output("blob");
  const filePDF = new File([blobPDF], nomeFile, { type: "application/pdf" });
  return { file: filePDF, nomeFile };
}
