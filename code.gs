/***************************************
 * Axentro Ledger WebApp API (GET only)
 * ✅ JSONP via ?callback=fn (for GitHub Pages CORS)
 *
 * Sheets:
 * - Meta(key,value)
 * - Transactions(id,date,type,party,desc,category,notes,total,createdAt,updatedAt,isDeleted)
 * - Payments(id,entryId,date,party,amount,note,flow,createdAt,updatedAt,isDeleted)
 * - Trash(id,refTable,refId,deletedAt,reason,snapshotJson)
 ****************************************/

const DEFAULT_PIN = "1234";
const PROP_PIN_KEY = "LEDGER_PIN"; // Script Properties

function getPin_(){
  try{
    return PropertiesService.getScriptProperties().getProperty(PROP_PIN_KEY) || DEFAULT_PIN;
  }catch(_){
    return DEFAULT_PIN;
  }
}

const SPREADSHEET_ID = "";        // اتركه فاضي لو السكربت "مرتبط بالشيت" (Container-bound)

const SHEETS = {
  META: "Meta",
  TX: "Transactions",
  PAY: "Payments",
  TRASH: "Trash",
};

const HEADERS = {
  [SHEETS.META]: ["key", "value"],
  [SHEETS.TX]: ["id","date","type","party","desc","category","notes","total","createdAt","updatedAt","isDeleted"],
  [SHEETS.PAY]: ["id","entryId","date","party","amount","note","flow","createdAt","updatedAt","isDeleted"],
  [SHEETS.TRASH]: ["id","refTable","refId","deletedAt","reason","snapshotJson"],
};

const META_DEFAULTS = [
  ["version", 1],
  ["seq_tx", 0],
  ["seq_pay", 0],
];

/* ===================== Concurrency ===================== */
/**
 * Prevent race conditions when multiple devices write simultaneously.
 */
function withWriteLock_(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{
    return fn();
  }finally{
    try{ lock.releaseLock(); }catch(_){}
  }
}


/* ===================== WebApp Entry ===================== */

function doGet(e){
  let cb = "";
  try{
    cb = String((e && e.parameter && e.parameter.callback) || "");
    const pin = String((e && e.parameter && e.parameter.pin) || "");
    if(pin !== getPin_()) return jsonOut_({ ok:false, error:"BAD_PIN" }, cb);

    const action = String((e && e.parameter && e.parameter.action) || "").trim();
    const payloadStr = String((e && e.parameter && e.parameter.payload) || "{}");
    const payload = safeJsonParse_(payloadStr, {});

    ensureSchemaOnce_();

    switch(action){
      case "init":
        return jsonOut_({ ok:true, version: 1, ts: Date.now() }, cb);

      case "getAll":
        return jsonOut_(handleGetAll_(), cb);

      case "addEntry":
        return jsonOut_(withWriteLock_(()=>handleAddEntry_(payload)), cb);

      case "addPayment":
        return jsonOut_(withWriteLock_(()=>handleAddPayment_(payload)), cb);

      case "deleteEntry":
        return jsonOut_(withWriteLock_(()=>handleDeleteEntry_(payload)), cb);

      case "deletePayment":
        return jsonOut_(withWriteLock_(()=>handleDeletePayment_(payload)), cb);

      case "getTrash":
        return jsonOut_(handleGetTrash_(), cb);

      // ✅ Restore حقيقي (يرجع نفس الصف + يمسح سجل الـ Trash)
      case "restoreTrash":
        return jsonOut_(withWriteLock_(()=>handleRestoreTrash_(payload)), cb);

      case "deleteTrashLog":
        return jsonOut_(withWriteLock_(()=>handleDeleteTrashLog_(payload)), cb);

      default:
        return jsonOut_({ ok:false, error:"BAD_ACTION" }, cb);
    }

  }catch(err){
    return jsonOut_(
      { ok:false, error:"SERVER_ERROR", details:String(err && err.message ? err.message : err) },
      cb
    );
  }
}

/* ===================== Handlers ===================== */

