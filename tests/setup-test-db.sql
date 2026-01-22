-- Test Database Setup for FreshGuard Integration Tests
-- Creates realistic test data for connector integration testing

-- Drop existing test tables if they exist
DROP TABLE IF EXISTS daily_summary CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- ==============================================
-- Customers table
-- ==============================================
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- Products table
-- ==============================================
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    category VARCHAR(100),
    in_stock BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- Orders table - for freshness monitoring
-- ==============================================
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    order_total DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- User Sessions table - for volume anomaly testing
-- ==============================================
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    page_views INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- Daily Summary table - for aggregated freshness testing
-- ==============================================
CREATE TABLE daily_summary (
    id SERIAL PRIMARY KEY,
    summary_date DATE NOT NULL UNIQUE,
    total_orders INTEGER DEFAULT 0,
    total_revenue DECIMAL(12,2) DEFAULT 0.00,
    total_customers INTEGER DEFAULT 0,
    average_order_value DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================
-- Insert Test Data
-- ==============================================

-- Insert test customers (recent data)
INSERT INTO customers (email, first_name, last_name, status, created_at, updated_at) VALUES
('john.doe@example.com', 'John', 'Doe', 'active', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes'),
('jane.smith@example.com', 'Jane', 'Smith', 'active', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '45 minutes'),
('bob.wilson@example.com', 'Bob', 'Wilson', 'active', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour'),
('alice.brown@example.com', 'Alice', 'Brown', 'inactive', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '2 hours'),
('charlie.davis@example.com', 'Charlie', 'Davis', 'active', NOW() - INTERVAL '5 hours', NOW() - INTERVAL '3 hours');

-- Insert test products
INSERT INTO products (name, description, price, category, in_stock, created_at, updated_at) VALUES
('Laptop Computer', 'High-performance laptop for work and gaming', 999.99, 'Electronics', true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours'),
('Wireless Mouse', 'Ergonomic wireless mouse with long battery life', 29.99, 'Electronics', true, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour'),
('Coffee Mug', 'Ceramic coffee mug with company logo', 12.50, 'Office', true, NOW() - INTERVAL '3 days', NOW() - INTERVAL '30 minutes'),
('Desk Chair', 'Comfortable office chair with lumbar support', 199.99, 'Furniture', false, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 hours'),
('Monitor Stand', 'Adjustable monitor stand for better ergonomics', 45.00, 'Electronics', true, NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 hour');

-- Insert test orders (recent updates to test freshness)
INSERT INTO orders (customer_id, product_id, quantity, order_total, status, created_at, updated_at) VALUES
(1, 1, 1, 999.99, 'completed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes'),
(2, 2, 2, 59.98, 'shipped', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '45 minutes'),
(3, 3, 3, 37.50, 'pending', NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '15 minutes'),
(4, 4, 1, 199.99, 'cancelled', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '1 hour'),
(5, 5, 1, 45.00, 'completed', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '10 minutes'),
(1, 2, 1, 29.99, 'shipped', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '2 hours'),
(2, 3, 2, 25.00, 'completed', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '5 minutes'),
(3, 1, 1, 999.99, 'pending', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '20 minutes');

-- Insert test user sessions (volume data)
INSERT INTO user_sessions (customer_id, session_token, ip_address, user_agent, started_at, ended_at, page_views, created_at, updated_at)
SELECT
    (random() * 5 + 1)::integer as customer_id,
    'session_' || md5(random()::text || generate_series::text) as session_token,
    ('192.168.1.' || (random() * 254 + 1)::integer)::inet as ip_address,
    'Mozilla/5.0 (Test Browser)' as user_agent,
    NOW() - (random() * INTERVAL '24 hours') as started_at,
    NOW() - (random() * INTERVAL '12 hours') as ended_at,
    (random() * 20 + 1)::integer as page_views,
    NOW() - INTERVAL '1 day',
    NOW() - (random() * INTERVAL '2 hours')
FROM generate_series(1, 100);

-- Insert daily summaries (recent data for freshness testing)
INSERT INTO daily_summary (summary_date, total_orders, total_revenue, total_customers, average_order_value, created_at, updated_at) VALUES
(CURRENT_DATE, 8, 2397.44, 5, 299.68, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes'),
(CURRENT_DATE - 1, 12, 1543.88, 8, 192.99, NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours'),
(CURRENT_DATE - 2, 6, 899.94, 4, 149.99, NOW() - INTERVAL '2 days', NOW() - INTERVAL '47 hours'),
(CURRENT_DATE - 3, 15, 2234.85, 10, 148.99, NOW() - INTERVAL '3 days', NOW() - INTERVAL '71 hours'),
(CURRENT_DATE - 4, 9, 1678.92, 7, 186.55, NOW() - INTERVAL '4 days', NOW() - INTERVAL '95 hours');

-- ==============================================
-- Create indexes for performance
-- ==============================================
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_updated_at ON customers(updated_at);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_updated_at ON products(updated_at);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_updated_at ON orders(updated_at);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_user_sessions_customer_id ON user_sessions(customer_id);
CREATE INDEX idx_user_sessions_updated_at ON user_sessions(updated_at);
CREATE INDEX idx_daily_summary_date ON daily_summary(summary_date);
CREATE INDEX idx_daily_summary_updated_at ON daily_summary(updated_at);

-- ==============================================
-- Display sample data for verification
-- ==============================================
SELECT 'Test database setup complete!' as status;

SELECT 'Recent orders:' as info;
SELECT id, customer_id, order_total, status, updated_at
FROM orders
WHERE updated_at > NOW() - INTERVAL '2 hours'
ORDER BY updated_at DESC;

SELECT 'Table row counts:' as info;
SELECT
    'customers' as table_name, COUNT(*) as row_count FROM customers
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'daily_summary', COUNT(*) FROM daily_summary
ORDER BY table_name;