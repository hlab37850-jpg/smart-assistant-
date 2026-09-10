/* ============================================================
   Smart Assistant — Application Shell / Router / Screens
   ============================================================ */

const App = {
  currentRole: 'manager',
  importState: null, // holds { parsedResult, plan } across the import wizard steps

  async boot() {
    await DB.init();
    await this.seedDefaults();
    this.applyTheme(await DB.getSetting('theme') || 'system');
    this.bindNav();
    window.addEventListener('hashchange', () => this.route());
    this.route();
    this.startReminderLoop();
    this.renderTopAlerts();
  },

  async seedDefaults() {
    if (!(await DB.getSetting('storeSettings'))) {
      await DB.setSetting('storeSettings', { storeName: '', phone: '', address: '', logo: '' });
    }
    if (!(await DB.getSetting('reminderRules'))) {
      await Modules.saveReminderRules(Modules.DEFAULT_RULES);
    }
    const users = await DB.getAll(DB.STORES.users);
    if (!users.length) {
      await DB.put(DB.STORES.users, { id: 'u_admin', username: 'admin', name: 'المدير', role: 'manager', createdAt: Date.now() });
    }
    if (!(await DB.getSetting('currentUser'))) {
      await DB.setSetting('currentUser', { id: 'u_admin', name: 'المدير', role: 'manager' });
    }
  },

  bindNav() {
    document.querySelectorAll('.nav-link').forEach(a => {
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach(x => x.classList.remove('active'));
        a.classList.add('active');
        document.getElementById('sideNav').classList.remove('open');
      });
    });
    document.getElementById('menuToggle').addEventListener('click', () => {
      document.getElementById('sideNav').classList.toggle('open');
    });
    document.getElementById('themeToggle').addEventListener('click', () => this.cycleTheme());
  },

  async cycleTheme() {
    const order = ['light', 'dark', 'system'];
    const cur = await DB.getSetting('theme') || 'system';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    await DB.setSetting('theme', next);
    this.applyTheme(next);
  },
  applyTheme(mode) {
    let effective = mode;
    if (mode === 'system') effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', effective);
    document.getElementById('themeToggle').textContent = mode === 'light' ? '☀️' : (mode === 'dark' ? '🌙' : '🖥️');
  },

  route() {
    const hash = location.hash.replace('#', '') || 'dashboard';
    const [screen, param] = hash.split('/');
    const routes = {
      dashboard: () => this.screenDashboard(),
      customers: () => this.screenCustomers(),
      customerForm: () => this.screenCustomerForm(param),
      forgotten: () => this.screenForgotten(),
      inventory: () => this.screenInventory(),
      itemForm: () => this.screenItemForm(param),
      categories: () => this.screenCategories(),
      import: () => this.screenImport(),
      review: () => this.screenReviewQueue(),
      reports: () => this.screenReports(),
      backup: () => this.screenBackup(),
      users: () => this.screenUsers(),
      log: () => this.screenLog(),
      settings: () => this.screenSettings(),
      assistant: () => this.screenAssistant(),
    };
    (routes[screen] || routes.dashboard)();
  },

  el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; },
  mount(html) { document.getElementById('appContent').innerHTML = html; window.scrollTo(0, 0); },
  toast(msg, kind = 'info') {
    const box = document.getElementById('toastBox');
    const t = this.el(`<div class="toast toast-${kind}">${msg}</div>`);
    box.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  },
  fmt(n) { return (Number(n) || 0).toLocaleString('ar-EG'); },

  async renderTopAlerts() {
    const forgotten = (await Modules.listCustomers({ filter: 'forgotten' })).length;
    const low = (await Modules.listItems({ filter: 'low' })).length + (await Modules.listItems({ filter: 'out' })).length;
    const badge = document.getElementById('alertBadge');
    const total = forgotten + low;
    badge.textContent = total > 0 ? total : '';
    badge.style.display = total > 0 ? 'inline-block' : 'none';
  },

  startReminderLoop() {
    const sweep = async () => {
      const results = await Modules.runReminderSweep();
      if (results.length) this.toast(`لديك ${results.length} تذكير مستحق اليوم`, 'warn');
      this.renderTopAlerts();
    };
    sweep();
    setInterval(sweep, 1000 * 60 * 30); // every 30 min while app is open
  },

  // ================= DASHBOARD =================
  async screenDashboard() {
    const customers = await DB.getAll(DB.STORES.customers);
    const items = await DB.getAll(DB.STORES.items);
    const owedToUs = customers.filter(c => (c.balance ?? 0) > 0).reduce((s, c) => s + c.balance, 0);
    const owedByUs = customers.filter(c => (c.balance ?? 0) < 0).reduce((s, c) => s + c.balance, 0);
    const dueToday = await Modules.listCustomers({ filter: 'due_today' });
    const forgotten = await Modules.listCustomers({ filter: 'forgotten' });
    const lowItems = (await Modules.listItems({ filter: 'low' }));
    const outItems = (await Modules.listItems({ filter: 'out' }));
    const upcoming = customers.filter(c => c.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
    const logs = (await DB.getAll(DB.STORES.activityLog)).sort((a,b)=>b.timestamp-a.timestamp).slice(0, 6);

    this.mount(`
      <div class="grid stats">
        <div class="stat-card"><div class="stat-num">${customers.length}</div><div class="stat-label">العملاء</div></div>
        <div class="stat-card"><div class="stat-num">${this.fmt(owedToUs)}</div><div class="stat-label">إجمالي لنا</div></div>
        <div class="stat-card"><div class="stat-num">${this.fmt(owedByUs)}</div><div class="stat-label">إجمالي علينا</div></div>
        <div class="stat-card"><div class="stat-num">${dueToday.length}</div><div class="stat-label">استحقاق اليوم</div></div>
        <div class="stat-card warn-card"><div class="stat-num">${forgotten.length}</div><div class="stat-label">عملاء منسيون</div></div>
        <div class="stat-card"><div class="stat-num">${items.length}</div><div class="stat-label">الأصناف</div></div>
        <div class="stat-card warn-card"><div class="stat-num">${lowItems.length + outItems.length}</div><div class="stat-label">نواقص المخزون</div></div>
      </div>

      <div class="grid two-col">
        <section class="panel">
          <h3>الاستحقاقات القادمة</h3>
          ${upcoming.length ? `<table class="table"><thead><tr><th>العميل</th><th>الرصيد</th><th>التاريخ</th><th>الوقت</th></tr></thead>
            <tbody>${upcoming.map(c => `<tr><td>${c.name}</td><td>${this.fmt(c.balance)}</td><td>${c.dueDate}</td><td>${c.dueTime||'-'}</td></tr>`).join('')}</tbody></table>`
            : `<p class="empty">لا توجد استحقاقات قادمة</p>`}
        </section>
        <section class="panel">
          <h3>تنبيهات المخزون</h3>
          ${(lowItems.concat(outItems)).length ? `<table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>الحد الأدنى</th><th>الحالة</th></tr></thead>
            <tbody>${lowItems.concat(outItems).map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.minQty}</td><td><span class="pill pill-${i.status}">${i.status==='out'?'منتهي':'منخفض'}</span></td></tr>`).join('')}</tbody></table>`
            : `<p class="empty">لا توجد نواقص حاليًا</p>`}
        </section>
      </div>

      <section class="panel">
        <h3>آخر العمليات</h3>
        ${logs.length ? `<ul class="log-list">${logs.map(l => `<li><b>${l.details}</b><span>${new Date(l.timestamp).toLocaleString('ar')}</span></li>`).join('')}</ul>` : `<p class="empty">لا يوجد نشاط بعد</p>`}
      </section>
    `);
  },

  // ================= CUSTOMERS =================
  async screenCustomers(state = {}) {
    const search = state.search || '';
    const filter = state.filter || 'all';
    const sort = state.sort || 'name';
    const customers = await Modules.listCustomers({ search, filter, sort });

    this.mount(`
      <div class="toolbar">
        <input id="custSearch" class="input" placeholder="بحث بالاسم / الهاتف / الرصيد" value="${search}">
        <select id="custFilter" class="input">
          ${this.opts({all:'الكل', owed_to_us:'لهم', owed_by_us:'عليهم', overdue:'المتأخرون', due_today:'استحقاق اليوم', due_tomorrow:'غدًا', forgotten:'المنسيون'}, filter)}
        </select>
        <select id="custSort" class="input">
          ${this.opts({name:'الاسم', balance:'الرصيد', due:'تاريخ الاستحقاق', newest:'الأحدث', oldest:'الأقدم'}, sort)}
        </select>
        <a href="#customerForm" class="btn btn-primary">+ عميل جديد</a>
      </div>
      ${customers.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${customers.map(c => `
          <tr>
            <td>${c.name}</td>
            <td>${c.phone || '-'}</td>
            <td class="${c.balance > 0 ? 'pos' : (c.balance < 0 ? 'neg' : '')}">${this.fmt(c.balance)}</td>
            <td>${c.dueDate ? c.dueDate + (c.dueTime ? ' ' + c.dueTime : '') : '-'}</td>
            <td>${Modules.isForgotten(c) ? '<span class="pill pill-out">منسي</span>' : (Modules.daysOverdue(c) > 0 ? '<span class="pill pill-low">متأخر '+Modules.daysOverdue(c)+'ي</span>' : '<span class="pill pill-available">طبيعي</span>')}</td>
            <td class="row-actions">
              <a href="#customerForm/${c.id}" class="btn btn-sm">تعديل</a>
              <button class="btn btn-sm btn-ghost" data-del-cust="${c.id}">حذف</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">لا يوجد عملاء بعد. <a href="#customerForm">إضافة عميل</a></p>`}
    `);

    document.getElementById('custSearch').addEventListener('input', (e) => this.screenCustomers({ search: e.target.value, filter, sort }));
    document.getElementById('custFilter').addEventListener('change', (e) => this.screenCustomers({ search, filter: e.target.value, sort }));
    document.getElementById('custSort').addEventListener('change', (e) => this.screenCustomers({ search, filter, sort: e.target.value }));
    document.querySelectorAll('[data-del-cust]').forEach(b => b.addEventListener('click', async () => {
      if (confirm('حذف هذا العميل نهائيًا؟')) { await Modules.deleteCustomer(b.dataset.delCust); this.screenCustomers({ search, filter, sort }); this.renderTopAlerts(); }
    }));
  },

  opts(map, selected) {
    return Object.entries(map).map(([v, l]) => `<option value="${v}" ${v===selected?'selected':''}>${l}</option>`).join('');
  },

  async screenCustomerForm(id) {
    const existing = id ? await DB.get(DB.STORES.customers, id) : null;
    this.mount(`
      <section class="panel form-panel">
        <h3>${existing ? 'تعديل عميل' : 'عميل جديد'}</h3>
        <form id="custForm" class="form-grid">
          <label>الاسم<input required name="name" value="${existing?.name || ''}"></label>
          <label>الهاتف<input name="phone" value="${existing?.phone || ''}"></label>
          <label>العنوان<input name="address" value="${existing?.address || ''}"></label>
          <label>العملة<input name="currency" value="${existing?.currency || ''}" placeholder="مثال: ريال يمني"></label>
          <label>الرصيد الحالي<input type="number" step="any" name="balance" value="${existing?.balance ?? 0}"></label>
          <label>تاريخ الاستحقاق<input type="date" name="dueDate" value="${existing?.dueDate || ''}"></label>
          <label>وقت الاستحقاق<input type="time" name="dueTime" value="${existing?.dueTime || ''}"></label>
          <label class="full">ملاحظات<textarea name="notes">${existing?.notes || ''}</textarea></label>
          <div class="form-actions full">
            <button class="btn btn-primary" type="submit">حفظ</button>
            ${existing && existing.phone ? `<button type="button" id="sendReminderBtn" class="btn">إرسال تذكير واتساب</button>` : ''}
            <a href="#customers" class="btn btn-ghost">إلغاء</a>
          </div>
        </form>
      </section>
    `);
    document.getElementById('custForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      if (existing) data.id = existing.id;
      await Modules.saveCustomer(data);
      this.toast('تم الحفظ'); location.hash = '#customers';
    });
    const sendBtn = document.getElementById('sendReminderBtn');
    if (sendBtn) sendBtn.addEventListener('click', async () => {
      const store = await DB.getSetting('storeSettings') || {};
      const msg = Modules.buildReminderMessage(existing, store);
      const link = Modules.whatsappLink(existing.phone, msg);
      if (link) window.open(link, '_blank'); else this.toast('لا يوجد رقم هاتف لهذا العميل', 'warn');
    });
  },

  // ================= FORGOTTEN =================
  async screenForgotten() {
    const customers = await Modules.listCustomers({ filter: 'forgotten' });
    this.mount(`
      <section class="panel">
        <h3>العملاء المنسيون</h3>
        <p class="hint">هؤلاء تجاوزوا موعد الاستحقاق ولم تتم متابعتهم. الضغط على "تمت المتابعة" لا يغيّر الرصيد ولا ينشئ أي حركة مالية.</p>
        ${customers.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>الاسم</th><th>الرصيد</th><th>الاستحقاق</th><th>أيام التأخير</th><th>آخر متابعة</th><th></th></tr></thead>
          <tbody>${customers.map(c => `
            <tr>
              <td>${c.name}</td><td>${this.fmt(c.balance)}</td><td>${c.dueDate} ${c.dueTime||''}</td>
              <td>${Modules.daysOverdue(c)}</td><td>${c.lastFollowUp ? new Date(c.lastFollowUp).toLocaleDateString('ar') : 'لا يوجد'}</td>
              <td class="row-actions">
                <button class="btn btn-sm" data-remind="${c.id}">إرسال تذكير</button>
                <button class="btn btn-sm btn-primary" data-followup="${c.id}">تمت المتابعة</button>
                <a class="btn btn-sm btn-ghost" href="#customerForm/${c.id}">التفاصيل</a>
              </td>
            </tr>`).join('')}</tbody></table></div>`
          : `<p class="empty">لا يوجد عملاء منسيون حاليًا 🎉</p>`}
      </section>
    `);
    document.querySelectorAll('[data-followup]').forEach(b => b.addEventListener('click', async () => {
      await Modules.markFollowedUp(b.dataset.followup); this.toast('تم تسجيل المتابعة'); this.screenForgotten(); this.renderTopAlerts();
    }));
    document.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', async () => {
      const c = await DB.get(DB.STORES.customers, b.dataset.remind);
      const store = await DB.getSetting('storeSettings') || {};
      const msg = Modules.buildReminderMessage(c, store);
      const link = Modules.whatsappLink(c.phone, msg);
      if (link) window.open(link, '_blank'); else this.toast('لا يوجد رقم هاتف لهذا العميل', 'warn');
    }));
  },

  // ================= INVENTORY =================
  async screenInventory(state = {}) {
    const search = state.search || '', filter = state.filter || 'all', sort = state.sort || 'name';
    const items = await Modules.listItems({ search, filter, sort });
    this.mount(`
      <div class="toolbar">
        <input id="itemSearch" class="input" placeholder="بحث بالاسم / الكود" value="${search}">
        <select id="itemFilter" class="input">${this.opts({all:'الكل', available:'متوفر', low:'منخفض', out:'منتهي'}, filter)}</select>
        <select id="itemSort" class="input">${this.opts({name:'الاسم', qty:'الكمية'}, sort)}</select>
        <a href="#itemForm" class="btn btn-primary">+ صنف جديد</a>
        <a href="#categories" class="btn btn-ghost">التصنيفات والوحدات</a>
      </div>
      ${items.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>الاسم</th><th>الكود</th><th>التصنيف</th><th>الوحدة</th><th>الكمية</th><th>الحد الأدنى</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${items.map(i => `<tr>
          <td>${i.name}</td><td>${i.code||'-'}</td><td>${i.categoryLabel||'-'}</td><td>${i.unit||'-'}</td>
          <td>${i.qty}</td><td>${i.minQty}</td>
          <td><span class="pill pill-${i.status}">${i.status==='out'?'منتهي':i.status==='low'?'منخفض':'متوفر'}</span></td>
          <td class="row-actions"><a href="#itemForm/${i.id}" class="btn btn-sm">تعديل</a><button class="btn btn-sm btn-ghost" data-del-item="${i.id}">حذف</button></td>
        </tr>`).join('')}</tbody></table></div>` : `<p class="empty">لا توجد أصناف بعد. <a href="#itemForm">إضافة صنف</a></p>`}
    `);
    document.getElementById('itemSearch').addEventListener('input', e => this.screenInventory({ search: e.target.value, filter, sort }));
    document.getElementById('itemFilter').addEventListener('change', e => this.screenInventory({ search, filter: e.target.value, sort }));
    document.getElementById('itemSort').addEventListener('change', e => this.screenInventory({ search, filter, sort: e.target.value }));
    document.querySelectorAll('[data-del-item]').forEach(b => b.addEventListener('click', async () => {
      if (confirm('حذف هذا الصنف نهائيًا؟')) { await Modules.deleteItem(b.dataset.delItem); this.screenInventory({search,filter,sort}); this.renderTopAlerts(); }
    }));
  },

  async screenItemForm(id) {
    const existing = id ? await DB.get(DB.STORES.items, id) : null;
    const cats = await Modules.listCategories();
    const units = await Modules.listUnits();
    this.mount(`
      <section class="panel form-panel">
        <h3>${existing ? 'تعديل صنف' : 'صنف جديد'}</h3>
        <form id="itemForm" class="form-grid">
          <label class="full">الاسم الكامل (لا يتم اختصاره أو تعديله)<input required name="name" value="${existing?.name || ''}"></label>
          <label>الكود<input name="code" value="${existing?.code || ''}"></label>
          <label>التصنيف
            <input name="categoryLabel" list="catList" value="${existing?.categoryLabel || ''}">
            <datalist id="catList">${cats.map(c=>`<option value="${c.name}">`).join('')}</datalist>
          </label>
          <label>الوحدة
            <input name="unit" list="unitList" value="${existing?.unit || ''}">
            <datalist id="unitList">${units.map(u=>`<option value="${u.name}">`).join('')}</datalist>
          </label>
          <label>الكمية الحالية<input type="number" step="any" name="qty" value="${existing?.qty ?? 0}"></label>
          <label>الحد الأدنى<input type="number" step="any" name="minQty" value="${existing?.minQty ?? 0}"></label>
          <div class="form-actions full">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <a href="#inventory" class="btn btn-ghost">إلغاء</a>
          </div>
        </form>
      </section>
    `);
    document.getElementById('itemForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      if (existing) data.id = existing.id;
      await Modules.saveItem(data);
      this.toast('تم الحفظ'); location.hash = '#inventory';
    });
  },

  async screenCategories() {
    const cats = await Modules.listCategories();
    const units = await Modules.listUnits();
    this.mount(`
      <div class="grid two-col">
        <section class="panel">
          <h3>التصنيفات</h3>
          <form id="catForm" class="inline-form"><input name="name" required placeholder="اسم تصنيف جديد"><button class="btn btn-primary">إضافة</button></form>
          <ul class="chip-list">${cats.map(c => `<li class="chip">${c.name}</li>`).join('') || '<p class="empty">لا توجد تصنيفات</p>'}</ul>
        </section>
        <section class="panel">
          <h3>الوحدات</h3>
          <form id="unitForm" class="inline-form"><input name="name" required placeholder="اسم وحدة جديدة"><button class="btn btn-primary">إضافة</button></form>
          <ul class="chip-list">${units.map(u => `<li class="chip">${u.name}</li>`).join('') || '<p class="empty">لا توجد وحدات</p>'}</ul>
        </section>
      </div>
    `);
    document.getElementById('catForm').addEventListener('submit', async e => { e.preventDefault(); await Modules.saveCategory(e.target.name.value); this.screenCategories(); });
    document.getElementById('unitForm').addEventListener('submit', async e => { e.preventDefault(); await Modules.saveUnit(e.target.name.value); this.screenCategories(); });
  },

  // ================= IMPORT =================
  async screenImport() {
    this.mount(`
      <section class="panel">
        <h3>الاستيراد الذكي</h3>
        <p class="hint">يدعم: Excel (.xlsx/.xls) — CSV — PDF نصي — SQLite/DB. مبدأ عدم فقدان البيانات مطبّق: لن يتم حذف أي حرف أو رقم أو رمز من أسماء العملاء أو الأصناف. سيتم أخذ نسخة احتياطية تلقائية قبل أي استيراد.</p>
        <input type="file" id="importFile" accept=".xlsx,.xls,.xlsm,.csv,.pdf,.db,.sqlite,.sqlite3">
        <div id="importProgress" class="hidden"><div class="spinner"></div><span id="importProgressText">جارٍ التحليل...</span></div>
        <div id="importPreview"></div>
      </section>
    `);
    document.getElementById('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      document.getElementById('importProgress').classList.remove('hidden');
      try {
        const parsed = await Import.parseFile(file);
        if (parsed.needsOCR) {
          document.getElementById('importProgress').classList.add('hidden');
          document.getElementById('importPreview').innerHTML = `<div class="alert alert-warn">${parsed.candidates.errors[0].reason}</div>`;
          return;
        }
        const plan = await Import.buildImportPlan(parsed);
        this.importState = { parsed, plan };
        document.getElementById('importProgress').classList.add('hidden');
        this.renderImportPreview(plan, parsed);
      } catch (err) {
        document.getElementById('importProgress').classList.add('hidden');
        document.getElementById('importPreview').innerHTML = `<div class="alert alert-error">فشل تحليل الملف: ${err.message}</div>`;
      }
    });
  },

  renderImportPreview(plan, parsed) {
    const box = document.getElementById('importPreview');
    const countRow = (label, n) => `<div class="count-chip"><b>${n}</b><span>${label}</span></div>`;
    box.innerHTML = `
      <div class="import-summary">
        ${countRow('عملاء جدد', plan.newCustomers.length)}
        ${countRow('عملاء سيتم تحديثهم', plan.updateCustomers.length)}
        ${countRow('عملاء يحتاجون مراجعة', plan.reviewCustomers.length)}
        ${countRow('أصناف جديدة', plan.newItems.length)}
        ${countRow('أصناف سيتم تحديثها', plan.updateItems.length)}
        ${countRow('أصناف تحتاج مراجعة', plan.reviewItems.length)}
        ${countRow('تم تجاهلها', plan.ignored.length)}
        ${countRow('أخطاء', plan.errors.length)}
      </div>
      ${plan.ignored.length ? `<details class="ignored-details"><summary>عرض السجلات المتجاهلة (${plan.ignored.length})</summary>
        <ul class="mono-list">${plan.ignored.slice(0,100).map(i => `<li>${(i.reason||'')}: ${(i.raw ? (Array.isArray(i.raw)?i.raw.join(' | '):i.raw) : i.table || '')}</li>`).join('')}</ul></details>` : ''}
      <div class="form-actions">
        <button id="confirmImportBtn" class="btn btn-primary">تأكيد الاستيراد</button>
        <button id="cancelImportBtn" class="btn btn-ghost">إلغاء</button>
      </div>
    `;
    document.getElementById('confirmImportBtn').addEventListener('click', async () => {
      try {
        const batch = await Import.commitImportPlan(plan, parsed);
        App.toast(`تم الاستيراد: ${batch.created} جديد، ${batch.updated} تحديث، ${batch.needsReview} يحتاج مراجعة`);
        location.hash = '#dashboard';
      } catch (err) {
        App.toast(err.message, 'error');
      }
    });
    document.getElementById('cancelImportBtn').addEventListener('click', () => { box.innerHTML = ''; document.getElementById('importFile').value = ''; });
  },

  async screenReviewQueue() {
    const queue = await DB.getAll(DB.STORES.reviewQueue);
    this.mount(`
      <section class="panel">
        <h3>قائمة المراجعة (مطابقات غير مؤكدة)</h3>
        ${queue.length ? queue.map(q => `
          <div class="review-card">
            <div><b>${q.entityType === 'customer' ? 'عميل' : 'صنف'} جديد:</b> ${q.candidate.raw.name}</div>
            <div><b>موجود مسبقًا:</b> ${q.candidate.existing.name}</div>
            <div><b>سبب المطابقة:</b> ${q.candidate.matchReason} — <b>الثقة:</b> ${(q.candidate.confidence*100).toFixed(0)}%</div>
            <div class="form-actions">
              <button class="btn btn-primary" data-merge="${q.id}">دمج مع الموجود</button>
              <button class="btn" data-createnew="${q.id}">إنشاء سجل جديد منفصل</button>
              <button class="btn btn-ghost" data-discard="${q.id}">تجاهل</button>
            </div>
          </div>`).join('') : `<p class="empty">لا توجد سجلات تحتاج مراجعة</p>`}
      </section>
    `);
    document.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', async () => {
      const q = queue.find(x => x.id === b.dataset.merge);
      if (q.entityType === 'customer') await DB.put(DB.STORES.customers, Import.mergeCustomer(q.candidate.existing, q.candidate));
      else await DB.put(DB.STORES.items, Import.mergeItem(q.candidate.existing, q.candidate));
      await DB.delete(DB.STORES.reviewQueue, q.id);
      this.toast('تم الدمج'); this.screenReviewQueue();
    }));
    document.querySelectorAll('[data-createnew]').forEach(b => b.addEventListener('click', async () => {
      const q = queue.find(x => x.id === b.dataset.createnew);
      if (q.entityType === 'customer') await DB.put(DB.STORES.customers, Import.newCustomerRecord(q.candidate));
      else await DB.put(DB.STORES.items, Import.newItemRecord(q.candidate));
      await DB.delete(DB.STORES.reviewQueue, q.id);
      this.toast('تم إنشاء سجل جديد'); this.screenReviewQueue();
    }));
    document.querySelectorAll('[data-discard]').forEach(b => b.addEventListener('click', async () => {
      await DB.delete(DB.STORES.reviewQueue, b.dataset.discard); this.screenReviewQueue();
    }));
  },

  // ================= REPORTS =================
  async screenReports() {
    const reportDefs = [
      ['customers', 'تقرير العملاء', Reports.buildCustomersReport],
      ['balances', 'تقرير الأرصدة', Reports.buildBalancesReport],
      ['due', 'تقرير الاستحقاقات', Reports.buildDueReport],
      ['forgotten', 'تقرير العملاء المنسيين', Reports.buildForgottenReport],
      ['items', 'تقرير الأصناف', Reports.buildItemsReport],
      ['shortages', 'تقرير النواقص', Reports.buildShortagesReport],
      ['importlog', 'تقرير الاستيراد', Reports.buildImportReport],
      ['activity', 'تقرير النشاط', Reports.buildActivityReport],
    ];
    this.mount(`
      <section class="panel">
        <h3>التقارير</h3>
        <div class="report-grid">
          ${reportDefs.map(([key, label]) => `
            <div class="report-card">
              <div>${label}</div>
              <div class="form-actions">
                <button class="btn btn-sm" data-rep="${key}" data-fmt="pdf">PDF</button>
                <button class="btn btn-sm" data-rep="${key}" data-fmt="excel">Excel</button>
                <button class="btn btn-sm" data-rep="${key}" data-fmt="csv">CSV</button>
              </div>
            </div>`).join('')}
        </div>
      </section>
    `);
    document.querySelectorAll('[data-rep]').forEach(b => b.addEventListener('click', async () => {
      const def = reportDefs.find(d => d[0] === b.dataset.rep);
      const report = await def[2].call(Reports);
      if (b.dataset.fmt === 'pdf') Reports.exportToPDF(report);
      else if (b.dataset.fmt === 'excel') Reports.exportToExcel(report);
      else Reports.exportToCSV(report);
    }));
  },

  // ================= BACKUP =================
  async screenBackup() {
    const backups = await Backup.listBackups();
    this.mount(`
      <section class="panel">
        <h3>النسخ الاحتياطي والاستعادة</h3>
        <div class="form-actions">
          <button id="manualBackupBtn" class="btn btn-primary">إنشاء نسخة احتياطية الآن</button>
          <button id="exportBackupBtn" class="btn">تصدير كملف</button>
          <label class="btn btn-ghost file-label">استيراد ملف نسخة احتياطية<input type="file" id="restoreFile" accept=".json" class="hidden"></label>
        </div>
        <h4>النسخ المخزّنة محليًا (${backups.length})</h4>
        ${backups.length ? `<table class="table"><thead><tr><th>التاريخ</th><th>السبب</th><th></th></tr></thead>
          <tbody>${backups.slice(0,30).map(b => `<tr><td>${new Date(b.timestamp).toLocaleString('ar')}</td><td>${b.reason}</td>
            <td><button class="btn btn-sm" data-restore="${b.id}">استعادة</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">لا توجد نسخ بعد</p>'}
      </section>
    `);
    document.getElementById('manualBackupBtn').addEventListener('click', async () => { await Backup.createManualBackup(); this.toast('تم إنشاء نسخة احتياطية'); this.screenBackup(); });
    document.getElementById('exportBackupBtn').addEventListener('click', () => Backup.exportBackupFile());
    document.getElementById('restoreFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirm('سيتم استبدال كل البيانات الحالية بمحتوى هذا الملف. هل أنت متأكد؟')) return;
      try { await Backup.importBackupFile(f); this.toast('تمت الاستعادة بنجاح'); location.hash = '#dashboard'; }
      catch (err) { this.toast(err.message, 'error'); }
    });
    document.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('سيتم استبدال كل البيانات الحالية بهذه النسخة. متابعة؟')) return;
      await Backup.restoreBackup(b.dataset.restore); this.toast('تمت الاستعادة'); location.hash = '#dashboard';
    }));
  },

  // ================= USERS =================
  async screenUsers() {
    const users = await DB.getAll(DB.STORES.users);
    const current = await DB.getSetting('currentUser');
    this.mount(`
      <section class="panel">
        <h3>المستخدمون والصلاحيات</h3>
        <div class="alert alert-info">ملاحظة أمنية: هذا تطبيق يعمل بالكامل داخل المتصفح بدون سيرفر، لذا نظام الأدوار هنا يتحكم بواجهة الاستخدام فقط، وليس حماية أمنية فعلية — أي شخص يملك وصولًا للجهاز يمكنه تعديل الكود محليًا. لحماية حقيقية على مستوى الصلاحيات يلزم سيرفر خلفي (Backend).</div>
        <form id="userForm" class="form-grid">
          <label>الاسم<input name="name" required></label>
          <label>اسم المستخدم<input name="username" required></label>
          <label>الدور
            <select name="role">
              <option value="manager">مدير</option>
              <option value="employee">موظف</option>
              <option value="inventory_officer">مسؤول مخزون</option>
              <option value="followup_officer">مسؤول متابعة العملاء</option>
            </select>
          </label>
          <div class="form-actions full"><button class="btn btn-primary">إضافة مستخدم</button></div>
        </form>
        <table class="table"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th></th></tr></thead>
          <tbody>${users.map(u => `<tr><td>${u.name}</td><td>${u.username}</td><td>${this.roleLabel(u.role)}</td>
            <td><button class="btn btn-sm" data-switch="${u.id}">${current?.id===u.id?'المستخدم الحالي':'تفعيل'}</button></td></tr>`).join('')}</tbody>
        </table>
      </section>
    `);
    document.getElementById('userForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      data.id = 'u_' + Date.now();
      await DB.put(DB.STORES.users, data);
      await DB.logActivity('user_add', 'إضافة مستخدم: ' + data.name);
      this.screenUsers();
    });
    document.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.switch);
      await DB.setSetting('currentUser', { id: u.id, name: u.name, role: u.role });
      this.toast('تم التبديل إلى ' + u.name); this.screenUsers();
    }));
  },
  roleLabel(r) { return { manager: 'مدير', employee: 'موظف', inventory_officer: 'مسؤول مخزون', followup_officer: 'مسؤول متابعة العملاء' }[r] || r; },

  // ================= LOG =================
  async screenLog() {
    const logs = (await DB.getAll(DB.STORES.activityLog)).sort((a,b)=>b.timestamp-a.timestamp).slice(0, 300);
    this.mount(`
      <section class="panel">
        <h3>سجل النشاط</h3>
        ${logs.length ? `<ul class="log-list">${logs.map(l => `<li><b>${l.details}</b><span>${l.user} — ${new Date(l.timestamp).toLocaleString('ar')}</span></li>`).join('')}</ul>` : '<p class="empty">لا يوجد نشاط بعد</p>'}
      </section>
    `);
  },

  // ================= SETTINGS =================
  async screenSettings() {
    const store = await DB.getSetting('storeSettings') || {};
    const rules = await Modules.getReminderRules();
    const notifSupported = await Modules.canUseBrowserNotifications();
    this.mount(`
      <div class="grid two-col">
        <section class="panel">
          <h3>بيانات المحل</h3>
          <form id="storeForm" class="form-grid">
            <label>اسم المحل<input name="storeName" value="${store.storeName || ''}"></label>
            <label>رقم التواصل<input name="phone" value="${store.phone || ''}"></label>
            <label class="full">العنوان<input name="address" value="${store.address || ''}"></label>
            <div class="form-actions full"><button class="btn btn-primary">حفظ</button></div>
          </form>
        </section>
        <section class="panel">
          <h3>قواعد التذكير</h3>
          ${rules.map((r, i) => `
            <label class="switch-row"><input type="checkbox" data-rule="${i}" ${r.enabled?'checked':''}> ${r.label}</label>
          `).join('')}
          <div class="form-actions">
            <button id="notifPermBtn" class="btn">${notifSupported ? 'تفعيل تنبيهات المتصفح' : 'التنبيهات غير مدعومة في هذا المتصفح'}</button>
          </div>
          <p class="hint">تنبيه المتصفح يحتاج إذنًا صريحًا منك؛ إذا رفضتِ الإذن أو أغلقتِ التطبيق، سيبقى التذكير معروضًا داخل التطبيق نفسه فقط عند فتحه.</p>
        </section>
      </div>
    `);
    document.getElementById('storeForm').addEventListener('submit', async e => {
      e.preventDefault();
      await DB.setSetting('storeSettings', Object.fromEntries(new FormData(e.target).entries()));
      this.toast('تم الحفظ');
    });
    document.querySelectorAll('[data-rule]').forEach(cb => cb.addEventListener('change', async () => {
      rules[cb.dataset.rule].enabled = cb.checked;
      await Modules.saveReminderRules(rules);
    }));
    const notifBtn = document.getElementById('notifPermBtn');
    if (notifSupported) notifBtn.addEventListener('click', async () => {
      const perm = await Modules.requestNotificationPermission();
      this.toast(perm === 'granted' ? 'تم تفعيل التنبيهات' : 'لم يتم منح الإذن (' + perm + ')');
    });
  },

  // ================= ASSISTANT =================
  async screenAssistant() {
    this.mount(`
      <section class="panel">
        <h3>المساعد الذكي</h3>
        <div class="alert alert-info">هذا مساعد يجيب من بياناتك المحلية الفعلية مباشرة (بدون نموذج لغوي خارجي). لتوسيعه لاحقًا إلى نموذج LLM حقيقي يلزم سيرفر وسيط لحماية مفتاح API — راجع README.</div>
        <div id="assistantLog" class="assistant-log"></div>
        <form id="assistantForm" class="inline-form">
          <input name="q" placeholder="اسأل عن عملائك أو مخزونك..." autocomplete="off">
          <button class="btn btn-primary">إرسال</button>
        </form>
        <div class="chip-list">
          ${['من هم العملاء المتأخرون؟','ما الأصناف الناقصة؟','كم عدد العملاء؟','ما إجمالي الأرصدة؟'].map(q=>`<button class="chip chip-btn" data-q="${q}">${q}</button>`).join('')}
        </div>
      </section>
    `);
    const log = document.getElementById('assistantLog');
    const ask = async (q) => {
      log.innerHTML += `<div class="msg msg-user">${q}</div>`;
      const ans = await Assistant.answer(q);
      log.innerHTML += `<div class="msg msg-bot">${ans.replace(/\n/g, '<br>')}</div>`;
      log.scrollTop = log.scrollHeight;
    };
    document.getElementById('assistantForm').addEventListener('submit', e => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) { ask(v); e.target.q.value=''; } });
    document.querySelectorAll('.chip-btn').forEach(b => b.addEventListener('click', () => ask(b.dataset.q)));
  }
};

window.addEventListener('DOMContentLoaded', () => App.boot());
