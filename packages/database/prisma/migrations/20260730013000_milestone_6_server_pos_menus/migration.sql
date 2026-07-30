CREATE TYPE "RestaurantFulfillmentMode" AS ENUM ('SEAT_DELIVERY', 'COUNTER_PICKUP');
CREATE TYPE "ModifierSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');
CREATE TYPE "RestaurantOrderStatus" AS ENUM (
  'DRAFT',
  'SENT',
  'IN_PROGRESS',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
  'CANCELED'
);
CREATE TYPE "RestaurantOrderItemStatus" AS ENUM ('DRAFT', 'SENT', 'VOIDED', 'COMPED');

ALTER TABLE "restaurant_tabs"
  ADD COLUMN "fulfillmentMode" "RestaurantFulfillmentMode" NOT NULL DEFAULT 'SEAT_DELIVERY',
  ADD COLUMN "mergedIntoTabId" TEXT;

ALTER TABLE "restaurant_tabs"
  ADD CONSTRAINT "restaurant_tabs_mergedIntoTabId_fkey"
  FOREIGN KEY ("mergedIntoTabId") REFERENCES "restaurant_tabs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "kitchen_stations" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "displayType" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kitchen_stations_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "kitchen_stations_locationId_name_key"
  ON "kitchen_stations"("locationId", "name");
CREATE INDEX "kitchen_stations_locationId_active_idx"
  ON "kitchen_stations"("locationId", "active");

CREATE TABLE "menu_categories" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_categories_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "menu_categories_locationId_name_key"
  ON "menu_categories"("locationId", "name");
CREATE INDEX "menu_categories_locationId_active_sortOrder_idx"
  ON "menu_categories"("locationId", "active", "sortOrder");

CREATE TABLE "menu_items" (
  "id" TEXT NOT NULL,
  "menuCategoryId" TEXT NOT NULL,
  "kitchenStationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceCents" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "is86d" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_items_menuCategoryId_fkey"
    FOREIGN KEY ("menuCategoryId") REFERENCES "menu_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "menu_items_kitchenStationId_fkey"
    FOREIGN KEY ("kitchenStationId") REFERENCES "kitchen_stations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "menu_items_price_check" CHECK ("priceCents" >= 0)
);

CREATE UNIQUE INDEX "menu_items_menuCategoryId_name_key"
  ON "menu_items"("menuCategoryId", "name");
CREATE INDEX "menu_items_menuCategoryId_active_sortOrder_idx"
  ON "menu_items"("menuCategoryId", "active", "sortOrder");
CREATE INDEX "menu_items_kitchenStationId_active_idx"
  ON "menu_items"("kitchenStationId", "active");

CREATE TABLE "modifier_groups" (
  "id" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "selectionType" "ModifierSelectionType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "minSelections" INTEGER NOT NULL DEFAULT 0,
  "maxSelections" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "modifier_groups_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "modifier_groups_selection_check" CHECK (
    "minSelections" >= 0 AND
    ("maxSelections" IS NULL OR "maxSelections" >= "minSelections")
  )
);

CREATE UNIQUE INDEX "modifier_groups_menuItemId_name_key"
  ON "modifier_groups"("menuItemId", "name");
CREATE INDEX "modifier_groups_menuItemId_sortOrder_idx"
  ON "modifier_groups"("menuItemId", "sortOrder");

CREATE TABLE "modifiers" (
  "id" TEXT NOT NULL,
  "modifierGroupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceDeltaCents" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "modifiers_modifierGroupId_fkey"
    FOREIGN KEY ("modifierGroupId") REFERENCES "modifier_groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "modifiers_modifierGroupId_name_key"
  ON "modifiers"("modifierGroupId", "name");
CREATE INDEX "modifiers_modifierGroupId_active_sortOrder_idx"
  ON "modifiers"("modifierGroupId", "active", "sortOrder");

CREATE TABLE "restaurant_orders" (
  "id" TEXT NOT NULL,
  "restaurantTabId" TEXT NOT NULL,
  "showtimeSeatId" TEXT,
  "serverEmployeeId" TEXT NOT NULL,
  "status" "RestaurantOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "placedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_orders_restaurantTabId_fkey"
    FOREIGN KEY ("restaurantTabId") REFERENCES "restaurant_tabs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_orders_showtimeSeatId_fkey"
    FOREIGN KEY ("showtimeSeatId") REFERENCES "showtime_seats"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_orders_serverEmployeeId_fkey"
    FOREIGN KEY ("serverEmployeeId") REFERENCES "employees"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "restaurant_orders_restaurantTabId_status_idx"
  ON "restaurant_orders"("restaurantTabId", "status");
CREATE INDEX "restaurant_orders_showtimeSeatId_status_idx"
  ON "restaurant_orders"("showtimeSeatId", "status");
CREATE INDEX "restaurant_orders_serverEmployeeId_createdAt_idx"
  ON "restaurant_orders"("serverEmployeeId", "createdAt");

CREATE TABLE "restaurant_order_items" (
  "id" TEXT NOT NULL,
  "restaurantOrderId" TEXT NOT NULL,
  "menuItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceCentsSnapshot" INTEGER NOT NULL,
  "selectedModifiers" JSONB NOT NULL,
  "modifierTotalCents" INTEGER NOT NULL DEFAULT 0,
  "allergyNotes" TEXT,
  "course" TEXT,
  "kitchenStationId" TEXT NOT NULL,
  "status" "RestaurantOrderItemStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "restaurant_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_order_items_restaurantOrderId_fkey"
    FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_order_items_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_order_items_kitchenStationId_fkey"
    FOREIGN KEY ("kitchenStationId") REFERENCES "kitchen_stations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "restaurant_order_items_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "restaurant_order_items_price_check"
    CHECK ("unitPriceCentsSnapshot" >= 0)
);

CREATE INDEX "restaurant_order_items_restaurantOrderId_status_idx"
  ON "restaurant_order_items"("restaurantOrderId", "status");
CREATE INDEX "restaurant_order_items_kitchenStationId_status_idx"
  ON "restaurant_order_items"("kitchenStationId", "status");
