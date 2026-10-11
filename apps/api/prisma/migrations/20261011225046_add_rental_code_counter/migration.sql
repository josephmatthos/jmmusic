-- CreateTable
CREATE TABLE "RentalCodeCounter" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RentalCodeCounter_pkey" PRIMARY KEY ("year")
);
