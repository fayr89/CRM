// Модуль-инжектор: плавающая кнопка «📥 Оприходовать» на страницах производства.
// Работает с конверсией ед.изм. для материалов (unit_purchase + factor).
// Для материалов в модалке есть «⚙️ Настроить конверсию» — в один ряд.
const PROD_HASHES = ['#/materials', '#/processing-plans', '#/production-orders', '#/contracts', '#/production-pl'];
const ALLOWED_ROLES = ['admin', 'director_prod', 'supply', 'foreman'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function getUser() {
  try { return JSON.parse(localStorage.getItem('crm_user') || 'null'); } catch { return null; }
}
function getToken() { return localStorage.getItem('crm_token'); }
async function apiCall(method, path, body) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}
function showButton() {
  const user = getUser();
  if (!user || !ALLOWED_ROLES.includes(user.role)) return false;
  const hash = location.hash || '#/';
  return PROD_HASHES.some((h) => hash.startsWith(h));
}
function toast(text, kind = 'success') {
  const root = document.getElementById('toast-root') || document.body;
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = `position:fixed;bottom:120px;right:20px;padding:12px 18px;border-radius:8px;color:#fff;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);background:${kind === 'error' ? '#dc2626' : '#15803d'};max-width:320px;`;
  root.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

function openConvEditor(material, onSaved) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:20px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 8px;font-size:17px;">⚙️ Конверсия ед.изм.</h3>
      <p style="margin:0 0 14px;font-size:13px;color:#6b7280;">Материал: <b>${esc(material.name)}</b>.<br>Основная ед. (в ней храним и списываем, она же в МС): <b>${esc(material.unit || 'шт')}</b></p>
      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Закупочная ед.изм. (в ней покупаем — напр. «кг»)</label>
        <input id="conv-unit" value="${esc(material.unit_purchase || '')}" placeholder="кг / л / пачка" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div style="margin-bottom:14px;">
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Сколько «${esc(material.unit || 'шт')}» в 1 «${esc(material.unit_purchase || 'закупочной»')}»</label>
        <input id="conv-factor" type="number" step="0.0001" min="0" value="${material.purchase_to_unit_factor != null ? material.purchase_to_unit_factor : ''}" placeholder="напр. 6.5" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="conv-cancel" style="padding:9px 16px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Отмена</button>
        <button id="conv-save" style="padding:9px 16px;border:0;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#conv-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#conv-save').addEventListener('click', async () => {
    const u = overlay.querySelector('#conv-unit').value.trim();
    const f = Number(overlay.querySelector('#conv-factor').value);
    if (u && (!Number.isFinite(f) || f <= 0)) {
      toast('Укажите коэффициент «сколько основных в 1 закупочной»', 'error');
      return;
    }
    try {
      await apiCall('PATCH', `/api/materials/${material.id}`, {
        unit_purchase: u || null,
        purchase_to_unit_factor: u ? f : null,
      });
      toast('✅ Конверсия сохранена');
      overlay.remove();
      if (onSaved) onSaved();
    } catch (e) { toast('❌ ' + e.message, 'error'); }
  });
}

function openModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:20px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 12px;font-size:18px;">📥 Оприходовать на «Склад НСК Софийская 18»</h3>
      <p style="margin:0 0 14px;font-size:13px;color:#6b7280;">Создаёт «Оприходование» в МС. Для товаров локальный остаток сразу обновится. Для материалов с конверсией (напр. «кг → м») можно вводить в закупочных.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;"><input type="radio" name="recv-type" value="material" checked /> Материал</label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;"><input type="radio" name="recv-type" value="product" /> Готовый товар</label>
      </div>
      <div style="margin-bottom:10px;">
        <input type="search" id="recv-search" placeholder="Поиск по названию/артикулу…" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div id="recv-list" style="max-height:240px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:12px;"></div>
      <div id="recv-selected" style="margin-bottom:12px;font-size:13px;display:none;"></div>
      <div id="recv-unit-row" style="display:none;margin-bottom:10px;">
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:6px;">В какой единице вводите количество:</label>
        <div id="recv-unit-options" style="display:flex;gap:8px;"></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <div style="flex:1;">
          <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Количество <span id="recv-qty-unit" style="color:#15803d;"></span></label>
          <input type="number" id="recv-qty" min="0.0001" step="0.01" value="1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Цена за шт (₽, опц)</label>
          <input type="number" id="recv-price" min="0" step="0.01" placeholder="0" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
        </div>
      </div>
      <div id="recv-conv-preview" style="font-size:12px;color:#15803d;margin-bottom:12px;display:none;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="recv-cancel" style="padding:10px 18px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Отмена</button>
        <button id="recv-submit" style="padding:10px 18px;border:0;background:#15803d;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Оприходовать</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedItem = null;
  let currentType = 'material';
  let qtyUnitChoice = 'primary'; // primary | purchase

  const list = overlay.querySelector('#recv-list');
  const search = overlay.querySelector('#recv-search');
  const selected = overlay.querySelector('#recv-selected');
  const unitRow = overlay.querySelector('#recv-unit-row');
  const unitOptions = overlay.querySelector('#recv-unit-options');
  const qtyUnitLabel = overlay.querySelector('#recv-qty-unit');
  const convPreview = overlay.querySelector('#recv-conv-preview');
  const qtyInput = overlay.querySelector('#recv-qty');
  const submit = overlay.querySelector('#recv-submit');
  const cancel = overlay.querySelector('#recv-cancel');

  function refreshConvPreview() {
    if (!selectedItem || currentType !== 'material') {
      convPreview.style.display = 'none';
      return;
    }
    const f = Number(selectedItem.purchase_to_unit_factor);
    if (qtyUnitChoice === 'purchase' && Number.isFinite(f) && f > 0) {
      const q = Number(qtyInput.value) || 0;
      const result = q * f;
      convPreview.style.display = 'block';
      convPreview.textContent = `→ ${q} ${selectedItem.unit_purchase || 'закуп.'} × ${f} = ${result} ${selectedItem.unit || 'шт'} (это пишется в МС)`;
    } else {
      convPreview.style.display = 'none';
    }
  }

  function updateUnitOptions() {
    if (!selectedItem || currentType !== 'material') {
      unitRow.style.display = 'none';
      qtyUnitLabel.textContent = '';
      return;
    }
    const hasConv = selectedItem.unit_purchase && Number.isFinite(Number(selectedItem.purchase_to_unit_factor)) && Number(selectedItem.purchase_to_unit_factor) > 0;
    if (hasConv) {
      unitRow.style.display = 'block';
      unitOptions.innerHTML = `
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;"><input type="radio" name="recv-qty-unit" value="primary" ${qtyUnitChoice === 'primary' ? 'checked' : ''} /> в ${esc(selectedItem.unit || 'шт')} (основные)</label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:8px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;"><input type="radio" name="recv-qty-unit" value="purchase" ${qtyUnitChoice === 'purchase' ? 'checked' : ''} /> в ${esc(selectedItem.unit_purchase)} (закуп.)</label>`;
      unitOptions.querySelectorAll('input[name="recv-qty-unit"]').forEach((r) => {
        r.addEventListener('change', (e) => {
          qtyUnitChoice = e.target.value;
          qtyUnitLabel.textContent = qtyUnitChoice === 'purchase' ? `(в ${selectedItem.unit_purchase})` : `(в ${selectedItem.unit || 'шт'})`;
          refreshConvPreview();
        });
      });
      qtyUnitLabel.textContent = qtyUnitChoice === 'purchase' ? `(в ${selectedItem.unit_purchase})` : `(в ${selectedItem.unit || 'шт'})`;
    } else {
      unitRow.style.display = 'none';
      qtyUnitLabel.textContent = selectedItem.unit ? `(в ${selectedItem.unit})` : '';
    }
  }

  qtyInput.addEventListener('input', refreshConvPreview);

  function renderSelected() {
    if (!selectedItem) {
      selected.style.display = 'none';
      submit.disabled = false;
      return;
    }
    const isMat = currentType === 'material';
    const hasConv = isMat && selectedItem.unit_purchase && Number(selectedItem.purchase_to_unit_factor) > 0;
    selected.style.display = 'block';
    selected.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#dcfce7;border-radius:6px;">
        <div style="flex:1;">
          <div style="color:#15803d;font-weight:600;">✓ ${esc(selectedItem.name)}</div>
          <div style="font-size:11px;color:#374151;">${esc(selectedItem.sku || '—')} · ед.изм: ${esc(selectedItem.unit || 'шт')}${hasConv ? ` · конверсия: 1 ${esc(selectedItem.unit_purchase)} = ${selectedItem.purchase_to_unit_factor} ${esc(selectedItem.unit || 'шт')}` : (isMat ? ' · конверсия не задана' : '')}</div>
        </div>
        ${isMat ? '<button id="conv-btn" style="padding:6px 10px;font-size:12px;border:1px solid #2563eb;background:#fff;color:#2563eb;border-radius:5px;cursor:pointer;">⚙️ Конверсия</button>' : ''}
      </div>`;
    if (isMat) {
      selected.querySelector('#conv-btn').addEventListener('click', () => {
        openConvEditor(selectedItem, async () => {
          // Переподтянуть материал из АПИ
          try {
            const m = await apiCall('GET', `/api/materials/${selectedItem.id}`);
            selectedItem = m;
            updateUnitOptions();
            renderSelected();
            refreshConvPreview();
          } catch (e) { toast(e.message, 'error'); }
        });
      });
    }
    updateUnitOptions();
    refreshConvPreview();
  }

  async function load() {
    selectedItem = null;
    selected.style.display = 'none';
    unitRow.style.display = 'none';
    qtyUnitLabel.textContent = '';
    convPreview.style.display = 'none';
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#6b7280;font-size:13px;">Загрузка…</div>';
    try {
      const q = search.value.trim();
      let rows = [];
      if (currentType === 'material') {
        const r = await apiCall('GET', `/api/materials?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`);
        rows = (r.data || []).map((m) => ({
          id: m.id, name: m.name, sku: m.sku, ms_id: m.ms_id,
          unit: m.unit, unit_purchase: m.unit_purchase,
          purchase_to_unit_factor: m.purchase_to_unit_factor,
        }));
      } else {
        const r = await apiCall('GET', `/api/products?limit=100&active=true${q ? `&search=${encodeURIComponent(q)}` : ''}`);
        rows = (r.data || []).map((p) => ({
          id: p.id, name: p.name, sku: p.sku,
          ms_id: p.external_source === 'moysklad' ? p.external_id : null,
          unit: p.unit, unit_purchase: null, purchase_to_unit_factor: null,
        }));
      }
      if (!rows.length) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;font-size:13px;">Ничего не найдено</div>';
        return;
      }
      list.innerHTML = rows.map((r) => {
        const noMs = !r.ms_id;
        return `<div data-id="${r.id}" data-noms="${noMs}" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;cursor:${noMs ? 'not-allowed' : 'pointer'};opacity:${noMs ? '.45' : '1'};">
          <div style="font-size:14px;">${esc(r.name)}</div>
          <div style="font-size:11px;color:#6b7280;">${esc(r.sku || '—')} · ${esc(r.unit || 'шт')}${r.unit_purchase ? ` · закуп. ${esc(r.unit_purchase)}` : ''}${noMs ? ' · <span style="color:#dc2626;">нет ms_id</span>' : ''}</div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-id]').forEach((el, i) => {
        if (el.dataset.noms === 'true') return;
        el.addEventListener('click', () => {
          selectedItem = rows[i];
          qtyUnitChoice = 'primary';
          list.querySelectorAll('[data-id]').forEach((e) => { e.style.background = ''; });
          el.style.background = '#dcfce7';
          renderSelected();
        });
      });
    } catch (e) {
      list.innerHTML = `<div style="padding:12px;color:#dc2626;font-size:13px;">Ошибка: ${esc(e.message)}</div>`;
    }
  }

  overlay.querySelectorAll('input[name="recv-type"]').forEach((r) => {
    r.addEventListener('change', (e) => { currentType = e.target.value; load(); });
  });
  let searchT;
  search.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(load, 300); });
  cancel.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  submit.addEventListener('click', async () => {
    if (!selectedItem) { toast('Выберите позицию', 'error'); return; }
    const qty = Number(qtyInput.value);
    const price = Number(overlay.querySelector('#recv-price').value) || 0;
    if (!qty || qty <= 0) { toast('Укажите количество', 'error'); return; }
    submit.disabled = true;
    submit.textContent = '⏳ Оприходуем…';
    try {
      const r = await apiCall('POST', '/api/production/receipt', {
        type: currentType, id: selectedItem.id, qty, qty_unit: qtyUnitChoice, price,
      });
      toast(`✅ Оприходовано ${r.qty_primary} ${r.unit || ''} · ${selectedItem.name}`);
      overlay.remove();
    } catch (e) {
      toast('❌ ' + e.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Оприходовать';
    }
  });

  load();
}

function renderButton() {
  let btn = document.getElementById('prod-receipt-fab');
  if (showButton()) {
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'prod-receipt-fab';
    btn.innerHTML = '📥 Оприходовать';
    btn.style.cssText = 'position:fixed;bottom:80px;right:16px;padding:12px 18px;background:#15803d;color:#fff;border:0;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:9000;';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  } else {
    btn?.remove();
  }
}
window.addEventListener('hashchange', renderButton);
window.addEventListener('DOMContentLoaded', () => setTimeout(renderButton, 500));
if (document.readyState !== 'loading') setTimeout(renderButton, 500);
