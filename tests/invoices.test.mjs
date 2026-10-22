import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { buildInvoicePdf } from '../backend/invoice-pdf.mjs';
import { buildInvoiceHtml, invoiceNumber } from '../backend/invoices.mjs';
import { sendMail } from '../backend/mail.mjs';
import { nonNegativeInt, positiveInt, priceValue } from '../backend/validation.mjs';

const fixture = {
  order: { id: '01234567-0000-4000-8000-000000000001', created_at: '2026-10-22T08:00:00Z', buyer_name: 'NTI Köpare', buyer_email: 'buyer@example.test', buyer_billing_address: 'Köpargatan 1, Göteborg', buyer_billing_reference: 'KÖP-123' },
  items: [
    { seller_school_id: 'one', seller_name: 'NTI Säljare', seller_billing_address: 'Skolvägen 2, Malmö', seller_billing_reference: 'SÄLJ-1', product_title: 'Bärbar dator - åäö ÅÄÖ', quantity: 2, unit_price: '123.45', line_total: '246.90' },
    { seller_school_id: 'two', seller_name: 'NTI Säljare', seller_billing_address: 'Annan adress 3, Stockholm', product_title: 'USB-C-laddare', quantity: 1, unit_price: '50.00', line_total: '50.00' },
  ],
};

test('numeric validation rejects coercion and PostgreSQL overflow without rejecting zero or decimal prices', () => {
  for (const value of [null, undefined, true, false, '', '  ', [], {}, NaN, Infinity, -1]) {
    assert.equal(nonNegativeInt(value), null); assert.equal(priceValue(value), null);
  }
  assert.equal(nonNegativeInt(2147483648), null); assert.equal(nonNegativeInt(1.2), null);
  assert.equal(priceValue(10000000000), null); assert.equal(positiveInt(0), null);
  assert.equal(nonNegativeInt('0'), 0); assert.equal(priceValue(0), 0);
  assert.equal(priceValue('123.45'), 123.45); assert.equal(priceValue(100.255), 100.26);
});

test('invoice number uses the purchase year and same-name sellers remain separate', () => {
  assert.equal(invoiceNumber(fixture.order.id, '2020-01-01'), 'DEMO-2020-01234567');
  const html = buildInvoiceHtml(fixture);
  assert.equal((html.match(/<div class="seller">/g) || []).length, 2);
  assert.ok(html.includes('Skolvägen 2')); assert.ok(html.includes('Annan adress 3'));
});

test('PDF generation produces a complete single-page invoice and paginates long orders', async () => {
  const pdf = await buildInvoicePdf(fixture);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.subarray(-20).toString().includes('%%EOF'));
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
  const many = await buildInvoicePdf({ ...fixture, items: Array.from({ length: 90 }, (_, index) => ({ ...fixture.items[0], product_title: `Produkt ${index + 1} med extra lång titel som behöver flera rader i tabellen.` })) });
  assert.ok((many.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3);
});

test('SMTP sends the PDF as a real MIME attachment and reports rejected recipients', async () => {
  let captured = '', rejectRecipient = false;
  const sockets = new Set();
  const smtp = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '', dataMode = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (true) {
        if (dataMode) {
          const end = buffer.indexOf('\r\n.\r\n'); if (end < 0) return;
          captured = buffer.slice(0, end); buffer = buffer.slice(end + 5); dataMode = false;
          socket.write('250 message accepted\r\n'); continue;
        }
        const end = buffer.indexOf('\r\n'); if (end < 0) return;
        const command = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (/^(EHLO|HELO)/i.test(command)) socket.write('250-localhost\r\n250 SIZE 10000000\r\n');
        else if (/^RCPT/i.test(command) && rejectRecipient) socket.write('550 no such recipient\r\n');
        else if (/^DATA/i.test(command)) { dataMode = true; socket.write('354 send message\r\n'); }
        else if (/^QUIT/i.test(command)) { socket.end('221 bye\r\n'); return; }
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  const previous = Object.fromEntries(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'NODE_ENV'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_USER: '', SMTP_PASS: '', NODE_ENV: 'test' });
  try {
    const pdf = await buildInvoicePdf(fixture);
    const message = { to: 'buyer@example.test', subject: 'Order test', html: '<p>Order complete</p>', attachments: [{ filename: 'invoice.pdf', content: pdf, contentType: 'application/pdf' }] };
    assert.equal(await sendMail(message), 'smtp');
    assert.match(captured, /Content-Type: application\/pdf/);
    assert.match(captured, /Content-Disposition: attachment; filename=invoice.pdf/);
    const attachment = captured.slice(captured.indexOf('Content-Type: application/pdf'));
    const encoded = attachment.split('\r\n\r\n')[1].split('\r\n--')[0];
    assert.deepEqual(Buffer.from(encoded.replace(/\s/g, ''), 'base64'), pdf);
    rejectRecipient = true;
    await assert.rejects(sendMail(message));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => smtp.close(resolve));
  }
});
