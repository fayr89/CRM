// CRM embed form: вставляется на любой внешний сайт одной строкой.
//
//   <script src="https://crm.example.com/embed/form.js"
//           data-token="ВАШ_ТОКЕН"
//           data-marketplace="Сайт example.com"></script>
//
// Скрипт ищет тег #crm-form (если его нет — создаёт div сразу после <script>),
// рендерит форму и при submit шлёт POST на /api/external/leads.

(function () {
  const script = document.currentScript;
  const token = script.getAttribute('data-token');
  const source = script.getAttribute('data-source') || 'website';
  const marketplace = script.getAttribute('data-marketplace') || '';
  const apiBase = script.src.replace(/\/embed\/form\.js.*$/, '');

  if (!token) {
    console.error('[CRM embed] data-token обязателен');
    return;
  }

  function el(tag, props, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      n.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  const styles = `
    .crm-embed { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      max-width: 420px; padding: 20px; border: 1px solid #e3e6eb; border-radius: 8px;
      background: #fff; color: #1f2328; }
    .crm-embed h3 { margin: 0 0 12px; font-size: 18px; }
    .crm-embed label { display: block; font-size: 12px; font-weight: 600; margin-top: 10px; }
    .crm-embed input, .crm-embed textarea {
      width: 100%; padding: 8px 10px; border: 1px solid #e3e6eb; border-radius: 6px;
      font-size: 14px; box-sizing: border-box; font-family: inherit;
    }
    .crm-embed textarea { min-height: 70px; resize: vertical; }
    .crm-embed button {
      margin-top: 14px; padding: 9px 16px; width: 100%;
      background: #2563eb; color: #fff; border: none; border-radius: 6px;
      font-size: 14px; font-weight: 600; cursor: pointer;
    }
    .crm-embed button:hover { background: #1d4ed8; }
    .crm-embed button:disabled { opacity: 0.6; cursor: wait; }
    .crm-embed .crm-msg { margin-top: 10px; padding: 10px; border-radius: 6px;
      background: #d1fae5; color: #065f46; font-size: 13px; }
    .crm-embed .crm-err { background: #fee2e2; color: #991b1b; }
  `;
  const styleTag = document.createElement('style');
  styleTag.textContent = styles;
  document.head.append(styleTag);

  const nameI = el('input', { type: 'text', name: 'first_name', required: 'true', placeholder: 'Иван' });
  const phoneI = el('input', { type: 'tel', name: 'phone', placeholder: '+7 999 ...' });
  const emailI = el('input', { type: 'email', name: 'email', placeholder: 'ivan@example.com' });
  const msgI = el('textarea', { name: 'description', placeholder: 'Что вас интересует?' });
  const submitBtn = el('button', { type: 'submit' }, 'Отправить заявку');
  const status = el('div');

  const form = el('form', {
    class: 'crm-embed',
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправляем…';
      status.textContent = '';
      try {
        const payload = {
          first_name: nameI.value.trim(),
          phone: phoneI.value.trim() || null,
          email: emailI.value.trim() || null,
          description: msgI.value.trim() || null,
          source,
          company_name: marketplace || null,
        };
        const res = await fetch(apiBase + '/api/external/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'HTTP ' + res.status);
        }
        status.className = 'crm-msg';
        status.textContent = '✅ Спасибо! Менеджер свяжется с вами в ближайшее время.';
        form.reset();
      } catch (err) {
        status.className = 'crm-msg crm-err';
        status.textContent = '❌ ' + (err.message || 'Не удалось отправить заявку');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Отправить заявку';
      }
    },
  },
    el('h3', {}, 'Оставить заявку'),
    el('label', {}, 'Имя *'), nameI,
    el('label', {}, 'Телефон'), phoneI,
    el('label', {}, 'Email'), emailI,
    el('label', {}, 'Сообщение'), msgI,
    submitBtn,
    status,
  );

  const container = document.getElementById('crm-form');
  if (container) container.append(form);
  else script.parentNode.insertBefore(form, script.nextSibling);
})();
