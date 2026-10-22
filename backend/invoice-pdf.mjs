import PDFDocument from 'pdfkit';
import { invoiceNumber, formatSek, sellerGroups } from './invoices.mjs';

// Render from immutable order snapshots, never from current school/product data.
export function buildInvoicePdf({ order, items }) {
  return new Promise((resolve, reject) => {
    const number = invoiceNumber(order.id, order.created_at);
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true,
      info: { Title: `Faktura ${number}`, Author: 'NTI-T Shopp', Subject: 'Orderbekräftelse - demo' } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const left = 48, right = doc.page.width - 48, width = right - left;
      let y = 48;
      const text = (value, x, top, options = {}) => doc.text(String(value ?? ''), x, top, options);
      const line = top => doc.strokeColor('#dbe2e8').lineWidth(0.6).moveTo(left, top).lineTo(right, top).stroke();
      const newPage = () => {
        doc.addPage(); y = 48;
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#18334a');
        text(`FAKTURA ${number} - fortsättning`, left, y, { width });
        y += 30;
      };
      const space = height => { if (y + height > doc.page.height - 65) newPage(); };
      const paragraph = (value, { size = 10, bold = false, color = '#263746' } = {}) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
        const height = doc.heightOfString(String(value || ''), { width, lineGap: 3 });
        space(height + 6);
        text(value, left, y, { width, lineGap: 3 }); y += height + 6;
      };
      const heading = seller => {
        paragraph(`Från: ${seller.seller_name}`, { bold: true, size: 12 });
        if (seller.billing_address) paragraph(seller.billing_address);
        if (seller.billing_reference) paragraph(`Referens: ${seller.billing_reference}`);
      };
      const tableHeader = () => {
        doc.rect(left, y, width, 24).fill('#edf2f6');
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#18334a');
        for (const [label, x, columnWidth, align] of [
          ['Produkt', left + 8, 231, 'left'], ['Antal', left + 245, 40, 'right'],
          ['Pris/st', left + 290, 95, 'right'], ['Belopp', left + 390, width - 398, 'right'],
        ]) text(label, x, y + 7, { width: columnWidth, align, lineBreak: false });
        y += 30;
      };
      doc.font('Helvetica-Bold').fontSize(27).fillColor('#18334a');
      text('FAKTURA', left, y); y += 36;
      paragraph('NTI-T SHOPP', { bold: true, size: 10 });
      paragraph('DEMO - ej giltig faktura', { size: 9, color: '#687887' });
      line(y + 6); y += 24;
      paragraph(`Fakturanummer: ${number}`, { bold: true });
      paragraph(`Datum: ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(order.created_at))}    Betalningsvillkor: 14 dagar`);
      y += 10;
      paragraph(`Till: ${order.buyer_name}`, { bold: true, size: 12 });
      paragraph(order.buyer_billing_address);
      if (order.buyer_billing_reference) paragraph(`Referens: ${order.buyer_billing_reference}`);
      if (order.buyer_email) paragraph(order.buyer_email, { size: 9 });
      y += 14;
      for (const seller of sellerGroups(items)) {
        space(160); heading(seller); tableHeader();
        for (const item of seller.items) {
          doc.font('Helvetica').fontSize(10);
          const height = Math.max(22, doc.heightOfString(item.product_title, { width: 231 }) + 12);
          if (y + height > doc.page.height - 85) { newPage(); heading(seller); tableHeader(); }
          doc.font('Helvetica').fontSize(10).fillColor('#263746');
          text(item.product_title, left + 8, y + 4, { width: 231 });
          text(item.quantity, left + 245, y + 4, { width: 40, align: 'right', lineBreak: false });
          text(formatSek(item.unit_price), left + 290, y + 4, { width: 95, align: 'right', lineBreak: false });
          text(formatSek(item.line_total), left + 390, y + 4, { width: width - 398, align: 'right', lineBreak: false });
          y += height; line(y); y += 3;
        }
        space(32);
        const subtotal = seller.items.reduce((sum, item) => sum + Math.round(Number(item.line_total) * 100), 0) / 100;
        doc.font('Helvetica-Bold').fontSize(10);
        text(`Delsumma: ${formatSek(subtotal)} kr`, left, y + 6, { width, align: 'right' }); y += 40;
      }
      space(85); line(y); y += 16;
      const total = items.reduce((sum, item) => sum + Math.round(Number(item.line_total) * 100), 0) / 100;
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#18334a');
      text(`Totalt att betala: ${formatSek(total)} kr`, left, y, { width, align: 'right' });
      const range = doc.bufferedPageRange();
      for (let page = 0; page < range.count; page++) {
        doc.switchToPage(page); doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(8).fillColor('#687887');
        text(`NTI-T Shopp | Demonivärde - ej juridiskt bindande | Sida ${page + 1} av ${range.count}`, left, doc.page.height - 33, { width, align: 'center', lineBreak: false });
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
