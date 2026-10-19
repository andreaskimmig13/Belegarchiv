/**
 * Belegarchiv – Google Apps Script Web-App
 * Speichert Belege in Google Drive, Daten in einem Google Sheet,
 * liest Belege mit der Claude API aus, importiert Rechnungen aus Gmail
 * und legt Garantie-Erinnerungen im Google Kalender an.
 *
 * Einmalig ausführen: setup()
 */

const APP_VERSION = '1.7.0';

const CFG = {
  ROOT_FOLDER: 'Belegarchiv',
  EXPORT_FOLDER: 'Exporte',
  SHEET_NAME: 'Belege',
  SHEET_TITLE: 'Belegarchiv – Datenbank',
  GMAIL_LABEL: 'Belegarchiv/importiert',
  GMAIL_LABEL_SEARCH: 'belegarchiv-importiert',
  DEFAULT_MODEL: 'claude-sonnet-5-5',
  GARANTIE_VORLAUF_TAGE: 28,
  RUECKGABE_VORLAUF_TAGE: 2,
  FAELLIG_VORLAUF_TAGE: 2,
  GMAIL_TAGE: 30,
  GMAIL_MAX_THREADS: 25,
  DUPLIKAT_TAGE: 14,
  ERSTATTUNG_ERINNERUNG_TAGE: 14,
  ERSTATTUNG_SUCHE_TAGE: 120,
};

const COLS = [
  'id', 'erfasst_am', 'datum', 'haendler', 'betrag', 'waehrung', 'kategorie',
  'personen', 'produkte', 'zahlungsart', 'steuer', 'lohnanteil',
  'garantie_bis', 'rueckgabe_bis', 'original_aufheben', 'inventar',
  'status', 'quelle', 'datei_id', 'datei_name', 'mime', 'notiz',
  'kalender_ids', 'gmail_id', 'bezahlt', 'faellig_am', 'bestellnummer', 'dokumentart',
  'retoure', 'erstattet', 'erstattung_status', 'retoure_am', 'erstattungen'
];

const EDITABLE = [
  'datum', 'haendler', 'betrag', 'waehrung', 'kategorie', 'personen', 'produkte',
  'zahlungsart', 'steuer', 'lohnanteil', 'garantie_bis', 'rueckgabe_bis',
  'original_aufheben', 'inventar', 'status', 'notiz', 'bezahlt', 'faellig_am', 'bestellnummer', 'dokumentart',
  'retoure', 'erstattet', 'erstattung_status', 'retoure_am'
];

/* Dokumentarten, die als Kaufbeleg übernommen werden – in Rangfolge (Rechnung ist am wertvollsten) */
const BELEG_ARTEN = ['rechnung', 'quittung', 'zahlungsbestaetigung', 'bestellbestaetigung'];

const STEUER_ARTEN = ['Handwerker/haushaltsnah', 'Kinderbetreuung'];

const DEFAULT_PERSONEN = ['Andreas', 'Anna-Lena', 'Paul', 'Emmi'];
const DEFAULT_KATEGORIEN = [
  'Elektronik & Haushalt', 'Lebensmittel & Drogerie', 'Baumarkt & Handwerker',
  'Kleidung & Freizeit', 'Restaurant', 'Tanken', 'Sonstiges'
];

/* ───────────────────────── Einrichtung ───────────────────────── */

function setup() {
  const p = props_();

  let folder = null, uebernommen = false;
  const fid = p.getProperty('ROOT_FOLDER_ID');
  if (fid) { try { folder = DriveApp.getFolderById(fid); if (folder.isTrashed()) folder = null; } catch (e) { folder = null; } }
  if (!folder) {
    // Bestehenden Belegarchiv-Ordner suchen (z. B. nach einem Umzug in ein neues Skript-Projekt)
    let kandidat = null;
    const it = DriveApp.getFoldersByName(CFG.ROOT_FOLDER);
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed()) continue;
      if (f.getFilesByName(CFG.SHEET_TITLE).hasNext()) { folder = f; break; }
      if (!kandidat) kandidat = f;
    }
    if (!folder) folder = kandidat;
    if (folder) uebernommen = true;
    else folder = DriveApp.createFolder(CFG.ROOT_FOLDER);
    p.setProperty('ROOT_FOLDER_ID', folder.getId());
  }

  let ss = null;
  const sid = p.getProperty('SPREADSHEET_ID');
  if (sid) { try { ss = SpreadsheetApp.openById(sid); } catch (e) { ss = null; } }
  if (!ss) {
    const it = folder.getFilesByName(CFG.SHEET_TITLE);
    while (it.hasNext()) {
      const f = it.next();
      if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS) { ss = SpreadsheetApp.openById(f.getId()); uebernommen = true; break; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create(CFG.SHEET_TITLE);
      DriveApp.getFileById(ss.getId()).moveTo(folder);
    }
    p.setProperty('SPREADSHEET_ID', ss.getId());
  }

  let sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) { sh = ss.getSheets()[0]; sh.setName(CFG.SHEET_NAME); }
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@');
  sh.getRange(2, COLS.indexOf('betrag') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.00');
  sh.getRange(2, COLS.indexOf('lohnanteil') + 1, sh.getMaxRows() - 1, 1).setNumberFormat('0.00');

  if (!p.getProperty('PERSONEN')) p.setProperty('PERSONEN', JSON.stringify(DEFAULT_PERSONEN));
  if (!p.getProperty('KATEGORIEN')) p.setProperty('KATEGORIEN', JSON.stringify(DEFAULT_KATEGORIEN));
  if (!p.getProperty('MODEL')) p.setProperty('MODEL', CFG.DEFAULT_MODEL);
  p.deleteProperty('GITHUB_REPO');
  p.deleteProperty('ORDNER_URL'); p.deleteProperty('TABELLE_URL'); p.deleteProperty('HEADER_VERSION');

  if (!GmailApp.getUserLabelByName(CFG.GMAIL_LABEL)) GmailApp.createLabel(CFG.GMAIL_LABEL);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'gmailImportTrigger')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('gmailImportTrigger').timeBased().everyDays(1).atHour(6).create();

  CalendarApp.getDefaultCalendar(); // Kalender-Berechtigung abfragen

  Logger.log(uebernommen
    ? 'Fertig. Bestehende Daten übernommen: ' + Math.max(sh.getLastRow() - 1, 0) + ' Belege.'
    : 'Fertig eingerichtet (neues Archiv angelegt).');
  Logger.log('Drive-Ordner: ' + folder.getUrl());
  Logger.log('Tabelle: ' + ss.getUrl());
}

