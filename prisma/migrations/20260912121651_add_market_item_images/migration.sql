-- CreateTable
CREATE TABLE "market_item_images" (
    "id" TEXT NOT NULL,
    "marketItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_item_images_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "market_item_images" ADD CONSTRAINT "market_item_images_marketItemId_fkey" FOREIGN KEY ("marketItemId") REFERENCES "market_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
