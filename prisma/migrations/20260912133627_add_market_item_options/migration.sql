-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "marketItemOptionId" TEXT;

-- CreateTable
CREATE TABLE "market_item_options" (
    "id" TEXT NOT NULL,
    "marketItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_item_options_marketItemId_name_key" ON "market_item_options"("marketItemId", "name");

-- AddForeignKey
ALTER TABLE "market_item_options" ADD CONSTRAINT "market_item_options_marketItemId_fkey" FOREIGN KEY ("marketItemId") REFERENCES "market_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_marketItemOptionId_fkey" FOREIGN KEY ("marketItemOptionId") REFERENCES "market_item_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
