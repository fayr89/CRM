// Простой CSV-форматтер с UTF-8 BOM (чтобы Excel правильно открыл кириллицу).
// Принимает массив объектов и описание колонок.

function escape(value) {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// columns = [{ key: 'id', label: 'ID' }, { key: 'sum', label: 'Сумма', format: v => `${v} ₽` }]
export function toCsv(rows, columns, { separator = ';', bom = true } = {}) {
  const header = columns.map((c) => escape(c.label)).join(separator);
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const raw = c.get ? c.get(row) : row[c.key];
          const formatted = c.format ? c.format(raw, row) : raw;
          return escape(formatted);
        })
        .join(separator),
    )
    .join('\r\n');
  return (bom ? '﻿' : '') + header + '\r\n' + body;
}

export function csvDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
