// Модуль-инжектор: добавляет плавающую кнопку «📥 Оприходовать»
// когда пользователь на страницах Производства (#/materials, #/processing-plans,
// #/production-orders, #/contracts, #/production-pl). Открывает модалку выбора
// (материал/товар + qty + price), вызывает POST /api/production/receipt.
//
// Не правим views.js — это отдельный ES-модуль, подключён в index.html.

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

function openModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:20px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.3);">
      <h3 style="margin:0 0 12px;font-size:18px;">📥 Оприходовать на «Склад НСК Софийская 18 (Производство)»</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Создаёт документ «Оприходование» в МойСклад. Для товара локальный остаток сразу обновится.</p>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;"><input type="radio" name="recv-type" value="material" checked /> Материал</label>
        <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;"><input type="radio" name="recv-type" value="product" /> Готовый товар</label>
      </div>
      <div style="margin-bottom:12px;">
        <input type="search" id="recv-search" placeholder="Поиск по названию/артикулу…" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
      </div>
      <div id="recv-list" style="max-height:280px;overflow:auto;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:12px;"></div>
      <div id="recv-selected" style="margin-bottom:12px;font-size:13px;color:#15803d;font-weight:600;display:none;"></div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <div style="flex:1;">
          <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Количество</label>
          <input type="number" id="recv-qty" min="0.01" step="0.01" value="1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
        </div>
        <div style="flex:1;">
          <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:4px;">Цена за шт (₽, опц)</label>
          <input type="number" id="recv-price" min="0" step="0.01" placeholder="0" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;box-sizing:border-box;font-size:14px;" />
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="recv-cancel" style="padding:10px 18px;border:1px solid #d1d5db;background:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Отмена</button>
        <button id="recv-submit" style="padding:10px 18px;border:0;background:#15803d;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;">Оприходовать</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let selectedId = null;
  let selectedName = null;
  let selectedSku = null;
  let currentType = 'material';

  const list = overlay.querySelector('#recv-list');
  const search = overlay.querySelector('#recv-search');
  const selected = overlay.querySelector('#recv-selected');
  const submit = overlay.querySelector('#recv-submit');
  const cancel = overlay.querySelector('#recv-cancel');

  async function load() {
    selectedId = null;
    selected.style.display = 'none';
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#6b7280;font-size:13px;">Загрузка…</div>';
    try {
      const q = search.value.trim();
      let rows = [];
      if (currentType === 'material') {
        const r = await apiCall('GET', `/api/materials?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`);
        rows = (r.data || []).map((m) => ({ id: m.id, name: m.name, sku: m.sku, ms_id: m.ms_id }));
      } else {
        const r = await apiCall('GET', `/api/products?limit=100&active=true${q ? `&search=${encodeURIComponent(q)}` : ''}`);
        rows = (r.data || []).map((p) => ({ id: p.id, name: p.name, sku: p.sku, ms_id: p.external_source === 'moysklad' ? p.external_id : null }));
      }
      if (!rows.length) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#6b7280;font-size:13px;">Ничего не найдено</div>';
        return;
      }
      list.innerHTML = rows.map((r) => {
        const noMs = !r.ms_id;
        return `<div data-id="${r.id}" data-name="${esc(r.name)}" data-sku="${esc(r.sku || '')}" data-noms="${noMs}" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;cursor:${noMs ? 'not-allowed' : 'pointer'};opacity:${noMs ? '.45' : '1'};">
          <div style="font-size:14px;">${esc(r.name)}</div>
          <div style="font-size:11px;color:#6b7280;">${esc(r.sku || '—')}${noMs ? ' · <span style="color:#dc2626;">нет ms_id</span>' : ''}</div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-id]').forEach((el) => {
        if (el.dataset.noms === 'true') return;
        el.addEventListener('click', () => {
          selectedId = Number(el.dataset.id);
          selectedName = el.dataset.name;
          selectedSku = el.dataset.sku;
          selected.style.display = 'block';
          selected.textContent = `✓ Выбран: ${selectedName}${selectedSku ? ' (' + selectedSku + ')' : ''}`;
          list.querySelectorAll('[data-id]').forEach((e) => { e.style.background = ''; });
          el.style.background = '#dcfce7';
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
  search.addEventListener('input', () => {
    clearTimeout(searchT);
    searchT = setTimeout(load, 300);
  });
  cancel.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  submit.addEventListener('click', async () => {
    if (!selectedId) { toast('Выберите позицию из списка', 'error'); return; }
    const qty = Number(overlay.querySelector('#recv-qty').value);
    const price = Number(overlay.querySelector('#recv-price').value) || 0;
    if (!qty || qty <= 0) { toast('Укажите количество', 'error'); return; }
    submit.disabled = true;
    submit.textContent = '⏳ Оприходуем…';
    try {
      const r = await apiCall('POST', '/api/production/receipt', { type: currentType, id: selectedId, qty, price });
      toast(`✅ Оприходовано ${qty} шт · ${selectedName}`);
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
    btn.addEventListener('click', openButtonClick);
    document.body.appendChild(btn);
  } else {
    btn?.remove();
  }
}

function openButtonClick() {
  openModal();
}

// Реагируем на смену хэш-маршрута и на первичную загрузку.
window.addEventListener('hashchange', renderButton);
// Первый рендер отложен, чтобы localStorage.crm_user уже был заполнен после логина.
window.addEventListener('DOMContentLoaded', () => setTimeout(renderButton, 500));
// На всякий случай, если DOM уже готов.
if (document.readyState !== 'loading') setTimeout(renderButton, 500);
