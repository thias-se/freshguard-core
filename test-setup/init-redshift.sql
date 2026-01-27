-- Database initialization script for Redshift integration tests
-- Creates test tables and inserts realistic test data
-- Uses PostgreSQL-compatible syntax since Redshift is PostgreSQL-based

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER IDENTITY(1,1) PRIMARY KEY,  -- Redshift uses IDENTITY instead of SERIAL
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id INTEGER IDENTITY(1,1) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER IDENTITY(1,1) PRIMARY KEY,
    customer_id INTEGER,
    product_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 1,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create daily_summary table
CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER IDENTITY(1,1) PRIMARY KEY,
    summary_date DATE NOT NULL,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_revenue DECIMAL(12, 2) NOT NULL DEFAULT 0,
    unique_customers INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER IDENTITY(1,1) PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_token VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45), -- Use VARCHAR instead of INET for compatibility
    user_agent VARCHAR(MAX), -- Redshift uses VARCHAR(MAX) for long text
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test customers
INSERT INTO customers (name, email, created_at, updated_at) VALUES
('John Doe', 'john@example.com', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('Jane Smith', 'jane@example.com', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
('Bob Wilson', 'bob@example.com', CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('Alice Johnson', 'alice@example.com', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
('Charlie Brown', 'charlie@example.com', CURRENT_TIMESTAMP - INTERVAL '4 hours', CURRENT_TIMESTAMP - INTERVAL '15 minutes');

-- Insert test products
INSERT INTO products (name, price, category, created_at, updated_at) VALUES
('Laptop', 999.99, 'Electronics', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
('Mouse', 29.99, 'Electronics', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('Keyboard', 79.99, 'Electronics', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
('Monitor', 249.99, 'Electronics', CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('Webcam', 89.99, 'Electronics', CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '45 minutes');

-- Insert test orders with recent timestamps
INSERT INTO orders (customer_id, product_id, quantity, total_amount, status, order_date, updated_at) VALUES
(1, 1, 1, 999.99, 'completed', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
(2, 2, 2, 59.98, 'pending', CURRENT_TIMESTAMP - INTERVAL '30 minutes', CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
(3, 3, 1, 79.99, 'completed', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
(1, 4, 1, 249.99, 'shipped', CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
(4, 5, 1, 89.99, 'completed', CURRENT_TIMESTAMP - INTERVAL '45 minutes', CURRENT_TIMESTAMP - INTERVAL '20 minutes'),
(2, 1, 1, 999.99, 'pending', CURRENT_TIMESTAMP - INTERVAL '10 minutes', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
(5, 2, 3, 89.97, 'completed', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '45 minutes'),
(3, 3, 2, 159.98, 'shipped', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '30 minutes');

-- Insert daily summary data
INSERT INTO daily_summary (summary_date, total_orders, total_revenue, unique_customers, created_at, updated_at) VALUES
(CURRENT_DATE, 5, 1529.91, 4, CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
(CURRENT_DATE - INTERVAL '1 day', 8, 2245.88, 5, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day' + INTERVAL '1 hour'),
(CURRENT_DATE - INTERVAL '2 days', 12, 3456.78, 7, CURRENT_TIMESTAMP - INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '2 days' + INTERVAL '2 hours');

-- Insert user sessions with recent activity
INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, started_at, last_activity, updated_at) VALUES
(1, 'sess_abc123', '192.168.1.100', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '15 minutes', CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
(2, 'sess_def456', '192.168.1.101', 'Mozilla/5.0 (Mac OS X) AppleWebKit/537.36', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '30 minutes', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
(3, 'sess_ghi789', '192.168.1.102', 'Mozilla/5.0 (Linux; Android 10)', CURRENT_TIMESTAMP - INTERVAL '30 minutes', CURRENT_TIMESTAMP - INTERVAL '10 minutes', CURRENT_TIMESTAMP - INTERVAL '10 minutes'),
(4, 'sess_jkl012', '192.168.1.103', 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)', CURRENT_TIMESTAMP - INTERVAL '45 minutes', CURRENT_TIMESTAMP - INTERVAL '20 minutes', CURRENT_TIMESTAMP - INTERVAL '20 minutes'),
(5, 'sess_mno345', '192.168.1.104', 'Mozilla/5.0 (iPad; CPU OS 15_0)', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP - INTERVAL '5 minutes', CURRENT_TIMESTAMP - INTERVAL '5 minutes');

-- Create indexes for performance (Redshift style)
-- Note: Redshift doesn't support unique constraints after table creation
-- and has different index syntax, but we'll use basic indexes for compatibility
-- In real Redshift, you'd use SORTKEY and DISTKEY for optimization