/* ───────────────────────── Web-App ───────────────────────── */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Belegarchiv')
    .setFaviconUrl('https://andreaskimmig13.github.io/Belegarchiv/favicon.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Einbetten in die Startseite (ohne Google-Hinweisleiste)
}

function getInit() {
  ensureSetup_();
  const p = props_();
  if (p.getProperty('HEADER_VERSION') !== APP_VERSION) { ensureHeader_(); p.setProperty('HEADER_VERSION', APP_VERSION); }
  if (!p.getProperty('ORDNER_URL')) {
    p.setProperty('ORDNER_URL', DriveApp.getFolderById(p.getProperty('ROOT_FOLDER_ID')).getUrl());
    p.setProperty('TABELLE_URL', SpreadsheetApp.openById(p.getProperty('SPREADSHEET_ID')).getUrl());
  }
  return {
    personen: JSON.parse(p.getProperty('PERSONEN') || '[]'),
    kategorien: JSON.parse(p.getProperty('KATEGORIEN') || '[]'),
    hatKey: !!p.getProperty('ANTHROPIC_API_KEY'),
    model: p.getProperty('MODEL') || CFG.DEFAULT_MODEL,
    ordnerUrl: p.getProperty('ORDNER_URL'),
    tabelleUrl: p.getProperty('TABELLE_URL'),
    appVersion: APP_VERSION,
    belege: getAllRows_()
  };
}

/* ───────────────────────── KI-Erkennung ───────────────────────── */

function analyzeReceipt(b64, mime) {
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
  return extract_([block, { type: 'text', text: prompt_() }]);
}

function analyzePages(pages) {
  if (!pages || !pages.length) throw new Error('Keine Seite vorhanden.');
  const blocks = pages.slice(0, 20).map(p => p.mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.b64 } }
    : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.b64 } });
  const hinweis = pages.length > 1
    ? 'Die ' + pages.length + ' Bilder sind die Seiten EINES Belegs in der richtigen Reihenfolge. Werte alle Seiten gemeinsam aus; der Gesamtbetrag steht meist auf der letzten Seite.\n\n'
    : '';
  blocks.push({ type: 'text', text: hinweis + prompt_() });
  return extract_(blocks);
}

function prompt_() {
  const kats = JSON.parse(props_().getProperty('KATEGORIEN') || '[]');
  return [
    'Du liest einen Kaufbeleg aus (Kassenbon, Rechnung oder Bestellbestätigung). Heute ist ' + today_() + '.',
    'Antworte ausschließlich mit einem JSON-Objekt, ohne weiteren Text, mit genau diesen Feldern:',
    '{',
    '  "dokumentart": genau eines von "rechnung" | "quittung" (Kassenbon, Barquittung) | "zahlungsbestaetigung" (z. B. PayPal, Kartenzahlung) | "bestellbestaetigung" | "versandbestaetigung" | "angebot" (auch Kostenvoranschlag, Preisanfrage) | "mahnung" | "erstattung" (Gutschrift, Rückerstattung, Rückzahlung, Retoure verbucht – Geld kommt zurück) | "werbung" | "sonstiges",',
    '  "ist_beleg": true nur, wenn ein Kauf tatsächlich getätigt wurde und ein Betrag genannt ist (rechnung, quittung, zahlungsbestaetigung, bestellbestaetigung); false bei Angeboten, Kostenvoranschlägen, Versandmitteilungen, Mahnungen, Werbung,',
    '  "bestellnummer": Bestell-, Auftrags- oder Rechnungsnummer als Text, falls vorhanden, sonst null,',
    '  Hinweise zur dokumentart: Wörter wie „Angebot“, „Kostenvoranschlag“, „unverbindlich“, „gültig bis“, „Preisauskunft“ oder fehlende Rechnungsnummer bei einem Handwerker sprechen für "angebot". Eine Rechnung hat in der Regel eine Rechnungsnummer und ein Rechnungsdatum. Im Zweifel nicht "rechnung" wählen.',
    '  "datum": "YYYY-MM-DD" (Kauf- bzw. Rechnungsdatum),',
    '  "haendler": kurzer, gebräuchlicher Name des Geschäfts, bei dem gekauft wurde (z. B. "dm", "Bauhaus", "Aral") – nicht der Zahlungsdienst (PayPal, Klarna) und nicht die Person, die die Mail weitergeleitet hat,',
    '  "betrag": Gesamtbetrag brutto als Zahl mit Punkt als Dezimaltrenner – bei dokumentart "erstattung" der erstattete Betrag (positiv),',
    '  "waehrung": z. B. "EUR",',
    '  "kategorie": genau eine aus ' + JSON.stringify(kats) + ',',
    '  "produkte": Liste der Artikel als verständliche Namen – Kürzel vom Bon ausschreiben (z. B. "BOHRM.BOSCH PSB" → "Bosch Schlagbohrmaschine PSB"); bei vielen Positionen höchstens die 8 wichtigsten,',
    '  "zahlungsart": "bar" | "karte" | "ueberweisung" | "paypal" | "lastschrift" | "unbekannt",',
    '  "steuer_art": "Handwerker/haushaltsnah" bei Handwerkerleistungen oder haushaltsnahen Dienstleistungen (§35a EStG, z. B. Reparatur, Wartung, Reinigung, Gartenpflege); "Kinderbetreuung" bei Kinderbetreuungskosten (Kita, Kindergarten, Krippe, Hort, Tagesmutter, Babysitter, Ferienbetreuung; nicht: Schulgeld, Nachhilfe, Sportverein, Musikunterricht); sonst null,',
    '  "lohnanteil": nur bei Handwerker/haushaltsnah: ausgewiesener Arbeits-/Lohnkostenanteil inkl. MwSt als Zahl, sonst null,',
    '  "bezahlt": true, wenn der Beleg eine erfolgte Zahlung zeigt (Kassenbon, Quittung, Zahlungsbestätigung, "bezahlt", Kartenzahlung, Lastschrift erfolgt); false bei einer Rechnung mit Zahlungsaufforderung oder Zahlungsziel,',
    '  "faellig_am": "YYYY-MM-DD" Zahlungsziel/Fälligkeit, falls angegeben, sonst null,',
    '  "garantie_relevant": true bei langlebigen Gebrauchsgütern (Elektronik, Haushaltsgeräte, Werkzeug, Möbel, Fahrräder usw.), sonst false,',
    '  "rueckgabe_tage": auf dem Beleg genannte Umtausch-/Rückgabefrist in Tagen, sonst null,',
    '  "inventar_vorschlag": true bei einzelnen Gegenständen ab etwa 150 € Wert, die für eine Hausratversicherung relevant sind',
    '}',
    'Nicht lesbare Felder: null.'
  ].join('\n');
}

