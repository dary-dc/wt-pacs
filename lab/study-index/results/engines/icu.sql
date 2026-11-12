CREATE COLLATION IF NOT EXISTS ci_ai (provider = icu, locale = 'und-u-ks-level1', deterministic = false);
DROP TABLE IF EXISTS icu_probe;
CREATE TABLE icu_probe (study_uid text, access_key text, patient_name text COLLATE ci_ai, study_date date, study_time time);
INSERT INTO icu_probe SELECT study_uid, access_key, patient_name, study_date, study_time FROM study;
CREATE INDEX icu_by_name ON icu_probe (access_key, patient_name);
VACUUM ANALYZE icu_probe;
SELECT pg_prewarm('icu_probe'), pg_prewarm('icu_by_name');
