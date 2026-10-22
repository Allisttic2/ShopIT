// ShopIT backend – fakturagenerering (fas 1: demonivå, ej giltig faktura).
// Mallen är en generell svensk fakturamall: fakturauppgifter, betalningsvillkor,
// en sektion per säljare med postlista och totaler.

export function invoiceNumber(orderId, createdAt = new Date()) {
  return `DEMO-${new Date(createdAt).getUTCFullYear()}-${String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function formatSek(value) {
  return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// items: rows from shopit.order_items for one order.
export function sellerGroups(items) {
  const sellers = new Map();
  for (const item of items) {
    const key = item.seller_school_id || item.seller_name;
    if (!sellers.has(key)) {
      sellers.set(key, { seller_name: item.seller_name, billing_address: item.seller_billing_address, billing_reference: item.seller_billing_reference, items: [] });
    }
    sellers.get(key).items.push(item);
  }
  return [...sellers.values()];
}

export function buildInvoiceHtml({ order, items }) {
  const sellers = sellerGroups(items);

  const total = [...items].reduce((sum, item) => sum + Number(item.line_total), 0);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(order.created_at));
  const number = invoiceNumber(order.id, order.created_at);

  const sections = sellers.map(group => {
    const groupTotal = group.items.reduce((sum, item) => sum + Number(item.line_total), 0);
    const rows = group.items.map(item => `
          <tr>
            <td>${escapeHtml(item.product_title)}</td>
            <td class="num">${item.quantity}</td>
            <td class="num">${formatSek(item.unit_price)} kr</td>
            <td class="num">${formatSek(item.line_total)} kr</td>
          </tr>`).join('');
    return `
      <div class="seller">
        <h2>Från – ${escapeHtml(group.seller_name)}</h2>
        <p class="addr">${escapeHtml(group.billing_address)}${group.billing_reference ? `<br>Fakturareferens: ${escapeHtml(group.billing_reference)}` : ''}</p>
        <table>
          <thead><tr><th>Artikel</th><th class="num">Antal</th><th class="num">Pris/exemplar</th><th class="num">Belopp</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" class="num">Summa</td><td class="num">${formatSek(groupTotal)} kr</td></tr></tfoot>
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="sv">
<head><meta charset="utf-8"><title>Faktura ${escapeHtml(number)}</title></head>
<body style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 24px;">
  <table style="width:100%; border-collapse: collapse;">
    <tr>
      <td>
        <h1 style="margin:0 0 4px; font-size:22px;">FAKTURA</h1>
        <p style="margin:0; color:#666; font-size:12px;">Demonivärde – ej giltig faktura</p>
      </td>
      <td style="text-align:right; font-size:13px;">
        <p style="margin:0;">Fakturanummer: <strong>${escapeHtml(number)}</strong></p>
        <p style="margin:0;">Datum: ${escapeHtml(date)}</p>
        <p style="margin:0;">Betalningsvillkor: 14 dagar</p>
      </td>
    </tr>
  </table>
  <hr style="border:none; border-top:1px solid #ddd;">
  <p style="font-size:13px;">
    <strong>Till – ${escapeHtml(order.buyer_name)}</strong><br>
    ${escapeHtml(order.buyer_billing_address)}${order.buyer_billing_reference ? `<br>Fakturareferens: ${escapeHtml(order.buyer_billing_reference)}` : ''}
  </p>
  ${sections}
  <hr style="border:none; border-top:2px solid #1a1a1a;">
  <p style="text-align:right; font-size:15px; margin-top:8px;">Totalt att betala: <strong>${formatSek(total)} kr</strong></p>
  <p style="font-size:11px; color:#666; margin-top:24px;">
    Detta är ett automatiskt skickat orderbekräftelsemail från NTI-T Shopp.
    Fakturan är gjord i demonivärde utifrän en generell fakturamall och är inte juridiskt bindande.
  </p>
</body>
</html>`;
}