function handleGetAll_(){
  const ss = getSS_();
  const txSh = ss.getSheetByName(SHEETS.TX);
  const paySh = ss.getSheetByName(SHEETS.PAY);
  const trashSh = ss.getSheetByName(SHEETS.TRASH);

  // ✅ تنظيف تكرارات قديمة (لو موجودة) مرة خفيفة عند القراءة
  dedupeByIdKeepLatest_(txSh, HEADERS[SHEETS.TX]);
  dedupeByIdKeepLatest_(paySh, HEADERS[SHEETS.PAY]);

  const tx = readTable_(txSh, HEADERS[SHEETS.TX]);
  const pay = readTable_(paySh, HEADERS[SHEETS.PAY]);
  const trash = readTable_(trashSh, HEADERS[SHEETS.TRASH]);

  const entries = tx.filter(r => String(r.isDeleted || "") !== "1");
  const payments = pay
    .filter(r => String(r.isDeleted || "") !== "1")
    .map(p => ({ ...p, flow: (p.flow === "in" || p.flow === "out") ? p.flow : "out" }));

  return { ok:true, entries, payments, trash };
}

function handleAddEntry_(payload){
  const entry = payload && payload.entry;
  if(!entry || !entry.id) return { ok:false, error:"BAD_PAYLOAD" };

  const ss = getSS_();
  const sh = ss.getSheetByName(SHEETS.TX);

  const now = Date.now();
  const row = {
    id: String(entry.id),
    date: String(entry.date || ""),
    type: String(entry.type || ""),
    party: String(entry.party || ""),
    desc: String(entry.desc || ""),
    category: String(entry.category || ""),
    notes: String(entry.notes || ""),
    total: num_(entry.total),
    createdAt: num_(entry.createdAt || now),
    updatedAt: now,
    isDeleted: "0",
  };

  // ✅ Upsert: لو موجودة نفس الـ ID نعمل Update (مش Append)
  upsertById_(sh, HEADERS[SHEETS.TX], row);

  // ✅ أي تكرار قديم يتشال
  dedupeByIdKeepLatest_(sh, HEADERS[SHEETS.TX]);

  return { ok:true };
}

function handleAddPayment_(payload){
  const payment = payload && payload.payment;
  if(!payment || !payment.id || !payment.entryId) return { ok:false, error:"BAD_PAYLOAD" };

  const ss = getSS_();
  const sh = ss.getSheetByName(SHEETS.PAY);

  const now = Date.now();
  const row = {
    id: String(payment.id),
    entryId: String(payment.entryId),
    date: String(payment.date || ""),
    party: String(payment.party || ""),
    amount: num_(payment.amount),
    note: String(payment.note || ""),
    flow: (payment.flow === "in" ? "in" : "out"),
    createdAt: num_(payment.createdAt || now),
    updatedAt: now,
    isDeleted: "0",
  };

  // ✅ Upsert
  upsertById_(sh, HEADERS[SHEETS.PAY], row);

  // ✅ شيل أي تكرار قديم
  dedupeByIdKeepLatest_(sh, HEADERS[SHEETS.PAY]);

  return { ok:true };
}

function handleDeleteEntry_(payload){
  const entryId = String(payload && payload.entryId || "");
  if(!entryId) return { ok:false, error:"BAD_PAYLOAD" };

  const snapshot = payload && payload.snapshot || null;

  const ss = getSS_();
  const tx = ss.getSheetByName(SHEETS.TX);
  const pay = ss.getSheetByName(SHEETS.PAY);

  // ✅ Soft delete على نفس الصف (ولو فيه تكرارات قديمة هنظبطها)
  softDeleteById_(tx, HEADERS[SHEETS.TX], entryId);
  softDeleteByEntryId_(pay, HEADERS[SHEETS.PAY], entryId);

  // ✅ لو فيه تكرارات قديمة: خليك على Latest فقط
  dedupeByIdKeepLatest_(tx, HEADERS[SHEETS.TX]);
  dedupeByIdKeepLatest_(pay, HEADERS[SHEETS.PAY]);

  addTrash_(ss, {
    refTable: "Transactions",
    refId: entryId,
    reason: "delete_entry",
    snapshotJson: JSON.stringify(snapshot || {}),
  });

  return { ok:true };
}

