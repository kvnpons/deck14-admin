import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'path';

const LOGO_PATH = join(__dirname, '..', 'assets', 'logo.png');
export const COMPANY_NAME = 'Deck14 Mobile Entertainment Inc.';
export const DISCLAIMER =
  'This invoice is for reference only and is not a tax document. It is not an official receipt or BIR-registered invoice.';

const money = (n: unknown) =>
  'PHP ' + Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const M = 50; // page margin
const W = 595.28 - M * 2; // content width
const CONTENT_BOTTOM = 730; // keep clear of footer

@Injectable()
export class InvoicePdfService {
  generate(inv: any): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const header = () => {
        doc.image(LOGO_PATH, M, 40, { fit: [56, 56] });
        doc.font('Helvetica-Bold').fontSize(15).fillColor('#111')
          .text(COMPANY_NAME, M + 68, 58, { width: 260, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#111')
          .text('INVOICE', M, 46, { width: W, align: 'right' });
        doc.font('Helvetica').fontSize(10).fillColor('#444')
          .text(inv.number, M, 72, { width: W, align: 'right' });
        doc.moveTo(M, 108).lineTo(M + W, 108).strokeColor('#111').lineWidth(1).stroke();
        doc.y = 124;
      };

      const colX = { desc: M, qty: M + 285, unit: M + 345, amt: M + 430 };
      const tableHead = () => {
        const y = doc.y;
        doc.rect(M, y - 4, W, 20).fill('#f3f4f6');
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111');
        doc.text('Details', colX.desc + 4, y, { width: 270, lineBreak: false });
        doc.text('Qty', colX.qty, y, { width: 50, align: 'right', lineBreak: false });
        doc.text('Amount / Unit', colX.unit, y, { width: 75, align: 'right', lineBreak: false });
        doc.text('Amount', colX.amt, y, { width: W - 430 - 4, align: 'right', lineBreak: false });
        doc.y = y + 24;
      };

      header();

      // Bill-to / meta
      const top = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('BILLED TO', M, top);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111').text(inv.customerName, M, top + 13, { width: 280 });
      if (inv.customerCompany) {
        doc.font('Helvetica').fontSize(10).fillColor('#444').text(inv.customerCompany, { width: 280 });
      }
      if (inv.customerAddress) {
        doc.font('Helvetica').fontSize(10).fillColor('#444').text(inv.customerAddress, { width: 280 });
      }
      const leftEnd = doc.y;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('DATE', M + 340, top, { width: W - 340, align: 'right' });
      doc.font('Helvetica').fontSize(11).fillColor('#111').text(fmtDate(inv.issueDate), M + 340, top + 13, { width: W - 340, align: 'right' });
      doc.y = Math.max(leftEnd, top + 34) + 22;

      tableHead();

      for (const it of inv.items) {
        doc.font('Helvetica').fontSize(10);
        const h = Math.max(doc.heightOfString(it.description, { width: 270 }), 12);
        if (doc.y + h > CONTENT_BOTTOM) {
          doc.addPage();
          header();
          tableHead();
        }
        const y = doc.y;
        doc.fillColor('#111');
        doc.text(it.description, colX.desc + 4, y, { width: 270 });
        doc.text(String(Number(it.quantity)), colX.qty, y, { width: 50, align: 'right', lineBreak: false });
        doc.text(money(it.unitPrice).replace('PHP ', ''), colX.unit, y, { width: 75, align: 'right', lineBreak: false });
        doc.text(money(it.amount).replace('PHP ', ''), colX.amt, y, { width: W - 430 - 4, align: 'right', lineBreak: false });
        doc.y = y + h + 4;
        doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        doc.y += 6;
      }

      // Total + notes + disclaimer need ~120pt
      if (doc.y + 120 > CONTENT_BOTTOM) {
        doc.addPage();
        header();
      }
      doc.y += 6;
      const ty = doc.y;
      doc.moveTo(M + 270, ty).lineTo(M + W, ty).strokeColor('#111').lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111');
      doc.text('TOTAL', M + 270, ty + 8, { width: 80, lineBreak: false });
      doc.text(money(inv.total), M + 330, ty + 8, { width: W - 330, align: 'right', lineBreak: false });
      doc.y = ty + 34;

      if (inv.notes) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('NOTES', M, doc.y);
        doc.font('Helvetica').fontSize(10).fillColor('#444').text(inv.notes, M, doc.y + 2, { width: W });
        doc.y += 10;
      }

      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#b91c1c')
        .text(DISCLAIMER, M, Math.max(doc.y, 0) + 6, { width: W });

      // Footer (logo + company) on every page
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0; // allow drawing text in the bottom margin without a page break
        doc.moveTo(M, 770).lineTo(M + W, 770).strokeColor('#d1d5db').lineWidth(0.5).stroke();
        doc.image(LOGO_PATH, M, 780, { fit: [32, 32] });
        doc.font('Helvetica').fontSize(8).fillColor('#666')
          .text(COMPANY_NAME, M + 42, 790, { width: 300, lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, M, 790, { width: W, align: 'right', lineBreak: false });
      }

      doc.end();
    });
  }
}
