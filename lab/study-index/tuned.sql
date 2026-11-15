-- README §Arms, the tuned shape: `newest` also covers the name and the modalities, and `by_name` the date, so
-- a page's UIDs come from one index without row lookups; series are the same rows as SOURCE's.
CREATE TABLE study LIKE SOURCE.study;
ALTER TABLE study DROP INDEX newest,
  ADD INDEX newest (access_key, study_date, study_time, study_uid, patient_name, modalities_in_study),
  DROP INDEX by_name, ADD INDEX by_name (access_key, patient_name, study_date, study_time);
INSERT INTO study SELECT * FROM SOURCE.study;
CREATE VIEW series AS SELECT * FROM SOURCE.series;
ANALYZE TABLE study;
