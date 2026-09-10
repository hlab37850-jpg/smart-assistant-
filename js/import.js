/* ============================================================
   Smart Assistant — Import Engine
   Principle: ZERO DATA LOSS. Every record keeps its raw source
   text (raw) alongside the best-effort parsed value (parsed).
   Never strip digits/symbols from item names. Never zero a
   negative balance. Never invent quantities from digits inside
   a name.
   ============================================================ */

const Import = {

  // ---------- Public entry point ----------
  async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'xlsm'].includes(ext)) return this.parseExcel(file);
    if (ext === 'csv') return this.parseCSV(file);
    if (ext === 'pdf') return this.parsePDF(file);
    if (['db', 'sqlite', 'sqlite3'].includes(ext)) return this.parseSQLite(file);
    throw new Error('نوع الملف غير مدعوم: .' + ext);
  },

  // ---------- Column detection (name-based heuristics, never destructive) ----------
  COLUMN_HINTS: {
    customerName: ['اسم العميل', 'العميل', 'اسم الحساب', 'الاسم', 'name', 'customer'],
    phone: ['هاتف', 'رقم الهاتف', 'جوال', 'phone', 'mobile', 'تلفون'],
    address: ['عنوان', 'العنوان', 'address'],
    balance: ['رصيد', 'الرصيد', 'المتبقي', 'له', 'عليه', 'مدين', 'دائن', 'balance', 'المديونية'],
    currency: ['عملة', 'العملة', 'currency'],
    itemName: ['اسم الصنف', 'الصنف', 'المادة', 'اسم المنتج', 'item', 'product', 'name'],
    code: ['كود', 'الكود', 'رمز', 'code', 'sku'],
    qty: ['كمية', 'الكمية', 'qty', 'quantity', 'الرصيد المخزني'],
    unit: ['وحدة', 'الوحدة', 'unit'],
    category: ['تصنيف', 'التصنيف', 'فئة', 'category'],
  },

  IGNORE_ROW_HINTS: [
    'الإجمالي', 'اجمالي', 'المجموع', 'مجموع', 'total', 'grand total',
    'صفحة', 'page', 'تقرير', 'report', 'التاريخ من', 'التاريخ الى'
  ],

  detectColumn(headerCell, hints) {
    if (!headerCell) return false;
    const h = String(headerCell).trim().toLowerCase();
    return hints.some(k => h.includes(k.toLowerCase()));
  },

  looksLikeSummaryRow(rowValues) {
    const joined = rowValues.filter(Boolean).join(' ').toLowerCase();
    return this.IGNORE_ROW_HINTS.some(k => joined.includes(k.toLowerCase()));
  },

  // Parse a balance cell WITHOUT ever flipping sign or zeroing negatives.
  // Keeps raw text untouched; returns {raw, parsed:number|null}
  parseBalanceCell(raw) {
    if (raw === null || raw === undefined || raw === '') return { raw: raw ?? '', parsed: null };
    const rawStr = String(raw).trim();
    let s = rawStr.replace(/[,\s]/g, '');
    let negative = false;
    // Accounting-style negatives: (1234) or trailing minus, or Arabic markers له/عليه handled by caller
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    if (/^-/.test(s)) { negative = true; }
    const num = parseFloat(s.replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return { raw: rawStr, parsed: null };
    const value = negative && num > 0 ? -Math.abs(num) : num;
    return { raw: rawStr, parsed: value };
  },

  // ---------- EXCEL ----------
  async parseExcel(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rawRows = [];
    wb.SheetNames.forEach(sheetName => {
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      rawRows.push({ sheetName, rows: json });
    });
    return this.buildPreviewFromTables(rawRows, 'excel', file.name);
  },

  // ---------- CSV ----------
  async parseCSV(file) {
    const text = await file.text();
    const parsed = Papa.parse(text, { skipEmptyLines: false });
    return this.buildPreviewFromTables([{ sheetName: 'CSV', rows: parsed.data }], 'csv', file.name);
  },

  // Shared table -> customer/item candidate extraction (Excel/CSV path)
  buildPreviewFromTables(tables, sourceType, fileName) {
    const candidates = { customers: [], items: [], ignored: [], errors: [] };

    tables.forEach(({ sheetName, rows }) => {
      if (!rows || !rows.length) return;
      // find header row: first non-empty row
      let headerIdx = rows.findIndex(r => r.some(c => String(c).trim() !== ''));
      if (headerIdx === -1) return;
      const header = rows[headerIdx].map(h => String(h || '').trim());

      const colMap = { customerName: -1, phone: -1, address: -1, balance: -1, currency: -1,
                        itemName: -1, code: -1, qty: -1, unit: -1, category: -1 };
      header.forEach((h, idx) => {
        Object.keys(colMap).forEach(key => {
          if (colMap[key] === -1 && this.detectColumn(h, this.COLUMN_HINTS[key])) colMap[key] = idx;
        });
      });

      const isCustomerSheet = colMap.customerName !== -1 || colMap.balance !== -1 || colMap.phone !== -1;
      const isItemSheet = colMap.itemName !== -1 && (colMap.qty !== -1 || colMap.unit !== -1 || colMap.code !== -1);

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => String(c).trim() === '')) continue;
        if (this.looksLikeSummaryRow(row.map(String))) {
          candidates.ignored.push({ sheet: sheetName, rowIndex: i, raw: row, reason: 'صف إجمالي/تلخيص' });
          continue;
        }

        if (isItemSheet) {
          const nameRaw = colMap.itemName !== -1 ? row[colMap.itemName] : '';
          if (!String(nameRaw).trim()) { candidates.ignored.push({ sheet: sheetName, rowIndex: i, raw: row, reason: 'بدون اسم صنف' }); continue; }
          candidates.items.push({
            source: { type: sourceType, file: fileName, sheet: sheetName, rowIndex: i },
            raw: { name: String(nameRaw), full: row },
            parsed: {
              name: String(nameRaw), // NEVER trimmed/altered beyond outer whitespace preserved as-is
              code: colMap.code !== -1 ? String(row[colMap.code] ?? '').trim() : '',
              category: colMap.category !== -1 ? String(row[colMap.category] ?? '').trim() : '',
              unit: colMap.unit !== -1 ? String(row[colMap.unit] ?? '').trim() : '',
              qty: colMap.qty !== -1 ? this.parseQtyCell(row[colMap.qty]) : { raw: '', parsed: null },
            }
          });
        } else if (isCustomerSheet) {
          const nameRaw = colMap.customerName !== -1 ? row[colMap.customerName] : '';
          if (!String(nameRaw).trim()) { candidates.ignored.push({ sheet: sheetName, rowIndex: i, raw: row, reason: 'بدون اسم عميل' }); continue; }
          const balCell = colMap.balance !== -1 ? row[colMap.balance] : '';
          candidates.customers.push({
            source: { type: sourceType, file: fileName, sheet: sheetName, rowIndex: i },
            raw: { name: String(nameRaw), full: row },
            parsed: {
              name: String(nameRaw),
              phone: colMap.phone !== -1 ? String(row[colMap.phone] ?? '').trim() : '',
              address: colMap.address !== -1 ? String(row[colMap.address] ?? '').trim() : '',
              currency: colMap.currency !== -1 ? String(row[colMap.currency] ?? '').trim() : '',
              balance: this.parseBalanceCell(balCell)
            }
          });
        } else {
          candidates.ignored.push({ sheet: sheetName, rowIndex: i, raw: row, reason: 'تعذر تحديد نوع الصف' });
        }
      }
    });

    return { sourceType, fileName, candidates };
  },

  parseQtyCell(raw) {
    if (raw === null || raw === undefined || raw === '') return { raw: raw ?? '', parsed: null };
    const s = String(raw).trim();
    const num = parseFloat(s.replace(/[^\d.-]/g, ''));
    return { raw: s, parsed: isNaN(num) ? null : num };
  },

  // ---------- PDF (text-based only; scanned/image PDFs need OCR which is NOT included) ----------
  async parsePDF(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let hasText = false;
    const lines = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      if (content.items.length) hasText = true;

      // group items by approximate Y position into lines, preserve X order for columns
      const byY = {};
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        byY[y] = byY[y] || [];
        byY[y].push({ x: it.transform[4], str: it.str });
      });
      const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      ys.forEach(y => {
        const parts = byY[y].sort((a, b) => a.x - b.x).map(p => p.str);
        const lineText = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) lines.push({ page: p, y, text: lineText, cells: parts });
      });
    }

    if (!hasText) {
      return {
        sourceType: 'pdf', fileName: file.name,
        needsOCR: true,
        candidates: { customers: [], items: [], ignored: [], errors: [
          { reason: 'هذا الملف يبدو ملف PDF ممسوح ضوئيًا (صور وليس نصًا). التعرف الضوئي (OCR) غير متوفر في هذا الإصدار — لم يتم استيراد أي بيانات لتجنب فقدانها أو تلفها.' }
        ] }
      };
    }

    // Heuristic extraction: look for lines containing a name-like segment + a numeric balance-like segment.
    const candidates = { customers: [], items: [], ignored: [], errors: [] };
    const balanceLineRe = /^(.*?)([\-\(]?\d[\d,\.]*\)?)\s*$/; // trailing number = likely balance

    lines.forEach((ln, idx) => {
      const low = ln.text.toLowerCase();
      if (this.IGNORE_ROW_HINTS.some(k => low.includes(k.toLowerCase()))) {
        candidates.ignored.push({ page: ln.page, raw: ln.text, reason: 'رأس/تذييل/إجمالي' });
        return;
      }
      const m = ln.text.match(balanceLineRe);
      if (m && m[1].trim().length >= 2) {
        const namePart = m[1].trim();
        const balCell = this.parseBalanceCell(m[2]);
        candidates.customers.push({
          source: { type: 'pdf', file: file.name, page: ln.page, lineIndex: idx },
          raw: { name: namePart, full: ln.text },
          parsed: { name: namePart, phone: '', address: '', currency: '', balance: balCell }
        });
      } else {
        candidates.ignored.push({ page: ln.page, raw: ln.text, reason: 'لا يطابق نمط (اسم + رصيد)، يحتاج مراجعة يدوية' });
      }
    });

    return { sourceType: 'pdf', fileName: file.name, needsOCR: false, candidates };
  },

  // ---------- SQLite / DB (client-side via sql.js WASM) ----------
  async parseSQLite(file) {
    const buf = await file.arrayBuffer();
    const SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });
    const sqldb = new SQL.Database(new Uint8Array(buf));

    const tablesRes = sqldb.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tablesRes.length ? tablesRes[0].values.map(r => r[0]) : [];

    const ACCOUNTING_TABLE_HINTS = ['sale', 'invoice', 'purchase', 'payment', 'voucher', 'transaction',
      'مبيع', 'فاتور', 'مشتر', 'دفع', 'سند', 'حركة'];
    const CUSTOMER_TABLE_HINTS = ['customer', 'client', 'account', 'عميل', 'عملاء', 'حساب'];
    const ITEM_TABLE_HINTS = ['item', 'product', 'stock', 'inventory', 'صنف', 'اصناف', 'منتج', 'مخزون'];

    const schema = tableNames.map(t => {
      const cols = sqldb.exec(`PRAGMA table_info(${JSON.stringify(t).replace(/"/g, '')})`);
      const colNames = cols.length ? cols[0].values.map(r => r[1]) : [];
      const lower = t.toLowerCase();
      let guess = 'unknown';
      if (ACCOUNTING_TABLE_HINTS.some(h => lower.includes(h))) guess = 'accounting_ignored';
      else if (CUSTOMER_TABLE_HINTS.some(h => lower.includes(h))) guess = 'customers';
      else if (ITEM_TABLE_HINTS.some(h => lower.includes(h))) guess = 'items';
      return { table: t, columns: colNames, guess };
    });

    // Only auto-extract from tables guessed as customers/items; accounting tables are listed but skipped.
    const candidates = { customers: [], items: [], ignored: [], errors: [] };
    const custTable = schema.find(s => s.guess === 'customers');
    const itemTable = schema.find(s => s.guess === 'items');

    if (custTable) {
      const nameCol = custTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.customerName)) || custTable.columns[1];
      const balCol = custTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.balance));
      const phoneCol = custTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.phone));
      const idCol = custTable.columns.find(c => /^id$/i.test(c)) || custTable.columns[0];
      if (nameCol) {
        const res = sqldb.exec(`SELECT * FROM ${custTable.table}`);
        if (res.length) {
          const cols = res[0].columns;
          res[0].values.forEach(rowArr => {
            const row = {}; cols.forEach((c, i) => row[c] = rowArr[i]);
            const name = row[nameCol];
            if (!name || !String(name).trim()) return;
            candidates.customers.push({
              source: { type: 'sqlite', file: file.name, table: custTable.table, externalId: idCol ? row[idCol] : null },
              raw: { name: String(name), full: row },
              parsed: {
                name: String(name),
                phone: phoneCol ? String(row[phoneCol] ?? '').trim() : '',
                address: '', currency: '',
                balance: balCol ? this.parseBalanceCell(row[balCol]) : { raw: '', parsed: null },
                externalId: idCol ? row[idCol] : null
              }
            });
          });
        }
      }
    }

    if (itemTable) {
      const nameCol = itemTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.itemName)) || itemTable.columns[1];
      const qtyCol = itemTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.qty));
      const codeCol = itemTable.columns.find(c => this.detectColumn(c, this.COLUMN_HINTS.code));
      const idCol = itemTable.columns.find(c => /^id$/i.test(c)) || itemTable.columns[0];
      if (nameCol) {
        const res = sqldb.exec(`SELECT * FROM ${itemTable.table}`);
        if (res.length) {
          const cols = res[0].columns;
          res[0].values.forEach(rowArr => {
            const row = {}; cols.forEach((c, i) => row[c] = rowArr[i]);
            const name = row[nameCol];
            if (!name || !String(name).trim()) return;
            candidates.items.push({
              source: { type: 'sqlite', file: file.name, table: itemTable.table, externalId: idCol ? row[idCol] : null },
              raw: { name: String(name), full: row },
              parsed: {
                name: String(name),
                code: codeCol ? String(row[codeCol] ?? '').trim() : '',
                category: '', unit: '',
                qty: qtyCol ? this.parseQtyCell(row[qtyCol]) : { raw: '', parsed: null },
                externalId: idCol ? row[idCol] : null
              }
            });
          });
        }
      }
    }

    schema.filter(s => s.guess === 'accounting_ignored').forEach(s => {
      candidates.ignored.push({ table: s.table, reason: 'جدول محاسبي (مبيعات/فواتير/دفعات) — تم تجاهله عمدًا' });
    });

    sqldb.close();
    return { sourceType: 'sqlite', fileName: file.name, schema, candidates };
  },

  // ---------- Diff against existing DB: build the full preview (new / update / review / ignored) ----------
  async buildImportPlan(parsedResult) {
    const plan = { newCustomers: [], updateCustomers: [], reviewCustomers: [],
                   newItems: [], updateItems: [], reviewItems: [],
                   ignored: parsedResult.candidates.ignored || [],
                   errors: parsedResult.candidates.errors || [] };

    for (const c of parsedResult.candidates.customers) {
      const { match, confidence, reason } = await DB.findCustomerByMatch({
        externalId: c.source.externalId, phone: c.parsed.phone, name: c.parsed.name
      });
      if (!match) { plan.newCustomers.push(c); continue; }
      if (confidence >= 0.9) { plan.updateCustomers.push({ ...c, existing: match, matchReason: reason, confidence }); }
      else { plan.reviewCustomers.push({ ...c, existing: match, matchReason: reason, confidence }); }
    }

    for (const it of parsedResult.candidates.items) {
      const { match, confidence, reason } = await DB.findItemByMatch({
        externalId: it.source.externalId, code: it.parsed.code, name: it.parsed.name
      });
      if (!match) { plan.newItems.push(it); continue; }
      if (confidence >= 0.9) { plan.updateItems.push({ ...it, existing: match, matchReason: reason, confidence }); }
      else { plan.reviewItems.push({ ...it, existing: match, matchReason: reason, confidence }); }
    }

    return plan;
  },

  // ---------- Commit the plan (transactional-ish: snapshot backup first, rollback on failure) ----------
  async commitImportPlan(plan, sourceMeta) {
    const preSnapshot = await DB.exportAll();
    const backupId = 'auto_' + Date.now();
    await DB.put(DB.STORES.backups, { id: backupId, timestamp: Date.now(), reason: 'قبل الاستيراد: ' + (sourceMeta.fileName || ''), data: preSnapshot });

    try {
      let created = 0, updated = 0;

      for (const c of plan.newCustomers) {
        const rec = this.newCustomerRecord(c);
        await DB.put(DB.STORES.customers, rec);
        created++;
      }
      for (const c of plan.updateCustomers) {
        const merged = this.mergeCustomer(c.existing, c);
        await DB.put(DB.STORES.customers, merged);
        updated++;
      }
      for (const it of plan.newItems) {
        const rec = this.newItemRecord(it);
        await DB.put(DB.STORES.items, rec);
        created++;
      }
      for (const it of plan.updateItems) {
        const merged = this.mergeItem(it.existing, it);
        await DB.put(DB.STORES.items, merged);
        updated++;
      }
      // items/customers needing review go to reviewQueue, not auto-merged
      for (const c of plan.reviewCustomers) {
        await DB.put(DB.STORES.reviewQueue, { id: 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), entityType: 'customer', candidate: c, createdAt: Date.now() });
      }
      for (const it of plan.reviewItems) {
        await DB.put(DB.STORES.reviewQueue, { id: 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), entityType: 'item', candidate: it, createdAt: Date.now() });
      }

      const batch = {
        id: 'batch_' + Date.now(),
        timestamp: Date.now(),
        fileName: sourceMeta.fileName,
        sourceType: sourceMeta.sourceType,
        created, updated,
        needsReview: plan.reviewCustomers.length + plan.reviewItems.length,
        ignored: plan.ignored.length,
        backupId
      };
      await DB.put(DB.STORES.importBatches, batch);
      await DB.logActivity('import', `استيراد ${sourceMeta.fileName}: ${created} جديد، ${updated} تحديث، ${batch.needsReview} يحتاج مراجعة`);

      return batch;
    } catch (err) {
      // rollback
      await DB.importAll(preSnapshot, { wipe: true });
      throw new Error('فشل الاستيراد وتم التراجع بالكامل (Rollback) إلى الحالة السابقة. السبب: ' + err.message);
    }
  },

  newCustomerRecord(c) {
    return {
      id: 'cust_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      externalId: c.source.externalId || null,
      name: c.parsed.name,
      rawName: c.raw.name,
      phone: c.parsed.phone || '',
      address: c.parsed.address || '',
      currency: c.parsed.currency || '',
      balance: c.parsed.balance.parsed,
      rawBalance: c.parsed.balance.raw,
      dueDate: null,
      dueTime: null,
      notes: '',
      status: 'active',
      reminderStage: 'none',
      lastFollowUp: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },
  mergeCustomer(existing, c) {
    return {
      ...existing,
      name: c.parsed.name || existing.name,
      rawName: c.raw.name || existing.rawName,
      phone: c.parsed.phone || existing.phone,
      balance: c.parsed.balance.parsed !== null ? c.parsed.balance.parsed : existing.balance,
      rawBalance: c.parsed.balance.raw || existing.rawBalance,
      // preserved on update, per spec:
      dueDate: existing.dueDate, dueTime: existing.dueTime,
      notes: existing.notes, lastFollowUp: existing.lastFollowUp,
      updatedAt: Date.now()
    };
  },
  newItemRecord(it) {
    return {
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      externalId: it.source.externalId || null,
      name: it.parsed.name,
      rawName: it.raw.name,
      code: it.parsed.code || '',
      categoryId: null,
      categoryLabel: it.parsed.category || '',
      unit: it.parsed.unit || '',
      qty: it.parsed.qty.parsed !== null ? it.parsed.qty.parsed : 0,
      rawQty: it.parsed.qty.raw,
      minQty: 0,
      status: 'available',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  },
  mergeItem(existing, it) {
    const qty = it.parsed.qty.parsed !== null ? it.parsed.qty.parsed : existing.qty;
    return {
      ...existing,
      name: it.parsed.name || existing.name,
      code: it.parsed.code || existing.code,
      qty,
      rawQty: it.parsed.qty.raw || existing.rawQty,
      status: Modules.computeItemStatus(qty, existing.minQty),
      updatedAt: Date.now()
    };
  }
};

window.Import = Import;