function handleDeletePayment_(payload){
  const payId = String(payload && payload.payId || "");
  if(!payId) return { ok:false, error:"BAD_PAYLOAD" };

  const snapshot = payload && payload.snapshot || null;

  const ss = getSS_();
  const sh = ss.getSheetByName(SHEETS.PAY);

  softDeleteById_(sh, HEADERS[SHEETS.PAY], payId);
  dedupeByIdKeepLatest_(sh, HEADERS[SHEETS.PAY]);

  addTrash_(ss, {
    refTable: "Payments",
    refId: payId,
    reason: "delete_payment",
    snapshotJson: JSON.stringify(snapshot || {}),
  });

  return { ok:true };
}

function handleGetTrash_(){
  const ss = getSS_();
  const trash = readTable_(ss.getSheetByName(SHEETS.TRASH), HEADERS[SHEETS.TRASH]);
  return { ok:true, trash };
}

/**
 * ✅ Restore حقيقي:
 * - لو Transactions: يرجع العملية لنفس الـ ID (Update isDeleted=0) + يرجع مدفوعاتها إن وجدت
 * - لو Payments: يرجع الدفعة لنفس الـ ID (Update isDeleted=0)
 * - وبعدها يمسح سجل Trash الخاص بالعنصر
 */
function handleRestoreTrash_(payload){
  const refTable = String(payload && payload.refTable || "");
  const refId = String(payload && payload.refId || "");
  const snapshot = payload && payload.snapshot || safeJsonParse_(String(payload && payload.snapshotJson || "{}"), {});
  if(!refTable || !refId) return { ok:false, error:"BAD_PAYLOAD" };

  const ss = getSS_();
  const tx = ss.getSheetByName(SHEETS.TX);
  const pay = ss.getSheetByName(SHEETS.PAY);

  if(refTable === "Transactions"){
    const entry = snapshot && (snapshot.entry || snapshot.entrySnapshot || snapshot.transaction || snapshot.transactionSnapshot || snapshot) || null;
    if(entry && entry.id){
      const now = Date.now();
      const row = {
        id: String(entry.id),
        date: String(entry.date || ""),
        type: String(entry.type || ""),
        party: String(entry.party || ""),
        desc: String(entry.desc || ""),
        category: String(entry.category || ""),
        notes: String(entry.notes || ""),
        total: num_(entry.total),
        createdAt: num_(entry.createdAt || now),
        updatedAt: now,
        isDeleted: "0",
      };
      upsertById_(tx, HEADERS[SHEETS.TX], row, false);
    }else{
      // حتى لو snapshot ناقص: على الأقل رجّع isDeleted=0 لنفس الـ id
      const restored = restoreByIdOnly_(tx, HEADERS[SHEETS.TX], refId);
      if(!restored) throw new Error('Cannot restore: missing transaction id ' + refId);
    }

    // رجّع المدفوعات لو موجودة في snapshot.payments
    const pays = (snapshot && ((snapshot.payments && Array.isArray(snapshot.payments) && snapshot.payments) || (snapshot.paymentsSnapshot && Array.isArray(snapshot.paymentsSnapshot) && snapshot.paymentsSnapshot) || (snapshot.paymentSnapshots && Array.isArray(snapshot.paymentSnapshots) && snapshot.paymentSnapshots))) || [];
    pays.forEach(p=>{
      if(!p || !p.id) return;
      const now = Date.now();
      const prow = {
        id: String(p.id),
        entryId: String(p.entryId || refId),
        date: String(p.date || ""),
        party: String(p.party || ""),
        amount: num_(p.amount),
        note: String(p.note || ""),
        flow: (p.flow === "in" ? "in" : "out"),
        createdAt: num_(p.createdAt || now),
        updatedAt: now,
        isDeleted: "0",
      };
      upsertById_(pay, HEADERS[SHEETS.PAY], prow, false);
    });

    dedupeByIdKeepLatest_(tx, HEADERS[SHEETS.TX]);
    dedupeByIdKeepLatest_(pay, HEADERS[SHEETS.PAY]);

    // امسح سجل التراش الخاص بالعنصر
    deleteTrashByRef_(ss, "Transactions", refId);

    return { ok:true, restored:"Transactions", refId };
  }

  if(refTable === "Payments"){
    const p = snapshot && (snapshot.payment || snapshot.paymentSnapshot || snapshot) || null;
    if(p && p.id){
      const now = Date.now();
      const prow = {
        id: String(p.id),
        entryId: String(p.entryId || ""),
        date: String(p.date || ""),
        party: String(p.party || ""),
        amount: num_(p.amount),
        note: String(p.note || ""),
        flow: (p.flow === "in" ? "in" : "out"),
        createdAt: num_(p.createdAt || now),
        updatedAt: now,
        isDeleted: "0",
      };
      upsertById_(pay, HEADERS[SHEETS.PAY], prow, false);
    }else{
      const restored = restoreByIdOnly_(pay, HEADERS[SHEETS.PAY], refId);
      if(!restored) throw new Error('Cannot restore: missing payment id ' + refId);
    }

    dedupeByIdKeepLatest_(pay, HEADERS[SHEETS.PAY]);

    deleteTrashByRef_(ss, "Payments", refId);

    return { ok:true, restored:"Payments", refId };
  }

  return { ok:false, error:"BAD_REF_TABLE" };
}

