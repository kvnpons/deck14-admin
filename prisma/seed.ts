import { PrismaClient, MenuCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.menuItem.count();
  if (count > 0) {
    console.log(`Skipping seed — ${count} menu items already exist.`);
    return;
  }

  await prisma.menuItem.createMany({
    data: [
      { name: 'Old Fashioned', description: 'Bourbon, sugar, bitters', price: 280, category: MenuCategory.COCKTAIL },
      { name: 'Margarita', description: 'Tequila, lime, triple sec', price: 260, category: MenuCategory.COCKTAIL },
      { name: 'Espresso Martini', description: 'Vodka, coffee liqueur, espresso', price: 290, category: MenuCategory.COCKTAIL },
      { name: 'B-52', description: 'Kahlua, Baileys, Grand Marnier', price: 150, category: MenuCategory.COCKTAIL_SHOOTER },
      { name: 'Kamikaze', description: 'Vodka, triple sec, lime juice', price: 140, category: MenuCategory.COCKTAIL_SHOOTER },
      { name: 'San Miguel Pale Pilsen', description: '330ml bottle', price: 90, category: MenuCategory.BEER },
      { name: 'Heineken', description: '330ml bottle', price: 130, category: MenuCategory.BEER },
      { name: 'Jameson (per shot)', description: 'Irish whiskey', price: 180, category: MenuCategory.HARD_DRINK },
      { name: 'Jose Cuervo Silver (per shot)', description: 'Tequila', price: 170, category: MenuCategory.HARD_DRINK },
      { name: 'Extra hour of bar service', description: 'Beyond contracted hours', price: 3500, category: MenuCategory.ADDON },
      { name: 'Glassware upgrade', description: 'Premium glassware per guest', price: 50, category: MenuCategory.ADDON },
    ],
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
