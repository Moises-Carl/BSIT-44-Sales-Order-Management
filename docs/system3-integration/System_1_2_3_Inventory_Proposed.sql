-- PROPOSED integration extension for System 3, version 0.2, 2026-10-22.
-- Review draft, NOT an executed or approved production migration.
-- Target: MySQL 8.0.16+; InnoDB; UTC DATETIME values.
-- Preconditions: original System12.sql tables exist in the selected dedicated DB.
-- No CREATE DATABASE, USE, DROP, TRUNCATE, ALTER, or sample data.
-- STOP if any of these proposed names already exist; reconcile first.
-- Cross-module FKs apply only to an AGREED shared MySQL deployment.
-- API-separated deployments need verified reference mappings instead.

CREATE TABLE inventory_order_control (
  order_id INT NOT NULL,
  reservation_blocked TINYINT NOT NULL DEFAULT 0,
  lifecycle_version BIGINT NOT NULL DEFAULT 0,
  block_reason VARCHAR(500),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (order_id),
  CONSTRAINT fk_inv_control_order FOREIGN KEY (order_id)
    REFERENCES sales_order (order_id),
  CONSTRAINT chk_inv_block CHECK (reservation_blocked IN (0,1)),
  CONSTRAINT chk_inv_life_version CHECK (lifecycle_version >= 0)
) ENGINE=InnoDB;

CREATE TABLE inventory_request (
  request_reference VARCHAR(100) NOT NULL,
  order_id INT NOT NULL,
  operation VARCHAR(20) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  result_status VARCHAR(20) NOT NULL,
  response_json JSON,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_reference),
  KEY ix_inv_request_order (order_id),
  CONSTRAINT fk_inv_request_order FOREIGN KEY (order_id)
    REFERENCES sales_order (order_id),
  CONSTRAINT chk_inv_operation CHECK
    (operation IN ('reserve','confirm','release')),
  CONSTRAINT chk_inv_result CHECK
    (result_status IN ('pending','reserved','rejected',
      'confirmed','expired','released'))
) ENGINE=InnoDB;

CREATE TABLE inventory (
  inventory_id INT NOT NULL AUTO_INCREMENT,
  offer_id INT NOT NULL,
  seller_id INT NOT NULL,
  quantity_on_hand INT NOT NULL DEFAULT 0,
  quantity_reserved INT NOT NULL DEFAULT 0,
  available_quantity INT GENERATED ALWAYS AS
    (quantity_on_hand - quantity_reserved) STORED,
  reorder_level INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (inventory_id),
  UNIQUE KEY uq_inv_offer (offer_id),
  UNIQUE KEY uq_inv_identity (inventory_id, offer_id, seller_id),
  CONSTRAINT fk_inv_offer FOREIGN KEY (offer_id, seller_id)
    REFERENCES seller_offer (offer_id, seller_id),
  CONSTRAINT chk_inv_balance CHECK
    (quantity_on_hand >= 0 AND quantity_reserved >= 0
     AND quantity_reserved <= quantity_on_hand),
  CONSTRAINT chk_inv_reorder CHECK (reorder_level >= 0)
) ENGINE=InnoDB;

CREATE TABLE stock_reservation (
  reservation_id VARCHAR(64) NOT NULL,
  request_reference VARCHAR(100) NOT NULL,
  inventory_id INT NOT NULL,
  offer_id INT NOT NULL,
  seller_id INT NOT NULL,
  order_id INT NOT NULL,
  order_item_id INT NOT NULL,
  quantity INT NOT NULL,
  reservation_status VARCHAR(20) NOT NULL,
  expires_at DATETIME(3),
  release_reason VARCHAR(500),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reservation_id),
  UNIQUE KEY uq_res_item (order_item_id),
  UNIQUE KEY uq_res_request_item (request_reference, order_item_id),
  KEY ix_res_order (order_id),
  KEY ix_res_expiry (reservation_status, expires_at),
  CONSTRAINT fk_res_request FOREIGN KEY (request_reference)
    REFERENCES inventory_request (request_reference),
  CONSTRAINT fk_res_inventory FOREIGN KEY
    (inventory_id, offer_id, seller_id)
    REFERENCES inventory (inventory_id, offer_id, seller_id),
  CONSTRAINT fk_res_order FOREIGN KEY (order_id)
    REFERENCES sales_order (order_id),
  CONSTRAINT fk_res_item FOREIGN KEY (order_item_id)
    REFERENCES order_item (order_item_id),
  CONSTRAINT chk_res_quantity CHECK (quantity > 0),
  CONSTRAINT chk_res_status CHECK (reservation_status IN
    ('active','confirmed','fulfilled','released','expired')),
  CONSTRAINT chk_res_expiry CHECK
    ((reservation_status <> 'active' OR expires_at IS NOT NULL)
     AND (reservation_status <> 'confirmed' OR expires_at IS NULL)),
  CONSTRAINT chk_res_reason CHECK
    (reservation_status <> 'released' OR
     (release_reason IS NOT NULL AND LENGTH(TRIM(release_reason)) > 0))
) ENGINE=InnoDB;

