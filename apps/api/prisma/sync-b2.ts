import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaClient, TrackStatus } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const REGION = process.env.B2_MEDIA_REGION ?? 'us-east-005';
const s3 = new S3Client({
  region: REGION,
  endpoint: process.env.B2_MEDIA_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APPLICATION_KEY!,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.B2_MEDIA_BUCKET!;
// ⚠️ Aqui é o prefixo do path dentro do bucket, NÃO o nome do bucket.
// Os arquivos estão em: <bucket>/josephmatthos/aindadatempo/Apreensivo.mp3
// Então o "folder prefix" no bucket é "josephmatthos/"
// E o streamKey salvo no banco deve ser "josephmatthos/aindadatempo/Apreensivo.mp3"
const PATH_PREFIX = 'josephmatthos/';

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function main() {
  console.log('🔄 Sincronizando músicas do Backblaze com o banco...');
  console.log(`   Bucket: ${BUCKET} | Region: ${REGION}`);

  const list = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PATH_PREFIX,
      Delimiter: '/',
    }),
  );

  const folders = (list.CommonPrefixes ?? [])
    .map((p) => p.Prefix?.replace(PATH_PREFIX, '').replace(/\/$/, ''))
    .filter((f): f is string => !!f);

  console.log(`📁 Pastas encontradas no B2: ${folders.length}`);
  console.log('   ' + folders.join(', '));

  const artist = await prisma.artist.findFirst({
    where: { slug: 'joseph-matthos' },
    select: { id: true },
  });
  if (!artist) {
    console.error('❌ Artista Joseph Matthos não encontrado no banco.');
    process.exit(1);
  }

  for (const folder of folders) {
    const folderPrefix = `${PATH_PREFIX}${folder}/`;

    const filesList = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: folderPrefix,
      }),
    );

    const mp3s = (filesList.Contents ?? [])
      .map((o) => o.Key!)
      .filter((k) => k.toLowerCase().endsWith('.mp3'));

    if (mp3s.length === 0) {
      console.log(`   ⏭️  "${folder}" sem MP3s. Ignorando.`);
      continue;
    }

    const candidates = await prisma.album.findMany({
      select: { id: true, slug: true, title: true },
    });

    const album = candidates.find((a) => {
      const slugified = a.slug.replace(/-/g, '').toLowerCase();
      const folderLower = folder.toLowerCase();
      if (slugified === folderLower) return true;
      const albumClean = slugified.replace(/vol(\d)/, 'v$1');
      if (albumClean === folderLower) return true;
      return false;
    });

    if (!album) {
      console.log(`   ⏭️  Pasta "${folder}" não corresponde a nenhum álbum. Ignorando.`);
      continue;
    }

    console.log(`\n📀 ${album.title} (${album.slug}) — ${mp3s.length} faixas`);

    const existingTracks = await prisma.track.findMany({
      where: { albumId: album.id },
      select: { id: true, title: true, streamKey: true },
    });

    for (const key of mp3s) {
      const filename = key.substring(key.lastIndexOf('/') + 1);
      const title = filename
        .replace(/\.mp3$/i, '')
        .replace(/_/g, ' ')
        .trim();

      const existing = existingTracks.find((t) => t.title === title);
      if (existing) {
        await prisma.track.update({
          where: { id: existing.id },
          data: { streamKey: key },
        });
        console.log(`   ↻ ${title}`);
      } else {
        const slug = slugify(`${title}-${Date.now()}`);
        const created = await prisma.track.create({
          data: {
            albumId: album.id,
            artistId: artist.id,
            title,
            slug,
            genre: 'Hip Hop',
            status: TrackStatus.PUBLISHED,
            streamKey: key,
          },
        });

        const tiers = [
          { hours: 24,  name: '24 horas', priceCents: 290,  sortOrder: 1 },
          { hours: 48,  name: '48 horas', priceCents: 490,  sortOrder: 2 },
          { hours: 72,  name: '3 dias',   priceCents: 690,  sortOrder: 3 },
          { hours: 120, name: '5 dias',   priceCents: 990,  sortOrder: 4 },
          { hours: 240, name: '10 dias',  priceCents: 1290, sortOrder: 5 },
          { hours: 360, name: '15 dias',  priceCents: 1990, sortOrder: 6 },
        ];

        await prisma.rentalProduct.createMany({
          data: tiers.map((t) => ({
            trackId: created.id,
            name: t.name,
            durationHours: t.hours,
            priceCents: t.priceCents,
            currency: 'BRL',
            active: true,
            sortOrder: t.sortOrder,
          })),
        });

        console.log(`   + ${title}`);
      }
    }

    const orphanTracks = await prisma.track.findMany({
      where: { albumId: album.id, streamKey: null },
      select: { id: true, title: true },
    });

    if (orphanTracks.length > 0 && mp3s.length > 0) {
      for (const t of orphanTracks) {
        await prisma.rentalProduct.deleteMany({ where: { trackId: t.id } });
        await prisma.playbackEvent.deleteMany({ where: { trackId: t.id } });
        await prisma.rental.deleteMany({ where: { trackId: t.id } });
        await prisma.track.delete({ where: { id: t.id } });
      }
      console.log(`   🧹 ${orphanTracks.length} faixas genéricas removidas`);
    }
  }

  console.log('\n✅ Sincronização concluída.');
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });