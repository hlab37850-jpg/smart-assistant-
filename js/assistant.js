/* ============================================================
   Smart Assistant — Local Data Assistant
   HONESTY NOTE: this answers real questions using your actual
   local data (pattern matching, not a language model). A true
   LLM-powered assistant needs a backend proxy (to protect the
   API key and avoid browser CORS restrictions) which is not
   included in this build. See README "AI Assistant" section.
   ============================================================ */

const Assistant = {
  async answer(question) {
    const q = question.trim().toLowerCase();

    if (/متأخر|تأخير|overdue/.test(q)) {
      const customers = await Modules.listCustomers({ filter: 'overdue' });
      if (!customers.length) return 'لا يوجد عملاء متأخرون حاليًا.';
      return `العملاء المتأخرون (${customers.length}):\n` +
        customers.slice(0, 20).map(c => `• ${c.name} — الرصيد: ${c.balance} — متأخر ${Modules.daysOverdue(c)} يوم`).join('\n');
    }

    if (/منسي/.test(q)) {
      const customers = await Modules.listCustomers({ filter: 'forgotten' });
      if (!customers.length) return 'لا يوجد عملاء منسيون حاليًا.';
      return `العملاء المنسيون (${customers.length}):\n` +
        customers.slice(0, 20).map(c => `• ${c.name} — الرصيد: ${c.balance}`).join('\n');
    }

    if (/ناقص|نقص|shortage/.test(q)) {
      const items = await Modules.listItems({ filter: 'out' });
      const low = await Modules.listItems({ filter: 'low' });
      const all = [...items, ...low];
      if (!all.length) return 'لا توجد أصناف ناقصة أو منخفضة حاليًا.';
      return `الأصناف الناقصة/المنخفضة (${all.length}):\n` +
        all.slice(0, 20).map(i => `• ${i.name} — الكمية: ${i.qty} (الحالة: ${i.status === 'out' ? 'منتهي' : 'منخفض'})`).join('\n');
    }

    if (/كم عدد العملاء|عدد العملاء/.test(q)) {
      const n = await DB.count(DB.STORES.customers);
      return `عدد العملاء المسجلين حاليًا: ${n}`;
    }

    if (/رصيد.*موجب|لهم عليهم|إجمالي الأرصدة/.test(q)) {
      const r = await Reports.buildBalancesReport();
      return `إجمالي الأرصدة (لهم): ${r.summary['إجمالي له']}\nإجمالي الأرصدة (عليهم): ${r.summary['إجمالي عليه']}\nالصافي: ${r.summary['الصافي']}`;
    }

    if (/تقرير المخزون|تقرير الأصناف/.test(q)) {
      const r = await Reports.buildItemsReport();
      return `تقرير الأصناف يحتوي على ${r.rows.length} صنف. يمكنك فتح شاشة "التقارير" لتصديره PDF/Excel/CSV.`;
    }

    if (/بيانات مشكوك|يحتاج مراجعة|review/.test(q)) {
      const queue = await DB.getAll(DB.STORES.reviewQueue);
      if (!queue.length) return 'لا توجد سجلات تحتاج مراجعة حاليًا.';
      return `يوجد ${queue.length} سجل يحتاج مراجعة يدوية بسبب مطابقة غير مؤكدة. راجعها من شاشة "الاستيراد ← قائمة المراجعة".`;
    }

    if (/رسالة تذكير|اكتب رسالة/.test(q)) {
      return 'لكتابة رسالة تذكير: افتح بطاقة العميل من شاشة "العملاء" واضغط زر "إرسال تذكير" — سيتم توليد رسالة تلقائيًا من بيانات المحل واسم العميل ورصيده، قابلة للتعديل قبل الإرسال عبر واتساب.';
    }

    return 'لم أتعرف على هذا السؤال ضمن الأسئلة المدعومة محليًا حاليًا (المتأخرون، المنسيون، النواقص، عدد العملاء، إجمالي الأرصدة، تقرير الأصناف، سجلات المراجعة، رسائل التذكير). هذا مساعد يعمل على بياناتك المحلية فقط، وليس نموذج ذكاء اصطناعي عام — لتوسيعه يلزم ربطه بخدمة LLM عبر سيرفر وسيط (راجع README).';
  }
};

window.Assistant = Assistant;
