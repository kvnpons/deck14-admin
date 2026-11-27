import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuPdfService } from './menu-pdf.service';
import { MenuBuilderService } from './menu-builder.service';

@Module({
  controllers: [MenuController],
  providers: [MenuService, MenuPdfService, MenuBuilderService],
})
export class MenuModule {}
