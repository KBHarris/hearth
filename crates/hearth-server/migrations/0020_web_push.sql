CREATE TABLE push_subscriptions (
 id text PRIMARY KEY,
 account_id text NOT NULL REFERENCES accounts(id),
 device_key text NOT NULL,
 endpoint text NOT NULL UNIQUE,
 p256dh text NOT NULL,
 auth text NOT NULL,
 pending_at timestamptz,
 last_attempt timestamptz NOT NULL DEFAULT now()-interval '1 minute',
 FOREIGN KEY(account_id,device_key) REFERENCES account_devices(account_id,device_key)
);
CREATE INDEX push_pending ON push_subscriptions(last_attempt) WHERE pending_at IS NOT NULL;