function extract_(content) {
  const txt = callClaude_(content);
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('Die KI-Antwort konnte nicht gelesen werden.');
  const d = JSON.parse(txt.slice(s, e + 1));
  const kats = JSON.parse(props_().getProperty('KATEGORIEN') || '[]');
  if (!kats.includes(d.kategorie)) d.kategorie = kats.includes('Sonstiges') ? 'Sonstiges' : (kats[0] || '');
  d.betrag = d.betrag == null ? null : num_(d.betrag);
  d.lohnanteil = d.lohnanteil == null ? null : num_(d.lohnanteil);
  if (!Array.isArray(d.produkte)) d.produkte = d.produkte ? [String(d.produkte)] : [];
  if (d.datum && !/^\d{4}-\d{2}-\d{2}$/.test(d.datum)) d.datum = null;
  if (d.faellig_am && !/^\d{4}-\d{2}-\d{2}$/.test(d.faellig_am)) d.faellig_am = null;
  d.dokumentart = String(d.dokumentart || '').toLowerCase().replace(/ä/g, 'ae');
  if (d.ist_beleg && d.dokumentart && BELEG_ARTEN.indexOf(d.dokumentart) < 0) d.ist_beleg = false;
  d.bestellnummer = d.bestellnummer ? String(d.bestellnummer).trim() : '';
  if (!STEUER_ARTEN.includes(d.steuer_art)) d.steuer_art = d.handwerker ? STEUER_ARTEN[0] : null;
  if (d.steuer_art !== STEUER_ARTEN[0]) d.lohnanteil = null;
  d.bezahlt = d.bezahlt !== false;
  return d;
}

function callClaude_(content) {
  const p = props_();
  const key = p.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Kein API-Schlüssel hinterlegt (Mehr → Einstellungen).');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: p.getProperty('MODEL') || CFG.DEFAULT_MODEL,
      max_tokens: 1500,
      messages: [{ role: 'user', content: content }]
    })
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    let msg = body;
    try { msg = JSON.parse(body).error.message; } catch (e) { /* roh lassen */ }
    throw new Error('Claude API (' + code + '): ' + msg);
  }
  const json = JSON.parse(body);
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function testApi() {
  callClaude_([{ type: 'text', text: 'Antworte nur mit OK.' }]);
  return 'ok';
}

/* ───────────────────────── Belege CRUD ───────────────────────── */

function saveReceipt(data) {
  ensureSetup_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = Object.assign(emptyRow_(), pick_(data));
    o.id = Utilities.getUuid().slice(0, 8);
    o.erfasst_am = now_();
    o.status = o.status || 'geprüft';
    o.quelle = data.quelle || 'Foto';
    o.gmail_id = data.gmail_id || '';
    o.waehrung = o.waehrung || 'EUR';
    if (!('bezahlt' in data)) o.bezahlt = true;
    if (o.bezahlt) o.faellig_am = '';
    if (data.b64) {
      const blob = Utilities.newBlob(Utilities.base64Decode(data.b64), data.mime, 'beleg');
      const file = storeBlob_(blob, data.mime, o);
      o.datei_id = file.getId();
      o.datei_name = file.getName();
      o.mime = data.mime;
    }
    normRetoure_(o);
    o.kalender_ids = createReminders_(o);
    sheet_().appendRow(toRow_(o));
    return o;
  } finally {
    lock.releaseLock();
  }
}

function updateReceipt(id, fields) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const idx = rowIndex_(id);
    if (idx < 0) throw new Error('Beleg nicht gefunden.');
    const old = toObj_(sh.getRange(idx, 1, 1, COLS.length).getValues()[0]);
    const o = Object.assign({}, old, pick_(fields));
    if (o.bezahlt) o.faellig_am = '';
    normRetoure_(o);

    if (o.datei_id && (o.datum !== old.datum || o.haendler !== old.haendler || o.betrag !== old.betrag)) {
      try {
        const file = DriveApp.getFileById(o.datei_id);
        const ext = (old.datei_name.match(/\.[a-z0-9]+$/i) || [''])[0];
        file.setName(fileName_(o) + ext);
        o.datei_name = file.getName();
        if (o.datum.slice(0, 4) !== old.datum.slice(0, 4)) file.moveTo(yearFolder_(o.datum));
      } catch (e) { Logger.log(e); }
    }

    if (o.garantie_bis !== old.garantie_bis || o.rueckgabe_bis !== old.rueckgabe_bis ||
        o.haendler !== old.haendler || o.produkte !== old.produkte ||
        o.bezahlt !== old.bezahlt || o.faellig_am !== old.faellig_am ||
        o.retoure !== old.retoure || o.erstattung_status !== old.erstattung_status || o.retoure_am !== old.retoure_am) {
      deleteReminders_(old.kalender_ids);
      o.kalender_ids = createReminders_(o);
    }

    sh.getRange(idx, 1, 1, COLS.length).setValues([toRow_(o)]);
    return o;
  } finally {
    lock.releaseLock();
  }
}

