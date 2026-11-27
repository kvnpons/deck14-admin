import { Injectable, NotFoundException } from '@nestjs/common';
import { MenuCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMenuItemDto, UpdateMenuItemDto } from './dto/menu-item.dto';

export const CATEGORY_LABELS: Record<MenuCategory, string> = {
  COCKTAIL: 'Cocktails',
  COCKTAIL_SHOOTER: 'Cocktail Shooters',
  BEER: 'Beers',
  HARD_DRINK: 'Hard Drinks',
  ADDON: 'Add-ons',
};

export const CATEGORY_ORDER: MenuCategory[] = [
  'COCKTAIL',
  'COCKTAIL_SHOOTER',
  'BEER',
  'HARD_DRINK',
  'ADDON',
];

@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.menuItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  async groupedList() {
    const items = await this.list();
    const groups = CATEGORY_ORDER.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      items: items.filter((i) => i.category === category),
    }));
    return groups;
  }

  async findOrThrow(id: string) {
    const item = await this.prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Menu item not found');
    return item;
  }

  create(dto: CreateMenuItemDto) {
    return this.prisma.menuItem.create({ data: dto });
  }

  update(id: string, dto: UpdateMenuItemDto) {
    return this.prisma.menuItem.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.menuItem.delete({ where: { id } });
  }
}
