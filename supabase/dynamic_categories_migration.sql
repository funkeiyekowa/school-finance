-- Dynamic categories table so schools can add/edit/delete their own
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read categories" ON categories
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can manage categories" ON categories
  FOR ALL USING (auth.role() = 'authenticated');

-- Seed with defaults
INSERT INTO categories (name, type, sort_order) VALUES
('School Fees', 'income', 1),
('Textbook Sales', 'income', 2),
('Uniform Sales', 'income', 3),
('Transport Fees', 'income', 4),
('Registration Fees', 'income', 5),
('Donations & Grants', 'income', 6),
('Other Income', 'income', 99),
('Rent', 'expense', 1),
('Utilities', 'expense', 2),
('Salaries & Wages', 'expense', 3),
('Teaching Supplies & Materials', 'expense', 4),
('Maintenance & Repairs', 'expense', 5),
('Transport', 'expense', 6),
('Textbook Purchases', 'expense', 7),
('Administrative & Office', 'expense', 8),
('Insurance', 'expense', 9),
('Other Expense', 'expense', 99)
ON CONFLICT DO NOTHING;

-- Also add a "developer" role (highest permission level, can delete everything)
INSERT INTO roles (name, description, is_default, permissions) VALUES
('developer', 'Full system access including bulk delete operations', false,
 '{"income":true,"expenses":true,"students":true,"vendors":true,"reconciliation":true,"reports":true,"receipts":true,"setup":true,"roles":true,"team":true,"activity":true,"sms_alerts":true,"delete_all":true}')
ON CONFLICT (name) DO NOTHING;
