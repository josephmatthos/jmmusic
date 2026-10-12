/*
  Warnings:

  - Changed the type of `interval_unit` on the `plans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "plans" DROP COLUMN "interval_unit",
ADD COLUMN     "interval_unit" "BillingInterval" NOT NULL;