function deleteReceipt(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const idx = rowIndex_(id);
    if (idx < 0) return true;
    const o = toObj_(sh.getRange(idx, 1, 1, COLS.length).getValues()[0]);
    if (o.datei_id) { try { DriveApp.getFileById(o.datei_id).setTrashed(true); } catch (e) { Logger.log(e); } }
    deleteReminders_(o.kalender_ids);
    sh.deleteRow(idx);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function getFileData(id) {
  const o = getAllRows_().find(r => r.id === id);
  if (!o || !o.datei_id) return null;
  const file = DriveApp.getFileById(o.datei_id);
  const mime = file.getMimeType();
  const res = { mime: mime, url: file.getUrl() };
  if (mime.indexOf('image/') === 0) res.b64 = Utilities.base64Encode(file.getBlob().getBytes());
  return res;
}

function findDuplicates(datum, betrag, excludeId) {
  if (!datum || betrag == null) return [];
  const b = num_(betrag);
  return getAllRows_()
    .filter(r => r.id !== excludeId && r.datum === datum && Math.abs(r.betrag - b) < 0.01)
    .map(r => ({ id: r.id, haendler: r.haendler, betrag: r.betrag, datum: r.datum, quelle: r.quelle }));
}

/* ───────────────────────── Gmail-Import ───────────────────────── */

function gmailImportTrigger() { importGmail_(); }

function runGmailImport() { return importGmail_(); }

function importGmail_() {
  ensureSetup_();
  ensureHeader_();
  if (!props_().getProperty('ANTHROPIC_API_KEY')) return { importiert: 0, geprueft: 0, hinweis: 'Kein API-Schlüssel' };

  // Nie zwei Läufe gleichzeitig (Morgenlauf + „Jetzt suchen“)
  const cache = CacheService.getScriptCache();
  if (cache.get('gmailImportLaeuft')) return { importiert: 0, geprueft: 0, hinweis: 'Es läuft bereits eine Suche – bitte in ein paar Minuten erneut versuchen.' };
  cache.put('gmailImportLaeuft', '1', 360);

  try {
    const start = Date.now();
    const label = GmailApp.getUserLabelByName(CFG.GMAIL_LABEL) || GmailApp.createLabel(CFG.GMAIL_LABEL);
    const rows = getAllRows_();
    const known = new Set(rows.map(r => r.gmail_id).filter(String));
    const personen = JSON.parse(props_().getProperty('PERSONEN') || '[]');
    const ich = Session.getEffectiveUser().getEmail().toLowerCase();
    const q = 'newer_than:' + CFG.GMAIL_TAGE + 'd -label:' + CFG.GMAIL_LABEL_SEARCH +
      ' -category:promotions -category:social -from:me' +
      ' {rechnung invoice quittung kaufbeleg receipt "ihre bestellung" bestellbestätigung zahlungsbestätigung "your order"' +
    ' erstattung rückerstattung rückzahlung gutschrift refund "retoure"}';
    const threads = GmailApp.search(q, 0, CFG.GMAIL_MAX_THREADS);
    const st = { importiert: 0, zusammengefuehrt: 0, uebersprungen: 0, erstattungen: 0, geprueft: 0 };

    for (const thread of threads) {
      if (Date.now() - start > 4.5 * 60 * 1000) break;
      for (const msg of thread.getMessages()) {
        if (known.has(msg.getId())) continue;
        if (String(msg.getFrom()).toLowerCase().indexOf(ich) >= 0) continue; // selbst gesendet/weitergeleitet
        st.geprueft++;
        try {
          const atts = msg.getAttachments({ includeInlineImages: false })
            .filter(a => /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(a.getContentType()) && a.getSize() > 8000)
            .slice(0, 3);
          const weitergeleitet = /^\s*(wg|fw|fwd)\s*:/i.test(msg.getSubject()) ||
            /(weitergeleitete nachricht|forwarded message|ursprüngliche nachricht|original message)/i.test(msg.getPlainBody().slice(0, 4000));
          const kontext = 'E-Mail von ' + msg.getFrom() + ', Betreff: ' + msg.getSubject() +
            ', empfangen am ' + Utilities.formatDate(msg.getDate(), tz_(), 'yyyy-MM-dd') + '.' +
            (weitergeleitet ? ' ACHTUNG: Diese Mail wurde weitergeleitet. Nur als Beleg werten, wenn eindeutig eine Rechnung oder Quittung über einen getätigten Kauf enthalten ist – nicht bei Angeboten, Anfragen oder Diskussionen über Preise.' : '');
          const ok = d => d.ist_beleg && d.betrag != null && (!weitergeleitet || d.dokumentart === 'rechnung' || d.dokumentart === 'quittung');

          if (atts.length) {
            for (const a of atts) {
              const mime = a.getContentType();
              const b64 = Utilities.base64Encode(a.getBytes());
              const block = mime === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: mime, data: b64 } }
                : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };
              const d = extract_([block, { type: 'text', text: kontext + '\n\n' + prompt_() }]);
              if (d.dokumentart === 'erstattung') { st[verbucheErstattung_(d, msg, rows)]++; continue; }
              if (ok(d)) st[saveFromMail_(d, b64, mime, msg, personen, rows)]++;
              else st.uebersprungen++;
            }
          } else {
            const text = kontext + '\n\nInhalt der E-Mail:\n' + msg.getPlainBody().slice(0, 12000);
            const d = extract_([{ type: 'text', text: text }, { type: 'text', text: prompt_() }]);
            if (d.dokumentart === 'erstattung') st[verbucheErstattung_(d, msg, rows)]++;
            else if (ok(d)) {
              const html = '<html><head><meta charset="utf-8"></head><body>' +
                '<p style="font:12px sans-serif;color:#555">' + escHtml_(kontext) + '</p>' + msg.getBody() + '</body></html>';
              const pdf = Utilities.newBlob(html, 'text/html', 'mail.html').getAs('application/pdf');
              st[saveFromMail_(d, Utilities.base64Encode(pdf.getBytes()), 'application/pdf', msg, personen, rows)]++;
            } else st.uebersprungen++;
          }
        } catch (e) {
          Logger.log('Mail ' + msg.getId() + ': ' + e);
        }
      }
      thread.addLabel(label);
    }
    return st;
  } finally {
    cache.remove('gmailImportLaeuft');
  }
}

