const { PrismaClient } = require('/home/lrp/my_folder/smu/KX2BFK_umbra_quick/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.creationTemplate.findMany({
    select: { id: true, name: true, status: true, engine: true }
  });
  console.log('All Creation Templates:');
  console.log(templates);
}

main().catch(console.error).finally(() => prisma.$disconnect());
