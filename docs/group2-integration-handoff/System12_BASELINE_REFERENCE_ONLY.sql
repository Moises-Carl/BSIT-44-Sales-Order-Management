-- Requires MySQL 8.0.16+ (or MariaDB 10.2.1+) so CHECK constraints are enforced.
-- All tables use InnoDB (the default), which is required for foreign keys.
CREATE DATABASE IF NOT EXISTS mini_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mini_erp;

-- ===== SYSTEM 1: CATALOGUE =====
CREATE TABLE category (
  category_id   INT NOT NULL AUTO_INCREMENT,
  category_name VARCHAR(100) NOT NULL,
  description   TEXT,
  PRIMARY KEY (category_id),
  UNIQUE KEY uq_category_name (category_name)
);

CREATE TABLE product (
  product_id     INT NOT NULL AUTO_INCREMENT,
  category_id    INT NOT NULL,
  product_name   VARCHAR(150) NOT NULL,
  description    TEXT,
  product_status VARCHAR(20) NOT NULL DEFAULT 'active',
  PRIMARY KEY (product_id),
  UNIQUE KEY uq_product_name (product_name),
  CONSTRAINT fk_product_category FOREIGN KEY (category_id)
    REFERENCES category (category_id),
  CONSTRAINT chk_product_status CHECK (product_status IN ('active','discontinued'))
);

CREATE TABLE seller (
  seller_id     INT NOT NULL AUTO_INCREMENT,
  seller_name   VARCHAR(150) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  seller_status VARCHAR(20) NOT NULL DEFAULT 'active',
  PRIMARY KEY (seller_id),
  UNIQUE KEY uq_seller_email (contact_email),
  CONSTRAINT chk_seller_status CHECK (seller_status IN ('active','inactive'))
);

CREATE TABLE seller_offer (
  offer_id      INT NOT NULL AUTO_INCREMENT,
  seller_id     INT NOT NULL,
  product_id    INT NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  offer_status  VARCHAR(20) NOT NULL DEFAULT 'active',
  PRIMARY KEY (offer_id),
  UNIQUE KEY uq_offer_seller_product (seller_id, product_id),
  UNIQUE KEY uq_offer_id_seller (offer_id, seller_id),
  CONSTRAINT fk_offer_seller  FOREIGN KEY (seller_id)  REFERENCES seller (seller_id),
  CONSTRAINT fk_offer_product FOREIGN KEY (product_id) REFERENCES product (product_id),
  CONSTRAINT chk_offer_price  CHECK (selling_price >= 0),
  CONSTRAINT chk_offer_status CHECK (offer_status IN ('active','inactive'))
);

-- ===== SYSTEM 2: SALES / ORDER =====
CREATE TABLE customer (
  customer_id    INT NOT NULL AUTO_INCREMENT,
  customer_name  VARCHAR(150) NOT NULL,
  email          VARCHAR(255),
  contact_number VARCHAR(30) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id)
);

CREATE TABLE sales_order (
  order_id             INT NOT NULL AUTO_INCREMENT,
  order_number         VARCHAR(30) NOT NULL,
  customer_id          INT NOT NULL,
  seller_id            INT NOT NULL,
  submission_reference VARCHAR(100),
  order_date           DATETIME,
  order_status         VARCHAR(30) NOT NULL DEFAULT 'draft',
  order_total          DECIMAL(12,2) NOT NULL DEFAULT 0,
  recipient_name       VARCHAR(150),
  recipient_contact    VARCHAR(30),
  requested_delivery_address TEXT,
  cancellation_reason  TEXT,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  UNIQUE KEY uq_order_number (order_number),
  UNIQUE KEY uq_submission_reference (submission_reference),  -- many NULLs allowed
  UNIQUE KEY uq_order_id_seller (order_id, seller_id),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customer (customer_id),
  CONSTRAINT fk_order_seller   FOREIGN KEY (seller_id)   REFERENCES seller (seller_id),
  CONSTRAINT chk_order_status CHECK (order_status IN ('draft','pending_stock','awaiting_payment',
    'confirmed','fulfilling','completed','cancellation_pending','cancelled')),
  CONSTRAINT chk_order_total CHECK (order_total >= 0),
  CONSTRAINT chk_submitted_complete CHECK (
    order_status IN ('draft','cancelled') OR (
      order_date IS NOT NULL AND recipient_name IS NOT NULL AND
      recipient_contact IS NOT NULL AND requested_delivery_address IS NOT NULL))
);

CREATE TABLE order_item (
  order_item_id         INT NOT NULL AUTO_INCREMENT,
  order_id              INT NOT NULL,
  seller_id             INT NOT NULL,
  offer_id              INT NOT NULL,
  product_name_at_order VARCHAR(150) NOT NULL,
  quantity              INT NOT NULL,
  unit_price_at_order   DECIMAL(10,2) NOT NULL,
  line_total            DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price_at_order) STORED,
  PRIMARY KEY (order_item_id),
  UNIQUE KEY uq_order_offer (order_id, offer_id),
  -- both FKs share seller_id, so an order can only hold offers of its own seller
  CONSTRAINT fk_item_order FOREIGN KEY (order_id, seller_id)
    REFERENCES sales_order (order_id, seller_id),
  CONSTRAINT fk_item_offer FOREIGN KEY (offer_id, seller_id)
    REFERENCES seller_offer (offer_id, seller_id),
  CONSTRAINT chk_item_qty   CHECK (quantity > 0),
  CONSTRAINT chk_item_price CHECK (unit_price_at_order >= 0)
);

CREATE TABLE order_status_history (
  history_id             INT NOT NULL AUTO_INCREMENT,
  order_id               INT NOT NULL,
  previous_status        VARCHAR(30),
  new_status             VARCHAR(30) NOT NULL,
  changed_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_source          VARCHAR(50) NOT NULL,
  actor_reference        VARCHAR(100),
  reason                 TEXT,
  source_event_reference VARCHAR(100),
  PRIMARY KEY (history_id),
  UNIQUE KEY uq_source_event (source_event_reference),  -- many NULLs allowed
  CONSTRAINT fk_history_order FOREIGN KEY (order_id) REFERENCES sales_order (order_id)
);

-- ===== INTEGRATION VIEW =====
-- The single definition of "can this offer be ordered right now?"
CREATE OR REPLACE VIEW v_orderable_offer AS
SELECT o.offer_id, o.seller_id, o.product_id, p.product_name, o.selling_price
FROM seller_offer o
JOIN product p ON p.product_id = o.product_id
JOIN seller  s ON s.seller_id  = o.seller_id
WHERE o.offer_status   = 'active'
  AND p.product_status = 'active'
  AND s.seller_status  = 'active';
  
