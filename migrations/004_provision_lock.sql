-- One poll advances a provision job at a time (SPEC §8 async provisioning).
ALTER TABLE provision_jobs ADD COLUMN lock_until timestamptz;