/* ── Duplikat-Erkennung ── */
function normH_(s) { return String(s || '').toLowerCase().replace(/\b(gmbh|ag|se|kg|co|ohg|e\.?k|online|shop|de|com)\b/g, '').replace(/[^a-z0-9äöüß]/g, ''); }
function aehnlicherHaendler_(a, b) {
  const x = normH_(a), y = normH_(b);
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0 || x.slice(0, 5) === y.slice(0, 5);
}
function normNr_(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function tageAbstand_(a, b) { return Math.abs(parseDate_(a) - parseDate_(b)) / 864e5; }

function findeGleichenKauf_(d, datum, rows) {
  const nr = normNr_(d.bestellnummer);
  return rows.find(r => {
    if (nr && nr.length >= 4 && normNr_(r.bestellnummer) === nr) return true;
    return Math.abs(r.betrag - d.betrag) < 0.01 && r.datum && tageAbstand_(r.datum, datum) <= CFG.DUPLIKAT_TAGE &&
      aehnlicherHaendler_(r.haendler, d.haendler);
  });
}

/* Erstattungs-Mail dem ursprünglichen Kauf zuordnen – nie als eigener Beleg */
function erstListe_(r) {
  return String(r.erstattungen || '').split(';').filter(String)
    .map(x => { const t = x.split(':'); return { d: t[0], b: Number(t[1]) }; });
}

function verbucheErstattung_(d, msg, rows) {
  if (d.betrag == null || d.betrag <= 0) return 'uebersprungen';
  const datum = d.datum || Utilities.formatDate(msg.getDate(), tz_(), 'yyyy-MM-dd');
  const nr = normNr_(d.bestellnummer);
  const kandidaten = rows
    .filter(r => !(r.retoure === 'komplett' && r.erstattung_status === 'erhalten') && r.datum && r.datum <= datum &&
      tageAbstand_(r.datum, datum) <= CFG.ERSTATTUNG_SUCHE_TAGE &&
      r.betrag - erstListe_(r).reduce((s, x) => s + x.b, 0) >= d.betrag - 0.01)
    .map(r => {
      let p = 0;
      if (nr && nr.length >= 4 && normNr_(r.bestellnummer) === nr) p += 10;
      if (aehnlicherHaendler_(r.haendler, d.haendler)) p += 4;
      if (Math.abs(r.betrag - d.betrag) < 0.01) p += 2;
      if (r.retoure) p += 1;
      return { r: r, p: p };
    })
    .filter(x => x.p >= 4)
    .sort((a, b) => b.p - a.p || b.r.datum.localeCompare(a.r.datum));
  if (!kandidaten.length) return 'uebersprungen';
  const r = kandidaten[0].r;

  // Dieselbe Erstattung nicht doppelt zählen (z. B. Mail vom Händler und von PayPal)
  const liste = erstListe_(r);
  if (liste.some(x => Math.abs(x.b - d.betrag) < 0.01 && tageAbstand_(x.d, datum) <= 10)) return 'uebersprungen';
  liste.push({ d: datum, b: d.betrag });
  const eingegangen = Math.round(liste.reduce((s, x) => s + x.b, 0) * 100) / 100;

  // Erwartete Erstattung (falls Retoure vorher von Hand eingetragen) vs. tatsächlich eingegangen
  const erwartet = r.retoure ? (r.retoure === 'komplett' ? r.betrag : (r.erstattet || 0)) : 0;
  const erstattet = Math.min(r.betrag, Math.max(eingegangen, erwartet));
  const felder = {
    retoure: erstattet >= r.betrag - 0.005 ? 'komplett' : 'teilweise',
    erstattet: erstattet,
    erstattung_status: eingegangen >= erstattet - 0.01 ? 'erhalten' : 'offen',
    retoure_am: r.retoure_am || datum,
    notiz: (r.notiz ? r.notiz + ' · ' : '') + 'Erstattung ' + de_(d.betrag) + ' € am ' + fmtDE_(datum) + ' (Gmail)'
  };
  const erst = liste.map(x => x.d + ':' + x.b).join(';');
  const u = updateReceipt(r.id, felder);
  setzeFelder_(r.id, { erstattungen: erst });
  Object.assign(r, u, { erstattungen: erst });
  return 'erstattungen';
}

function rang_(art) { const i = BELEG_ARTEN.indexOf(art); return i < 0 ? 99 : i; }

function saveFromMail_(d, b64, mime, msg, personen, rows) {
  const datum = d.datum || Utilities.formatDate(msg.getDate(), tz_(), 'yyyy-MM-dd');
  const vorhanden = findeGleichenKauf_(d, datum, rows);

  if (vorhanden) {
    // Gleicher Kauf schon im Archiv: kein neuer Beleg. Ist die neue Mail die bessere Unterlage
    // (z. B. Rechnung statt Bestellbestätigung) und stammt der vorhandene Beleg aus Gmail, Dokument austauschen.
    if (vorhanden.quelle === 'Gmail' && rang_(d.dokumentart) < rang_(vorhanden.dokumentart || 'bestellbestaetigung')) {
      ersetzeDokument_(vorhanden, b64, mime, d);
    } else if (!vorhanden.bestellnummer && d.bestellnummer) {
      setzeFelder_(vorhanden.id, { bestellnummer: d.bestellnummer });
      vorhanden.bestellnummer = d.bestellnummer;
    }
    return 'zusammengefuehrt';
  }

  const nahe = rows.some(r => Math.abs(r.betrag - d.betrag) < 0.01 && r.datum && tageAbstand_(r.datum, datum) <= 3);
  const o = saveReceipt({
    datum: datum,
    haendler: d.haendler || '',
    betrag: d.betrag,
    waehrung: d.waehrung || 'EUR',
    kategorie: d.kategorie,
    personen: personen.length ? [personen[0]] : [],
    produkte: d.produkte,
    zahlungsart: d.zahlungsart || 'unbekannt',
    steuer: d.steuer_art || '',
    lohnanteil: d.lohnanteil,
    bezahlt: d.bezahlt,
    faellig_am: d.bezahlt ? '' : (d.faellig_am || ''),
    garantie_bis: d.garantie_relevant ? addYears_(datum, 2) : '',
    rueckgabe_bis: d.rueckgabe_tage ? addDaysIso_(datum, d.rueckgabe_tage) : '',
    inventar: !!d.inventar_vorschlag,
    original_aufheben: false,
    status: 'zu prüfen',
    notiz: nahe ? 'Mögliches Duplikat – ähnlicher Betrag in den Tagen davor/danach.' : '',
    quelle: 'Gmail',
    gmail_id: msg.getId(),
    bestellnummer: d.bestellnummer,
    dokumentart: d.dokumentart,
    b64: b64,
    mime: mime
  });
  rows.push(o);
  return 'importiert';
}

function ersetzeDokument_(r, b64, mime, d) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (r.datei_id) { try { DriveApp.getFileById(r.datei_id).setTrashed(true); } catch (e) { /* schon weg */ } }
    const file = storeBlob_(Utilities.newBlob(Utilities.base64Decode(b64), mime, 'beleg'), mime, r);
    const neu = { datei_id: file.getId(), datei_name: file.getName(), mime: mime, dokumentart: d.dokumentart };
    if (d.bestellnummer) neu.bestellnummer = d.bestellnummer;
    if (d.bezahlt === false && d.faellig_am && r.bezahlt !== false) { neu.bezahlt = false; neu.faellig_am = d.faellig_am; }
    setzeFelder_(r.id, neu);
    Object.assign(r, neu);
  } finally {
    lock.releaseLock();
  }
}

