/* ============================================================
   Smart Assistant — Reports & Backup/Restore
   ============================================================ */

const Reports = {
  async buildCustomersReport() {
    const customers = await DB.getAll(DB.STORES.customers);
    const rows = customers.map(c => ({
      'الاسم': c.name, 'الهاتف': c.phone, 'الرصيد': c.balance, 'العملة': c.currency,
      'تاريخ الاستحقاق': c.dueDate || '', 'وقت الاستحقاق': c.dueTime || '',
      'آخر متابعة': c.lastFollowUp ? new Date(c.lastFollowUp).toLocaleString('ar') : ''
    }));
    return { title: 'تقرير العملاء', rows };
  },
  async buildBalancesReport() {
    const customers = await DB.getAll(DB.STORES.customers);
    const owedToUs = customers.filter(c => (c.balance ?? 0) > 0).reduce((s, c) => s + c.balance, 0);
    const owedByUs = customers.filter(c => (c.balance ?? 0) < 0).reduce((s, c) => s + c.balance, 0);
    const rows = customers.map(c => ({ 'الاسم': c.name, 'الرصيد': c.balance, 'النوع': c.balance > 0 ? 'له' : (c.balance < 0 ? 'عليه' : 'متعادل') }));
    return { title: 'تقرير الأرصدة', rows, summary: { 'إجمالي له': owedToUs, 'إجمالي عليه': owedByUs, 'الصافي': owedToUs + owedByUs } };
  },
  async buildDueReport() {
    const customers = await DB.getAll(DB.STORES.customers);
    const rows = customers.filter(c => c.dueDate).map(c => ({
      'الاسم': c.name, 'الرصيد': c.balance, 'تاريخ الاستحقاق': c.dueDate, 'الوقت': c.dueTime || '',
      'الحالة': Modules.isForgotten(c) ? 'منسي' : (Modules.daysOverdue(c) > 0 ? 'متأخر' : 'ضمن الموعد')
    }));
    return { title: 'تقرير الاستحقاقات', rows };
  },
  async buildForgottenReport() {
    const customers = await DB.getAll(DB.STORES.customers);
    const rows = customers.filter(c => Modules.isForgotten(c)).map(c => ({
      'الاسم': c.name, 'الرصيد': c.balance, 'تاريخ الاستحقاق': c.dueDate,
      'أيام التأخير': Modules.daysOverdue(c), 'آخر متابعة': c.lastFollowUp ? new Date(c.lastFollowUp).toLocaleString('ar') : 'لا يوجد'
    }));
    return { title: 'تقرير العملاء المنسيين', rows };
  },
  async buildItemsReport() {
    const items = await DB.getAll(DB.STORES.items);
    const rows = items.map(i => ({ 'الاسم': i.name, 'الكود': i.code, 'التصنيف': i.categoryLabel, 'الوحدة': i.unit, 'الكمية': i.qty, 'الحد الأدنى': i.minQty, 'الحالة': i.status }));
    return { title: 'تقرير الأصناف', rows };
  },
  async buildShortagesReport() {
    const items = await DB.getAll(DB.STORES.items);
    const rows = items.filter(i => i.status !== 'available').map(i => ({ 'الاسم': i.name, 'الكمية': i.qty, 'الحد الأدنى': i.minQty, 'الحالة': i.status === 'out' ? 'منتهي' : 'منخفض' }));
    return { title: 'تقرير النواقص', rows };
  },
  async buildImportReport() {
    const batches = await DB.getAll(DB.STORES.importBatches);
    const rows = batches.sort((a,b)=>b.timestamp-a.timestamp).map(b => ({
      'الملف': b.fileName, 'النوع': b.sourceType, 'التاريخ': new Date(b.timestamp).toLocaleString('ar'),
      'جديد': b.created, 'تحديث': b.updated, 'يحتاج مراجعة': b.needsReview, 'متجاهل': b.ignored
    }));
    return { title: 'تقرير الاستيراد', rows };
  },
  async buildActivityReport() {
    const logs = await DB.getAll(DB.STORES.activityLog);
    const rows = logs.sort((a,b)=>b.timestamp-a.timestamp).slice(0, 500).map(l => ({
      'الوقت': new Date(l.timestamp).toLocaleString('ar'), 'النوع': l.type, 'المستخدم': l.user, 'التفاصيل': l.details
    }));
    return { title: 'تقرير النشاط', rows };
  },

  exportToCSV(report) {
    const csv = Papa.unparse(report.rows);
    this.downloadBlob(new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' }), report.title + '.csv');
  },
  exportToExcel(report) {
    const ws = XLSX.utils.json_to_sheet(report.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, report.title.slice(0, 28));
    XLSX.writeFile(wb, report.title + '.xlsx');
  },
  exportToPDF(report) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(report.title, 14, 15, { align: 'left' });
    const headers = report.rows.length ? Object.keys(report.rows[0]) : [];
    const body = report.rows.map(r => headers.map(h => String(r[h] ?? '')));
    doc.autoTable({ head: [headers], body, startY: 22, styles: { font: 'helvetica', fontSize: 8 } });
    doc.save(report.title + '.pdf');
  },
  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
};

const Backup = {
  async createManualBackup(reason = 'نسخة يدوية') {
    const data = await DB.exportAll();
    const id = 'manual_' + Date.now();
    await DB.put(DB.STORES.backups, { id, timestamp: Date.now(), reason, data });
    await DB.logActivity('backup_create', reason);
    return id;
  },
  async listBackups() {
    const all = await DB.getAll(DB.STORES.backups);
    return all.sort((a, b) => b.timestamp - a.timestamp);
  },
  async restoreBackup(id) {
    const b = await DB.get(DB.STORES.backups, id);
    if (!b) throw new Error('النسخة الاحتياطية غير موجودة');
    await DB.importAll(b.data, { wipe: true });
    await DB.logActivity('restore', 'استعادة نسخة احتياطية من ' + new Date(b.timestamp).toLocaleString('ar'));
    return true;
  },
  async exportBackupFile() {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    Reports.downloadBlob(blob, `smart-assistant-backup-${new Date().toISOString().slice(0,10)}.json`);
    await DB.logActivity('backup_export', 'تصدير نسخة احتياطية كملف');
  },
  async importBackupFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.__meta || data.__meta.app !== 'smart-assistant') {
      throw new Error('هذا الملف ليس نسخة احتياطية صالحة من هذا التطبيق');
    }
    // safety snapshot before wiping
    const pre = await DB.exportAll();
    await DB.put(DB.STORES.backups, { id: 'pre_restore_' + Date.now(), timestamp: Date.now(), reason: 'قبل استعادة ملف خارجي', data: pre });
    await DB.importAll(data, { wipe: true });
    await DB.logActivity('restore', 'استعادة نسخة احتياطية من ملف خارجي: ' + file.name);
    return true;
  }
};

window.Reports = Reports;
window.Backup = Backup;
