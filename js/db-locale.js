// I miei viaggi - Modulo di storage locale (IndexedDB)
//
// Sostituisce Firestore con un database locale nel browser. Le funzioni sono
// pensate per rispecchiare, nel nome e nel comportamento, quelle Firestore
// usate in "Diario di viaggio" (addDoc/updateDoc/deleteDoc/getDocs/getDoc),
// cosi' il porting delle pagine e' quasi un trova-e-sostituisci concettuale.
//
// Non c'e' alcuna scrittura "in sospeso senza await": IndexedDB e' locale e
// istantaneo, non esiste un problema di rete da gestire.

const NOME_DB = "IMieiViaggiDB";
const VERSIONE_DB = 1;

let dbPromise = null;

// Apre (o crea, alla prima esecuzione) il database locale.
// Va chiamata una volta sola; il risultato viene tenuto in cache per le
// chiamate successive, cosi' ogni pagina puo' semplicemente importare questo
// modulo e usare le funzioni sotto senza preoccuparsi dell'apertura.
function apriDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const richiesta = indexedDB.open(NOME_DB, VERSIONE_DB);

    richiesta.onupgradeneeded = (evento) => {
      const db = evento.target.result;

      if (!db.objectStoreNames.contains("viaggi")) {
        db.createObjectStore("viaggi", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("tappe")) {
        const storeTappe = db.createObjectStore("tappe", { keyPath: "id" });
        // Indice secondario per recuperare velocemente tutte le tappe di un
        // dato viaggio, senza dover scorrere l'intero store.
        storeTappe.createIndex("viaggioId", "viaggioId", { unique: false });
      }
    };

    richiesta.onsuccess = (evento) => resolve(evento.target.result);
    richiesta.onerror = (evento) => reject(evento.target.error);
  });

  return dbPromise;
}

// Genera un identificativo locale univoco, equivalente all'id generato da
// Firestore per ogni nuovo documento.
function generaId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Ripiego per browser molto datati senza crypto.randomUUID.
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

