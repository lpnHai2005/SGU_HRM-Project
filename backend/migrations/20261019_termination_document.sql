-- Migration: Add termination_document_url to contracts
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS termination_document_url VARCHAR(500);
