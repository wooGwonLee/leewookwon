import fs from "fs/promises";
import path from "path";
import { MarketItemImage } from "@prisma/client";
import { prisma } from "../db/prisma";
import { MARKET_ITEM_IMAGES_DIR } from "../upload";

export class MarketItemNotFoundError extends Error {}
export class ImageNotFoundError extends Error {}

export async function addImages(
  marketItemId: string,
  files: Express.Multer.File[],
): Promise<MarketItemImage[]> {
  const item = await prisma.marketItem.findUnique({ where: { id: marketItemId } });
  if (!item) {
    // The files were already written to disk by multer before this check;
    // clean them up since they'll never be referenced by a DB row.
    await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
    throw new MarketItemNotFoundError("Item not found");
  }
  return prisma.$transaction(
    files.map((file) =>
      prisma.marketItemImage.create({
        data: {
          marketItemId,
          filename: file.filename,
          url: `/uploads/market-items/${file.filename}`,
        },
      }),
    ),
  );
}

export async function removeImage(marketItemId: string, imageId: string): Promise<void> {
  const image = await prisma.marketItemImage.findUnique({ where: { id: imageId } });
  if (!image || image.marketItemId !== marketItemId) {
    throw new ImageNotFoundError("Image not found");
  }
  await prisma.marketItemImage.delete({ where: { id: imageId } });
  await fs.unlink(path.join(MARKET_ITEM_IMAGES_DIR, image.filename)).catch(() => undefined);
}
