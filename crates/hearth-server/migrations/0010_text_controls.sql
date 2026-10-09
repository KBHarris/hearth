-- Action names and target IDs are public routing metadata; control bodies remain MLS ciphertext.
ALTER TABLE delivery_operations DROP CONSTRAINT delivery_operations_action_check;
ALTER TABLE delivery_operations ADD CONSTRAINT delivery_operations_action_check
    CHECK (action IN ('commit','send','edit','delete','typing','reaction','pin','control'));
