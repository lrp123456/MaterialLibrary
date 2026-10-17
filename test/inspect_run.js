const { PrismaClient } = require('/home/lrp/my_folder/smu/KX2BFK_umbra_quick/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const run = await prisma.creationRun.findUnique({
    where: { id: 'cmu107bet02brvkxg6yaswac8' }
  });
  console.log('CreationRun details:', {
    id: run?.id,
    status: run?.status,
    progress: run?.progress,
    error: run?.error,
    outputs: run?.outputs
  });
  await prisma.$disconnect();
}
check().catch(console.error);
