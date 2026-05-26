-- Migration: rebuild centre_brands from the May 2026 presence audit.
-- For every (centre, brand) pair in the new matrix, set present= true/false.
-- Removed brands (B005,B006,B034,B035,B039,B040,B082,B087,B091) are NOT
-- referenced — their historical centre_brands rows are preserved.
-- Idempotent: safe to re-run.

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B001', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'Cribbs Causeway', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B001', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B002', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Brent Cross', 'Eldon Square', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B002', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Arndale', 'Manchester Arndale', 'Victoria Leeds', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B003', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bullring', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B003', false FROM centres c WHERE c.name IN ('Westquay', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B004', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B004', false FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B007', true FROM centres c WHERE c.name IN ('Broadmead', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B007', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B011', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle', 'Highcross', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B011', false FROM centres c WHERE c.name IN ('Festival Place', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B012', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Cabot Circus', 'Brent Cross', 'The Oracle', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B012', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Arndale', 'Manchester Arndale', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B013', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Cabot Circus', 'Brent Cross', 'Highcross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B013', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Arndale', 'Manchester Arndale', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B014', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Bullring', 'Victoria Leeds', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B014', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B016', true FROM centres c WHERE c.name IN ('Liverpool ONE', 'Cabot Circus', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B016', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B019', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B019', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B020', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bluewater')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B020', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B021', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Meadowhall', 'Bullring', 'Cabot Circus', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B021', false FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B023', true FROM centres c WHERE c.name IN ('Liverpool ONE', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B023', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B025', true FROM centres c WHERE c.name IN ('Westquay', 'Meadowhall')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B025', false FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B027', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Brent Cross', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B027', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B028', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Brent Cross', 'Victoria Leeds', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B028', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B031', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Bullring', 'Liverpool ONE', 'Brent Cross', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B031', false FROM centres c WHERE c.name IN ('Festival Place', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B032', true FROM centres c WHERE c.name IN ('Westfield London', 'Liverpool ONE', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B032', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B033', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B033', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Arndale', 'Manchester Arndale', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B036', true FROM centres c WHERE c.name IN ('Trafford Centre', 'Queensgate')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B036', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B037', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Bullring')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B037', false FROM centres c WHERE c.name IN ('Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B038', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'St David''s', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B038', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'Cabot Circus', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B041', true FROM centres c WHERE c.name IN ('Westquay', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B041', false FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B042', true FROM centres c WHERE c.name IN ('Westfield London', 'Trafford Centre', 'Bullring')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B042', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield Stratford', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B043', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Arndale', 'Manchester Arndale', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B043', false FROM centres c WHERE c.name IN ('Westquay', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B046', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B046', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B047', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B047', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B048', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B048', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B049', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B049', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B050', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B050', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B051', true FROM centres c WHERE c.name IN ('Westfield London', 'Bullring', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B051', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B052', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B052', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B053', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B053', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B057', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Arndale', 'Manchester Arndale', 'Brent Cross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B057', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B061', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B061', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B062', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B062', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B063', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'Broadmead', 'Highcross', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B063', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B064', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'White Rose', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B064', false FROM centres c WHERE c.name IN ('Westquay', 'Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B065', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Arndale', 'Manchester Arndale', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B065', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B066', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B066', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B069', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B069', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B070', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield Stratford', 'Metrocentre', 'Meadowhall', 'Cabot Circus')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B070', false FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Trafford Centre', 'Bluewater', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B071', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B071', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B073', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B073', false FROM centres c WHERE c.name IN ('Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B075', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B075', false FROM centres c WHERE c.name IN ('Metrocentre', 'Bluewater', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B076', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B076', false FROM centres c WHERE c.name IN ('Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B077', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Liverpool ONE', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'Queensgate', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'Cribbs Causeway', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B077', false FROM centres c WHERE c.name IN ('Festival Place', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Broadmead', 'White Rose', 'Braehead', 'Silverburn')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B078', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Victoria Leeds', 'Broadmead', 'Cribbs Causeway')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B078', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Bullring', 'Lakeside', 'Liverpool ONE', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B079', true FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'The Oracle', 'White Rose')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B079', false FROM centres c WHERE c.name IN ('Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B080', true FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale', 'The Oracle', 'White Rose')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B080', false FROM centres c WHERE c.name IN ('Festival Place', 'Westfield Stratford', 'Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B081', true FROM centres c WHERE c.name IN ('Westfield London', 'Liverpool ONE', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B081', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B083', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B083', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B085', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B085', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B086', true FROM centres c WHERE c.name IN ('Festival Place', 'Trafford Centre', 'Bullring', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B086', false FROM centres c WHERE c.name IN ('Westquay', 'Westfield London', 'Westfield Stratford', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B090', true FROM centres c WHERE c.name IN ('Liverpool ONE', 'Victoria Leeds')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B090', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B092', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Metrocentre', 'Queensgate', 'Braehead')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B092', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B093', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B093', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Trafford Centre', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B094', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Highcross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B094', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B095', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bluewater', 'Meadowhall', 'Liverpool ONE', 'St David''s', 'Cabot Circus')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B095', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bullring', 'Lakeside', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B096', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Metrocentre', 'Bullring', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale', 'Brent Cross')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B096', false FROM centres c WHERE c.name IN ('Westquay', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B097', true FROM centres c WHERE c.name IN ('Festival Place', 'Westfield London', 'Westfield Stratford', 'Metrocentre', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B097', false FROM centres c WHERE c.name IN ('Westquay', 'Trafford Centre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'Liverpool ONE', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B098', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B098', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B099', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Liverpool ONE', 'Cabot Circus', 'Arndale', 'Manchester Arndale')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B099', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Bullring', 'Lakeside', 'St David''s', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B100', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Bullring', 'Liverpool ONE', 'Arndale', 'Manchester Arndale', 'The Oracle')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B100', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Meadowhall', 'Lakeside', 'St David''s', 'Cabot Circus', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B101', true FROM centres c WHERE c.name IN ('Westfield London', 'Westfield Stratford', 'Trafford Centre', 'Meadowhall', 'Bullring', 'Liverpool ONE', 'Cabot Circus')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;

INSERT INTO centre_brands (centre_id, brand_id, present)
SELECT c.id, 'B101', false FROM centres c WHERE c.name IN ('Festival Place', 'Westquay', 'Metrocentre', 'Bluewater', 'Lakeside', 'St David''s', 'Arndale', 'Manchester Arndale', 'Brent Cross', 'Victoria Leeds', 'Eldon Square', 'The Oracle', 'The Lexicon', 'Friars Walk', 'Queensgate', 'Broadmead', 'Highcross', 'Touchwood', 'Bentall Centre', 'The Bentall Centre', 'White Rose', 'Cribbs Causeway', 'Braehead', 'Silverburn', 'St James Quarter')
ON CONFLICT (centre_id, brand_id) DO UPDATE SET present = EXCLUDED.present;
