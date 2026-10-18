-- Keep public identity evidence for existing MLS transcripts, erase sign-in material.
ALTER TABLE accounts ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN departure JSONB;
ALTER TABLE encrypted_blobs ADD COLUMN erased_at TIMESTAMPTZ;
ALTER TABLE accounts ADD CONSTRAINT deleted_account_has_departure CHECK (NOT deleted OR departure IS NOT NULL);
-- Fence writes racing deletion. The deleting transaction holds the account FOR
-- UPDATE; writers wait and then fail if deletion committed. Never log account IDs.
CREATE FUNCTION hearth_live_account_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account TEXT; inactive BOOLEAN;
BEGIN
  account := to_jsonb(NEW)->>TG_ARGV[0];
  IF account IS NULL THEN RETURN NEW; END IF;
  SELECT deleted INTO inactive FROM accounts WHERE id=account FOR SHARE;
  IF inactive THEN RAISE EXCEPTION 'Account no longer active' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT c.conrelid::regclass AS relation,a.attname AS attribute
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='accounts'::regclass AND array_length(c.conkey,1)=1
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION hearth_live_account_write(%L)',
      'live_account_'||r.attribute,r.relation,r.attribute);
  END LOOP;
END $$;
