// Deploy in a NEW, separate Apps Script project, never alongside the live script.
// This backend has no bank, payment, mail, PDF or admission-code functions.
const TEST_SPREADSHEET_ID = '1kvTNS2e6IsavmOCOQG__3htPBcISzadckq_Fz0jHziA';
const TEST_SHEET_NAME = 'Test_rezervace';
const TEST_HEADERS = ['Timestamp', 'Jméno', 'Email', 'Typ', 'Kusů', 'Cena',
  'ID testu', 'Status', 'Vstupenka Hash', 'Vybraný stůl',
  'Rozdělit do samostatných PDF', 'Použité kódy', 'Request ID'];

function testJson(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function testTableCapacities() {
  const tables = {};
  for (let i = 1; i <= 70; i++) tables['Sál - Stůl ' + i] = 4;
  for (let i = 1; i <= 20; i++) tables['Ochoz - Stůl ' + i] = 4;
  return tables;
}

// Run once manually from the editor. Creates only the named test sheet.
function setupTestReservations() {
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(25000);
    acquired = true;
    const book = SpreadsheetApp.openById(TEST_SPREADSHEET_ID);
    const sheet = book.getSheetByName(TEST_SHEET_NAME) || book.insertSheet(TEST_SHEET_NAME);
    if (sheet.getLastRow() === 0) sheet.appendRow(TEST_HEADERS);
    return testOrderSheet().getName();
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function testOrderSheet() {
  const sheet = SpreadsheetApp.openById(TEST_SPREADSHEET_ID).getSheetByName(TEST_SHEET_NAME);
  if (!sheet) throw new Error('Nejdříve spusťte setupTestReservations v editoru.');
  const headers = sheet.getRange(1, 1, 1, TEST_HEADERS.length).getValues()[0];
  if (TEST_HEADERS.some((header, i) => header !== headers[i])) {
    throw new Error('Testovací list nemá očekávané hlavičky.');
  }
  return sheet;
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    if (action === 'capabilities') {
      testOrderSheet();
      return testJson({ status: 'success', mode: 'test', protocol: 'randovka-test-v1',
        sheet: TEST_SHEET_NAME, emails: false, payments: false, tickets: false });
    }
    if (action !== 'getTables') throw new Error('Neznámá testovací akce.');
    const tables = testTableCapacities();
    const rows = testOrderSheet().getDataRange().getValues();
    rows.slice(1).forEach(row => {
      if (row[7] === 'TEST – bez platby' && Object.hasOwnProperty.call(tables, row[9])) {
        tables[row[9]] = Math.max(0, tables[row[9]] - Number(row[4]));
      }
    });
    return testJson(tables);
  } catch (error) {
    return testJson({ status: 'error', mode: 'test', message: error.message });
  }
}

// Protect text cells from becoming spreadsheet formulas.
function testCellText(value) {
  return /^[=+@\-]/.test(value) ? "'" + value : value;
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    const data = JSON.parse(e && e.postData && e.postData.contents || '{}');
    if (!data || data.mode !== 'test') throw new Error('Tento endpoint přijímá pouze testy.');
    if (!Number.isInteger(data.count) || data.count < 1 || data.count > 10) {
      throw new Error('Neplatný počet vstupenek.');
    }
    const seating = data.ticketType === 'Místenka ke stolu';
    if (!seating && data.ticketType !== 'Základní vstupenka') throw new Error('Neplatný typ vstupenky.');
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    if (!name || name.length > 150 || /[\r\n]/.test(name)) throw new Error('Neplatné jméno.');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Neplatný e-mail.');
    if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.requestId)) {
      throw new Error('Chybí platný identifikátor testu.');
    }
    const tables = testTableCapacities();
    if (seating && !Object.hasOwnProperty.call(tables, data.table)) throw new Error('Vyberte platný stůl.');
    if (!seating && data.table) throw new Error('Základní vstupenka nemá stůl.');
    const table = seating ? data.table : '';
    const separatePdf = data.count > 1 && data.oddelenePdf === true;
    const price = data.count * (seating ? 450 : 350);

    lock.waitLock(25000);
    acquired = true;
    const sheet = testOrderSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    const duplicate = rows.find(row => row[12] === data.requestId);
    if (duplicate) {
      const existing = JSON.stringify([testCellText(String(duplicate[1])), testCellText(String(duplicate[2])), duplicate[3],
        Number(duplicate[4]), duplicate[9], duplicate[10] === true]);
      const expected = JSON.stringify([testCellText(name), testCellText(email), data.ticketType,
        data.count, table, separatePdf]);
      if (existing !== expected) throw new Error('Identifikátor testu byl již použit pro jiná data.');
      return testJson({ status: 'success', mode: 'test', testId: duplicate[6], totalPrice: Number(duplicate[5]) });
    }
    let total = 0, usedAtTable = 0;
    rows.forEach(row => {
      if (row[7] !== 'TEST – bez platby') return;
      if (row[3] === data.ticketType) total += Number(row[4]);
      if (seating && row[9] === table) usedAtTable += Number(row[4]);
    });
    if (total + data.count > (seating ? 360 : 240)) throw new Error('Testovací kapacita typu vstupenek je vyčerpána.');
    if (seating && usedAtTable + data.count > 4) throw new Error('U testovacího stolu není dostatek míst.');
    const testId = 'TEST-' + Utilities.getUuid();
    sheet.appendRow([new Date(), testCellText(name), testCellText(email), data.ticketType,
      data.count, price, testId, 'TEST – bez platby', '', table, separatePdf, '', data.requestId]);
    SpreadsheetApp.flush();
    return testJson({ status: 'success', mode: 'test', testId: testId, totalPrice: price });
  } catch (error) {
    return testJson({ status: 'error', mode: 'test', message: error.message });
  } finally {
    if (acquired) lock.releaseLock();
  }
}