// Esegue un'operazione su uno store dentro una transazione, restituendo una
// Promise. Funzione di supporto interna, non esposta alle pagine.
async function conTransazione(nomeStore, modalita, esecutore) {
  const db = await apriDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(nomeStore, modalita);
    const store = tx.objectStore(nomeStore);
    let risultato;

    Promise.resolve(esecutore(store))
      .then((valore) => { risultato = valore; })
      .catch(reject);

    tx.oncomplete = () => resolve(risultato);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Converte una IDBRequest in una Promise, per poterla usare con await.
function richiestaAPromise(richiesta) {
  return new Promise((resolve, reject) => {
    richiesta.onsuccess = () => resolve(richiesta.result);
    richiesta.onerror = () => reject(richiesta.error);
  });
}

// ---------------------------------------------------------------------------
// VIAGGI
// ---------------------------------------------------------------------------

// Crea un nuovo viaggio. Equivalente a addDoc(collection(db, "viaggi"), dati).
// Riceve i dati del viaggio (nome, dataInizio, dataFine, ecc.) e aggiunge in
// automatico id, creatoIl e ultimoBackup: null.
async function creaViaggio(datiViaggio) {
  const viaggio = {
    ...datiViaggio,
    id: generaId(),
    creatoIl: new Date().toISOString(),
    ultimoBackup: datiViaggio.ultimoBackup ?? null,
  };

  await conTransazione("viaggi", "readwrite", (store) => {
    store.add(viaggio);
  });

  return viaggio;
}

// Restituisce un singolo viaggio dato il suo id, oppure null se non esiste.
// Equivalente a getDoc(doc(db, "viaggi", id)).
async function ottieniViaggio(viaggioId) {
  const viaggio = await conTransazione("viaggi", "readonly", (store) => {
    return richiestaAPromise(store.get(viaggioId));
  });
  return viaggio ?? null;
}

// Restituisce tutti i viaggi salvati sul dispositivo, ordinati per data di
// creazione (piu' recente prima). Equivalente a getDocs(collection(db, "viaggi"))
// ma senza filtro sui partecipanti, dato che qui ogni dispositivo ha solo i
// propri viaggi.
async function ottieniTuttiViaggi() {
  const viaggi = await conTransazione("viaggi", "readonly", (store) => {
    return richiestaAPromise(store.getAll());
  });
  return viaggi.sort((a, b) => (b.creatoIl || "").localeCompare(a.creatoIl || ""));
}

// Aggiorna solo i campi passati in "campiParziali", lasciando intatti gli
// altri. Equivalente a updateDoc(doc(db, "viaggi", id), campiParziali).
async function aggiornaViaggio(viaggioId, campiParziali) {
  return conTransazione("viaggi", "readwrite", async (store) => {
    const viaggio = await richiestaAPromise(store.get(viaggioId));
    if (!viaggio) {
      throw new Error(`Viaggio non trovato: ${viaggioId}`);
    }
    const viaggioAggiornato = { ...viaggio, ...campiParziali };
    store.put(viaggioAggiornato);
    return viaggioAggiornato;
  });
}

// Elimina un viaggio E tutte le sue tappe (cancellazione a cascata).
// Equivalente a deleteDoc(doc(db, "viaggi", id)), ma qui la cascata va fatta
// a mano perche' IndexedDB non la fa in automatico come le sottocollezioni
// Firestore.
async function eliminaViaggio(viaggioId) {
  const tappeDelViaggio = await ottieniTappePerViaggio(viaggioId);

  await conTransazione("tappe", "readwrite", (store) => {
    tappeDelViaggio.forEach((tappa) => store.delete(tappa.id));
  });

  await conTransazione("viaggi", "readwrite", (store) => {
    store.delete(viaggioId);
  });
}

// Da chiamare quando un export di backup va a buon fine: aggiorna solo la
// data dell'ultimo backup riuscito, usata per l'avviso a due livelli in fase
// di eliminazione (vedi sezione 7-bis della spec).
async function registraBackupEsportato(viaggioId) {
  return aggiornaViaggio(viaggioId, { ultimoBackup: new Date().toISOString() });
}

// Scrive un viaggio con un id specifico, sovrascrivendo se esiste già.
// A differenza di creaViaggio (che genera sempre un nuovo id), questa serve
// solo al flusso di import-con-sovrascrittura di un backup, per riusare
// l'id di un viaggio già esistente invece di generarne uno nuovo.
async function impostaViaggio(viaggio) {
  await conTransazione("viaggi", "readwrite", (store) => {
    store.put(viaggio);
  });
  return viaggio;
}

// ---------------------------------------------------------------------------
// TAPPE
// ---------------------------------------------------------------------------

// Crea una nuova tappa per un viaggio. Equivalente a
// addDoc(collection(db, "viaggi", viaggioId, "tappe"), datiTappa).
async function creaTappa(viaggioId, datiTappa) {
  const tappa = {
    ...datiTappa,
    id: generaId(),
    viaggioId,
  };

  await conTransazione("tappe", "readwrite", (store) => {
    store.add(tappa);
  });

  return tappa;
}

// Restituisce una singola tappa dato il suo id.
// Equivalente a getDoc(doc(db, "viaggi", viaggioId, "tappe", tappaId)).
async function ottieniTappa(tappaId) {
  const tappa = await conTransazione("tappe", "readonly", (store) => {
    return richiestaAPromise(store.get(tappaId));
  });
  return tappa ?? null;
}

// Restituisce tutte le tappe di un viaggio, ordinate per orario crescente.
// Equivalente a getDocs(query(collection(db, "viaggi", viaggioId, "tappe"), orderBy("orario", "asc"))).
async function ottieniTappePerViaggio(viaggioId) {
  const tappe = await conTransazione("tappe", "readonly", (store) => {
    const indice = store.index("viaggioId");
    return richiestaAPromise(indice.getAll(viaggioId));
  });
  return tappe.sort((a, b) => (a.orario || "").localeCompare(b.orario || ""));
}

// Restituisce solo le tappe di un viaggio per un giorno specifico (formato
// "YYYY-MM-DD"), ordinate per orario. Equivalente alla query con where("data", "==", giorno)
// + orderBy("orario", "asc") usata in viaggio.html, ma senza onSnapshot: qui
// e' una lettura singola, la pagina la richiama esplicitamente dopo ogni
// salvataggio per aggiornare la vista.
async function ottieniTappePerGiorno(viaggioId, giorno) {
  const tutte = await ottieniTappePerViaggio(viaggioId);
  return tutte.filter((tappa) => tappa.data === giorno);
}

// Aggiorna solo i campi passati in "campiParziali" di una tappa esistente.
// Equivalente a updateDoc(doc(db, "viaggi", viaggioId, "tappe", tappaId), campiParziali).
async function aggiornaTappa(tappaId, campiParziali) {
  return conTransazione("tappe", "readwrite", async (store) => {
    const tappa = await richiestaAPromise(store.get(tappaId));
    if (!tappa) {
      throw new Error(`Tappa non trovata: ${tappaId}`);
    }
    const tappaAggiornata = { ...tappa, ...campiParziali };
    store.put(tappaAggiornata);
    return tappaAggiornata;
  });
}

// Elimina una singola tappa.
// Equivalente a deleteDoc(doc(db, "viaggi", viaggioId, "tappe", tappaId)).
async function eliminaTappa(tappaId) {
  return conTransazione("tappe", "readwrite", (store) => {
    store.delete(tappaId);
  });
}

export {
  apriDB,
  creaViaggio,
  ottieniViaggio,
  ottieniTuttiViaggi,
  aggiornaViaggio,
  eliminaViaggio,
  registraBackupEsportato,
  impostaViaggio,
  creaTappa,
  ottieniTappa,
  ottieniTappePerViaggio,
  ottieniTappePerGiorno,
  aggiornaTappa,
  eliminaTappa,
};
