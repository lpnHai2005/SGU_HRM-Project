CREATE TABLE IF NOT EXISTS store_web_attendance_networks (
    store_id INTEGER NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
    network CIDR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, network)
);

COMMENT ON TABLE store_web_attendance_networks IS 'Allowed client IP/CIDR ranges for browser attendance at each store. Empty list means unrestricted until configured.';