function handleDeleteTrashLog_(payload){
  const logId = String(payload && payload.logId || "");
  if(!logId) return { ok:false, error:"BAD_PAYLOAD" };

  const ss = getSS_();
  const sh = ss.getSheetByName(SHEETS.TRASH);
  deleteRowById_(sh, HEADERS[SHEETS.TRASH], logId);

  return { ok:true };
}

/* ===================== Schema ===================== */

function ensureSchemaOnce_(){
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty("schema_ok_at") || 0);
  const now = Date.now();
  if(now - last < 2 * 60 * 60 * 1000) return; // كل ساعتين

  ensureSchema_();
  props.setProperty("schema_ok_at", String(now));
}

function ensureSchema_(){
  const ss = getSS_();
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));
  ensureMetaDefaults_(ss);
}

function ensureSheet_(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);

  const lastRow = sh.getLastRow();
  if(lastRow === 0){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);
    return;
  }

  const existing = sh.getRange(1,1,1,headers.length).getValues()[0];
  const same = headers.every((h, i) => String(existing[i] || "").trim() === h);
  if(!same){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

function ensureMetaDefaults_(ss){
  const sh = ss.getSheetByName(SHEETS.META);
  if(!sh) return;

  const data = readTable_(sh, HEADERS[SHEETS.META]);
  const map = {};
  data.forEach(r => map[String(r.key)] = r.value);

  META_DEFAULTS.forEach(([k, v])=>{
    if(map[String(k)] === undefined){
      appendRow_(sh, HEADERS[SHEETS.META], { key: String(k), value: v });
    }
  });
}

function getSS_(){
  if(SPREADSHEET_ID && String(SPREADSHEET_ID).trim()){
    return SpreadsheetApp.openById(String(SPREADSHEET_ID).trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/* ===================== Table helpers ===================== */

function readTable_(sh, headers){
  if(!sh) return [];
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return [];

  const lastCol = headers.length;
  const values = sh.getRange(2,1,lastRow-1,lastCol).getValues();

  return values
    .filter(r => r.some(x => String(x).trim() !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i]);
      return obj;
    });
}

function appendRow_(sh, headers, obj){
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sh.appendRow(row);
}

function findAllRowsById_(sh, headers, id){
  const idCol = headers.indexOf("id") + 1;
  if(idCol <= 0) return [];
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return [];

  const ids = sh.getRange(2,idCol,lastRow-1,1).getValues().map(r => String(r[0]));
  const out = [];
  ids.forEach((x, i)=>{
    if(x === String(id)) out.push(i + 2);
  });
  return out;
}

/**
 * ✅ Upsert by id:
 * - لو موجود: Update نفس الصف
 * - لو مش موجود: Append
 */
function upsertById_(sh, headers, obj, allowInsert){
  if(allowInsert === undefined) allowInsert = true;
  const rows = findAllRowsById_(sh, headers, obj.id);
  if(rows.length === 0){
    if(!allowInsert){
      throw new Error("Target id not found for restore in sheet '" + sh.getName() + "': " + obj.id);
    }
    appendRow_(sh, headers, obj);
    return;
  }

  // اختار الصف "الأحدث" حسب updatedAt لو موجود
  const updCol = headers.indexOf("updatedAt") + 1;
  let targetRow = rows[0];

  if(updCol > 0){
    let best = -1;
    rows.forEach(r=>{
      const v = Number(sh.getRange(r, updCol).getValue());
      if(Number.isFinite(v) && v > best){
        best = v;
        targetRow = r;
      }
    });
  }

  // اكتب بيانات كاملة على نفس الصف
  const values = headers.map(h => (obj[h] !== undefined ? obj[h] : ""));
  sh.getRange(targetRow, 1, 1, headers.length).setValues([values]);
}

function buildRestoredRow_(snapshotObj){
  const now = Date.now();
  const out = Object.assign({}, snapshotObj || {});
  out.isDeleted = 0;
  out.updatedAt = now;
  return out;
}

/** ✅ Restore سريع: يغير isDeleted=0 + updatedAt فقط على صف موجود */
function restoreByIdOnly_(sh, headers, id){
  const rows = findAllRowsById_(sh, headers, id);
  if(rows.length === 0) return false;

  const isDelCol = headers.indexOf("isDeleted") + 1;
  const updCol = headers.indexOf("updatedAt") + 1;

  // رجّع أحدث صف
  let targetRow = rows[0];
  if(updCol > 0){
    let best = -1;
    rows.forEach(r=>{
      const v = Number(sh.getRange(r, updCol).getValue());
      if(Number.isFinite(v) && v > best){
        best = v; targetRow = r;
      }
    });
  }

  if(isDelCol > 0) sh.getRange(targetRow, isDelCol).setValue("0");
  if(updCol > 0) sh.getRange(targetRow, updCol).setValue(Date.now());
  return true;
}

function softDeleteById_(sh, headers, id){
  const rows = findAllRowsById_(sh, headers, id);
  if(rows.length === 0) return;

  const isDelCol = headers.indexOf("isDeleted") + 1;
  const updCol = headers.indexOf("updatedAt") + 1;

  // احذف على أحدث صف فقط
  let targetRow = rows[0];
  if(updCol > 0){
    let best = -1;
    rows.forEach(r=>{
      const v = Number(sh.getRange(r, updCol).getValue());
      if(Number.isFinite(v) && v > best){
        best = v; targetRow = r;
      }
    });
  }

  if(isDelCol > 0) sh.getRange(targetRow, isDelCol).setValue("1");
  if(updCol > 0) sh.getRange(targetRow, updCol).setValue(Date.now());
}

function softDeleteByEntryId_(sh, headers, entryId){
  const entryCol = headers.indexOf("entryId") + 1;
  if(entryCol <= 0) return;

  const lastRow = sh.getLastRow();
  if(lastRow < 2) return;

  const values = sh.getRange(2, entryCol, lastRow-1, 1).getValues().map(r => String(r[0]));
  const isDelCol = headers.indexOf("isDeleted") + 1;
  const updCol = headers.indexOf("updatedAt") + 1;

  values.forEach((val, i) => {
    if(val === String(entryId)){
      const row = i + 2;
      if(isDelCol > 0) sh.getRange(row, isDelCol).setValue("1");
      if(updCol > 0) sh.getRange(row, updCol).setValue(Date.now());
    }
  });
}

function deleteRowById_(sh, headers, id){
  const rows = findAllRowsById_(sh, headers, id);
  if(rows.length === 0) return;
  // احذف كل الصفوف اللي بنفس الـ ID (من تحت لفوق)
  rows.sort((a,b)=>b-a).forEach(r=>sh.deleteRow(r));
}

/**
 * ✅ Dedupe: لو لقى نفس الـ id متكرر
 * - يخلي صف واحد (الأحدث updatedAt)
 * - يمسح الباقي فعلياً من الشيت (عشان تنظف خالص)
 */
function dedupeByIdKeepLatest_(sh, headers){
  if(!sh) return;
  const lastRow = sh.getLastRow();
  if(lastRow < 3) return;

  const idCol = headers.indexOf("id") + 1;
  const updCol = headers.indexOf("updatedAt") + 1;
  if(idCol <= 0) return;

  const data = sh.getRange(2, 1, lastRow-1, headers.length).getValues();
  const map = new Map(); // id -> { idx, updatedAt }
  const dupRowsToDelete = [];

  data.forEach((row, i)=>{
    const sheetRow = i + 2;
    const id = String(row[idCol-1] || "");
    if(!id) return;

    const upd = updCol > 0 ? Number(row[updCol-1]) : 0;
    const prev = map.get(id);

    if(!prev){
      map.set(id, { row: sheetRow, upd: upd });
      return;
    }

    // قارن: خليك على أحدث updatedAt
    if(Number.isFinite(upd) && upd > (Number(prev.upd) || 0)){
      // القديم يتشال
      dupRowsToDelete.push(prev.row);
      map.set(id, { row: sheetRow, upd: upd });
    }else{
      // الجديد يتشال
      dupRowsToDelete.push(sheetRow);
    }
  });

  // احذف من تحت لفوق
  dupRowsToDelete
    .filter((v, i, a)=>a.indexOf(v)===i)
    .sort((a,b)=>b-a)
    .forEach(r=>{
      // تأكد لسه موجود
      if(r <= sh.getLastRow()) sh.deleteRow(r);
    });
}

function addTrash_(ss, { refTable, refId, reason, snapshotJson }){
  const sh = ss.getSheetByName(SHEETS.TRASH);
  const now = Date.now();
  const row = {
    id: String(now) + "_" + Math.random().toString(16).slice(2),
    refTable: String(refTable || ""),
    refId: String(refId || ""),
    deletedAt: now,
    reason: String(reason || ""),
    snapshotJson: String(snapshotJson || "{}"),
  };
  appendRow_(sh, HEADERS[SHEETS.TRASH], row);
}

function deleteTrashByRef_(ss, refTable, refId){
  const sh = ss.getSheetByName(SHEETS.TRASH);
  if(!sh) return;

  const headers = HEADERS[SHEETS.TRASH];
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return;

  const tblCol = headers.indexOf("refTable") + 1;
  const idCol  = headers.indexOf("refId") + 1;
  if(tblCol <= 0 || idCol <= 0) return;

  const vals = sh.getRange(2,1,lastRow-1,headers.length).getValues();
  const rowsToDelete = [];
  vals.forEach((r,i)=>{
    const t = String(r[tblCol-1] || "");
    const id = String(r[idCol-1] || "");
    if(t === String(refTable) && id === String(refId)){
      rowsToDelete.push(i + 2);
    }
  });

  rowsToDelete.sort((a,b)=>b-a).forEach(r=>{
    if(r <= sh.getLastRow()) sh.deleteRow(r);
  });
}

/* ===================== Utils ===================== */

function safeJsonParse_(str, fallback){
  try{ return JSON.parse(str); }catch(_e){ return fallback; }
}

function num_(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : "";
}

// ✅ JSONP support if callback provided
function jsonOut_(obj, callback){
  const text = JSON.stringify(obj);
  if(callback && String(callback).trim()){
    const cb = String(callback).replace(/[^\w.$]/g, "");
    return ContentService
      .createTextOutput(cb + "(" + text + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