/* Schreibt einzelne Spalten ohne die übrige Logik von updateReceipt (Dateiname, Erinnerungen). */
function setzeFelder_(id, felder) {
  const sh = sheet_();
  const idx = rowIndex_(id);
  if (idx < 0) return;
  Object.keys(felder).forEach(k => {
    const c = COLS.indexOf(k);
    if (c < 0) return;
    let v = felder[k];
    if (k === 'bezahlt') v = v === false ? 'nein' : 'ja';
    sh.getRange(idx, c + 1).setValue(v == null ? '' : v);
  });
}

/* ── Duplikate bereinigen ── */
function deleteReceipts(ids) {
  (ids || []).forEach(id => deleteReceipt(id));
  return true;
}

function ensureHeader_() {
  const sh = sheet_();
  const cur = sh.getRange(1, 1, 1, COLS.length).getValues()[0];
  if (cur.join('|') !== COLS.join('|')) sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
}

/* ───────────────────────── Exporte ───────────────────────── */

function exportSteuer(jahr) {
  jahr = String(jahr);
  const all = getAllRows_()
    .filter(r => r.steuer && r.datum.indexOf(jahr) === 0 && r.retoure !== 'komplett')
    .sort((a, b) => a.datum.localeCompare(b.datum));
  const hw = all.filter(r => r.steuer === 'Handwerker/haushaltsnah');
  const kb = all.filter(r => r.steuer === 'Kinderbetreuung');
  const link = r => r.datei_id ? DriveApp.getFileById(r.datei_id).getUrl() : '';
  const warnBar = rows => {
    const n = rows.filter(r => r.zahlungsart === 'bar').length;
    return n ? '<p class="warn">Achtung: ' + n + ' Beleg(e) wurden bar bezahlt. Das Finanzamt erkennt hier nur unbare Zahlungen (Überweisung, Lastschrift) an.</p>' : '';
  };
  const warnOffen = rows => {
    const n = rows.filter(r => !r.bezahlt).length;
    return n ? '<p class="warn">' + n + ' Rechnung(en) sind noch als unbezahlt markiert. Abziehbar ist nur, was im Jahr ' + jahr + ' tatsächlich bezahlt wurde.</p>' : '';
  };

  const csv = toCsv_(
    ['Art', 'Datum', 'Händler', 'Leistung', 'Für wen', 'Rechnungsbetrag', 'Lohn-/Arbeitskosten', 'Zahlungsart', 'Bezahlt', 'Beleg'],
    all.map(r => [r.steuer, fmtDE_(r.datum), r.haendler, r.produkte, r.personen, de_(netto_(r)),
      r.lohnanteil == null ? '' : de_(r.lohnanteil), r.zahlungsart, r.bezahlt ? 'ja' : 'nein', link(r)])
  );

  let body = '';
  if (hw.length) {
    const sB = hw.reduce((s, r) => s + netto_(r), 0), sL = hw.reduce((s, r) => s + (r.lohnanteil || 0), 0);
    body += '<h2>Handwerkerleistungen & haushaltsnahe Dienstleistungen (§35a EStG)</h2>' +
      '<table><tr><th>Datum</th><th>Händler</th><th>Leistung</th><th class="r">Betrag</th><th class="r">Lohnanteil</th><th>Zahlung</th></tr>' +
      hw.map(r => '<tr><td>' + fmtDE_(r.datum) + '</td><td>' + escHtml_(r.haendler) + '</td><td>' + escHtml_(r.produkte) +
        '</td><td class="r">' + de_(netto_(r)) + ' €</td><td class="r">' + (r.lohnanteil == null ? '–' : de_(r.lohnanteil) + ' €') +
        '</td><td>' + escHtml_(r.zahlungsart) + (r.bezahlt ? '' : ' (offen)') + '</td></tr>').join('') +
      '<tr class="sum"><td colspan="3">Summe (' + hw.length + ' Belege)</td><td class="r">' + de_(sB) + ' €</td><td class="r">' + de_(sL) + ' €</td><td></td></tr></table>' +
      warnBar(hw) + warnOffen(hw) +
      '<p class="hint">Absetzbar sind nur Arbeits-, Fahrt- und Maschinenkosten, nicht das Material.</p>';
  }
  if (kb.length) {
    const byKind = {};
    kb.forEach(r => {
      const p = String(r.personen || '').split(',').map(x => x.trim()).filter(String);
      const key = p.length ? p.join(', ') : 'ohne Zuordnung';
      (byKind[key] = byKind[key] || []).push(r);
    });
    body += '<h2>Kinderbetreuungskosten (§10 Abs. 1 Nr. 5 EStG)</h2>';
    Object.keys(byKind).sort().forEach(k => {
      const rows = byKind[k], sum = rows.reduce((s, r) => s + netto_(r), 0);
      body += '<h3>' + escHtml_(k) + '</h3><table><tr><th>Datum</th><th>Einrichtung / Person</th><th>Leistung</th><th class="r">Betrag</th><th>Zahlung</th></tr>' +
        rows.map(r => '<tr><td>' + fmtDE_(r.datum) + '</td><td>' + escHtml_(r.haendler) + '</td><td>' + escHtml_(r.produkte) +
          '</td><td class="r">' + de_(netto_(r)) + ' €</td><td>' + escHtml_(r.zahlungsart) + (r.bezahlt ? '' : ' (offen)') + '</td></tr>').join('') +
        '<tr class="sum"><td colspan="3">Summe ' + escHtml_(k) + '</td><td class="r">' + de_(sum) + ' €</td><td></td></tr></table>';
    });
    body += warnBar(kb) + warnOffen(kb) +
      '<p class="hint">Je Kind unter 14 Jahren sind derzeit 80 % der Kosten, höchstens 4.800 € pro Jahr, als Sonderausgaben abziehbar. ' +
      'Nicht abziehbar sind z. B. Verpflegung (Essensgeld), Unterricht und Freizeitaktivitäten. Belege, die mehrere Kinder betreffen, bitte aufteilen.</p>';
  }
  if (!all.length) body = '<p>Für ' + jahr + ' sind keine steuerlich markierten Belege vorhanden.</p>';
  body += '<p class="hint">Automatisch erstellte Übersicht – bitte vor der Abgabe prüfen.</p>';

  return writeExports_('Steuer_' + jahr, csv, pdfHtml_('Steuer-Export ' + jahr, body), all.length);
}

