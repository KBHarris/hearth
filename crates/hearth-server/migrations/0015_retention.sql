-- Signed governance specifies host retention, independent of recipient copies.
CREATE FUNCTION hearth_retention_expired(conversation TEXT, created TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM community_channels h JOIN communities c ON c.id=h.community_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.governance->'limits','[]'::jsonb)) l
        WHERE h.id=conversation AND l->>'channel_id'=h.id
        AND l->>'retention_days' IS NOT NULL
        AND created < now()-((l->>'retention_days')::int * interval '1 day')
    )
$$;
CREATE INDEX delivery_events_retention ON delivery_events(created_at)
WHERE data->>'kind'='message';