CREATE TABLE inventory_event_inbox (
  source_event_reference VARCHAR(100) NOT NULL,
  source_system VARCHAR(30) NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  result_json JSON,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_event_reference)
) ENGINE=InnoDB;

CREATE TABLE stock_movement (
  movement_id BIGINT NOT NULL AUTO_INCREMENT,
  inventory_id INT NOT NULL,
  reservation_id VARCHAR(64),
  order_id INT,
  source_event_reference VARCHAR(100) NOT NULL,
  movement_type VARCHAR(20) NOT NULL,
  quantity INT NOT NULL,
  on_hand_after INT NOT NULL,
  performed_by VARCHAR(100) NOT NULL,
  remarks VARCHAR(500),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (movement_id),
  UNIQUE KEY uq_move_reservation (reservation_id),
  UNIQUE KEY uq_move_event_stock
    (source_event_reference, inventory_id, movement_type),
  CONSTRAINT fk_move_inventory FOREIGN KEY (inventory_id)
    REFERENCES inventory (inventory_id),
  CONSTRAINT fk_move_reservation FOREIGN KEY (reservation_id)
    REFERENCES stock_reservation (reservation_id),
  CONSTRAINT fk_move_order FOREIGN KEY (order_id)
    REFERENCES sales_order (order_id),
  CONSTRAINT fk_move_event FOREIGN KEY (source_event_reference)
    REFERENCES inventory_event_inbox (source_event_reference),
  CONSTRAINT chk_move_type CHECK (movement_type IN
    ('restock','sale','return','adjustment_in','adjustment_out')),
  CONSTRAINT chk_move_quantity CHECK (quantity > 0),
  CONSTRAINT chk_move_balance CHECK (on_hand_after >= 0),
  CONSTRAINT chk_move_reservation CHECK
    ((movement_type = 'sale' AND reservation_id IS NOT NULL
      AND order_id IS NOT NULL) OR
     (movement_type <> 'sale' AND reservation_id IS NULL)),
  CONSTRAINT chk_move_reason CHECK
    (movement_type NOT IN ('adjustment_in','adjustment_out') OR
     (remarks IS NOT NULL AND LENGTH(TRIM(remarks)) > 0))
) ENGINE=InnoDB;

CREATE TABLE inventory_event_outbox (
  event_reference VARCHAR(100) NOT NULL,
  order_id INT NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  payload_json JSON NOT NULL,
  lifecycle_version BIGINT,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_reference),
  UNIQUE KEY uq_inv_lifecycle_version (order_id, lifecycle_version),
  KEY ix_inv_outbox_delivery (delivery_status, created_at),
  CONSTRAINT fk_inv_outbox_order FOREIGN KEY (order_id)
    REFERENCES sales_order (order_id),
  CONSTRAINT chk_inv_delivery CHECK
    (delivery_status IN ('pending','delivered')),
  CONSTRAINT chk_inv_attempts CHECK (attempts >= 0),
  CONSTRAINT chk_inv_outbox_version CHECK
    (event_type <> 'reservation.lifecycle' OR
     (lifecycle_version IS NOT NULL AND lifecycle_version > 0))
) ENGINE=InnoDB;

-- APPLICATION REQUIREMENTS: FKs alone do not enforce these.
-- Validate each order_item belongs to the supplied order, offer, and seller;
-- quantity equals accepted Sales quantity; request operation/order matches.
-- Validate sale movement matches reservation's inventory/order/quantity.
-- Lock order-control FIRST, then inventory records by ascending inventory_id,
-- then reservations; every mutating operation follows this same lock order.
-- Maintain reserved == SUM(active + confirmed reservation quantities).
-- No stock write outside the balance+movement/reservation transaction.
-- No network I/O while a stock transaction is open.
-- Inventory service alone writes these tables; Sales/Catalogue do not.
-- Enforce immutable movements using runtime grants and controlled procedures.
-- Confirmation expiry follows Inventory's proposal (NULL after confirmed).
-- Sales now supports NULL confirmed expiry and signed lifecycle v1 updates.

-- Increment control.lifecycle_version under the order-control lock and copy it
-- into the lifecycle outbox row/payload in the SAME Inventory transaction.