function exportJahr(jahr) {
  jahr = String(jahr);
  const rows = getAllRows_().filter(r => r.datum.indexOf(jahr) === 0).sort((a, b) => a.datum.localeCompare(b.datum));
  const csv = toCsv_(
    ['Datum', 'Händler', 'Betrag', 'Retoure', 'Erstattet', 'Netto', 'Kategorie', 'Für wen', 'Produkte', 'Zahlungsart', 'Bezahlt', 'Fällig am', 'Steuer', 'Lohnanteil', 'Garantie bis', 'Notiz', 'Quelle'],
    rows.map(r => [fmtDE_(r.datum), r.haendler, de_(r.betrag), r.retoure, r.erstattet == null ? '' : de_(r.erstattet), de_(netto_(r)), r.kategorie, r.personen, r.produkte, r.zahlungsart,
      r.bezahlt ? 'ja' : 'nein', fmtDE_(r.faellig_am), r.steuer, r.lohnanteil == null ? '' : de_(r.lohnanteil), fmtDE_(r.garantie_bis), r.notiz, r.quelle])
  );
  return writeExports_('Alle_Belege_' + jahr, csv, null, rows.length);
}

function exportInventar() {
  const rows = getAllRows_().filter(r => r.inventar && r.retoure !== 'komplett').sort((a, b) => a.datum.localeCompare(b.datum));
  const sum = rows.reduce((s, r) => s + r.betrag, 0);
  const html = pdfHtml_('Hausrat-Inventarliste',
    '<p class="hint">Stand: ' + fmtDE_(today_()) + '</p>' +
    '<table><tr><th>Gegenstand</th><th>Kaufdatum</th><th>Händler</th><th class="r">Kaufpreis</th><th>Beleg</th></tr>' +
    rows.map(r => '<tr><td>' + escHtml_(r.produkte || r.haendler) + '</td><td>' + fmtDE_(r.datum) + '</td><td>' + escHtml_(r.haendler) +
      '</td><td class="r">' + de_(r.betrag) + ' €</td><td>' +
      (r.datei_id ? '<a href="' + DriveApp.getFileById(r.datei_id).getUrl() + '">öffnen</a>' : '–') + '</td></tr>').join('') +
    '<tr class="sum"><td colspan="3">Gesamtwert (' + rows.length + ' Positionen)</td><td class="r">' + de_(sum) + ' €</td><td></td></tr></table>');
  const csv = toCsv_(['Gegenstand', 'Kaufdatum', 'Händler', 'Kaufpreis'],
    rows.map(r => [r.produkte || r.haendler, fmtDE_(r.datum), r.haendler, de_(r.betrag)]));
  return writeExports_('Inventarliste_' + today_(), csv, html, rows.length);
}

function writeExports_(name, csv, html, anzahl) {
  const root = DriveApp.getFolderById(props_().getProperty('ROOT_FOLDER_ID'));
  const folder = subFolder_(root, CFG.EXPORT_FOLDER);
  const res = { anzahl: anzahl };
  if (csv != null) res.csvUrl = folder.createFile(Utilities.newBlob('﻿' + csv, 'text/csv', name + '.csv')).getUrl();
  if (html != null) {
    const pdf = Utilities.newBlob(html, 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf');
    res.pdfUrl = folder.createFile(pdf).getUrl();
  }
  return res;
}

function pdfHtml_(title, body) {
  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10pt;color:#222;margin:24px}h1{font-size:15pt;margin:0 0 12px}h2{font-size:12pt;margin:22px 0 4px}h3{font-size:10.5pt;margin:14px 0 0}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}' +
    'th{background:#f2f2f2}.r{text-align:right;white-space:nowrap}.sum td{font-weight:bold;border-top:2px solid #333}' +
    '.warn{color:#9a3412;margin-top:14px}.hint{color:#666;margin-top:10px}' +
    '</style></head><body><h1>' + escHtml_(title) + '</h1>' + body + '</body></html>';
}

/* ───────────────────────── Einstellungen ───────────────────────── */

function saveSettings(s) {
  const p = props_();
  const clean = arr => (arr || []).map(x => String(x).trim()).filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i);
  if (s.personen) p.setProperty('PERSONEN', JSON.stringify(clean(s.personen)));
  if (s.kategorien) p.setProperty('KATEGORIEN', JSON.stringify(clean(s.kategorien)));
  if (s.apiKey) p.setProperty('ANTHROPIC_API_KEY', String(s.apiKey).trim());
  if (s.model) p.setProperty('MODEL', String(s.model).trim());
  return {
    personen: JSON.parse(p.getProperty('PERSONEN')),
    kategorien: JSON.parse(p.getProperty('KATEGORIEN')),
    hatKey: !!p.getProperty('ANTHROPIC_API_KEY'),
    model: p.getProperty('MODEL')
  };
}

/* ───────────────────────── Kalender ───────────────────────── */

function netto_(r) {
  if (r.retoure === 'komplett') return 0;
  return Math.max(0, Math.round((r.betrag - (r.erstattet || 0)) * 100) / 100);
}

function normRetoure_(o) {
  if (o.retoure !== 'teilweise' && o.retoure !== 'komplett') {
    o.retoure = ''; o.erstattet = null; o.erstattung_status = ''; o.retoure_am = '';
    return;
  }
  if (!o.retoure_am) o.retoure_am = today_();
  if (o.erstattung_status !== 'erhalten') o.erstattung_status = 'offen';
  if (o.retoure === 'teilweise' && o.erstattet != null && o.erstattet >= o.betrag - 0.005) o.retoure = 'komplett';
  if (o.retoure === 'komplett') {
    o.erstattet = o.betrag;
    o.garantie_bis = ''; o.rueckgabe_bis = ''; o.inventar = false;
  }
}

