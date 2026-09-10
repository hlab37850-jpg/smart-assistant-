/* ============================================================
   Smart Assistant — Core Modules
   Customers / Inventory / Reminders / Forgotten Customers
   No sales, no invoices, no payment transactions — balances only.
   ============================================================ */

const Modules = {

  // ---------------- CUSTOMERS ----------------
  async listCustomers({ search = '', filter = 'all', sort = 'name' } = {}) {
    let all = await DB.getAll(DB.STORES.customers);
    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      all = all.filter(c =>
        (c.name || '').toLowerCase().includes(s) ||
        (c.phone || '').includes(s) ||
        String(c.balance ?? '').includes(s));
    }

    all = all.filter(c => {
      switch (filter) {
        case 'owed_to_us': return (c.balance ?? 0) > 0;
        case 'owed_by_us': return (c.balance ?? 0) < 0;
        case 'overdue': return c.dueDate && c.dueDate < todayStr;
        case 'due_today': return c.dueDate === todayStr;
        case 'due_tomorrow': {
          const t = new Date(); t.setDate(t.getDate() + 1);
          return c.dueDate === t.toISOString().slice(0, 10);
        }
        case 'forgotten': return this.isForgotten(c, now);
        default: return true;
      }
    });

    all.sort((a, b) => {
      switch (sort) {
        case 'balance': return (b.balance ?? 0) - (a.balance ?? 0);
        case 'due': return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        case 'newest': return b.createdAt - a.createdAt;
        case 'oldest': return a.createdAt - b.createdAt;
        default: return (a.name || '').localeCompare(b.name || '', 'ar');
      }
    });

    return all;
  },

  isForgotten(c, now = Date.now()) {
    if (!c.dueDate) return false;
    const due = new Date(c.dueDate + 'T' + (c.dueTime || '00:00'));
    if (due.getTime() >= now) return false; // not yet overdue
    if (!c.lastFollowUp) return true;
    // overdue AND no follow-up since it became overdue
    return c.lastFollowUp < due.getTime();
  },

  daysOverdue(c) {
    if (!c.dueDate) return 0;
    const due = new Date(c.dueDate + 'T' + (c.dueTime || '00:00'));
    const diff = Date.now() - due.getTime();
    return diff > 0 ? Math.floor(diff / 86400000) : 0;
  },

  async saveCustomer(data) {
    const isNew = !data.id;
    const rec = {
      id: data.id || ('cust_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name: data.name,
      phone: data.phone || '',
      address: data.address || '',
      currency: data.currency || '',
      balance: data.balance === '' || data.balance === undefined ? 0 : Number(data.balance),
      rawBalance: data.rawBalance ?? String(data.balance ?? ''),
      dueDate: data.dueDate || null,
      dueTime: data.dueTime || null,
      notes: data.notes || '',
      status: data.status || 'active',
      reminderStage: data.reminderStage || 'none',
      lastFollowUp: data.lastFollowUp ?? null,
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await DB.put(DB.STORES.customers, rec);
    await DB.logActivity(isNew ? 'customer_add' : 'customer_edit', `${isNew ? 'إضافة' : 'تعديل'} عميل: ${rec.name}`);
    return rec;
  },

  async markFollowedUp(customerId) {
    const c = await DB.get(DB.STORES.customers, customerId);
    if (!c) return null;
    c.lastFollowUp = Date.now(); // does NOT touch balance, does NOT create a transaction
    c.updatedAt = Date.now();
    await DB.put(DB.STORES.customers, c);
    await DB.logActivity('follow_up', `تمت متابعة العميل: ${c.name} (بدون أي تغيير في الرصيد)`);
    return c;
  },

  async deleteCustomer(id) {
    const c = await DB.get(DB.STORES.customers, id);
    await DB.delete(DB.STORES.customers, id);
    await DB.logActivity('customer_delete', `حذف عميل: ${c ? c.name : id}`);
  },

  // ---------------- INVENTORY ----------------
  computeItemStatus(qty, minQty) {
    const q = Number(qty) || 0;
    const min = Number(minQty) || 0;
    if (q <= 0) return 'out';
    if (min > 0 && q <= min) return 'low';
    return 'available';
  },

  async listItems({ search = '', filter = 'all', sort = 'name' } = {}) {
    let all = await DB.getAll(DB.STORES.items);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      all = all.filter(i => (i.name || '').toLowerCase().includes(s) || (i.code || '').toLowerCase().includes(s));
    }
    all = all.filter(i => {
      switch (filter) {
        case 'low': return i.status === 'low';
        case 'out': return i.status === 'out';
        case 'available': return i.status === 'available';
        default: return true;
      }
    });
    all.sort((a, b) => sort === 'qty' ? (a.qty - b.qty) : (a.name || '').localeCompare(b.name || '', 'ar'));
    return all;
  },

  async saveItem(data) {
    const isNew = !data.id;
    const qty = Number(data.qty) || 0;
    const minQty = Number(data.minQty) || 0;
    const rec = {
      id: data.id || ('item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      name: data.name,
      code: data.code || '',
      categoryId: data.categoryId || null,
      categoryLabel: data.categoryLabel || '',
      unit: data.unit || '',
      qty,
      rawQty: data.rawQty ?? String(qty),
      minQty,
      status: this.computeItemStatus(qty, minQty),
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await DB.put(DB.STORES.items, rec);
    await DB.logActivity(isNew ? 'item_add' : 'item_edit', `${isNew ? 'إضافة' : 'تعديل'} صنف: ${rec.name}`);
    return rec;
  },

  async deleteItem(id) {
    const it = await DB.get(DB.STORES.items, id);
    await DB.delete(DB.STORES.items, id);
    await DB.logActivity('item_delete', `حذف صنف: ${it ? it.name : id}`);
  },

  async listCategories() { return DB.getAll(DB.STORES.categories); },
  async saveCategory(name) {
    const rec = { id: 'cat_' + Date.now(), name };
    await DB.put(DB.STORES.categories, rec);
    return rec;
  },
  async listUnits() { return DB.getAll(DB.STORES.units); },
  async saveUnit(name) {
    const rec = { id: 'unit_' + Date.now(), name };
    await DB.put(DB.STORES.units, rec);
    return rec;
  },

  // ---------------- REMINDERS ----------------
  DEFAULT_RULES: [
    { id: 'before_1d', label: 'قبل الاستحقاق بيوم', offsetDays: -1, enabled: true },
    { id: 'on_due', label: 'في موعد الاستحقاق', offsetDays: 0, enabled: true },
    { id: 'after_due', label: 'بعد التأخر', offsetDays: 1, enabled: true },
    { id: 'after_3d', label: 'بعد 3 أيام', offsetDays: 3, enabled: true },
    { id: 'after_7d', label: 'بعد 7 أيام', offsetDays: 7, enabled: true },
  ],

  async getReminderRules() {
    const saved = await DB.getSetting('reminderRules');
    return saved || this.DEFAULT_RULES;
  },
  async saveReminderRules(rules) {
    await DB.setSetting('reminderRules', rules);
  },

  async canUseBrowserNotifications() {
    return 'Notification' in window;
  },
  async requestNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  },

  // Checks due customers against enabled rules "today" and fires real browser
  // notifications where permission is granted. Returns the list it would/did notify,
  // so the UI can show an honest in-app list even without OS permission.
  async runReminderSweep() {
    const rules = await this.getReminderRules();
    const customers = await DB.getAll(DB.STORES.customers);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const results = [];

    for (const c of customers) {
      if (!c.dueDate) continue;
      const due = new Date(c.dueDate); due.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today - due) / 86400000); // >0 overdue, <0 upcoming
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (diffDays === rule.offsetDays) {
          results.push({ customer: c, rule });
        }
      }
    }

    if (results.length && 'Notification' in window && Notification.permission === 'granted') {
      results.forEach(r => {
        try {
          new Notification('تذكير عميل: ' + r.customer.name, {
            body: `${r.rule.label} — الرصيد: ${r.customer.balance}`,
            tag: 'reminder_' + r.customer.id + '_' + r.rule.id
          });
        } catch (e) { /* notification blocked; ignore silently, UI list still shown */ }
      });
    }
    return results;
  },

  buildReminderMessage(customer, storeSettings) {
    const lines = [
      `${storeSettings.storeName || ''}`,
      `عزيزي/عزيزتي ${customer.name}،`,
      `رصيدكم الحالي: ${customer.balance} ${customer.currency || ''}`,
      customer.dueDate ? `تاريخ الاستحقاق: ${customer.dueDate} ${customer.dueTime || ''}` : '',
      storeSettings.phone ? `للتواصل: ${storeSettings.phone}` : '',
      storeSettings.address ? `العنوان: ${storeSettings.address}` : ''
    ].filter(Boolean);
    return lines.join('\n');
  },

  whatsappLink(phone, message) {
    if (!phone) return null;
    const digits = String(phone).replace(/[^\d+]/g, '').replace(/^0/, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }
};

window.Modules = Modules;
