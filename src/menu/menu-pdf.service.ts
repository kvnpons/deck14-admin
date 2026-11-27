import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { MenuService } from './menu.service';

@Injectable()
export class MenuPdfService {
  constructor(private readonly menu: MenuService) {}

  async generate(): Promise<Buffer> {
    const groups = await this.menu.groupedList();

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(22).text('Menu Catalogue', { align: 'center' });
      doc.moveDown(0.25);
      doc.fontSize(10).fillColor('#666').text(
        `Generated ${new Date().toLocaleString()}`,
        { align: 'center' },
      );
      doc.moveDown(1.5);
      doc.fillColor('black');

      for (const group of groups) {
        if (group.items.length === 0) continue;

        doc.fontSize(16).fillColor('#111').text(group.label, { underline: true });
        doc.moveDown(0.4);
        doc.fontSize(11).fillColor('black');

        for (const item of group.items) {
          const price = Number(item.price).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

          const y = doc.y;
          doc.font('Helvetica-Bold').text(item.name, 50, y, { continued: false, width: 400 });
          doc.font('Helvetica-Bold').text(`₱ ${price}`, 50, y, { align: 'right' });

          if (item.description) {
            doc.font('Helvetica').fontSize(10).fillColor('#444').text(item.description, {
              width: 500,
            });
            doc.fillColor('black').fontSize(11);
          }
          doc.moveDown(0.6);
        }
        doc.moveDown(0.8);
      }

      doc.end();
    });
  }
}