function createReminders_(o) {
  const ids = [];
  try {
    const cal = CalendarApp.getDefaultCalendar();
    const heute = parseDate_(today_());
    const was = (o.produkte ? String(o.produkte).split(';')[0].trim() : '') || o.haendler || 'Beleg';
    const info = 'Händler: ' + o.haendler + '\nKaufdatum: ' + fmtDE_(o.datum) + '\nBetrag: ' + de_(o.betrag) + ' €';
    if (o.retoure && o.erstattung_status === 'offen') {
      let d = addDays_(parseDate_(o.retoure_am || today_()), CFG.ERSTATTUNG_ERINNERUNG_TAGE);
      if (d < heute) d = heute;
      const soll = o.retoure === 'komplett' ? o.betrag : (o.erstattet || 0);
      ids.push(cal.createAllDayEvent('Erstattung prüfen: ' + (o.haendler || was) + (soll ? ' (' + de_(soll) + ' €)' : ''), d,
        { description: 'Retoure ' + o.retoure + ' am ' + fmtDE_(o.retoure_am) + ' – ist das Geld schon zurück?\n' + info }).getId());
    }
    if (o.retoure === 'komplett') return ids.join(',');
    if (o.garantie_bis) {
      const d = addDays_(parseDate_(o.garantie_bis), -CFG.GARANTIE_VORLAUF_TAGE);
      if (d >= heute) ids.push(cal.createAllDayEvent('Garantie endet bald: ' + was, d,
        { description: 'Garantie/Gewährleistung bis ' + fmtDE_(o.garantie_bis) + '\n' + info }).getId());
    }
    if (o.rueckgabe_bis) {
      let d = addDays_(parseDate_(o.rueckgabe_bis), -CFG.RUECKGABE_VORLAUF_TAGE);
      if (d < heute) d = heute;
      if (parseDate_(o.rueckgabe_bis) >= heute) ids.push(cal.createAllDayEvent('Rückgabefrist endet: ' + was, d,
        { description: 'Rückgabe möglich bis ' + fmtDE_(o.rueckgabe_bis) + '\n' + info }).getId());
    }
    if (o.faellig_am && o.bezahlt === false) {
      let d = addDays_(parseDate_(o.faellig_am), -CFG.FAELLIG_VORLAUF_TAGE);
      if (d < heute) d = heute;
      ids.push(cal.createAllDayEvent('Rechnung bezahlen: ' + (o.haendler || was) + ' (' + de_(o.betrag) + ' €)', d,
        { description: 'Fällig am ' + fmtDE_(o.faellig_am) + '\n' + info }).getId());
    }
  } catch (e) { Logger.log('Kalender: ' + e); }
  return ids.join(',');
}

function deleteReminders_(idsStr) {
  String(idsStr || '').split(',').filter(String).forEach(id => {
    try { const ev = CalendarApp.getEventById(id); if (ev) ev.deleteEvent(); } catch (e) { /* ignorieren */ }
  });
}

/* ───────────────────────── Hilfsfunktionen ───────────────────────── */

function props_() { return PropertiesService.getScriptProperties(); }
function tz_() { return Session.getScriptTimeZone() || 'Europe/Berlin'; }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }

function ensureSetup_() {
  if (!props_().getProperty('SPREADSHEET_ID')) {
    throw new Error('Bitte zuerst im Skript-Editor die Funktion „setup“ ausführen.');
  }
}

function sheet_() {
  return SpreadsheetApp.openById(props_().getProperty('SPREADSHEET_ID')).getSheetByName(CFG.SHEET_NAME);
}

function getAllRows_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLS.length).getValues().filter(r => r[0]).map(toObj_);
}

function rowIndex_(id) {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function emptyRow_() { const o = {}; COLS.forEach(c => o[c] = ''); return o; }

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return v == null ? '' : String(v);
}

function num_(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v == null ? '' : v).trim().replace(/[€\s]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function toObj_(r) {
  const o = {};
  COLS.forEach((c, i) => o[c] = str_(r[i]));
  o.betrag = num_(o.betrag);
  o.lohnanteil = o.lohnanteil === '' ? null : num_(o.lohnanteil);
  o.original_aufheben = o.original_aufheben === 'ja';
  o.inventar = o.inventar === 'ja';
  o.bezahlt = o.bezahlt !== 'nein';
  o.erstattet = o.erstattet === '' ? null : num_(o.erstattet);
  return o;
}

function toRow_(o) {
  return COLS.map(c => {
    const v = o[c];
    if (c === 'original_aufheben' || c === 'inventar') return v ? 'ja' : '';
    if (c === 'bezahlt') return v === false ? 'nein' : 'ja';
    if (v == null) return '';
    return v;
  });
}

function pick_(data) {
  const o = {};
  EDITABLE.forEach(k => {
    if (!(k in data)) return;
    let v = data[k];
    if (k === 'personen' && Array.isArray(v)) v = v.join(', ');
    if (k === 'produkte' && Array.isArray(v)) v = v.join('; ');
    if (k === 'betrag') v = num_(v);
    if (k === 'lohnanteil' || k === 'erstattet') v = (v === '' || v == null) ? null : num_(v);
    if (k === 'original_aufheben' || k === 'inventar' || k === 'bezahlt') v = !!v;
    if (typeof v === 'string') v = v.trim();
    o[k] = v;
  });
  return o;
}

function storeBlob_(blob, mime, o) {
  const ext = mime === 'application/pdf' ? '.pdf'
    : '.' + (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  blob.setName(fileName_(o) + ext);
  return yearFolder_(o.datum || today_()).createFile(blob);
}

function yearFolder_(datum) {
  const root = DriveApp.getFolderById(props_().getProperty('ROOT_FOLDER_ID'));
  return subFolder_(root, String(datum || today_()).slice(0, 4));
}

function subFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function fileName_(o) {
  const h = String(o.haendler || 'Beleg').replace(/[\\/:*?"<>|#%]/g, '-').slice(0, 40);
  return (o.datum || today_()) + '_' + h + '_' + de_(o.betrag || 0) + 'EUR';
}

function parseDate_(iso) {
  const p = String(iso).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addDaysIso_(iso, n) { return Utilities.formatDate(addDays_(parseDate_(iso), n), tz_(), 'yyyy-MM-dd'); }
function addYears_(iso, n) { const d = parseDate_(iso); d.setFullYear(d.getFullYear() + n); return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }

function fmtDE_(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : String(iso);
}

function de_(n) { return (Number(n) || 0).toFixed(2).replace('.', ','); }

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toCsv_(head, rows) {
  const q = v => {
    const s = String(v == null ? '' : v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [head].concat(rows).map(r => r.map(q).join(';')).join('\r\n');
}
